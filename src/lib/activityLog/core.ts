/**
 * The activity log's rules: what an action is called, which shop and which
 * date it belongs to, and what it changed — kept pure so they can be proved
 * without a database (tools/verify-activity-log.mjs).
 *
 * WHERE ROWS COME FROM. /api/state is the one door every store write goes
 * through, so it compares what was stored with what was written, record by
 * record, and logs what actually moved (diffStateWrite). The routes that change
 * things outside crs_state — clear decisions, payments, statements, users,
 * sign-in — build their own rows with the helpers below. Writing happens only
 * when data changes on the server, so live sync fetching a store, a rebased
 * re-send of the same edit, or a save of identical content never logs twice.
 *
 * USER OR SYSTEM. A save of one day can move many: later days re-carry their
 * Opening (engine/rechain.ts), a register receipt moves its day's Receipt and
 * Closing, a reconcile adjusts the manual month's copy of a receipt. Those rows
 * are `source: 'system'`, `action: 'recalculated'` — attributed to the person
 * whose action caused them, never presented as if they keyed every day. The
 * browser names the record the person actually edited (EditHints); anything
 * else whose only changes are carried figures is the system's.
 *
 * TWO DATES. The row's `at` is when it happened (set by the database). The
 * entry date or month here is the date the DATA belongs to, taken from the
 * record's own key — never from the clock.
 */
import { CRS29_KERO, DSS_A, DSS_B } from '@/lib/engine/commodities';
import { isSystemRecord } from '@/lib/clearGuard';

export type ActivityAction =
  | 'created'
  | 'updated'
  | 'deleted'
  | 'cleared'
  | 'recalculated'
  | 'closed'
  | 'requested'
  | 'approved'
  | 'rejected'
  | 'cancelled'
  | 'failed'
  | 'submitted'
  | 'viewed'
  | 'printed'
  | 'exported'
  | 'refused'
  | 'signed-in';

export type ActivitySource = 'user' | 'system';
export type Change = { label: string; before: string; after: string };

/** What a route or the store diff hands to the writer; the writer adds who and when. */
export type ActivityDraft = {
  crsId: number | null;
  module: string;
  action: ActivityAction;
  source: ActivitySource;
  entryDate?: string | null;
  entryMonth?: number | null;
  entryYear?: number | null;
  recordKey?: string | null;
  summary?: string;
  changes?: Change[];
  relatedId?: string | null;
};

/** A stored row, as the log page receives it. */
export type ActivityRow = {
  id: number;
  at: string;
  actorUserId: number | null;
  actorUsername: string;
  actorName: string;
  actorRole: string;
  source: ActivitySource;
  crsId: number | null;
  shopName: string;
  module: string;
  action: ActivityAction;
  entryDate: string | null;
  entryMonth: number | null;
  entryYear: number | null;
  recordKey: string | null;
  summary: string;
  changes: Change[];
  relatedId: string | null;
};

/** The dashboard's short line — a row without its change detail. */
export type FeedItem = Omit<ActivityRow, 'changes' | 'recordKey' | 'relatedId' | 'actorUserId'>;

/** Which record the person edited in this save, and whether it closed something. */
export type EditHints = Record<string, Record<string, 'edited' | 'closed'>>;

export const ACTION_LABEL: Record<ActivityAction, string> = {
  created: 'Created',
  updated: 'Updated',
  deleted: 'Deleted',
  cleared: 'Cleared',
  recalculated: 'System Update',
  closed: 'Closed',
  requested: 'Requested',
  approved: 'Approved',
  rejected: 'Rejected',
  cancelled: 'Withdrawn',
  failed: 'Failed',
  submitted: 'Submitted',
  viewed: 'Viewed',
  printed: 'Printed',
  exported: 'Exported',
  refused: 'Refused',
  'signed-in': 'Signed in',
};

export const ACTIONS = Object.keys(ACTION_LABEL) as ActivityAction[];

export const MODULES = [
  'Daily Sales',
  'Remittance',
  'Monthly Entry',
  'Sales Close',
  'Receipt',
  'Inspection',
  'Gunny',
  'Card Details',
  'Allotment',
  'Clear Request',
  'Payment',
  'Statements',
  'DSS',
  'Users',
  'Masters',
  'Session',
];

