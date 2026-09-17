/**
 * The signed-in person's own notifications.
 *
 * GET  ?category=payments|clear|approvals|messages|system &unread=1 &requests=1 &limit= &before=
 * POST { action: 'read-all', category?, requests? }
 *
 * There is no parameter that names a user. Whose notifications these are comes
 * from the session cookie and nowhere else, so no request can ask for someone
 * else's — see the scoping note in src/lib/notify/server.ts.
 */
import { NextResponse } from 'next/server';
import { cookies } from 'next/headers';
import { supabaseConfigured } from '@/lib/supabaseAdmin';
import { SESSION_COOKIE, decodeSession } from '@/lib/session';
import { listForUser, markAllForUser, tablesMissing } from '@/lib/notify/server';
import type { Category } from '@/lib/notify/core';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const CATEGORIES = new Set<Category>(['payments', 'clear', 'approvals', 'messages', 'system']);
const asCategory = (v: string | null | undefined): Category | null => (v && CATEGORIES.has(v as Category) ? (v as Category) : null);

async function me() {
  const s = decodeSession((await cookies()).get(SESSION_COOKIE)?.value);
  return s && Number.isInteger(s.userId) ? s : null;
}

export async function GET(req: Request) {
  if (!supabaseConfigured()) return NextResponse.json({ error: 'Supabase is not configured on the server.' }, { status: 503 });
  const s = await me();
  if (!s) return NextResponse.json({ error: 'Not signed in.' }, { status: 401 });

  const url = new URL(req.url);
  try {
    const items = await listForUser(s.userId, {
      category: asCategory(url.searchParams.get('category')),
      unreadOnly: url.searchParams.get('unread') === '1',
      requestsOnly: url.searchParams.get('requests') === '1',
      limit: Number(url.searchParams.get('limit')) || 30,
      before: url.searchParams.get('before'),
    });
    return NextResponse.json({ installed: true, items });
  } catch (e) {
    if (tablesMissing(e as { code?: string })) return NextResponse.json({ installed: false, items: [] });
    console.error('[api/notifications] list failed:', e);
    return NextResponse.json({ error: 'Could not read notifications.' }, { status: 500 });
  }
}

export async function POST(req: Request) {
  if (!supabaseConfigured()) return NextResponse.json({ error: 'Supabase is not configured on the server.' }, { status: 503 });
  const s = await me();
  if (!s) return NextResponse.json({ error: 'Not signed in.' }, { status: 401 });

  const body = (await req.json().catch(() => ({}))) as { action?: string; category?: string; requests?: boolean };
  if (body.action !== 'read-all') return NextResponse.json({ error: 'Unknown action.' }, { status: 400 });

  try {
    const marked = await markAllForUser(s.userId, asCategory(body.category), body.requests === true);
    return NextResponse.json({ marked });
  } catch (e) {
    if (tablesMissing(e as { code?: string })) return NextResponse.json({ marked: 0, installed: false });
    console.error('[api/notifications] read-all failed:', e);
    return NextResponse.json({ error: 'Could not mark notifications read.' }, { status: 500 });
  }
}
