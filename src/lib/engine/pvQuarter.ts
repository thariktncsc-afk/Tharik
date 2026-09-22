/**
 * The 3-month PV from uploaded months + the current month from the system
 * (office, 2026-09-22).
 *
 *   July    — its PDFs. Its Opening is the quarter's Opening, as printed.
 *   August  — its PDFs. It must OPEN at July's Closing; if its own Opening
 *             says anything else the PV is refused with the difference,
 *             commodity by commodity. Its movements are read from the PDF.
 *   September — the current month, straight from this system: the month as
 *             Monthly Entry publishes it (rebuildMonthlyFromDaily, the same
 *             roll-up the statements use) and Gunny exactly as the Gunny Stock
 *             screen shows it (gunnyRowFor). Nothing is cached — it is worked
 *             out from the stores at the moment the PV is generated. It too
 *             must open at August's Closing.
 *
 * One quarter PV, per commodity:
 *   Opening  = the first month's Opening
 *   Receipt, Excess, Shortage, Transfer, Issues (Sales) = the three months added
 *   Balance  = the last month's Closing
 * and Opening + Receipt + Transfer + Excess − Sales − Shortage must come to
 * that Balance, or the PV is refused.
 *
 * Nothing here writes anything: uploaded months stay in the PV screen and
 * never touch Daily, Monthly, DSS, Statement, Receipt, Gunny or Police records.
 */
import { DSS_A, DSS_B, entryListsFor, type Commodity } from '@/lib/engine/commodities';
import { rebuildMonthlyFromDaily, type MonthlyBlock, type MonthlyRec } from '@/lib/engine/monthlyRollup';
import { gunnyRowFor, type GunnyRec, type SalesClose } from '@/app/(app)/monthly-entry/lib';
import type { Flow, GunnyFlow, GunnyKey, PdfMonth } from '@/lib/engine/pvPdfParse';
import type { PvCommRow } from '@/lib/engine/pvStatement';

export type QuarterMonth = {
  label: string;
  source: 'pdf' | 'system';
  rows: Record<string, Flow>;
  gunny: Record<GunnyKey, GunnyFlow>;
  /** Null when this month has no police section at all. */
  police: Record<string, Flow> | null;
  notes: string[];
};

export type QuarterRow = {
  name: string;
  unit: string;
  open: number;
  receipt: number;
  excess: number;
  shortage: number;
  transfer: number;
  sales: number;
  closing: number;
};

export type QuarterResult =
  | { ok: false; problems: string[] }
  | {
      ok: true;
      rows: Record<string, QuarterRow>;
      gunny: Record<GunnyKey, GunnyFlow>;
      police: Record<string, QuarterRow> | null;
      notes: string[];
    };

