/**
 * Card Details and Allotment from photos (office, 2026-09-29).
 *
 * The photo is READ by a vision model on the server (/api/ocr, src/lib/ocr):
 * it transcribes what is printed — row labels as shown, Tamil or English, and
 * the figures — and nothing else. Deciding which of OUR fields a printed label
 * is happens here, in code, so it is the same every time and can be checked
 * (tools/verify-photo-extract.mjs). A label this file does not recognise is
 * reported to the clerk, never guessed.
 *
 * Nothing here writes anything. Monthly Entry shows the result as a DRAFT in
 * the existing fields (like last month's carried card counts); only Save Card
 * Details / Save Allotment store it.
 *
 *   Cards      POS "அட்டை விவரங்கள்" screen: card type → count, plus the
 *              screen's total (மொத்த அட்டைகள்), which is used as a check.
 *   Allotment  the FPS Allocation Report (one row per shop — the selected
 *              shop's row is picked by its FPS code), or a POS screen for one
 *              shop. Columns map as tools/set-allotment.mjs settled with the
 *              office: Rice → BRA, PHH Rice → PHH BRA, police columns left out.
 *
 * Several photos combine by FIELD: the same card type on two overlapping POS
 * pages is one figure, not two. Two photos that disagree about a field leave
 * it for the clerk instead of picking one.
 */

import type { Commodity } from './commodities';

// ── What the server returns (a transcription, not a mapping) ────────────────

export type CardTranscript = {
  rows: { label: string; count: number; rowNo?: number | null }[];
  /** The total the screen itself prints (மொத்த அட்டைகள்), if visible. */
  totalShown?: number | null;
};

export type AllotTranscript = {
  layout: 'fps_report' | 'pos_screen' | 'other';
  /** As printed, e.g. "SEP" / "September" / "09". */
  month?: string | null;
  year?: number | null;
  rows: { fpsCode?: string | null; fpsName?: string | null; cells: { column: string; value: number }[] }[];
};

/** The card ids of ME_CARD_TYPES (monthly-entry/lib.ts), in their order. */
export const CARD_IDS = ['rice', 'lof_rice', 'sugar', 'lof_sugar', 'aay', 'lof_aay', 'oap', 'police', 'n_card'] as const;
export type CardId = (typeof CARD_IDS)[number];

// ── Normalising a printed label ─────────────────────────────────────────────

/**
 * Lower case, NFC, the zero-width joiners Tamil text carries (U+200C/D)
 * dropped, anything that is neither a letter, a digit nor Tamil turned into a
 * space. `"LOF அரிசி அட்டை"` → `"lof அரிசி அட்டை"`; `"Toor Dhall (kg)"` →
 * `"toor dhall kg"`.
 */
export function normLabel(s: unknown): string {
  return String(s ?? '')
    .normalize('NFC')
    .replace(/[​-‍﻿]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9஀-௿]+/g, ' ')
    .trim()
    .replace(/\s+/g, ' ');
}
const tokens = (s: string) => new Set(s.split(' ').filter(Boolean));

// ── Cards ───────────────────────────────────────────────────────────────────

/** The card TOTAL line (மொத்த அட்டைகள் / Total cards) — not "மொத்த பயனாளிகள்" (total beneficiaries) beside it. */
const isTotalLabel = (n: string) => /மொத்த\S*\s*அட்டை/.test(n) || /\btotal\b.*\bcards?\b|^total$|^மொத்தம்$/.test(n);

/**
 * One printed card label → our card id, or null. Tamil as the POS prints it,
 * English as our own form does. Order matters: "LOF அரிசி அட்டை" is a rice
 * label with LOF in front, and a police or no-commodity card also says அட்டை.
 */
