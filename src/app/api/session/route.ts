/**
 * Sign-in. The database decides, and nothing else does.
 *
 * The engine's doLogin() used to compare every password against a single
 * hardcoded literal, which meant an admin-set password was ignored by the login
 * screen while the server checked the real one — the two could disagree and the
 * user just saw "invalid credentials". Authentication now happens here, once,
 * against bcrypt hashes in the users table.
 *
 * A shop username can legitimately match two people (a Bill Clerk and a Packer
 * share 'crs9'). When it does, this returns the candidates without issuing a
 * cookie, and the client asks which of them is signing in — preserving the role
 * picker the sign-in screen has always shown.
 */
import { NextResponse } from 'next/server';
import { supabaseAdmin, supabaseConfigured } from '@/lib/supabaseAdmin';
import { SESSION_COOKIE, cookieOptions, encodeSession } from '@/lib/session';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

type Candidate = {
  id: number;
  username: string;
  full_name: string;
  phone: string | null;
  email: string | null;
  role: string;
  crs_id: number | null;
};

/** Shaped like the engine's userStore records, which enterApp() consumes. */
function toEngineUser(c: Candidate) {
  return {
    id: c.id,
    fullName: c.full_name,
    username: c.username,
    phone: c.phone ?? '',
    email: c.email ?? '',
    role: c.role,
    crsId: c.crs_id,
    active: true,
  };
}

export async function POST(req: Request) {
  if (!supabaseConfigured()) {
    return NextResponse.json({ error: 'Supabase is not configured on the server.' }, { status: 503 });
  }

  let body: { username?: string; password?: string; userId?: number };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: 'Malformed request.' }, { status: 400 });
  }

  const identifier = String(body.username ?? '').trim();
  const password = String(body.password ?? '');
  if (!identifier || !password) {
    return NextResponse.json({ error: 'Username and password are required.' }, { status: 400 });
  }

  const { data, error } = await supabaseAdmin().rpc('verify_login', {
    p_identifier: identifier,
    p_password: password,
  });

  if (error) {
    console.error('[api/session] verify_login failed:', error.code, error.message);
    // PGRST202 = function not found, i.e. 0002_users.sql has not been run.
    const missing = error.code === 'PGRST202' || /verify_login/i.test(error.message);
    return NextResponse.json(
      {
        error: missing
          ? 'User management is not installed — run supabase/migrations/0002_users.sql.'
          : 'Could not verify the sign-in.',
      },
      { status: missing ? 503 : 500 },
    );
  }

  const candidates = (data ?? []) as Candidate[];
  if (candidates.length === 0) {
    return NextResponse.json({ error: 'Incorrect username or password.' }, { status: 401 });
  }

  // More than one person registered under this username — let the caller pick,
  // but only from accounts that just authenticated.
  if (candidates.length > 1 && !body.userId) {
    return NextResponse.json({
      ok: false,
      needsRole: true,
      candidates: candidates.map(toEngineUser),
    });
  }

  const chosen =
    candidates.length === 1
      ? candidates[0]
      : candidates.find((c) => c.id === Number(body.userId));

  if (!chosen) {
    return NextResponse.json({ error: 'That account did not match the credentials.' }, { status: 401 });
  }

  const res = NextResponse.json({ ok: true, user: toEngineUser(chosen) });
  res.cookies.set(
    SESSION_COOKIE,
    encodeSession({
      userId: chosen.id,
      username: chosen.username,
      role: chosen.role,
      crsId: chosen.crs_id,
      iat: Math.floor(Date.now() / 1000),
    }),
    cookieOptions(),
  );
  return res;
}

export async function DELETE() {
  const res = NextResponse.json({ ok: true });
  res.cookies.set(SESSION_COOKIE, '', cookieOptions(0));
  return res;
}
