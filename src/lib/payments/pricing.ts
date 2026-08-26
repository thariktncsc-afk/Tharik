/**
 * Download tariff — the single source of truth for what a download costs.
 *
 * Imported by BOTH the browser (to show the customer a price before they pay)
 * and the route handlers (to decide what was actually owed). The server never
 * trusts an amount sent up from the client; it re-runs these functions against
 * the settings row and compares. Keeping one implementation is what makes that
 * comparison meaningful.
 *
 * Everything is in PAISE, as integers. Rupee floats do not survive being added
 * up and reconciled against a bank statement.
 */

export type PaymentSettings = {
  enabled: boolean;
  upiVpa: string;
  upiPayeeName: string;
  /** ₹40 per sheet by default, inclusive of GST. */
  statementSheetPaise: number;
  /** ₹5 per day by default, plus GST. */
  dssDayPaise: number;
  /** Basis points: 1800 = 18%. */
  gstRateBp: number;
};

export const DEFAULT_SETTINGS: PaymentSettings = {
  enabled: false,
  upiVpa: '',
  upiPayeeName: '',
  statementSheetPaise: 4000,
  dssDayPaise: 500,
  gstRateBp: 1800,
};

export type Quote = {
  /** Taxable value. */
  basePaise: number;
  gstPaise: number;
  totalPaise: number;
  gstRateBp: number;
  /** True when the headline price already contains the tax (statements). */
  gstInclusive: boolean;
  unitPaise: number;
  units: number;
};

/**
 * Statements: ₹40 per sheet INCLUSIVE of GST, so the customer pays a round
 * ₹40 and the tax is carved out of it. 13 sheets = ₹520, 14 = ₹560.
 *
 * A "sheet" is a statement section, not a printed copy — `crs_page2`, `gunny`,
 * `remittance` and `crs_police` carry `copies: 2` and are still one sheet.
 */
export function quoteStatement(sheetCount: number, s: PaymentSettings): Quote {
  const n = units(sheetCount);
  const totalPaise = n * units(s.statementSheetPaise);
  // Carve the tax out: gst = total × rate / (100% + rate).
  const rate = units(s.gstRateBp);
  const gstPaise = Math.round((totalPaise * rate) / (10000 + rate));
  return {
    basePaise: totalPaise - gstPaise,
    gstPaise,
    totalPaise,
    gstRateBp: rate,
    gstInclusive: true,
    unitPaise: units(s.statementSheetPaise),
    units: n,
  };
}

/** DSS bulk download: ₹5 per day of the month, PLUS GST on top. */
export function quoteDss(dayCount: number, s: PaymentSettings): Quote {
  const n = units(dayCount);
  const basePaise = n * units(s.dssDayPaise);
  const rate = units(s.gstRateBp);
  const gstPaise = Math.round((basePaise * rate) / 10000);
  return {
    basePaise,
    gstPaise,
    totalPaise: basePaise + gstPaise,
    gstRateBp: rate,
    gstInclusive: false,
    unitPaise: units(s.dssDayPaise),
    units: n,
  };
}

/**
 * A count that is safe to multiply money by.
 *
 * `Math.max(0, NaN)` is NaN, not 0, so clamping alone is not enough — a NaN
 * would travel all the way to a "₹NaN" price tag, or to an order row whose
 * amount cannot be reconciled. A quantity that is not a real number is zero.
 */
function units(n: number): number {
  return Number.isFinite(n) ? Math.max(0, Math.trunc(n)) : 0;
}

/** 52000 → "520.00". UPI amounts must be sent with exactly two decimals. */
export function rupees(paise: number): string {
  return (paise / 100).toFixed(2);
}

/** 52000 → "₹520.00", for display only. */
export function formatRupees(paise: number): string {
  return `₹${rupees(paise)}`;
}
