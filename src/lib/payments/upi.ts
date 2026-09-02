/**
 * UPI collect-request links.
 *
 * There is no payment gateway here. The customer's own UPI app opens with the
 * office's handle and the exact amount pre-filled; money moves bank-to-bank
 * and this application never sees a confirmation. That is why every order
 * still has to be approved by a human against the bank feed — a generated link
 * proves an intention to pay, never a payment.
 *
 * Format is NPCI's UPI deep link:
 *   upi://pay?pa=<vpa>&pn=<payee>&am=<amount>&cu=INR&tn=<note>&tr=<ref>
 *
 * `am` must carry exactly two decimals, and `tr` is the order number so the
 * reference the customer's bank shows matches the row in the admin queue.
 */
import { rupees } from './pricing';

export type UpiRequest = {
  vpa: string;
  payeeName: string;
  amountPaise: number;
  /** Order number — travels as the transaction reference. */
  reference: string;
  note: string;
};

/** Strip the characters that would break the query string or a bank narration. */
const clean = (s: string, max: number) =>
  s.replace(/[^\w\s.@&/-]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, max);

export function upiUri(r: UpiRequest): string {
  const p = new URLSearchParams();
  p.set('pa', r.vpa.trim());
  p.set('pn', clean(r.payeeName, 50));
  p.set('am', rupees(r.amountPaise));
  p.set('cu', 'INR');
  p.set('tn', clean(r.note, 50));
  p.set('tr', clean(r.reference, 35));
  // URLSearchParams encodes spaces as '+', which some UPI apps show literally
  // in the payee name. '%20' is understood everywhere.
  return `upi://pay?${p.toString().replace(/\+/g, '%20')}`;
}

/** A VPA is name@handle. Loose on purpose — banks keep adding handles. */
export function looksLikeVpa(v: string): boolean {
  return /^[\w.\-_]{2,64}@[A-Za-z]{2,64}$/.test(v.trim());
}
