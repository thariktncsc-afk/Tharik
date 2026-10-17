/**
 * Payment Management (office, 2026-10-16) — the rules, with no I/O, so the
 * handlers (server.ts), the routes and tools/verify-payment-mgmt.mjs share them.
 *
 * An obligation is what one shop owes for one month and one kind of payment.
 * Its money is integer PAISE; what is paid and what is still owed are always
 * worked out from the payments, never stored. A payment is an entry: a
 * correction keeps what it replaced, a mistake is voided with its reason —
 * nothing is ever overwritten or removed. A reminder is an event: each send is
 * a new one, carrying the figures of that moment.
 *
 * No next/* or supabase import here (the verify script loads this file).
 */
import { formatRupees } from '@/lib/payments/pricing';
import { upiUri } from '@/lib/payments/upi';
import { SHOP_IDS } from '@/lib/engine/shops';
import type { ActivityDraft, Change } from '@/lib/activityLog/core';
import type { Detail } from '@/lib/notify/core';
import {
  PAY_METHODS,
  PM_TYPES,
  type PayMethod,
  type PmAsset,
  type PmMedia,
  type PmObligation,
  type PmPart,
  type PmPayment,
  type PmPaymentFields,
  type PmReminder,
  type PmShopObligation,
  type PmStatus,
  type PmType,
  type PmUpiConfig,
  type PmUpiLinks,
  type PmView,
  type ReminderStatus,
} from './types';

// ── Keys and limits ─────────────────────────────────────────────────────────

/** One crs_state record per obligation: `pmob:1-2026-10-pv`. */
export const obKey = (id: string) => `pmob:${id}`;
/** The uploaded QR image and reminder sounds (their details; the files are in Storage). */
export const MEDIA_KEY = 'pmset:media';

/** A Vercel function takes at most 4.5 MB of body; files are sent raw. */
export const MAX_MEDIA_BYTES = 4 * 1024 * 1024;
/** Uploaded reminder sounds kept at once. */
export const MAX_SOUNDS = 20;

export const TITLE_MAX = 80;
export const REFERENCE_MAX = 60;
export const UTR_MAX = 40;
export const REMARKS_MAX = 300;
export const VOID_REASON_MAX = 200;
export const PAYEE_MAX = 80;

const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
export const monthText = (year: number, month: number) => `${MONTHS[month - 1] ?? month} ${year}`;
const monthShort = (year: number, month: number) => `${(MONTHS[month - 1] ?? String(month)).slice(0, 3)} ${year}`;

// ── Who is asking ───────────────────────────────────────────────────────────

/** The signed-in person, as the handlers receive them. */
export type PmActorSession = { userId: number; role: string; crsId: number | null; name: string };

export const isAdmin = (a: PmActorSession | null) => a?.role === 'ADMIN';

// ── Values ──────────────────────────────────────────────────────────────────

/**
 * Rupee text as typed → paise, or null. '350' → 35000, '200.5' → 20050.
 * Digits and at most two decimals; no commas, signs or spaces inside — never
 * a float on the way (0.1 + 0.2 is not a figure for a ledger).
 */
export function parseRupees(text: unknown): number | null {
  const s = String(text ?? '').trim();
  const m = /^(\d{1,7})(?:\.(\d{1,2}))?$/.exec(s);
  if (!m) return null;
  return Number(m[1]) * 100 + Number((m[2] ?? '').padEnd(2, '0'));
}

export const validCrs = (crsId: number) => SHOP_IDS.includes(crsId);
export const validMonth = (month: number) => Number.isInteger(month) && month >= 1 && month <= 12;
export const validYear = (year: number) => Number.isInteger(year) && year >= 2020 && year <= 2100;

export const isPmType = (t: unknown): t is PmType => PM_TYPES.some((x) => x.id === t);
export const isPayMethod = (m: unknown): m is PayMethod => PAY_METHODS.some((x) => x.id === m);
export const typeLabel = (t: PmType) => PM_TYPES.find((x) => x.id === t)?.label ?? String(t);
export const typeCode = (t: PmType) => PM_TYPES.find((x) => x.id === t)?.code ?? 'OT';

/** A real calendar date, ISO YYYY-MM-DD. */
export function isIsoDate(s: unknown): s is string {
  if (typeof s !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(s)) return false;
  const [y, m, d] = s.split('-').map(Number);
  const t = new Date(Date.UTC(y, m - 1, d));
  return t.getUTCFullYear() === y && t.getUTCMonth() === m - 1 && t.getUTCDate() === d;
}

/** Today's date in India, where the shops are: ISO YYYY-MM-DD. */
export function istToday(now: Date = new Date()): string {
  const p = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Kolkata', year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(now);
  const get = (t: string) => p.find((x) => x.type === t)?.value ?? '';
  return `${get('year')}-${get('month')}-${get('day')}`;
}

