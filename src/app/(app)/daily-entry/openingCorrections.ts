/**
 * An administrator's Opening correction, said out loud before it is saved
 * (office, 2026-09-30).
 *
 * Daily Entry lets an administrator type any Opening; typed where a balance
 * carries in, it is saved as a correction (`openFixed`) and every later day
 * carries from it. Nothing in the month accounts for the difference: the
 * month's Opening is the FIRST sheet's, its Closing is Opening + Receipt ±
 * adjustments − Sales. So a correction on a later day makes that day — and
 * next month — disagree with the month, and "previous month CB → next month
 * OB" no longer holds. CRS 5, 30-09-2026: Police BRA carried 0, 12 was typed,
 * September closed at 0 and October would have opened at 12.
 *
 * The save therefore asks first, naming each such figure. Only NEW
 * corrections: one already saved at that figure has been through this.
 * The calculation, the permission and the save itself are unchanged.
 */

export type OpeningRow = {
  label: string;
  unit?: string;
  /** What the chain carries in; null at the start of the chain (nothing to differ from). */
  carry: number | null;
  /** The Opening about to be saved. */
  open: number;
  /** About to be saved as a correction. */
  fixed: boolean;
  /** The row as it is saved now, if the day has a sheet. */
  saved?: { open?: unknown; openFixed?: unknown } | null;
};

export type OpeningCorrection = { label: string; unit: string; carry: number; open: number; diff: number };

const near3 = (a: number, b: number) => Math.abs(a - b) < 0.0005;

export function newOpeningCorrections(rows: OpeningRow[]): OpeningCorrection[] {
  const out: OpeningCorrection[] = [];
  for (const r of rows) {
    if (!r.fixed || r.carry === null || near3(r.open, r.carry)) continue;
    if (r.saved?.openFixed && near3(Number(r.saved.open) || 0, r.open)) continue; // already saved so
    out.push({ label: r.label, unit: r.unit ?? '', carry: r.carry, open: r.open, diff: Math.round((r.open - r.carry) * 1000) / 1000 });
  }
  return out;
}

const q = (n: number) => n.toFixed(3);

export function openingCorrectionMessage(list: OpeningCorrection[], dayLabel: string): string {
  const lines = list.map((c) => `• ${c.label}: carried ${q(c.carry)}, typed ${q(c.open)} (${c.diff > 0 ? '+' : ''}${q(c.diff)}${c.unit ? ` ${c.unit}` : ''})`);
  return (
    `${list.length === 1 ? 'This Opening differs' : 'These Openings differ'} from the balance carried into ${dayLabel}:\n\n` +
    `${lines.join('\n')}\n\n` +
    'Saved as a correction, every later day carries from the typed figure — but the month does not account for the difference, ' +
    "so this month's Closing and next month's Opening will not agree.\n\n" +
    'Save the correction anyway?'
  );
}
