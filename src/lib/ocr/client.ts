/**
 * Browser side of photo reading (office, 2026-09-29): scale a picked photo
 * down and send it to /api/ocr. A phone photo is 3–12 MB; the reader needs
 * nothing like that, and Vercel refuses a request body over 4.5 MB, so every
 * photo goes as a JPEG no longer than 2000 px on its long side.
 */
import type { AllotTranscript, CardTranscript } from '@/lib/engine/photoExtract';

export const MAX_SIDE = 2000;

export async function preparePhoto(file: File): Promise<{ mediaType: 'image/jpeg'; data: string }> {
  const url = URL.createObjectURL(file);
  try {
    const img = new Image();
    img.src = url;
    await img.decode().catch(() => {
      throw new Error('This file is not a photo the browser can open. Use a JPG or PNG.');
    });
    const k = Math.min(1, MAX_SIDE / Math.max(img.naturalWidth, img.naturalHeight));
    const canvas = document.createElement('canvas');
    canvas.width = Math.max(1, Math.round(img.naturalWidth * k));
    canvas.height = Math.max(1, Math.round(img.naturalHeight * k));
    const g = canvas.getContext('2d');
    if (!g) throw new Error('This browser cannot prepare the photo.');
    g.fillStyle = '#fff';
    g.fillRect(0, 0, canvas.width, canvas.height);
    g.drawImage(img, 0, 0, canvas.width, canvas.height);
    const dataUrl = canvas.toDataURL('image/jpeg', 0.88);
    return { mediaType: 'image/jpeg', data: dataUrl.slice(dataUrl.indexOf(',') + 1) };
  } finally {
    URL.revokeObjectURL(url);
  }
}

export async function readPhotoRemote(kind: 'cards' | 'allot', file: File): Promise<CardTranscript | AllotTranscript> {
  const image = await preparePhoto(file);
  let r: Response;
  try {
    r = await fetch('/api/ocr', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ kind, image }) });
  } catch {
    throw new Error('Could not reach the server. Check the connection and try again.');
  }
  const body = await r.json().catch(() => null);
  if (!r.ok || !body?.transcript) throw new Error(body?.error || `The server answered ${r.status}.`);
  return body.transcript;
}
