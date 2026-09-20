'use client';

/**
 * Typed client data layer for the converted (React) routes.
 *
 * Same wire contract and semantics as the legacy persistence layer
 * (src/legacy/36-persistence.js), so both apps can run against the same
 * database during the conversion:
 *
 *   load     GET  /api/state  → all stores + versions; GET /api/users → roster
 *   save     POST /api/state  → only stores whose JSON changed, each with the
 *            version it was read at; 409 means someone else saved first —
 *            this client's changes are laid over theirs and sent again
 *   autosave dirty check every 5 s; flush with keepalive on hide/pagehide
 *   live     GET  /api/sync every 4 s while visible → which stores changed;
 *            GET /api/state?keys=… for just those (see "Live sync" below)
 *
 * Store keys and JSON shapes are exactly the engine's (BACKUP_STORES), so the
 * database needs no migration and the Excel import tool keeps working.
 *
 * React reads go through useStore()/useDataStatus() (useSyncExternalStore).
 * Writes go through set()/update(), which replace the top-level reference —
 * that reference change is what wakes subscribed components.
 */
import { useEffect, useSyncExternalStore } from 'react';
import type { EngineUser } from '@/lib/authClient';
import { rebaseStore } from '@/lib/storeMerge';

export type StoreKey =
  | 'entryStore'
  | 'inspectionStore'
  | 'monthlyStore'
  | 'meManualStore'
  | 'meSourceStore'
  | 'meRemitStore'
  | 'meGunnyStore'
  | 'meCardStore'
  | 'salesCloseStore'
  | 'receiptStore'
  | 'meAllotStore'
  | 'meCardConfirmed'
  | 'meAdvanceStore'
  | '__counters'
  | '__config'
  | '__accounts'
  | '__shops'
  | '__commodities'
  | '__crsMaster'
  | '__holidays'
  | '__commodityMaster'
  | '__pvOfficers'
  /** Read-only here: which shops have used their one-time Initial Opening (engine/stockInit.ts). Only the server writes it. */
  | '__stockInit'
  /** Read-only here: Payment Access Control switches (payments/gate.ts). Only /api/payments/gate writes it. */
  | '__paymentGate';

export type DataStatus = 'idle' | 'loading' | 'ready' | 'error';

/**
 * Things a screen can wait on that are not stores: the clear-request record
 * (served scoped by /api/clear-requests), payment orders, the activity log and
 * the signed-in person's notifications (their own tables). Each is a revision that changes when the thing does.
 */
export type LiveTopic = 'clears' | 'payments' | 'activity' | 'inbox';
type WatchedTopic = Exclude<LiveTopic, 'clears'>;

const POLL_MS = 5000;
const LIVE_MS = 4000;
/** saveConfirmed(): how long it waits for a save already in flight — 25 × 120 ms = 3 s. */
const FLUSH_TRIES = 25;
const FLUSH_WAIT_MS = 120;

/** A save that keeps meeting fresh conflicts gives up after this many rounds. */
const REBASE_ROUNDS = 3;

type Fetched = { stores: Record<string, unknown>; versions: Record<string, number> };
type EditHints = Record<string, Record<string, 'edited' | 'closed'>>;

class CrsDataStore {
  private stores: Partial<Record<StoreKey, unknown>> = {};
  private versions: Partial<Record<StoreKey, number>> = {};
  /** JSON last confirmed to be on the server — the dirty check compares against this. */
  private serverJson: Partial<Record<StoreKey, string>> = {};
  private listeners = new Set<() => void>();
  private timer: ReturnType<typeof setInterval> | null = null;
  private liveTimer: ReturnType<typeof setInterval> | null = null;
  private saving = false;
  private loading = false;
  private polling = false;
  private revisions: Record<LiveTopic, number | string> = { clears: 0, payments: '', activity: '', inbox: '' };
  private watchers: Record<WatchedTopic, number> = { payments: 0, activity: 0, inbox: 0 };
  /** Records the person edited since the last save — sent so the activity log can tell their edit from a recalculation. */
  private edits: EditHints = {};

  status: DataStatus = 'idle';
  lastError = '';
  users: EngineUser[] = [];

  // ── React wiring ──────────────────────────────────────────────────────────
  subscribe = (fn: () => void) => {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  };
  private emit() {
    this.listeners.forEach((fn) => fn());
  }

  get<T = unknown>(key: StoreKey): T | undefined {
    return this.stores[key] as T | undefined;
  }

  /** Replace a store's value outright. */
  set(key: StoreKey, value: unknown) {
    this.stores[key] = value;
    this.emit();
  }

