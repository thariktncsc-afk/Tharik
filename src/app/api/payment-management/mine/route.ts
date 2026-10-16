/**
 * GET /api/payment-management/mine — a SHOP user's own payment reminders
 * (PmMine): the ones still waiting for OK, every one ever sent, the office
 * UPI ID, the QR image and the reminder sound. The shop is the session's,
 * never the request's; an administrator is refused (403).
 */
import { mine } from '@/lib/paymentMgmt/server';
import { actorOf, depsFor, failure, notConfigured, send, store } from '@/lib/paymentMgmt/routeKit';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET() {
  const nc = notConfigured();
  if (nc) return nc;
  try {
    const { session, actor } = await actorOf();
    return send(await mine(store(), depsFor(session), actor));
  } catch (e) {
    return failure(e, 'list');
  }
}