/** Typed text kept on a record: control characters out, spaces trimmed. Null when longer than allowed. */
export function cleanText(v: unknown, max: number): string | null {
  const s = String(v ?? '').replace(/[\u0000-\u001f\u007f]/g, ' ').replace(/\s+/g, ' ').trim();
  return s.length > max ? null : s;
}

/** A file's own name, without any folder, as it will be shown. */
export function cleanName(name: unknown): string {
  return String(name ?? '').split(/[\\/]/).pop()!.replace(/[\u0000-\u001f\u007f]/g, '').trim().slice(0, 120);
}

const rand = (n: number) => {
  let s = '';
  while (s.length < n) s += Math.random().toString(36).slice(2);
  return s.slice(0, n);
};

/** A payment, reminder or file id: `p…`, `r…`, `a…` — time first, so they sort as they were made. */
export const newId = (prefix: 'p' | 'r' | 'a') => `${prefix}${Date.now().toString(36)}${rand(6)}`;

/**
 * An obligation's id. Monthly / PV / Previous Balance: one per shop and month,
 * so the id IS the shop, month and type — the record's key makes a second one
 * impossible. 'Other' may be entered any number of times: a random suffix.
 */
export function obligationId(crsId: number, year: number, month: number, type: PmType): string {
  const base = `${crsId}-${year}-${month}-${type}`;
  return type === 'other' ? `${base}-${rand(6)}` : base;
}

/** An id as the routes receive it — anything else is answered as not found. */
export const validObligationId = (id: unknown): id is string =>
  typeof id === 'string' && /^\d{1,2}-\d{4}-\d{1,2}-(monthly|pv|prev_balance|monthly_pv|monthly_prev|pv_prev|monthly_pv_prev|other-[a-z0-9]{4,12})$/.test(id);

// ── Figures ─────────────────────────────────────────────────────────────────

export const activePayments = (o: Pick<PmObligation, 'payments'>) => (o.payments ?? []).filter((p) => !p.voided);

/** Sum of the payments that are not voided. */
export const paidOf = (o: Pick<PmObligation, 'payments'>) => activePayments(o).reduce((s, p) => s + (Number(p.amountPaise) || 0), 0);

/** What is still owed; never below 0 (a payment above the balance is refused). */
export const balanceOf = (o: Pick<PmObligation, 'payments' | 'duePaise'>) => Math.max(0, (Number(o.duePaise) || 0) - paidOf(o));

export function statusOf(o: Pick<PmObligation, 'payments' | 'duePaise'>): PmStatus {
  const paid = paidOf(o);
  const balance = balanceOf(o);
  if (o.duePaise > 0 && balance === 0) return 'paid';
  if (paid > 0 && balance > 0) return 'partial';
  return 'unpaid';
}

const byAt = (a: { at: string }, b: { at: string }) => (a.at < b.at ? -1 : a.at > b.at ? 1 : 0);

/** The newest reminder sent, or null. */
export function newestReminder(o: Pick<PmObligation, 'reminders'>): PmReminder | null {
  const r = [...(o.reminders ?? [])].sort(byAt);
  return r.length ? r[r.length - 1] : null;
}

/** none: never reminded; sent: the newest still waits for OK; acknowledged: it was answered. */
export function reminderStatus(o: Pick<PmObligation, 'reminders'>): ReminderStatus {
  const r = newestReminder(o);
  if (!r) return 'none';
  return r.ackAt ? 'acknowledged' : 'sent';
}

/** "PV Statement", or an Other obligation's own title. */
export const whatOf = (o: Pick<PmObligation, 'type' | 'title'>) => (o.type === 'other' && o.title ? o.title : typeLabel(o.type));

/** "CRS 1 October 2026 PV Statement" — how the log and the replies name it. */
export const describe = (o: Pick<PmObligation, 'crsId' | 'month' | 'year' | 'type' | 'title'>) => `CRS ${o.crsId} ${monthText(o.year, o.month)} ${whatOf(o)}`;

// ── Reading a stored record ─────────────────────────────────────────────────

const str = (v: unknown) => (typeof v === 'string' ? v : v == null ? '' : String(v));
const int = (v: unknown) => (Number.isFinite(Number(v)) ? Math.trunc(Number(v)) : 0);
const idOrNull = (v: unknown) => (v == null || v === '' ? null : Number.isFinite(Number(v)) ? Number(v) : null);

function readPaymentFields(raw: Record<string, unknown>): PmPaymentFields {
  return {
    date: str(raw.date),
    amountPaise: int(raw.amountPaise),
    method: isPayMethod(raw.method) ? raw.method : 'other',
    utr: str(raw.utr),
    remarks: str(raw.remarks),
  };
}

