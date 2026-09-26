/**
 * Who may change Opening, Receipt, Total and Closing — and what those four
 * are allowed to say.
 *
 * This is the server's rule for every /api/state write, and the same module
 * the two entry screens ask before deciding whether to render a box read-only.
 * One definition, two enforcers: disabling an input is manners, this is the
 * lock. It has no database or Next.js imports so it can be run directly
 * (tools/verify-stock-lock.mjs).
 *
 * THE FOUR RULES
 *
 *   1. SHOP STAFF TYPE AN OPENING ONCE, EVER. Opening is a carried balance —
 *      the previous day's or the previous month's closing. Re-keying it
 *      silently breaks the chain: the day before still closes at the old
 *      figure, so stock appears from nowhere or vanishes, and every statement
 *      from that point on is wrong with nothing on screen to show it.
 *
 *      A shop that has never started its stock chain (engine/stockInit.ts)
 *      may type its Initial Opening Balance. Once it has started — it holds
 *      stock data; Active/Inactive never resets that, an approved clear of all
 *      its stock does — every Opening a shop user saves must be the carried
 *      balance, or the figure already stored
 *      where nothing carries into it, and no shop user may key a day earlier
 *      than the shop's first day (that would re-carry the Initial Opening
 *      away). A row marked `openFixed` keeps its stored Opening; only an
 *      administrator sets or removes that mark, except the shop's own
 *      one-time Initial Opening.
 *
 *      An ADMINISTRATOR may correct any Opening. A correction is saved as a
 *      fixed Opening, and the chain carries on from it (stockChain.ts).
 *
 *   1b. A SAVED REMITTANCE IS NOT RE-KEYED BY SHOP STAFF. They add deposits
 *      and remove them as before; changing the amount, date, account or reason
 *      of one already saved is an administrator's correction.
 *
 *   2. RECEIPT IS NOT KEYABLE FROM THE ENTRY SCREENS (shop staff). The
 *      Receipt Register is the record of what the godown actually delivered,
 *      and receiptRollup.ts already fills the Receipt column from it. A second
 *      place to type the same figure is a second answer to the same question.
 *      A shop's Receipt must therefore equal the register's total for that
 *      shop-day (or shop-month); an administrator may key one directly.
 *
 *   3. TOTAL AND CLOSING ARE COMPUTED, FOR EVERYONE — administrators
 *      included. They are not opinions:
 *          total = open + receipt + excess − shortage − transfer
 *          close = total − sales − cs
 *      C.S (cumulative shortage) only exists on the monthly side; absent, it
 *      is zero, which makes one formula serve both.
 *
 *   4. A SHOP MAY ONLY CHANGE ITS OWN RECORDS — already enforced by
 *      clearGuard.ts, and not repeated here.
 *
 * ONLY CHANGED ROWS ARE JUDGED. A record that comes back byte-for-byte as it
 * was stored is passed regardless of what it says. Rules 1 and 2 are about
 * changes by definition, and rule 3 has to be: the imported workbook months
 * predate all of this, and a shop pressing Save on an untouched month must not
 * be told its own history is illegal. The rules bite the moment a figure moves.
 */
import { receiptQtyForDay, receiptQtyForMonth, type ReceiptRow } from '@/lib/engine/receiptRollup';
import { isProjectedSheet } from '@/lib/engine/monthProjection';
import { buildChainIndex, isOpenFixed, openingFor, type ChainIndex } from '@/lib/engine/stockChain';
import { firstStockDates, initialDate, isInitialized, readStockInit, STOCK_INIT_KEY, type StockInit } from '@/lib/engine/stockInit';
import { txnsOf } from '@/lib/engine/remittance';
import { gunnyRowFor, type GunnyRec, type SalesClose } from '@/app/(app)/monthly-entry/lib';

/** Kilos carry three decimals; anything under half a gram is float noise. */
export const TOLERANCE = 0.005;

export type StockViolationKind =
  | 'opening-locked'
  | 'before-initial-date'
  | 'remittance-locked'
  | 'receipt-not-keyable'
  | 'total-mismatch'
  | 'closing-mismatch'
  | 'gunny-locked';

