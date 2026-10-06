/**
 * GET /api/pv-uploads/<id> — one saved 3-Month PV PDF (DELETE removes it, below), for the shop it
 * belongs to (or an administrator). The Manual PV reads its months from these
 * every time it opens and again before it generates, so a replaced PDF is
 * what the next PV is built from.
 */
import { NextResponse, after } from 'next/server';
import { supabaseConfigured } from '@/lib/supabaseAdmin';
import { recordActivity } from '@/lib/activityLog/server';
import { activitySummary, fileBytes, removeFile } from '@/lib/pvUploads/server';
import { actorOf, failure } from '@/lib/pvUploads/routeKit';
import { storagePvStore } from '@/lib/pvUploads/storageStore';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  if (!supabaseConfigured()) return NextResponse.json({ error: 'Supabase is not configured on the server.' }, { status: 503 });
  try {
    const { id } = await ctx.params;
    const { actor } = await actorOf();
    const f = await fileBytes(storagePvStore(), actor, Number(id));
    if (f.status !== 200) return NextResponse.json({ error: f.error }, { status: f.status });
    return new NextResponse(Buffer.from(f.bytes!), {
      status: 200,
      headers: {
        'Content-Type': 'application/pdf',
        'Content-Disposition': `inline; filename*=UTF-8''${encodeURIComponent(f.name!)}`,
        'Cache-Control': 'no-store',
      },
    });
  } catch (e) {
    return failure(e, 'file');
  }
}

/**
 * DELETE /api/pv-uploads/<id> — remove that one PDF; the month's other PDFs
 * stay (office, 2026-10-06). The shop it belongs to, or an administrator.
 */
export async function DELETE(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  if (!supabaseConfigured()) return NextResponse.json({ error: 'Supabase is not configured on the server.' }, { status: 503 });
  try {
    const { id } = await ctx.params;
    const { session, actor } = await actorOf();
    const a = await removeFile(storagePvStore(), actor, Number(id));
    const r = a.removed?.[0];
    if (r) {
      after(() =>
        recordActivity(session, [
          {
            crsId: r.crs_id,
            module: 'Reports',
            action: 'deleted',
            source: 'user',
            entryMonth: r.month,
            entryYear: r.year,
            recordKey: `pv-upload:${r.crs_id}_${r.month}_${r.year}`,
            summary: activitySummary('removed', r.crs_id, r.year, r.month, [r.file_name]),
          },
        ]),
      );
    }
    return NextResponse.json(a.body, { status: a.status });
  } catch (e) {
    return failure(e, 'remove');
  }
}
