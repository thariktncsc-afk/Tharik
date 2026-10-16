/**
 * POST /api/payment-management/obligations/<id>/payments — record money
 * received (PaymentInput in client.ts). Administrators only. 409 when it is
 * more than the outstanding balance or the obligation is already paid.
 */
import { recordPayment } from '@/lib/paymentMgmt/server';
import { actorOf, bodyOf, depsFor, failure, notConfigured, param, send, store } from '@/lib/paymentMgmt/routeKit';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function POST(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const nc = notConfigured();
  if (nc) return nc;
  try {
    const { id } = await ctx.params;
    const { session, actor } = await actorOf();
    return send(await recordPayment(store(), depsFor(session), actor, param(id), await bodyOf(req)));
  } catch (e) {
    return failure(e, 'save');
  }
}
