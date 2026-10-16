/**
 * One uploaded file of Payment Management.
 *
 * GET    the file's bytes: an administrator any file; a shop user only the
 *        current QR image and the active reminder sound (anything else 404).
 *        A file id never changes its content, so the browser may keep it.
 * DELETE the QR image, or a sound that is not the active one → { media }
 *        (administrators only).
 */
import { NextResponse } from 'next/server';
import { byteRange } from '@/lib/paymentMgmt/core';
import { mediaFile, removeMedia } from '@/lib/paymentMgmt/server';
import { actorOf, depsFor, failure, notConfigured, param, send, store } from '@/lib/paymentMgmt/routeKit';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(req: Request, ctx: { params: Promise<{ assetId: string }> }) {
  const nc = notConfigured();
  if (nc) return nc;
  try {
    const { assetId } = await ctx.params;
    const { session, actor } = await actorOf();
    const f = await mediaFile(store(), depsFor(session), actor, param(assetId));
    if (f.status !== 200) return NextResponse.json({ error: f.error }, { status: f.status, headers: { 'Cache-Control': 'no-store' } });
    const buf = Buffer.from(f.bytes!);
    const headers: Record<string, string> = {
      'Content-Type': f.mime!,
      'Content-Disposition': 'inline',
      'X-Content-Type-Options': 'nosniff',
      'Cache-Control': 'private, max-age=31536000, immutable',
      'Accept-Ranges': 'bytes',
    };
    // An iPhone's <audio> asks for byte ranges (bytes=0-1 first) and will not
    // play a sound served whole: answer the part asked for.
    const range = byteRange(req.headers.get('range'), buf.length);
    if (range === 'unsatisfiable') return new NextResponse(null, { status: 416, headers: { ...headers, 'Content-Range': `bytes */${buf.length}` } });
    if (range) {
      const [start, end] = range;
      return new NextResponse(buf.subarray(start, end + 1), {
        status: 206,
        headers: { ...headers, 'Content-Range': `bytes ${start}-${end}/${buf.length}`, 'Content-Length': String(end - start + 1) },
      });
    }
    return new NextResponse(buf, { status: 200, headers: { ...headers, 'Content-Length': String(buf.length) } });
  } catch (e) {
    return failure(e, 'file');
  }
}

export async function DELETE(_req: Request, ctx: { params: Promise<{ assetId: string }> }) {
  const nc = notConfigured();
  if (nc) return nc;
  try {
    const { assetId } = await ctx.params;
    const { session, actor } = await actorOf();
    return send(await removeMedia(store(), depsFor(session), actor, param(assetId)));
  } catch (e) {
    return failure(e, 'remove');
  }
}
