/**
 * POST /api/payment-management/obligations/<id>/remind — one payment reminder
 * to THAT shop's own active staff (notify/server.ts notifyShopPayment).
 * Administrators only. 409 when nothing is outstanding; 400 when the shop has
 * nobody to receive it. → { obligation, reminder }
 */
import { sendReminder } from '@/lib/paymentMgmt/server';
import { actorOf, depsFor, failure, notConfigured, param, send, store } from '@/lib/paymentMgmt/routeKit';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function POST(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  const nc = notConfigured();
  if (nc) return nc;
  try {
    const { id } = await ctx.params;
    const { session, actor } = await actorOf();
    return send(await sendReminder(store(), depsFor(session), actor, param(id)));
  } catch (e) {
    return failure(e, 'remind');
  }
}