/** A stored obligation with every list present — an older or partial record never breaks a screen. */
export function readObligation(raw: unknown): PmObligation | null {
  const r = (raw ?? null) as Record<string, unknown> | null;
  if (!r || typeof r !== 'object' || typeof r.id !== 'string' || !isPmType(r.type)) return null;
  const payments = (Array.isArray(r.payments) ? r.payments : []).map((p0): PmPayment => {
    const p = (p0 ?? {}) as Record<string, unknown>;
    return {
      ...readPaymentFields(p),
      id: str(p.id),
      at: str(p.at),
      by: idOrNull(p.by),
      byName: str(p.byName),
      edits: (Array.isArray(p.edits) ? p.edits : []).map((e0) => {
        const e = (e0 ?? {}) as Record<string, unknown>;
        return { at: str(e.at), by: idOrNull(e.by), byName: str(e.byName), before: readPaymentFields((e.before ?? {}) as Record<string, unknown>) };
      }),
      voided: p.voided && typeof p.voided === 'object'
        ? (() => {
            const v = p.voided as Record<string, unknown>;
            return { at: str(v.at), by: idOrNull(v.by), byName: str(v.byName), reason: str(v.reason) };
          })()
        : null,
    };
  });
  const reminders = (Array.isArray(r.reminders) ? r.reminders : []).map((x0): PmReminder => {
    const x = (x0 ?? {}) as Record<string, unknown>;
    return {
      id: str(x.id),
      at: str(x.at),
      by: idOrNull(x.by),
      byName: str(x.byName),
      duePaise: int(x.duePaise),
      paidPaise: int(x.paidPaise),
      balancePaise: int(x.balancePaise),
      notificationId: idOrNull(x.notificationId),
      recipients: int(x.recipients),
      ackAt: x.ackAt ? str(x.ackAt) : null,
      ackBy: idOrNull(x.ackBy),
      ackName: x.ackName == null ? null : str(x.ackName),
    };
  });
  return {
    id: r.id,
    crsId: int(r.crsId),
    month: int(r.month),
    year: int(r.year),
    type: r.type,
    title: str(r.title),
    reference: str(r.reference),
    duePaise: int(r.duePaise),
    payments,
    reminders,
    createdAt: str(r.createdAt),
    createdBy: idOrNull(r.createdBy),
    createdByName: str(r.createdByName),
    updatedAt: str(r.updatedAt),
    updatedBy: idOrNull(r.updatedBy),
    updatedByName: str(r.updatedByName),
  };
}

export const emptyMedia = (): PmMedia => ({ qr: null, sounds: [], activeSoundId: null });

function readAsset(raw: unknown, kind: 'qr' | 'sound'): PmAsset | null {
  const a = (raw ?? null) as Record<string, unknown> | null;
  if (!a || typeof a !== 'object' || typeof a.id !== 'string' || !EXT[str(a.mime)]) return null;
  return { id: a.id, kind, name: str(a.name), mime: str(a.mime), size: int(a.size), at: str(a.at), by: idOrNull(a.by), byName: str(a.byName) };
}

export function readMedia(raw: unknown): PmMedia {
  const m = (raw ?? {}) as Record<string, unknown>;
  const sounds = (Array.isArray(m.sounds) ? m.sounds : []).map((s) => readAsset(s, 'sound')).filter((s): s is PmAsset => !!s);
  const active = typeof m.activeSoundId === 'string' && sounds.some((s) => s.id === m.activeSoundId) ? m.activeSoundId : null;
  return { qr: readAsset(m.qr, 'qr'), sounds, activeSoundId: active };
}

// ── What the screens receive ────────────────────────────────────────────────

export function toView(o: PmObligation, version: number, shopName: string): PmView {
  const last = newestReminder(o);
  return {
    ...o,
    typeLabel: typeLabel(o.type),
    shopName,
    paidPaise: paidOf(o),
    balancePaise: balanceOf(o),
    status: statusOf(o),
    reminderStatus: reminderStatus(o),
    lastReminderAt: last?.at ?? null,
    version,
  };
}

/**
 * The line the reminder screen shows, in the office's own words: "…for the
 * October 2026 PV statement is ₹350." — whole rupees without ".00", paise
 * when there are any (₹150.50).
 */
export function reminderMessage(o: Pick<PmObligation, 'month' | 'year' | 'type' | 'title' | 'duePaise' | 'payments'>): string {
  const what = whatOf(o).replace(/ Statement$/, ' statement');
  const amount = formatRupees(balanceOf(o)).replace(/.00$/, '');
  return (
    `Your payment balance for the ${monthText(o.year, o.month)} ${what} is ${amount}. ` +
    'Please complete the outstanding payment using the UPI options below.'
  );
}

export const reminderTitle = (crsId: number) => `Payment Reminder — CRS ${crsId}`;

