'use client';

/**
 * Browser side of the clear/delete approval workflow.
 *
 * These helpers are for the screens' manners — asking the reason, telling the
 * user where the request went. The protection itself is in /api/state; if this
 * file were deleted the data would still be safe.
 */
import type { ClearRequest } from '@/lib/clearServer';

export type { ClearRequest };

export type ClearScope = {
  crsId: number;
  shopName: string;
  /** Store keys about to be destroyed — `<crs>_<date>` or `<crs>_<m>_<y>`. */
  storeKeys: string[];
  scopeKind: 'day' | 'month' | 'receipt';
  /** What the user sees: "5 Dec 2026" or "December 2026". */
  scopeLabel: string;
};

async function body<T>(r: Response): Promise<T> {
  const b = (await r.json().catch(() => ({}))) as T & { error?: string };
  if (!r.ok) throw new Error(b?.error || `Server returned ${r.status}`);
  return b;
}

export async function listRequests(status?: string): Promise<ClearRequest[]> {
  const q = status && status !== 'all' ? `?status=${encodeURIComponent(status)}` : '';
  const b = await body<{ requests: ClearRequest[] }>(await fetch(`/api/clear-requests${q}`, { headers: { Accept: 'application/json' } }));
  return b.requests ?? [];
}

export async function requestClear(scope: ClearScope, reason: string): Promise<ClearRequest> {
  const b = await body<{ request: ClearRequest }>(
    await fetch('/api/clear-requests', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ...scope, reason }),
    }),
  );
  return b.request;
}

export async function decideRequest(id: number, action: 'approve' | 'reject' | 'cancel', note = ''): Promise<ClearRequest> {
  const b = await body<{ request: ClearRequest }>(
    await fetch(`/api/clear-requests/${id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action, note }),
    }),
  );
  return b.request;
}

/**
 * The shop's most recent request covering exactly these keys — open or
 * decided, so the dialog can report a rejection or a completed clear rather
 * than silently offering to raise the same request again.
 */
export function findLatest(requests: ClearRequest[], storeKeys: string[]): ClearRequest | undefined {
  const want = [...storeKeys].sort().join('|');
  return requests
    .filter((r) => [...r.storeKeys].sort().join('|') === want)
    .sort((a, b) => String(b.createdAt).localeCompare(String(a.createdAt)))[0];
}
