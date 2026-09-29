/**
 * POST /api/ocr — read ONE photo for Monthly Entry's Card Details or Allotment
 * upload (office, 2026-09-29). Body: { kind: 'cards' | 'allot', image:
 * { mediaType, data (base64) } }. Answers { transcript } — labels and figures
 * as printed; the browser maps them to fields (engine/photoExtract.ts) and
 * shows them as a draft until Save. Nothing is written anywhere.
 *
 * Signed-in users only (the photo costs a model call). One photo per request
 * keeps each body far under Vercel's 4.5 MB limit; the browser scales photos
 * to ≤ 2000 px before sending.
 */
import { NextResponse } from 'next/server';
import { cookies } from 'next/headers';
import { SESSION_COOKIE, decodeSession } from '@/lib/session';
import { OCR_KINDS, OCR_MAX_BASE64, OCR_MEDIA_TYPES, readPhoto, type OcrKind } from '@/lib/ocr/server';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 60;

export async function POST(req: Request) {
  const session = decodeSession((await cookies()).get(SESSION_COOKIE)?.value);
  if (!session) return NextResponse.json({ error: 'Not signed in.' }, { status: 401 });

  const body = (await req.json().catch(() => null)) as { kind?: unknown; image?: { mediaType?: unknown; data?: unknown } } | null;
  const kind = body?.kind as OcrKind;
  const mediaType = String(body?.image?.mediaType ?? '');
  const data = String(body?.image?.data ?? '');
  if (!OCR_KINDS.includes(kind)) return NextResponse.json({ error: 'Unknown kind of photo.' }, { status: 400 });
  if (!(OCR_MEDIA_TYPES as readonly string[]).includes(mediaType) || !data || !/^[A-Za-z0-9+/=]+$/.test(data)) {
    return NextResponse.json({ error: 'Send a JPG, PNG or WebP photo.' }, { status: 400 });
  }
  if (data.length > OCR_MAX_BASE64) return NextResponse.json({ error: 'That photo is too large. Try a smaller one.' }, { status: 413 });

  const out = await readPhoto(kind, { mediaType, data });
  if (!out.ok) return NextResponse.json({ error: out.error }, { status: out.status });
  return NextResponse.json({ transcript: out.transcript });
}