/** The figures a reminder notification carries, as of now. */
export function reminderDetails(o: PmObligation): Detail[] {
  return [
    { label: 'Month', value: monthText(o.year, o.month) },
    { label: 'Payment Type', value: whatOf(o) },
    { label: 'Total Amount Due', value: formatRupees(o.duePaise) },
    { label: 'Amount Paid', value: formatRupees(paidOf(o)) },
    { label: 'Outstanding Balance', value: formatRupees(balanceOf(o)) },
  ];
}

/** Where the bell takes a shop user for this reminder: its card on the Payments screen. */
export const reminderLink = (id: string) => `/payments?ob=${encodeURIComponent(id)}`;

/** Where an uploaded file is served — the same path client.ts mediaUrl() builds. */
export const mediaUrl = (assetId: string) => `/api/payment-management/media/${encodeURIComponent(assetId)}`;

/** tr= — 'CRS1-PV-102026'. */
export const linkReference = (o: Pick<PmObligation, 'crsId' | 'month' | 'year' | 'type'>) =>
  `CRS${o.crsId}-${typeCode(o.type)}-${String(o.month).padStart(2, '0')}${o.year}`;

/** tn= — 'CRS 1 PV Statement Oct 2026', at most 50 characters. */
export const linkNote = (o: Pick<PmObligation, 'crsId' | 'month' | 'year' | 'type'>) =>
  `CRS ${o.crsId} ${typeLabel(o.type)} ${monthShort(o.year, o.month)}`.slice(0, 50);

/**
 * UPI links for one amount. The generic upi:// link is the paid downloads'
 * own (upiUri — same encoding); each app link carries exactly its query.
 * None without a UPI ID or without anything to pay.
 */
export function buildLinks(upi: PmUpiConfig | null, amountPaise: number, reference: string, note: string): PmUpiLinks | null {
  if (!upi || !String(upi.vpa ?? '').trim() || !(amountPaise > 0)) return null;
  const uri = upiUri({ vpa: upi.vpa, payeeName: upi.payeeName ?? '', amountPaise, reference, note });
  const q = uri.slice(uri.indexOf('?') + 1);
  return {
    upi: uri,
    gpay: `tez://upi/pay?${q}`,
    phonepe: `phonepe://pay?${q}`,
    paytm: `paytmmp://pay?${q}`,
    amountPaise,
    reference,
    note,
  };
}

export const linksFor = (o: PmObligation, upi: PmUpiConfig | null) => buildLinks(upi, balanceOf(o), linkReference(o), linkNote(o));

/** One obligation as its own shop sees it: no remarks, UTRs, recorder names or voided entries. */
export function toShopView(o: PmObligation, upi: PmUpiConfig | null): PmShopObligation {
  const last = newestReminder(o);
  return {
    id: o.id,
    crsId: o.crsId,
    month: o.month,
    year: o.year,
    type: o.type,
    typeLabel: typeLabel(o.type),
    title: o.title,
    reference: o.reference,
    duePaise: o.duePaise,
    paidPaise: paidOf(o),
    balancePaise: balanceOf(o),
    status: statusOf(o),
    payments: activePayments(o).map((p) => ({ date: p.date, amountPaise: p.amountPaise, method: p.method })),
    reminder: last ? { id: last.id, at: last.at, ackAt: last.ackAt, ackName: last.ackName } : { id: '', at: '', ackAt: null, ackName: null },
    pendingAck: (o.reminders ?? []).some((r) => !r.ackAt),
    message: reminderMessage(o),
    links: linksFor(o, upi),
  };
}

/** The oldest reminder still waiting for OK — the popup shows the longest-waiting first. */
const oldestWaiting = (o: PmObligation) => [...o.reminders].filter((r) => !r.ackAt).sort(byAt)[0]?.at ?? '';

/** A shop's reminded obligations: waiting ones oldest first; every one newest reminder first. */
export function mineLists(obs: PmObligation[], upi: PmUpiConfig | null): { pending: PmShopObligation[]; all: PmShopObligation[] } {
  const reminded = obs.filter((o) => o.reminders.length > 0);
  const pending = reminded
    .filter((o) => o.reminders.some((r) => !r.ackAt))
    .sort((a, b) => (oldestWaiting(a) < oldestWaiting(b) ? -1 : oldestWaiting(a) > oldestWaiting(b) ? 1 : 0))
    .map((o) => toShopView(o, upi));
  const newest = (o: PmObligation) => newestReminder(o)?.at ?? '';
  const all = [...reminded].sort((a, b) => (newest(a) < newest(b) ? 1 : newest(a) > newest(b) ? -1 : 0)).map((o) => toShopView(o, upi));
  return { pending, all };
}

const TYPE_ORDER = Object.fromEntries(PM_TYPES.map((t, i) => [t.id, i])) as Record<PmType, number>;

