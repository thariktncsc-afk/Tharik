'use client';

/**
 * The browser's side of /api/pv-uploads: what is saved, save one PDF, read a
 * saved PDF back into pages, remove a month. Every answer is the server's —
 * the Manual PV shows what is SAVED, never what it sent.
 */
import { monthKey, type SavedPvFile, type SavedPvMonth, type UploadMode } from './core';
import type { TextItem } from '@/lib/engine/pvPdfParse';

export type PdfPage = { file: string; items: TextItem[] };

async function answer<T>(res: Response, what: string): Promise<T> {
  const body = (await res.json().catch(() => ({}))) as { error?: string };
  if (!res.ok) throw new Error(body?.error || `${what} failed (${res.status}).`);
  return body as T;
}

/** The saved files of these months of one shop, keyed `2026-9`. */
export async function fetchSavedMonths(crsId: number, months: { year: number; month: number }[]): Promise<Record<string, SavedPvMonth>> {
  const q = months.map((m) => monthKey(m.year, m.month)).join(',');
  const res = await fetch(`/api/pv-uploads?crs=${crsId}&months=${encodeURIComponent(q)}`, { cache: 'no-store', headers: { Accept: 'application/json' } });
  const b = await answer<{ months: Record<string, SavedPvMonth> }>(res, 'Reading the saved PDFs');
  return b.months ?? {};
}

/**
 * Save one PDF for a shop's month. Resolves only once it is in the database.
 * `add` joins the month's others; `replace` with `replaceId` takes that one
 * file's place and nothing else's.
 */
export async function savePdf(
  crsId: number,
  year: number,
  month: number,
  file: File,
  mode: UploadMode,
  replaceId?: number,
): Promise<{ month: SavedPvMonth; duplicate: boolean; file: { id: number; name: string } }> {
  const q = new URLSearchParams({ crs: String(crsId), year: String(year), month: String(month), mode, name: file.name });
  if (mode === 'replace' && replaceId) q.set('replace', String(replaceId));
  const res = await fetch(`/api/pv-uploads?${q}`, { method: 'POST', headers: { 'Content-Type': 'application/pdf' }, body: file });
  const b = await answer<{ month: SavedPvMonth; duplicate: boolean; file: { id: number; name: string } }>(res, `Saving ${file.name}`);
  return { month: b.month, duplicate: !!b.duplicate, file: b.file };
}

/** Remove ONE saved PDF; the month's others stay. */
export async function removeSavedFile(f: SavedPvFile): Promise<void> {
  const res = await fetch(`/api/pv-uploads/${f.id}`, { method: 'DELETE' });
  await answer(res, `Removing ${f.name}`);
}

/** Remove every saved PDF of a shop's month. */
export async function removeSavedMonth(crsId: number, year: number, month: number): Promise<void> {
  const res = await fetch(`/api/pv-uploads?crs=${crsId}&year=${year}&month=${month}`, { method: 'DELETE' });
  await answer(res, 'Removing the PDFs');
}

/** A saved PDF, fetched from the server and read into pages. */
export async function savedFilePages(f: SavedPvFile): Promise<PdfPage[]> {
  const res = await fetch(`/api/pv-uploads/${f.id}`, { cache: 'no-store' });
  if (!res.ok) await answer(res, `Reading the saved ${f.name}`);
  const blob = await res.blob();
  const { pdfPages } = await import('@/lib/engine/pvPdfLoad');
  return pdfPages(new File([blob], f.name, { type: 'application/pdf' }));
}
