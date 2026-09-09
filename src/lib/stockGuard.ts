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
 *   1. OPENING LOCKS ONCE SAVED (shop staff). Opening is a carried balance —
 *      the previous day's or the previous month's closing. Re-keying it after
 *      the fact silently breaks the chain: the day before still closes at the
 *      old figure, so stock appears from nowhere or vanishes, and every
 *      statement from that point on is wrong with nothing on screen to show
 *      it. An administrator may still correct one.
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

/** Kilos carry three decimals; anything under half a gram is float noise. */
export const TOLERANCE = 0.005;

export type StockViolationKind = 'opening-locked' | 'receipt-not-keyable' | 'total-mismatch' | 'closing-mismatch';

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
 * Is Opening locked for this viewer? True once a figure has been saved.
 *
 * A saved sheet writes a row for every commodity, so a stored zero is "not
 * keyed yet", not "keyed as nothing" — locking on zero would strand a shop
 * that saved before it knew its opening. The lock closes on the first real
 * figure, which is what "once the user enters Opening and saves" means.
 */
export function openingLocked(isAdmin: boolean, storedRow: unknown): boolean {
  if (isAdmin) return false;
  return isObj(storedRow) && num(storedRow.open) !== 0;
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
};

/** Judge one commodity row of one record. */
function checkRow(ctx: Ctx, sec: 'a' | 'b', id: string, before: unknown, after: unknown, out: StockViolation[]) {
  if (!isObj(after)) return;
  // Untouched history is not this rule's business — see the module comment.
  if (before !== undefined && JSON.stringify(before) === JSON.stringify(after)) return;

  const note = (kind: StockViolationKind, detail: string) =>
    out.push({ store: ctx.store, key: ctx.key, crsId: ctx.crsId, section: sec, commodity: id, kind, detail });

  if (ctx.lockFields && !ctx.isAdmin) {
    if (openingLocked(false, before) && !near(num((before as Row).open), num(after.open))) {
      note(
        'opening-locked',
        `Opening is ${fmt(num((before as Row).open))} and was already saved; this save sets it to ${fmt(num(after.open))}. Only an administrator can change a saved Opening.`,
      );
    }
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
        checkRecord(
          {
            store,
            key,
            crsId,
            isAdmin,
            register: projected ? null : registerDay(receipts, crsId, m[2]),
            totalOnly: projected,
            lockFields: !projected && !isProjectedSheet(prev),
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
        },
        prev,
        rec,
        out,
      );
    }
  }
  return out;
}

/** One line per broken rule, for the error message and the audit row. */
export function describeStock(violations: StockViolation[]): string {
  return violations.map((v) => `${v.commodity} (CRS ${v.crsId ?? '?'} ${v.key.replace(/^\d+_/, '')}): ${v.detail}`).join(' ');
}