export const roleLabel = (role: string) => {
  const r = String(role ?? '').toUpperCase();
  if (r === 'ADMIN') return 'Admin';
  if (r === 'BC') return 'BC';
  if (r === 'PACKER') return 'Packer';
  return role || '';
};

// ── Formatting ─────────────────────────────────────────────────────────────

type Loose = Record<string, unknown>;
const isObj = (v: unknown): v is Loose => !!v && typeof v === 'object' && !Array.isArray(v);
const obj = (v: unknown): Loose => (isObj(v) ? v : {});
const num = (v: unknown) => {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
};
const near = (a: unknown, b: unknown) => Math.abs(num(a) - num(b)) < 0.0005;
const kg = (v: unknown) => String(+num(v).toFixed(3));
const rupees = (v: unknown) => '₹' + num(v).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const dmy = (iso: string) => (/^\d{4}-\d{2}-\d{2}$/.test(iso) ? iso.split('-').reverse().join('-') : iso || '—');
const MONTHS = ['', 'Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

const NAMES = new Map<string, string>([...DSS_A, ...DSS_B, CRS29_KERO].map((c) => [c.id, c.en]));
export const commodityName = (id: string) => NAMES.get(id) ?? id;

const leafText = (v: unknown): string => {
  if (v === undefined || v === null || v === '') return '—';
  if (typeof v === 'number') return kg(v);
  if (typeof v === 'boolean') return v ? 'Yes' : 'No';
  return String(v);
};

/** "16-09-2026", "Sep 2026" or "" — what the entry's date is called on screen. */
export function entryLabel(i: { entryDate?: string | null; entryMonth?: number | null; entryYear?: number | null }): string {
  if (i.entryDate) return dmy(String(i.entryDate).slice(0, 10));
  if (i.entryMonth && i.entryYear) return `${MONTHS[i.entryMonth]} ${i.entryYear}`;
  return '';
}

/** "Daily Sales · CRS 7 · 16-09-2026 — Updated" */
export function feedLine(i: Pick<FeedItem, 'module' | 'crsId' | 'action' | 'entryDate' | 'entryMonth' | 'entryYear'>): string {
  const parts = [i.module];
  if (i.crsId) parts.push(`CRS ${i.crsId}`);
  const when = entryLabel(i);
  if (when) parts.push(when);
  return `${parts.join(' · ')} — ${ACTION_LABEL[i.action] ?? i.action}`;
}

const DAY_KEY = /^(\d+)_(\d{4}-\d{2}-\d{2})$/;
const MONTH_KEY = /^(\d+)_(\d{1,2})_(\d{4})$/;

/** Shop and entry date (or month) from a store key. */
export function entryOf(key: string): Pick<ActivityDraft, 'crsId' | 'entryDate' | 'entryMonth' | 'entryYear'> {
  const d = DAY_KEY.exec(key);
  if (d) return { crsId: Number(d[1]), entryDate: d[2] };
  const m = MONTH_KEY.exec(key);
  if (m) return { crsId: Number(m[1]), entryMonth: Number(m[2]), entryYear: Number(m[3]) };
  return { crsId: null };
}

const MAX_CHANGES = 150;
const summarise = (changes: Change[], fallback: string) => {
  if (!changes.length) return fallback;
  const head = changes.slice(0, 2).map((c) => `${c.label} ${c.before} → ${c.after}`).join('; ');
  return changes.length > 2 ? `${head} (+${changes.length - 2} more)` : head;
};

// ── Day sheets ─────────────────────────────────────────────────────────────

const ROW_FIELDS = [
  ['open', 'Opening'],
  ['receipt', 'Receipt'],
  ['sales', 'Sales'],
  ['excess', 'Excess'],
  ['shortage', 'Shortage'],
  ['transfer', 'Transfer'],
  ['total', 'Total'],
  ['close', 'Closing'],
  ['amount', 'Amount'],
] as const;

/** Figures that move without anybody keying them: carried, synced or derived. */
const CARRIED = new Set<string>(['open', 'receipt', 'excess', 'shortage', 'transfer', 'total', 'close', 'amount']);

const remitTotal = (s: Loose) =>
  Array.isArray(s.remits) && s.remits.length ? (s.remits as unknown[]).reduce<number>((t, r) => t + num(obj(r).amount), 0) : num(s.remitAmount);

function dayChanges(before: unknown, after: unknown) {
  const b = obj(before);
  const a = obj(after);
  const blankBefore = before === undefined;
  const blankAfter = after === undefined;
  const changes: Change[] = [];
  let keyed = false; // Sales or Free/Cost Rice — only a person moves these
  let remittance = false;
  let carried = false;

  const show = (v: unknown, money: boolean, blank: boolean) => (blank ? '—' : money ? rupees(v) : kg(v));
  for (const sec of ['a', 'b'] as const) {
    const rb = obj(b[sec]);
    const ra = obj(a[sec]);
    for (const id of new Set([...Object.keys(ra), ...Object.keys(rb)])) {
      const x = obj(rb[id]);
      const y = obj(ra[id]);
      for (const [f, label] of ROW_FIELDS) {
        // A new or removed sheet lists only the figures it actually held.
        if ((blankBefore || blankAfter) && !num((blankBefore ? y : x)[f])) continue;
        if (!blankBefore && !blankAfter && near(x[f], y[f])) continue;
        changes.push({ label: `${commodityName(id)} · ${label}`, before: show(x[f], f === 'amount', blankBefore), after: show(y[f], f === 'amount', blankAfter) });
        if (CARRIED.has(f)) carried = true;
        else keyed = true;
      }
    }
  }

  const rb = remitTotal(b);
  const ra = remitTotal(a);
  if ((blankBefore || blankAfter) ? rb || ra : !near(rb, ra)) {
    changes.push({ label: 'Remittance', before: blankBefore ? '—' : rupees(rb), after: blankAfter ? '—' : rupees(ra) });
    remittance = true;
  }
  const db = String(b.remitDate ?? '');
  const da = String(a.remitDate ?? '');
  if (db !== da && !(blankBefore || blankAfter)) {
    changes.push({ label: 'Remittance date', before: dmy(db), after: dmy(da) });
    remittance = true;
  }
  for (const [f, label] of [['freeRice', 'Free Rice'], ['costRice', 'Cost Rice']] as const) {
    const hb = b[f] !== undefined;
    const ha = a[f] !== undefined;
    if (!hb && !ha) continue;
    if (hb && ha && near(b[f], a[f])) continue;
    changes.push({ label, before: hb ? kg(b[f]) : '—', after: ha ? kg(a[f]) : '—' });
    keyed = true;
  }
  return { changes: changes.slice(0, MAX_CHANGES), keyed, remittance, carried };
}

function dayDraft(key: string, before: unknown, after: unknown, hint: 'edited' | 'closed' | undefined): ActivityDraft | null {
  const e = entryOf(key);
  if (!e.entryDate) return null;
  const projBefore = isObj(before) && !!before.__projection;
  const projAfter = isObj(after) && !!after.__projection;
  // A projected sheet is Monthly Entry's own output (monthProjection.ts): the
  // month-close that writes it is logged as Monthly Entry, not as a day.
  if (after !== undefined && projAfter) return null;
  if (after === undefined && projBefore) return null;

  const base = { ...e, recordKey: key };
  if (after === undefined) {
    const d = dayChanges(before, undefined);
    return { ...base, module: 'Daily Sales', action: 'deleted', source: 'user', summary: 'Day sheet deleted', changes: d.changes };
  }
  if (before === undefined || projBefore) {
    const d = dayChanges(undefined, after);
    return {
      ...base, module: 'Daily Sales', action: 'created', source: 'user',
      summary: projBefore ? 'The month\'s projected sheet became a day sheet' : 'New day sheet', changes: d.changes,
    };
  }

  const d = dayChanges(before, after);
  if (!d.changes.length) return null;
  const module = d.remittance && !d.keyed && !d.carried ? 'Remittance' : 'Daily Sales';
  if (!hint && !d.keyed && !d.remittance) {
    return { ...base, module: 'Daily Sales', action: 'recalculated', source: 'system', summary: summarise(d.changes, 'Recalculated'), changes: d.changes };
  }
  return { ...base, module, action: hint === 'closed' ? 'closed' : 'updated', source: 'user', summary: summarise(d.changes, 'Updated'), changes: d.changes };
}

// ── Inspection ─────────────────────────────────────────────────────────────

function inspectionDraft(key: string, before: unknown, after: unknown): ActivityDraft | null {
  const e = entryOf(key);
  if (!e.entryDate) return null;
  // Adjustments a month-close projected onto the last day are its output.
  if ((after !== undefined && isSystemRecord(after)) || (after === undefined && isSystemRecord(before))) return null;
  const changes: Change[] = [];
  const b = obj(before);
  const a = obj(after);
  for (const sec of ['a', 'b'] as const) {
    const rb = obj(b[sec]);
    const ra = obj(a[sec]);
    for (const id of new Set([...Object.keys(ra), ...Object.keys(rb)])) {
      for (const f of ['excess', 'shortage', 'transfer'] as const) {
        const x = obj(rb[id])[f];
        const y = obj(ra[id])[f];
        if (near(x, y)) continue;
        changes.push({ label: `${commodityName(id)} · ${f[0].toUpperCase()}${f.slice(1)}`, before: before === undefined ? '—' : kg(x), after: after === undefined ? '—' : kg(y) });
      }
    }
  }
  if (!changes.length) return null;
  const action: ActivityAction = before === undefined ? 'created' : after === undefined ? 'deleted' : 'updated';
  return { ...e, recordKey: key, module: 'Inspection', action, source: 'user', summary: summarise(changes, 'Inspection'), changes: changes.slice(0, MAX_CHANGES) };
}

// ── Monthly Entry ──────────────────────────────────────────────────────────

const MONTH_FIELDS = [
  ['open', 'Opening'], ['receipt', 'Receipt'], ['sales', 'Sales'], ['cs', 'C.S'], ['total', 'Total'], ['close', 'Closing'], ['amount', 'Amount'],
  ['excess', 'Excess'], ['shortage', 'Shortage'], ['transfer', 'Transfer'],
  ['g_open', 'Gunny Opening'], ['g_receipt', 'Gunny Receipt'], ['g_sales', 'Gunny Sales'], ['g_cs', 'Gunny C.S'], ['g_total', 'Gunny Total'], ['g_close', 'Gunny Closing'],
] as const;
/** What a register reconcile moves on the manual month by itself. */
const MONTH_CARRIED = new Set<string>(['receipt', 'total', 'close', 'amount', 'g_receipt', 'g_total', 'g_close']);

function manualDraft(key: string, before: unknown, after: unknown, hint: 'edited' | 'closed' | undefined): ActivityDraft | null {
  const e = entryOf(key);
  if (!e.entryMonth) return null;
  const changes: Change[] = [];
  let keyed = false;
  for (const sec of ['a', 'b'] as const) {
    const rb = obj(obj(before)[sec]);
    const ra = obj(obj(after)[sec]);
    for (const id of new Set([...Object.keys(ra), ...Object.keys(rb)])) {
      const x = obj(rb[id]);
      const y = obj(ra[id]);
      for (const [f, label] of MONTH_FIELDS) {
        if (before === undefined || after === undefined ? !num((before === undefined ? y : x)[f]) : near(x[f], y[f])) continue;
        const money = f === 'amount';
        changes.push({
          label: `${commodityName(id)} · ${label}`,
          before: before === undefined ? '—' : money ? rupees(x[f]) : kg(x[f]),
          after: after === undefined ? '—' : money ? rupees(y[f]) : kg(y[f]),
        });
        if (!MONTH_CARRIED.has(f)) keyed = true;
      }
    }
  }
  if (!changes.length && before !== undefined && after !== undefined) return null;
  const base = { ...e, recordKey: key, module: 'Monthly Entry', changes: changes.slice(0, MAX_CHANGES) };
  if (after === undefined) return { ...base, action: 'deleted', source: 'user', summary: 'Monthly entry removed' };
  if (hint === 'closed') return { ...base, action: 'closed', source: 'user', summary: summarise(changes, 'Month closed') };
  if (!hint && before !== undefined && !keyed) return { ...base, action: 'recalculated', source: 'system', summary: summarise(changes, 'Recalculated') };
  return { ...base, action: before === undefined ? 'created' : 'updated', source: 'user', summary: summarise(changes, 'Updated') };
}

// ── Other month stores, masters ────────────────────────────────────────────

const MONTH_STORE_MODULE: Record<string, string> = {
  meRemitStore: 'Remittance',
  meGunnyStore: 'Gunny',
  meCardStore: 'Card Details',
  meAllotStore: 'Allotment',
  meAdvanceStore: 'Allotment',
  meCardConfirmed: 'Card Details',
};

const MASTER_LABEL: Record<string, string> = {
  __shops: 'CRS Shops',
  __crsMaster: 'CRS Master',
  __commodityMaster: 'Commodities',
  __commodities: 'Commodities',
  __holidays: 'Holidays',
  __config: 'Settings',
  __accounts: 'Bank Accounts',
  __pvOfficers: 'PV Officers',
};

/** Every leaf of a record as "path → value", commodity ids named. */
function leaves(v: unknown, path: string[] = [], out = new Map<string, unknown>(), depth = 0): Map<string, unknown> {
  if (depth < 5 && (isObj(v) || Array.isArray(v))) {
    const entries = Array.isArray(v) ? v.map((x, i) => [String(i + 1), x] as const) : Object.entries(v);
    if (!entries.length) out.set(path.join(' · ') || 'value', Array.isArray(v) ? '' : '');
    for (const [k, x] of entries) leaves(x, [...path, NAMES.get(k) ?? k], out, depth + 1);
    return out;
  }
  out.set(path.join(' · ') || 'value', v);
  return out;
}

function genericChanges(before: unknown, after: unknown): Change[] {
  const b = leaves(before);
  const a = leaves(after);
  const changes: Change[] = [];
  for (const label of new Set([...a.keys(), ...b.keys()])) {
    const x = b.get(label);
    const y = a.get(label);
    if (JSON.stringify(x) === JSON.stringify(y)) continue;
    if (typeof x === 'number' && typeof y === 'number' && near(x, y)) continue;
    changes.push({ label, before: before === undefined ? '—' : leafText(x), after: after === undefined ? '—' : leafText(y) });
    if (changes.length >= MAX_CHANGES) break;
  }
  return changes;
}

function salesCloseDraft(key: string, before: unknown, after: unknown): ActivityDraft | null {
  const e = entryOf(key);
  if (!e.entryMonth) return null;
  const b = obj(before);
  const a = obj(after);
  const changes: Change[] = [];
  const row = (label: string, x: string, y: string) => x !== y && changes.push({ label, before: x, after: y });
  row('Last sales day', before === undefined ? '—' : dmy(String(b.date ?? '')), after === undefined ? '—' : dmy(String(a.date ?? '')));
  row('Gunny', before === undefined ? '—' : String(b.gunny ?? 0), after === undefined ? '—' : String(a.gunny ?? 0));
  row('Poly', before === undefined ? '—' : String(b.poly ?? 0), after === undefined ? '—' : String(a.poly ?? 0));
  row('C.Box', before === undefined ? '—' : String(b.cbox ?? 0), after === undefined ? '—' : String(a.cbox ?? 0));
  if (!changes.length) return null;
  const date = String((after === undefined ? b.date : a.date) ?? '');
  return {
    crsId: e.crsId, entryDate: /^\d{4}-\d{2}-\d{2}$/.test(date) ? date : null, entryMonth: e.entryMonth, entryYear: e.entryYear,
    recordKey: key, module: 'Sales Close', action: after === undefined ? 'deleted' : 'closed', source: 'user',
    summary: after === undefined ? 'Sales Close removed' : `Last sales day ${dmy(date)}`, changes,
  };
}

function receiptDrafts(before: unknown, after: unknown): ActivityDraft[] {
  const index = (v: unknown) => {
    const m = new Map<string, Loose>();
    if (Array.isArray(v)) for (const r of v) if (isObj(r) && r.id !== undefined && r.id !== null) m.set(String(r.id), r);
    return m;
  };
  const b = index(before);
  const a = index(after);
  const out: ActivityDraft[] = [];
  for (const id of new Set([...a.keys(), ...b.keys()])) {
    const x = b.get(id);
    const y = a.get(id);
    if (JSON.stringify(x) === JSON.stringify(y)) continue;
    const row = (y ?? x)!;
    const date = String(row.date ?? '');
    const changes = genericChanges(x ? { 'Receipt no': x.receiptNo, Date: dmy(String(x.date ?? '')), ...obj(x.items) } : undefined, y ? { 'Receipt no': y.receiptNo, Date: dmy(String(y.date ?? '')), ...obj(y.items) } : undefined);
    out.push({
      crsId: Number(row.crsId) || null,
      entryDate: /^\d{4}-\d{2}-\d{2}$/.test(date) ? date : null,
      recordKey: id,
      module: 'Receipt',
      action: !x ? 'created' : !y ? 'deleted' : 'updated',
      // The row Monthly Entry writes for a whole month is its output.
      source: row.source === 'monthly-entry' ? 'system' : 'user',
      summary: `Receipt ${String(row.receiptNo ?? id)}`,
      changes,
    });
  }
  return out;
}

// ── One /api/state write ───────────────────────────────────────────────────

/** Published by the roll-up on every save — logging them would double every entry. */
const DERIVED = new Set(['monthlyStore', 'meSourceStore', '__counters']);

/** What the browser says it edited, accepted only in this exact shape. */
export function readHints(raw: unknown): EditHints {
  const out: EditHints = {};
  const edited = isObj(raw) && isObj(raw.edited) ? raw.edited : {};
  for (const [store, keys] of Object.entries(edited).slice(0, 20)) {
    if (!isObj(keys)) continue;
    for (const [key, kind] of Object.entries(keys).slice(0, 50)) {
      if (kind === 'edited' || kind === 'closed') (out[store] ??= {})[key] = kind;
    }
  }
  return out;
}

/**
 * Every action one write performed. `before` holds what was stored for each
 * written store; `after` what was written.
 */
export function diffStateWrite(before: Record<string, unknown>, after: Record<string, unknown>, hints: EditHints = {}): ActivityDraft[] {
  const out: ActivityDraft[] = [];
  for (const [store, value] of Object.entries(after)) {
    if (DERIVED.has(store)) continue;
    const prev = before[store];
    if (JSON.stringify(prev) === JSON.stringify(value)) continue;

    if (store === 'receiptStore') {
      out.push(...receiptDrafts(prev, value));
      continue;
    }

    if (MASTER_LABEL[store]) {
      const changes = genericChanges(prev, value);
      if (!changes.length) continue;
      out.push({ crsId: null, module: 'Masters', action: prev === undefined ? 'created' : 'updated', source: 'user', recordKey: store, summary: `${MASTER_LABEL[store]} updated`, changes });
      continue;
    }

    const b = obj(prev);
    const a = obj(value);
    for (const key of new Set([...Object.keys(a), ...Object.keys(b)])) {
      const x = b[key];
      const y = a[key];
      if (JSON.stringify(x) === JSON.stringify(y)) continue;
      const hint = hints[store]?.[key];
      let draft: ActivityDraft | null = null;
      if (store === 'entryStore') draft = dayDraft(key, x, y, hint);
      else if (store === 'inspectionStore') draft = inspectionDraft(key, x, y);
      else if (store === 'meManualStore') draft = manualDraft(key, x, y, hint);
      else if (store === 'salesCloseStore') draft = salesCloseDraft(key, x, y);
      else if (MONTH_STORE_MODULE[store]) {
        const e = entryOf(key);
        const changes = genericChanges(x, y);
        if (changes.length) {
          draft = {
            ...e, recordKey: key, module: MONTH_STORE_MODULE[store], action: x === undefined ? 'created' : y === undefined ? 'deleted' : 'updated',
            source: 'user', summary: summarise(changes, MONTH_STORE_MODULE[store]), changes,
          };
        }
      }
      if (draft) out.push(draft);
    }
  }
  return out;
}

// ── Actions outside crs_state ──────────────────────────────────────────────

type ClearLike = {
  id: number;
  crsId: number;
  storeKeys: string[];
  scopeKind: string;
  scopeLabel: string;
  reason: string;
  requestedBy: string;
  snapshot?: Record<string, unknown>;
};

const clearEntry = (r: ClearLike) => (r.storeKeys.length === 1 && r.scopeKind !== 'receipt' ? entryOf(r.storeKeys[0]) : { crsId: r.crsId });

export function clearRequestDraft(r: ClearLike, action: 'requested' | 'approved' | 'rejected' | 'cancelled' | 'failed', note = ''): ActivityDraft {
  const changes: Change[] = [{ label: 'Scope', before: '', after: `${r.scopeKind === 'month' ? 'Whole month' : r.scopeKind === 'receipt' ? 'Receipt' : 'One day'} — ${r.scopeLabel}` }];
  if (r.reason) changes.push({ label: 'Reason', before: '', after: r.reason });
  if (note) changes.push({ label: action === 'failed' ? 'Error' : 'Note', before: '', after: note });
  return {
    ...clearEntry(r), crsId: r.crsId, module: 'Clear Request', action, source: 'user', recordKey: r.storeKeys.join(', ').slice(0, 300), relatedId: String(r.id),
    summary: `Request #${r.id} · ${r.scopeLabel}${action === 'requested' ? ` · ${r.reason}` : note ? ` · ${note}` : ''}`.slice(0, 500),
    changes,
  };
}

const CLEARED_MODULE: Record<string, string> = {
  entryStore: 'Daily Sales', inspectionStore: 'Inspection', meManualStore: 'Monthly Entry', salesCloseStore: 'Sales Close', receiptStore: 'Receipt',
  ...MONTH_STORE_MODULE,
};

/** What an approved clear removed, and what it re-carried — one row each. */
export function clearedDrafts(r: ClearLike, cleared: { store: string; key: string }[], recalculated: string[]): ActivityDraft[] {
  const out: ActivityDraft[] = [];
  const snap = r.snapshot ?? {};
  for (const c of cleared) {
    if (c.store === 'monthlyStore' || c.store === 'meSourceStore') continue;
    let before: unknown;
    if (c.store === 'receiptStore') before = (Array.isArray(snap.receiptStore) ? snap.receiptStore : []).find((x) => isObj(x) && String(x.id) === c.key);
    else before = obj(snap[c.store])[c.key];
    const e = c.store === 'receiptStore' ? { crsId: r.crsId, entryDate: isObj(before) && /^\d{4}-\d{2}-\d{2}$/.test(String(before.date)) ? String(before.date) : null } : entryOf(c.key);
    const changes = c.store === 'entryStore' ? dayChanges(before, undefined).changes : genericChanges(before, undefined);
    out.push({
      ...e, crsId: e.crsId ?? r.crsId, module: CLEARED_MODULE[c.store] ?? c.store, action: 'cleared', source: 'user', recordKey: c.key, relatedId: String(r.id),
      summary: `Cleared on approval of request #${r.id} (requested by ${r.requestedBy})`, changes,
    });
  }
  for (const key of recalculated) {
    out.push({
      ...entryOf(key), module: 'Daily Sales', action: 'recalculated', source: 'system', recordKey: key, relatedId: String(r.id),
      summary: `Opening re-carried after clear request #${r.id}`, changes: [],
    });
  }
  return out;
}

type OrderLike = { id: number; orderNo: string; crsId: number; kind: string; month: number; year: number; sheetCount: number; dayCount: number; totalPaise: number; utr?: string | null; rejectReason?: string | null };

export function paymentDraft(o: OrderLike, action: 'created' | 'submitted' | 'approved' | 'rejected'): ActivityDraft {
  const what = o.kind === 'dss' ? `DSS · ${o.dayCount} day(s)` : `${o.sheetCount} statement sheet(s)`;
  const amount = rupees(o.totalPaise / 100);
  const changes: Change[] = [
    { label: 'Order', before: '', after: o.orderNo },
    { label: 'For', before: '', after: what },
    { label: 'Amount', before: '', after: amount },
  ];
  if (action === 'submitted' && o.utr) changes.push({ label: 'UTR', before: '', after: o.utr });
  if (action === 'rejected' && o.rejectReason) changes.push({ label: 'Reason', before: '', after: o.rejectReason });
  return {
    crsId: o.crsId, entryMonth: o.month, entryYear: o.year, module: 'Payment', action, source: 'user', recordKey: o.orderNo, relatedId: String(o.id),
    summary: `${o.orderNo} · ${what} · ${amount}${action === 'rejected' && o.rejectReason ? ` · ${o.rejectReason}` : ''}`,
    changes,
  };
}

export function documentDraft(input: {
  module: 'Statements' | 'DSS';
  action: 'viewed' | 'printed' | 'exported';
  crsId: number;
  month: number;
  year: number;
  sections?: string[];
}): ActivityDraft {
  const list = (input.sections ?? []).slice(0, 20);
  return {
    crsId: input.crsId, entryMonth: input.month, entryYear: input.year, module: input.module, action: input.action, source: 'user',
    summary: list.length ? list.join(', ') : input.module,
    changes: list.length ? [{ label: 'Sections', before: '', after: list.join(', ') }] : [],
  };
}

type UserLike = { id?: unknown; username?: unknown; full_name?: unknown; role?: unknown; crs_id?: unknown; active?: unknown; phone?: unknown; email?: unknown };

/** An account created, changed (transfer, removal, role, status, password) or deleted. */
export function userDraft(before: UserLike | null, after: UserLike | null, passwordReset = false): ActivityDraft | null {
  const who = (after ?? before)!;
  const name = `${String(who.full_name ?? who.username ?? '')} (${roleLabel(String(who.role ?? ''))})`;
  const shop = (v: unknown) => (v === null || v === undefined || v === '' ? 'No shop' : `CRS ${v}`);
  const fields: [string, (u: UserLike) => string][] = [
    ['Username', (u) => String(u.username ?? '')],
    ['Name', (u) => String(u.full_name ?? '')],
    ['Role', (u) => roleLabel(String(u.role ?? ''))],
    ['Shop', (u) => shop(u.crs_id)],
    ['Status', (u) => (u.active === false ? 'Disabled' : 'Active')],
    ['Phone', (u) => String(u.phone ?? '') || '—'],
    ['Email', (u) => String(u.email ?? '') || '—'],
  ];
  const changes: Change[] = [];
  for (const [label, get] of fields) {
    const x = before ? get(before) : '—';
    const y = after ? get(after) : '—';
    if (x !== y) changes.push({ label, before: x, after: y });
  }
  if (passwordReset) changes.push({ label: 'Password', before: '', after: 'Reset' });
  if (!changes.length) return null;
  const moved = before && after && String(before.crs_id ?? '') !== String(after.crs_id ?? '');
  return {
    crsId: Number((after?.crs_id ?? before?.crs_id) ?? 0) || null,
    module: 'Users', action: !before ? 'created' : !after ? 'deleted' : 'updated', source: 'user', recordKey: String(who.id ?? ''),
    summary: !before ? `${name} added` : !after ? `${name} deleted` : moved ? `${name} · ${shop(before.crs_id)} → ${shop(after.crs_id)}` : `${name} updated`,
    changes,
  };
}

export function refusedDraft(module: string, crsId: number | null, reason: string, entry: Partial<ActivityDraft> = {}): ActivityDraft {
  return { crsId, ...entry, module, action: 'refused', source: 'user', summary: reason.slice(0, 500), changes: [{ label: 'Reason', before: '', after: reason.slice(0, 1000) }] };
}

/** Rows a shop user's dashboard may show: its own shop, nothing else. */
export function scopeFeed(items: FeedItem[], crsId: number | null): FeedItem[] {
  return crsId === null ? items : items.filter((i) => i.crsId === crsId);
}