export type StockViolation = {
  store: string;
  /** Store key: `<crs>_<date>` for a day, `<crs>_<month>_<year>` for a month. */
  key: string;
  crsId: number | null;
  section: 'a' | 'b';
  commodity: string;
  kind: StockViolationKind;
  /** One sentence naming the figure and what it should have been. */
  detail: string;
};

type Row = Record<string, unknown>;
const isObj = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v);
const num = (v: unknown): number => {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
};
const near = (a: number, b: number) => Math.abs(a - b) <= TOLERANCE;
const fmt = (n: number) => n.toFixed(3);

/** `<crs>_<YYYY-MM-DD>` — a day store key. */
const DAY_KEY = /^(\d+)_(\d{4}-\d{2}-\d{2})$/;
/** `<crs>_<month>_<year>` — a month store key. */
const MONTH_KEY = /^(\d+)_(\d{1,2})_(\d{4})$/;

/** total = open + receipt + excess − shortage − transfer */
export function expectedTotal(row: Row): number {
  return num(row.open) + num(row.receipt) + num(row.excess) - num(row.shortage) - num(row.transfer);
}

/** close = total − sales − cs. C.S is monthly-only; absent it is zero. */
export function expectedClose(row: Row): number {
  return num(row.total) - num(row.sales) - num(row.cs);
}

/**
 * Is Opening closed to this viewer's typing? The screens' half of rule 1.
 *
 * An administrator: never. Shop staff: once the shop has started its stock
 * chain (`started`), always — the one-time Initial Opening has been used.
 * Before that, the Initial Opening is theirs to type.
 */
export function openingLocked(isAdmin: boolean, started: boolean): boolean {
  return !isAdmin && started;
}

/** Receipt is never keyable on Daily or Monthly Entry by shop staff. */
export const receiptLocked = (isAdmin: boolean): boolean => !isAdmin;

/** The register's total per commodity for one shop-day. */
export function registerDay(store: ReceiptRow[] | undefined, crsId: number, dateIso: string): Record<string, number> {
  return receiptQtyForDay(store, crsId, dateIso);
}

/** The register's total per commodity across one shop-month. */
export function registerMonth(store: ReceiptRow[] | undefined, crsId: number, month: number, year: number): Record<string, number> {
  const out: Record<string, number> = {};
  for (const day of Object.values(receiptQtyForMonth(store, crsId, month, year))) {
    for (const [id, qty] of Object.entries(day)) out[id] = (out[id] ?? 0) + qty;
  }
  return out;
}

type Ctx = {
  store: string;
  key: string;
  crsId: number | null;
  isAdmin: boolean;
  /** Absent for stores whose Receipt is derived rather than keyed. */
  register: Record<string, number> | null;
  /** A projected sheet carries no C.S, so only its Total can be checked. */
  totalOnly: boolean;
  /** Opening and Receipt are only locked where they are actually keyed. */
  lockFields: boolean;
  /**
   * A day sheet's carried Opening for one commodity, from the data as it will
   * stand after this write — or null where nothing earlier carries into it.
   * For a manual month, the balance at its 1st. Null for the roll-up's output.
   */
  carried: ((sec: 'a' | 'b', id: string) => number | null) | null;
  /** The shop has started its stock chain — its one-time Initial Opening is used. */
  started: boolean;
  /** Rule 1 applies: a keyed day sheet or a manual month, not the roll-up's output or a projection. */
  openRule: boolean;
};

