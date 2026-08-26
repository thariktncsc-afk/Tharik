'use client';

/**
 * Browser side of the payment flow: types and thin fetch wrappers.
 *
 * Everything here is for presentation. No decision made in this file is
 * trusted by the server — /api/statements/render re-runs the entitlement check
 * on every request, so a page that got its state wrong shows the wrong buttons
 * but cannot hand out an unpaid statement.
 */
import type { PaymentSettings } from './pricing';

export type Section = {
  id: string;
  label: string;
  icon: string;
  desc: string;
  copies: number;
  color: string;
  availableFor: string;
};

export type Access = {
  /** No charge applies: an admin, or charging is switched off. */
  free: boolean;
  charging: boolean;
  isAdmin: boolean;
  settings: PaymentSettings;
  sections: Section[];
  avail: Record<string, boolean | number>;
  paidSections: string[];
  dssPaid: boolean;
};

export type Order = {
  id: number;
  orderNo: string;
  userId: number;
  username: string;
  fullName: string;
  crsId: number;
  kind: 'statement' | 'dss';
  month: number;
  year: number;
  sectionIds: string[];
  sheetCount: number;
  dayCount: number;
  basePaise: number;
  gstPaise: number;
  totalPaise: number;
  gstRateBp: number;
  gstInclusive: boolean;
  status: 'pending' | 'awaiting_approval' | 'approved' | 'rejected';
  utr: string;
  rejectReason: string;
  createdAt: string;
  submittedAt: string | null;
  decidedAt: string | null;
  decidedByName: string;
};

export type Upi = { uri: string; qr: string; vpa: string; payeeName: string };

export type RenderedSection = { id: string; label: string; copies: number; html: string };
export type Rendered = { css: string; period: { mo: string; yr: number }; free: boolean; sections: RenderedSection[] };

/** Non-2xx responses carry `{ error }`; `unpaid` lists the sheets still owing. */
export class ApiError extends Error {
  status: number;
  unpaid: string[];
  constructor(status: number, message: string, unpaid: string[] = []) {
    super(message);
    this.status = status;
    this.unpaid = unpaid;
  }
}

async function json<T>(res: Response): Promise<T> {
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw new ApiError(res.status, body?.error ?? `Server returned ${res.status}`, body?.unpaid ?? []);
  return body as T;
}

export async function fetchAccess(crsId: number, month: number, year: number): Promise<Access> {
  return json<Access>(
    await fetch(`/api/payments/access?crsId=${crsId}&month=${month}&year=${year}`, { headers: { Accept: 'application/json' } }),
  );
}

/**
 * One order plus a freshly-built payment intent, so a half-finished order can
 * be reopened later and still show its QR.
 */
export async function fetchOrder(id: number): Promise<{ order: Order; upi: Upi | null }> {
  return json(await fetch(`/api/payments/${id}`, { headers: { Accept: 'application/json' } }));
}

export async function fetchOrders(status?: string): Promise<Order[]> {
  const q = status && status !== 'all' ? `?status=${encodeURIComponent(status)}` : '';
  const body = await json<{ orders: Order[] }>(await fetch(`/api/payments${q}`, { headers: { Accept: 'application/json' } }));
  return body.orders;
}

export async function createOrder(input: {
  kind: 'statement' | 'dss';
  month: number;
  year: number;
  sectionIds?: string[];
}): Promise<{ order: Order; upi: Upi }> {
  return json(
    await fetch('/api/payments', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(input),
    }),
  );
}

export async function submitUtr(id: number, utr: string): Promise<Order> {
  const body = await json<{ order: Order }>(
    await fetch(`/api/payments/${id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'submit', utr }),
    }),
  );
  return body.order;
}

export async function decideOrder(id: number, action: 'approve' | 'reject', reason?: string): Promise<Order> {
  const body = await json<{ order: Order }>(
    await fetch(`/api/payments/${id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action, reason }),
    }),
  );
  return body.order;
}

export async function renderStatements(input: {
  crsId: number;
  month: number;
  year: number;
  sectionIds: string[];
}): Promise<Rendered> {
  return json<Rendered>(
    await fetch('/api/statements/render', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(input),
    }),
  );
}

export async function saveSettings(s: PaymentSettings): Promise<PaymentSettings> {
  const body = await json<{ settings: PaymentSettings }>(
    await fetch('/api/payments/settings', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(s),
    }),
  );
  return body.settings;
}

export const STATUS_LABEL: Record<Order['status'], string> = {
  pending: 'Awaiting payment',
  awaiting_approval: 'Awaiting admin approval',
  approved: 'Approved',
  rejected: 'Rejected',
};

export const STATUS_COLOR: Record<Order['status'], { bg: string; fg: string; border: string }> = {
  pending: { bg: '#FEF3C7', fg: '#92400E', border: '#FDE68A' },
  awaiting_approval: { bg: '#DBEAFE', fg: '#1E40AF', border: '#BFDBFE' },
  approved: { bg: '#DCFCE7', fg: '#15803D', border: '#86EFAC' },
  rejected: { bg: '#FEE2E2', fg: '#B91C1C', border: '#FECACA' },
};
