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

/** Gunny Stock Management's own Save — the month's gunny rows, for that month. */
export function gunnySaved(crsId: number | string, month: number, year: number): SaveSuccessRequest {
  return {
    title: 'Gunny Stock Saved Successfully',
    detail: `Gunny Stock for ${monthLabel(month, year)} has been saved successfully.`,
    key: `gunny:${crsId}:${month}:${year}`,
  };
}

/** Monthly Remittance's own Save — the month's hand-keyed remittance rows. */
export function remittanceMonthSaved(crsId: number | string, month: number, year: number): SaveSuccessRequest {
  return {
    title: 'Remittance Saved Successfully',
    detail: `Remittance for ${monthLabel(month, year)} has been saved successfully.`,
    key: `remit-month:${crsId}:${month}:${year}`,
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
/** An administrator moved a saved receipt to another date (engine/receiptDate.ts). */
export function receiptDateChanged(receiptId: number, receiptNo: string, from: string, to: string): SaveSuccessRequest {
  return {
    title: 'Receipt Saved Successfully',
    detail: `Receipt ${receiptNo} moved from ${fmtSavedDate(from)} to ${fmtSavedDate(to)} and saved.`,
    key: `receipt-date:${receiptId}:${to}`,
  };
}

export function receiptSaved(receiptId: number, date: string): SaveSuccessRequest {
  return {
    title: 'Receipt Saved Successfully',
    detail: `Receipt for ${fmtSavedDate(date)} has been saved successfully.`,
    key: `receipt:${receiptId}`,
  };
}

// ── Payment Management (office, 2026-10-16) ─────────────────────────────────
// Amounts arrive already worded ('₹350.00'), so this file needs no money
// helper and stays loadable by the verify tools as it is.

/** An obligation entered for a shop and month, or its amount / reference changed. */
export function pmObligationSaved(id: string, crsId: number | string, what: string, month: number, year: number, edited = false, stamp = ''): SaveSuccessRequest {
  return {
    title: edited ? 'Payment Record Updated' : 'Payment Record Saved',
    detail: `CRS ${crsId} — ${what}, ${monthLabel(month, year)} has been ${edited ? 'updated' : 'saved'}.`,
    // `stamp` (the record's updatedAt) makes a second, different edit its own tick.
    key: `pm-ob:${id}:${edited ? `edit:${stamp}` : 'new'}`,
  };
}

/** A payment recorded, corrected or voided on an obligation. */
export function pmPaymentSaved(paymentId: string, amount: string, crsId: number | string, what: string, month: number, year: number, kind: 'recorded' | 'corrected' | 'voided', stamp = ''): SaveSuccessRequest {
  const title = kind === 'recorded' ? 'Payment Recorded' : kind === 'corrected' ? 'Payment Corrected' : 'Payment Voided';
  return {
    title,
    detail: `${amount} for CRS ${crsId} — ${what}, ${monthLabel(month, year)} has been ${kind}.`,
    key: `pm-pay:${paymentId}:${kind}:${stamp}`,
  };
}

/** One reminder sent to a shop's own staff. */
export function pmReminderSent(reminderId: string, crsId: number | string, recipients: number): SaveSuccessRequest {
  return {
    title: 'Reminder Sent',
    detail: `The payment reminder has been sent to CRS ${crsId} (${recipients} ${recipients === 1 ? 'person' : 'people'}).`,
    key: `pm-remind:${reminderId}`,
  };
}

/** An obligation removed while it had no payments and no reminders. */
export function pmObligationDeleted(id: string, crsId: number | string, what: string, month: number, year: number): SaveSuccessRequest {
  return {
    title: 'Payment Record Deleted',
    detail: `CRS ${crsId} — ${what}, ${monthLabel(month, year)} has been deleted.`,
    key: `pm-ob-del:${id}`,
  };
}

/** The office UPI ID and payee name (the same ones paid downloads use). */
export function pmUpiSaved(vpa: string, payeeName: string): SaveSuccessRequest {
  return {
    title: 'UPI Details Saved',
    detail: `UPI ID ${vpa} has been saved.`,
    key: `pm-upi:${vpa}:${payeeName}`,
  };
}

/** The official QR or a reminder sound uploaded, chosen or removed. `ref` names the file or asset. */
export function pmMediaSaved(kind: 'qr' | 'qr-removed' | 'sound' | 'sound-active' | 'sound-beep' | 'sound-removed', ref: string): SaveSuccessRequest {
  const words: Record<typeof kind, [string, string]> = {
    qr: ['QR Code Saved', 'The official UPI QR code has been saved.'],
    'qr-removed': ['QR Code Removed', 'The official UPI QR code has been removed.'],
    sound: ['Reminder Sound Saved', `${ref} has been uploaded.`],
    'sound-active': ['Reminder Sound Saved', `${ref} is now the reminder sound.`],
    'sound-beep': ['Reminder Sound Saved', 'Shops will hear the plain beep.'],
    'sound-removed': ['Reminder Sound Removed', `${ref} has been removed.`],
  };
  const [title, detail] = words[kind];
  return { title, detail, key: `pm-media:${kind}:${ref}` };
}

/**
 * Is this the same save again — a double-tapped button, or a second press
 * while the first was still in flight? Anything else (another date, another
 * shop, the same day saved again later) is a new confirmation.
 */
export function isRepeat(last: { key: string; at: number } | null, key: string, now: number): boolean {
  return !!last && last.key === key && now - last.at < HOLD_MS + LEAVE_MS + REPEAT_MS;
}