  /** Shallow-clone-and-mutate helper: update('meCardStore', d => { d[k] = v; }) */
  update<T extends object>(key: StoreKey, mutate: (draft: T) => void) {
    const cur = (this.stores[key] ?? {}) as T;
    const draft = (Array.isArray(cur) ? [...(cur as unknown[])] : { ...cur }) as T;
    mutate(draft);
    this.stores[key] = draft;
    this.emit();
  }

  /**
   * Say which record the person is saving by hand — the day sheet on Daily
   * Entry, the month on Monthly Entry. Only a label for the activity log: the
   * server still logs exactly what changed, and uses this to tell the edited
   * record from the later days a save recalculates (activityLog/core.ts).
   */
  markEdited(store: StoreKey, key: string, kind: 'edited' | 'closed' = 'edited') {
    (this.edits[store] ??= {})[key] = kind;
  }

  // ── Load ──────────────────────────────────────────────────────────────────
  async load(): Promise<boolean> {
    if (this.loading) return false;
    this.loading = true;
    this.status = this.status === 'ready' ? 'ready' : 'loading';
    this.emit();
    try {
      const [stateRes, usersRes] = await Promise.all([
        fetch('/api/state', { headers: { Accept: 'application/json' } }),
        fetch('/api/users', { headers: { Accept: 'application/json' } }),
      ]);
      if (!stateRes.ok) throw new Error(`state: server returned ${stateRes.status}`);
      const payload = await stateRes.json();
      const stores = (payload?.stores ?? {}) as Record<string, unknown>;
      const versions = (payload?.versions ?? {}) as Record<string, number>;

      for (const [key, value] of Object.entries(stores)) {
        this.stores[key as StoreKey] = value;
        this.versions[key as StoreKey] = versions[key];
        this.serverJson[key as StoreKey] = JSON.stringify(value);
      }

      if (usersRes.ok) {
        const ub = await usersRes.json().catch(() => ({}));
        this.users = ub?.users ?? [];
      }

      this.status = 'ready';
      this.lastError = '';
      return true;
    } catch (err) {
      this.status = 'error';
      this.lastError = err instanceof Error ? err.message : String(err);
      return false;
    } finally {
      this.loading = false;
      this.emit();
    }
  }

  /** Re-read just the users roster (after a CRUD call on /api/users). */
  async reloadUsers(): Promise<void> {
    try {
      const r = await fetch('/api/users', { headers: { Accept: 'application/json' } });
      if (!r.ok) return;
      const b = await r.json().catch(() => ({}));
      this.users = b?.users ?? this.users;
      this.emit();
    } catch {
      /* the next full load refreshes it */
    }
  }

  /** Just these stores, as the server holds them now. */
  private async fetchStores(keys: string[]): Promise<Fetched | null> {
    try {
      const r = await fetch(`/api/state?keys=${encodeURIComponent(keys.join(','))}`, { cache: 'no-store', headers: { Accept: 'application/json' } });
      if (!r.ok) return null;
      const b = await r.json().catch(() => null);
      return b ? { stores: b.stores ?? {}, versions: b.versions ?? {} } : null;
    } catch {
      return null;
    }
  }

  /**
   * Take the server's copy of one store — keeping whatever this client changed
   * and has not saved yet, laid over it record by record (storeMerge.ts). With
   * nothing unsaved it is simply the server's copy.
   */
  private absorb(key: StoreKey, remote: unknown, version: number) {
    const base = this.serverJson[key];
    const localJson = JSON.stringify(this.stores[key]);
    this.stores[key] =
      localJson === undefined || localJson === base ? remote : rebaseStore(key, base === undefined ? undefined : JSON.parse(base), this.stores[key], remote);
    this.versions[key] = version;
    this.serverJson[key] = JSON.stringify(remote);
  }

  // ── Save ──────────────────────────────────────────────────────────────────
  private collectChanged() {
    const stores: Record<string, unknown> = {};
    const versions: Record<string, number> = {};
    let any = false;
    for (const key of Object.keys(this.stores) as StoreKey[]) {
      const json = JSON.stringify(this.stores[key]);
      if (json === undefined || json === this.serverJson[key]) continue;
      stores[key] = JSON.parse(json);
      versions[key] = this.versions[key] ?? 0;
      any = true;
    }
    return any ? { stores, versions } : null;
  }

