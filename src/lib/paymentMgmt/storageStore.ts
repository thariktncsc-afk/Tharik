/**
 * Where Payment Management keeps its records — with NO migration to run
 * (migrations are not run on deploy; see src/lib/pvUploads/storageStore.ts,
 * which this follows):
 *
 *   - ONE OBLIGATION, ONE RECORD in the existing `crs_state` table, under its
 *     own scope `payment_mgmt`, key `pmob:<id>`. Never scope 'global': /api/state
 *     hands every global row to every signed-in user. The key IS the shop, month
 *     and type for Monthly / PV / Previous Balance, so the table's primary key
 *     makes a second one impossible (an insert answers 23505). Written with its
 *     `version` like every store, and so recorded in crs_state_audit.
 *   - THE QR IMAGE AND REMINDER SOUNDS go to a PRIVATE Storage bucket
 *     `payment-media` that the server creates the first time it is needed; their
 *     details are the record `pmset:media` in the same scope.
 *   - THE UPI ID AND PAYEE NAME are the existing payment_settings row (0004) —
 *     one office UPI ID for paid downloads and reminders. Only those two
 *     columns are ever written here: the tariff and the charging switch are
 *     the Settings page's.
 *
 * Route handlers only — it holds the secret key.
 */
import { supabaseAdmin } from '@/lib/supabaseAdmin';
import { MAX_MEDIA_BYTES, MEDIA_KEY, emptyMedia, obKey, readMedia, readObligation } from './core';
import type { Answer, PmStore, Step, Stored } from './server';
import type { PmMedia, PmObligation, PmUpiConfig } from './types';

export const PM_SCOPE = 'payment_mgmt';
export const PM_BUCKET = 'payment-media';
const OB_PREFIX = 'pmob:';
const PAGE = 1000;

/** A failure with the technical detail for the server log; the person is told something plain. */
export class PmStoreError extends Error {}

/** Two people changed the same record at the same moment, five times running. */
const conflict = () => Object.assign(new PmStoreError('crs_state: still conflicting after 5 attempts'), { status: 409, plain: 'Someone else changed it at the same moment — please try again.' });

const SETTINGS_MISSING = 'Payment settings are not installed (run 0004_payments.sql).';
const missingTable = (e: { code?: string; message?: string } | null | undefined) =>
  !!e && (e.code === 'PGRST205' || e.code === '42P01' || (/payment_settings/.test(e.message ?? '') && /does not exist|schema cache|Could not find/.test(e.message ?? '')));

let bucketReady: Promise<void> | null = null;
/** The private bucket, made the first time it is needed. Safe to call from two requests at once. */
function ensureBucket(): Promise<void> {
  if (!bucketReady) {
    bucketReady = (async () => {
      const st = supabaseAdmin().storage;
      const got = await st.getBucket(PM_BUCKET);
      if (got.data) return;
      const made = await st.createBucket(PM_BUCKET, {
        public: false,
        fileSizeLimit: MAX_MEDIA_BYTES,
        allowedMimeTypes: ['image/png', 'image/jpeg', 'image/webp', 'audio/mpeg', 'audio/wav', 'audio/x-wav', 'audio/ogg', 'audio/mp4', 'audio/aac', 'audio/webm'],
      });
      if (made.error && !/already exists|duplicate/i.test(made.error.message)) {
        throw new PmStoreError(`Storage bucket ${PM_BUCKET} could not be created: ${made.error.message}`);
      }
    })().catch((e) => {
      bucketReady = null;
      throw e;
    });
  }
  return bucketReady;
}

async function readRow(key: string): Promise<{ data: unknown; version: number | null }> {
  const { data, error } = await supabaseAdmin().from('crs_state').select('data, version').eq('scope', PM_SCOPE).eq('store_key', key).maybeSingle();
  if (error) throw new PmStoreError(`crs_state read ${key} failed: ${error.code} ${error.message}`);
  return { data: data?.data ?? null, version: data ? Number(data.version) : null };
}

/**
 * Change one record under its version: read, change, write only if nobody
 * wrote in between — else read again. `fn` sees the fresh record every time,
 * so a refusal it makes (more than the balance, say) is never made on stale
 * figures. `fn(null)` is a record that does not exist yet.
 */
