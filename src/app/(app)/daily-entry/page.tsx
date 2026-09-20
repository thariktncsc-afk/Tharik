'use client';

/**
 * Daily Sales Entry — React port of the legacy screen and its layers:
 *   03-daily-entry.js   sections A/B, opening auto-carry, totals, save,
 *                       sales-close workflow, inspection adjustment columns
 *   21-remittance.js    mandatory, repeatable remittance rows
 *   27/28-crs29-*.js    the camp keys its own list and has no police section
 *
 * Arithmetic per row: Total = Opening + Receipt + Excess − Shortage −
 * Transfer (adjustments come read-only from the Inspection screen);
 * Closing = Total − Sales; Amount = Sales × rate for priced commodities.
 * Opening auto-carries from the previous day's closing (amber, read-only);
 * a day with no earlier sheet stays hand-editable.
 *
 * Saving writes the sheet to entryStore and republishes the month
 * (monthlyStore/meSourceStore) through the shared rollup, so Monthly Entry
 * and the statements see the day immediately — same as the engine.
 * The Inspection editor and DSS preview still live in the classic app; the
 * buttons open it until those sub-screens convert.
 */
import { useEffect, useMemo, useRef, useState } from 'react';
import { useAuth } from '@/lib/authClient';
import { crsData, useStore } from '@/lib/dataStore';
import { appAlert, appConfirm } from '@/components/dialog';
import { isCrs29, type Commodity, type DayEntry } from '@/lib/engine/commodities';
import { useCommodityLists, useShops } from '@/lib/masters';
import { holidayOn, type GovtHolidayMap } from '@/lib/engine/holidays';
import { rebuildMonthlyFromDaily, type MonthlyBlock, type SourceBlock } from '@/lib/engine/monthlyRollup';
import { receiptQtyForDay, receiptRefsForDay, type ReceiptRow } from '@/lib/engine/receiptRollup';
import { dropMonthlyReceipt } from '@/lib/engine/monthlyReceipt';
import { buildChainIndex, isOpenFixed, openingFor, unsheetedMoves } from '@/lib/engine/stockChain';
import { firstStockDates, initialDate, isInitialized, readStockInit } from '@/lib/engine/stockInit';
import PaymentDialog from '@/components/PaymentDialog';
import { createOrder, fetchAccess, type Order, type Upi } from '@/lib/payments/client';
import InspectionModal from './InspectionModal';
import { dropProjectedAdjustments, dropProjectedSheet, isProjectedSheet } from '@/lib/engine/monthProjection';
import ClearRequestDialog from '@/components/ClearRequestDialog';
import AdditionalRemitDialog from '@/components/AdditionalRemitDialog';
import { REMIT_REASONS, REMIT_TYPE_LABEL, applyRemitType, canRemoveRemit, newRemitId, remitTypeOf, savedRemitIds, sheetTotals, txnsOf, type RemitAcct, type RemitReason, type RemitTxn, type RemitType } from '@/lib/engine/remittance';
import { hasData } from '@/lib/clearGuard';
import { openingLocked, receiptLocked } from '@/lib/stockGuard';
import { columnKeyDown } from '@/lib/gridNav';
import type { ClearScope } from '@/lib/clearClient';
import { RICE_DAILY_REQUIRED, RICE_INVALID, checkRiceBoxes, hasRiceFields, riceBox, withRice, type RiceBoxError } from '@/lib/engine/crs29Rice';
import { confirmMonthlySalesClose } from '@/lib/monthCloseConfirm';
import { rechainAndRepublish } from '@/lib/engine/rechain';
import { withReceiptOnlyDays } from '@/lib/engine/dssDays';
import { saveSuccess } from '@/components/SaveSuccess';
import { dailySaved, monthlySaved } from '@/lib/saveSuccess';

type ShopRec = { name: string };

/**
 * Which SRCB account a deposit belongs to — the two columns of the Monthly
 * Remittance table (15-monthly-extras.js). Priced commodities are collected
 * into the Non-Cereal account; the free ration commodities (rice, wheat) are
 * collected into the Cereal account, so one day can carry deposits of both.
 * Rows saved before the split have no `account` and read as Non-Cereal —
 * that is what the single amount box always meant.
 */
type Remit = RemitTxn;

type SavedSheet = DayEntry & {
  remits?: RemitTxn[];
  remitAmount?: number;
  remitDate?: string;
  remitNonCereal?: number;
  remitCereal?: number;
  /** CRS 29 only — kilos of rice issued free and sold at cost (engine/crs29Rice.ts). */
  freeRice?: number;
  costRice?: number;
};
type InspDay = { a?: Record<string, { excess?: number; shortage?: number; transfer?: number }>; b?: Record<string, { excess?: number; shortage?: number; transfer?: number }> };
type SalesClose = { date: string; gunny: number; poly: number; cbox: number; updatedAt: string };

const pad2 = (n: number) => String(n).padStart(2, '0');
/** Equal to the gram — the stock guard's tolerance. */
const near3 = (a: number, b: number) => Math.abs(a - b) <= 0.005;
const todayIso = () => new Date().toISOString().split('T')[0];
const inr = (n: number) => '₹' + n.toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

/** Labels and field colours per remittance account, keyed as the rows store it. */
const ACCT: Record<RemitAcct, { label: string; hint: string; fg: string; bg: string; bd: string }> = {
  nc: { label: 'Non-Cereal A/C', hint: 'Sugar, Toor, Palm Oil, Salt, Ooty/Tan, empty box & bag — the priced commodities', fg: '#0369A1', bg: '#F0F9FF', bd: '#BAE6FD' },
  ce: { label: 'Cereal A/C', hint: 'Rice and Wheat — the free (விலையில்லா) commodities', fg: '#15803D', bg: '#F0FDF4', bd: '#86EFAC' },
};

// Pack-type divisors for the Sales Close aggregates (03-daily-entry.js).
const SC_PACK: Record<'GUNNY' | 'POLY' | 'CBOX', Record<string, number>> = {
  GUNNY: { BRA: 50, NPHH_FRK: 50, PHH_FRK: 50, AAY_FRK: 50, AAY: 50, OAP: 50, APS: 50, TOOR: 50, PHH_BRA: 50, WHEAT: 50, RRA: 50, NPHH_RRA: 50, PB_BRA: 50, PB_WHEAT: 50, PB_TOOR: 50 },
  POLY: { SUGAR: 50, AAY_SUGAR: 50, SALT_CIS: 25, SALT_RFFS: 25, PB_SUGAR: 50 },
  CBOX: { PALM: 10, OOTY: 50, TAN: 50, PB_PALM: 10 },
};

/**
 * `fixed` — the Opening is kept as typed instead of carried: an administrator's
 * correction, or the shop's one-time Initial Opening (engine/stockInit.ts).
 */
type RowInput = { open?: string; receipt?: string; sales?: string; fixed?: boolean };

/** A carry crossing more than this many blank days is flagged for a check. */
const GAP_WARN_DAYS = 7;

/** This shop's entry dates, newest first. ISO dates sort as text. */
function entryDatesDesc(entryStore: Record<string, SavedSheet>, crsId: string): string[] {
  const prefix = `${crsId}_`;
  const dates: string[] = [];
  for (const k of Object.keys(entryStore)) {
    if (!k.startsWith(prefix)) continue; // CRS 2 must not match CRS 23
    const ds = k.slice(prefix.length);
    if (/^\d{4}-\d{2}-\d{2}$/.test(ds)) dates.push(ds);
  }
  return dates.sort().reverse();
}

/** Whole days between two ISO dates with no sheet; consecutive days give 0. */
function gapDays(fromDs: string, toDs: string): number {
  const a = new Date(fromDs + 'T00:00:00').getTime();
  const b = new Date(toDs + 'T00:00:00').getTime();
  if (Number.isNaN(a) || Number.isNaN(b)) return 0;
  return Math.max(0, Math.round((b - a) / 86400000) - 1);
}

const fmtDay = (ds: string) => new Date(ds + 'T00:00:00').toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' });

type FormFill = { rows: Record<string, RowInput>; remits: Remit[]; riceFree: string; riceCost: string };

/** The form as a saved sheet fills it — or empty, for a day without one. */
function formOf(sheet: SavedSheet | undefined, date: string): FormFill {
  const rows: Record<string, RowInput> = {};
  if (!sheet) return { rows, remits: [], riceFree: '', riceCost: '' };
  for (const sec of ['a', 'b'] as const) {
    for (const [id, r] of Object.entries(sheet[sec] ?? {})) {
      rows[`${sec}:${id}`] = {
        open: r.open ? Number(r.open).toFixed(3) : '',
        receipt: r.receipt ? Number(r.receipt).toFixed(3) : '',
        sales: r.sales ? Number(r.sales).toFixed(3) : '',
        ...(isOpenFixed(r) ? { fixed: true } : {}),
      };
    }
  }
  return {
    rows,
    // Read through the shared reader so sheets saved before transactions
    // existed (a bare remits array, or only remitAmount) still come back as
    // deposits with stable ids rather than vanishing from the month.
    remits: txnsOf(sheet, date).map(({ salesDate: _s, additional: _a, ...t }) => t),
    // A saved 0 comes back as 0 — it was an answer, not a blank.
    riceFree: riceBox(sheet.freeRice),
    riceCost: riceBox(sheet.costRice),
  };
}