export function cardIdFor(label: string): CardId | null {
  const n = normLabel(label);
  if (!n || isTotalLabel(n)) return null;
  const t = tokens(n);
  const lof = t.has('lof');
  if (/காவலர்/.test(n) || t.has('police')) return lof ? null : 'police';
  // பண்டகமில்லா அட்டை — a card that draws no commodity: our "N" CARD.
  if (/பண்டகமில்லா|பண்டமில்லா|பொருளில்லா/.test(n) || (t.has('n') && t.has('card')) || t.has('nphhnc') || (t.has('nphh') && t.has('nc'))) return lof ? null : 'n_card';
  if (t.has('aay') || /அந்தியோதயா|அந்த்யோதயா/.test(n) || t.has('antyodaya')) return lof ? 'lof_aay' : 'aay';
  if (t.has('oap') || /முதியோர்/.test(n)) return lof ? null : 'oap';
  if (/சர்க்கரை|சீனி/.test(n) || t.has('sugar') || t.has('nphhs') || (t.has('nphh') && t.has('s'))) return lof ? 'lof_sugar' : 'sugar';
  if (/அரிசி/.test(n) || t.has('rice') || t.has('phh') || t.has('nphh')) return lof ? 'lof_rice' : 'rice';
  return null;
}

export type CardPhotoResult = {
  values: Partial<Record<CardId, number>>;
  /** Rows whose label is not one of our card types — shown, never used. */
  unknown: { label: string; count: number }[];
  /** A card type printed twice on one photo with two different counts. */
  conflicts: CardId[];
  totalShown: number | null;
};

const wholeCount = (v: unknown): number | null => {
  if (v === null || v === undefined || String(v).trim() === '') return null; // absent is not 0
  const n = Number(String(v ?? '').replace(/,/g, ''));
  return Number.isFinite(n) && n >= 0 && Number.isInteger(n) ? n : null;
};

export function mapCardPhoto(t: CardTranscript): CardPhotoResult {
  const values: Partial<Record<CardId, number>> = {};
  const unknown: CardPhotoResult['unknown'] = [];
  const conflicts = new Set<CardId>();
  let totalShown = wholeCount(t.totalShown);
  for (const r of t.rows ?? []) {
    const count = wholeCount(r.count);
    if (count === null) continue;
    const n = normLabel(r.label);
    if (isTotalLabel(n)) {
      totalShown ??= count;
      continue;
    }
    const id = cardIdFor(r.label);
    if (!id) {
      unknown.push({ label: String(r.label ?? ''), count });
      continue;
    }
    if (values[id] !== undefined && values[id] !== count) conflicts.add(id);
    values[id] = count;
  }
  for (const id of conflicts) delete values[id];
  return { values, unknown, conflicts: [...conflicts], totalShown };
}

export type CombinedCards = {
  /** One figure per card type found — the draft for the fields. */
  values: Partial<Record<CardId, number>>;
  /** Card types the photos disagree about: left for the clerk. */
  conflicts: CardId[];
  unknown: { label: string; count: number }[];
  totalShown: number | null;
  sum: number;
  /**
   * Card types not in any photo that are 0 BECAUSE the POS total is fully
   * accounted for by the ones that are (it lists only the kinds a shop has).
   * Empty whenever the total is missing, disagrees, or anything conflicts.
   */
  zeroFilled: CardId[];
  /** The POS total and the figures read disagree (a page may be missing). */
  totalMismatch: boolean;
};

export function combineCards(photos: CardPhotoResult[]): CombinedCards {
  const seen: Partial<Record<CardId, Set<number>>> = {};
  const conflicts = new Set<CardId>();
  const unknown: CombinedCards['unknown'] = [];
  const totals = new Set<number>();
  for (const p of photos) {
    for (const [id, v] of Object.entries(p.values) as [CardId, number][]) (seen[id] ??= new Set()).add(v);
    p.conflicts.forEach((id) => conflicts.add(id));
    for (const u of p.unknown) if (!unknown.some((x) => normLabel(x.label) === normLabel(u.label) && x.count === u.count)) unknown.push(u);
    if (p.totalShown !== null) totals.add(p.totalShown);
  }
  const values: Partial<Record<CardId, number>> = {};
  for (const [id, set] of Object.entries(seen) as [CardId, Set<number>][]) {
    if (set.size > 1 || conflicts.has(id)) conflicts.add(id);
    else values[id] = [...set][0];
  }
  const totalShown = totals.size === 1 ? [...totals][0] : null;
  const sum = Object.values(values).reduce<number>((t, v) => t + (v ?? 0), 0);
  const complete = totalShown !== null && !conflicts.size && totals.size === 1 && sum === totalShown;
  const zeroFilled = complete ? CARD_IDS.filter((id) => values[id] === undefined) : [];
  return { values, conflicts: [...conflicts], unknown, totalShown, sum, zeroFilled, totalMismatch: totals.size > 1 || (totalShown !== null && sum !== totalShown && !conflicts.size) };
}

