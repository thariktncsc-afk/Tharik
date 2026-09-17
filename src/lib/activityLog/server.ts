/**
 * Writing and reading the activity log (migration 0006). Route handlers only —
 * this holds the service_role client.
 *
 * WRITING NEVER FAILS THE ACTION. A save, an approval or a payment decision
 * that succeeded must not be reported as failed because its log row could not
 * be written — the data is what matters, and the audit trail in
 * crs_state_audit still has the write. Errors are logged to the server console
 * and swallowed; a missing table (0006 not run) is noticed once and skipped for
 * a minute, rather than failing an insert on every save.
 *
 * READING IS FOR ADMINISTRATORS. The all-shop log (readActivityLog) is only
 * called by /api/activity/log after it has checked the role. The dashboard's
 * short feed (recentFeed) is scoped to the viewer's own shop by the caller.
 */
import { supabaseAdmin } from '@/lib/supabaseAdmin';
import type { Session } from '@/lib/session';
import { CRS_NAMES } from '@/lib/engine/shops';
import type { ActivityDraft, ActivityRow, FeedItem } from './core';

export const ACTIVITY_MIGRATION_HINT = 'The activity log is not installed yet — run supabase/migrations/0006_activity_log.sql.';

type DbError = { code?: string; message?: string } | null | undefined;
export const logMissing = (e: DbError) =>
  !!e && (e.code === 'PGRST205' || e.code === '42P01' || (/activity_log/.test(e.message ?? '') && /does not exist|schema cache|Could not find/.test(e.message ?? '')));

let skipUntil = 0;

async function actor(session: Session | null): Promise<{ name: string; role: string }> {
  if (!session) return { name: 'System', role: 'SYSTEM' };
  const { data } = await supabaseAdmin().from('users').select('full_name, role').eq('id', session.userId).maybeSingle();
  return { name: String(data?.full_name || session.username), role: String(data?.role || session.role) };
}

async function shopNames(ids: number[]): Promise<Record<number, string>> {
  const out: Record<number, string> = {};
  if (!ids.length) return out;
  const { data } = await supabaseAdmin().from('crs_state').select('data').eq('scope', 'global').eq('store_key', '__shops').maybeSingle();
  const rows = Array.isArray(data?.data) ? (data!.data as { name?: string }[]) : [];
  for (const id of ids) out[id] = String(rows[id - 1]?.name || CRS_NAMES[id] || '');
  return out;
}

/** Record what `session` did. Never throws. */
export async function recordActivity(session: Session | null, drafts: ActivityDraft[]): Promise<void> {
  if (!drafts.length || Date.now() < skipUntil) return;
  try {
    const ids = [...new Set(drafts.map((d) => d.crsId).filter((x): x is number => typeof x === 'number' && x > 0))];
    const [who, names] = await Promise.all([actor(session), shopNames(ids)]);
    const rows = drafts.map((d) => ({
      actor_user_id: session?.userId ?? null,
      actor_username: session?.username ?? 'system',
      actor_name: who.name,
      actor_role: who.role,
      source: d.source,
      crs_id: d.crsId,
      shop_name: d.crsId ? (names[d.crsId] ?? '') : '',
      module: d.module,
      action: d.action,
      entry_date: d.entryDate ?? null,
      entry_month: d.entryMonth ?? null,
      entry_year: d.entryYear ?? null,
      record_key: d.recordKey ?? null,
      summary: String(d.summary ?? '').slice(0, 500),
      changes: (d.changes ?? []).slice(0, 150),
      related_id: d.relatedId ?? null,
    }));
    for (let i = 0; i < rows.length; i += 200) {
      const { error } = await supabaseAdmin().from('activity_log').insert(rows.slice(i, i + 200));
      if (error) throw error;
    }
  } catch (e) {
    if (logMissing(e as DbError)) {
      if (!skipUntil) console.warn(`[activity] ${ACTIVITY_MIGRATION_HINT} Actions continue without being logged.`);
      skipUntil = Date.now() + 60_000;
      return;
    }
    console.warn('[activity] could not record:', (e as DbError)?.message ?? e);
  }
}

