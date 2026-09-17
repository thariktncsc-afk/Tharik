/**
 * The dashboard's Recent Activity, and the two actions the browser reports.
 *
 * GET — the short feed. From the activity log (migration 0006) when it is
 * installed; until then, derived from `crs_state_audit` exactly as before
 * (src/lib/activity.ts), so the panel never goes blank for want of a migration.
 *
 * THE SCOPING IS THE POINT AND IT HAPPENS HERE. An administrator sees every
 * shop; a shop user sees only entries touching its own shop, and the filtering
 * is applied in the query before the response is built. The full, filterable
 * all-shop log is /api/activity/log, administrators only.
 *
 * POST — an action that happens entirely in the browser and so cannot be seen
 * by any route: printing a statement already on screen, opening the DSS. Only
 * those, only for the caller's own shop unless an administrator, and logged as
 * reported by the browser.
 */
import { NextResponse } from 'next/server';
import { cookies } from 'next/headers';
import { supabaseAdmin, supabaseConfigured } from '@/lib/supabaseAdmin';
import { SESSION_COOKIE, decodeSession } from '@/lib/session';
import { deriveActivity, scopeToShop, type AuditRow } from '@/lib/activity';
import { documentDraft, type FeedItem } from '@/lib/activityLog/core';
import { recentFeed, recordActivity } from '@/lib/activityLog/server';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * How many audit rows the fallback reads. Each carries a whole store (~17 KB
 * average, and monthlyStore reaches 64 KB), so this is deliberately a small
 * window: it is the cost of attributing a change to a shop, and it never
 * leaves the server.
 */
const WINDOW = 60;

async function session() {
  const jar = await cookies();
  return decodeSession(jar.get(SESSION_COOKIE)?.value);
}

export async function GET(req: Request) {
  if (!supabaseConfigured()) return NextResponse.json({ error: 'Supabase is not configured on the server.' }, { status: 503 });
  const s = await session();
  if (!s) return NextResponse.json({ error: 'Not signed in.' }, { status: 401 });

  const limit = Math.min(Number(new URL(req.url).searchParams.get('limit')) || 12, 50);
  const isAdmin = s.role === 'ADMIN';
  const scope = isAdmin ? null : typeof s.crsId === 'number' ? s.crsId : -1;

  try {
    const logged = await recentFeed(scope, limit);
    if (logged.installed) return NextResponse.json({ items: logged.items, installed: true, scope: isAdmin ? 'all' : `crs${s.crsId}` });
  } catch (e) {
    console.error('[api/activity] log read failed:', e instanceof Error ? e.message : e);
  }

  // Fallback: 0006 not run yet.
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
  const items: FeedItem[] = scopeToShop(deriveActivity((data ?? []) as AuditRow[]), scope)
    .slice(0, limit)
    .map((i) => {
      const p = i.periods[0] ?? '';
      const month = /^(\d{1,2})_(\d{4})$/.exec(p);
      return {
        id: i.id,
        at: i.at,
        actorUsername: i.actor,
        actorName: i.actor,
        actorRole: '',
        source: 'user',
        crsId: i.crsIds.length === 1 ? i.crsIds[0] : null,
        shopName: '',
        module: i.module,
        action: i.removed && !i.added && !i.updated ? 'deleted' : i.added && !i.updated ? 'created' : 'updated',
        entryDate: /^\d{4}-\d{2}-\d{2}$/.test(p) ? p : null,
        entryMonth: month ? Number(month[1]) : null,
        entryYear: month ? Number(month[2]) : null,
        summary: '',
      };
    });
  return NextResponse.json({ items, installed: false, scope: isAdmin ? 'all' : `crs${s.crsId}` });
}

export async function POST(req: Request) {
  if (!supabaseConfigured()) return NextResponse.json({ error: 'Supabase is not configured on the server.' }, { status: 503 });
  const s = await session();
  if (!s) return NextResponse.json({ error: 'Not signed in.' }, { status: 401 });

  const body = (await req.json().catch(() => ({}))) as Record<string, unknown>;
  const module = body.module === 'DSS' ? 'DSS' : body.module === 'Statements' ? 'Statements' : null;
  const action = body.action === 'printed' || body.action === 'viewed' || body.action === 'exported' ? body.action : null;
  const crsId = Math.trunc(Number(body.crsId));
  const month = Math.trunc(Number(body.month));
  const year = Math.trunc(Number(body.year));
  if (!module || !action || !(crsId > 0) || !(month >= 1 && month <= 12) || !(year > 2000)) {
    return NextResponse.json({ error: 'Not an action this endpoint records.' }, { status: 400 });
  }
  if (s.role !== 'ADMIN' && s.crsId !== crsId) {
    return NextResponse.json({ error: 'You may only record actions for your own shop.' }, { status: 403 });
  }
  const sections = Array.isArray(body.sections) ? (body.sections as unknown[]).map(String).slice(0, 20) : [];
  await recordActivity(s, [documentDraft({ module, action, crsId, month, year, sections })]);
  return NextResponse.json({ ok: true });
}
