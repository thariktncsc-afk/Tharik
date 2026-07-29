/**
 * The app's own session cookie.
 *
 * This project keeps its existing client-side login (src/legacy/07-auth.js) —
 * the sign-in screen, the credentials and the user flow are unchanged. But a
 * login that only exists in the browser cannot protect an API: anything the
 * browser knows, anyone can send. So on a successful sign-in the engine also
 * calls POST /api/session, and the server issues this HttpOnly cookie. The
 * route handlers trust the cookie, not the request body.
 *
 * Deliberately dependency-free: an HMAC over a JSON payload. Not a JWT library,
 * because we need exactly one claim set and no algorithm negotiation.
 */
import { createHmac, timingSafeEqual } from 'node:crypto';

export const SESSION_COOKIE = 'crs_session';
const MAX_AGE_SECONDS = 60 * 60 * 12; // one working day

export type Session = {
  userId: number;
  username: string;
  role: string;
  crsId: number | null;
  /** issued-at, epoch seconds */
  iat: number;
};

function secret(): string {
  const s = process.env.APP_SESSION_SECRET;
  if (!s || s === 'CHANGE_ME_TO_A_LONG_RANDOM_STRING') {
    throw new Error('APP_SESSION_SECRET is not set. See .env.local.example.');
  }
  return s;
}

const b64url = (b: Buffer) => b.toString('base64url');
const sign = (payload: string) => createHmac('sha256', secret()).update(payload).digest('base64url');

export function encodeSession(s: Session): string {
  const payload = b64url(Buffer.from(JSON.stringify(s)));
  return `${payload}.${sign(payload)}`;
}

export function decodeSession(token: string | undefined): Session | null {
  if (!token) return null;
  const dot = token.lastIndexOf('.');
  if (dot < 1) return null;

  const payload = token.slice(0, dot);
  const given = Buffer.from(token.slice(dot + 1));
  const want = Buffer.from(sign(payload));
  if (given.length !== want.length || !timingSafeEqual(given, want)) return null;

  try {
    const s = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8')) as Session;
    if (typeof s.iat !== 'number' || Date.now() / 1000 - s.iat > MAX_AGE_SECONDS) return null;
    return s;
  } catch {
    return null;
  }
}

export function cookieOptions(maxAge = MAX_AGE_SECONDS) {
  return {
    httpOnly: true,
    sameSite: 'lax' as const,
    secure: process.env.NODE_ENV === 'production',
    path: '/',
    maxAge,
  };
}
