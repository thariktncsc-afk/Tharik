/**
 * The Manual 3-Month PV's saved statement PDFs (lib/pvUploads) — the files in
 * a private Storage bucket, the details in crs_state (storageStore.ts); no
 * migration to run.
 *
 * GET    ?crs=20&months=2026-7,2026-8,2026-9          the months' saved files (names, sizes, when, who)
 * POST   ?crs=20&year=2026&month=9&mode=replace|add&name=…   body: the PDF itself
 * DELETE ?crs=20&year=2026&month=9                     remove the month's files
 *
 * A shop user reaches their own shop only; an administrator any shop. The
 * answer to a POST is the month as it is now SAVED — the screen shows that,
 * never what it sent.
 */
import { NextResponse, after } from 'next/server';
import { supabaseConfigured } from '@/lib/supabaseAdmin';
import { recordActivity } from '@/lib/activityLog/server';
import { MAX_PDF_BYTES, parseMonths } from '@/lib/pvUploads/core';
import { activitySummary, listUploads, removeMonth, saveUpload } from '@/lib/pvUploads/server';
import { actorOf, failure, todayIst } from '@/lib/pvUploads/routeKit';
import { storagePvStore } from '@/lib/pvUploads/storageStore';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(req: Request) {
  if (!supabaseConfigured()) return NextResponse.json({ error: 'Supabase is not configured on the server.' }, { status: 503 });
  const u = new URL(req.url);
  try {
    const { actor } = await actorOf();
    const a = await listUploads(storagePvStore(), actor, Number(u.searchParams.get('crs')), parseMonths(u.searchParams.get('months')));
    return NextResponse.json(a.body, { status: a.status, headers: { 'Cache-Control': 'no-store' } });
  } catch (e) {
    return failure(e, 'list');
  }
}

export async function POST(req: Request) {
  if (!supabaseConfigured()) return NextResponse.json({ error: 'Supabase is not configured on the server.' }, { status: 503 });
  const u = new URL(req.url);
  const crsId = Number(u.searchParams.get('crs'));
  const year = Number(u.searchParams.get('year'));
  const month = Number(u.searchParams.get('month'));
  const mode = u.searchParams.get('mode') === 'replace' ? 'replace' : u.searchParams.get('mode') === 'add' ? 'add' : ('' as never);
  const name = u.searchParams.get('name') ?? '';
  try {
    const { session, actor } = await actorOf();
    const len = Number(req.headers.get('content-length') ?? 0);
    if (len > MAX_PDF_BYTES) return NextResponse.json({ error: `${name} is larger than the ${MAX_PDF_BYTES / 1048576} MB a PDF may be.` }, { status: 413 });
    const bytes = new Uint8Array(await req.arrayBuffer());
    const a = await saveUpload(storagePvStore(), actor, { crsId, year, month, name, mode, bytes }, todayIst());
    if (a.saved && !a.saved.duplicate) {
      const kind = a.saved.removed.length ? 'replaced' : 'saved';
      after(() =>
        recordActivity(session, [
          {
            crsId,
            module: 'Reports',
            action: kind === 'replaced' ? 'updated' : 'created',
            source: 'user',
            entryMonth: month,
            entryYear: year,
            recordKey: `pv-upload:${crsId}_${month}_${year}`,
            summary: activitySummary(kind, crsId, year, month, [a.saved!.row.file_name]),
            changes: a.saved!.removed.length ? [{ label: 'PDF', before: a.saved!.removed.map((r) => r.file_name).join(', '), after: a.saved!.row.file_name }] : [],
          },
        ]),
      );
    }
    return NextResponse.json(a.body, { status: a.status });
  } catch (e) {
    return failure(e, 'save');
  }
}

export async function DELETE(req: Request) {
  if (!supabaseConfigured()) return NextResponse.json({ error: 'Supabase is not configured on the server.' }, { status: 503 });
  const u = new URL(req.url);
  const crsId = Number(u.searchParams.get('crs'));
  const year = Number(u.searchParams.get('year'));
  const month = Number(u.searchParams.get('month'));
  try {
    const { session, actor } = await actorOf();
    const a = await removeMonth(storagePvStore(), actor, crsId, year, month);
    if (a.removed?.length) {
      after(() =>
        recordActivity(session, [
          {
            crsId,
            module: 'Reports',
            action: 'deleted',
            source: 'user',
            entryMonth: month,
            entryYear: year,
            recordKey: `pv-upload:${crsId}_${month}_${year}`,
            summary: activitySummary('removed', crsId, year, month, a.removed!.map((r) => r.file_name)),
          },
        ]),
      );
    }
    return NextResponse.json(a.body, { status: a.status });
  } catch (e) {
    return failure(e, 'remove');
  }
}
