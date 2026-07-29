/**
 * Update, password reset and delete for one user. Admin only.
 *
 * Delete is a real delete because the Users screen has always offered one, but
 * an administrator cannot delete their own account — locking the last admin out
 * of the system is not a recoverable mistake from inside the app.
 */
import { NextResponse } from 'next/server';
import { supabaseAdmin, supabaseConfigured } from '@/lib/supabaseAdmin';
import { requireSession, toEngineUser } from '../route';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const SAFE_COLUMNS = 'id, username, full_name, phone, email, role, crs_id, active, created_at';

async function guard(params: Promise<{ id: string }>) {
  if (!supabaseConfigured()) {
    return { error: NextResponse.json({ error: 'Supabase is not configured on the server.' }, { status: 503 }) };
  }
  const session = await requireSession();
  if (!session) return { error: NextResponse.json({ error: 'Not signed in.' }, { status: 401 }) };
  if (session.role !== 'ADMIN') {
    return { error: NextResponse.json({ error: 'Only an administrator can change users.' }, { status: 403 }) };
  }
  const id = Number((await params).id);
  if (!Number.isFinite(id)) {
    return { error: NextResponse.json({ error: 'Bad user id.' }, { status: 400 }) };
  }
  return { session, id };
}

export async function PATCH(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const g = await guard(ctx.params);
  if (g.error) return g.error;

  let body: Record<string, unknown>;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: 'Malformed request.' }, { status: 400 });
  }

  const db = supabaseAdmin();
  const patch: Record<string, unknown> = { updated_at: new Date().toISOString() };

  if (body.username !== undefined) patch.username = String(body.username).trim();
  if (body.fullName !== undefined) patch.full_name = String(body.fullName).trim();
  if (body.phone !== undefined) patch.phone = String(body.phone).trim() || null;
  if (body.email !== undefined) patch.email = String(body.email).trim() || null;
  if (body.role !== undefined) patch.role = String(body.role).trim();
  if (body.active !== undefined) patch.active = body.active !== false;
  if (body.crsId !== undefined) {
    patch.crs_id = body.crsId == null || body.crsId === '' ? null : Number(body.crsId);
  }

  // An admin who deactivates their own account cannot undo it.
  if (patch.active === false && g.id === g.session!.userId) {
    return NextResponse.json({ error: 'You cannot deactivate your own account.' }, { status: 400 });
  }

  const { data, error } = await db
    .from('users')
    .update(patch)
    .eq('id', g.id)
    .select(SAFE_COLUMNS)
    .maybeSingle();

  if (error || !data) {
    console.error('[api/users/:id] update failed:', error?.code, error?.message);
    return NextResponse.json({ error: 'Could not update the user.' }, { status: error ? 500 : 404 });
  }

  if (body.password !== undefined) {
    const password = String(body.password).trim();
    if (password.length < 6) {
      return NextResponse.json({ error: 'Password must be at least 6 characters.' }, { status: 400 });
    }
    const { error: pwError } = await db.rpc('set_user_password', {
      p_user_id: g.id,
      p_password: password,
    });
    if (pwError) {
      console.error('[api/users/:id] password set failed:', pwError.code, pwError.message);
      return NextResponse.json({ error: 'Could not set the password.' }, { status: 500 });
    }
  }

  return NextResponse.json({ ok: true, user: toEngineUser(data) });
}

export async function DELETE(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  const g = await guard(ctx.params);
  if (g.error) return g.error;

  if (g.id === g.session!.userId) {
    return NextResponse.json({ error: 'You cannot delete your own account.' }, { status: 400 });
  }

  const db = supabaseAdmin();
  const { count } = await db
    .from('users')
    .select('id', { count: 'exact', head: true })
    .eq('role', 'ADMIN')
    .eq('active', true);

  const { data: target } = await db.from('users').select('role').eq('id', g.id).maybeSingle();
  if (target?.role === 'ADMIN' && (count ?? 0) <= 1) {
    return NextResponse.json({ error: 'This is the last administrator — it cannot be deleted.' }, { status: 400 });
  }

  const { error } = await db.from('users').delete().eq('id', g.id);
  if (error) {
    console.error('[api/users/:id] delete failed:', error.code, error.message);
    return NextResponse.json({ error: 'Could not delete the user.' }, { status: 500 });
  }

  return NextResponse.json({ ok: true });
}