export default function DailyEntryPage() {
  const { user } = useAuth();
  const shops: ShopRec[] = useShops();
  const entryStore = useStore<Record<string, SavedSheet>>('entryStore') ?? {};
  const inspectionStore = useStore<Record<string, InspDay>>('inspectionStore') ?? {};
  const meManualStore = useStore<Record<string, Partial<MonthlyBlock>>>('meManualStore') ?? {};
  const salesCloseStore = useStore<Record<string, SalesClose>>('salesCloseStore') ?? {};
  const receiptStore = useStore<ReceiptRow[]>('receiptStore') ?? [];
  const holidays = useStore<GovtHolidayMap>('__holidays');

  const isCrsUser = !!user?.crsId && user.role !== 'ADMIN';
  const shopIds = isCrsUser ? [user!.crsId as number] : shops.map((_, i) => i + 1);

  const [crsVal, setCrsVal] = useState(isCrsUser ? String(user!.crsId) : '');
  const [date, setDate] = useState(todayIso());
  const [rows, setRows] = useState<Record<string, RowInput>>({});
  const [remits, setRemits] = useState<Remit[]>([]);
  const [remitAmt, setRemitAmt] = useState('');
  const [remitDate, setRemitDate] = useState(todayIso());
  const [remitErr, setRemitErr] = useState<{ amount?: string; date?: string }>({});
  const [savedMsg, setSavedMsg] = useState('');
  const [inspOpen, setInspOpen] = useState(false);
  const [clearOpen, setClearOpen] = useState(false);
  /** A second-or-later deposit waiting for its reason. */
  const [pendingRemit, setPendingRemit] = useState<null | { amount: number; date: string; account: RemitAcct }>(null);
  /** Set when the DSS download needs paying for before it can be built. */
  const [dssPay, setDssPay] = useState<null | { order: Order; upi: Upi | null }>(null);
  const gridRef = useRef<HTMLDivElement>(null);

  const crsId = crsVal ? Number(crsVal) : null;
  const key = crsVal && date ? `${crsVal}_${date}` : '';
  const saved = key ? entryStore[key] : undefined;
  const insp = key ? inspectionStore[key] : undefined;
  const lists = useCommodityLists(crsId);

  // CRS 29 only — the day's Free Rice and Cost Rice, required to complete the
  // day and printed on the camp's C RICE statement (engine/crs29Rice.ts).
  const riceShop = hasRiceFields(crsId);
  const [riceFree, setRiceFree] = useState('');
  const [riceCost, setRiceCost] = useState('');
  const [riceErr, setRiceErr] = useState<{ free?: RiceBoxError; cost?: RiceBoxError }>({});
  const riceFreeRef = useRef<HTMLInputElement>(null);
  const riceCostRef = useRef<HTMLInputElement>(null);
  const remitAmtRef = useRef<HTMLInputElement>(null);

  // Field permissions follow the ROLE, not whether a shop is attached: the
  // server decides on `session.role === 'ADMIN'` and the two must agree, or a
  // box looks editable and the save comes back 403.
  const isAdmin = user?.role === 'ADMIN';
  const sheetProjected = isProjectedSheet(saved);

  /**
   * Has this shop used its one-time Initial Opening Balance? The server's
   * record (engine/stockInit.ts) — persistent, and never reset by the shop
   * being made inactive and active again. Before that record exists at all, a
   * shop with any saved sheet counts as started, as the server reads it.
   * `justStarted` covers the few seconds between this screen's own first save
   * and the record arriving by live sync, so the boxes lock at once.
   */
  const stockInitRaw = useStore<unknown>('__stockInit');
  const [justStarted, setJustStarted] = useState<number[]>([]);
  const shopStarted =
    !!crsId &&
    (justStarted.includes(crsId) ||
      (stockInitRaw !== undefined
        ? isInitialized(readStockInit(stockInitRaw), crsId)
        : firstStockDates(entryStore, [crsId]).has(crsId)));
  const firstDay = crsId && stockInitRaw !== undefined ? initialDate(readStockInit(stockInitRaw), crsId) : null;
  /** A shop user may not key a day before the shop's first day — it would re-carry the Initial Opening away. */
  const beforeFirstDay = !isAdmin && shopStarted && !!firstDay && !!date && date < firstDay && !saved;

  /**
   * Re-open the sheet whenever the shop or date changes — and once more when
   * the sheet itself arrives.
   *
   * The stores load over the network AFTER this page mounts, so on a reload
   * the effect first runs against an empty entryStore and reads nothing into
   * the boxes; keyed on the date alone it never ran again, and a shop that
   * reloaded its own saved day found Sales blank and Closing wrong. The
   * figures were in the database the whole time, just never read into the
   * form.
   *
   * It runs again whenever the day's sheet changes underneath this screen:
   * the stores arriving after mount, somebody else saving this day, an
   * approved clear, or an earlier day's change re-carrying this one's Opening
   * (live sync, dataStore.ts; engine/rechain.ts). A form nobody has typed into
   * since it was last filled takes the new figures. One somebody has typed
   * into keeps the typing, and a banner says the day moved — what the clerk is
   * halfway through is never thrown away, and neither is the just-saved banner.
   */
  const opened = useRef('');
  /** The form as last filled from the store — what "untouched" is measured against. */
  const filled = useRef('');
  const [remoteChanged, setRemoteChanged] = useState(false);
  const applyFill = (f: FormFill) => {
    setRows(f.rows);
    setRemits(f.remits);
    setRiceFree(f.riceFree);
    setRiceCost(f.riceCost);
    filled.current = JSON.stringify(f);
  };
  useEffect(() => {
    if (!key) return;
    const stamp = `${key}:${saved ? 'loaded' : 'empty'}`;
    const fill = formOf(entryStore[key], date);
    const fillJson = JSON.stringify(fill);
    const changedDay = opened.current.split(':')[0] !== key;
    opened.current = stamp;

    if (!changedDay) {
      // This save of ours lands here already filled (save() fills the form).
      if (fillJson === filled.current) return;
      const formJson = JSON.stringify({ rows, remits, riceFree, riceCost });
      if (formJson === filled.current || formJson === fillJson) {
        applyFill(fill);
        setRemoteChanged(false);
      } else {
        setRemoteChanged(true);
      }
      return;
    }

    applyFill(fill);
    setRemitDate(date);
    setRemitAmt('');
    setRemitErr({});
    setRiceErr({});
    setSavedMsg('');
    setRemoteChanged(false);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key, saved]);

  const adjFor = (sec: 'a' | 'b', id: string) => {
    const r = insp?.[sec]?.[id];
    return { excess: Number(r?.excess) || 0, shortage: Number(r?.shortage) || 0, transfer: Number(r?.transfer) || 0 };
  };

  // Sorted once per shop rather than per commodity — derive() runs it 30+ times.
  const priorDates = useMemo(() => (crsVal ? entryDatesDesc(entryStore, crsVal) : []), [entryStore, crsVal]);

  /**
   * The stock chain for this shop, indexed once and asked per commodity.
   * It knows the saved sheets AND the days that moved stock without one —
   * see src/lib/engine/stockChain.ts.
   */
  const chain = useMemo(
    () => (crsId ? buildChainIndex(entryStore, inspectionStore, receiptStore, crsId) : null),
    [entryStore, inspectionStore, receiptStore, crsId],
  );

  /** Where this sheet's openings carry from, for the banner. */
  const carryFrom = useMemo(() => {
    if (!crsVal || !date) return null;
    const from = priorDates.find((ds) => ds < date);
    if (!from) return null;
    // Days between the carry and this one that a receipt or an inspection
    // moved stock on — the ones the old carry stepped over.
    const moved = chain ? unsheetedMoves(chain, from, date) : [];
    return { date: from, gap: gapDays(from, date), moved };
  }, [priorDates, crsVal, date, chain]);

  /**
   * Godown receipts keyed on the Receipt Register for this shop-day.
   * They fill the Receipt column instead of it being keyed a second time —
   * see src/lib/engine/receiptRollup.ts for why the register wins.
   */
  const dayReceipts = useMemo(
    () => (crsId && date ? receiptQtyForDay(receiptStore, crsId, date) : {}),
    [receiptStore, crsId, date],
  );
  const hasGodown = Object.keys(dayReceipts).length > 0;

  type Derived = {
    open: number;
    /** The carried balance, shown read-only (shop staff). */
    openAuto: boolean;
    /** Closed to this shop user: the Initial Opening is used, or an administrator fixed it. */
    openHeld: boolean;
    /** Shop staff typing the one-time Initial Opening Balance. */
    openInitial: boolean;
    /** An administrator may type it — a correction. */
    openAdmin: boolean;
    /** Saved as a fixed Opening that later days carry from. */
    openFixed: boolean;
    /** What the chain would carry in, or null at the start of the chain. */
    carry: number | null;
    receipt: number;
    receiptAuto: boolean;
    /** Read-only because Receipt belongs to the Receipt Register. */
    receiptHeld: boolean;
    sales: number;
    total: number;
    close: number;
    amount: number;
    adj: ReturnType<typeof adjFor>;
  };
  const derive = (sec: 'a' | 'b', c: Commodity): Derived => {
    const r = rows[`${sec}:${c.id}`] ?? {};
    // The carried balance: the last sheet's closing PLUS anything that moved
    // stock on the sheet-less days since — a godown delivery on a day nobody
    // keyed does not wait for a sheet before it arrives.
    const auto = chain ? openingFor(chain, date, c.id, sec).value : null;
    const savedRow = saved?.[sec]?.[c.id];
    const savedOpen = savedRow?.open;
    // Opening follows the CALENDAR, not the order days were keyed in: a day
    // with an earlier balance to carry from opens with that balance — saved or
    // not, typed over or not, for every role. A different figure here would
    // break the chain the day before closes into, and every save rebuilds that
    // chain in date order anyway (engine/rechain.ts). Only the start of the
    // chain, a day with nothing earlier, takes a typed Opening.
    //
    // Shop staff type an Opening once, ever: the Initial Opening Balance, at the
    // start of the chain, before the shop has started (engine/stockInit.ts).
    // After that every Opening is carried, or held at what is stored.
    //
    // An administrator may type any Opening. Typed where a balance carries in,
    // it is a correction: saved fixed, and the days after carry from it.
    // Emptying the box goes back to the carry. src/lib/stockGuard.ts is the
    // same rule, server-side.
    let open: number;
    let openAuto = false;
    let openHeld = false;
    let openInitial = false;
    let openFixed = false;
    const openAdmin = isAdmin;
    if (isAdmin) {
      open = auto === null || r.fixed ? Number(r.open) || 0 : auto;
      // Typed back to exactly the carry is no correction at all. A fixed start
      // of the chain stays marked, so a day keyed before it cannot carry it away.
      openFixed = !!r.fixed && (auto === null || !near3(open, auto));
    } else if (isOpenFixed(savedRow)) {
      openHeld = true;
      openFixed = true;
      open = Number(savedOpen) || 0;
    } else if (auto !== null) {
      openAuto = true;
      open = auto;
    } else if (!openingLocked(false, shopStarted)) {
      openInitial = true;
      openFixed = true;
      open = Number(r.open) || 0;
    } else {
      openHeld = true;
      open = Number(savedOpen) || 0;
    }
    // A register quantity is never stored as 0, so its presence alone decides.
    const godown = dayReceipts[c.id] || 0;
    const receiptAuto = godown > 0;
    // Shop staff never key a Receipt here; it fills in from the register. A
    // figure keyed before that rule existed still shows — read-only — rather
    // than silently dropping out of a saved sheet.
    const receiptHeld = !receiptAuto && receiptLocked(isAdmin);
    const receipt = receiptAuto ? godown : receiptHeld ? Number(savedRow?.receipt) || 0 : Number(r.receipt) || 0;
    const sales = Number(r.sales) || 0;
    const adj = adjFor(sec, c.id);
    const total = open + receipt + adj.excess - adj.shortage - adj.transfer;
    const close = total - sales;
    const amount = c.free ? 0 : sales * c.rate;
    return { open, openAuto, openHeld, openInitial, openAdmin, openFixed, carry: auto, receipt, receiptAuto, receiptHeld, sales, total, close, amount, adj };
  };

  /**
   * An administrator's correction to Opening, Total or Closing. Total and
   * Closing are arithmetic, so a corrected Total or Closing is saved as the
   * Opening that produces it — Sales, the money the shop banked, stays as
   * keyed:
   *
   *     Opening = Total − Receipt ∓ adjustments
   *     Opening = Closing + Sales − Receipt ∓ adjustments
   *
   * Empty goes back to the carried balance.
   */
  const adminSet = (sec: 'a' | 'b', c: Commodity, field: 'open' | 'total' | 'close', raw: string) => {
    const k = `${sec}:${c.id}`;
    if (raw.trim() === '') {
      setRows((prev) => ({ ...prev, [k]: { ...prev[k], open: '', fixed: false } }));
      return;
    }
    const v = Number(raw);
    if (!Number.isFinite(v) || v < 0) return;
    const d2 = derive(sec, c);
    const net = d2.receipt + d2.adj.excess - d2.adj.shortage - d2.adj.transfer;
    const open = field === 'open' ? v : field === 'total' ? v - net : v + d2.sales - net;
    if (open < -0.0005) {
      void appAlert({
        title: 'That would need a negative Opening',
        tone: 'warning',
        message: `${c.en}: a ${field === 'total' ? 'Total' : 'Closing'} of ${v.toFixed(3)} would need an Opening of ${open.toFixed(3)}. Correct the Sales or the Receipt instead.`,
      });
      return;
    }
    setRows((prev) => ({ ...prev, [k]: { ...prev[k], open: String(Math.round(open * 1000) / 1000), fixed: true } }));
  };

  const totals = useMemo(() => {
    const sum = { a: { open: 0, rec: 0, ex: 0, sh: 0, tr: 0, total: 0, sales: 0, close: 0, amt: 0 }, b: { open: 0, rec: 0, ex: 0, sh: 0, tr: 0, total: 0, sales: 0, close: 0, amt: 0 } };
    for (const [sec, comms] of [['a', lists.a], ['b', lists.b]] as const) {
      for (const c of comms) {
        const d = derive(sec, c);
        const s = sum[sec];
        s.open += d.open;
        s.rec += d.receipt;
        s.ex += d.adj.excess;
        s.sh += d.adj.shortage;
        s.tr += d.adj.transfer;
        s.total += d.total;
        s.sales += d.sales;
        s.close += d.close;
        s.amt += d.amount;
      }
    }
    return sum;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rows, insp, entryStore, crsVal, date, lists, dayReceipts, shopStarted, isAdmin]);
  const grand = totals.a.amt + totals.b.amt;
  const remitNC = remits.reduce((t, r) => (r.account === 'ce' ? t : t + r.amount), 0);
  const remitCE = remits.reduce((t, r) => (r.account === 'ce' ? t + r.amount : t), 0);
  const remitTotal = remitNC + remitCE;
  /**
   * The deposits the database already holds for this day. A shop user may add
   * deposits and take back ones they have not saved yet, but a saved one is an
   * administrator's to change or remove — /api/state refuses the rest
   * (stockGuard rule 1b), so this only keeps the screen honest about it.
   */
  const savedRemits = useMemo(() => savedRemitIds(saved, date), [saved, date]);

  const anyAdj = (['excess', 'shortage', 'transfer'] as const).filter((f) =>
    [...lists.a.map((c) => adjFor('a', c.id)), ...lists.b.map((c) => adjFor('b', c.id))].some((a) => a[f] !== 0),
  );
  const showAdj = new Set(anyAdj);

  const setField = (sec: 'a' | 'b', id: string, field: keyof RowInput, val: string) => {
    if (val !== '' && (isNaN(Number(val)) || Number(val) < 0)) return;
    setRows((prev) => ({ ...prev, [`${sec}:${id}`]: { ...prev[`${sec}:${id}`], [field]: val } }));
  };

  /**
   * Enter / ↑ / ↓ move down the column being keyed — not along the row.
   *
   * This used to walk `input[data-nav]` in DOM order, which for a viewer with
   * Opening, Receipt and Sales all editable meant Enter from a row's Sales
   * landed in the NEXT row's Opening. A clerk keying the Sales column would
   * have been putting sales figures into opening balances. The column is the
   * unit of travel; see src/lib/gridNav.ts.
   */
  const gridKey = (e: React.KeyboardEvent<HTMLInputElement>) => columnKeyDown(e, gridRef.current);

  const remitCollect = (): Remit[] | null => {
    setRemitErr({});
    const raw = remitAmt.trim();
    const amt = parseFloat(raw);
    const hasAmount = raw !== '' && !isNaN(amt) && amt > 0;
    const list = [...remits];
    if (hasAmount) {
      if (!remitDate) {
        setRemitErr({ date: 'Please select the Remittance Date.' });
        return null;
      }
      // A second deposit for the same sales date needs its reason, and that is
      // asked for by Add — so a typed-but-not-added amount cannot slip past it.
      if (list.length) {
        setRemitErr({ amount: 'Press ➕ Add to record this as an additional remittance and choose its reason.' });
        return null;
      }
      list.push({ id: newRemitId(), amount: amt, date: remitDate, account: 'nc', createdBy: user?.username, createdAt: new Date().toISOString() });
    } else if (!list.length) {
      setRemitErr({ amount: 'Please enter the Remittance Amount.', date: remitDate ? undefined : 'Please select the Remittance Date.' });
      return null;
    }
    return list;
  };

  /**
   * Which account a NEW deposit goes into. Shop staff never see this — every
   * deposit they key is Non-Cereal, exactly as before. An administrator may
   * record a Cereal A/C deposit, which the office banks alongside the
   * Non-Cereal takings for the same date; a Cereal deposit is its own kind of
   * row, not an "additional" Non-Cereal one, so it is never asked for a reason.
   */
  const [remitAcct, setRemitAcct] = useState<RemitAcct>('nc');

  const addRemit = () => {
    setRemitErr({});
    const amt = parseFloat(remitAmt.trim());
    const errs: typeof remitErr = {};
    if (!(remitAmt.trim() !== '' && !isNaN(amt) && amt > 0)) errs.amount = 'Please enter the Remittance Amount.';
    if (!remitDate) errs.date = 'Please select the Remittance Date.';
    if (errs.amount || errs.date) {
      setRemitErr(errs);
      return;
    }
    // The first deposit of a sales date is the ordinary one. Every later one
    // is an additional remittance and must say why — except a Cereal A/C
    // deposit, which is a separate account rather than a second Non-Cereal
    // payment, and so carries no reason.
    const acct = isAdmin ? remitAcct : 'nc';
    if (remits.length && acct !== 'ce') {
      setPendingRemit({ amount: amt, date: remitDate, account: 'nc' });
      return;
    }
    setRemits((r) => [...r, { id: newRemitId(), amount: amt, date: remitDate, account: acct, createdBy: user?.username, createdAt: new Date().toISOString() }]);
    setRemitAmt('');
  };

  /** Second-or-later deposit, once its reason has been chosen. */
  /**
   * An administrator's correction to a deposit already on the list: the same
   * row, by id, with its amount, date or reason changed — never a second row.
   * It is saved with the day, and Monthly Remittance and the statements read
   * the day sheets, so they follow on save. /api/state refuses the same change
   * from shop staff (stockGuard.ts, rule 1b).
   */
  const [remitEdit, setRemitEdit] = useState<{ id: string; amount: string; date: string; type: RemitType } | null>(null);
  const applyRemitEdit = () => {
    if (!remitEdit) return;
    const amount = parseFloat(remitEdit.amount);
    if (!(amount > 0) || !remitEdit.date) {
      void appAlert('Enter an amount above zero and a remittance date.');
      return;
    }
    setRemits((list) =>
      list.map((t) =>
        t.id !== remitEdit.id
          ? t
          : applyRemitType({ ...t, amount, date: remitEdit.date }, remitEdit.type),
      ),
    );
    setRemitEdit(null);
  };

  const commitAdditional = (reason: RemitReason) => {
    if (!pendingRemit) return;
    setRemits((r) => [
      ...r,
      { id: newRemitId(), amount: pendingRemit.amount, date: pendingRemit.date, account: pendingRemit.account, reason, createdBy: user?.username, createdAt: new Date().toISOString() },
    ]);
    setPendingRemit(null);
    setRemitAmt('');
  };

  /**
   * Save the sheet; returns true when written. `quiet` leaves the success
   * popup to the caller — the month-close saves the day sheet on its way and
   * confirms the month, not the day.
   */
  const save = async (opts?: { quiet?: boolean }): Promise<boolean> => {
    if (!crsVal || !date) return false;
    // Rice first — it sits above Remittance — but both are checked, so one
    // press marks every box still to fill. Blank is refused; 0 is an answer.
    const riceChk = riceShop ? checkRiceBoxes(riceFree, riceCost) : null;
    if (riceChk) setRiceErr({ free: riceChk.free, cost: riceChk.cost });
    const list = remitCollect();
    if (riceChk && !riceChk.rice) {
      const box = riceChk.free ? riceFreeRef.current : riceCostRef.current;
      void appAlert({ title: 'Rice sales details required', tone: 'warning', icon: '🌾', message: riceChk.invalid ? RICE_INVALID : RICE_DAILY_REQUIRED }).then(() => box?.focus());
      return false;
    }
    if (!list) return false;
    const rice = riceChk?.rice ?? null;

    if (beforeFirstDay) {
      void appAlert({
        title: 'Before this shop’s first day',
        tone: 'warning',
        message: `CRS ${crsVal} started its stock on ${fmtDay(firstDay!)}. Days before that can only be entered by an administrator.`,
      });
      return false;
    }

    // The shop's one-time Initial Opening Balance: said plainly before it is used.
    const initialSave = !isAdmin && !shopStarted;
    if (initialSave) {
      const ok = await appConfirm({
        title: 'Confirm Initial Opening Balance',
        tone: 'warning',
        icon: '🔐',
        message:
          'Once confirmed, you cannot manually edit the Opening Balance again. Future OB values will be automatically calculated from the previous Closing Balance.',
        cancelLabel: 'Cancel',
        confirmLabel: 'Confirm & Save',
        defaultCancel: true,
      });
      if (!ok) return false;
    }

    const wasProjected = isProjectedSheet(saved);
    if (saved) {
      const when = new Date(date + 'T00:00:00').toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' });
      const shop = `CRS ${crsVal} — ${shops[Number(crsVal) - 1]?.name ?? ''}`;
      const ok = await appConfirm(
        wasProjected
          ? {
              title: "Convert the month's sheet into a day sheet",
              tone: 'warning',
              confirmLabel: 'Convert',
              message:
                `${when} holds the whole month for ${shop}, written by Monthly Entry.\n\n` +
                'Saving here turns it into a day sheet keyed on this page, and from then on Monthly Entry follows the day sheets for this month. This cannot be undone.\n\nConvert it?',
            }
          : {
              title: 'Replace saved day sheet',
              tone: 'warning',
              confirmLabel: 'Replace',
              message:
                `A day sheet is already saved for ${shop} on ${when}.\n\n` +
                'Saving now replaces it with what is currently on screen. This cannot be undone.\n\nReplace the saved sheet?',
            },
      );
      if (!ok) return false;
    }

    const snap: SavedSheet = { a: {}, b: {} };
    for (const [sec, comms] of [['a', lists.a], ['b', lists.b]] as const) {
      for (const c of comms) {
        const d = derive(sec, c);
        snap[sec]![c.id] = {
          open: d.open, receipt: d.receipt, total: d.total, sales: d.sales, close: d.close, amount: d.amount,
          ...d.adj,
          // Kept, not carried: an administrator's correction or the Initial Opening.
          ...(d.openFixed ? { openFixed: true } : {}),
        } as never;
      }
    }
    // `remitAmount` stays the day's whole deposit and `remitDate` the earliest
    // of them, so the statement builders and the DSS export keep reading the
    // fields they always have; the account split is carried alongside.
    snap.remits = list;
    Object.assign(snap, sheetTotals(list));

    // A month is keyed by day OR by month, never both. This sheet makes it a
    // day-keyed month, so whatever Monthly Entry projected onto the last day
    // goes with it — left behind, the roll-up would still be right (it never
    // reads a projection) but the DSS and the date-wise sections would print
    // the month twice.
    const [y, m] = date.split('-').map(Number);
    let tookOver = false;
    // The day the person saved — the activity log tells it from the later days
    // this save recalculates (activityLog/core.ts).
    crsData.markEdited('entryStore', key);
    crsData.update<Record<string, SavedSheet>>('entryStore', (d) => {
      // CRS 29 carries its Free Rice / Cost Rice on the sheet; every other
      // shop's sheet is written exactly as before.
      d[key] = withRice(snap, rice);
      tookOver = dropProjectedSheet(d, Number(crsVal), m, y);
    });
    crsData.update<Record<string, InspDay>>('inspectionStore', (d) => {
      dropProjectedAdjustments(d, Number(crsVal), m, y);
    });
    // The register row Monthly Entry wrote for the whole month goes too. The
    // day sheets carry their own receipts from here on, and leaving it would
    // count the month's stock a second time on its last day.
    const drop = dropMonthlyReceipt(crsData.get<ReceiptRow[]>('receiptStore') ?? [], Number(crsVal), m, y);
    if (drop.dropped) crsData.set('receiptStore', drop.rows);

    // Republish the month so Monthly Entry and statements see this day.
    // Stores are re-read AFTER the confirm dialog: an autosave conflict can
    // reload them while it sits open, and the rollup must not drop a day
    // someone else saved in the meantime.
    const freshEntry = crsData.get<Record<string, SavedSheet>>('entryStore') ?? {};
    const freshInsp = crsData.get<Record<string, InspDay>>('inspectionStore') ?? {};
    const freshManual = crsData.get<Record<string, Partial<MonthlyBlock>>>('meManualStore') ?? {};
    const freshRcp = crsData.get<ReceiptRow[]>('receiptStore') ?? [];
    const { merged, source } = rebuildMonthlyFromDaily(Number(crsVal), m, y, freshEntry, freshInsp as never, freshManual[`${crsVal}_${m}_${y}`], lists, freshRcp);
    const moKey = `${crsVal}_${m}_${y}`;
    crsData.update<Record<string, MonthlyBlock>>('monthlyStore', (d) => {
      d[moKey] = merged;
    });
    crsData.update<Record<string, SourceBlock>>('meSourceStore', (d) => {
      d[moKey] = source;
    });

    // Later saved days open with this day's Closing — and a day keyed BEFORE
    // this earlier one no longer keeps the Opening typed on it. So the chain is
    // rebuilt in date order from this day forward, and every month it moved
    // republishes: Monthly Sales, closing stock, the DSS and the statements all
    // read the rebuilt figures (engine/rechain.ts).
    const chained = rechainAndRepublish(
      {
        entryStore: crsData.get<Record<string, DayEntry>>('entryStore') ?? {},
        inspectionStore: crsData.get<Record<string, unknown>>('inspectionStore') ?? {},
        meManualStore: crsData.get<Record<string, Partial<MonthlyBlock>>>('meManualStore') ?? {},
        meSourceStore: crsData.get<Record<string, SourceBlock>>('meSourceStore') ?? {},
        monthlyStore: crsData.get<Record<string, MonthlyBlock>>('monthlyStore') ?? {},
        receiptStore: crsData.get<ReceiptRow[]>('receiptStore') ?? [],
      },
      Number(crsVal),
      date,
      lists,
    );
    for (const [store, value] of Object.entries(chained.patch)) crsData.set(store as never, value as never);
    const later = chained.dates.filter((ds) => ds > date);

    // The form now shows exactly what was saved — the baseline live sync
    // measures "untouched" against, so this save is not taken for someone else's.
    applyFill(formOf(crsData.get<Record<string, SavedSheet>>('entryStore')?.[key], date));
    setRemoteChanged(false);
    setRemitAmt('');
    if (snap.remitDate) setRemitDate(snap.remitDate);
    setSavedMsg(
      `CRS ${crsVal} — ${shops[Number(crsVal) - 1]?.name ?? ''} (${new Date(date + 'T00:00:00').toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' })})` +
        (tookOver || wasProjected ? " — this month is now keyed by day; Monthly Entry's projected sheet was removed" : '') +
        (later.length ? ` — Opening recalculated on ${later.length} later day${later.length === 1 ? '' : 's'} (${later.map(fmtDay).join(', ')})` : ''),
    );
    setTimeout(() => setSavedMsg(''), 5000);
    // The Initial Opening is used: lock it on this screen now, not a sync beat later.
    if (initialSave) setJustStarted((s) => [...s, Number(crsVal)]);
    // The tick is the clerk's evidence that the day is stored, so it waits for
    // the write to land in the database — a refused or conflicting save shows
    // nothing. Everything above this line is unchanged.
    const stored = await crsData.saveConfirmed();
    if (stored && !opts?.quiet) {
      saveSuccess(dailySaved(crsVal, date));
    }
    return true;
  };

  const markSalesClose = async () => {
    // Asked before anything else runs — see monthCloseConfirm.ts. Daily Sales
    // Close, right beside this button, does not ask.
    if (!(await confirmMonthlySalesClose())) return;
    if (!crsVal || !date) {
      void appAlert('Select a CRS shop and date first.');
      return;
    }
    // The day sheet is saved on the way; the month's own tick comes below,
    // once the Sales Close mark itself is stored.
    const ok = await save({ quiet: true });
    if (!ok) return;
    const [y, m, lastDay] = date.split('-').map(Number);
    // Aggregate the month's sales (kgs) per commodity up to this date, from
    // the store as it stands AFTER save() wrote the sheet.
    const kgsById: Record<string, number> = {};
    const store = crsData.get<Record<string, SavedSheet>>('entryStore') ?? {};
    for (let day = 1; day <= lastDay; day++) {
      const sheet = store[`${crsVal}_${y}-${pad2(m)}-${pad2(day)}`];
      if (!sheet) continue;
      for (const sec of ['a', 'b'] as const) {
        for (const [cid, r] of Object.entries(sheet[sec] ?? {})) kgsById[cid] = (kgsById[cid] ?? 0) + (Number(r.sales) || 0);
      }
    }
    const sumType = (map: Record<string, number>) =>
      Object.entries(map).reduce((bags, [cid, div]) => bags + ((kgsById[cid] ?? 0) > 0 ? Math.floor((kgsById[cid] ?? 0) / div) : 0), 0);
    const agg = { gunny: sumType(SC_PACK.GUNNY), poly: sumType(SC_PACK.POLY), cbox: sumType(SC_PACK.CBOX) };

    const scKey = `${crsVal}_${m}_${y}`;
    const prev = salesCloseStore[scKey];
    crsData.update<Record<string, SalesClose>>('salesCloseStore', (d) => {
      d[scKey] = { date, ...agg, updatedAt: new Date().toISOString() };
    });
    const stored = await crsData.saveConfirmed();
    await appAlert({
      title: 'Sales Close marked',
      tone: 'primary',
      icon: '🔒',
      message:
        `Sales Close marked for ${date.split('-').reverse().join('/')}` +
        (prev && prev.date !== date ? `\n(previous mark on ${prev.date.split('-').reverse().join('/')} was replaced)` : '') +
        `\n\nMonth totals up to this date:\n  Sales Gunny = ${agg.gunny}  → 50 KG SS Receipt\n  Sales Poly  = ${agg.poly}  → POLY Receipt\n  Sales C.Box = ${agg.cbox}  → C.BOX Receipt`,
    });
    // After the figures have been read and the dialog dismissed, so the tick
    // is not hidden behind it.
    if (stored) {
      saveSuccess(monthlySaved(crsVal, m, y));
    }
  };

  const resetForm = () => {
    setRows({});
    setRemits([]);
    setRemitAmt('');
    setRemitErr({});
    setRiceFree('');
    setRiceCost('');
    setRiceErr({});
  };

  /**
   * Clear only resets the form — it never wrote to the database. What erases a
   * saved day is clearing and then SAVING, so this is where the approval rule
   * belongs: with saved figures on this date, Clear asks for approval instead
   * of emptying the boxes the clerk would then save over. An admin, and a date
   * with nothing saved, clear normally.
   *
   * The refusal is enforced in /api/state regardless of what happens here.
   */
  const savedHasData = !!saved && hasData(saved) && !isProjectedSheet(saved);
  const clearScope: ClearScope | null =
    crsVal && date
      ? {
          crsId: Number(crsVal),
          shopName: shops[Number(crsVal) - 1]?.name ?? '',
          storeKeys: [`${crsVal}_${date}`],
          scopeKind: 'day',
          scopeLabel: fmtDay(date),
        }
      : null;

  const clearForm = () => {
    // Saved figures are cleared through a request for everyone — raised and
    // approved at once for an administrator (ClearRequestDialog), so the sheet
    // is really removed rather than saved over with zeros.
    if (savedHasData && clearScope) {
      setClearOpen(true);
      return;
    }
    resetForm();
  };

  // DSS preview/export — the verbatim legacy builder behind a real-DOM shim
  // (src/generated/dss-legacy.js). Loaded on demand; the viewer overlay,
  // print flow and styled .xlsx work exactly as in the classic app.
  const openDss = async () => {
    if (!crsVal) {
      void appAlert('Please select a CRS shop first.');
      return;
    }

    // The DSS bulk download is charged per day of the month. Unlike the
    // statements, this file is still assembled in the browser: the styled
    // .xlsx needs xlsx-js-style's cell borders and fonts, which the copy of
    // SheetJS in this project cannot write, and shipping a DSS with its
    // formatting stripped would be a worse regression than a weaker gate.
    // So the check here is server-verified but client-enforced — see the note
    // in CLAUDE.md.
    const ref = date ? new Date(date + 'T00:00:00') : new Date();
    const dssMonth = ref.getMonth() + 1;
    const dssYear = ref.getFullYear();

    try {
      const access = await fetchAccess(Number(crsVal), dssMonth, dssYear);
      // The DSS has its own switch (Payment Access Control) — not the Statements'.
      if (!access.dssFree && !access.dssPaid) {
        const { order, upi } = await createOrder({ kind: 'dss', month: dssMonth, year: dssYear });
        setDssPay({ order, upi });
        return;
      }
    } catch (e) {
      void appAlert(e instanceof Error ? e.message : 'Could not check the download entitlement.');
      return;
    }

    // The DSS is built in this browser, so the server never sees it opened —
    // it is reported for the activity log instead. Fire-and-forget: a log gap
    // must not stand between a shop and its DSS.
    void fetch('/api/activity', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ module: 'DSS', action: 'viewed', crsId: Number(crsVal), month: dssMonth, year: dssYear }),
    }).catch(() => undefined);

    const { createDssEngine } = await import('@/generated/dss-legacy');
    // One page per shop per date: the day sheets, plus a page worked out from
    // the chain for every date with receipts and no sheet (engine/dssDays.ts).
    // From the stores as they stand now, so a receipt or sale changed a moment
    // ago is already in it.
    const dssInsp = crsData.get<Record<string, unknown>>('inspectionStore') ?? {};
    const engine = createDssEngine({
      stores: {
        entryStore: withReceiptOnlyDays(crsData.get<Record<string, unknown>>('entryStore') ?? {}, dssInsp, crsData.get<ReceiptRow[]>('receiptStore') ?? [], Number(crsVal), dssMonth, dssYear),
        inspectionStore: dssInsp,
      },
      CRS_LIST: shops,
      APP_CONFIG: crsData.get('__config') ?? {},
      CRS_ACCOUNTS: crsData.get('__accounts') ?? {},
      alert: (m: string) => void appAlert(m),
    });
    engine.openPreview(crsVal, date);
  };

  const scRec = crsVal && date ? salesCloseStore[`${crsVal}_${Number(date.split('-')[1])}_${Number(date.split('-')[0])}`] : undefined;
  const holName = date ? (holidayOn(new Date(date + 'T00:00:00'), holidays)?.name ?? null) : null;
  const d = date ? new Date(date + 'T00:00:00') : null;
  const dateLabel = d
    ? `${['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'][d.getDay()]}, ${d.toLocaleDateString('en-IN', { day: 'numeric', month: 'long', year: 'numeric' })}` +
      (holName ? ` · ${holName}` : '')
    : '';

  const inspParts: string[] = [];
  if (insp) {
    const lookup = new Map<string, string>([...lists.a.map((c) => [`a${c.id}`, c.en] as [string, string]), ...lists.b.map((c) => [`b${c.id}`, c.en] as [string, string])]);
    for (const sec of ['a', 'b'] as const) {
      for (const [id, r] of Object.entries(insp[sec] ?? {})) {
        for (const [f, sign, color] of [['excess', '+', '#166534'], ['shortage', '−', '#B91C1C'], ['transfer', '→', '#92400E']] as const) {
          const v = Number(r[f]) || 0;
          if (v) inspParts.push(`<span style="display:inline-block;margin-right:10px"><strong style="color:${color}">${sign}${+v.toFixed(3)}</strong> ${lookup.get(sec + id) ?? id} <span style="opacity:.7">(${f})</span></span>`);
        }
      }
    }
  }

  // One line per commodity the Receipt Register filled in for this date.
  // Ids outside this shop's list are skipped rather than shown raw — the grid
  // has no row for them, so naming them would only puzzle the clerk.
  const godownParts: string[] = [];
  if (hasGodown) {
    const names = new Map([...lists.a, ...lists.b].map((c) => [c.id, c.en] as [string, string]));
    for (const [id, qty] of Object.entries(dayReceipts)) {
      const nm = names.get(id);
      if (nm) godownParts.push(`${nm} ${+qty.toFixed(3)}`);
    }
  }

  const thA = (label: React.ReactNode, extra?: React.CSSProperties, cls?: string) => (
    <th className={cls} style={{ padding: '9px 8px', textAlign: 'center', fontSize: 10, fontWeight: 700, color: 'var(--muted)', borderBottom: '1px solid var(--border)', ...extra }}>{label}</th>
  );

  const adjCell = (val: number, kind: 'excess' | 'shortage' | 'transfer', bdr: string) => {
    const theme = { excess: { bg: '#DCFCE7', fg: '#166534', bd: '#86EFAC', sign: '+' }, shortage: { bg: '#FEE2E2', fg: '#B91C1C', bd: '#FCA5A5', sign: '−' }, transfer: { bg: '#FEF3C7', fg: '#92400E', bd: '#FDE047', sign: '→' } }[kind];
    if (!showAdj.has(kind)) return null;
    return (
      <td style={{ padding: '4px 3px', textAlign: 'center', borderBottom: bdr }}>
        {val ? (
          <span style={{ display: 'inline-block', background: theme.bg, border: `1px solid ${theme.bd}`, color: theme.fg, fontSize: 11, fontWeight: 800, padding: '3px 7px', borderRadius: 5, minWidth: 38 }}>
            {theme.sign}
            {+val.toFixed(3)}
          </span>
        ) : (
          <span style={{ color: '#CBD5E1', fontSize: 11 }}>—</span>
        )}
      </td>
    );
  };

  /**
   * An administrator's Opening, Total or Closing box. Typed text is kept while
   * the box has focus and applied on leaving it (or Enter) — Total and Closing
   * are worked back into an Opening, and re-deriving on every keystroke would
   * rewrite the figure under the cursor. Dashed violet marks what only an
   * administrator can change; a filled violet box is a saved correction.
   */
  const [adminDraft, setAdminDraft] = useState<{ key: string; text: string } | null>(null);
  const adminInput = (sec: 'a' | 'b', c: Commodity, field: 'open' | 'total' | 'close', d2: Derived, extra?: React.CSSProperties) => {
    const k = `${sec}:${c.id}:${field}`;
    const shown = field === 'open' ? d2.open : field === 'total' ? d2.total : d2.close;
    const editing = adminDraft?.key === k;
    const commit = () => {
      if (!editing) return;
      const text = adminDraft!.text;
      setAdminDraft(null);
      if (text.trim() === '' ? field === 'open' : Math.abs(Number(text) - shown) > 0.0005) adminSet(sec, c, field, text);
    };
    const corrected = d2.openFixed && d2.carry !== null;
    return (
      <input
        type="number"
        min={0}
        step={0.001}
        placeholder={field === 'open' && d2.carry !== null ? d2.carry.toFixed(3) : '0.000'}
        data-col={field}
        value={editing ? adminDraft!.text : shown ? shown.toFixed(3) : ''}
        onFocus={() => setAdminDraft({ key: k, text: shown ? shown.toFixed(3) : '' })}
        onChange={(e) => setAdminDraft({ key: k, text: e.target.value })}
        onBlur={commit}
        onKeyDown={(e) => {
          if (e.key === 'Enter') commit();
          gridKey(e);
        }}
        title={
          field === 'open'
            ? corrected
              ? `Opening corrected by an administrator (carried balance would be ${d2.carry!.toFixed(3)}). Later days carry from this. Clear the box to go back to the carried balance.`
              : 'Administrator: type to correct the Opening. Later days recalculate from it.'
            : `Administrator: type a ${field === 'total' ? 'Total' : 'Closing'} to correct it — the Opening is worked back so the formula still holds; Sales stay as keyed.`
        }
        style={{
          width: '100%',
          borderWidth: 1,
          borderStyle: corrected && field === 'open' ? 'solid' : 'dashed',
          borderColor: '#A78BFA',
          borderRadius: 6,
          padding: '5px 7px',
          fontSize: 12,
          textAlign: 'right',
          background: corrected && field === 'open' ? '#EDE9FE' : field === 'total' ? '#EFF6FF' : '#FAF5FF',
          color: corrected && field === 'open' ? '#5B21B6' : field === 'total' ? '#0284C7' : 'inherit',
          fontWeight: 700,
          ...extra,
        }}
      />
    );
  };

  const numInput = (sec: 'a' | 'b', c: Commodity, field: 'open' | 'receipt' | 'sales', d2: Derived, extra?: React.CSSProperties) => {
    if (field === 'open' && d2.openAdmin && !sheetProjected) return adminInput(sec, c, 'open', d2, extra);
    const r = rows[`${sec}:${c.id}`] ?? {};
    const isCarry = field === 'open' && d2.openAuto;
    // Receipts filled from the Receipt Register read blue rather than amber:
    // both are auto, but one is yesterday's closing and the other is a keyed
    // godown delivery the clerk can trace back to a receipt number.
    const isGodown = field === 'receipt' && d2.receiptAuto;
    // Held, rather than auto: the figure is the shop's own, but keying it here
    // is no longer theirs to do. Slate rather than amber or blue — nothing was
    // filled in for them, the box is simply closed.
    const isHeld = (field === 'open' && d2.openHeld) || (field === 'receipt' && d2.receiptHeld);
    const ro = isCarry || isGodown || isHeld;
    const shown = field === 'open' ? d2.open : d2.receipt;
    const val = ro ? (shown ? shown.toFixed(3) : '') : '';
    const refs = isGodown && crsId ? receiptRefsForDay(receiptStore, crsId, date, c.id) : [];
    const isInitial = field === 'open' && d2.openInitial;
    const tone = isGodown
      ? { background: '#DBEAFE', color: '#1E40AF', fontWeight: 700 }
      : isCarry
        ? { background: '#FEF3C7', color: '#92400E', fontWeight: 700 }
        : isHeld
          ? { background: '#F1F5F9', color: '#475569', fontWeight: 700 }
          : isInitial
            ? { background: '#F0FDF4', borderColor: '#4ADE80', color: '#166534', fontWeight: 700 }
            : {};
    return (
      <input
        type="number"
        min={0}
        step={0.001}
        placeholder="0.000"
        readOnly={ro}
        data-col={ro ? undefined : field}
        value={ro ? val : (r[field] ?? '')}
        onChange={(e) => setField(sec, c.id, field, e.target.value)}
        onKeyDown={gridKey}
        title={
          isGodown
            ? `From the Receipt Register — ${refs.join(', ')}. Edit it on the Receipt page.`
            : isCarry
              ? "Auto-carried from the previous day's closing"
              : isHeld
                ? field === 'open'
                  ? d2.openFixed
                    ? 'Opening set by an administrator or as the Initial Opening Balance — locked. An administrator can correct it.'
                    : 'The Opening Balance is entered only once, when the shop starts. It is locked — an administrator can correct it.'
                  : 'Receipts are entered on the Receipt page — this column fills in from the register.'
                : isInitial
                  ? 'Initial Opening Balance — one-time entry. After saving, Openings are carried from the previous Closing.'
                  : undefined
        }
        style={{ width: '100%', border: '1px solid #E2E8F0', borderRadius: 6, padding: '5px 7px', fontSize: 12, textAlign: 'right', ...tone, ...extra }}
      />
    );
  };

  /**
   * The border is spelled out longhand rather than as the `border` shorthand
   * because a caller overrides `borderColor` on its own — the negative-closing
   * cell below does. Mixed with the shorthand, that colour is a property React
   * has to REMOVE when the value stops being negative, which it cannot do
   * predictably next to a shorthand and warns about. Longhand here means the
   * base colour is always present and callers simply replace it.
   */
  const roCell = (val: number, style?: React.CSSProperties) => (
    <input type="number" readOnly value={val ? val.toFixed(3) : ''} placeholder="0.000" style={{ width: '100%', borderWidth: 1, borderStyle: 'solid', borderColor: '#E2E8F0', borderRadius: 6, padding: '5px 7px', fontSize: 12, textAlign: 'right', background: '#F8FAFC', color: 'var(--muted)', ...style }} />
  );

  const section = (sec: 'a' | 'b', comms: Commodity[]) => {
    const secA = sec === 'a';
    if (!comms.length) return null;
    const bdr = secA ? '1px solid #EFF6FF' : '1px solid #FFF7ED';
    const t = totals[sec];
    const footBg = secA ? '#EFF6FF' : '#FFF7ED';
    const footCol = secA ? '#0369A1' : '#C2410C';
    const footBd = secA ? '2px solid #BAE6FD' : '2px solid #FED7AA';
    return (
      <div className="card" style={{ borderRadius: 0, borderTop: 'none', borderBottom: 'none', marginTop: secA ? undefined : 2 }}>
        <div style={{ background: secA ? '#F0F9FF' : '#FFF7ED', padding: '9px 16px', borderBottom: secA ? '1px solid #BAE6FD' : '1px solid #FED7AA', display: 'flex', alignItems: 'center', gap: 8 }}>
          <span style={{ background: footCol, color: '#fff', fontSize: 10, fontWeight: 800, padding: '2px 8px', borderRadius: 4 }}>SECTION {sec.toUpperCase()}</span>
          <span style={{ fontWeight: 700, fontSize: 12, color: footCol }}>{secA ? 'நியாய வகுப்பு / Main Ration Sales' : 'காவலர் அட்டை / Police Ration Card'}</span>
          <span style={{ marginLeft: 'auto', fontSize: 11, color: footCol }}>{comms.length} commodities</span>
        </div>
        <div style={{ overflowX: 'auto' }}>
          <table className="frz-table" style={{ width: '100%', borderCollapse: 'collapse', minWidth: 900 }}>
            <thead>
              <tr style={{ background: secA ? '#F8FAFC' : '#FFFBF5' }}>
                {thA('#')}
                {thA('பொருட்கள் / Commodity', { textAlign: 'left', padding: '9px 12px' }, 'frz-comm')}
                {thA('Unit')}
                {thA(<>Rate<br />(₹)</>)}
                {thA(<>ஆரம்ப இருப்பு<br />Opening</>)}
                {thA(<>வரவு<br />Receipt</>)}
                {showAdj.has('excess') ? thA(<>கூடுதல்<br />Excess</>, { color: '#166534', background: '#F0FDF4' }) : null}
                {showAdj.has('shortage') ? thA(<>போத்தாக்குறை<br />Shortage</>, { color: '#B91C1C', background: '#FEF2F2' }) : null}
                {showAdj.has('transfer') ? thA(<>மாற்றம்<br />Transfer</>, { color: '#92400E', background: '#FFFBEB' }) : null}
                {thA(<>மொத்தம்<br />Total</>, { color: '#0284C7', background: '#EFF6FF' })}
                {thA(<>மொத்த விற்பனை<br />Total Sales</>)}
                {thA(<>இறுதி இருப்பு<br />Closing</>)}
                {thA(<>விற்பனை தொகை<br />Amount (₹)</>)}
              </tr>
            </thead>
            <tbody>
              {comms.map((c, i) => {
                const d2 = derive(sec, c);
                return (
                  <tr key={c.id} style={{ background: i % 2 === 0 ? '#fff' : '#FAFCFF' }}>
                    <td style={{ padding: 8, textAlign: 'center', fontSize: 11, color: 'var(--muted)', borderBottom: bdr }}>{i + 1}</td>
                    <td className="frz-comm" style={{ padding: '8px 12px', borderBottom: bdr }}>
                      <div style={{ fontWeight: 600, fontSize: 12 }}>{c.ta}</div>
                      <div style={{ fontSize: 10, color: 'var(--muted)' }}>{c.en}</div>
                    </td>
                    <td style={{ padding: 8, textAlign: 'center', fontSize: 11, color: 'var(--muted)', borderBottom: bdr }}>{c.unit}</td>
                    <td style={{ padding: 8, textAlign: 'center', borderBottom: bdr }}>
                      {c.free ? <span style={{ color: '#16A34A', fontWeight: 600, fontSize: 10 }}>Free</span> : <span style={{ fontSize: 12, fontWeight: 600 }}>₹{c.rate.toFixed(2)}</span>}
                    </td>
                    <td style={{ padding: '4px 5px', borderBottom: bdr }}>{numInput(sec, c, 'open', d2)}</td>
                    <td style={{ padding: '4px 5px', borderBottom: bdr }}>{numInput(sec, c, 'receipt', d2)}</td>
                    {adjCell(d2.adj.excess, 'excess', bdr)}
                    {adjCell(d2.adj.shortage, 'shortage', bdr)}
                    {adjCell(d2.adj.transfer, 'transfer', bdr)}
                    <td style={{ padding: '4px 5px', borderBottom: bdr, background: '#EFF6FF' }}>
                      {isAdmin && !sheetProjected ? adminInput(sec, c, 'total', d2) : roCell(d2.total, { background: '#EFF6FF', color: '#0284C7', fontWeight: 700 })}
                    </td>
                    <td style={{ padding: '4px 5px', borderBottom: bdr }}>{numInput(sec, c, 'sales', d2, { fontWeight: 700 })}</td>
                    <td style={{ padding: '4px 5px', borderBottom: bdr }}>
                      {isAdmin && !sheetProjected
                        ? adminInput(sec, c, 'close', d2, d2.close < 0 ? { color: '#DC2626', background: '#FEF2F2', borderColor: '#FCA5A5' } : undefined)
                        : roCell(d2.close, d2.close < 0 ? { color: '#DC2626', background: '#FEF2F2', borderColor: '#FCA5A5', fontWeight: 800 } : undefined)}
                    </td>
                    <td style={{ padding: '4px 5px', borderBottom: bdr }}>
                      {c.free ? (
                        <div style={{ textAlign: 'center', padding: '6px 4px', fontSize: 11, color: '#16A34A', fontStyle: 'italic' }}>விலையில்லா</div>
                      ) : (
                        <input readOnly value={d2.amount ? d2.amount.toFixed(2) : ''} placeholder="0.00" style={{ width: '100%', border: '1px solid #E2E8F0', borderRadius: 6, padding: '5px 7px', fontSize: 12, textAlign: 'right', background: secA ? '#EFF6FF' : '#FFF3E8', color: footCol, fontWeight: 700 }} />
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
            <tfoot>
              <tr style={{ background: footBg, fontWeight: 800 }}>
                <td colSpan={4} className="frz-comm" style={{ padding: '10px 12px', fontSize: 12, color: footCol, borderTop: footBd }}>Section {sec.toUpperCase()} Total</td>
                {[t.open, t.rec].map((v, i) => (
                  <td key={i} style={{ padding: '10px 6px', textAlign: 'right', fontSize: 12, color: footCol, borderTop: footBd }}>{v.toFixed(3)}</td>
                ))}
                {showAdj.has('excess') ? <td style={{ padding: '10px 6px', textAlign: 'right', fontSize: 12, color: '#166534', borderTop: footBd, background: '#F0FDF4' }}>{t.ex.toFixed(3)}</td> : null}
                {showAdj.has('shortage') ? <td style={{ padding: '10px 6px', textAlign: 'right', fontSize: 12, color: '#B91C1C', borderTop: footBd, background: '#FEF2F2' }}>{t.sh.toFixed(3)}</td> : null}
                {showAdj.has('transfer') ? <td style={{ padding: '10px 6px', textAlign: 'right', fontSize: 12, color: '#92400E', borderTop: footBd, background: '#FFFBEB' }}>{t.tr.toFixed(3)}</td> : null}
                <td style={{ padding: '10px 6px', textAlign: 'right', fontSize: 12, color: '#0284C7', borderTop: footBd, background: '#EFF6FF' }}>{t.total.toFixed(3)}</td>
                <td style={{ padding: '10px 6px', textAlign: 'right', fontSize: 12, color: footCol, borderTop: footBd }}>{t.sales.toFixed(3)}</td>
                <td style={{ padding: '10px 6px', textAlign: 'right', fontSize: 12, color: footCol, borderTop: footBd }}>{t.close.toFixed(3)}</td>
                <td style={{ padding: '10px 6px', textAlign: 'right', fontSize: 12, color: footCol, borderTop: footBd }}>{inr(t.amt)}</td>
              </tr>
            </tfoot>
          </table>
        </div>
      </div>
    );
  };

  return (
    <div className="page active" id="page-entry">
      <div className="page-header" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', flexWrap: 'wrap', gap: 12 }}>
        <div>
          <div className="page-title">Daily Sales Entry</div>
          <div className="page-sub">தினசரி இறுப்பு / வேறுவாறு அறிக்கை — TNCSC Madurai Region</div>
        </div>
        <div style={{ display: 'flex', gap: 10, flexShrink: 0 }}>
          <button
            onClick={() => {
              if (!crsVal || !date) {
                void appAlert('Please select a CRS shop and date first.');
                return;
              }
              setInspOpen(true);
            }}
            style={{ background: 'linear-gradient(135deg,#7C3AED,#9333EA)', color: '#fff', border: 'none', padding: '9px 18px', borderRadius: 8, fontWeight: 700, fontSize: 13, cursor: 'pointer' }}
          >
            🔍 Inspection
          </button>
          <button
            onClick={() => void openDss()}
            title="Preview the daily statement (DSS) for this month — print or export the styled Excel from the viewer"
            style={{ background: 'linear-gradient(135deg,#0369A1,#0EA5E9)', color: '#fff', border: 'none', padding: '9px 18px', borderRadius: 8, fontWeight: 700, fontSize: 13, cursor: 'pointer' }}
          >
            📄 DSS
          </button>
        </div>
      </div>

      <div className="card mb-4">
        <div className="card-body">
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 16, alignItems: 'end' }}>
            <div>
              <label className="form-label">CRS Shop (நியாயவிலைக்கடை)</label>
              <select value={crsVal} onChange={(e) => setCrsVal(e.target.value)}>
                <option value="">Select CRS Shop...</option>
                {shopIds.map((id) => (
                  <option key={id} value={String(id)}>
                    CRS {id} — {shops[id - 1]?.name ?? ''}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label className="form-label">Entry Date (நாள்)</label>
              <input type="date" value={date} max={todayIso()} onChange={(e) => setDate(e.target.value)} />
            </div>
            {crsVal && date ? (
              <div style={{ background: 'var(--bg)', borderRadius: 10, padding: '10px 14px' }}>
                <div style={{ fontSize: 10, color: 'var(--muted)', textTransform: 'uppercase', letterSpacing: '.05em' }}>Selected</div>
                <div style={{ fontWeight: 700, color: '#0369A1', fontSize: 13, marginTop: 2 }}>{dateLabel}</div>
              </div>
            ) : null}
          </div>
        </div>
      </div>

      {!crsVal || !date ? (
        <div style={{ textAlign: 'center', padding: '64px 24px', color: 'var(--muted)' }}>
          <div style={{ fontSize: 52, marginBottom: 14 }}>📋</div>
          <div style={{ fontWeight: 700, fontSize: 16, color: 'var(--text)', marginBottom: 6 }}>Select a CRS shop and date to begin</div>
          <div style={{ fontSize: 13 }}>The TNCSC daily sales form will appear automatically</div>
        </div>
      ) : (
        <div ref={gridRef}>
          {saved ? (
            <div style={{ display: 'flex', background: '#FEF3C7', border: '1px solid #F59E0B', borderRadius: 10, padding: '12px 16px', marginBottom: 14, alignItems: 'center', gap: 10 }}>
              <span style={{ fontSize: 18 }}>⚠</span>
              <div>
                <div style={{ fontWeight: 700, color: '#92400E', fontSize: 13 }}>Duplicate Entry</div>
                <div style={{ fontSize: 12, color: '#92400E' }}>An entry already exists for this shop &amp; date. Saving will overwrite it.</div>
              </div>
            </div>
          ) : null}
          {savedMsg ? (
            <div style={{ display: 'flex', background: '#DCFCE7', border: '1px solid #86EFAC', borderRadius: 10, padding: '12px 16px', marginBottom: 14, color: '#15803D', fontSize: 13, fontWeight: 600, alignItems: 'center', gap: 8 }}>
              ✓ Entry saved: <span>{savedMsg}</span>
            </div>
          ) : null}

          {remoteChanged ? (
            <div style={{ display: 'flex', flexWrap: 'wrap', background: '#FFFBEB', border: '1px solid #FDE68A', borderRadius: 10, padding: '10px 16px', marginBottom: 14, color: '#92400E', fontSize: 12.5, alignItems: 'center', gap: 10 }}>
              <span style={{ fontSize: 16 }}>⟳</span>
              <span style={{ flex: 1, minWidth: 220 }}>
                <strong>This day was just changed elsewhere</strong> — by another user, an approved clear, or a change to an earlier day. Your unsaved changes are still on screen and nothing has been saved over them.
              </span>
              <button
                className="btn btn-outline btn-sm"
                onClick={() => {
                  applyFill(formOf(entryStore[key], date));
                  setRemoteChanged(false);
                }}
              >
                Load the latest
              </button>
            </div>
          ) : null}

          {isProjectedSheet(saved) ? (
            <div style={{ display: 'flex', gap: 12, alignItems: 'flex-start', background: '#FFF7ED', border: '1px solid #FDBA74', borderRadius: 10, padding: '10px 16px', marginBottom: 14, color: '#9A3412', fontSize: 12 }}>
              <span style={{ fontSize: 18, lineHeight: 1.2 }}>📅</span>
              <div>
                <strong>The whole of {new Date(date + 'T00:00:00').toLocaleDateString('en-IN', { month: 'long', year: 'numeric' })}, not one day's trading.</strong> Monthly Entry
                wrote the month here on its last day so the DSS and the date-wise statements have a sheet to print. Correct the figures on the Monthly Entry
                page. Saving on this page converts it into a day sheet, and Monthly Entry will follow the day sheets from then on.
              </div>
            </div>
          ) : null}

          {isAdmin && !sheetProjected ? (
            <div style={{ display: 'flex', gap: 10, alignItems: 'flex-start', background: '#FAF5FF', border: '1px dashed #A78BFA', borderRadius: 10, padding: '10px 16px', marginBottom: 14, color: '#5B21B6', fontSize: 12 }}>
              <span style={{ fontSize: 16, lineHeight: 1.2 }}>🛡️</span>
              <div>
                <strong>Administrator correction</strong> — boxes with a dashed violet border are editable only by an administrator. A corrected
                Opening, Total or Closing is saved as the Opening that gives it (Sales stay as keyed), and every later day recalculates from it on save.
                Remittance rows can be corrected with ✎.
              </div>
            </div>
          ) : null}

          {beforeFirstDay ? (
            <div style={{ background: '#FEF2F2', border: '1px solid #FCA5A5', borderRadius: 10, padding: '10px 16px', marginBottom: 14, color: '#B91C1C', fontSize: 12 }}>
              <strong>Before this shop’s first day.</strong> CRS {crsVal} started its stock on {fmtDay(firstDay!)} with its Initial Opening Balance. Days before
              that can only be entered by an administrator.
            </div>
          ) : carryFrom === null && !isAdmin && !sheetProjected && !shopStarted ? (
            <div style={{ display: 'flex', gap: 12, alignItems: 'flex-start', background: '#F0FDF4', border: '2px solid #4ADE80', borderRadius: 10, padding: '11px 16px', marginBottom: 14, color: '#166534', fontSize: 12 }}>
              <span style={{ fontSize: 18, lineHeight: 1.2 }}>🔐</span>
              <div>
                <div style={{ fontWeight: 800, fontSize: 13 }}>Initial Opening Balance — One-time entry</div>
                <div style={{ marginTop: 4, color: '#B45309', fontWeight: 600 }}>
                  ⚠ Opening Balance can be entered only once. After saving, future Opening Balances will be automatically carried forward from the previous Closing Balance.
                </div>
              </div>
            </div>
          ) : carryFrom === null && !isAdmin && !sheetProjected ? (
            <div style={{ background: '#F1F5F9', border: '1px solid #CBD5E1', borderRadius: 10, padding: '10px 16px', marginBottom: 14, color: '#475569', fontSize: 12 }}>
              🔒 <strong>Opening Balance locked.</strong> This shop’s Initial Opening Balance was already entered
              {firstDay ? <> ({fmtDay(firstDay)})</> : null}; Openings now carry from the previous Closing. An administrator can correct it.
            </div>
          ) : carryFrom === null ? (
            <div style={{ background: '#F0FDF4', border: '1px solid #86EFAC', borderRadius: 10, padding: '10px 16px', marginBottom: 14, color: '#15803D', fontSize: 12 }}>
              No earlier sheet for this shop — enter the opening stock by hand.
            </div>
          ) : carryFrom.gap === 0 ? (
            <div style={{ background: '#EFF6FF', border: '1px solid #BFDBFE', borderRadius: 10, padding: '10px 16px', marginBottom: 14, color: '#0369A1', fontSize: 12 }}>
              Opening carried from the closing of <strong>{fmtDay(carryFrom.date)}</strong>.
            </div>
          ) : (
            <div style={{ background: carryFrom.gap >= GAP_WARN_DAYS ? '#FEF3C7' : '#EFF6FF', border: `1px solid ${carryFrom.gap >= GAP_WARN_DAYS ? '#F59E0B' : '#BFDBFE'}`, borderRadius: 10, padding: '10px 16px', marginBottom: 14, color: carryFrom.gap >= GAP_WARN_DAYS ? '#92400E' : '#0369A1', fontSize: 12 }}>
              Opening carried from the closing of <strong>{fmtDay(carryFrom.date)}</strong> — {carryFrom.gap} {carryFrom.gap === 1 ? 'day' : 'days'} with no sheet in between
              {carryFrom.moved.length ? (
                <>
                  , including <strong>{carryFrom.moved.map(fmtDay).join(', ')}</strong>, where stock moved without one. Those receipts and
                  adjustments are in the Opening below.
                </>
              ) : (
                '.'
              )}
            </div>
          )}

          <div style={{ background: 'linear-gradient(135deg,#0369A1,#0EA5E9)', borderRadius: '12px 12px 0 0', padding: '14px 20px', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <div>
              <div style={{ color: '#fff', fontWeight: 800, fontSize: 15 }}>CRS {crsVal} — {shops[Number(crsVal) - 1]?.name ?? ''}</div>
              <div style={{ color: 'rgba(255,255,255,.65)', fontSize: 11, marginTop: 2 }}>{dateLabel}</div>
            </div>
            <div style={{ textAlign: 'right' }}>
              <div style={{ color: 'rgba(255,255,255,.6)', fontSize: 10, textTransform: 'uppercase', letterSpacing: '.08em' }}>Grand Total</div>
              <div style={{ color: '#fff', fontWeight: 900, fontSize: 22 }}>{inr(grand)}</div>
            </div>
          </div>

          {inspParts.length ? (
            <div style={{ display: 'flex', margin: '0 0 2px', padding: '11px 16px', border: '1px solid #FDE047', background: '#FFFBEB', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
              <span style={{ fontSize: 18 }}>🔍</span>
              <div style={{ flex: 1, minWidth: 220 }}>
                <div style={{ fontWeight: 800, fontSize: 12, color: '#92400E' }}>Inspection adjustments applied to this date</div>
                <div style={{ fontSize: 11, color: '#A16207', marginTop: 3 }} dangerouslySetInnerHTML={{ __html: inspParts.join('') }} />
              </div>
              <div style={{ fontSize: 11, color: '#A16207', fontWeight: 600 }}>Total = Opening + Receipt + Excess − Shortage − Transfer</div>
            </div>
          ) : null}

          {hasGodown ? (
            <div style={{ display: 'flex', margin: '0 0 2px', padding: '11px 16px', border: '1px solid #BFDBFE', background: '#EFF6FF', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
              <span style={{ fontSize: 18 }}>📦</span>
              <div style={{ flex: 1, minWidth: 220 }}>
                <div style={{ fontWeight: 800, fontSize: 12, color: '#1E40AF' }}>Godown receipts applied to this date</div>
                <div style={{ fontSize: 11, color: '#1D4ED8', marginTop: 3 }}>
                  {godownParts.map((p) => (
                    <span key={p} style={{ display: 'inline-block', marginRight: 10 }}>{p}</span>
                  ))}
                </div>
              </div>
              <div style={{ fontSize: 11, color: '#1D4ED8', fontWeight: 600 }}>Change these on the Receipt page</div>
            </div>
          ) : null}

          {section('a', lists.a)}
          {section('b', lists.b)}

          <div className="card" style={{ borderRadius: '0 0 12px 12px', borderTop: 'none' }}>
            <div style={{ padding: '14px 20px', display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: 12 }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 20 }}>
                {[['Section A', totals.a.amt, '#0369A1'], ['Section B', totals.b.amt, '#C2410C'], ['Grand Total', grand, '#16A34A']].map(([label, val, col], i) => (
                  <div key={label as string} style={{ display: 'flex', alignItems: 'center', gap: 20 }}>
                    {i > 0 ? <div style={{ width: 1, height: 32, background: 'var(--border)' }} /> : null}
                    <div style={{ textAlign: 'center' }}>
                      <div style={{ fontSize: 10, color: 'var(--muted)', textTransform: 'uppercase', letterSpacing: '.05em' }}>{label as string}</div>
                      <div style={{ fontWeight: i === 2 ? 900 : 800, fontSize: i === 2 ? 18 : 16, color: col as string }}>{inr(val as number)}</div>
                    </div>
                  </div>
                ))}
              </div>

              {/* Rice sales — CRS 29 only, between the totals and Remittance.
                  Both boxes are required to complete the day; 0 is an answer. */}
              {riceShop ? (
                <div style={{ width: '100%', borderTop: '1px solid var(--border)', marginTop: 14, paddingTop: 14 }}>
                  <div style={{ fontSize: 10, fontWeight: 800, color: 'var(--muted)', textTransform: 'uppercase', letterSpacing: '.06em', marginBottom: 10 }}>
                    🌾 Rice Sales Details – CRS 29 Only <span style={{ color: '#DC2626' }}>*</span>
                    <span style={{ fontWeight: 400, fontSize: 9, color: 'var(--muted)', marginLeft: 6 }}>(required — kilos of rice issued today; enter 0 if none)</span>
                  </div>
                  <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(170px, 1fr))', gap: 14 }}>
                    {(
                      [
                        ['free', 'FREE RICE', 'Free Rice', riceFree, setRiceFree, riceFreeRef, riceCostRef],
                        ['cost', 'COST RICE', 'Cost Rice', riceCost, setRiceCost, riceCostRef, remitAmtRef],
                      ] as const
                    ).map(([f, label, name, val, set, ref, next]) => (
                      <div key={f}>
                        <label htmlFor={`de-rice-${f}`} style={{ display: 'block', fontSize: 11, fontWeight: 700, color: 'var(--text)', marginBottom: 5 }}>
                          {label} <span style={{ color: '#DC2626' }}>*</span>
                        </label>
                        <div style={{ position: 'relative' }}>
                          <input
                            id={`de-rice-${f}`}
                            ref={ref}
                            type="number"
                            min={0}
                            step={0.001}
                            inputMode="decimal"
                            enterKeyHint="next"
                            placeholder="0.000"
                            value={val}
                            onChange={(e) => {
                              set(e.target.value);
                              setRiceErr((p) => ({ ...p, [f]: undefined }));
                            }}
                            onKeyDown={(e) => {
                              if (e.key === 'Enter') {
                                e.preventDefault();
                                next.current?.focus();
                              }
                            }}
                            style={{ width: '100%', border: `2px solid ${riceErr[f] ? '#DC2626' : '#86EFAC'}`, borderRadius: 8, padding: '9px 42px 9px 12px', fontSize: 14, fontWeight: 700, color: '#15803D', background: '#F0FDF4', outline: 'none' }}
                          />
                          <span style={{ position: 'absolute', right: 12, top: 19, transform: 'translateY(-50%)', fontSize: 11, fontWeight: 800, color: '#15803D', pointerEvents: 'none' }}>KG</span>
                        </div>
                        {riceErr[f] ? (
                          <div style={{ fontSize: 10, marginTop: 3, color: '#DC2626', fontWeight: 600 }}>
                            {riceErr[f] === 'invalid' ? `${name} must be 0 or more.` : `Please enter ${name}.`}
                          </div>
                        ) : null}
                      </div>
                    ))}
                  </div>
                  {(() => {
                    // The C RICE sheet's RBA and BRA columns are the day's R.R.A
                    // and B.RICE sales, so show them beside the Free Rice being
                    // keyed — a pointer, not a rule: the figure keyed is the one
                    // that prints.
                    const riceSales = lists.a.filter((c) => c.id === 'BRA' || c.id === 'RRA').reduce((s, c) => s + derive('a', c).sales, 0);
                    const free = Number(riceFree);
                    const differs = riceFree.trim() !== '' && Number.isFinite(free) && Math.abs(free - riceSales) > 0.0005;
                    return (
                      <div style={{ fontSize: 10, marginTop: 6, color: differs ? '#B45309' : 'var(--muted)' }}>
                        B.RICE + R.R.A sales on this sheet: <strong>{riceSales.toFixed(3)} kg</strong>
                        {differs ? ' — not the same as the Free Rice entered' : ''}. On the C RICE statement Free Rice prints under FREE RICE (KG’S) TOTAL and Cost Rice under COST RICE BRA.
                      </div>
                    );
                  })()}
                </div>
              ) : null}

              {/* Remittance */}
              <div style={{ width: '100%', borderTop: '1px solid var(--border)', margin: '14px 0 10px', paddingTop: 14 }}>
                <div style={{ fontSize: 10, fontWeight: 800, color: 'var(--muted)', textTransform: 'uppercase', letterSpacing: '.06em', marginBottom: 10 }}>
                  🏭 Remittance Details <span style={{ color: '#DC2626' }}>*</span>
                  <span style={{ fontWeight: 400, fontSize: 9, color: 'var(--muted)', marginLeft: 6 }}>(required — deposit amount &amp; date; add more than one for the same day if the takings were banked in parts)</span>
                </div>
                {/* No account chooser for shop staff. Every deposit they key
                    goes to the Non-Cereal account; the Cereal A/C column on
                    Monthly Remittance carries the REASON for a second or later
                    deposit (Missed / Tea / Salt / C.Box), not a second account
                    to pay into, and offering the choice there put money in a
                    column that is not a money column. An administrator does
                    get the choice, for the Cereal deposits the office banks
                    against the same date. */}
                <div style={{ display: 'grid', gridTemplateColumns: isAdmin ? 'auto 1fr 1fr auto' : '1fr 1fr auto', gap: 14, alignItems: 'start' }}>
                  {isAdmin ? (
                    <div>
                      <label style={{ display: 'block', fontSize: 11, fontWeight: 700, color: 'var(--text)', marginBottom: 5 }}>Account</label>
                      <select
                        value={remitAcct}
                        onChange={(e) => setRemitAcct(e.target.value as RemitAcct)}
                        aria-label="Remittance account"
                        title="Administrator: which account this deposit goes into"
                        style={{ border: `2px solid ${ACCT[remitAcct].bd}`, borderRadius: 8, padding: '9px 10px', fontSize: 13, fontWeight: 700, color: ACCT[remitAcct].fg, background: ACCT[remitAcct].bg, outline: 'none' }}
                      >
                        <option value="nc">{REMIT_TYPE_LABEL.nc}</option>
                        <option value="ce">{REMIT_TYPE_LABEL.ce}</option>
                      </select>
                    </div>
                  ) : null}
                  <div>
                    <label style={{ display: 'block', fontSize: 11, fontWeight: 700, color: 'var(--text)', marginBottom: 5 }}>
                      Remittance Amount (₹) <span style={{ color: '#DC2626' }}>*</span>
                    </label>
                    <div style={{ position: 'relative' }}>
                      <span style={{ position: 'absolute', left: 10, top: 19, transform: 'translateY(-50%)', fontSize: 13, fontWeight: 700, color: ACCT.nc.fg }}>₹</span>
                      <input
                        ref={remitAmtRef}
                        type="number"
                        min={0}
                        step={0.01}
                        placeholder="0.00"
                        value={remitAmt}
                        onChange={(e) => {
                          setRemitAmt(e.target.value);
                          setRemitErr((p) => ({ ...p, amount: undefined }));
                        }}
                        onKeyDown={(e) => {
                          if (e.key === 'Enter') {
                            e.preventDefault();
                            addRemit();
                          }
                        }}
                        style={{ width: '100%', border: `2px solid ${remitErr.amount ? '#DC2626' : ACCT.nc.bd}`, borderRadius: 8, padding: '9px 12px 9px 26px', fontSize: 14, fontWeight: 700, color: ACCT.nc.fg, background: ACCT.nc.bg, outline: 'none' }}
                      />
                      {remitErr.amount ? <div style={{ fontSize: 10, marginTop: 3, color: '#DC2626', fontWeight: 600 }}>{remitErr.amount}</div> : null}
                      {(() => {
                        // Only the Non-Cereal side is weighed against the sales
                        // total — the free commodities carry no rate, so the
                        // sheet has nothing for a Cereal deposit to match.
                        const pend = parseFloat(remitAmt.trim());
                        const pending = remitAmt.trim() !== '' && !isNaN(pend) && pend > 0 ? pend : 0;
                        // Everything keyed here is Non-Cereal now; `ce` only
                        // carries deposits from sheets saved when the account
                        // could still be chosen.
                        const nc = remitNC + pending;
                        const ce = remitCE;
                        if (!nc && !ce) return null;
                        const ncRows = remits.filter((r) => r.account !== 'ce').length + (pending ? 1 : 0);
                        const many = ncRows > 1 ? ` (${ncRows} deposits)` : '';
                        const diff = nc - grand;
                        const st: React.CSSProperties = { fontSize: 10, marginTop: 3 };
                        return (
                          <>
                            {nc ? (
                              Math.abs(diff) < 0.001 ? (
                                <div style={{ ...st, color: '#16A34A' }}>✓ Non-Cereal matches sales total{many}</div>
                              ) : diff > 0 ? (
                                <div style={{ ...st, color: '#D97706' }}>▲ Non-Cereal +₹{diff.toFixed(2)} above sales total{many}</div>
                              ) : (
                                <div style={{ ...st, color: '#DC2626' }}>▼ Non-Cereal ₹{Math.abs(diff).toFixed(2)} below sales total{many}</div>
                              )
                            ) : null}
                            {ce ? <div style={{ ...st, color: ACCT.ce.fg }}>🌾 Cereal A/C ₹{ce.toFixed(2)} — free commodities, not weighed against the sales total</div> : null}
                          </>
                        );
                      })()}
                    </div>
                  </div>
                  <div>
                    <label style={{ display: 'block', fontSize: 11, fontWeight: 700, color: 'var(--text)', marginBottom: 5 }}>
                      Remittance Date 📅 <span style={{ color: '#DC2626' }}>*</span>
                    </label>
                    <input
                      type="date"
                      value={remitDate}
                      onChange={(e) => {
                        setRemitDate(e.target.value);
                        setRemitErr((p) => ({ ...p, date: undefined }));
                      }}
                      style={{ width: '100%', border: `2px solid ${remitErr.date ? '#DC2626' : '#BAE6FD'}`, borderRadius: 8, padding: '9px 12px', fontSize: 13, fontWeight: 600, color: '#0369A1', background: '#F0F9FF', outline: 'none' }}
                    />
                    {remitErr.date ? <div style={{ fontSize: 10, marginTop: 3, color: '#DC2626', fontWeight: 600 }}>{remitErr.date}</div> : null}
                  </div>
                  <div>
                    <label style={{ display: 'block', fontSize: 11, fontWeight: 700, color: 'transparent', marginBottom: 5 }}>.</label>
                    <button type="button" onClick={addRemit} title="Add this account, amount and date to the day's remittance list" style={{ background: 'linear-gradient(135deg,#047857,#10B981)', color: '#fff', border: 'none', padding: '10px 20px', borderRadius: 8, fontWeight: 700, fontSize: 13, cursor: 'pointer', whiteSpace: 'nowrap', boxShadow: '0 2px 8px rgba(16,185,129,.3)' }}>
                      ➕ Add
                    </button>
                  </div>
                </div>
                <div style={{ marginTop: 12 }}>
                  {!remits.length ? (
                    <div style={{ fontSize: 11, color: '#B45309', background: '#FFFBEB', border: '1px dashed #FDE047', borderRadius: 8, padding: '8px 12px' }}>
                      ⚠ No remittance added yet — enter the amount and date, then press <strong>Add</strong>. At least one deposit is required to complete the day.
                    </div>
                  ) : (
                    <div style={{ border: '1px solid #E2E8F0', borderRadius: 9, overflow: 'hidden' }}>
                      <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                        <thead>
                          <tr style={{ background: '#F8FAFC' }}>
                            {['#', 'Account', 'Amount', 'Deposit Date', ''].map((h, i) => (
                              <th key={i} style={{ padding: '6px 10px', fontSize: 9.5, fontWeight: 800, color: 'var(--muted)', textTransform: 'uppercase', letterSpacing: '.05em', borderBottom: '1px solid #E2E8F0', textAlign: i === 2 ? 'right' : i === 4 ? 'right' : 'center', width: i === 0 ? 34 : i === 4 ? 56 : undefined }}>{h}</th>
                            ))}
                          </tr>
                        </thead>
                        <tbody>
                          {remits.map((r, i) =>
                            remitEdit?.id === r.id ? (
                              <tr key={i} style={{ background: '#FAF5FF' }}>
                                <td style={{ padding: '6px 10px', fontSize: 11, color: 'var(--muted)', textAlign: 'center', borderBottom: '1px solid #F1F5F9' }}>{i + 1}</td>
                                <td style={{ padding: '4px 6px', textAlign: 'center', borderBottom: '1px solid #F1F5F9' }}>
                                  {/* Account and reason are one choice, because
                                      they are not independent: an additional
                                      deposit is Non-Cereal by rule, so picking
                                      a reason puts it there and picking an
                                      account clears the reason
                                      (applyRemitType). */}
                                  <select
                                    value={remitEdit.type}
                                    onChange={(e) => setRemitEdit({ ...remitEdit, type: e.target.value as RemitType })}
                                    aria-label="Account or reason"
                                    style={{ border: '1px dashed #A78BFA', borderRadius: 6, padding: '4px 6px', fontSize: 12, background: '#fff' }}
                                  >
                                    {(['nc', 'ce', ...REMIT_REASONS] as RemitType[]).map((x) => (
                                      <option key={x} value={x}>{REMIT_TYPE_LABEL[x]}</option>
                                    ))}
                                  </select>
                                </td>
                                <td style={{ padding: '4px 6px', borderBottom: '1px solid #F1F5F9' }}>
                                  <input
                                    type="number"
                                    min={0}
                                    step={0.01}
                                    aria-label="Amount"
                                    value={remitEdit.amount}
                                    onChange={(e) => setRemitEdit({ ...remitEdit, amount: e.target.value })}
                                    style={{ width: '100%', minWidth: 90, border: '1px dashed #A78BFA', borderRadius: 6, padding: '4px 6px', fontSize: 12, textAlign: 'right', fontWeight: 700 }}
                                  />
                                </td>
                                <td style={{ padding: '4px 6px', borderBottom: '1px solid #F1F5F9' }}>
                                  <input
                                    type="date"
                                    aria-label="Remittance date"
                                    value={remitEdit.date}
                                    onChange={(e) => setRemitEdit({ ...remitEdit, date: e.target.value })}
                                    style={{ border: '1px dashed #A78BFA', borderRadius: 6, padding: '4px 6px', fontSize: 12 }}
                                  />
                                </td>
                                <td style={{ padding: '4px 10px', textAlign: 'right', borderBottom: '1px solid #F1F5F9', whiteSpace: 'nowrap' }}>
                                  <button type="button" onClick={applyRemitEdit} title="Apply this correction — then save the day" style={{ background: '#EDE9FE', color: '#5B21B6', border: '1px solid #A78BFA', borderRadius: 6, padding: '3px 8px', fontSize: 11, fontWeight: 800, cursor: 'pointer', marginRight: 4 }}>✓</button>
                                  <button type="button" onClick={() => setRemitEdit(null)} title="Cancel" style={{ background: '#fff', color: '#475569', border: '1px solid #CBD5E1', borderRadius: 6, padding: '3px 8px', fontSize: 11, fontWeight: 700, cursor: 'pointer' }}>↺</button>
                                </td>
                              </tr>
                            ) : (
                            <tr key={i} style={{ background: i % 2 === 0 ? '#fff' : '#F8FAFC' }}>
                              <td style={{ padding: '6px 10px', fontSize: 11, color: 'var(--muted)', textAlign: 'center', borderBottom: '1px solid #F1F5F9' }}>{i + 1}</td>
                              <td style={{ padding: '6px 10px', textAlign: 'center', borderBottom: '1px solid #F1F5F9', whiteSpace: 'nowrap' }}>
                                {/* An additional deposit is Non-Cereal by rule, so it shows its
                                    reason rather than an account it does not really sit in. */}
                                {r.reason ? (
                                  <span style={{ display: 'inline-block', background: '#FFFBEB', border: '1px solid #FDE68A', color: '#92400E', fontSize: 10, fontWeight: 800, padding: '2px 8px', borderRadius: 5 }} title="Additional remittance against this sales date">
                                    {r.reason}
                                  </span>
                                ) : (
                                  <span style={{ display: 'inline-block', background: ACCT[r.account].bg, border: `1px solid ${ACCT[r.account].bd}`, color: ACCT[r.account].fg, fontSize: 10, fontWeight: 800, padding: '2px 8px', borderRadius: 5 }}>{ACCT[r.account].label}</span>
                                )}
                              </td>
                              <td style={{ padding: '6px 10px', fontSize: 13, fontWeight: 800, color: ACCT[r.account].fg, textAlign: 'right', borderBottom: '1px solid #F1F5F9', whiteSpace: 'nowrap' }}>{inr(r.amount)}</td>
                              <td style={{ padding: '6px 10px', fontSize: 12, fontWeight: 600, color: '#334155', textAlign: 'center', borderBottom: '1px solid #F1F5F9', whiteSpace: 'nowrap' }}>{r.date.split('-').reverse().join('/')}</td>
                              <td style={{ padding: '4px 10px', textAlign: 'right', borderBottom: '1px solid #F1F5F9', whiteSpace: 'nowrap' }}>
                                {isAdmin ? (
                                  <button
                                    type="button"
                                    onClick={() => setRemitEdit({ id: r.id, amount: String(r.amount), date: r.date, type: remitTypeOf(r) })}
                                    title="Administrator: correct this remittance's amount, date or account"
                                    style={{ background: '#FAF5FF', color: '#5B21B6', border: '1px dashed #A78BFA', borderRadius: 6, padding: '3px 8px', fontSize: 11, fontWeight: 800, cursor: 'pointer', marginRight: 4 }}
                                  >
                                    ✎
                                  </button>
                                ) : null}
                                {/* A deposit already in the database is an
                                    administrator's to remove; a shop user may
                                    still take back one they have added here
                                    and not saved (stockGuard rule 1b refuses
                                    the rest anyway). */}
                                {canRemoveRemit(isAdmin, savedRemits, r.id) ? (
                                  <button type="button" onClick={() => setRemits((list) => list.filter((_, j) => j !== i))} title="Remove this remittance" style={{ background: '#FEE2E2', color: '#B91C1C', border: '1px solid #FCA5A5', borderRadius: 6, padding: '3px 9px', fontSize: 11, fontWeight: 700, cursor: 'pointer' }}>✕</button>
                                ) : (
                                  <span title="Saved remittance — only an administrator can change or remove it" style={{ fontSize: 11, color: 'var(--muted)' }}>🔒</span>
                                )}
                              </td>
                            </tr>
                            ),
                          )}
                        </tbody>
                        <tfoot>
                          <tr style={{ background: '#F0F9FF' }}>
                            <td />
                            <td style={{ padding: '7px 10px', fontSize: 9.5, fontWeight: 800, color: 'var(--muted)', textTransform: 'uppercase', letterSpacing: '.05em', textAlign: 'center' }}>Day Total</td>
                            <td style={{ padding: '7px 10px', fontSize: 13, fontWeight: 900, color: '#0369A1', textAlign: 'right', whiteSpace: 'nowrap' }}>{inr(remitTotal)}</td>
                            <td colSpan={2} style={{ padding: '7px 10px', fontSize: 10, fontWeight: 700, color: 'var(--muted)' }}>
                              {remits.length} remittance{remits.length === 1 ? '' : 's'}
                              {remitNC ? <span style={{ color: ACCT.nc.fg, marginLeft: 8 }}>Non-Cereal {inr(remitNC)}</span> : null}
                              {remitCE ? <span style={{ color: ACCT.ce.fg, marginLeft: 8 }}>Cereal {inr(remitCE)}</span> : null}
                            </td>
                          </tr>
                        </tfoot>
                      </table>
                    </div>
                  )}
                </div>
              </div>

              {/* Actions */}
              <div className="de-actions" style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap', width: '100%' }}>
                {scRec ? (
                  <span style={{ background: scRec.date === date ? '#DCFCE7' : '#FEF3C7', border: `1px solid ${scRec.date === date ? '#86EFAC' : '#FDE047'}`, color: scRec.date === date ? '#15803D' : '#92400E', fontSize: 11, fontWeight: 700, padding: '5px 10px', borderRadius: 7 }}>
                    {scRec.date === date ? '🔒 THIS DAY is the Sales Close (last sales day)' : `🔒 Sales Close: ${scRec.date.split('-').reverse().join('/')}`}
                  </span>
                ) : null}
                <button className="btn btn-outline btn-sm" onClick={clearForm}>🗑 Clear</button>
                {/* Monthly on the left, Daily pushed to the right. The only
                    change is the order and which button carries the auto
                    margin that does the pushing — each keeps its own colour,
                    padding, title and handler. On a phone the two stack full
                    width, Daily on top (.de-close in responsive.css). */}
                <button className="de-close de-close-month" onClick={() => void markSalesClose()} title="Mark this date as the LAST SALES DAY of the month. Totals up to this date auto-fill Monthly Entry & Gunny Receipt." style={{ background: 'linear-gradient(135deg,#B45309,#F59E0B)', color: '#fff', border: 'none', padding: '10px 18px', borderRadius: 9, fontWeight: 700, fontSize: 13, cursor: 'pointer', boxShadow: '0 2px 10px rgba(245,158,11,.3)' }}>
                  🔒 மாத விற்பனை நிறைவு
                </button>
                <button className="de-close de-close-day" onClick={() => void save()} title="Save this day sheet. Requires at least one remittance." style={{ marginLeft: 'auto', background: 'linear-gradient(135deg,#0284C7,#0EA5E9)', color: '#fff', border: 'none', padding: '10px 22px', borderRadius: 9, fontWeight: 700, fontSize: 13, cursor: 'pointer', boxShadow: '0 2px 10px rgba(14,165,233,.3)' }}>
                  💾 தினசரி விற்பனை நிறைவு
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
      {inspOpen && crsId ? <InspectionModal crsId={crsId} date={date} onClose={() => setInspOpen(false)} /> : null}
      {clearOpen && clearScope ? (
        <ClearRequestDialog scope={clearScope} onClose={() => setClearOpen(false)} onApprovedClear={resetForm} admin={isAdmin} onEmptyForm={resetForm} />
      ) : null}
      {pendingRemit ? (
        <AdditionalRemitDialog
          amount={pendingRemit.amount}
          salesDate={date}
          remitDate={pendingRemit.date}
          onPick={commitAdditional}
          onClose={() => setPendingRemit(null)}
        />
      ) : null}

      {dssPay ? (
        <PaymentDialog
          order={dssPay.order}
          upi={dssPay.upi}
          onClose={() => setDssPay(null)}
          onSubmitted={(o) => setDssPay((p) => (p ? { ...p, order: o } : p))}
        />
      ) : null}
    </div>
  );
}
