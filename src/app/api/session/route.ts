/**
 * Establishes / clears the app session cookie.
 *
 * The engine's existing doLogin() has already checked the credentials in the
 * browser by the time this is called. That check stays exactly as it was — it
 * drives the UI. This route re-checks the same credentials server-side, against
 * the same userStore, because a browser-side check protects nothing.
 *
 * Source of truth is the persisted `userStore` row, so there is no second users
 * table to keep in sync — userStore is already in BACKUP_STORES.
 */
import { NextResponse } from 'next/server';
import { supabaseAdmin, supabaseConfigured } from '@/lib/supabaseAdmin';
import { SESSION_COOKIE, cookieOptions, encodeSession } from '@/lib/session';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

type StoredUser = {
  id: number;
  username: string;
  password: string;
  role: string;
  crsId: number | null;
  phone?: string;
  active?: boolean;
};

export async function POST(req: Request) {
  if (!supabaseConfigured()) {
    return NextResponse.json({ error: 'Supabase is not configured on the server.' }, { status: 503 });
  }

  let body: { username?: string; password?: string };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: 'Malformed request.' }, { status: 400 });
  }

  const username = String(body.username ?? '').trim();
  const password = String(body.password ?? '');
  if (!username || !password) {
    return NextResponse.json({ error: 'Username and password are required.' }, { status: 400 });
  }

  const { data, error } = await supabaseAdmin()
    .from('crs_state')
    .select('data')
    .eq('scope', 'global')
    .eq('store_key', 'userStore')
    .maybeSingle();

  if (error) {
    // PGRST205 = table missing, i.e. supabase/migrations/0001_init.sql has not
    // been run against this database. Worth naming, because the generic 500 sent
    // people looking at their keys instead.
    console.error('[api/session] crs_state read failed:', error.code, error.message);
    const missing = error.code === 'PGRST205';
    return NextResponse.json(
      {
        error: missing
          ? 'The crs_state table does not exist — run supabase/migrations/0001_init.sql.'
          : 'Could not read the user store.',
      },
      { status: missing ? 503 : 500 },
    );
  }

  const users = (data?.data ?? []) as StoredUser[];

  // Bootstrap: a brand-new database has no userStore row yet, so nobody could
  // ever sign in to write the first one. Until the store exists, trust the
  // engine's own check and let the first save seed it. This window closes the
  // moment the first save lands.
  if (!Array.isArray(users) || users.length === 0) {
    return json_ok({ userId: 0, username, role: 'ADMIN', crsId: null }, true);
  }

  // Matched the way doLogin() does it (src/legacy/07-auth.js): the username is
  // compared lowercased, the phone number as typed.
  const lowered = username.toLowerCase();
  const match = users.find(
    (u) =>
      u.active !== false &&
      u.password === password &&
      (String(u.username).toLowerCase() === lowered || String(u.phone ?? '') === username),
  );

  if (!match) {
    return NextResponse.json({ error: 'Invalid credentials.' }, { status: 401 });
  }

  return json_ok({
    userId: match.id,
    username: String(match.username),
    role: String(match.role),
    crsId: match.crsId ?? null,
  });
}

export async function DELETE() {
  const res = NextResponse.json({ ok: true });
  res.cookies.set(SESSION_COOKIE, '', cookieOptions(0));
  return res;
}

function json_ok(
  s: { userId: number; username: string; role: string; crsId: number | null },
  bootstrap = false,
) {
  const res = NextResponse.json({ ok: true, role: s.role, crsId: s.crsId, bootstrap });
  res.cookies.set(SESSION_COOKIE, encodeSession({ ...s, iat: Math.floor(Date.now() / 1000) }), cookieOptions());
  return res;
}