/** The administrator's list: newest month first, then shop, then type. */
export const viewOrder = (a: PmObligation, b: PmObligation) =>
  b.year - a.year || b.month - a.month || a.crsId - b.crsId || TYPE_ORDER[a.type] - TYPE_ORDER[b.type] || (a.createdAt < b.createdAt ? -1 : 1);

// ── Validating what the administrator sends ────────────────────────────────

export type Refusal = { status: number; error: string };
const no = (status: number, error: string): Refusal => ({ status, error });

/** A payment as typed: the fields checked, the amount converted. The balance is checked against the stored record. */
export function paymentInput(raw: unknown, today: string): { fields: PmPaymentFields } | Refusal {
  const b = (raw ?? {}) as Record<string, unknown>;
  if (!isIsoDate(b.date)) return no(400, 'Enter the date the money was received.');
  if (b.date > today) return no(400, 'The payment date cannot be after today.');
  const amount = parseRupees(b.amountRupees);
  if (amount === null) return no(400, 'Enter the amount received in rupees, for example 200 or 200.50.');
  if (amount <= 0) return no(400, 'The amount received must be more than ₹0.00.');
  if (!isPayMethod(b.method)) return no(400, 'Choose how it was paid: UPI, Cash or Other.');
  const utr = cleanText(b.utr, UTR_MAX);
  if (utr === null) return no(400, `The UTR / transaction id may be at most ${UTR_MAX} characters.`);
  const remarks = cleanText(b.remarks, REMARKS_MAX);
  if (remarks === null) return no(400, `Remarks may be at most ${REMARKS_MAX} characters.`);
  return { fields: { date: b.date, amountPaise: amount, method: b.method, utr, remarks } };
}

export type NewObligationFields = {
  crsId: number;
  month: number;
  year: number;
  type: PmType;
  title: string;
  reference: string;
  duePaise: number;
  initial: PmPaymentFields | null;
};

export function newObligationInput(raw: unknown, today: string): { fields: NewObligationFields } | Refusal {
  const b = (raw ?? {}) as Record<string, unknown>;
  const crsId = Number(b.crsId);
  if (!validCrs(crsId)) return no(400, 'Choose a CRS shop.');
  const month = Number(b.month);
  if (!validMonth(month)) return no(400, 'Choose a month.');
  const year = Number(b.year);
  if (!validYear(year)) return no(400, 'Choose a year between 2020 and 2100.');
  if (!isPmType(b.type)) return no(400, 'Choose a payment type.');
  const type = b.type;
  let title = '';
  if (type === 'other') {
    const t = cleanText(b.title, TITLE_MAX);
    if (t === null) return no(400, `The title may be at most ${TITLE_MAX} characters.`);
    if (!t) return no(400, 'Say what the Other payment is for (the title).');
    title = t;
  }
  const reference = cleanText(b.reference, REFERENCE_MAX);
  if (reference === null) return no(400, `The reference may be at most ${REFERENCE_MAX} characters.`);
  const due = parseRupees(b.dueRupees);
  if (due === null) return no(400, 'Enter the total amount due in rupees, for example 350 or 350.50.');
  if (due <= 0) return no(400, 'The amount due must be more than ₹0.00.');
  let initial: PmPaymentFields | null = null;
  if (b.initialPayment && typeof b.initialPayment === 'object') {
    const p = paymentInput(b.initialPayment, today);
    if ('error' in p) return no(p.status, `Amount already paid — ${p.error}`);
    if (p.fields.amountPaise > due) return no(409, `The amount already paid cannot be more than the ${formatRupees(due)} due.`);
    initial = p.fields;
  }
  return { fields: { crsId, month, year, type, title, reference, duePaise: due, initial } };
}

/** The parts a type covers: ['monthly', 'pv'] for "Monthly + PV". 'Other' covers none. */
export const partsOf = (t: PmType): readonly PmPart[] => PM_TYPES.find((x) => x.id === t)?.parts ?? [];
const PART_LABEL: Record<PmPart, string> = { monthly: 'Monthly Statement', pv: 'PV Statement', prev_balance: 'Previous Month Balance' };

/**
 * An obligation of the same shop and month that already covers one of this
 * type's parts — a second record would bill it twice — or null.
 */
export function overlapOf<T extends Pick<PmObligation, 'crsId' | 'month' | 'year' | 'type'>>(existing: T[], o: Pick<PmObligation, 'crsId' | 'month' | 'year' | 'type'>): T | null {
  const mine = partsOf(o.type);
  if (!mine.length) return null;
  return existing.find((x) => x.crsId === o.crsId && x.month === o.month && x.year === o.year && partsOf(x.type).some((p) => mine.includes(p))) ?? null;
}

