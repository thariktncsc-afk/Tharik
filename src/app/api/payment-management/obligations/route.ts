/**
 * Payment Management (lib/paymentMgmt) — administrators only, checked in
 * every handler on the session.
 *
 * GET  → every shop's obligations, with their worked-out figures
 * POST → a new obligation (NewObligation in client.ts); 409 when that shop's
 *        month already has a Monthly / PV / Previous Balance one
 */
import { createObligation, listObligations } from '@/lib/paymentMgmt/server';
import { actorOf, bodyOf, depsFor, failure, notConfigured, send, store } from '@/lib/paymentMgmt/routeKit';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET() {
  const nc = notConfigured();
  if (nc) return nc;
  try {
    const { session, actor } = await actorOf();
    return send(await listObligations(store(), depsFor(session), actor));
  } catch (e) {
    return failure(e, 'list');
  }
}

export async function POST(req: Request) {
  const nc = notConfigured();
  if (nc) return nc;
  try {
    const { session, actor } = await actorOf();
    return send(await createObligation(store(), depsFor(session), actor, await bodyOf(req)));
  } catch (e) {
    return failure(e, 'save');
  }
}
