/**
 * What the /api/pv-uploads routes share: who is asking, this month in India,
 * and how a failure is answered. Route handlers only (supabaseAdmin).
 */
import { NextResponse } from 'next/server';
import { cookies } from 'next/headers';
import { supabaseAdmin } from '@/lib/supabaseAdmin';
import { SESSION_COOKIE, decodeSession, type Session } from '@/lib/session';
import { MissingTableError, type Actor } from './server';

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

/** This month in India, where the shops are. */
export function todayIst(): { year: number; month: number } {
  const p = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Kolkata', year: 'numeric', month: 'numeric' }).formatToParts(new Date());
  return { year: Number(p.find((x) => x.type === 'year')!.value), month: Number(p.find((x) => x.type === 'month')!.value) };
}

export function failure(e: unknown) {
  if (e instanceof MissingTableError) return NextResponse.json({ error: e.message }, { status: 503 });
  console.error('[api/pv-uploads]', e);
  return NextResponse.json({ error: 'The PDF could not be saved to the database. Nothing was changed — please try again.' }, { status: 500 });
}

