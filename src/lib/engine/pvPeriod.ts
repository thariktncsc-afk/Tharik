/**
 * PV periods — the statutory cycle, and what may be consolidated into one.
 *
 * A PV quarter is NOT "the last three months". It is a fixed block of the
 * financial year, and the year runs April to March:
 *
 *   Apr + May + Jun  →  JUNE PV
 *   Jul + Aug + Sep  →  SEPTEMBER PV
 *   Oct + Nov + Dec  →  DECEMBER PV
 *   Jan + Feb + Mar  →  MARCH PV, and the year-end consolidation
 *
 * The Reports screen used to offer rolling windows stepped back three months
 * from today — from September that produced Sep–Nov, a period no statement
 * has ever covered. Quarters now snap to the cycle, so choosing any month
 * gives the quarter that month belongs to, and history works the same way as
 * the current period: nothing here reads the clock except the helpers that
 * exist to answer "what is available now".
 */

export type YearMonth = { year: number; month: number };
export type PvKind = 'quarter' | 'annual';

export type PvPeriod = {
  kind: PvKind;
  /** The month the PV is filed in — June, September, December or March. */
  pvMonth: YearMonth;
  months: YearMonth[];
  /** The April–March year this belongs to, named by its starting year. */
  fy: number;
  /** "April 2026 to June 2026" */
  label: string;
  /** "1.04.2026 TO 30.06.2026" — the form's own date-range wording. */
  rangeLabel: string;
  /** "2026-27" */
  fyLabel: string;
};

