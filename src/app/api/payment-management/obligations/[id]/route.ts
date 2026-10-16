/**
 * One obligation — administrators only.
 *
 * PATCH  { dueRupees?, reference?, title? } → { obligation }; 409 when the due would fall below what is paid
 * DELETE → { ok }; only while it has no payments and no reminders (409 otherwise)
 */
import { deleteObligation, updateObligation } from '@/lib/paymentMgmt/server';
import { actorOf, bodyOf, depsFor, failure, notConfigured, param, send, store } from '@/lib/paymentMgmt/routeKit';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function PATCH(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const nc = notConfigured();
  if (nc) return nc;
  try {
    const { id } = await ctx.params;
    const { session, actor } = await actorOf();
    return send(await updateObligation(store(), depsFor(session), actor, param(id), await bodyOf(req)));
  } catch (e) {
    return failure(e, 'save');
  }
}

export async function DELETE(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  const nc = notConfigured();
  if (nc) return nc;
  try {
    const { id } = await ctx.params;
    const { session, actor } = await actorOf();
    return send(await deleteObligation(store(), depsFor(session), actor, param(id)));
  } catch (e) {
    return failure(e, 'remove');
  }
}