  /**
   * Save, and answer the question a save CONFIRMATION has to ask: is what is
   * on this screen now in the database?
   *
   * `save()` answers false for three different things — a refusal, a save
   * already in flight, and nothing left to send — and only the first is a
   * failure. The autosave beat runs every 5 s, so a clerk pressing save can
   * easily land on one of the other two and be told their day was not saved
   * when it was. So this waits for an in-flight save to finish and then asks
   * again; "nothing left to send" at that point means another round carried
   * these records, which is stored (unless it came back refused, which leaves
   * the reason in lastError).
   *
   * Nothing else changes: the save path itself is untouched.
   */
  async saveConfirmed(): Promise<boolean> {
    for (let i = 0; i < FLUSH_TRIES; i++) {
      if (this.status !== 'ready') return false;
      if (!this.saving) {
        if (!this.collectChanged()) return !this.lastError;
        return await this.save();
      }
      await new Promise((r) => setTimeout(r, FLUSH_WAIT_MS));
    }
    return false;
  }

  async save(opts?: { keepalive?: boolean }): Promise<boolean> {
    if (this.status !== 'ready' || this.saving) return false;
    if (!this.collectChanged()) return false;

    this.saving = true;
    // Taken now so a record marked while this save is in flight rides the next one.
    const hints = this.edits;
    this.edits = {};
    let sent = false;
    try {
      for (let round = 0; round < REBASE_ROUNDS; round++) {
        const payload = this.collectChanged();
        // Nothing left to send after a rebase: somebody saved the same thing.
        if (!payload) {
          sent = round > 0;
          return sent;
        }

        const r = await fetch('/api/state', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(Object.keys(hints).length ? { ...payload, activity: { edited: hints } } : payload),
          keepalive: !!opts?.keepalive,
        });
        const body = await r.json().catch(() => ({}));

        if (r.status === 409) {
          // Someone else wrote first. Every shop shares these rows, so this is
          // ordinary, not an error: whatever did land is current, and each
          // conflicting store is fetched and this client's changes laid over
          // it (storeMerge.ts) — then sent again. Reloading instead would throw
          // away the sheet the clerk just watched save.
          const landed = (body?.versions ?? {}) as Record<string, number>;
          for (const key of Object.keys(landed) as StoreKey[]) {
            this.versions[key] = landed[key];
            this.serverJson[key] = JSON.stringify(payload.stores[key]);
          }
          const conflicts = (Array.isArray(body?.conflicts) ? (body.conflicts as string[]) : Object.keys(payload.stores)).filter((k) => !(k in landed));
          if (conflicts.length) {
            const fresh = await this.fetchStores(conflicts);
            if (!fresh) {
              await this.load();
              return false;
            }
            for (const [key, value] of Object.entries(fresh.stores)) this.absorb(key as StoreKey, value, Number(fresh.versions[key]) || 0);
            this.emit();
          }
          continue;
        }
        if (r.status === 403) {
          // A REFUSAL, not a race — a clear needing approval, or a locked field.
          // This write will never be accepted, so holding on to it leaves the
          // screen showing something the database does not have (a receipt that
          // looks deleted but is not) and re-sends it on every autosave, filling
          // the audit trail with the same rejection. Take the server's copy back
          // and keep the reason: load() clears lastError on the way through.
          sent = true; // refused for good — its hints go with it
          const why = body?.error || 'That change was refused.';
          await this.load();
          this.lastError = why;
          this.emit();
          return false;
        }
        if (!r.ok) throw new Error(body?.error || `server returned ${r.status}`);

        const vs = (body?.versions ?? {}) as Record<string, number>;
        for (const key of Object.keys(payload.stores) as StoreKey[]) {
          if (vs[key] !== undefined) this.versions[key] = vs[key];
          this.serverJson[key] = JSON.stringify(payload.stores[key]);
        }
        this.lastError = '';
        sent = true;
        return true;
      }
      return false;
    } catch (err) {
      this.lastError = err instanceof Error ? err.message : String(err);
      this.emit();
      return false;
    } finally {
      // Not delivered: keep the labels for the save that will carry the edit.
      if (!sent) {
        for (const [store, keys] of Object.entries(hints)) this.edits[store] = { ...keys, ...(this.edits[store] ?? {}) };
      }
      this.saving = false;
    }
  }

  // ── Live sync ─────────────────────────────────────────────────────────────
  // A shop saves; an administrator's open screen shows it within a few
  // seconds, and the other way round — an approved clear, a payment decision.
  // /api/sync answers with store VERSIONS only, so a quiet beat costs a few
  // dozen integers; a store someone else wrote is then fetched on its own and
  // taken in, with this client's unsaved changes laid over it. Only the
  // components reading that store re-render. Why this is not Supabase
  // Realtime is explained in api/sync/route.ts.

  getRevision(topic: LiveTopic): number | string {
    return this.revisions[topic];
  }

  /** A screen showing orders or the activity log is open: include it in the beat. */
  watch(topic: LiveTopic): () => void {
    if (topic === 'clears') return () => undefined;
    this.watchers[topic]++;
    void this.poll();
    return () => {
      this.watchers[topic] = Math.max(0, this.watchers[topic] - 1);
    };
  }

  async poll(): Promise<void> {
    if (this.status !== 'ready' || this.polling || this.loading) return;
    if (typeof document !== 'undefined' && document.visibilityState !== 'visible') return;
    this.polling = true;
    try {
      const topics = (Object.keys(this.watchers) as WatchedTopic[]).filter((t) => this.watchers[t] > 0);
      const r = await fetch(`/api/sync${topics.length ? `?topics=${topics.join(',')}` : ''}`, { cache: 'no-store', headers: { Accept: 'application/json' } });
      if (!r.ok) return;
      const b = (await r.json().catch(() => null)) as { versions?: Record<string, number>; clears?: number; payments?: string; activity?: string; inbox?: string } | null;
      if (!b) return;

      let changed = false;
      for (const topic of ['clears', 'payments', 'activity', 'inbox'] as const) {
        const next = b[topic];
        if ((typeof next === 'number' || typeof next === 'string') && next !== this.revisions[topic]) {
          this.revisions = { ...this.revisions, [topic]: next };
          changed = true;
        }
      }

      const stale = Object.entries(b.versions ?? {})
        .filter(([key, v]) => Number(v) > (this.versions[key as StoreKey] ?? 0))
        .map(([key]) => key);
      if (stale.length && !this.saving) {
        const fresh = await this.fetchStores(stale);
        // A save that began while this was in flight still carries the
        // versions it read; taking the stores in under it now would hide its
        // conflict. It will meet the 409 and rebase — or the next beat will.
        if (fresh && !this.saving && !this.loading) {
          for (const [key, value] of Object.entries(fresh.stores)) {
            const v = Number(fresh.versions[key]) || 0;
            if (v <= (this.versions[key as StoreKey] ?? 0)) continue;
            this.absorb(key as StoreKey, value, v);
            changed = true;
          }
        }
      }
      if (changed) this.emit();
    } catch {
      /* offline for a moment — the next beat tries again */
    } finally {
      this.polling = false;
    }
  }

  // ── Lifecycle (owned by the (app) layout) ─────────────────────────────────
  start() {
    this.stop();
    this.timer = setInterval(() => void this.save(), POLL_MS);
    this.liveTimer = setInterval(() => void this.poll(), LIVE_MS);
    window.addEventListener('visibilitychange', this.onVisibility);
    window.addEventListener('focus', this.onFocus);
    window.addEventListener('pagehide', this.flush);
  }

  stop() {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
    if (this.liveTimer) {
      clearInterval(this.liveTimer);
      this.liveTimer = null;
    }
    window.removeEventListener('visibilitychange', this.onVisibility);
    window.removeEventListener('focus', this.onFocus);
    window.removeEventListener('pagehide', this.flush);
  }

  private flush = () => {
    void this.save({ keepalive: true });
  };
  /** Leaving: save what is typed. Coming back: catch up straight away. */
  private onVisibility = () => {
    if (document.visibilityState === 'hidden') void this.save({ keepalive: true });
    else void this.poll();
  };
  private onFocus = () => {
    void this.poll();
  };
}

