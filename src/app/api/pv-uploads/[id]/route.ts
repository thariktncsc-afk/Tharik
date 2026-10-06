/**
 * GET /api/pv-uploads/<id> — one saved 3-Month PV PDF, for the shop it
 * belongs to (or an administrator). The Manual PV reads its months from these
 * every time it opens and again before it generates, so a replaced PDF is
 * what the next PV is built from.
 */
import { NextResponse } from 'next/server';
import { supabaseConfigured } from '@/lib/supabaseAdmin';
import { fileBytes } from '@/lib/pvUploads/server';
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
