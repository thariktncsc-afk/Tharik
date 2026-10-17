/**
 * Payment Management — the administrator's screen's own working-out
 * (office, 2026-10-16). Display and form rules only.
 *
 * The server decides every figure that matters: due, paid, balance, status
 * and who may do what all come back in PmView. What is worked out here is
 * for showing (the filter, the summary) and for warning BEFORE sending —
 * the server refuses the same things again, in its own words.
 */
import { PAY_METHODS, PM_TYPES, type PayMethod, type PmShopObligation, type PmStatus, type PmType, type PmUpiConfig, type PmView } from '@/lib/paymentMgmt/types';
import { MAX_MEDIA_BYTES, overlapOf, parseRupees, toShopView, typeLabel as coreTypeLabel, whatOf } from '@/lib/paymentMgmt/core';
import { dmyTime } from '@/lib/dateFormat';

export const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];

export const monthName = (m: number) => MONTHS[m - 1] ?? '';
export const monthYear = (m: number, y: number) => `${monthName(m)} ${y}`;

/** Today as the office's calendar has it (IST), ISO — never toISOString(), which is UTC. */
export const todayIst = () => new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Kolkata' }).format(new Date());

/** The month the screen opens on: this month, in IST. */
export function currentMonth(): { month: number; year: number } {
  const [y, m] = todayIst().split('-').map(Number);
  return { month: m, year: y };
}

/**
 * Rupee text as typed → paise, or null when it is not an amount: the
 * server's own parseRupees (core.ts), so a figure this accepts is one the
 * server accepts. No floats: '0.1' is 10 paise.
 */
export const toPaise = (text: string): number | null => parseRupees(text);

/** Paise → the rupee text a form box starts with: 35000 → '350', 20050 → '200.50'. */
export function toRupeeText(paise: number): string {
  return paise % 100 === 0 ? String(paise / 100) : (paise / 100).toFixed(2);
}

export const typeLabel = coreTypeLabel;
export const methodLabel = (m: PayMethod) => PAY_METHODS.find((x) => x.id === m)?.label ?? m;

/** What a record is for: 'PV Statement', or an Other record's own title. */
export const whatFor = (o: { type: PmType; title: string }) => whatOf(o);

export const STATUS_LABEL: Record<PmStatus, string> = { unpaid: 'Unpaid', partial: 'Partly paid', paid: 'Paid' };

export const STATUS_TONE: Record<PmStatus, { bg: string; fg: string; border: string }> = {
  unpaid: { bg: '#FEE2E2', fg: '#B91C1C', border: '#FECACA' },
  partial: { bg: '#FEF3C7', fg: '#92400E', border: '#FDE68A' },
  paid: { bg: '#DCFCE7', fg: '#15803D', border: '#86EFAC' },
};

// ── Filter ──────────────────────────────────────────────────────────────────

/** 0 / '' = All. */
export type Filters = { crsId: number; month: number; year: number; type: PmType | ''; status: PmStatus | '' };

const TYPE_ORDER = PM_TYPES.map((t) => t.id);

export function applyFilters(list: PmView[], f: Filters): PmView[] {
  return list
    .filter(
      (o) =>
        (!f.crsId || o.crsId === f.crsId) &&
        (!f.month || o.month === f.month) &&
        (!f.year || o.year === f.year) &&
        (!f.type || o.type === f.type) &&
        (!f.status || o.status === f.status),
    )
    .sort((a, b) => b.year - a.year || b.month - a.month || a.crsId - b.crsId || TYPE_ORDER.indexOf(a.type) - TYPE_ORDER.indexOf(b.type) || a.id.localeCompare(b.id));
}

/** Another Monthly / PV / Previous Balance record for that shop and month, which the server would refuse. */
/** A record of that shop-month already covering one of this type's parts (the server refuses the same). */
export function duplicateOf(list: PmView[], crsId: number, month: number, year: number, type: PmType): PmView | null {
  return overlapOf(list, { crsId, month, year, type });
}

// ── Summary ─────────────────────────────────────────────────────────────────

