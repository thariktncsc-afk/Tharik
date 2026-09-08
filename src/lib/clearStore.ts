/**
 * Where clear/delete approval requests live.
 *
 * In `crs_state`, under the pseudo-store `__clearRequests` — not in a table of
 * its own. Deploying this project ships the frontend only; migrations are a
 * separate manual step against the live database (see CLAUDE.md), and a
 * security control that does not work until someone remembers to run SQL is a
 * security control that does not work. This needs no migration at all.
 *
 * That is only safe because of two things, and both must stay true:
 *
 *   1. `__clearRequests` is NOT in ALLOWED_KEYS in /api/state, so no client
 *      can write it. Only this module does, through the service key, from
 *      admin-gated route handlers. Same asymmetry as payment_settings — the
 *      approval is worth exactly as much as the difficulty of forging one.
 *   2. /api/state's GET filters it out, so one shop cannot read another's
 *      reasons, requester names and snapshots.
 *
 * Concurrency uses the `version` column the store already has: read, modify,
 * write-if-unchanged, retry. Two admins deciding at the same moment cannot
 * lose one another's decision.
 *
 * The audit trigger on crs_state records every version of this row, so the
 * trail is kept by the database as well as by the `events` list below.
 */
import { supabaseAdmin } from '@/lib/supabaseAdmin';

export const CLEAR_STORE_KEY = '__clearRequests';

export type StoredRequest = {
  id: number;
  crsId: number;
  shopName: string;
  storeKeys: string[];
  modules: string[];
  scopeKind: string;
  scopeLabel: string;
  requestedBy: string;
  requestedById: number | null;
  requestedRole: string;
  reason: string;
  snapshot: Record<string, unknown>;
  /**
   * pending → clearing → cleared is the whole life of an approved request.
   * `clearing` exists so a crash mid-delete is visible rather than silently
   * looking finished; `approved` is kept only so rows written before the
   * executor landed still read sensibly.
   */
  status: 'pending' | 'clearing' | 'cleared' | 'approved' | 'rejected' | 'cancelled';
  createdAt: string;
  decidedBy: string | null;
  decidedAt: string | null;
  decisionNote: string | null;
  clearedAt: string | null;
  /** Exactly which records the approval removed. */
  clearedRecords: { store: string; module: string; key: string }[];
  /** Set when a clear failed, so the admin sees why it is still pending. */
  lastError: string | null;
};

export type StoredEvent = {
  requestId: number | null;
  event: string;
  actor: string;
  actorRole: string;
  at: string;
  detail: string;
};

export type ClearDb = { seq: number; requests: StoredRequest[]; events: StoredEvent[] };

/** Kept bounded — this row is read whole on every guarded write. */
const MAX_REQUESTS = 400;
const MAX_EVENTS = 800;

const empty = (): ClearDb => ({ seq: 0, requests: [], events: [] });

function normalise(raw: unknown): ClearDb {
  if (!raw || typeof raw !== 'object') return empty();
  const o = raw as Partial<ClearDb>;
  return {
    seq: Number(o.seq) || 0,
    requests: Array.isArray(o.requests) ? (o.requests as StoredRequest[]) : [],
    events: Array.isArray(o.events) ? (o.events as StoredEvent[]) : [],
  };
}

async function readRow(): Promise<{ db: ClearDb; version: number; exists: boolean }> {
  const { data, error } = await supabaseAdmin()
    .from('crs_state')
    .select('data, version')
    .eq('scope', 'global')
    .eq('store_key', CLEAR_STORE_KEY)
    .maybeSingle();

  if (error) throw new Error(error.message);
  if (!data) return { db: empty(), version: 0, exists: false };
  return { db: normalise(data.data), version: Number(data.version) || 0, exists: true };
}

export async function readClearDb(): Promise<ClearDb> {
  return (await readRow()).db;
}

/**
 * Read-modify-write under the row's version. `fn` may return a value, which is
 * handed back once the write lands; it must not assume it runs only once.
 */
export async function mutateClearDb<T>(actor: string, fn: (db: ClearDb) => T): Promise<T> {
  const db2 = supabaseAdmin();
  let lastErr = 'could not save the approval record';

  for (let attempt = 0; attempt < 4; attempt++) {
    const { db, version, exists } = await readRow();
    const result = fn(db);

    // Trim oldest settled rows first; anything still open is never dropped.
    if (db.requests.length > MAX_REQUESTS) {
      const open = db.requests.filter((r) => r.status === 'pending' || r.status === 'approved');
      const settled = db.requests.filter((r) => r.status !== 'pending' && r.status !== 'approved');
      settled.sort((a, b) => String(b.createdAt).localeCompare(String(a.createdAt)));
      db.requests = [...open, ...settled.slice(0, Math.max(0, MAX_REQUESTS - open.length))];
    }
    if (db.events.length > MAX_EVENTS) db.events = db.events.slice(-MAX_EVENTS);

    if (!exists) {
      const { error } = await db2
        .from('crs_state')
        .insert({ scope: 'global', store_key: CLEAR_STORE_KEY, data: db, version: 1, updated_by: actor });
      if (!error) return result;
      lastErr = error.message; // someone inserted first — re-read and retry
      continue;
    }

    const { data, error } = await db2
      .from('crs_state')
      .update({ data: db, version: version + 1, updated_at: new Date().toISOString(), updated_by: actor })
      .eq('scope', 'global')
      .eq('store_key', CLEAR_STORE_KEY)
      .eq('version', version)
      .select('version')
      .maybeSingle();

    if (!error && data) return result;
    if (error) lastErr = error.message;
  }

  throw new Error(lastErr);
}