// ── Allotment ───────────────────────────────────────────────────────────────

/** Police columns of the report: no Allotment field (the office's decision). */
export const isPoliceColumn = (label: string) => /\bpolice\b|காவலர்/.test(normLabel(label));

/**
 * One printed commodity heading → our commodity id, or null. The report's own
 * headings ("Rice (kg)", "AAY Rice (kg)", "Toor Dhall (kg)", "PalmOil (Pkt)",
 * "PHH Rice (kg)") and a POS screen's (our English and Tamil names). Checked
 * most specific first: "AAY Sugar" before "Sugar", "NPHH FRK RRA" before
 * "NPHH FRK", "NPHH" before "PHH".
 */
export function allotIdFor(label: string): string | null {
  const n = normLabel(label);
  if (!n || isPoliceColumn(label)) return null;
  const t = tokens(n);
  const sugar = /சீனி|சர்க்கரை/.test(n) || t.has('sugar');
  const rice = /அரிசி|புழுங்கல்/.test(n) || t.has('rice') || t.has('bra');
  if (t.has('aay') && sugar) return 'AAY_SUGAR';
  if (sugar) return 'SUGAR';
  if (/கோதுமை/.test(n) || t.has('wheat')) return 'WHEAT';
  if (/துவரம்|பருப்பு/.test(n) || t.has('toor') || t.has('dal') || t.has('dhall') || t.has('dhal') || t.has('tur')) return 'TOOR';
  if (/பாம்|பாமாயில்/.test(n) || n.includes('palm')) return 'PALM';
  if (t.has('nphh') && t.has('frk') && t.has('rra')) return 'NPHH_RRA';
  if (t.has('nphh') && t.has('frk')) return 'NPHH_FRK';
  if (t.has('phh') && t.has('frk')) return 'PHH_FRK';
  if (t.has('aay') && t.has('frk')) return 'AAY_FRK';
  if (t.has('phh')) return 'PHH_BRA';
  if (t.has('aay')) return 'AAY';
  if (t.has('oap')) return 'OAP';
  if (t.has('aps')) return 'APS';
  if (t.has('rra') || /பச்சை/.test(n)) return 'RRA';
  if (rice) return 'BRA';
  return null;
}

const MONTHS = ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec'];
/** "SEP" / "September" / "09" / "9" → 9; anything else → null. */
export function monthNumber(s: unknown): number | null {
  const n = normLabel(s);
  if (!n) return null;
  if (/^\d{1,2}$/.test(n)) {
    const m = Number(n);
    return m >= 1 && m <= 12 ? m : null;
  }
  const i = MONTHS.indexOf(n.slice(0, 3));
  return i >= 0 ? i + 1 : null;
}

const quantity = (v: unknown): number | null => {
  if (v === null || v === undefined || String(v).trim() === '') return null; // absent is not 0
  const n = Number(String(v ?? '').replace(/,/g, ''));
  return Number.isFinite(n) && n >= 0 ? Math.round(n * 1000) / 1000 : null;
};

export type AllotPhotoResult = {
  values: Record<string, number>;
  unknown: { label: string; value: number }[];
  /** Police columns seen and deliberately left out. */
  skipped: string[];
  conflicts: string[];
  /** Why nothing of this photo was used (wrong shop, wrong month). */
  problem: string | null;
  /** Which row was used, for the clerk: "22EA007PN · Tncsc Crs 8". */
  source: string | null;
};