/** "CRS 1, October 2026 already has a Monthly Statement, which also covers the Monthly Statement — …" */
export function overlapSentence(o: Pick<PmObligation, 'crsId' | 'month' | 'year' | 'type'>, x: Pick<PmObligation, 'type'>): string {
  if (x.type === o.type) return duplicateSentence(o);
  const shared = partsOf(o.type).filter((p) => partsOf(x.type).includes(p)).map((p) => PART_LABEL[p]).join(' and ');
  return `CRS ${o.crsId}, ${monthText(o.year, o.month)} already has a ${typeLabel(x.type)}, which also covers the ${shared} — edit that one, or delete it first if it has no payments.`;
}

/** "A PV Statement for CRS 1, October 2026 already exists — edit that one." */
export const duplicateSentence = (o: Pick<PmObligation, 'crsId' | 'month' | 'year' | 'type'>) =>
  `A ${typeLabel(o.type)} for CRS ${o.crsId}, ${monthText(o.year, o.month)} already exists — edit that one.`;

/** "CRS 1's October 2026 PV Statement is fully paid." */
export const fullyPaidSentence = (o: Pick<PmObligation, 'crsId' | 'month' | 'year' | 'type' | 'title'>) =>
  `CRS ${o.crsId}'s ${monthText(o.year, o.month)} ${whatOf(o)} is fully paid.`;

export const overBalanceSentence = (balancePaise: number) => `That is more than the outstanding ${formatRupees(balancePaise)}.`;

export const dueBelowPaidSentence = (paidPaise: number) => `${formatRupees(paidPaise)} has already been received; the amount due cannot be less.`;

// ── Files ───────────────────────────────────────────────────────────────────

/** The file types kept, by what their bytes say; the extension each is stored under. */
export const EXT: Record<string, string> = {
  'image/png': 'png',
  'image/jpeg': 'jpg',
  'image/webp': 'webp',
  'audio/mpeg': 'mp3',
  'audio/wav': 'wav',
  'audio/ogg': 'ogg',
  'audio/mp4': 'm4a',
  'audio/aac': 'aac',
  'audio/webm': 'webm',
};

/** Where an asset's file is in the bucket: `qr/<id>.png`, `sound/<id>.mp3`. */
export const assetPath = (a: Pick<PmAsset, 'id' | 'kind' | 'mime'>) => `${a.kind}/${a.id}.${EXT[a.mime] ?? 'bin'}`;

const at = (b: Uint8Array, offset: number, text: string) => {
  if (b.length < offset + text.length) return false;
  for (let i = 0; i < text.length; i++) if (b[offset + i] !== text.charCodeAt(i)) return false;
  return true;
};

/**
 * What the file IS, from its first bytes — never from its name or the type the
 * browser claims. Anything else (SVG and HTML above all: they would be served
 * from our own address and could run script) is not kept.
 */
export function sniffMedia(b: Uint8Array): { mime: string; kind: 'qr' | 'sound' } | null {
  if (b.length < 4) return null;
  if (b[0] === 0x89 && at(b, 1, 'PNG\r\n\u001a\n')) return { mime: 'image/png', kind: 'qr' };
  if (b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff) return { mime: 'image/jpeg', kind: 'qr' };
  if (at(b, 0, 'RIFF') && at(b, 8, 'WEBP')) return { mime: 'image/webp', kind: 'qr' };
  if (at(b, 0, 'RIFF') && at(b, 8, 'WAVE')) return { mime: 'audio/wav', kind: 'sound' };
  if (at(b, 0, 'OggS')) return { mime: 'audio/ogg', kind: 'sound' };
  if (at(b, 0, 'ID3')) return { mime: 'audio/mpeg', kind: 'sound' };
  if (at(b, 4, 'ftyp')) return { mime: 'audio/mp4', kind: 'sound' };
  if (b[0] === 0x1a && b[1] === 0x45 && b[2] === 0xdf && b[3] === 0xa3) return { mime: 'audio/webm', kind: 'sound' };
  // Frame sync: AAC in ADTS has layer bits 00 (FF F1 / FF F9); MPEG audio has a layer.
  if (b[0] === 0xff && (b[1] & 0xf6) === 0xf0) return { mime: 'audio/aac', kind: 'sound' };
  if (b[0] === 0xff && (b[1] & 0xe0) === 0xe0 && (b[1] & 0x06) !== 0) return { mime: 'audio/mpeg', kind: 'sound' };
  return null;
}