async function changeRecord<T>(key: string, by: string, read: (raw: unknown) => T | null, fn: (cur: T | null) => Step<T> | null): Promise<{ next: T; version: number } | { stop: Answer } | null> {
  for (let attempt = 0; attempt < 5; attempt++) {
    const { data, version } = await readRow(key);
    const step = fn(version == null ? null : read(data));
    if (!step) return null;
    if ('stop' in step) return step;
    const db = supabaseAdmin().from('crs_state');
    if (version == null) {
      const { error } = await db.insert({ scope: PM_SCOPE, store_key: key, data: step.next, version: 1, updated_by: by });
      if (!error) return { next: step.next, version: 1 };
      if (error.code === '23505') continue; // someone made it first
      throw new PmStoreError(`crs_state insert ${key} failed: ${error.code} ${error.message}`);
    }
    const { data: upd, error } = await db
      .update({ data: step.next, version: version + 1, updated_at: new Date().toISOString(), updated_by: by })
      .eq('scope', PM_SCOPE)
      .eq('store_key', key)
      .eq('version', version)
      .select('version');
    if (error) throw new PmStoreError(`crs_state update ${key} failed: ${error.code} ${error.message}`);
    if (upd?.length) return { next: step.next, version: version + 1 };
  }
  throw conflict();
}

/** Every obligation record matching `narrow`, a page of 1000 at a time (PostgREST's cap per answer). */
async function listWhere(crsId: number | null): Promise<Stored[]> {
  const out: Stored[] = [];
  for (let from = 0; ; from += PAGE) {
    let q = supabaseAdmin()
      .from('crs_state')
      .select('store_key, data, version')
      .eq('scope', PM_SCOPE)
      .like('store_key', `${OB_PREFIX}%`);
    // A shop's own by the record's crsId — never a LIKE on the key ('_' is a wildcard there).
    if (crsId !== null) q = q.contains('data', { crsId });
    const { data, error } = await q.order('store_key', { ascending: true }).range(from, from + PAGE - 1);
    if (error) throw new PmStoreError(`crs_state list failed: ${error.code} ${error.message}`);
    for (const r of data ?? []) {
      const ob = readObligation(r.data);
      if (ob) out.push({ ob, version: Number(r.version) });
    }
    if ((data ?? []).length < PAGE) return out;
  }
}

