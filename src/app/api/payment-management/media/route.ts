/**
 * The office's UPI QR image and the reminder sounds — administrators only.
 *
 * POST  ?kind=qr|sound&name=…   body: the file itself (≤ 4 MB) → { media }
 *       What it is comes from its own bytes, never the name or the browser's
 *       type; a QR upload replaces the previous QR.
 * PATCH { activeSoundId }       which sound the shops hear (null = a beep) → { media }
 *
 * GET / DELETE of one file: media/[assetId].
 */
import { NextResponse } from 'next/server';
import { MAX_MEDIA_BYTES } from '@/lib/paymentMgmt/core';
import { setActiveSound, uploadMedia } from '@/lib/paymentMgmt/server';
import { actorOf, bodyOf, depsFor, failure, notConfigured, send, store } from '@/lib/paymentMgmt/routeKit';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function POST(req: Request) {
  const nc = notConfigured();
  if (nc) return nc;
  const u = new URL(req.url);
  try {
    const { session, actor } = await actorOf();
    // Refused before the body is read when it says it is too big (Vercel's limit is 4.5 MB).
    if (actor?.role === 'ADMIN' && Number(req.headers.get('content-length') ?? 0) > MAX_MEDIA_BYTES) {
      return NextResponse.json({ error: `The file is larger than the ${MAX_MEDIA_BYTES / 1048576} MB a file may be.` }, { status: 413 });
    }
    const bytes = actor?.role === 'ADMIN' ? new Uint8Array(await req.arrayBuffer()) : new Uint8Array(0);
    return send(await uploadMedia(store(), depsFor(session), actor, { kind: u.searchParams.get('kind'), name: u.searchParams.get('name') ?? '', bytes }));
  } catch (e) {
    return failure(e, 'upload');
  }
}

export async function PATCH(req: Request) {
  const nc = notConfigured();
  if (nc) return nc;
  try {
    const { session, actor } = await actorOf();
    return send(await setActiveSound(store(), depsFor(session), actor, await bodyOf(req)));
  } catch (e) {
    return failure(e, 'save');
  }
}