/** Is this file one we keep for that use? The type it is stored as, or why not. */
export function mediaCheck(kind: 'qr' | 'sound', bytes: Uint8Array): { mime: string } | Refusal {
  if (!bytes.length) return no(400, 'The file is empty.');
  // Rounded up, so a file just over the limit never reads as "4.0 MB".
  if (bytes.length > MAX_MEDIA_BYTES) return no(413, `The file is ${(Math.ceil(bytes.length / 104857.6) / 10).toFixed(1)} MB — larger than the ${MAX_MEDIA_BYTES / 1048576} MB a file may be.`);
  const s = sniffMedia(bytes);
  if (kind === 'qr' && s?.kind !== 'qr') return no(400, 'Upload the QR code as a PNG, JPEG or WEBP image.');
  if (kind === 'sound' && s?.kind !== 'sound') return no(400, 'Upload the sound as an MP3, WAV, OGG or M4A file.');
  return { mime: s!.mime };
}

/** May this person fetch this file? Administrators: any. A shop: only the current QR and the active sound. */
export function canFetchAsset(media: PmMedia, assetId: string, admin: boolean): PmAsset | null {
  const all = [...(media.qr ? [media.qr] : []), ...media.sounds];
  const a = all.find((x) => x.id === assetId) ?? null;
  if (!a || admin) return a;
  if (media.qr?.id === assetId) return a;
  if (media.activeSoundId === assetId) return a;
  return null;
}

// ── The activity log ────────────────────────────────────────────────────────
// A shop's dashboard shows the SUMMARY of its own rows, so a UTR, remarks, a
// method or a void reason only ever goes in `changes`.

export const PM_MODULE = 'Payment Management';

const obDraft = (o: PmObligation, action: ActivityDraft['action'], summary: string, changes: Change[]): ActivityDraft => ({
  crsId: o.crsId,
  module: PM_MODULE,
  action,
  source: 'user',
  entryMonth: o.month,
  entryYear: o.year,
  recordKey: obKey(o.id),
  relatedId: o.id,
  summary: summary.slice(0, 500),
  changes,
});

const balanceNote = (o: PmObligation) => `(balance ${formatRupees(balanceOf(o))})`;

const paymentChanges = (before: PmPaymentFields | null, after: PmPaymentFields | null): Change[] => {
  const rows: [string, (p: PmPaymentFields) => string][] = [
    ['Payment date', (p) => p.date.split('-').reverse().join('-')],
    ['Amount', (p) => formatRupees(p.amountPaise)],
    ['Method', (p) => PAY_METHODS.find((m) => m.id === p.method)?.label ?? p.method],
    ['UTR', (p) => p.utr || '—'],
    ['Remarks', (p) => p.remarks || '—'],
  ];
  const out: Change[] = [];
  for (const [label, get] of rows) {
    const x = before ? get(before) : '';
    const y = after ? get(after) : '';
    if (x !== y) out.push({ label, before: x, after: y });
  }
  return out;
};

export function createdDraft(o: PmObligation): ActivityDraft {
  const changes: Change[] = [
    { label: 'Payment type', before: '', after: whatOf(o) },
    { label: 'Amount due', before: '', after: formatRupees(o.duePaise) },
  ];
  if (o.reference) changes.push({ label: 'Reference', before: '', after: o.reference });
  return obDraft(o, 'created', `Payment due ${formatRupees(o.duePaise)} entered — ${describe(o)}`, changes);
}

export function updatedDraft(before: PmObligation, after: PmObligation): ActivityDraft | null {
  const changes: Change[] = [];
  if (before.duePaise !== after.duePaise) changes.push({ label: 'Amount due', before: formatRupees(before.duePaise), after: formatRupees(after.duePaise) });
  if (before.reference !== after.reference) changes.push({ label: 'Reference', before: before.reference || '—', after: after.reference || '—' });
  if (before.title !== after.title) changes.push({ label: 'Title', before: before.title || '—', after: after.title || '—' });
  if (!changes.length) return null;
  return obDraft(after, 'updated', `Payment details changed — ${describe(after)}: due ${formatRupees(after.duePaise)} ${balanceNote(after)}`, changes);
}

export function deletedDraft(o: PmObligation): ActivityDraft {
  return obDraft(o, 'deleted', `Payment due ${formatRupees(o.duePaise)} deleted — ${describe(o)}`, [
    { label: 'Payment type', before: whatOf(o), after: '' },
    { label: 'Amount due', before: formatRupees(o.duePaise), after: '' },
  ]);
}

/** "Payment ₹200.00 recorded — CRS 1 October 2026 PV Statement (balance ₹150.00)" */
export function paymentRecordedDraft(o: PmObligation, p: PmPaymentFields): ActivityDraft {
  return obDraft(o, 'created', `Payment ${formatRupees(p.amountPaise)} recorded — ${describe(o)} ${balanceNote(o)}`, paymentChanges(null, p));
}

export function paymentCorrectedDraft(o: PmObligation, before: PmPaymentFields, after: PmPaymentFields): ActivityDraft {
  const amount = before.amountPaise === after.amountPaise ? formatRupees(after.amountPaise) : `${formatRupees(before.amountPaise)} → ${formatRupees(after.amountPaise)}`;
  return obDraft(o, 'updated', `Payment ${amount} corrected — ${describe(o)} ${balanceNote(o)}`, paymentChanges(before, after));
}