/** Judge one commodity row of one record. */
function checkRow(ctx: Ctx, sec: 'a' | 'b', id: string, before: unknown, after: unknown, out: StockViolation[]) {
  if (!isObj(after)) return;
  // Untouched history is not this rule's business — see the module comment.
  if (before !== undefined && JSON.stringify(before) === JSON.stringify(after)) return;

  const note = (kind: StockViolationKind, detail: string) =>
    out.push({ store: ctx.store, key: ctx.key, crsId: ctx.crsId, section: sec, commodity: id, kind, detail });

  if (ctx.openRule && !ctx.isAdmin) {
    // Rule 1. `carried` is the balance the chain carries into this row once the
    // write lands — the previous applicable Closing — or null at the start of
    // the chain. When an earlier day changes, every later Opening is rebuilt to
    // it (engine/rechain.ts), so moving a saved Opening TO it is not a re-key.
    const carry = ctx.carried ? ctx.carried(sec, id) : null;
    const wasFixed = isOpenFixed(before);
    const nowFixed = isOpenFixed(after);
    const wasOpen = isObj(before) ? num(before.open) : null;
    const nowOpen = num(after.open);

    if (wasFixed !== nowFixed) {
      // The one exception: a shop that has not started marks its own Initial
      // Opening fixed, at the start of its chain.
      const initialAnchor = !ctx.started && nowFixed && carry === null;
      if (!initialAnchor) {
        note('opening-locked', `Opening ${nowFixed ? 'is marked as a correction' : 'correction is removed'} by this save. Only an administrator can correct an Opening.`);
      }
    }

    // What a shop user may save as this Opening; null = anything (the Initial Opening).
    let allowed: number | null;
    if (wasFixed) allowed = wasOpen;
    else if (carry !== null && !nowFixed) allowed = carry;
    else if (!ctx.started) allowed = null;
    else allowed = wasOpen ?? 0;

    // Leaving an Opening exactly as stored is never a re-key, even where the
    // stored figure predates the chain being rebuilt.
    const unchanged = wasOpen !== null && near(wasOpen, nowOpen);
    if (allowed !== null && !near(nowOpen, allowed) && !unchanged) {
      note(
        'opening-locked',
        `Opening is set to ${fmt(nowOpen)} but must be ${fmt(allowed)}${carry !== null && !wasFixed ? " — the previous day's Closing carried forward" : ''}. The Opening Balance is entered only once, when the shop starts; after that only an administrator can correct it.`,
      );
    }
  }

  if (ctx.lockFields && !ctx.isAdmin) {
    if (ctx.register) {
      const wasReceipt = isObj(before) ? num(before.receipt) : 0;
      const nowReceipt = num(after.receipt);
      if (!near(wasReceipt, nowReceipt)) {
        const allowed = ctx.register[id] ?? 0;
        if (!near(nowReceipt, allowed)) {
          note(
            'receipt-not-keyable',
            `Receipt is ${fmt(nowReceipt)} but the Receipt Register holds ${fmt(allowed)}. Receipts are entered on the Receipt page, not here.`,
          );
        }
      }
    }
  }

  const wantTotal = expectedTotal(after);
  if (!near(num(after.total), wantTotal)) {
    note('total-mismatch', `Total is ${fmt(num(after.total))} but Opening + Receipt ± adjustments comes to ${fmt(wantTotal)}.`);
  }
  if (!ctx.totalOnly) {
    const wantClose = expectedClose(after);
    if (!near(num(after.close), wantClose)) {
      note('closing-mismatch', `Closing is ${fmt(num(after.close))} but Total − Sales comes to ${fmt(wantClose)}.`);
    }
  }
}

/**
 * Rule 1b. A deposit already saved on a day sheet keeps its amount, date,
 * account and reason when a shop user saves — and stays there: removing one is
 * an administrator's to do, or "delete it and add it again" would be a way
 * around the rule. ADDING a deposit is the existing workflow and passes, as
 * does removing one this screen has not saved yet (it is not in `prev`).
 * Compared by id through the same reader the screens use, so sheets saved
 * before deposits had ids compare too.
 */
function remittanceCheck(store: string, key: string, crsId: number, dateIso: string, prev: unknown, rec: unknown, out: StockViolation[]) {
  if (!isObj(prev) || !isObj(rec)) return;
  const now = new Map(txnsOf(rec, dateIso).map((t) => [t.id, t]));
  for (const was of txnsOf(prev, dateIso)) {
    const t = now.get(was.id);
    if (!t) {
      out.push({
        store, key, crsId, section: 'a', commodity: 'Remittance', kind: 'remittance-locked',
        detail: `A saved remittance of ₹${was.amount.toFixed(2)} dated ${was.date.split('-').reverse().join('-')} was removed. Only an administrator can remove a saved remittance.`,
      });
      continue;
    }
    const moved = !near(was.amount, t.amount) || was.date !== t.date || was.account !== t.account || (was.reason ?? '') !== (t.reason ?? '');
    if (moved) {
      out.push({
        store, key, crsId, section: 'a', commodity: 'Remittance', kind: 'remittance-locked',
        detail: `A saved remittance of ₹${was.amount.toFixed(2)} dated ${was.date.split('-').reverse().join('-')} was changed. Only an administrator can correct a saved remittance.`,
      });
    }
  }
}

