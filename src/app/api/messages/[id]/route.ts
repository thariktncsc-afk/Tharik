/**
 * The read report for one message: every recipient, and exactly when their
 * copy was delivered, opened, read and acknowledged. Administrators only.
 */
import { NextResponse } from 'next/server';
import { cookies } from 'next/headers';
import { supabaseConfigured } from '@/lib/supabaseAdmin';
import { SESSION_COOKIE, decodeSession } from '@/lib/session';
import { readStats } from '@/lib/notify/core';
import { messageRecipients, MIGRATION_HINT, tablesMissing } from '@/lib/notify/server';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  if (!supabaseConfigured()) return NextResponse.json({ error: 'Supabase is not configured on the server.' }, { status: 503 });
  const s = decodeSession((await cookies()).get(SESSION_COOKIE)?.value);
  if (!s) return NextResponse.json({ error: 'Not signed in.' }, { status: 401 });
  if (s.role !== 'ADMIN') return NextResponse.json({ error: 'Only an administrator can see who read a message.' }, { status: 403 });

  const id = Number((await ctx.params).id);
  if (!Number.isInteger(id) || id <= 0) return NextResponse.json({ error: 'Unknown message.' }, { status: 400 });

  try {
    const recipients = await messageRecipients(id);
    if (!recipients) return NextResponse.json({ error: 'Unknown message.' }, { status: 404 });
    return NextResponse.json({ recipients, stats: readStats(recipients) });
  } catch (e) {
    if (tablesMissing(e as { code?: string })) return NextResponse.json({ error: MIGRATION_HINT }, { status: 503 });
    console.error('[api/messages/:id] failed:', e);
    return NextResponse.json({ error: 'Could not read the report.' }, { status: 500 });
  }
}