export type LatestPayment = { ob: PmView; id: string; date: string; at: string; amountPaise: number; method: PayMethod; utr: string; byName: string };

export type Summary = {
  records: number;
  duePaise: number;
  paidPaise: number;
  balancePaise: number;
  shops: { paid: number; partial: number; unpaid: number };
  remindersSent: number;
  remindersAcknowledged: number;
  latest: LatestPayment[];
};

/**
 * The figures for whatever the filter shows. A SHOP counts once, by all its
 * records in the filter: every one paid → fully paid; something outstanding
 * with something received → partly paid; nothing received → unpaid.
 */
export function summarise(list: PmView[]): Summary {
  const s: Summary = { records: list.length, duePaise: 0, paidPaise: 0, balancePaise: 0, shops: { paid: 0, partial: 0, unpaid: 0 }, remindersSent: 0, remindersAcknowledged: 0, latest: [] };
  const byShop = new Map<number, { allPaid: boolean; paid: number }>();
  const pays: LatestPayment[] = [];
  for (const o of list) {
    s.duePaise += o.duePaise;
    s.paidPaise += o.paidPaise;
    s.balancePaise += o.balancePaise;
    s.remindersSent += o.reminders.length;
    s.remindersAcknowledged += o.reminders.filter((r) => r.ackAt).length;
    const shop = byShop.get(o.crsId) ?? { allPaid: true, paid: 0 };
    shop.allPaid = shop.allPaid && o.status === 'paid';
    shop.paid += o.paidPaise;
    byShop.set(o.crsId, shop);
    for (const p of o.payments) {
      if (p.voided) continue;
      pays.push({ ob: o, id: p.id, date: p.date, at: p.at, amountPaise: p.amountPaise, method: p.method, utr: p.utr, byName: p.byName });
    }
  }
  for (const shop of byShop.values()) {
    if (shop.allPaid) s.shops.paid++;
    else if (shop.paid > 0) s.shops.partial++;
    else s.shops.unpaid++;
  }
  // Latest by the date the money came in, then by when it was entered.
  s.latest = pays.sort((a, b) => b.date.localeCompare(a.date) || b.at.localeCompare(a.at)).slice(0, 10);
  return s;
}

// ── Reminder column ─────────────────────────────────────────────────────────

export const newestReminder = (o: PmView) => [...o.reminders].sort((a, b) => b.at.localeCompare(a.at))[0] ?? null;

/** 'Not sent' / 'Sent 16-10-2026, 10:35 am' / 'Acknowledged 16-10-2026, 10:41 am by Anand'. */
export function reminderLine(o: PmView): { text: string; tone: 'none' | 'sent' | 'ack' } {
  const r = newestReminder(o);
  if (!r || o.reminderStatus === 'none') return { text: 'Not sent', tone: 'none' };
  if (o.reminderStatus === 'sent' || !r.ackAt) return { text: `Sent ${dmyTime(r.at)}`, tone: 'sent' };
  return { text: `Acknowledged ${dmyTime(r.ackAt)}${r.ackName ? ` by ${r.ackName}` : ''}`, tone: 'ack' };
}

// ── "Preview what the shop sees" ───────────────────────────────────────────

/**
 * A row as its own shop receives it — the server's own toShopView (core.ts),
 * so the preview cannot word it differently from /mine. A row not reminded
 * yet is shown as if the reminder went out now.
 */
export function shopViewOf(o: PmView, upi: PmUpiConfig | null): PmShopObligation {
  const v = toShopView(o, upi);
  return o.reminders.length ? v : { ...v, reminder: { id: 'preview', at: new Date().toISOString(), ackAt: null, ackName: null }, pendingAck: true };
}

/** 1234567 bytes → '1.2 MB'. */
export function sizeText(bytes: number): string {
  if (bytes >= 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  if (bytes >= 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${bytes} bytes`;
}

/** What one upload may weigh: the server's own limit (Vercel takes 4.5 MB at most). */
export const MAX_UPLOAD_BYTES = MAX_MEDIA_BYTES;
