/**
 * User list and creation.
 *
 * Reads are open to any signed-in user: the statement builders print the Bill
 * Clerk's and Packer's names and mobiles on the official forms, so every role
 * needs the roster. Writes are admin-only. password_hash is never selected.
 */
import { NextResponse } from 'next/server';
import { cookies } from 'next/headers';
import { supabaseAdmin, supabaseConfigured } from '@/lib/supabaseAdmin';
import { SESSION_COOKIE, decodeSession, type Session } from '@/lib/session';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const SAFE_COLUMNS = 'id, username, full_name, phone, email, role, crs_id, active, created_at';

export async function requireSession(): Promise<Session | null> {
  const jar = await cookies();
  return decodeSession(jar.get(SESSION_COOKIE)?.value);
}

/** DB row → the shape the engine's userStore holds. */
export function toEngineUser(r: Record<string, unknown>) {
  return {
    id: r.id as number,
    fullName: (r.full_name as string) ?? '',
    username: (r.username as string) ?? '',
    phone: (r.phone as string) ?? '',
    email: (r.email as string) ?? '',
    role: (r.role as string) ?? '',
    crsId: (r.crs_id as number) ?? null,
    active: r.active !== false,
    createdAt: String(r.created_at ?? '').slice(0, 10),
  };
}

export async function GET() {
  if (!supabaseConfigured()) {
    return NextResponse.json({ error: 'Supabase is not configured on the server.' }, { status: 503 });
  }
  const session = await requireSession();
  if (!session) return NextResponse.json({ error: 'Not signed in.' }, { status: 401 });

  const { data, error } = await supabaseAdmin()
    .from('users')
    .select(SAFE_COLUMNS)
    .order('id');

  if (error) {
    console.error('[api/users] list failed:', error.code, error.message);
    const missing = error.code === 'PGRST205';
    return NextResponse.json(
      {
        error: missing
          ? 'The users table does not exist — run supabase/migrations/0002_users.sql.'
          : 'Could not read users.',
      },
      { status: missing ? 503 : 500 },
    );
  }

  return NextResponse.json({ users: (data ?? []).map(toEngineUser) });
}

export async function POST(req: Request) {
  if (!supabaseConfigured()) {
    return NextResponse.json({ error: 'Supabase is not configured on the server.' }, { status: 503 });
  }
  const session = await requireSession();
  if (!session) return NextResponse.json({ error: 'Not signed in.' }, { status: 401 });
  if (session.role !== 'ADMIN') {
    return NextResponse.json({ error: 'Only an administrator can add users.' }, { status: 403 });
  }

  let body: Record<string, unknown>;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: 'Malformed request.' }, { status: 400 });
  }

  const username = String(body.username ?? '').trim();
  const fullName = String(body.fullName ?? '').trim();
  const role = String(body.role ?? '').trim();
  const password = String(body.password ?? '').trim();

  if (!username || !fullName || !role) {
    return NextResponse.json({ error: 'Username, full name and role are required.' }, { status: 400 });
  }
  if (password.length < 6) {
    return NextResponse.json({ error: 'Password must be at least 6 characters.' }, { status: 400 });
  }

  const db = supabaseAdmin();
  const { data, error } = await db
    .from('users')
    .insert({
      username,
      full_name: fullName,
      phone: String(body.phone ?? '').trim() || null,
      email: String(body.email ?? '').trim() || null,
      role,
      crs_id: body.crsId == null || body.crsId === '' ? null : Number(body.crsId),
      active: body.active !== false,
      // Placeholder — replaced immediately below by the hashing function, so a
      // readable password never touches the table even briefly.
      password_hash: 'pending',
    })
    .select(SAFE_COLUMNS)
    .single();

  if (error) {
    console.error('[api/users] insert failed:', error.code, error.message);
    return NextResponse.json({ error: 'Could not create the user.' }, { status: 500 });
  }

  const { error: pwError } = await db.rpc('set_user_password', {
    p_user_id: data.id,
    p_password: password,
  });
  if (pwError) {
    // Never leave an account that cannot be signed into but also cannot be seen.
    await db.from('users').delete().eq('id', data.id);
    console.error('[api/users] password set failed:', pwError.code, pwError.message);
    return NextResponse.json({ error: 'Could not set the password.' }, { status: 500 });
  }

  return NextResponse.json({ ok: true, user: toEngineUser(data) }, { status: 201 });
}
