/**
 * What the save-success tick says, and when a second press is the same save.
 *
 * The popup itself is src/components/SaveSuccess.tsx; the wording and the
 * duplicate rule live here so they can be checked without a browser
 * (tools/verify-save-success.mjs).
 *
 * One request shape for all three saves — Daily Sales, Monthly Sales and a
 * Receipt — so there is one popup to maintain, not three.
 */

export type SaveSuccessRequest = {
  /** Headline, e.g. 'Daily Sales Saved Successfully'. */
  title: string;
  /** The line below it, naming the exact date the data belongs to. */
  detail: string;
  /** Identifies the save; a repeat of it while it shows is ignored. */
  key: string;
};

/** How long the popup holds, and the fade that follows (ms). */
export const HOLD_MS = 2600;
export const LEAVE_MS = 260;
/** A repeat of the same save within this window after it left is still a double press. */
export const REPEAT_MS = 1200;

const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];

/** `2026-09-16` → `16-09-2026`, the form the office writes dates in. */
export function fmtSavedDate(iso: string): string {
  const [y, m, d] = String(iso ?? '').split('-');
  return y && m && d ? `${d}-${m}-${y}` : String(iso ?? '');
}

/** `(9, 2026)` → `September 2026`, the month a month-close belongs to. */
export function monthLabel(month: number, year: number): string {
  return `${MONTHS[month - 1] ?? ''} ${year}`.trim();
}

/** A day sheet saved on Daily Entry. */
export function dailySaved(crsId: number | string, date: string): SaveSuccessRequest {
  return {
    title: 'Daily Sales Saved Successfully',
    detail: `Daily Sales for ${fmtSavedDate(date)} has been saved successfully.`,
    key: `daily:${crsId}:${date}`,
  };
}

/** A month closed — from Monthly Entry, or the month-close beside Daily Sales. */
export function monthlySaved(crsId: number | string, month: number, year: number): SaveSuccessRequest {
  return {
    title: 'Monthly Sales Saved Successfully',
    detail: `Monthly Sales for ${monthLabel(month, year)} has been saved successfully.`,
    key: `monthly:${crsId}:${month}:${year}`,
  };
}

/** The month's card counts, saved for that month — what a month-close checks. */
export function cardDetailsSaved(crsId: number | string, month: number, year: number): SaveSuccessRequest {
  return {
    title: 'Card Details Saved Successfully',
    detail: `Card Details for ${monthLabel(month, year)} have been saved successfully.`,
    key: `cards:${crsId}:${month}:${year}`,
  };
}

/** The month's allotment quantities, saved for that month. */
export function allotmentSaved(crsId: number | string, month: number, year: number): SaveSuccessRequest {
  return {
    title: 'Allotment Saved Successfully',
    detail: `Allotment for ${monthLabel(month, year)} has been saved successfully.`,
    key: `allot:${crsId}:${month}:${year}`,
  };
}

/** An administrator's remittance correction, written straight to the day sheet. */
export function remittanceSaved(crsId: number | string, salesDate: string, ref = ''): SaveSuccessRequest {
  return {
    title: 'Remittance Saved Successfully',
    detail: `Remittance for ${fmtSavedDate(salesDate)} has been saved successfully.`,
    // `ref` is the deposit the correction touched, so two corrections to the
    // same date in quick succession each get their own tick, while one of them
    // pressed twice still gets only one.
    key: `remit:${crsId}:${salesDate}:${ref}`,
  };
}

/** A receipt written to the Receipt Register. */
export function receiptSaved(receiptId: number, date: string): SaveSuccessRequest {
  return {
    title: 'Receipt Saved Successfully',
    detail: `Receipt for ${fmtSavedDate(date)} has been saved successfully.`,
    key: `receipt:${receiptId}`,
  };
}

/**
 * Is this the same save again — a double-tapped button, or a second press
 * while the first was still in flight? Anything else (another date, another
 * shop, the same day saved again later) is a new confirmation.
 */
export function isRepeat(last: { key: string; at: number } | null, key: string, now: number): boolean {
  return !!last && last.key === key && now - last.at < HOLD_MS + LEAVE_MS + REPEAT_MS;
}
