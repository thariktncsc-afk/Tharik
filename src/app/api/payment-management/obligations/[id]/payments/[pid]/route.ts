/**
 * PATCH /api/payment-management/obligations/<id>/payments/<pid> — administrators only.
 *
 *   { action: 'correct', date, amountRupees, method, utr, remarks }  the entry keeps what it replaced
 *   { action: 'void', reason }                                        kept in the history, with the reason
 *
 * Nothing is ever removed.
 */
import { changePayment } from '@/lib/paymentMgmt/server';
import { actorOf, bodyOf, depsFor, failure, notConfigured, param, send, store } from '@/lib/paymentMgmt/routeKit';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function PATCH(req: Request, ctx: { params: Promise<{ id: string; pid: string }> }) {
  const nc = notConfigured();
  if (nc) return nc;
  try {
    const { id, pid } = await ctx.params;
    const { session, actor } = await actorOf();
    return send(await changePayment(store(), depsFor(session), actor, param(id), param(pid), await bodyOf(req)));
  } catch (e) {
    return failure(e, 'save');
  }
}
