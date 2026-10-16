/**
 * Payment Management settings — administrators only.
 *
 * GET → { upi, media, sampleLinks }   the office UPI ID, the QR image and sounds, ₹1.00 test links
 * PUT { vpa, payeeName } → the same   writes ONLY upi_vpa / upi_payee_name on payment_settings
 *
 * The UPI ID is the one the paid statement / DSS downloads use too. This route
 * never touches the tariff or the charging switch (/api/payments/settings does).
 */
import { getSettings, saveUpi } from '@/lib/paymentMgmt/server';
import { actorOf, bodyOf, depsFor, failure, notConfigured, send, store } from '@/lib/paymentMgmt/routeKit';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET() {
  const nc = notConfigured();
  if (nc) return nc;
  try {
    const { session, actor } = await actorOf();
    return send(await getSettings(store(), depsFor(session), actor));
  } catch (e) {
    return failure(e, 'list');
  }
}

export async function PUT(req: Request) {
  const nc = notConfigured();
  if (nc) return nc;
  try {
    const { session, actor } = await actorOf();
    return send(await saveUpi(store(), depsFor(session), actor, await bodyOf(req)));
  } catch (e) {
    return failure(e, 'save');
  }
}
