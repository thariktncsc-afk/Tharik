/**
 * Forgot-password lookup. Pre-auth by nature (it lives on the sign-in
 * screen), so it is deliberately narrow: given a registered mobile number it
 * returns WHO the account is — username, role, shop — and never anything
 * secret. Passwords are bcrypt hashes reset only by an administrator from
 * the Users screen. This replaces the legacy show-the-password dialog,
 * whose own header demanded exactly this change before real credentials.
 */
import { NextResponse } from 'next/server';
import { supabaseAdmin, supabaseConfigured } from '@/lib/supabaseAdmin';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** Digits only, last 10 — "+91 98765 43210" and "9876543210" are one number. */
const digits = (v: unknown) => {
  const d = String(v ?? '').replace(/[^0-9]/g, '');
  return d.length > 10 ? d.slice(-10) : d;
};

export async function POST(req: Request) {
  if (!supabaseConfigured()) {
    return NextResponse.json({ error: 'Supabase is not configured on the server.' }, { status: 503 });
  }

  let body: { phone?: string };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: 'Malformed request.' }, { status: 400 });
  }

  const wanted = digits(body.phone);
  if (wanted.length !== 10) {
    return NextResponse.json({ error: 'Enter the 10-digit registered mobile number.' }, { status: 400 });
  }

  const { data, error } = await supabaseAdmin()
    .from('users')
    .select('full_name, username, role, crs_id, phone, active')
    .eq('active', true);

  if (error) {
    console.error('[api/forgot] lookup failed:', error.code, error.message);
    return NextResponse.json({ error: 'Could not look the number up.' }, { status: 500 });
  }

  const hit = (data ?? []).find((u) => digits(u.phone) === wanted);
  if (!hit) {
    return NextResponse.json({ error: 'No account found with this mobile number.' }, { status: 404 });
  }

  return NextResponse.json({
    ok: true,
    user: { fullName: hit.full_name, username: hit.username, role: hit.role, crsId: hit.crs_id },
  });
}
