/**
 * POST /api/payment-management/mine/ack { obligationId } — OK on a payment
 * reminder, by a user of the shop it was sent to (another shop's answers 404).
 * Every reminder of it still waiting is acknowledged; the first OK wins, a
 * second is harmless. No money is touched. → { ok, acknowledged }
 */
import { acknowledge } from '@/lib/paymentMgmt/server';
import { actorOf, bodyOf, depsFor, failure, notConfigured, send, store } from '@/lib/paymentMgmt/routeKit';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function POST(req: Request) {
  const nc = notConfigured();
  if (nc) return nc;
  try {
    const { session, actor } = await actorOf();
    return send(await acknowledge(store(), depsFor(session), actor, await bodyOf(req)));
  } catch (e) {
    return failure(e, 'save');
  }
}