export function storagePmStore(): PmStore {
  return {
    listObligations: () => listWhere(null),

    listShop: (crsId) => listWhere(crsId),

    async getObligation(id) {
      const { data, version } = await readRow(obKey(id));
      const ob = version == null ? null : readObligation(data);
      return ob ? { ob, version: version! } : null;
    },

    async insertObligation(ob, by) {
      const { error } = await supabaseAdmin().from('crs_state').insert({ scope: PM_SCOPE, store_key: obKey(ob.id), data: ob, version: 1, updated_by: by });
      if (error?.code === '23505') return null; // that shop's month already has one
      if (error) throw new PmStoreError(`crs_state insert ${ob.id} failed: ${error.code} ${error.message}`);
      return { ob, version: 1 };
    },

    async changeObligation(id, by, fn) {
      const r = await changeRecord<PmObligation>(obKey(id), by, readObligation, (cur) => (cur ? fn(cur) : null));
      if (!r) return null;
      if ('stop' in r) return r;
      return { ob: r.next, version: r.version };
    },

    async removeObligation(id, guard) {
      const key = obKey(id);
      for (let attempt = 0; attempt < 5; attempt++) {
        const { data, version } = await readRow(key);
        const cur = version == null ? null : readObligation(data);
        if (!cur) return 'gone';
        const stop = guard(cur);
        if (stop) return { stop };
        const { data: del, error } = await supabaseAdmin()
          .from('crs_state')
          .delete()
          .eq('scope', PM_SCOPE)
          .eq('store_key', key)
          .eq('version', version!)
          .select('store_key');
        if (error) throw new PmStoreError(`crs_state delete ${key} failed: ${error.code} ${error.message}`);
        if (del?.length) return 'removed';
        // Changed in between (a payment, a reminder): judge it again as it is now.
      }
      throw conflict();
    },

    async getMedia() {
      const { data, version } = await readRow(MEDIA_KEY);
      return version == null ? emptyMedia() : readMedia(data);
    },

    async changeMedia(by, fn) {
      const r = await changeRecord<PmMedia>(MEDIA_KEY, by, readMedia, (cur) => fn(cur ?? emptyMedia()));
      if (!r) return emptyMedia();
      if ('stop' in r) return r;
      return r.next;
    },

    async putFile(path, bytes, mime) {
      await ensureBucket();
      const up = await supabaseAdmin().storage.from(PM_BUCKET).upload(path, Buffer.from(bytes), { contentType: mime, upsert: false });
      if (up.error) throw new PmStoreError(`Storage upload ${path} failed: ${up.error.message}`);
    },

    async removeFile(path) {
      const res = await supabaseAdmin().storage.from(PM_BUCKET).remove([path]);
      if (res.error) throw new PmStoreError(`Storage remove ${path} failed: ${res.error.message}`);
    },

    async readFile(path) {
      const dl = await supabaseAdmin().storage.from(PM_BUCKET).download(path);
      if (dl.error || !dl.data) {
        if (/not found|does not exist/i.test(dl.error?.message ?? '')) return null;
        throw new PmStoreError(`Storage download ${path} failed: ${dl.error?.message ?? 'no data'}`);
      }
      return new Uint8Array(await dl.data.arrayBuffer());
    },

    async getUpi() {
      const { data, error } = await supabaseAdmin().from('payment_settings').select('upi_vpa, upi_payee_name').eq('id', 1).maybeSingle();
      // 0004 not run: no UPI ID yet — the screens still work, the links are simply not offered.
      if (missingTable(error)) return null;
      if (error) throw new PmStoreError(`payment_settings read failed: ${error.code} ${error.message}`);
      if (!data) return null;
      return { vpa: String(data.upi_vpa ?? ''), payeeName: String(data.upi_payee_name ?? '') };
    },

    async setUpi(upi: PmUpiConfig, by: string) {
      const db = supabaseAdmin().from('payment_settings');
      // ONLY these columns: never the full-replace /api/payments/settings, which
      // would reset the tariff and switch charging off.
      const patch = { upi_vpa: upi.vpa, upi_payee_name: upi.payeeName, updated_at: new Date().toISOString(), updated_by: by };
      const { data, error } = await db.update(patch).eq('id', 1).select('id');
      if (missingTable(error)) throw Object.assign(new PmStoreError(`payment_settings missing: ${error!.code} ${error!.message}`), { status: 503, plain: SETTINGS_MISSING });
      if (error) throw new PmStoreError(`payment_settings update failed: ${error.code} ${error.message}`);
      if (data?.length) return;
      // The table exists without its row (0004 inserts it): the row is made with
      // the table's own defaults for everything else — charging stays off.
      const ins = await supabaseAdmin().from('payment_settings').insert({ id: 1, ...patch });
      if (ins.error?.code === '23505') {
        const again = await supabaseAdmin().from('payment_settings').update(patch).eq('id', 1);
        if (again.error) throw new PmStoreError(`payment_settings update failed: ${again.error.code} ${again.error.message}`);
        return;
      }
      if (ins.error) throw new PmStoreError(`payment_settings insert failed: ${ins.error.code} ${ins.error.message}`);
    },
  };
}

/**
 * The live-sync beat's view of Payment Management (/api/sync ?topics=paymgmt):
 * every record's key and version for an administrator, the shop's own
 * obligations for a shop user, '' for an account with no shop. Any reminder,
 * payment, OK or edit the caller may see changes it; nothing else is read.
 */
export async function pmFingerprint(session: { role: string; crsId: number | null }): Promise<string> {
  const admin = session.role === 'ADMIN';
  const crsId = Number(session.crsId);
  if (!admin && !(session.crsId != null && Number.isInteger(crsId) && crsId > 0)) return '';
  const parts: string[] = [];
  for (let from = 0; ; from += PAGE) {
    let q = supabaseAdmin().from('crs_state').select('store_key, version').eq('scope', PM_SCOPE);
    if (!admin) q = q.like('store_key', `${OB_PREFIX}%`).contains('data', { crsId });
    const { data, error } = await q.order('store_key', { ascending: true }).range(from, from + PAGE - 1);
    if (error) return 'unavailable';
    for (const r of data ?? []) parts.push(`${r.store_key}:${r.version}`);
    if ((data ?? []).length < PAGE) break;
  }
  const text = parts.join('|');
  let h = 5381;
  for (let i = 0; i < text.length; i++) h = ((h << 5) + h + text.charCodeAt(i)) | 0;
  return `${parts.length}:${(h >>> 0).toString(36)}`;
}