/** Judge one record — a day sheet or a month block — section by section. */
function checkRecord(ctx: Ctx, before: unknown, after: unknown, out: StockViolation[]) {
  const b = isObj(before) ? before : {};
  for (const sec of ['a', 'b'] as const) {
    const ablk = isObj(after) ? after[sec] : undefined;
    if (!isObj(ablk)) continue;
    const bblk = isObj(b[sec]) ? (b[sec] as Record<string, unknown>) : {};
    for (const [id, row] of Object.entries(ablk)) checkRow(ctx, sec, id, bblk[id], row, out);
  }
}

/**
 * Every rule broken by one /api/state payload.
 *
 * `stored` is what the database currently holds, `incoming` what is being
 * written. The register compared against is the INCOMING receiptStore when the
 * payload carries one: saving a receipt and the day sheet that shows it is a
 * single POST, and judging the sheet against the register as it was a moment
 * ago would reject the very flow this rule exists to push people into.
 */
export function inspectStockWrite(
  stored: Record<string, unknown>,
  incoming: Record<string, unknown>,
  isAdmin: boolean,
): StockViolation[] {
  const out: StockViolation[] = [];
  const receipts = (incoming.receiptStore ?? stored.receiptStore) as ReceiptRow[] | undefined;

  // Has the shop started? The record when it exists (engine/stockInit.ts;
  // /api/state reads it alongside the stores). Before it exists at all, the
  // same rule it is kept by: a shop holding stock data has started, from its
  // earliest sheet that does.
  const initRow = stored[STOCK_INIT_KEY];
  const init: StockInit | null = initRow !== undefined ? readStockInit(initRow) : null;
  const firsts = init ? null : firstStockDates(stored.entryStore);
  const started = (crsId: number): boolean =>
    init
      ? isInitialized(init, crsId)
      : firsts!.has(crsId) || Object.keys(isObj(stored.meManualStore) ? stored.meManualStore : {}).some((k) => Number(k.split('_')[0]) === crsId);
  const firstDay = (crsId: number): string | null => (init ? initialDate(init, crsId) : firsts!.get(crsId) ?? null);

  // The stock chain as it will stand once this write lands, one index per shop,
  // built the first time a shop's carried Opening is asked for.
  const chains = new Map<number, ChainIndex>();
  const chainFor = (crsId: number): ChainIndex => {
    let ix = chains.get(crsId);
    if (!ix) {
      const entries = (isObj(incoming.entryStore) ? incoming.entryStore : stored.entryStore) as Parameters<typeof buildChainIndex>[0];
      const insp = (isObj(incoming.inspectionStore) ? incoming.inspectionStore : stored.inspectionStore) as Record<string, unknown> | undefined;
      ix = buildChainIndex(entries, insp, receipts, crsId);
      chains.set(crsId, ix);
    }
    return ix;
  };

  for (const store of ['entryStore', 'meManualStore', 'monthlyStore'] as const) {
    const after = incoming[store];
    if (!isObj(after)) continue;
    const before = isObj(stored[store]) ? (stored[store] as Record<string, unknown>) : {};

    for (const [key, rec] of Object.entries(after)) {
      const prev = before[key];
      if (prev !== undefined && JSON.stringify(prev) === JSON.stringify(rec)) continue;

      if (store === 'entryStore') {
        const m = DAY_KEY.exec(key);
        if (!m) continue; // not a day sheet — nothing here judges it
        const crsId = Number(m[1]);
        // A projected sheet is Monthly Entry's own output written out as a
        // day (monthProjection.ts). Its Opening and Receipt are the month's,
        // not something keyed here, and its Closing carries the month's C.S,
        // which a day sheet has no column for — so only its Total is checked.
        const projected = isProjectedSheet(rec);
        if (!isAdmin && !projected) {
          // A shop user keying a day before the shop's first day would carry
          // the chain into that day, and re-carry the Initial Opening away.
          const first = started(crsId) ? firstDay(crsId) : null;
          if (prev === undefined && first && m[2] < first) {
            out.push({
              store, key, crsId, section: 'a', commodity: '—', kind: 'before-initial-date',
              detail: `CRS ${crsId} started its stock on ${first.split('-').reverse().join('-')}. Days before that can only be entered by an administrator.`,
            });
          }
          remittanceCheck(store, key, crsId, m[2], prev, rec, out);
        }
        checkRecord(
          {
            store,
            key,
            crsId,
            isAdmin,
            register: projected ? null : registerDay(receipts, crsId, m[2]),
            totalOnly: projected,
            lockFields: !projected && !isProjectedSheet(prev),
            carried: projected ? null : (sec, id) => openingFor(chainFor(crsId), m[2], id, sec).value,
            started: started(crsId),
            openRule: !projected,
          },
          prev,
          rec,
          out,
        );
        continue;
      }

      const m = MONTH_KEY.exec(key);
      if (!m) continue;
      const crsId = Number(m[1]);
      // monthlyStore is published BY the roll-up from entryStore, meManualStore
      // and the register — all three already guarded. Locking Opening or
      // Receipt on its output as well would refuse the roll-up's own writes,
      // so only the arithmetic is checked there.
      const keyed = store === 'meManualStore';
      checkRecord(
        {
          store,
          key,
          crsId,
          isAdmin,
          register: keyed ? registerMonth(receipts, crsId, Number(m[2]), Number(m[3])) : null,
          totalOnly: false,
          lockFields: keyed,
          // A manual month opens with the chain's balance at its 1st — the
          // previous month's Closing — wherever one exists.
          carried: keyed ? (sec, id) => openingFor(chainFor(crsId), `${m[3]}-${String(m[2]).padStart(2, '0')}-01`, id, sec).value : null,
          started: started(crsId),
          openRule: keyed,
        },
        prev,
        rec,
        out,
      );
    }
  }

  inspectGunnyWrite(stored, incoming, isAdmin, out);
  return out;
}

