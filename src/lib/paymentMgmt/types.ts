/**
 * Payment Management (office, 2026-10-16) — the shared contract between the
 * server (src/lib/paymentMgmt/server.ts, /api/payment-management/**), the
 * administrator's Payment Management tabs on /payments and the shop's reminder
 * (PaymentReminderPopup, and its Payment Reminders section on /payments).
 *
 * An OBLIGATION is what one shop owes for one month and one kind of payment:
 * a Monthly Statement, a PV Statement, a Previous Month Balance, or Other.
 * The administrator sets the amount due; payments are added as entries (never
 * overwritten); the balance is always worked out, never stored. A REMINDER is
 * an event on an obligation: sent to that shop's own staff, acknowledged when
 * one of them presses OK. Acknowledging changes no money.
 *
 * Money is integer PAISE everywhere. Rupee text typed by the administrator is
 * converted on the server (parseRupees in core.ts).
 */

export type PmType = 'monthly' | 'pv' | 'prev_balance' | 'monthly_pv' | 'monthly_prev' | 'pv_prev' | 'monthly_pv_prev' | 'other';

/** The three things a shop can owe for a month; a combined type is several of them under ONE amount. */
export type PmPart = 'monthly' | 'pv' | 'prev_balance';

/**
 * The types in the order the screens list them. A combined type (office,
 * 2026-10-17: "Monthly + PV …") is ONE record with ONE amount due — its parts
 * are not tracked apart — so a shop-month may hold a part only once: a
 * Monthly Statement and a "Monthly + PV" for the same month would bill the
 * Monthly twice.
 */
export const PM_TYPES: readonly { id: PmType; label: string; code: string; parts: readonly PmPart[] }[] = [
  { id: 'monthly', label: 'Monthly Statement', code: 'MS', parts: ['monthly'] },
  { id: 'pv', label: 'PV Statement', code: 'PV', parts: ['pv'] },
  { id: 'prev_balance', label: 'Previous Month Balance', code: 'PB', parts: ['prev_balance'] },
  { id: 'monthly_pv', label: 'Monthly + PV Statement', code: 'MSPV', parts: ['monthly', 'pv'] },
  { id: 'monthly_prev', label: 'Monthly Statement + Previous Month Balance', code: 'MSPB', parts: ['monthly', 'prev_balance'] },
  { id: 'pv_prev', label: 'PV Statement + Previous Month Balance', code: 'PVPB', parts: ['pv', 'prev_balance'] },
  { id: 'monthly_pv_prev', label: 'Monthly + PV Statement + Previous Month Balance', code: 'MSPVPB', parts: ['monthly', 'pv', 'prev_balance'] },
  { id: 'other', label: 'Other', code: 'OT', parts: [] },
];

export type PayMethod = 'upi' | 'cash' | 'other';

export const PAY_METHODS: readonly { id: PayMethod; label: string }[] = [
  { id: 'upi', label: 'UPI' },
  { id: 'cash', label: 'Cash' },
  { id: 'other', label: 'Other' },
];

/** unpaid: nothing received; partial: some received, some outstanding; paid: balance 0. */
export type PmStatus = 'unpaid' | 'partial' | 'paid';

/** The obligation's reminder state: none sent, the latest still waiting for OK, or acknowledged. */
export type ReminderStatus = 'none' | 'sent' | 'acknowledged';

/** Who did something, as recorded on the record (a shop's BC and Packer can share a username). */
export type PmActor = { by: number | null; byName: string };

export type PmPaymentFields = {
  /** ISO YYYY-MM-DD — the date the money was received. */
  date: string;
  amountPaise: number;
  method: PayMethod;
  /** UPI transaction id / UTR; '' when not applicable. */
  utr: string;
  remarks: string;
};

export type PmPayment = PmPaymentFields & PmActor & {
  id: string;
  /** When it was recorded (ISO timestamp). */
  at: string;
  /** Each correction keeps what it replaced: the history is never overwritten. */
  edits: (PmActor & { at: string; before: PmPaymentFields })[];
  /** A payment entered in error is voided (kept, with the reason), never deleted. */
  voided: (PmActor & { at: string; reason: string }) | null;
};

export type PmReminder = PmActor & {
  id: string;
  /** When it was sent (ISO timestamp). */
  at: string;
  /** The figures at the moment it was sent. */
  duePaise: number;
  paidPaise: number;
  balancePaise: number;
  /** The notification it was delivered as. Without the notifications tables no reminder is sent at all (503); null only if the database returned no id. */
  notificationId: number | null;
  /** How many of the shop's staff it reached. */
  recipients: number;
  ackAt: string | null;
  ackBy: number | null;
  ackName: string | null;
};