type Raw = Record<string, unknown>;
const toRow = (r: Raw): ActivityRow => ({
  id: Number(r.id),
  at: String(r.at),
  actorUserId: r.actor_user_id == null ? null : Number(r.actor_user_id),
  actorUsername: String(r.actor_username ?? ''),
  actorName: String(r.actor_name ?? ''),
  actorRole: String(r.actor_role ?? ''),
  source: r.source === 'system' ? 'system' : 'user',
  crsId: r.crs_id == null ? null : Number(r.crs_id),
  shopName: String(r.shop_name ?? ''),
  module: String(r.module ?? ''),
  action: String(r.action ?? 'updated') as ActivityRow['action'],
  entryDate: r.entry_date ? String(r.entry_date) : null,
  entryMonth: r.entry_month == null ? null : Number(r.entry_month),
  entryYear: r.entry_year == null ? null : Number(r.entry_year),
  recordKey: r.record_key == null ? null : String(r.record_key),
  summary: String(r.summary ?? ''),
  changes: Array.isArray(r.changes) ? (r.changes as ActivityRow['changes']) : [],
  relatedId: r.related_id == null ? null : String(r.related_id),
});

export type LogFilters = {
  /** YYYY-MM-DD, India time, inclusive. */
  from?: string;
  to?: string;
  crsId?: number;
  userId?: number;
  module?: string;
  action?: string;
  source?: 'user' | 'system';
  /** Older than this id — the next page. */
  before?: number;
  /** Newer than this id — what arrived while the page was open. */
  after?: number;
  limit?: number;
};

const ISO = /^\d{4}-\d{2}-\d{2}$/;

/** The all-shop log, newest first. Administrators only — the caller checks. */
export async function readActivityLog(f: LogFilters): Promise<{ installed: boolean; items: ActivityRow[]; nextCursor: number | null }> {
  const limit = Math.max(1, Math.min(Number(f.limit) || 100, 300));
  let q = supabaseAdmin().from('activity_log').select('*').order('id', { ascending: false }).limit(limit + 1);
  // Days are India's days: 17 Sep runs 00:00–23:59 IST, not UTC.
  if (f.from && ISO.test(f.from)) q = q.gte('at', `${f.from}T00:00:00+05:30`);
  if (f.to && ISO.test(f.to)) q = q.lte('at', `${f.to}T23:59:59.999+05:30`);
  if (f.crsId) q = q.eq('crs_id', f.crsId);
  if (f.userId) q = q.eq('actor_user_id', f.userId);
  if (f.module) q = q.eq('module', f.module);
  if (f.action) q = q.eq('action', f.action);
  if (f.source) q = q.eq('source', f.source);
  if (f.before) q = q.lt('id', f.before);
  if (f.after) q = q.gt('id', f.after);
  const { data, error } = await q;
  if (error) {
    if (logMissing(error)) return { installed: false, items: [], nextCursor: null };
    throw new Error(error.message);
  }
  const rows = (data ?? []).map((r) => toRow(r as Raw));
  const more = rows.length > limit;
  const items = rows.slice(0, limit);
  return { installed: true, items, nextCursor: more ? items[items.length - 1].id : null };
}

/** The dashboard's short feed. `crsId` null means an administrator; otherwise that shop only. */
export async function recentFeed(crsId: number | null, limit: number): Promise<{ installed: boolean; items: FeedItem[] }> {
  let q = supabaseAdmin()
    .from('activity_log')
    .select('id, at, actor_username, actor_name, actor_role, source, crs_id, shop_name, module, action, entry_date, entry_month, entry_year, summary')
    .order('id', { ascending: false })
    .limit(limit);
  if (crsId !== null) q = q.eq('crs_id', crsId);
  const { data, error } = await q;
  if (error) {
    if (logMissing(error)) return { installed: false, items: [] };
    throw new Error(error.message);
  }
  return {
    installed: true,
    items: (data ?? []).map((r) => {
      const { changes: _c, recordKey: _k, relatedId: _r, actorUserId: _u, ...item } = toRow(r as Raw);
      return item;
    }),
  };
}

/** The newest id this viewer may see — the live-sync cue that something was logged. */
export async function latestActivityId(crsId: number | null): Promise<string> {
  let q = supabaseAdmin().from('activity_log').select('id').order('id', { ascending: false }).limit(1);
  if (crsId !== null) q = q.eq('crs_id', crsId);
  const { data, error } = await q;
  if (error) return logMissing(error) ? 'not-installed' : 'unavailable';
  return String(data?.[0]?.id ?? 0);
}
