/**
 * The Manual 3-Month PV's saved PDFs — what /api/pv-uploads does, against a
 * small store interface so the same handlers run on Supabase (the route) and
 * on an in-memory store (tools/verify-pv-uploads.mjs and the browser test).
 *
 * The rules are core.ts's. Each handler answers `{ status, body }`; the route
 * turns that into a response.
 */
import { createHash } from 'node:crypto';
import {
  canReach,
  cleanName,
  fileProblem,
  fyText,
  monthProblem,
  monthsFrom,
  monthText,
  validCrs,
  type PvUploadRow,
  type PvUploadSession,
  type SavedPvMonth,
  type UploadMode,
} from './core';

export type PvUploadStore = {
  /** The saved files of these months of one shop, without their bytes. */
  list(crsId: number, months: { year: number; month: number }[]): Promise<PvUploadRow[]>;
  insert(row: Omit<PvUploadRow, 'id' | 'uploaded_at'> & { data_b64: string }): Promise<PvUploadRow>;
  /** Remove a month's files other than `keep`; returns the rows removed. */
  removeOthers(crsId: number, year: number, month: number, keep: number[]): Promise<PvUploadRow[]>;
  /** Remove exactly these files of a month (others untouched); returns the rows removed. */
  removeIds(crsId: number, year: number, month: number, ids: number[]): Promise<PvUploadRow[]>;
  /** One file's details, without its bytes. */
  find(id: number): Promise<PvUploadRow | null>;
  /** One file with its bytes. */
  get(id: number): Promise<(PvUploadRow & { data_b64: string }) | null>;
};

type Answer = { status: number; body: Record<string, unknown> };
const fail = (status: number, error: string): Answer => ({ status, body: { error } });

export type Actor = PvUploadSession & { name: string };

async function monthOf(store: PvUploadStore, crsId: number, year: number, month: number): Promise<SavedPvMonth | null> {
  const rows = await store.list(crsId, [{ year, month }]);
  return monthsFrom(rows)[`${year}-${month}`] ?? null;
}

/** GET — the saved files of these months, for one shop. */
export async function listUploads(store: PvUploadStore, s: Actor | null, crsId: number, months: { year: number; month: number }[] | null): Promise<Answer> {
  if (!s) return fail(401, 'Not signed in.');
  if (!validCrs(crsId)) return fail(400, 'Unknown CRS shop.');
  if (!months) return fail(400, 'Say which months.');
  if (!canReach(s, crsId)) return fail(403, `You can only see CRS ${s.crsId}'s uploads.`);
  const rows = await store.list(crsId, months);
  return { status: 200, body: { crsId, months: monthsFrom(rows) } };
}

/**
 * POST — save one PDF for a shop's month (office, 2026-10-06: a month holds
 * any number of PDFs, each saved on its own).
 *
 *   `add`     — the file joins the month's others; nothing is removed.
 *   `replace` — with `replaceId`, the new file takes THAT file's place: it is
 *               stored first, then that one file is removed (never before,
 *               so a failed save leaves the month as it was). The month's
 *               other files are untouched. Without `replaceId` nothing is
 *               removed (a tab from before this rule) — an upload never
 *               overwrites a file it does not name.
 *
 * A file already saved for the month (same sha256) is not stored twice; the
 * answer says which saved file it is.
 */
export async function saveUpload(
  store: PvUploadStore,
  s: Actor | null,
  req: { crsId: number; year: number; month: number; name: string; mode: UploadMode; bytes: Uint8Array; replaceId?: number | null },
  today: { year: number; month: number },
): Promise<Answer & { saved?: { row: PvUploadRow; removed: PvUploadRow[]; duplicate: boolean } }> {
  if (!s) return fail(401, 'Not signed in.');
  const { crsId, year, month, mode } = req;
  if (!validCrs(crsId)) return fail(400, 'Unknown CRS shop.');
  if (!canReach(s, crsId)) return fail(403, `You can only upload for CRS ${s.crsId}.`);
  if (mode !== 'replace' && mode !== 'add') return fail(400, 'Say whether the PDF replaces a saved PDF or is added.');
  const mp = monthProblem(year, month, today);
  if (mp) return fail(400, mp);
  const fp = fileProblem(req.name, req.bytes);
  if (fp) return fail(400, fp);

  const name = cleanName(req.name);
  const sha256 = createHash('sha256').update(req.bytes).digest('hex');
  const existing = await store.list(crsId, [{ year, month }]);
  const replaceId = mode === 'replace' && req.replaceId != null && Number(req.replaceId) > 0 ? Number(req.replaceId) : null;
  if (replaceId != null && !existing.some((r) => r.id === replaceId)) {
    return fail(404, 'The PDF to be replaced is no longer saved (it may have been removed or replaced elsewhere). Nothing was changed.');
  }
  let row = existing.find((r) => r.sha256 === sha256) ?? null;
  const duplicate = !!row;
  if (!row) {
    row = await store.insert({
      crs_id: crsId,
      year,
      month,
      fy: fyText(year, month),
      file_name: name,
      file_size: req.bytes.length,
      sha256,
      data_b64: Buffer.from(req.bytes).toString('base64'),
      uploaded_by_id: s.userId ?? null,
      uploaded_by_name: s.name ?? '',
    });
  }
  // Only the named file goes — and not when the "new" file IS that file.
  const removed = replaceId != null && replaceId !== row.id ? await store.removeIds(crsId, year, month, [replaceId]) : [];
  const saved = await monthOf(store, crsId, year, month);
  return {
    status: 200,
    body: { ok: true, crsId, month: saved, file: { id: row.id, name: row.file_name }, duplicate, replaced: removed.map((r) => r.file_name) },
    saved: { row, removed, duplicate },
  };
}