export const crsData = new CrsDataStore();

/** Subscribe a component to one store. Reference changes on every write. */
export function useStore<T = unknown>(key: StoreKey): T | undefined {
  return useSyncExternalStore(
    crsData.subscribe,
    () => crsData.get<T>(key),
    () => undefined,
  );
}

/**
 * A value that changes whenever the topic does — put it in an effect's
 * dependencies to re-fetch when, say, a clear request is decided elsewhere.
 * Starts at 0 / '' and settles on the first beat.
 */
export function useLiveRevision(topic: LiveTopic): number | string {
  useEffect(() => crsData.watch(topic), [topic]);
  return useSyncExternalStore(
    crsData.subscribe,
    () => crsData.getRevision(topic),
    () => (topic === 'clears' ? 0 : ''),
  );
}

export function useDataStatus(): { status: DataStatus; lastError: string } {
  const status = useSyncExternalStore(
    crsData.subscribe,
    () => crsData.status,
    () => 'idle' as DataStatus,
  );
  const lastError = useSyncExternalStore(
    crsData.subscribe,
    () => crsData.lastError,
    () => '',
  );
  return { status, lastError };
}

export function useUsers(): EngineUser[] {
  return useSyncExternalStore(
    crsData.subscribe,
    () => crsData.users,
    () => [],
  );
}
