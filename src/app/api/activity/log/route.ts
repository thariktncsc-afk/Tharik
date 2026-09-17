/**
 * The complete activity log — every shop, every person — for ADMINISTRATORS
 * ONLY. A shop user gets 403 here whatever the page does; its own shop's short
 * feed is /api/activity.
 *
 * GET ?from=YYYY-MM-DD&to=YYYY-MM-DD   India's days, inclusive
 *     &crsId=&userId=&module=&action=&source=user|system
 *     &before=<id>   the next page (older)
 *     &after=<id>    what arrived since the page loaded (live)
 *     &limit=        up to 300
 */
import { NextResponse } from 'next/server';
import { cookies } from 'next/headers';
import { supabaseConfigured } from '@/lib/supabaseAdmin';
import { SESSION_COOKIE, decodeSession } from '@/lib/session';
import { ACTIVITY_MIGRATION_HINT, readActivityLog } from '@/lib/activityLog/server';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(req: Request) {
  if (!supabaseConfigured()) return NextResponse.json({ error: 'Supabase is not configured on the server.' }, { status: 503 });
  const jar = await cookies();
  const s = decodeSession(jar.get(SESSION_COOKIE)?.value);
  if (!s) return NextResponse.json({ error: 'Not signed in.' }, { status: 401 });
  if (s.role !== 'ADMIN') return NextResponse.json({ error: 'The activity log is for administrators only.' }, { status: 403 });

  const p = new URL(req.url).searchParams;
  const int = (k: string) => {
    const n = Math.trunc(Number(p.get(k)));
    return Number.isFinite(n) && n > 0 ? n : undefined;
  };
  const text = (k: string) => (p.get(k) ?? '').trim() || undefined;

  try {
    const out = await readActivityLog({
      from: text('from'),
      to: text('to'),
      crsId: int('crsId'),
      userId: int('userId'),
      module: text('module'),
      action: text('action'),
      source: p.get('source') === 'user' || p.get('source') === 'system' ? (p.get('source') as 'user' | 'system') : undefined,
      before: int('before'),
      after: int('after'),
      limit: int('limit'),
    });
    return NextResponse.json(out.installed ? out : { ...out, hint: ACTIVITY_MIGRATION_HINT }, { headers: { 'Cache-Control': 'no-store' } });
  } catch (e) {
    console.error('[api/activity/log] read failed:', e instanceof Error ? e.message : e);
    return NextResponse.json({ error: 'Could not read the activity log.' }, { status: 500 });
  }
}
