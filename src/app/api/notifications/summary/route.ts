/**
 * What the bell polls: the unread count, when the newest arrived, and any
 * important or urgent message still waiting to be acknowledged.
 *
 * The one thing a poll records is DELIVERY — this person's screen has now
 * received what is waiting for them. It never records a read.
 *
 * An administrator's first ask also announces any request that is waiting but
 * was never notified (notify/approvals.ts backfillPendingApprovals) — only once
 * the tables are known to exist, so a run before 0005 cannot mark the backfill
 * done with nothing to write into.
 *
 * Before 0005_notifications.sql is run this answers `installed: false` with an
 * empty inbox rather than an error, so the bell stays quiet and every page
 * carries on working.
 */
import { NextResponse } from 'next/server';
import { cookies } from 'next/headers';
import { supabaseConfigured } from '@/lib/supabaseAdmin';
import { SESSION_COOKIE, decodeSession } from '@/lib/session';
import { summaryForUser, tablesMissing } from '@/lib/notify/server';
import { backfillPendingApprovals } from '@/lib/notify/approvals';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET() {
  if (!supabaseConfigured()) return NextResponse.json({ error: 'Supabase is not configured on the server.' }, { status: 503 });
  const s = decodeSession((await cookies()).get(SESSION_COOKIE)?.value);
  if (!s || !Number.isInteger(s.userId)) return NextResponse.json({ error: 'Not signed in.' }, { status: 401 });

  try {
    let summary = await summaryForUser(s.userId);
    if (s.role === 'ADMIN' && (await backfillPendingApprovals()) > 0) summary = await summaryForUser(s.userId);
    return NextResponse.json({ installed: true, ...summary });
  } catch (e) {
    if (tablesMissing(e as { code?: string })) {
      return NextResponse.json({ installed: false, unread: 0, latestAt: null, popups: [] });
    }
    console.error('[api/notifications/summary] failed:', e);
    return NextResponse.json({ error: 'Could not read notifications.' }, { status: 500 });
  }
}
