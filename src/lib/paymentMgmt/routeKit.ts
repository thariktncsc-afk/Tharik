/**
 * What the /api/payment-management routes share: who is asking, the handlers'
 * dependencies (delivery, the activity log, the clock), and how an answer or a
 * failure becomes a response. Route handlers only (supabaseAdmin).
 *
 * Never imports src/lib/payments/server.ts — that pulls in the statement engine.
 */
import { NextResponse, after } from 'next/server';
import { cookies } from 'next/headers';
import { supabaseAdmin, supabaseConfigured } from '@/lib/supabaseAdmin';
import { SESSION_COOKIE, decodeSession, type Session } from '@/lib/session';
import { recordActivity } from '@/lib/activityLog/server';
import { markForUser, notifyShopPayment } from '@/lib/notify/server';
import { shopName } from '@/lib/engine/shops';
import { istToday } from './core';
import type { Actor, Answer, Deps } from './server';
import { storagePmStore } from './storageStore';

export const store = storagePmStore;

/** The signed-in person from the session cookie, with their full name for the records. */
export async function actorOf(): Promise<{ session: Session | null; actor: Actor | null }> {
  const jar = await cookies();
  const session = decodeSession(jar.get(SESSION_COOKIE)?.value);
  if (!session) return { session: null, actor: null };
  let name = session.username;
  try {
    const { data } = await supabaseAdmin().from('users').select('full_name').eq('id', session.userId).maybeSingle();
    if (data?.full_name) name = String(data.full_name);
  } catch {
    /* the username will do */
  }
  return { session, actor: { userId: session.userId, role: session.role, crsId: session.crsId, name } };
}

/** The handlers' outside world, for this request. The activity rows are written after the answer is sent. */
export function depsFor(session: Session | null): Deps {
  return {
    notifyShop: (input) => notifyShopPayment(input),
    recordActivity: (drafts) => {
      after(() => recordActivity(session, drafts));
    },
    ackNotification: async (userId, notificationId) => {
      try {
        await markForUser(userId, notificationId, 'acknowledge');
      } catch (e) {
        console.warn('[api/payment-management] notification not acknowledged:', notificationId, e instanceof Error ? e.message : e);
      }
    },
    today: () => istToday(),
    now: () => new Date().toISOString(),
    shopName: (crsId) => shopName(crsId),
  };
}

const NO_STORE = { 'Cache-Control': 'no-store' };

/** Supabase not set up on this server: every route answers this first. */
export function notConfigured(): NextResponse | null {
  return supabaseConfigured() ? null : NextResponse.json({ error: 'Supabase is not configured on the server.' }, { status: 503, headers: NO_STORE });
}

export const send = (a: Answer) => NextResponse.json(a.body, { status: a.status, headers: NO_STORE });

/** A path segment as text; one that cannot be decoded stays as it is (and is then answered as not found). */
export function param(s: string): string {
  try {
    return decodeURIComponent(s);
  } catch {
    return s;
  }
}

/** The request's JSON body, or null when there is none or it is not JSON. */
export const bodyOf = (req: Request): Promise<unknown> => req.json().catch(() => null);

/** What the person is told when the database or storage fails — never its internals. */
const PLAIN = {
  list: 'Unable to read the payment records. Please try again.',
  save: 'Unable to save. Please try again.',
  remove: 'Unable to remove it. Please try again.',
  remind: 'Unable to send the reminder. Please try again.',
  file: 'Unable to open the file. Please try again.',
  upload: 'Unable to save the file. Please try again.',
} as const;

/**
 * A failure: a known one (two people at once, payment settings not
 * installed) is answered with its own sentence; anything else goes to the
 * server log (Vercel → Logs) and the person gets a plain sentence.
 */
export function failure(e: unknown, what: keyof typeof PLAIN): NextResponse {
  const known = e as { status?: number; plain?: string; message?: string } | null;
  if (known && (known.status === 409 || known.status === 503) && known.plain) {
    if (known.status === 503) console.error(`[api/payment-management] ${what}:`, known.message);
    return NextResponse.json({ error: known.plain }, { status: known.status, headers: NO_STORE });
  }
  console.error(`[api/payment-management] ${what} failed:`, e instanceof Error ? e.message : e);
  return NextResponse.json({ error: PLAIN[what] }, { status: 500, headers: NO_STORE });
}