export function paymentVoidedDraft(o: PmObligation, p: PmPaymentFields, reason: string): ActivityDraft {
  return obDraft(o, 'updated', `Payment ${formatRupees(p.amountPaise)} voided — ${describe(o)} ${balanceNote(o)}`, [
    { label: 'Payment', before: `${formatRupees(p.amountPaise)} on ${p.date.split('-').reverse().join('-')}`, after: 'Voided' },
    { label: 'Reason', before: '', after: reason },
  ]);
}

export function reminderSentDraft(o: PmObligation, r: PmReminder): ActivityDraft {
  return obDraft(o, 'sent', `Payment reminder sent — ${describe(o)}, balance ${formatRupees(r.balancePaise)} (${r.recipients} staff)`, [
    { label: 'Amount due', before: '', after: formatRupees(r.duePaise) },
    { label: 'Amount paid', before: '', after: formatRupees(r.paidPaise) },
    { label: 'Outstanding balance', before: '', after: formatRupees(r.balancePaise) },
    { label: 'Recipients', before: '', after: String(r.recipients) },
  ]);
}

export function acknowledgedDraft(o: PmObligation, count: number): ActivityDraft {
  return obDraft(o, 'acknowledged', `Payment reminder acknowledged — ${describe(o)} ${balanceNote(o)}`, [
    { label: 'Reminders acknowledged', before: '', after: String(count) },
  ]);
}

const settingsDraft = (action: ActivityDraft['action'], summary: string, changes: Change[]): ActivityDraft => ({
  crsId: null,
  module: PM_MODULE,
  action,
  source: 'user',
  recordKey: MEDIA_KEY,
  summary: summary.slice(0, 500),
  changes,
});

export function upiDraft(before: PmUpiConfig | null, after: PmUpiConfig): ActivityDraft | null {
  const changes: Change[] = [];
  if ((before?.vpa ?? '') !== after.vpa) changes.push({ label: 'UPI ID', before: before?.vpa || '—', after: after.vpa || '—' });
  if ((before?.payeeName ?? '') !== after.payeeName) changes.push({ label: 'Payee name', before: before?.payeeName || '—', after: after.payeeName || '—' });
  if (!changes.length) return null;
  return { ...settingsDraft('updated', 'Office UPI ID for payments changed', changes), recordKey: 'payment_settings:upi' };
}

export function mediaDraft(what: 'qr-uploaded' | 'qr-replaced' | 'qr-removed' | 'sound-uploaded' | 'sound-removed' | 'sound-active', asset: PmAsset | null, before: PmAsset | null = null): ActivityDraft {
  const name = asset?.name || '—';
  switch (what) {
    case 'qr-uploaded':
      return settingsDraft('created', `Official UPI QR uploaded: ${name}`, [{ label: 'QR image', before: '—', after: name }]);
    case 'qr-replaced':
      return settingsDraft('updated', `Official UPI QR replaced: ${name}`, [{ label: 'QR image', before: before?.name || '—', after: name }]);
    case 'qr-removed':
      return settingsDraft('deleted', `Official UPI QR removed: ${name}`, [{ label: 'QR image', before: name, after: '—' }]);
    case 'sound-uploaded':
      return settingsDraft('created', `Reminder sound uploaded: ${name}`, [{ label: 'Reminder sound', before: '', after: name }]);
    case 'sound-removed':
      return settingsDraft('deleted', `Reminder sound removed: ${name}`, [{ label: 'Reminder sound', before: name, after: '' }]);
    default:
      return settingsDraft('updated', `Active reminder sound: ${asset ? name : 'none (a beep)'}`, [
        { label: 'Active reminder sound', before: before?.name || 'Beep', after: asset ? name : 'Beep' },
      ]);
  }
}

/**
 * One `Range: bytes=a-b` (or `bytes=a-`, `bytes=-n`) → [start, end] inclusive;
 * null to send the whole file (no header, or one this does not read, such as
 * several ranges); 'unsatisfiable' for a range past the end.
 */
export function byteRange(h: string | null, size: number): [number, number] | null | 'unsatisfiable' {
  const m = /^bytes=(\d*)-(\d*)$/.exec((h ?? '').trim());
  if (!m || (m[1] === '' && m[2] === '')) return null;
  if (m[1] === '') {
    const n = Number(m[2]);
    if (n === 0) return 'unsatisfiable';
    return [Math.max(0, size - n), size - 1];
  }
  const start = Number(m[1]);
  const end = m[2] === '' ? size - 1 : Math.min(Number(m[2]), size - 1);
  if (start >= size || end < start) return 'unsatisfiable';
  return [start, end];
}