/** DELETE one file — that PDF only; the month's others stay. */
export async function removeFile(store: PvUploadStore, s: Actor | null, id: number): Promise<Answer & { removed?: PvUploadRow[] }> {
  if (!s) return fail(401, 'Not signed in.');
  if (!Number.isInteger(id) || id <= 0) return fail(400, 'Not a saved file.');
  const row = await store.find(id);
  // Another shop's file answers exactly as a missing one.
  if (!row || !canReach(s, Number(row.crs_id))) return fail(404, 'That PDF is not saved (it may already have been removed).');
  const removed = await store.removeIds(Number(row.crs_id), Number(row.year), Number(row.month), [id]);
  const month = await monthOf(store, Number(row.crs_id), Number(row.year), Number(row.month));
  return { status: 200, body: { ok: true, crsId: row.crs_id, month, removed: removed.map((r) => r.file_name) }, removed };
}

/** DELETE — remove every saved file of a shop's month. */
export async function removeMonth(store: PvUploadStore, s: Actor | null, crsId: number, year: number, month: number): Promise<Answer & { removed?: PvUploadRow[] }> {
  if (!s) return fail(401, 'Not signed in.');
  if (!validCrs(crsId)) return fail(400, 'Unknown CRS shop.');
  if (!canReach(s, crsId)) return fail(403, `You can only change CRS ${s.crsId}'s uploads.`);
  if (!Number.isInteger(year) || !Number.isInteger(month) || month < 1 || month > 12) return fail(400, 'Not a valid month.');
  const removed = await store.removeOthers(crsId, year, month, []);
  return { status: 200, body: { ok: true, crsId, removed: removed.map((r) => r.file_name) }, removed };
}

/** GET one file — its bytes, for the shop it belongs to only. */
export async function fileBytes(store: PvUploadStore, s: Actor | null, id: number): Promise<{ status: number; error?: string; name?: string; bytes?: Uint8Array }> {
  if (!s) return { status: 401, error: 'Not signed in.' };
  if (!Number.isInteger(id) || id <= 0) return { status: 400, error: 'Not a saved file.' };
  const row = await store.get(id);
  // A file of another shop answers exactly as a missing one: its existence is not this person's business.
  if (!row || !canReach(s, Number(row.crs_id))) return { status: 404, error: 'That PDF is not saved (it may have been replaced).' };
  return { status: 200, name: row.file_name, bytes: new Uint8Array(Buffer.from(row.data_b64, 'base64')) };
}

/** What the activity log says about a save or a removal. */
export function activitySummary(kind: 'saved' | 'replaced' | 'removed', crsId: number, year: number, month: number, names: string[]): string {
  const m = monthText(year, month);
  if (kind === 'removed') return `3-Month PV PDF removed — CRS ${crsId}, ${m}: ${names.join(', ')}`;
  if (kind === 'replaced') return `3-Month PV PDF replaced — CRS ${crsId}, ${m}: ${names.join(', ')}`;
  return `3-Month PV PDF uploaded — CRS ${crsId}, ${m}: ${names.join(', ')}`;
}

/** An in-memory store — the verify script's and the browser test's database. */
export function memoryStore(): PvUploadStore & { rows: (PvUploadRow & { data_b64: string })[] } {
  const rows: (PvUploadRow & { data_b64: string })[] = [];
  let next = 1;
  const strip = ({ data_b64: _d, ...r }: PvUploadRow & { data_b64: string }): PvUploadRow => r;
  return {
    rows,
    async list(crsId, months) {
      return rows.filter((r) => r.crs_id === crsId && months.some((m) => m.year === r.year && m.month === r.month)).map(strip);
    },
    async insert(row) {
      const r = { ...row, id: next++, uploaded_at: new Date(Date.now() + next).toISOString() };
      rows.push(r);
      return strip(r);
    },
    async removeOthers(crsId, year, month, keep) {
      const gone = rows.filter((r) => r.crs_id === crsId && r.year === year && r.month === month && !keep.includes(r.id));
      for (const g of gone) rows.splice(rows.indexOf(g), 1);
      return gone.map(strip);
    },
    async removeIds(crsId, year, month, ids) {
      const gone = rows.filter((r) => r.crs_id === crsId && r.year === year && r.month === month && ids.includes(r.id));
      for (const g of gone) rows.splice(rows.indexOf(g), 1);
      return gone.map(strip);
    },
    async find(id) {
      const r = rows.find((x) => x.id === id);
      return r ? strip(r) : null;
    },
    async get(id) {
      return rows.find((r) => r.id === id) ?? null;
    },
  };
}
