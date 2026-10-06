/**
 * Where the Manual 3-Month PV's saved PDFs live — with NO migration to run
 * (office, 2026-10-06: "I should not have to manually run a migration").
 *
 * The first design put them in a new table (pv_upload_files, migration 0009).
 * Migrations are not run on deploy, so on the live site every upload failed
 * with "the PV uploads table does not exist". Nothing here needs a schema
 * change:
 *
 *   - THE PDF FILES go to Supabase Storage, a PRIVATE bucket `pv-uploads`
 *     that the server creates itself the first time it is needed (a Storage
 *     API call, not SQL), at `<crs>/<year>-<month>/<id>.pdf`. Only route
 *     handlers holding the secret key reach it; the browser never does.
 *   - THE DETAILS of a shop-month — which files, their names, sizes, sha256,
 *     who and when — are ONE small record in the existing `crs_state` table,
 *     under its own scope `pv_upload` (key `pvupload:<crs>_<month>_<year>`),
 *     written with its `version` like every other store, and so recorded in
 *     crs_state_audit. Everything else in the app reads crs_state with
 *     `scope = 'global'` only, so these records are invisible to it (no
 *     /api/state load, no live sync, no clear, no backfill).
 *
 * The handlers (server.ts) and their rules are unchanged; this is the store
 * behind them. Route handlers only — it holds the secret key.
 */
import { supabaseAdmin } from '@/lib/supabaseAdmin';
import type { PvUploadRow } from './core';
import { MAX_PDF_BYTES } from './core';
import type { PvUploadStore } from './server';

export const PV_BUCKET = 'pv-uploads';
export const PV_SCOPE = 'pv_upload';
const keyOf = (crsId: number, year: number, month: number) => `pvupload:${crsId}_${month}_${year}`;

type FileRec = PvUploadRow & { path: string };
type MonthRec = { crsId: number; year: number; month: number; fy: string; files: FileRec[] };

const strip = ({ path: _p, ...r }: FileRec): PvUploadRow => r;

/** A failure with the technical detail for the server log; the user is told something plain. */
export class PvStoreError extends Error {}

let bucketReady: Promise<void> | null = null;
/** The private bucket, made the first time it is needed. Safe to call from two requests at once. */
function ensureBucket(): Promise<void> {
  if (!bucketReady) {
    bucketReady = (async () => {
      const st = supabaseAdmin().storage;
      const got = await st.getBucket(PV_BUCKET);
      if (got.data) return;
      const made = await st.createBucket(PV_BUCKET, { public: false, fileSizeLimit: MAX_PDF_BYTES, allowedMimeTypes: ['application/pdf'] });
      if (made.error && !/already exists|duplicate/i.test(made.error.message)) {
        throw new PvStoreError(`Storage bucket ${PV_BUCKET} could not be created: ${made.error.message}`);
      }
    })().catch((e) => {
      bucketReady = null;
      throw e;
    });
  }
  return bucketReady;
}

async function readMonth(crsId: number, year: number, month: number): Promise<{ rec: MonthRec | null; version: number | null }> {
  const { data, error } = await supabaseAdmin()
    .from('crs_state')
    .select('data, version')
    .eq('scope', PV_SCOPE)
    .eq('store_key', keyOf(crsId, year, month))
    .maybeSingle();
  if (error) throw new PvStoreError(`crs_state read failed: ${error.code} ${error.message}`);
  return { rec: (data?.data as MonthRec | undefined) ?? null, version: data ? Number(data.version) : null };
}

/**
 * Change a shop-month's record under its version: read, change, write only if
 * nobody wrote in between — else read again (two uploads at once both land).
 */
