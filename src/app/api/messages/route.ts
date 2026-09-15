/**
 * Administrator messages and announcements.
 *
 * GET  — messages sent, newest first, each with its read report summary.
 * POST — { title, message, priority, audience } send one.
 *
 * Administrators only, checked here on the session — the Messages page being
 * hidden from shop staff is not what stops a shop user posting to this.
 * Recipients are resolved on the server from the users table (core.ts
 * resolveAudience), never taken as a list from the request, so a hand-built
 * request can only address the people the form itself could have chosen.
 */
import { NextResponse } from 'next/server';
import { cookies } from 'next/headers';
import { supabaseConfigured } from '@/lib/supabaseAdmin';
import { SESSION_COOKIE, decodeSession } from '@/lib/session';
import { MESSAGE_MAX, parseAudience, parsePriority, TITLE_MAX } from '@/lib/notify/core';
import { MIGRATION_HINT, personFor, sendMessage, sentMessages, tablesMissing } from '@/lib/notify/server';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

async function admin() {
  const s = decodeSession((await cookies()).get(SESSION_COOKIE)?.value);
  if (!s) return { error: NextResponse.json({ error: 'Not signed in.' }, { status: 401 }) };
  if (s.role !== 'ADMIN') return { error: NextResponse.json({ error: 'Only an administrator can send messages.' }, { status: 403 }) };
  return { s };
}

export async function GET() {
  if (!supabaseConfigured()) return NextResponse.json({ error: 'Supabase is not configured on the server.' }, { status: 503 });
  const g = await admin();
  if (g.error) return g.error;
  try {
    return NextResponse.json({ installed: true, messages: await sentMessages(100) });
  } catch (e) {
    if (tablesMissing(e as { code?: string })) return NextResponse.json({ installed: false, messages: [] });
    console.error('[api/messages] list failed:', e);
    return NextResponse.json({ error: 'Could not read sent messages.' }, { status: 500 });
  }
}

export async function POST(req: Request) {
  if (!supabaseConfigured()) return NextResponse.json({ error: 'Supabase is not configured on the server.' }, { status: 503 });
  const g = await admin();
  if (g.error) return g.error;
  const s = g.s!;

  const body = (await req.json().catch(() => ({}))) as Record<string, unknown>;
  const title = String(body.title ?? '').trim();
  const message = String(body.message ?? '').trim();
  if (!title) return NextResponse.json({ error: 'Give the message a title.' }, { status: 400 });
  if (title.length > TITLE_MAX) return NextResponse.json({ error: `Keep the title under ${TITLE_MAX} characters.` }, { status: 400 });
  if (!message) return NextResponse.json({ error: 'Write the message.' }, { status: 400 });
  if (message.length > MESSAGE_MAX) return NextResponse.json({ error: `The message is over ${MESSAGE_MAX} characters.` }, { status: 400 });

  const audience = parseAudience(body.audience);
  if ('error' in audience) return NextResponse.json({ error: audience.error }, { status: 400 });

  try {
    const sender = await personFor(s.userId, s.username, s.role, null);
    const sent = await sendMessage({ sender, title, message, priority: parsePriority(body.priority), audience });
    return NextResponse.json({ ok: true, ...sent });
  } catch (e) {
    const err = e as { code?: string; status?: number; message?: string };
    if (tablesMissing(err)) return NextResponse.json({ error: MIGRATION_HINT }, { status: 503 });
    if (err.status === 400) return NextResponse.json({ error: err.message }, { status: 400 });
    console.error('[api/messages] send failed:', e);
    return NextResponse.json({ error: 'The message could not be sent.' }, { status: 500 });
  }
}
