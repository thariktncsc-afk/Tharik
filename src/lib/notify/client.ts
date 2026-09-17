/**
 * The browser side of notifications: one shared poll, and the calls the
 * screens make.
 *
 * WHY POLLING RATHER THAN SUPABASE REALTIME. Realtime delivers row changes to
 * a browser subscribed with the public key, and it respects row-level
 * security. This schema deliberately has RLS on with no permissive policy
 * (there is no auth.uid() — the app keeps its own login), so a subscribed
 * browser would receive nothing. Making it receive something would mean either
 * a policy that lets the public key read notifications — every shop's, since
 * there is no user to scope it to — or a public broadcast channel anyone who
 * guessed its name could listen on. Both would leak one shop's notifications
 * to another, and both would break the project's rule that the browser never
 * talks to Supabase directly.
 *
 * So the bell rides the app's live-sync beat (dataStore.ts, every 4 seconds
 * while visible): /api/sync answers with this person's unread count and newest
 * notification id, and when that changes the bell fetches its summary. It also
 * asks immediately when the tab comes back into view and after the person's
 * own actions, and on a slow timer of its own in case the beat is not running.
 * A request submitted at a shop reaches an administrator's badge within a beat
 * with nobody pressing refresh, and nothing crosses a shop boundary on the way.
 *
 * ONE POLL FOR THE WHOLE SHELL. The bell, the popup and the history page read
 * the same store, so three components do not mean three timers.
 */
import { useSyncExternalStore } from 'react';
import { crsData } from '@/lib/dataStore';
import type { Category, InboxItem, MarkAction, Priority, ReadStats, RecipientReport, SentMessage } from './core';

export type Summary = { installed: boolean; unread: number; latestAt: string | null; popups: InboxItem[] };

/** The fallback only — the live beat is what normally moves the badge. */
const POLL_MS = 30_000;
const EMPTY: Summary = { installed: true, unread: 0, latestAt: null, popups: [] };

class InboxStore {
  private summary: Summary = EMPTY;
  private revision = 0;
  private listeners = new Set<() => void>();
  private timer: ReturnType<typeof setInterval> | null = null;
  private inflight = false;
  private again = false;
  private beat: string | number = '';
  private unwatch: (() => void) | null = null;
  private unsubscribe: (() => void) | null = null;

  subscribe = (fn: () => void) => {
    this.listeners.add(fn);
    return () => {
      this.listeners.delete(fn);
    };
  };
  getSummary = () => this.summary;
  getRevision = () => this.revision;

  private emit() {
    this.revision++;
    for (const fn of this.listeners) fn();
  }

  async refresh(): Promise<void> {
    // A beat that lands while a fetch is out must not be lost — it may be the
    // very notification the fetch in flight was too early to see.
    if (this.inflight) {
      this.again = true;
      return;
    }
    this.inflight = true;
    try {
      const r = await fetch('/api/notifications/summary', { cache: 'no-store', headers: { Accept: 'application/json' } });
      if (!r.ok) return;
      const b = (await r.json().catch(() => ({}))) as Partial<Summary>;
      const next: Summary = {
        installed: b.installed !== false,
        unread: Number(b.unread) || 0,
        latestAt: b.latestAt ?? null,
        popups: Array.isArray(b.popups) ? b.popups : [],
      };
      // Only a real change re-renders the shell — a quiet poll every fifteen
      // seconds must not repaint every page.
      if (JSON.stringify(next) !== JSON.stringify(this.summary)) {
        this.summary = next;
        this.emit();
      }
    } catch {
      /* offline for a moment — the next tick tries again */
    } finally {
      this.inflight = false;
      if (this.again) {
        this.again = false;
        void this.refresh();
      }
    }
  }

  private onBeat = () => {
    const next = crsData.getRevision('inbox');
    if (next === this.beat) return;
    this.beat = next;
    void this.refresh();
  };

  private onVisible = () => {
    if (document.visibilityState === 'visible') void this.refresh();
  };

  start() {
    this.stop();
    void this.refresh();
    this.timer = setInterval(() => {
      // A background tab does not need its badge kept current; it catches up
      // the moment it is looked at.
      if (document.visibilityState === 'visible') void this.refresh();
    }, POLL_MS);
    document.addEventListener('visibilitychange', this.onVisible);
    window.addEventListener('focus', this.onVisible);
    this.beat = crsData.getRevision('inbox');
    this.unwatch = crsData.watch('inbox');
    this.unsubscribe = crsData.subscribe(this.onBeat);
  }

  stop() {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
    document.removeEventListener('visibilitychange', this.onVisible);
    window.removeEventListener('focus', this.onVisible);
    this.unwatch?.();
    this.unsubscribe?.();
    this.unwatch = this.unsubscribe = null;
  }

  /** After this person did something: redraw lists now, and re-count. */
  changed() {
    this.emit();
    void this.refresh();
  }

  reset() {
    this.summary = EMPTY;
    this.emit();
  }
}

export const inbox = new InboxStore();

export function useInboxSummary(): Summary {
  return useSyncExternalStore(inbox.subscribe, inbox.getSummary, () => EMPTY);
}

/** Bumps whenever anything in the inbox may have changed — a cue to refetch a list. */
export function useInboxRevision(): number {
  return useSyncExternalStore(inbox.subscribe, inbox.getRevision, () => 0);
}