export function mapAllotPhoto(
  t: AllotTranscript,
  shop: { crsId: number; code?: string | null },
  period: { month: number; year: number },
  items: Pick<Commodity, 'id' | 'en'>[],
): AllotPhotoResult {
  const out: AllotPhotoResult = { values: {}, unknown: [], skipped: [], conflicts: [], problem: null, source: null };
  const monthNames = ['', 'January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
  const m = monthNumber(t.month);
  const y = Number(t.year) || null;
  if ((m && m !== period.month) || (y && y !== period.year)) {
    out.problem = `This photo is for ${m ? monthNames[m] : '?'} ${y ?? ''}`.trim() + ` — the month open here is ${monthNames[period.month]} ${period.year}.`;
    return out;
  }
  const rows = t.rows ?? [];
  const code = String(shop.code ?? '').toUpperCase().replace(/\s+/g, '');
  const crsOf = (name: unknown) => {
    const x = /crs\s*0*(\d+)\b/.exec(normLabel(name));
    return x ? Number(x[1]) : null;
  };
  let row = rows.find((r) => code && String(r.fpsCode ?? '').toUpperCase().replace(/\s+/g, '') === code);
  if (!row) row = rows.find((r) => !r.fpsCode && crsOf(r.fpsName) === shop.crsId);
  if (!row && rows.length === 1 && !rows[0].fpsCode && !rows[0].fpsName) row = rows[0]; // a one-shop POS screen
  if (!row) {
    const others = rows.map((r) => r.fpsCode || r.fpsName).filter(Boolean);
    out.problem = others.length
      ? `No row for CRS ${shop.crsId}${code ? ` (${code})` : ''} in this photo — it shows ${others.slice(0, 4).join(', ')}${others.length > 4 ? ', …' : ''}.`
      : `No allotment figures were found in this photo.`;
    return out;
  }
  // A row that names a DIFFERENT shop by its code is refused, even if its name says ours.
  if (row.fpsCode && code && String(row.fpsCode).toUpperCase().replace(/\s+/g, '') !== code) {
    out.problem = `The row found is ${row.fpsCode}, not CRS ${shop.crsId}'s ${code}.`;
    return out;
  }
  out.source = [row.fpsCode, row.fpsName].filter(Boolean).join(' · ') || null;
  const allowed = new Set(items.map((i) => i.id));
  const conflicts = new Set<string>();
  for (const c of row.cells ?? []) {
    const v = quantity(c.value);
    if (v === null) continue;
    if (isPoliceColumn(c.column)) {
      out.skipped.push(String(c.column));
      continue;
    }
    const id = allotIdFor(c.column);
    if (!id || !allowed.has(id)) {
      out.unknown.push({ label: String(c.column), value: v });
      continue;
    }
    if (out.values[id] !== undefined && out.values[id] !== v) conflicts.add(id);
    out.values[id] = v;
  }
  for (const id of conflicts) delete out.values[id];
  out.conflicts = [...conflicts];
  return out;
}

export type CombinedAllot = {
  values: Record<string, number>;
  conflicts: string[];
  unknown: { label: string; value: number }[];
  skipped: string[];
  problems: string[];
  sources: string[];
};

export function combineAllot(photos: AllotPhotoResult[]): CombinedAllot {
  const seen: Record<string, Set<number>> = {};
  const conflicts = new Set<string>();
  const out: CombinedAllot = { values: {}, conflicts: [], unknown: [], skipped: [], problems: [], sources: [] };
  for (const p of photos) {
    if (p.problem) {
      out.problems.push(p.problem);
      continue;
    }
    for (const [id, v] of Object.entries(p.values)) (seen[id] ??= new Set()).add(v);
    p.conflicts.forEach((id) => conflicts.add(id));
    for (const u of p.unknown) if (!out.unknown.some((x) => normLabel(x.label) === normLabel(u.label) && x.value === u.value)) out.unknown.push(u);
    for (const s of p.skipped) if (!out.skipped.includes(s)) out.skipped.push(s);
    if (p.source && !out.sources.includes(p.source)) out.sources.push(p.source);
  }
  for (const [id, set] of Object.entries(seen)) {
    if (set.size > 1 || conflicts.has(id)) conflicts.add(id);
    else out.values[id] = [...set][0];
  }
  out.conflicts = [...conflicts];
  return out;
}

// ── The draft shown in the fields ───────────────────────────────────────────

/**
 * What the photos put in the fields: every combined figure, except a field
 * the clerk has typed into since (their correction stands, whatever a later
 * photo says). Nothing is written by this — Save does that.
 */
export function photoDraft<K extends string>(combined: Partial<Record<K, number>>, zeroFilled: readonly K[], edited: ReadonlySet<string>): Partial<Record<K, number>> {
  const out: Partial<Record<K, number>> = {};
  for (const [id, v] of Object.entries(combined) as [K, number][]) if (!edited.has(id)) out[id] = v;
  for (const id of zeroFilled) if (!edited.has(id) && out[id] === undefined) out[id] = 0;
  return out;
}
