/**
 * pv_upload_files (migration 0009) as a PvUploadStore. Route handlers only —
 * it holds the secret key through supabaseAdmin().
 */
import { supabaseAdmin } from '@/lib/supabaseAdmin';
import type { PvUploadRow } from './core';
import { MissingTableError, type PvUploadStore } from './server';

const TABLE = 'pv_upload_files';
const META = 'id, crs_id, year, month, fy, file_name, file_size, sha256, uploaded_at, uploaded_by_id, uploaded_by_name';

function check(error: { code?: string; message?: string } | null) {
  if (!error) return;
  if (error.code === 'PGRST205' || error.code === '42P01') {
    throw new MissingTableError('The PV uploads table does not exist — run supabase/migrations/0009_pv_uploads.sql.');
  }
  throw new Error(error.message ?? 'Database error');
}

export function supabasePvStore(): PvUploadStore {
  const db = () => supabaseAdmin().from(TABLE);
  return {
    async list(crsId, months) {
      if (!months.length) return [];
      const { data, error } = await db()
        .select(META)
        .eq('crs_id', crsId)
        .in('year', [...new Set(months.map((m) => m.year))])
        .in('month', [...new Set(months.map((m) => m.month))]);
      check(error);
      return ((data ?? []) as PvUploadRow[]).filter((r) => months.some((m) => m.year === Number(r.year) && m.month === Number(r.month)));
    },
    async insert(row) {
      const { data, error } = await db().insert(row).select(META).single();
      check(error);
      return data as PvUploadRow;
    },
    async removeOthers(crsId, year, month, keep) {
      let q = db().delete().eq('crs_id', crsId).eq('year', year).eq('month', month);
      if (keep.length) q = q.not('id', 'in', `(${keep.join(',')})`);
      const { data, error } = await q.select(META);
      check(error);
      return (data ?? []) as PvUploadRow[];
    },
    async get(id) {
      const { data, error } = await db().select(`${META}, data_b64`).eq('id', id).maybeSingle();
      check(error);
      return (data as (PvUploadRow & { data_b64: string }) | null) ?? null;
    },
  };
}
