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
 *            reload, then let the next tick re-send what still differs
 *   autosave dirty check every 5 s; flush with keepalive on hide/pagehide
 *
 * Store keys and JSON shapes are exactly the engine's (BACKUP_STORES), so the
 * database needs no migration and the Excel import tool keeps working.
 *
 * React reads go through useStore()/useDataStatus() (useSyncExternalStore).
 * Writes go through set()/update(), which replace the top-level reference —
 * that reference change is what wakes subscribed components.
 */
import { useSyncExternalStore } from 'react';
import type { EngineUser } from '@/lib/authClient';

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
  | '__commodityMaster';

export type DataStatus = 'idle' | 'loading' | 'ready' | 'error';

const POLL_MS = 5000;

class CrsDataStore {
  private stores: Partial<Record<StoreKey, unknown>> = {};
  private versions: Partial<Record<StoreKey, number>> = {};
  /** JSON last confirmed to be on the server — the dirty check compares against this. */
  private serverJson: Partial<Record<StoreKey, string>> = {};
  private listeners = new Set<() => void>();
  private timer: ReturnType<typeof setInterval> | null = null;
  private saving = false;
  private loading = false;

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

  async save(opts?: { keepalive?: boolean }): Promise<boolean> {
    if (this.status !== 'ready' || this.saving) return false;
    const payload = this.collectChanged();
    if (!payload) return false;

    this.saving = true;
    try {
      const r = await fetch('/api/state', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
        keepalive: !!opts?.keepalive,
      });
      const body = await r.json().catch(() => ({}));

      if (r.status === 409) {
        // Someone else wrote first — their data is authoritative. Reload; the
        // next tick re-sends whatever of ours is still genuinely different.
        await this.load();
        return false;
      }
      if (!r.ok) throw new Error(body?.error || `server returned ${r.status}`);

      const vs = (body?.versions ?? {}) as Record<string, number>;
      for (const key of Object.keys(payload.stores) as StoreKey[]) {
        if (vs[key] !== undefined) this.versions[key] = vs[key];
        this.serverJson[key] = JSON.stringify(payload.stores[key]);
      }
      this.lastError = '';
      return true;
    } catch (err) {
      this.lastError = err instanceof Error ? err.message : String(err);
      this.emit();
      return false;
    } finally {
      this.saving = false;
    }
  }

  // ── Autosave lifecycle (owned by the (app) layout) ────────────────────────
  start() {
    this.stop();
    this.timer = setInterval(() => void this.save(), POLL_MS);
    window.addEventListener('visibilitychange', this.flushHidden);
    window.addEventListener('pagehide', this.flush);
  }

  stop() {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
    window.removeEventListener('visibilitychange', this.flushHidden);
    window.removeEventListener('pagehide', this.flush);
  }

  private flush = () => {
    void this.save({ keepalive: true });
  };
  private flushHidden = () => {
    if (document.visibilityState === 'hidden') void this.save({ keepalive: true });
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