async function changeMonth(crsId: number, year: number, month: number, by: string, fn: (rec: MonthRec) => MonthRec): Promise<MonthRec> {
  const key = keyOf(crsId, year, month);
  for (let attempt = 0; attempt < 5; attempt++) {
    const { rec, version } = await readMonth(crsId, year, month);
    const next = fn(rec ?? { crsId, year, month, fy: '', files: [] });
    const db = supabaseAdmin().from('crs_state');
    if (version == null) {
      const { error } = await db.insert({ scope: PV_SCOPE, store_key: key, data: next, version: 1, updated_by: by });
      if (!error) return next;
      if (error.code === '23505') continue; // someone made it first
      throw new PvStoreError(`crs_state insert failed: ${error.code} ${error.message}`);
    }
    const { data, error } = await db
      .update({ data: next, version: version + 1, updated_at: new Date().toISOString(), updated_by: by })
      .eq('scope', PV_SCOPE)
      .eq('store_key', key)
      .eq('version', version)
      .select('version');
    if (error) throw new PvStoreError(`crs_state update failed: ${error.code} ${error.message}`);
    if (data?.length) return next;
  }
  throw new PvStoreError(`crs_state ${key}: still conflicting after 5 attempts`);
}

/** A file id: unique, numeric (the screen and the file route take a number). */
const newId = () => Date.now() * 1000 + Math.floor(Math.random() * 1000);

export function storagePvStore(): PvUploadStore {
  return {
    async list(crsId, months) {
      if (!months.length) return [];
      const { data, error } = await supabaseAdmin()
        .from('crs_state')
        .select('data')
        .eq('scope', PV_SCOPE)
        .in('store_key', months.map((m) => keyOf(crsId, m.year, m.month)));
      if (error) throw new PvStoreError(`crs_state list failed: ${error.code} ${error.message}`);
      return (data ?? []).flatMap((r) => ((r.data as MonthRec)?.files ?? []).map(strip));
    },

    async insert(row) {
      await ensureBucket();
      const id = newId();
      const path = `${row.crs_id}/${row.year}-${row.month}/${id}.pdf`;
      const bytes = Buffer.from(row.data_b64, 'base64');
      const up = await supabaseAdmin().storage.from(PV_BUCKET).upload(path, bytes, { contentType: 'application/pdf', upsert: false });
      if (up.error) throw new PvStoreError(`Storage upload ${path} failed: ${up.error.message}`);
      const { data_b64: _b, ...meta } = row;
      const rec: FileRec = { ...meta, id, uploaded_at: new Date().toISOString(), path };
      try {
        await changeMonth(row.crs_id, row.year, row.month, row.uploaded_by_name || 'pv-upload', (m) => ({ ...m, fy: row.fy, files: [...m.files, rec] }));
      } catch (e) {
        // The record was not written: the file must not linger unlisted.
        await supabaseAdmin().storage.from(PV_BUCKET).remove([path]).catch(() => undefined);
        throw e;
      }
      return strip(rec);
    },

    async removeOthers(crsId, year, month, keep) {
      let removed: FileRec[] = [];
      const { rec } = await readMonth(crsId, year, month);
      if (!rec?.files.some((f) => !keep.includes(f.id))) return [];
      await changeMonth(crsId, year, month, 'pv-upload', (m) => {
        removed = m.files.filter((f) => !keep.includes(f.id));
        return { ...m, files: m.files.filter((f) => keep.includes(f.id)) };
      });
      if (removed.length) {
        const gone = await supabaseAdmin().storage.from(PV_BUCKET).remove(removed.map((f) => f.path));
        // The record no longer lists them, so they are already gone for the app;
        // a file left behind in the bucket is only disk space.
        if (gone.error) console.error('[pv-uploads] leftover files not removed:', gone.error.message);
      }
      return removed.map(strip);
    },

    async get(id) {
      const { data, error } = await supabaseAdmin()
        .from('crs_state')
        .select('data')
        .eq('scope', PV_SCOPE)
        .contains('data', { files: [{ id }] })
        .limit(1);
      if (error) throw new PvStoreError(`crs_state find ${id} failed: ${error.code} ${error.message}`);
      const f = ((data?.[0]?.data as MonthRec | undefined)?.files ?? []).find((x) => x.id === id);
      if (!f) return null;
      const dl = await supabaseAdmin().storage.from(PV_BUCKET).download(f.path);
      if (dl.error || !dl.data) throw new PvStoreError(`Storage download ${f.path} failed: ${dl.error?.message ?? 'no data'}`);
      return { ...strip(f), data_b64: Buffer.from(await dl.data.arrayBuffer()).toString('base64') };
    },
  };
}