export type PmObligation = {
  /** e.g. '1-2026-10-pv'; 'other' obligations carry a suffix: '1-2026-10-other-k3x9'. */
  id: string;
  crsId: number;
  month: number;
  year: number;
  type: PmType;
  /** What an 'Other' obligation is for (required for 'other', '' otherwise). */
  title: string;
  /** Statement / report reference, where the office has one. */
  reference: string;
  duePaise: number;
  payments: PmPayment[];
  reminders: PmReminder[];
  createdAt: string;
  createdBy: number | null;
  createdByName: string;
  updatedAt: string;
  updatedBy: number | null;
  updatedByName: string;
};

/** An obligation as the administrator's screen receives it: the record plus its worked-out figures. */
export type PmView = PmObligation & {
  typeLabel: string;
  shopName: string;
  /** Sum of the payments that are not voided. */
  paidPaise: number;
  /** duePaise − paidPaise (never below 0: a payment above the balance is refused). */
  balancePaise: number;
  status: PmStatus;
  reminderStatus: ReminderStatus;
  lastReminderAt: string | null;
  version: number;
};

export type PmAsset = PmActor & {
  id: string;
  kind: 'qr' | 'sound';
  name: string;
  mime: string;
  size: number;
  at: string;
};

export type PmMedia = {
  /** The office's official UPI QR image, uploaded by an administrator (none until then). */
  qr: PmAsset | null;
  /** Uploaded reminder sounds; one of them may be active. */
  sounds: PmAsset[];
  activeSoundId: string | null;
};

/** The office's UPI details — the same payment_settings row the paid downloads use. */
export type PmUpiConfig = { vpa: string; payeeName: string };

/** UPI payment links for one amount, built on the server from the configured UPI details. */
export type PmUpiLinks = {
  /** Generic intent, any UPI app: upi://pay?... */
  upi: string;
  /** Google Pay: tez://upi/pay?... */
  gpay: string;
  /** PhonePe: phonepe://pay?... */
  phonepe: string;
  /** Paytm: paytmmp://pay?... */
  paytm: string;
  amountPaise: number;
  /** tr= — e.g. 'CRS1-PV-102026'. */
  reference: string;
  /** tn= — e.g. 'CRS 1 PV Statement Oct 2026'. */
  note: string;
};

/** One obligation as its own shop sees it — no admin remarks, UTRs or other shops. */
export type PmShopObligation = {
  id: string;
  crsId: number;
  month: number;
  year: number;
  type: PmType;
  typeLabel: string;
  title: string;
  reference: string;
  duePaise: number;
  paidPaise: number;
  balancePaise: number;
  status: PmStatus;
  /** Payments received (date, amount, method only). */
  payments: { date: string; amountPaise: number; method: PayMethod }[];
  /** The newest reminder sent for it. */
  reminder: { id: string; at: string; ackAt: string | null; ackName: string | null };
  /** Whether a reminder for it is still waiting for OK (any reminder with ackAt null). */
  pendingAck: boolean;
  /** The line the reminder screen shows, e.g. 'Your payment balance for the October 2026 PV statement is ₹350. …' */
  message: string;
  /** Links for the CURRENT balance; null when it is paid or no UPI ID is configured. */
  links: PmUpiLinks | null;
};

/** GET /api/payment-management/mine — a shop user's own reminders. */
export type PmMine = {
  crsId: number;
  shopName: string;
  /** Obligations with a reminder still waiting for OK, oldest reminder first: the popup shows these. */
  pending: PmShopObligation[];
  /** Every obligation of this shop that was ever reminded, newest reminder first (the Payment Reminders section on /payments). */
  all: PmShopObligation[];
  upi: PmUpiConfig | null;
  /** /api/payment-management/media/<id> of the official QR, or null. */
  qrUrl: string | null;
  /** /api/payment-management/media/<id> of the active reminder sound, or null (a plain beep then). */
  soundUrl: string | null;
};

/** GET /api/payment-management/settings — administrators. */
export type PmSettings = {
  upi: PmUpiConfig | null;
  media: PmMedia;
  /** Links for a ₹1.00 test payment, to try the buttons; null without a UPI ID. */
  sampleLinks: PmUpiLinks | null;
};
