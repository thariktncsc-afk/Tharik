'use client';
/**
 * Payment Management — the browser's calls. Every route answers JSON
 * `{ ...body }` on success and `{ error: '<a plain sentence>' }` with a 4xx /
 * 5xx status otherwise; `call()` turns the latter into a PmApiError carrying
 * that sentence, so a screen can show it as it is.
 *
 * Amounts go to the server as RUPEE TEXT exactly as typed ('350', '200.50');
 * the server converts and validates (core.ts parseRupees). Amounts come back
 * in PAISE.
 */
import type { PayMethod, PmMedia, PmMine, PmReminder, PmSettings, PmType, PmUpiConfig, PmView } from './types';

export class PmApiError extends Error {
  constructor(message: string, readonly status: number) {
    super(message);
  }
}

const BASE = '/api/payment-management';

async function call<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(BASE + path, { cache: 'no-store', ...init });
  const body = (await res.json().catch(() => ({}))) as { error?: string } & T;
  if (!res.ok) throw new PmApiError(body.error || 'Something went wrong. Please try again.', res.status);
  return body;
}

const json = (method: string, data: unknown): RequestInit => ({
  method,
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify(data),
});

// ── Administrators ──────────────────────────────────────────────────────────

/** Every obligation of every shop (the screen filters by shop, month, year, type and status). */
export const listObligations = () => call<{ obligations: PmView[] }>('/obligations');

export type NewObligation = {
  crsId: number;
  month: number;
  year: number;
  type: PmType;
  /** Required for 'other'. */
  title: string;
  reference: string;
  dueRupees: string;
  /** Optional: money already received when the obligation is entered; saved as its first payment. */
  initialPayment?: { date: string; amountRupees: string; method: PayMethod; utr: string; remarks: string } | null;
};
/** 409 when a Monthly / PV / Previous Balance obligation already exists for that shop and month. */
export const createObligation = (o: NewObligation) => call<{ obligation: PmView }>('/obligations', json('POST', o));

/** Amount due, reference and (for 'other') the title. 409 if the due would fall below what is already paid. */
export const updateObligation = (id: string, patch: { dueRupees?: string; reference?: string; title?: string }) =>
  call<{ obligation: PmView }>(`/obligations/${encodeURIComponent(id)}`, json('PATCH', patch));

/** Only while it has no payments and no reminders (409 otherwise). */
export const deleteObligation = (id: string) => call<{ ok: true }>(`/obligations/${encodeURIComponent(id)}`, { method: 'DELETE' });

export type PaymentInput = { date: string; amountRupees: string; method: PayMethod; utr: string; remarks: string };
/** 409 when the amount is above the outstanding balance or the obligation is already paid. */
export const recordPayment = (id: string, p: PaymentInput) =>
  call<{ obligation: PmView }>(`/obligations/${encodeURIComponent(id)}/payments`, json('POST', p));

/** Correct a recorded payment; the entry keeps what it replaced. */
export const correctPayment = (id: string, paymentId: string, p: PaymentInput) =>
  call<{ obligation: PmView }>(`/obligations/${encodeURIComponent(id)}/payments/${encodeURIComponent(paymentId)}`, json('PATCH', { action: 'correct', ...p }));

/** Void a payment entered in error (kept in the history with the reason). */
export const voidPayment = (id: string, paymentId: string, reason: string) =>
  call<{ obligation: PmView }>(`/obligations/${encodeURIComponent(id)}/payments/${encodeURIComponent(paymentId)}`, json('PATCH', { action: 'void', reason }));

/** Sends one reminder to that shop's own staff. 409 when the balance is 0; 400 when the shop has nobody to receive it. */
export const sendReminder = (id: string) =>
  call<{ obligation: PmView; reminder: PmReminder }>(`/obligations/${encodeURIComponent(id)}/remind`, { method: 'POST' });

export const fetchSettings = () => call<PmSettings>('/settings');

/** Saves ONLY the UPI ID and payee name (the paid-download tariff and switch are not touched). */
export const saveUpi = (upi: PmUpiConfig) => call<PmSettings>('/settings', json('PUT', upi));

/** Uploads the official QR image (PNG / JPEG / WEBP) or a reminder sound (MP3 / WAV / OGG / M4A), at most 4 MB. */
export const uploadMedia = (kind: 'qr' | 'sound', file: File) =>
  call<{ media: PmMedia }>(`/media?kind=${kind}&name=${encodeURIComponent(file.name)}`, {
    method: 'POST',
    headers: { 'Content-Type': file.type || 'application/octet-stream' },
    body: file,
  });

export const setActiveSound = (soundId: string | null) => call<{ media: PmMedia }>('/media', json('PATCH', { activeSoundId: soundId }));

/** Removes an uploaded sound that is not the active one, or the QR image. */
export const removeMedia = (assetId: string) => call<{ media: PmMedia }>(`/media/${encodeURIComponent(assetId)}`, { method: 'DELETE' });

/** Where an uploaded file is served (signed-in users; a shop only reaches the active QR and sound). */
export const mediaUrl = (assetId: string) => `${BASE}/media/${encodeURIComponent(assetId)}`;

// ── A shop user ─────────────────────────────────────────────────────────────

/** The signed-in shop's own reminders (never another shop's). */
export const fetchMine = () => call<PmMine>('/mine');

/** OK on the reminder: every waiting reminder of that obligation is acknowledged. Changes no money. */
export const acknowledgeReminder = (obligationId: string) =>
  call<{ ok: true; acknowledged: number }>('/mine/ack', json('POST', { obligationId }));
