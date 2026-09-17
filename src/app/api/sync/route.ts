/**
 * The live-sync heartbeat: WHAT has changed, never the data itself.
 *
 * Every signed-in screen asks this every few seconds while it is visible
 * (dataStore.ts). The answer is the version of every crs_state row — a few
 * dozen integers — so a screen can tell which stores somebody else has written
 * since it read them, and fetch only those from /api/state. A store nobody
 * touched costs its number and nothing more, and a screen with unsaved typing
 * keeps it: the data layer lays that typing over what it fetches.
 *
 * WHY NOT SUPABASE REALTIME. The same reason as notifications
 * (notify/client.ts): RLS is on with no permissive policy, because the app has
 * its own login and there is no auth.uid(). A browser subscribed with the
 * public key would receive nothing, and making it receive would mean exposing
 * every shop's figures to that key — and breaking the rule that the browser
 * never talks to Supabase. This route runs under the session like every other.
 *
 * `clears` is the version of the clear-request record. /api/state never serves
 * that row (it holds other shops' reasons), so a change here is only the cue
 * for a waiting screen to re-ask /api/clear-requests, which scopes the answer.
 *
 * `payments` is sent only when a screen showing orders asks for it: a
 * fingerprint of the orders the caller may see — every order for an
 * administrator, the shop's own otherwise — so a UTR or a decision shows up on
 * the other side without anyone refreshing.
 */
import { NextResponse } from 'next/server';
import { cookies } from 'next/headers';
import { supabaseAdmin, supabaseConfigured } from '@/lib/supabaseAdmin';
import { SESSION_COOKIE, decodeSession, type Session } from '@/lib/session';
import { CLEAR_STORE_KEY } from '@/lib/clearStore';
import { latestActivityId } from '@/lib/activityLog/server';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const NO_STORE = { 'Cache-Control': 'no-store' };

/** Any new order, UTR or decision the caller can see changes this string. */
async function paymentsFingerprint(session: Session): Promise<string> {
  let q = supabaseAdmin()
    .from('payment_orders')
    .select('id, status, submitted_at, decided_at')
    .order('id', { ascending: false })
    .limit(300);
  if (session.role !== 'ADMIN') q = q.eq('crs_id', Number(session.crsId) || -1);
  const { data, error } = await q;
  if (error) return 'unavailable';
  const text = (data ?? []).map((r) => `${r.id}:${r.status}:${r.submitted_at ?? ''}:${r.decided_at ?? ''}`).join('|');
  let h = 5381;
  for (let i = 0; i < text.length; i++) h = ((h << 5) + h + text.charCodeAt(i)) | 0;
  return `${(data ?? []).length}:${(h >>> 0).toString(36)}`;
}

export async function GET(req: Request) {
  if (!supabaseConfigured()) return NextResponse.json({ error: 'Supabase is not configured on the server.' }, { status: 503 });
  const jar = await cookies();
  const session = decodeSession(jar.get(SESSION_COOKIE)?.value);
  if (!session) return NextResponse.json({ error: 'Not signed in.' }, { status: 401 });

  const { data, error } = await supabaseAdmin().from('crs_state').select('store_key, version').eq('scope', 'global');
  if (error) return NextResponse.json({ error: 'Could not read versions.' }, { status: 500 });

  const versions: Record<string, number> = {};
  let clears = 0;
  for (const row of data ?? []) {
    const v = Number(row.version) || 0;
    if (row.store_key === CLEAR_STORE_KEY) clears = v;
    else versions[row.store_key as string] = v;
  }

  const topics = (new URL(req.url).searchParams.get('topics') ?? '').split(',');
  const body: { versions: Record<string, number>; clears: number; payments?: string; activity?: string } = { versions, clears };
  if (topics.includes('payments')) body.payments = await paymentsFingerprint(session);
  // The newest activity-log row the caller may see: every shop's for an
  // administrator, the shop's own otherwise (activityLog/server.ts).
  if (topics.includes('activity')) body.activity = await latestActivityId(session.role === 'ADMIN' ? null : Number(session.crsId) || -1);

  return NextResponse.json(body, { headers: NO_STORE });
}