async function json<T>(r: Response): Promise<T> {
  const b = (await r.json().catch(() => ({}))) as T & { error?: string };
  if (!r.ok) throw new Error(b?.error || `server returned ${r.status}`);
  return b;
}

export async function fetchInbox(opts: { category?: Category | null; unread?: boolean; requests?: boolean; limit?: number; before?: string | null }) {
  const q = new URLSearchParams();
  if (opts.category) q.set('category', opts.category);
  if (opts.unread) q.set('unread', '1');
  if (opts.requests) q.set('requests', '1');
  if (opts.limit) q.set('limit', String(opts.limit));
  if (opts.before) q.set('before', opts.before);
  return json<{ installed: boolean; items: InboxItem[] }>(await fetch(`/api/notifications?${q}`, { cache: 'no-store' }));
}

export async function markNotification(id: number, action: MarkAction): Promise<InboxItem | null> {
  const b = await json<{ item: InboxItem }>(
    await fetch(`/api/notifications/${id}`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action }) }),
  );
  inbox.changed();
  return b.item ?? null;
}

export async function markAllRead(category: Category | null, requests = false): Promise<number> {
  const b = await json<{ marked: number }>(
    await fetch('/api/notifications', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action: 'read-all', category, requests }) }),
  );
  inbox.changed();
  return b.marked ?? 0;
}

export async function fetchSent() {
  return json<{ installed: boolean; messages: SentMessage[] }>(await fetch('/api/messages', { cache: 'no-store' }));
}

export async function fetchReport(id: number) {
  return json<{ recipients: RecipientReport[]; stats: ReadStats }>(await fetch(`/api/messages/${id}`, { cache: 'no-store' }));
}

export async function postMessage(body: { title: string; message: string; priority: Priority; audience: unknown }) {
  return json<{ id: number; recipients: number }>(
    await fetch('/api/messages', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }),
  );
}

// ── Presentation shared by the bell, the popup and the pages ──────────────

/** "Today, 09:15 pm" — in the reader's own time zone, from the stored UTC time. */
export function fmtWhen(iso: string | null | undefined): string {
  if (!iso) return '—';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '—';
  const t = d.toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit' });
  const today = new Date();
  if (d.toDateString() === today.toDateString()) return `Today, ${t}`;
  if (new Date(today.getTime() - 86_400_000).toDateString() === d.toDateString()) return `Yesterday, ${t}`;
  return `${d.toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' })}, ${t}`;
}

export type Filter = 'all' | 'unread' | 'requests' | Category;

export const FILTER_LABEL: Record<Filter, string> = {
  all: 'All',
  unread: 'Unread',
  requests: 'Approval Requests',
  payments: 'Payments',
  clear: 'Clear Requests',
  approvals: 'Other Approvals',
  messages: 'Admin Messages',
  system: 'System',
};

/** Administrators get every request filter; shop staff only the ones that can hold anything for them. */
export const filtersFor = (isAdmin: boolean): Filter[] =>
  isAdmin ? ['all', 'unread', 'requests', 'payments', 'clear', 'messages'] : ['all', 'unread', 'messages', 'payments', 'clear'];

export const toQuery = (f: Filter) => ({
  category: f === 'all' || f === 'unread' || f === 'requests' ? null : f,
  unread: f === 'unread',
  requests: f === 'requests',
});

/** "Today" / "Yesterday" / "14 Sept 2026" — the heading a notification is listed under. */
export function dayHeading(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  const today = new Date();
  if (d.toDateString() === today.toDateString()) return 'Today';
  if (new Date(today.getTime() - 86_400_000).toDateString() === d.toDateString()) return 'Yesterday';
  return d.toLocaleDateString('en-IN', { weekday: 'short', day: '2-digit', month: 'short', year: 'numeric' });
}

export function iconFor(item: Pick<InboxItem, 'type' | 'status'>): string {
  switch (item.type) {
    case 'PAYMENT_REQUEST':
    case 'DOWNLOAD_APPROVAL':
      return '💳';
    case 'CLEAR_REQUEST':
    case 'DELETE_REQUEST':
      return '🔒';
    case 'APPROVAL_RESULT':
      return item.status === 'rejected' ? '❌' : '✅';
    case 'MESSAGE':
      return '📣';
    case 'SYSTEM':
      return '⚙️';
    default:
      return '📝';
  }
}

export const PRIORITY_STYLE: Record<Priority, { label: string; fg: string; bg: string; bar: string }> = {
  normal: { label: '', fg: '#475569', bg: '#F1F5F9', bar: 'transparent' },
  important: { label: 'Important', fg: '#92400E', bg: '#FEF3C7', bar: '#F59E0B' },
  urgent: { label: 'Urgent', fg: '#FFFFFF', bg: '#DC2626', bar: '#DC2626' },
};

export function statusStyle(status: string): { fg: string; bg: string } {
  switch (status) {
    case 'pending':
      return { fg: '#92400E', bg: '#FEF3C7' };
    case 'approved':
    case 'cleared':
      return { fg: '#166534', bg: '#DCFCE7' };
    case 'rejected':
      return { fg: '#991B1B', bg: '#FEE2E2' };
    case 'cancelled':
      return { fg: '#475569', bg: '#F1F5F9' };
    default:
      return { fg: '#475569', bg: '#F1F5F9' };
  }
}