/**
 * Rule 5 — Gunny Stock Management is the office's record (office, 2026-09-26).
 *
 * Opening, Receipt, Total and Closing are not shop staff's to key: Opening is
 * last month's Closing carried, Receipt is derived, Total and Closing are
 * arithmetic, and POLY / C.BOX Issues are the month's own sales of those bags.
 * The screen shows them read-only; this is the half that holds, because a
 * screen can be bypassed and /api/state cannot.
 *
 * A shop user's write must therefore agree with what the rule works out
 * (`gunnyRowFor`, the same function the screen draws from) — which is exactly
 * what the screen sends, since it stores those derived copies. 50 KG SS
 * Issues stay hand-keyed: that variety has no commodity row to take a sale
 * from. An administrator is not checked here at all.
 */
function inspectGunnyWrite(
  stored: Record<string, unknown>,
  incoming: Record<string, unknown>,
  isAdmin: boolean,
  out: StockViolation[],
): void {
  if (isAdmin) return;
  const after = incoming.meGunnyStore;
  if (!isObj(after)) return;
  const beforeAll = isObj(stored.meGunnyStore) ? (stored.meGunnyStore as Record<string, unknown>) : {};
  const monthlyAll = (isObj(incoming.monthlyStore) ? incoming.monthlyStore : stored.monthlyStore) as Record<string, unknown> | undefined;
  const salesCloseAll = (isObj(incoming.salesCloseStore) ? incoming.salesCloseStore : stored.salesCloseStore) as Record<string, unknown> | undefined;

  for (const [key, rec] of Object.entries(after)) {
    const prevRec = beforeAll[key];
    if (prevRec !== undefined && JSON.stringify(prevRec) === JSON.stringify(rec)) continue;
    const m = MONTH_KEY.exec(key);
    if (!m || !isObj(rec)) continue;
    const crsId = Number(m[1]);
    const month = Number(m[2]);
    const year = Number(m[3]);
    const prevKey = `${crsId}_${month === 1 ? 12 : month - 1}_${month === 1 ? year - 1 : year}`;

    // The figures the rule is worked out from: the month as it STANDS in the
    // database, never the record being written — otherwise a changed Opening
    // would be used to justify itself.
    const ownStored = isObj(beforeAll[key]) ? (beforeAll[key] as Record<string, GunnyRec>) : {};
    const prevStored = isObj(beforeAll[prevKey]) ? (beforeAll[prevKey] as Record<string, GunnyRec>) : {};
    const monthly = isObj(monthlyAll?.[key]) ? (monthlyAll![key] as Record<string, unknown>) : {};
    const bags: Record<string, number> = {};
    const sales: Record<string, number> = {};
    for (const sec of ['a', 'b'] as const) {
      const block = isObj(monthly[sec]) ? (monthly[sec] as Record<string, unknown>) : {};
      for (const [id, row] of Object.entries(block)) {
        if (!isObj(row)) continue;
        bags[id] = num(row.g_sales);
        sales[id] = num(row.sales);
      }
    }
    const salesClose = salesCloseAll?.[key] as SalesClose | undefined;

    for (const [itemId, row] of Object.entries(rec)) {
      if (!isObj(row)) continue;
      const wasRow = isObj(ownStored[itemId]) ? (ownStored[itemId] as Record<string, unknown>) : {};
      if (JSON.stringify(wasRow) === JSON.stringify(row)) continue;
      const want = gunnyRowFor(itemId, ownStored, prevStored, salesClose, bags, sales);
      const say = (field: string, got: number, expected: number) =>
        out.push({
          store: 'meGunnyStore',
          key,
          crsId,
          section: 'a',
          commodity: `Gunny ${itemId.toUpperCase()}`,
          kind: 'gunny-locked',
          detail: `${field} is the office's figure: ${fmt(expected)} — ${fmt(got)} was sent. An administrator can correct it.`,
        });

      // Opening: what carries in, or the figure already stored. Blank is fine
      // — the screen sends nothing until the row is touched.
      if (row.opening !== undefined && row.opening !== '' && !near(num(row.opening), want.opening)) say('Opening', num(row.opening), want.opening);
      if (row.receipt !== undefined && !near(num(row.receipt), want.rc.val)) say('Receipt', num(row.receipt), want.rc.val);
      if (row.receiptImported !== undefined && String(row.receiptImported) !== String(wasRow.receiptImported ?? '')) {
        say('Receipt (imported)', num(row.receiptImported), num(wasRow.receiptImported));
      }
      // POLY and C.BOX Issues follow the month's sales; 50 KG SS is keyed.
      if (want.issuesAuto && row.issues !== undefined && row.issues !== '' && !near(num(row.issues), Number(want.issues) || 0)) {
        say('Issues', num(row.issues), Number(want.issues) || 0);
      }
      // Total and Closing are arithmetic on the figures above, so they are
      // judged against what those figures give — including a hand-keyed
      // 50 KG SS Issues, which is this write's own.
      const issuesNow = want.issuesAuto ? Number(want.issues) || 0 : row.issues !== undefined && row.issues !== '' ? num(row.issues) : Number(want.issues) || 0;
      const openNow = row.opening !== undefined && row.opening !== '' ? num(row.opening) : want.opening;
      if (row.total !== undefined && !near(num(row.total), openNow + want.rc.val)) say('Total', num(row.total), openNow + want.rc.val);
      if (row.closing !== undefined && !near(num(row.closing), openNow + want.rc.val - issuesNow)) {
        say('Closing', num(row.closing), openNow + want.rc.val - issuesNow);
      }
    }
  }
}

/** One line per broken rule, for the error message and the audit row. */
export function describeStock(violations: StockViolation[]): string {
  return violations.map((v) => `${v.commodity} (CRS ${v.crsId ?? '?'} ${v.key.replace(/^\d+_/, '')}): ${v.detail}`).join(' ');
}
