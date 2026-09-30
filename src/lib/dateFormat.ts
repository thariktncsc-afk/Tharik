/**
 * Dates as the office writes them: DD-MM-YYYY (office, 2026-09-29).
 *
 * DISPLAY ONLY. Every date the app stores, compares or computes with stays
 * ISO `YYYY-MM-DD` — the day-sheet keys, the chain, holidays, remittance
 * dates, the database. These turn that into what a person reads, and read
 * what a person types back into ISO. `29-09-2026` is 29 September, never
 * the American 09/29.
 */

const pad = (n: number) => String(n).padStart(2, '0');

/** `2026-09-29` → `29-09-2026`. Anything that is not an ISO date comes back as it was ('' stays ''). */
export function dmy(iso: string | null | undefined): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(iso ?? ''));
  return m ? `${m[3]}-${m[2]}-${m[1]}` : String(iso ?? '');
}

/** A Date as DD-MM-YYYY, by its own (local) calendar day. */
export function dmyOf(d: Date): string {
  return `${pad(d.getDate())}-${pad(d.getMonth() + 1)}-${d.getFullYear()}`;
}

/** A moment as `29-09-2026, 04:46 pm` — for "saved at", "raised at" and the like. */
export function dmyTime(at: string | number | Date): string {
  const d = at instanceof Date ? at : new Date(at);
  if (Number.isNaN(d.getTime())) return '';
  const h = d.getHours();
  return `${dmyOf(d)}, ${pad(h % 12 || 12)}:${pad(d.getMinutes())} ${h < 12 ? 'am' : 'pm'}`;
}

/**
 * A timestamp STORED as the browser's en-IN text (`29/9/2026, 4:46:00 pm` —
 * a receipt's `savedAt`) shown as `29-09-2026, 04:46 pm`. The stored text is
 * never changed; anything not in that shape is shown as it is.
 */
export function dmyFromLocale(s: string | null | undefined): string {
  const m = /^(\d{1,2})\/(\d{1,2})\/(\d{4}),?\s*(?:(\d{1,2}):(\d{2})(?::\d{2})?\s*([ap]m))?/i.exec(String(s ?? '').trim());
  if (!m) return String(s ?? '');
  const date = `${pad(Number(m[1]))}-${pad(Number(m[2]))}-${m[3]}`;
  return m[4] ? `${date}, ${pad(Number(m[4]))}:${m[5]} ${m[6].toLowerCase()}` : date;
}

/** Whatever has been typed so far, as DD-MM-YYYY: `29092026` → `29-09-2026`, `2909` → `29-09`. */
export function maskDmy(typed: string): string {
  const d = String(typed ?? '').replace(/\D/g, '').slice(0, 8);
  if (d.length <= 2) return d;
  if (d.length <= 4) return `${d.slice(0, 2)}-${d.slice(2)}`;
  return `${d.slice(0, 2)}-${d.slice(2, 4)}-${d.slice(4)}`;
}

/**
 * A typed DD-MM-YYYY (dashes, slashes, dots or none) → ISO, or null if it is
 * not a real calendar date. Day first, always: `09-12-2026` is 9 December.
 */
export function parseDmy(typed: string): string | null {
  const m = /^\s*(\d{1,2})[-/. ]?(\d{1,2})[-/. ]?(\d{4})\s*$/.exec(String(typed ?? ''));
  if (!m) return null;
  const day = Number(m[1]);
  const month = Number(m[2]);
  const year = Number(m[3]);
  if (month < 1 || month > 12 || day < 1 || year < 1900 || year > 2999) return null;
  const last = new Date(Date.UTC(year, month, 0)).getUTCDate();
  if (day > last) return null;
  return `${year}-${pad(month)}-${pad(day)}`;
}
