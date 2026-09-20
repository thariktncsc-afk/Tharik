/**
 * Remittance transactions — one sales date, many deposits.
 *
 * WHERE THEY LIVE. On the day sheet, in its `remits` array, which has always
 * been one-to-many: one Daily Sales entry, many deposits. Adding ids and a
 * reason to those rows gives the transaction structure without a second store
 * to keep in step — and that matters more than it sounds. Monthly Remittance
 * DERIVES its rows from these; it does not receive a copy. A derived table
 * cannot drift, cannot duplicate on a re-save, and cannot leave an orphan when
 * the day is cleared, because there is only ever one record of the deposit.
 * The sales date is the sheet's own date, so an additional deposit made a week
 * later still belongs to the day it was sales for.
 *
 * WHAT DOES NOT CHANGE. The sheet keeps `remitAmount` (the day's whole
 * deposit), `remitDate` (the earliest), `remitNonCereal` and `remitCereal`.
 * The statement engine reads those and prefers them over the Monthly
 * Remittance table (11-statement-core.js, MODULE 7), so statements keep
 * working untouched — which is why the 306 golden statements still pass.
 *
 * THE CEREAL COLUMN. On the Monthly Remittance screen an additional deposit
 * shows its reason where a normal row shows a Cereal amount. That is a display
 * rule for this one screen and it stops there: the reason is never written
 * into `remitCereal`, never summed, and never reaches a statement. The
 * statutory Cereal A/C total stays a total of money.
 */

/**
 * Which account a deposit went into.
 *
 * Daily Entry no longer offers the choice — every deposit keyed there is 'nc'.
 * The Cereal A/C column on Monthly Remittance is where an additional deposit's
 * REASON is shown, not a second account to pay into, and offering it as a
 * destination put money into a column that is not a money column. 'ce' remains
 * only so sheets saved before that still read back correctly.
 */
export type RemitAcct = 'nc' | 'ce';

/** Why a second or later deposit was made against the same sales date. */
export const REMIT_REASONS = ['Missed', 'Tea', 'Salt', 'C.Box'] as const;
export type RemitReason = (typeof REMIT_REASONS)[number];

export type RemitTxn = {
  /** Stable per transaction, so re-saving edits a row instead of adding one. */
  id: string;
  amount: number;
  /** When the money reached the bank. */
  date: string;
  account: RemitAcct;
  /** Set only on the second and later deposits for a sales date. */
  reason?: RemitReason;
  createdBy?: string;
  createdAt?: string;
};

/** A transaction with the sales date it belongs to, for the monthly view. */
export type RemitRow = RemitTxn & { salesDate: string; additional: boolean };

export const isReason = (v: unknown): v is RemitReason => REMIT_REASONS.includes(v as RemitReason);

/**
 * Ids only have to be unique within one day sheet, and they must survive a
 * reload, so they are generated once when the deposit is added.
 */
export function newRemitId(): string {
  return `rm_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
}

/**
 * Just the deposit fields. Optional and unknown-typed so a plain DayEntry —
 * which has none of them — is still an acceptable sheet to read.
 */
export type SheetLike = { remits?: unknown; remitAmount?: unknown; remitDate?: unknown; [k: string]: unknown };

/**
 * The deposits recorded on one day sheet, oldest first.
 *
 * Sheets saved before this existed carry either a plain `remits` array with no
 * ids, or only the single `remitAmount`/`remitDate` pair. Both are read as one
 * transaction each so nothing already keyed disappears from the month; the ids
 * are derived from the position so they stay stable across reloads.
 */
export function txnsOf(sheet: SheetLike | undefined, salesDate: string): RemitRow[] {
  if (!sheet) return [];
  const out: RemitRow[] = [];

  if (Array.isArray(sheet.remits) && sheet.remits.length) {
    sheet.remits.forEach((raw, i) => {
      const r = (raw ?? {}) as Partial<RemitTxn>;
      const amount = Number(r.amount) || 0;
      if (!amount && !r.date) return;
      out.push({
        id: String(r.id ?? `${salesDate}#${i}`),
        amount,
        date: String(r.date ?? salesDate),
        account: r.account === 'ce' ? 'ce' : 'nc',
        reason: isReason(r.reason) ? r.reason : undefined,
        createdBy: r.createdBy,
        createdAt: r.createdAt,
        salesDate,
        // The first deposit for the date is the normal one, whatever it says.
        additional: i > 0,
      });
    });
    return out;
  }

  const legacy = Number(sheet.remitAmount) || 0;
  if (legacy) {
    out.push({
      id: `${salesDate}#0`,
      amount: legacy,
      date: String(sheet.remitDate || salesDate),
      account: 'nc',
      salesDate,
      additional: false,
    });
  }
  return out;
}

const pad2 = (n: number) => String(n).padStart(2, '0');

/**
 * Every deposit recorded on the month's day sheets, in sales-date order and,
 * within a date, in the order they were added. This is what the Monthly
 * Remittance table renders.
 */
