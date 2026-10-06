/**
 * The Manual 3-Month PV's saved statement PDFs — the rules, with no I/O, so
 * the route (server.ts) and tools/verify-pv-uploads.mjs share them.
 *
 * A past month of the quarter is read from the office's own PDFs (CRS PAGE2,
 * GUNNY, CRS POLICE). They used to live only in the browser tab, so a new tab,
 * another computer or signing in again showed every month as never uploaded.
 * They are now saved per SHOP and MONTH (storageStore.ts: the files in a
 * private Storage bucket, the details in crs_state — no migration to run):
 *
 *   - a month's active set is every saved file for that (crs, year, month);
 *   - "Replace PDF" saves the new file and removes the month's others — one
 *     active set, never two;
 *   - the same file (sha256) twice in one month is kept once;
 *   - a shop user reaches only their own shop; an administrator any shop.
 */

export type PvUploadSession = { userId: number; role: string; crsId: number | null };

/** One saved file, as the screen sees it — never its bytes. */
export type SavedPvFile = {
  id: number;
  name: string;
  size: number;
  sha256: string;
  uploadedAt: string;
  uploadedBy: string;
};

/** A month's saved files, keyed `2026-9`. */
export type SavedPvMonth = { year: number; month: number; fy: string; files: SavedPvFile[] };

/** One saved file as the store holds it, without its bytes. */
export type PvUploadRow = {
  id: number;
  crs_id: number;
  year: number;
  month: number;
  fy: string;
  file_name: string;
  file_size: number;
  sha256: string;
  uploaded_at: string;
  uploaded_by_id: number | null;
  uploaded_by_name: string;
};

export type UploadMode = 'replace' | 'add';

/**
 * One file per request, sent as the raw PDF. A Vercel function takes at most
 * 4.5 MB of body; the office's statement PDFs run from 24 KB to 1 MB.
 */
export const MAX_PDF_BYTES = 4 * 1024 * 1024;

export const monthKey = (year: number, month: number) => `${year}-${month}`;

const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
export const monthText = (year: number, month: number) => `${MONTHS[month - 1] ?? month} ${year}`;

/** Financial year label, April to March: September 2026 → `2026-27`. */
export function fyText(year: number, month: number): string {
  const fy = month >= 4 ? year : year - 1;
  return `${fy}-${String((fy + 1) % 100).padStart(2, '0')}`;
}

export const isAdmin = (s: PvUploadSession) => s.role === 'ADMIN';

/** May this person see or change this shop's uploads? Their own shop, or any as an administrator. */
export function canReach(s: PvUploadSession | null, crsId: number): boolean {
  if (!s) return false;
  return isAdmin(s) || (s.crsId != null && Number(s.crsId) === Number(crsId));
}

/** A shop number the app has. */
export const validCrs = (crsId: number) => Number.isInteger(crsId) && crsId >= 1 && crsId <= 99;

/**
 * A month a PDF may be saved for: a real month, and not after the current one
 * (a statement for a month that has not happened cannot exist).
 */
export function monthProblem(year: number, month: number, today: { year: number; month: number }): string | null {
  if (!Number.isInteger(year) || year < 2000 || year > 2100 || !Number.isInteger(month) || month < 1 || month > 12) return 'Not a valid month.';
  if (year * 12 + month > today.year * 12 + today.month) return `${monthText(year, month)} has not happened yet.`;
  return null;
}

/** The file's own name, without any folder, as it will be shown. */
export function cleanName(name: string): string {
  return String(name ?? '').split(/[\\/]/).pop()!.replace(/[\u0000-\u001f]/g, '').trim().slice(0, 200);
}

/** Is this a PDF we can keep? Returns the reason it is not, or null. */
export function fileProblem(name: string, bytes: Uint8Array): string | null {
  const n = cleanName(name);
  if (!n) return 'The file has no name.';
  if (!/\.pdf$/i.test(n)) return `${n} is not a PDF. Please upload the statement as PDF.`;
  if (!bytes.length) return `${n} is empty.`;
  if (bytes.length > MAX_PDF_BYTES) return `${n} is ${(bytes.length / 1048576).toFixed(1)} MB — larger than the ${MAX_PDF_BYTES / 1048576} MB a PDF may be. Upload the sheets as separate PDFs.`;
  const head = String.fromCharCode(...bytes.subarray(0, 5));
  if (head !== '%PDF-') return `${n} is not a PDF file (it does not start like one). Please upload the correct PDF.`;
  return null;
}

/** Stored rows → the screen's months, each month's files oldest first. */
export function monthsFrom(rows: PvUploadRow[]): Record<string, SavedPvMonth> {
  const out: Record<string, SavedPvMonth> = {};
  const sorted = [...rows].sort((a, b) => (a.uploaded_at < b.uploaded_at ? -1 : a.uploaded_at > b.uploaded_at ? 1 : a.id - b.id));
  for (const r of sorted) {
    const k = monthKey(Number(r.year), Number(r.month));
    const m = (out[k] ??= { year: Number(r.year), month: Number(r.month), fy: r.fy, files: [] });
    m.files.push({ id: Number(r.id), name: r.file_name, size: Number(r.file_size), sha256: r.sha256, uploadedAt: r.uploaded_at, uploadedBy: r.uploaded_by_name ?? '' });
  }
  return out;
}

/** `?months=2026-7,2026-8,2026-9` → months, at most twelve, each valid. */
export function parseMonths(raw: string | null): { year: number; month: number }[] | null {
  const parts = String(raw ?? '').split(',').map((s) => s.trim()).filter(Boolean);
  if (!parts.length || parts.length > 12) return null;
  const out: { year: number; month: number }[] = [];
  for (const p of parts) {
    const m = /^(\d{4})-(\d{1,2})$/.exec(p);
    if (!m) return null;
    const year = Number(m[1]);
    const month = Number(m[2]);
    if (month < 1 || month > 12) return null;
    out.push({ year, month });
  }
  return out;
}
