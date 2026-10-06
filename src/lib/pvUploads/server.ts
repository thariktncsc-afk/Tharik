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
  /** One file with its bytes. */
  get(id: number): Promise<(PvUploadRow & { data_b64: string }) | null>;
};

/** The table does not exist yet (0009 not run). */
export class MissingTableError extends Error {}

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
 * POST — save one PDF for a shop's month. `replace` makes it the month's only
 * file once it is stored (the others are removed after, never before, so a
 * failed save leaves the month as it was); `add` keeps the month's others.
 * A file already saved for the month (same sha256) is not stored twice.
 */
export async function saveUpload(
  store: PvUploadStore,
  s: Actor | null,
  req: { crsId: number; year: number; month: number; name: string; mode: UploadMode; bytes: Uint8Array },
  today: { year: number; month: number },
): Promise<Answer & { saved?: { row: PvUploadRow; removed: PvUploadRow[]; duplicate: boolean } }> {
  if (!s) return fail(401, 'Not signed in.');
  const { crsId, year, month, mode } = req;
  if (!validCrs(crsId)) return fail(400, 'Unknown CRS shop.');
  if (!canReach(s, crsId)) return fail(403, `You can only upload for CRS ${s.crsId}.`);
  if (mode !== 'replace' && mode !== 'add') return fail(400, 'Say whether the PDF replaces the month or is added to it.');
  const mp = monthProblem(year, month, today);
  if (mp) return fail(400, mp);
  const fp = fileProblem(req.name, req.bytes);
  if (fp) return fail(400, fp);

  const name = cleanName(req.name);
  const sha256 = createHash('sha256').update(req.bytes).digest('hex');
  const existing = await store.list(crsId, [{ year, month }]);
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
  const removed = mode === 'replace' ? await store.removeOthers(crsId, year, month, [row.id]) : [];
  const saved = await monthOf(store, crsId, year, month);
  return {
    status: 200,
    body: { ok: true, crsId, month: saved, file: { id: row.id, name: row.file_name }, duplicate, replaced: removed.map((r) => r.file_name) },
    saved: { row, removed, duplicate },
  };
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
    async get(id) {
      return rows.find((r) => r.id === id) ?? null;
    },
  };
}
