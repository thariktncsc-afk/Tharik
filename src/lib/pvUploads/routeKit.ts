/**
 * What the /api/pv-uploads routes share: who is asking, this month in India,
 * and how a failure is answered. Route handlers only (supabaseAdmin).
 */
import { NextResponse } from 'next/server';
import { cookies } from 'next/headers';
import { supabaseAdmin } from '@/lib/supabaseAdmin';
import { SESSION_COOKIE, decodeSession, type Session } from '@/lib/session';
import type { Actor } from './server';

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

/** What the person is told when the database or storage fails — never its internals. */
const PLAIN = {
  list: 'Unable to read the saved PDFs. Please try again.',
  save: 'Unable to save the PDF. Please try again.',
  remove: 'Unable to remove the PDF. Please try again.',
  file: 'Unable to open the saved PDF. Please try again.',
} as const;

/**
 * A failure: the technical detail goes to the server log (Vercel → Logs) for
 * whoever maintains the system; the person gets a plain sentence.
 */
export function failure(e: unknown, what: keyof typeof PLAIN) {
  console.error(`[api/pv-uploads] ${what} failed:`, e instanceof Error ? e.message : e);
  return NextResponse.json({ error: PLAIN[what] }, { status: 500 });
}

