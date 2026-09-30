/**
 * The month's reconciliation, worded for people (office, 2026-09-30).
 *
 * The figures come from the statement engine's `stmtReconcile`
 * (src/legacy/44-remit-total.js) — the same calculation CRS Page 2, Cost Com
 * and Sale Tax print, so the popup and the paper cannot disagree:
 *
 *   Expected = POS sales + TEA / SALT + Police + C.Box / Poly
 *   Excess   = actual remittance − Expected   (negative = short; never hidden)
 *
 * Here: the popup's message, and WHY it is short, worked out from that
 * shop-month's own figures — a component the shortfall equals, the days
 * banked below their sales, or no remittance at all. Pure, so it is checked
 * without a browser (tools/verify-reconcile.mjs).
 */

export type ReconcileItem = { id: string; label: string; amount: number };
export type ReconcileDay = { date: string; sales: number; remit: number };
export type Reconcile = {
  crsId: number;
  month: number;
  year: number;
  pos: number;
  manual: number;
  police: number;
  pack: number;
  /** Where the C.Box / Poly amount came from: sold on the grid, the remittance's Poly Gunny & C.Box row, or neither. */
  packSource: 'grid' | 'remittance' | 'none';
  packGrid: number;
  packRemit: number;
  posItems: ReconcileItem[];
  manualItems: ReconcileItem[];
  expected: number;
  remit: number;
  excess: number;
  days: ReconcileDay[];
};

export const inr = (n: number) => `${n < 0 ? '-' : ''}₹${Math.abs(n).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const dmy = (iso: string) => iso.split('-').reverse().join('-');
const near = (a: number, b: number) => Math.abs(a - b) < 0.5;
const PACK_LABEL: Record<Reconcile['packSource'], string> = {
  grid: 'Empty Card+Box / Polythene Bag sold on the sales grid',
  remittance: 'the "Poly Gunny & C.Box" row on Monthly Remittance',
  none: 'none keyed',
};

/** Why this shop-month is short — only what its own figures show. Empty when it is not short. */
export function reconcileReasons(r: Reconcile): string[] {
  if (!(r.excess < 0)) return [];
  const short = -r.excess;
  const out: string[] = [];
  if (r.remit === 0) out.push('No remittance is saved for this month — nothing has been banked against the sales.');

  // A component (or two) the shortfall is exactly — the likeliest thing not banked.
  const parts = [
    { label: `Police sales (${inr(r.police)})`, amount: r.police, what: 'the police ration money' },
    { label: `C.Box / Poly amount (${inr(r.pack)})`, amount: r.pack, what: 'the C.Box / Poly money' },
    { label: `TEA / SALT sales keyed by hand (${inr(r.manual)})`, amount: r.manual, what: 'the tea / salt money' },
    ...r.manualItems.map((i) => ({ label: `${i.label} sales (${inr(i.amount)})`, amount: i.amount, what: `the ${i.label} money` })),
  ].filter((p) => p.amount > 0);
  const one = parts.find((p) => near(p.amount, short));
  if (one) {
    out.push(`The shortfall ${inr(short)} is exactly the ${one.label} — ${one.what} does not appear in the remittance.`);
  } else {
    let pair: [typeof parts[number], typeof parts[number]] | null = null;
    for (let i = 0; i < parts.length && !pair; i++) for (let j = i + 1; j < parts.length && !pair; j++) if (near(parts[i].amount + parts[j].amount, short)) pair = [parts[i], parts[j]];
    if (pair) out.push(`The shortfall ${inr(short)} is exactly the ${pair[0].label} + ${pair[1].label} — that money does not appear in the remittance.`);
  }

  // Days banked below what they sold — only for a month keyed day by day.
  const sold = r.days.filter((d) => d.sales > 0);
  if (sold.length >= 2) {
    const low = r.days.filter((d) => d.sales - d.remit > 0.005).sort((a, b) => b.sales - b.remit - (a.sales - a.remit));
    if (low.length) {
      const shown = low.slice(0, 5).map((d) => `${dmy(d.date)} sold ${inr(d.sales)}, banked ${inr(d.remit)}`).join('; ');
      out.push(`Banked less than sold on ${low.length} day${low.length === 1 ? '' : 's'}: ${shown}${low.length > 5 ? '; …' : ''}.`);
    }
  }
  if (!out.length || (out.length === 1 && r.remit === 0 && r.expected > 0 && !one)) {
    out.push(`The remittance (${inr(r.remit)}) is ${inr(short)} less than POS + TEA/SALT + Police + C.Box/Poly (${inr(r.expected)}). Check the deposits keyed for the month against the sales.`);
  }
  return out;
}

/** The popup's text: the three figures, the breakdown, the reasons. */
export function reconcileMessage(r: Reconcile): string {
  const tea = r.manualItems.length ? ` (${r.manualItems.map((i) => `${i.label} ${inr(i.amount)}`).join(', ')})` : '';
  return [
    `Statement Amount: ${inr(r.expected)}`,
    `Actual Remittance: ${inr(r.remit)}`,
    `Difference: ${inr(r.excess)}`,
    '',
    'Why the difference is negative:',
    `• POS Sales Amount: ${inr(r.pos)}`,
    `• TEA/SALT Manual Amount: ${inr(r.manual)}${tea}`,
    `• C.Box/Poly Amount: ${inr(r.pack)}${r.pack ? ` — ${PACK_LABEL[r.packSource]}` : ''}`,
    `• Police Sales: ${inr(r.police)}`,
    `• Expected Total: ${inr(r.expected)}`,
    `• Actual Remittance: ${inr(r.remit)}`,
    `• Difference: ${inr(r.excess)}`,
    '',
    ...reconcileReasons(r),
    '',
    'The difference is negative because the actual remittance is lower than the calculated amount.',
  ].join('\n');
}
