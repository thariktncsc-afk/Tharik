/**
 * Server side of the clear/delete approval workflow.
 *
 * Only route handlers may import this — it reaches for the service_role key.
 * Storage is src/lib/clearStore.ts; the deletion itself is clearExecute.ts.
 *
 * There is deliberately no "grant" here any more. An approval used to be a
 * permission the shop spent by clearing and saving, which meant an approved
 * request could sit unspent over data that still existed, and the shop had to
 * do the destroying. Approving now performs the clear on the server, so shop
 * staff never delete saved figures under any circumstances — which is what the
 * security rule asks for.
 */
import type { Session } from '@/lib/session';
import { mutateClearDb, type StoredRequest } from '@/lib/clearStore';

export type ClearRequest = StoredRequest;

/** Write one line of the trail. Never throws — an audit gap must not fail a write. */
export async function logEvent(
  requestId: number | null,
  event: string,
  session: Session | null,
  detail: string,
): Promise<void> {
  try {
    await mutateClearDb(session?.username ?? 'system', (db) => {
      db.events.push({
        requestId,
        event,
        actor: session?.username ?? 'unknown',
        actorRole: session?.role ?? '',
        at: new Date().toISOString(),
        detail: detail.slice(0, 2000),
      });
    });
  } catch {
    /* the refusal is already reported to the caller */
  }
}