const EPS = 0.001;
const r3 = (n: number) => Math.round(n * 1000) / 1000;
const eq = (a: number, b: number) => Math.abs(a - b) < EPS;
const fmt = (n: number) => String(r3(n));
const MN = ['', 'January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
export const monthLabel = (month: number, year: number) => `${MN[month]} ${year}`;

const ZERO: Flow = { open: 0, receipt: 0, excess: 0, shortage: 0, transfer: 0, total: 0, sales: 0, closing: 0 };
const GZERO: GunnyFlow = { opening: 0, receipt: 0, total: 0, issues: 0, closing: 0 };

/** Uploaded PDFs → a quarter month. */
export function pdfQuarterMonth(m: PdfMonth): QuarterMonth {
  return { label: monthLabel(m.month, m.year), source: 'pdf', rows: m.rows, gunny: m.gunny, police: m.police, notes: m.notes };
}

type Stores = {
  entryStore: Record<string, unknown>;
  inspectionStore: Record<string, unknown>;
  meManualStore: Record<string, Partial<MonthlyBlock>>;
  receiptStore: unknown[];
  meGunnyStore: Record<string, Record<string, GunnyRec>>;
  salesCloseStore: Record<string, SalesClose>;
};

/** A published monthly record → a flow. Transfer is stored OUTWARD-positive; a flow keeps it signed (in +, out −). */
function flowOf(r: MonthlyRec | undefined): Flow {
  if (!r) return { ...ZERO };
  const cs = Number(r.cs) || 0;
  return {
    open: Number(r.open) || 0,
    receipt: Number(r.receipt) || 0,
    excess: Number(r.excess) || 0,
    shortage: Number(r.shortage) || 0,
    transfer: -(Number(r.transfer) || 0),
    total: Number(r.total) || 0,
    // C.S leaves stock the way a sale does (total − sales − cs = close).
    sales: (Number(r.sales) || 0) + cs,
    closing: Number(r.close) || 0,
  };
}

/**
 * The current month from this system, worked out now from the stores —
 * exactly what Monthly Entry and the Gunny Stock screen show for it.
 */
export function systemQuarterMonth(
  crsId: number,
  month: number,
  year: number,
  stores: Stores,
  /** From CRS_MASTER: a shop without police ration has no police section, not one of zeros. */
  hasPolice: boolean,
  lists?: { a: Commodity[]; b: Commodity[] },
): QuarterMonth {
  const key = `${crsId}_${month}_${year}`;
  const { merged } = rebuildMonthlyFromDaily(
    crsId, month, year,
    stores.entryStore as never, stores.inspectionStore as never, stores.meManualStore[key],
    lists, stores.receiptStore as never,
  );
  const rows: Record<string, Flow> = {};
  for (const [id, r] of Object.entries(merged.a)) rows[id] = flowOf(r);
  const bIds = Object.keys(merged.b);
  const police: Record<string, Flow> | null = hasPolice && bIds.length ? Object.fromEntries(bIds.map((id) => [id, flowOf(merged.b[id])])) : null;

  // Gunny: the Gunny Stock screen's own rule, on this month's own sales bags.
  const prevKey = `${crsId}_${month === 1 ? 12 : month - 1}_${month === 1 ? year - 1 : year}`;
  const gridGunnySales: Record<string, number> = {};
  for (const sec of ['a', 'b'] as const) for (const [id, r] of Object.entries(merged[sec])) gridGunnySales[id] = Number(r.g_sales) || 0;
  const gunny = {} as Record<GunnyKey, GunnyFlow>;
  for (const k of ['ss50', 'poly', 'cbox'] as const) {
    const g = gunnyRowFor(k, stores.meGunnyStore[key] ?? {}, stores.meGunnyStore[prevKey] ?? {}, stores.salesCloseStore[key], gridGunnySales);
    gunny[k] = { opening: g.opening, receipt: g.rc.val, total: g.total, issues: Number(g.issues) || 0, closing: g.closing };
  }
  return { label: monthLabel(month, year), source: 'system', rows, gunny, police, notes: [] };
}

const nameOf = (id: string) => [...DSS_A, ...DSS_B].find((c) => c.id === id);

/**
 * A chained quarter → what buildPVTable prints. TOTAL is Opening + Receipt +
 * Transfer + Excess (the TRANSFER column shows the net transfer); Issues are
 * the sales; SHORTAGE its own column; Balance the last month's Closing — so
 * TOTAL − Issues − Shortage is the Balance, which chainQuarter has checked.
 */
export function quarterPvInputs(q: Extract<QuarterResult, { ok: true }>): {
  commMap: Record<string, PvCommRow>;
  gunny: Record<GunnyKey, GunnyFlow>;
  gunnyNotes: string[];
} {
  const commMap: Record<string, PvCommRow> = {};
  for (const [id, r] of [...Object.entries(q.rows), ...Object.entries(q.police ?? {})]) {
    commMap[id] = {
      name: r.name,
      unit: r.unit,
      open: r.open,
      receipt: r.receipt,
      total: r3(r.open + r.receipt + r.transfer + r.excess),
      issues: r.sales,
      closing: r.closing,
      amount: 0,
      free: !!nameOf(id)?.free,
      transfer: r.transfer,
      shortage: r.shortage,
    };
  }
  return { commMap, gunny: q.gunny, gunnyNotes: q.notes };
}

/** Chain one commodity through the months; a month that does not open where the last closed is a problem. */
function chainFlows(
  id: string,
  months: { label: string; flow: Flow | undefined }[],
  label: string,
  problems: string[],
): QuarterRow | null {
  const live = months.filter((m) => m.flow);
  if (!live.length) return null;
  const q = { open: 0, receipt: 0, excess: 0, shortage: 0, transfer: 0, sales: 0, closing: 0 };
  let prev: { label: string; closing: number } | null = null;
  for (const m of live) {
    const f = m.flow!;
    if (!prev) q.open = f.open;
    else if (!eq(f.open, prev.closing)) {
      problems.push(`${label}: ${prev.label} closes at ${fmt(prev.closing)}, but ${m.label} opens at ${fmt(f.open)} (difference ${fmt(f.open - prev.closing)}).`);
    }
    // The month's own closing must follow from its own figures.
    const own = f.open + f.receipt + f.excess - f.shortage + f.transfer - f.sales;
    if (!eq(own, f.closing)) {
      problems.push(`${label}: ${m.label} does not add up — Opening ${fmt(f.open)} + Receipt ${fmt(f.receipt)} + Transfer ${fmt(f.transfer)} + Excess ${fmt(f.excess)} − Sales ${fmt(f.sales)} − Shortage ${fmt(f.shortage)} = ${fmt(own)}, not the Closing ${fmt(f.closing)}.`);
    }
    q.receipt += f.receipt;
    q.excess += f.excess;
    q.shortage += f.shortage;
    q.transfer += f.transfer;
    q.sales += f.sales;
    prev = { label: m.label, closing: f.closing };
  }
  q.closing = prev!.closing;
  const c = nameOf(id);
  return {
    name: c?.en ?? id,
    unit: c?.unit ?? 'KG',
    open: r3(q.open), receipt: r3(q.receipt), excess: r3(q.excess), shortage: r3(q.shortage),
    transfer: r3(q.transfer), sales: r3(q.sales), closing: r3(q.closing),
  };
}

/**
 * July + August (PDFs) + September (system) → one quarter PV, or the list of
 * everything that does not carry over. Nothing partial is ever returned.
 */
export function chainQuarter(crsId: number, months: QuarterMonth[]): QuarterResult {
  const problems: string[] = [];
  const lists = entryListsFor(crsId);

  // Main commodities, in the statement's order.
  const rows: Record<string, QuarterRow> = {};
  const ids = lists.a.map((c) => c.id).filter((id) => months.some((m) => m.rows[id]));
  for (const id of ids) {
    const r = chainFlows(id, months.map((m) => ({ label: m.label, flow: m.rows[id] ?? { ...ZERO } })), nameOf(id)?.en ?? id, problems);
    if (r) rows[id] = r;
  }

  // Police: only if some month has a police section. It starts at the first
  // month that has one (a shop given police ration mid-quarter opens there).
  let police: Record<string, QuarterRow> | null = null;
  if (months.some((m) => m.police)) {
    police = {};
    const firstWith = months.findIndex((m) => m.police);
    for (const c of lists.b) {
      const r = chainFlows(c.id, months.slice(firstWith).map((m) => ({ label: m.label, flow: m.police ? m.police[c.id] ?? { ...ZERO } : { ...ZERO } })), `${c.en}`, problems);
      if (r) police[c.id] = r;
    }
  }

  // Gunny: the same carry, in pieces.
  const gunny = {} as Record<GunnyKey, GunnyFlow>;
  for (const [k, label] of [['ss50', '50 KG SS GUNNY'], ['poly', 'POLYTHENE'], ['cbox', 'C.BOX']] as const) {
    const q = { opening: 0, receipt: 0, issues: 0, closing: 0 };
    let prev: { label: string; closing: number } | null = null;
    for (const m of months) {
      const g = m.gunny[k] ?? GZERO;
      if (!prev) q.opening = g.opening;
      else if (!eq(g.opening, prev.closing)) {
        problems.push(`Gunny ${label}: ${prev.label} closes at ${fmt(prev.closing)}, but ${m.label} opens at ${fmt(g.opening)}.`);
      }
      if (!eq(g.opening + g.receipt - g.issues, g.closing)) {
        problems.push(`Gunny ${label}: ${m.label} does not add up — ${fmt(g.opening)} + ${fmt(g.receipt)} − ${fmt(g.issues)} is not the Closing ${fmt(g.closing)}.`);
      }
      q.receipt += g.receipt;
      q.issues += g.issues;
      prev = { label: m.label, closing: g.closing };
    }
    q.closing = prev ? prev.closing : 0;
    gunny[k] = { opening: r3(q.opening), receipt: r3(q.receipt), total: r3(q.opening + q.receipt), issues: r3(q.issues), closing: r3(q.closing) };
  }

  // The quarter must add up as a whole, too.
  for (const r of [...Object.values(rows), ...Object.values(police ?? {})]) {
    const calc = r.open + r.receipt + r.transfer + r.excess - r.sales - r.shortage;
    if (!eq(calc, r.closing)) problems.push(`${r.name}: the quarter does not add up — ${fmt(calc)} worked out, ${fmt(r.closing)} as the last Closing.`);
  }

  if (problems.length) return { ok: false, problems };

  // Notes, as written, each once, from the months that carry them.
  const seen = new Set<string>();
  const notes: string[] = [];
  for (const m of months) for (const n of m.notes) {
    const k = n.toUpperCase().replace(/\s+/g, ' ').trim();
    if (!seen.has(k)) {
      seen.add(k);
      notes.push(n);
    }
  }
  return { ok: true, rows, gunny, police, notes };
}