const MNAMES = ['', 'January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
const pad2 = (n: number) => String(n).padStart(2, '0');

export const monthName = (m: number) => MNAMES[m] ?? String(m);

/** The financial year a month belongs to: April starts it, January–March end it. */
export const fyOf = ({ year, month }: YearMonth): number => (month >= 4 ? year : year - 1);
export const fyLabel = (fy: number) => `${fy}-${String((fy + 1) % 100).padStart(2, '0')}`;

/** The quarter a month falls in, as its index 0..3 within the financial year. */
export const quarterIndexOf = ({ month }: YearMonth): number => Math.floor(((month - 4 + 12) % 12) / 3);

/** The three months of one quarter of a financial year. */
export function quarterMonths(fy: number, qi: number): YearMonth[] {
  const out: YearMonth[] = [];
  for (let i = 0; i < 3; i++) {
    const raw = 4 + qi * 3 + i; // 4..15
    const month = raw > 12 ? raw - 12 : raw;
    out.push({ year: raw > 12 ? fy + 1 : fy, month });
  }
  return out;
}

/** The twelve months of a financial year, April first. */
export function annualMonths(fy: number): YearMonth[] {
  return [0, 1, 2, 3].flatMap((qi) => quarterMonths(fy, qi));
}

const lastDay = ({ year, month }: YearMonth) => new Date(year, month, 0).getDate();

function makePeriod(kind: PvKind, months: YearMonth[], fy: number): PvPeriod {
  const first = months[0];
  const last = months[months.length - 1];
  return {
    kind,
    pvMonth: last,
    months,
    fy,
    label: `${monthName(first.month)} ${first.year} to ${monthName(last.month)} ${last.year}`,
    rangeLabel: `1.${pad2(first.month)}.${first.year} TO ${lastDay(last)}.${pad2(last.month)}.${last.year}`,
    fyLabel: fyLabel(fy),
  };
}

/** The quarter containing `ym` — whichever month of it the user picked. */
export function quarterFor(ym: YearMonth): PvPeriod {
  const fy = fyOf(ym);
  return makePeriod('quarter', quarterMonths(fy, quarterIndexOf(ym)), fy);
}

/**
 * A financial year's quarter by its index: 0 = Apr–Jun … 3 = Jan–Mar.
 *
 * This is how the screen picks one, because a year plus "which quarter" is
 * what a clerk actually knows. Jan–Mar lands in the NEXT calendar year, which
 * quarterMonths already handles — FY 2026's fourth quarter is Jan–Mar 2027.
 */
export function quarterByIndex(fy: number, qi: number): PvPeriod {
  return makePeriod('quarter', quarterMonths(fy, qi), fy);
}

/** "Apr – May – Jun" etc., for the four period cards. */
export const QUARTER_LABELS = ['Apr – May – Jun', 'Jul – Aug – Sep', 'Oct – Nov – Dec', 'Jan – Feb – Mar'] as const;

export function annualFor(fy: number): PvPeriod {
  return makePeriod('annual', annualMonths(fy), fy);
}

/**
 * Selectable quarters, newest first — every quarter of the financial years
 * touched by the last `count` of them, so a past period is chosen the same way
 * as the current one.
 */
export function quarterOptions(today: Date, count = 8): PvPeriod[] {
  const now = { year: today.getFullYear(), month: today.getMonth() + 1 };
  let fy = fyOf(now);
  let qi = quarterIndexOf(now);
  const out: PvPeriod[] = [];
  for (let i = 0; i < count; i++) {
    out.push(makePeriod('quarter', quarterMonths(fy, qi), fy));
    qi--;
    if (qi < 0) {
      qi = 3;
      fy--;
    }
  }
  return out;
}

/** Financial years, newest first. */
export function annualOptions(today: Date, count = 5): PvPeriod[] {
  const startFy = fyOf({ year: today.getFullYear(), month: today.getMonth() + 1 });
  return Array.from({ length: count }, (_, i) => annualFor(startFy - i));
}

// ── Manual consolidation: what may be combined ───────────────────────────────

/** One uploaded or selected statement, reduced to what validation needs. */
export type SourceStatement = { crsId: number; year: number; month: number; name?: string };

export type ValidationResult = {
  ok: boolean;
  /** Sorted chronologically — the user may add files in any order. */
  ordered: SourceStatement[];
  period: PvPeriod | null;
  errors: string[];
  /** Months the period needs that no file covers. */
  missing: YearMonth[];
};

const ymKey = (y: YearMonth) => `${y.year}-${pad2(y.month)}`;

/**
 * Are these statements a legal PV set?
 *
 * Every rule here exists because breaking it produces a plausible-looking
 * statement with wrong figures: two shops' stock added together, a month
 * counted twice, or a "quarter" spanning a year-end boundary it does not
 * belong to. Refusing is always better than printing it.
 */
export function validateSources(sources: SourceStatement[], kind: PvKind): ValidationResult {
  const errors: string[] = [];
  const ordered = [...sources].sort((a, b) => (a.year - b.year) || (a.month - b.month));

  if (!sources.length) {
    return { ok: false, ordered, period: null, errors: ['Add the statements to consolidate.'], missing: [] };
  }

  const shops = [...new Set(sources.map((s) => s.crsId))];
  if (shops.length > 1) {
    errors.push(`CRS Shop mismatch. All statements must belong to the same CRS shop — found CRS ${shops.sort((a, b) => a - b).join(', CRS ')}.`);
  }

  const seen = new Map<string, number>();
  for (const s of sources) seen.set(ymKey(s), (seen.get(ymKey(s)) ?? 0) + 1);
  const dupes = [...seen.entries()].filter(([, n]) => n > 1).map(([k]) => k);
  if (dupes.length) {
    errors.push(`The same month was added twice: ${dupes.map((d) => { const [y, m] = d.split('-'); return `${monthName(Number(m))} ${y}`; }).join(', ')}.`);
  }

  // The period is decided by the months present, not by the user, so a set
  // that straddles two quarters is caught rather than silently relabelled.
  const first = ordered[0];
  const period = kind === 'quarter' ? quarterFor(first) : annualFor(fyOf(first));
  const want = new Set(period.months.map(ymKey));

  const strays = ordered.filter((s) => !want.has(ymKey(s)));
  if (strays.length) {
    errors.push(
      `${strays.map((s) => `${monthName(s.month)} ${s.year}`).join(', ')} ${strays.length === 1 ? 'is' : 'are'} outside ${period.label}. ` +
        `A ${kind === 'quarter' ? '3-month' : 'annual'} PV covers ${period.label} only.`,
    );
  }

  const have = new Set(ordered.map(ymKey));
  const missing = period.months.filter((m) => !have.has(ymKey(m)));
  if (missing.length && !strays.length) {
    errors.push(`Missing ${missing.map((m) => `${monthName(m.month)} ${m.year}`).join(', ')} — ${period.months.length} months are needed.`);
  }

  return { ok: errors.length === 0, ordered, period, errors, missing };
}

/**
 * Which PV periods have data in the system, newest first.
 *
 * "Available" means every month of the period has a published monthly record
 * for that shop — the same condition the automatic schedule waits for, which
 * is why June/September/December/March simply become available rather than
 * needing a job to run on a particular day.
 */
export function availablePeriods(
  monthlyStore: Record<string, unknown>,
  crsId: number,
  today: Date,
): { quarters: PvPeriod[]; annuals: PvPeriod[] } {
  const has = (m: YearMonth) => !!monthlyStore[`${crsId}_${m.month}_${m.year}`];
  const complete = (p: PvPeriod) => p.months.every(has);
  return {
    quarters: quarterOptions(today, 12).filter(complete),
    annuals: annualOptions(today, 4).filter(complete),
  };
}
