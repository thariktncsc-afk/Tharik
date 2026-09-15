/**
 * Open, read or acknowledge ONE of the signed-in person's notifications.
 *
 * PATCH { action: 'open' | 'read' | 'acknowledge' }
 *
 * The update is written against (this notification, this session's user), so
 * a notification id belonging to someone else simply matches nothing and
 * answers 404 — the same as an id that does not exist, which also avoids
 * confirming to a curious user that it does.
 */
import { NextResponse } from 'next/server';
import { cookies } from 'next/headers';
import { supabaseConfigured } from '@/lib/supabaseAdmin';
import { SESSION_COOKIE, decodeSession } from '@/lib/session';
import { markForUser, MIGRATION_HINT, tablesMissing } from '@/lib/notify/server';
import type { MarkAction } from '@/lib/notify/core';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const ACTIONS = new Set<MarkAction>(['open', 'read', 'acknowledge']);

export async function PATCH(req: Request, ctx: { params: Promise<{ id: string }> }) {
  if (!supabaseConfigured()) return NextResponse.json({ error: 'Supabase is not configured on the server.' }, { status: 503 });
  const s = decodeSession((await cookies()).get(SESSION_COOKIE)?.value);
  if (!s || !Number.isInteger(s.userId)) return NextResponse.json({ error: 'Not signed in.' }, { status: 401 });

  const id = Number((await ctx.params).id);
  if (!Number.isInteger(id) || id <= 0) return NextResponse.json({ error: 'Unknown notification.' }, { status: 400 });

  const body = (await req.json().catch(() => ({}))) as { action?: string };
  const action = String(body.action ?? '') as MarkAction;
  if (!ACTIONS.has(action)) return NextResponse.json({ error: 'Unknown action.' }, { status: 400 });

  try {
    const item = await markForUser(s.userId, id, action);
    if (!item) return NextResponse.json({ error: 'Unknown notification.' }, { status: 404 });
    return NextResponse.json({ item });
  } catch (e) {
    if (tablesMissing(e as { code?: string })) return NextResponse.json({ error: MIGRATION_HINT }, { status: 503 });
    console.error('[api/notifications/:id] mark failed:', e);
    return NextResponse.json({ error: 'Could not update the notification.' }, { status: 500 });
  }
}