export function monthTxns(
  entryStore: Record<string, SheetLike>,
  crsId: number,
  month: number,
  year: number,
): RemitRow[] {
  const days = new Date(year, month, 0).getDate();
  const out: RemitRow[] = [];
  for (let d = 1; d <= days; d++) {
    const ds = `${year}-${pad2(month)}-${pad2(d)}`;
    out.push(...txnsOf(entryStore[`${crsId}_${ds}`], ds));
  }
  return out;
}

/** Non-Cereal and Cereal money for one row — a reason is never money. */
export function amounts(t: RemitRow): { nc: number; ce: number } {
  if (t.account === 'ce' && !t.reason) return { nc: 0, ce: t.amount };
  // An additional deposit always sits in Non-Cereal; its reason takes the
  // place of the Cereal figure on screen, and carries no value.
  return { nc: t.amount, ce: 0 };
}

/**
 * What a deposit IS, as the one choice an administrator makes: the account it
 * went into, or — for an additional deposit against the same sales date — the
 * reason it was banked separately.
 *
 * They are one choice because they are not independent: an additional deposit
 * sits in Non-Cereal by rule, so "Cereal A/C with a reason" is not a thing
 * that exists. Keeping the two in one control is what stops a correction
 * producing it. The classification rules themselves are unchanged — this only
 * names them.
 */
export type RemitType = 'nc' | 'ce' | RemitReason;

export const REMIT_TYPE_LABEL: Record<RemitType, string> = {
  nc: 'Non-Cereal A/C',
  ce: 'Cereal A/C',
  Missed: 'Missed',
  Tea: 'Tea',
  Salt: 'Salt',
  'C.Box': 'C.Box',
};

/** The type a stored deposit reads as — a reason, else its account. */
export function remitTypeOf(t: { account?: unknown; reason?: unknown }): RemitType {
  if (isReason(t.reason)) return t.reason;
  return t.account === 'ce' ? 'ce' : 'nc';
}

/**
 * One deposit set to a type, with account and reason kept in step: a reason
 * always lands in Non-Cereal, and an account always clears the reason. The
 * `reason` key is REMOVED rather than set to undefined, so a corrected row
 * compares equal to a plain one (stockGuard and the stores compare by JSON).
 */
export function applyRemitType<T extends { account: RemitAcct; reason?: RemitReason }>(txn: T, type: RemitType): T {
  const next = { ...txn };
  if (isReason(type)) {
    next.account = 'nc';
    next.reason = type;
    return next;
  }
  next.account = type;
  delete next.reason;
  return next;
}

/**
 * The deposits a shop user may still remove: the ones this screen has added
 * and not saved yet. A deposit already in the database is an administrator's
 * to remove — otherwise "delete and add it again" is a way around the rule
 * that a saved remittance keeps its amount, date and account (stockGuard rule
 * 1b), and the same refusal would arrive from the server anyway.
 */
export function canRemoveRemit(isAdmin: boolean, savedIds: ReadonlySet<string>, id: string): boolean {
  return isAdmin || !savedIds.has(id);
}

/**
 * A stored transaction, from the row the screens read — the fields that
 * belong on the sheet and nothing else (`salesDate` and `additional` are
 * worked out on the way out, not kept). Writing a sheet back through this is
 * what lets a screen edit a deposit without inventing a second record of it.
 */
export function toTxn(r: RemitRow): RemitTxn {
  const t: RemitTxn = { id: r.id, amount: r.amount, date: r.date, account: r.account };
  if (r.reason) t.reason = r.reason;
  if (r.createdBy) t.createdBy = r.createdBy;
  if (r.createdAt) t.createdAt = r.createdAt;
  return t;
}

/** The ids of the deposits stored on a sheet — what `canRemoveRemit` locks. */
export function savedRemitIds(sheet: SheetLike | undefined, salesDate: string): Set<string> {
  return new Set(txnsOf(sheet, salesDate).map((t) => t.id));
}

/** What the day sheet stores alongside the transactions, kept consistent. */
export function sheetTotals(list: RemitTxn[]): {
  remitAmount: number;
  remitDate: string;
  remitNonCereal: number;
  remitCereal: number;
} {
  const money = (t: RemitTxn) => Number(t.amount) || 0;
  return {
    remitAmount: list.reduce((s, t) => s + money(t), 0),
    // Cereal only counts as Cereal when it is a plain deposit; an additional
    // one is Non-Cereal by rule, whatever account button was pressed.
    remitNonCereal: list.reduce((s, t) => s + (t.account === 'ce' && !t.reason ? 0 : money(t)), 0),
    remitCereal: list.reduce((s, t) => s + (t.account === 'ce' && !t.reason ? money(t) : 0), 0),
    remitDate: list.map((t) => t.date).filter(Boolean).sort()[0] ?? '',
  };
}
