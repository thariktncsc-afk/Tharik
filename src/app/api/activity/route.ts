/**
 * Recent activity for the dashboard.
 *
 * Derived from `crs_state_audit` — see src/lib/activity.ts for why that rather
 * than a second log the app has to remember to write.
 *
 * THE SCOPING IS THE POINT AND IT HAPPENS HERE. An administrator sees every
 * shop; a shop user sees only entries touching its own shop, and the filtering
 * is applied before the response is built. Doing it in the browser would ship
 * every shop's movements to every user and call it a UI rule.
 */
import { NextResponse } from 'next/server';
import { cookies } from 'next/headers';
import { supabaseAdmin, supabaseConfigured } from '@/lib/supabaseAdmin';
import { SESSION_COOKIE, decodeSession } from '@/lib/session';
import { deriveActivity, scopeToShop, type AuditRow } from '@/lib/activity';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * How many audit rows to read. Each carries a whole store (~17 KB average, and
 * monthlyStore reaches 64 KB), so this is deliberately a small window: it is
 * the cost of attributing a change to a shop, and it never leaves the server.
 */
const WINDOW = 60;

export async function GET(req: Request) {
  if (!supabaseConfigured()) return NextResponse.json({ error: 'Supabase is not configured on the server.' }, { status: 503 });

  const jar = await cookies();
  const session = decodeSession(jar.get(SESSION_COOKIE)?.value);
  if (!session) return NextResponse.json({ error: 'Not signed in.' }, { status: 401 });

  const limit = Math.min(Number(new URL(req.url).searchParams.get('limit')) || 12, 50);

  const { data, error } = await supabaseAdmin()
    .from('crs_state_audit')
    .select('id, store_key, version, updated_at, updated_by, data')
    .eq('scope', 'global')
    .order('id', { ascending: false })
    .limit(WINDOW);

  if (error) {
    console.error('[api/activity] read failed:', error.code, error.message);
    return NextResponse.json({ error: 'Could not read the activity trail.' }, { status: 500 });
  }

  const isAdmin = session.role === 'ADMIN';
  const items = scopeToShop(
    deriveActivity((data ?? []) as AuditRow[]),
    isAdmin ? null : (typeof session.crsId === 'number' ? session.crsId : -1),
  ).slice(0, limit);

  return NextResponse.json({ items, scope: isAdmin ? 'all' : `crs${session.crsId}` });
}
