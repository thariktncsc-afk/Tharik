/**
 * Build the statements a request asks for — behind the paywall — for every
 * route that hands statements out (office, 2026-09-27).
 *
 * This is the body `/api/statements/render` always had, moved here unchanged
 * so the new PDF route (`/api/statements/pdf`) runs the SAME gate rather than
 * a copy of it: validate the request, `authorise()` before anything is built,
 * re-derive what the shop may ask for, then build exactly the sections asked
 * for, once each, in the order asked. A second copy of this would be one
 * forgotten check away from handing out a paid statement for free.
 */
import { authorise, isAdmin, loadStatementEngine, sectionsForShop } from '@/lib/payments/server';
import type { Session } from '@/lib/session';

export type BuiltSection = { id: string; label: string; copies: number; html: string };

export type Built =
  | { ok: false; status: number; error: string; unpaid?: string[] }
  | {
      ok: true;
      crsId: number;
      month: number;
      year: number;
      css: string;
      period: { mo: string; yr: number };
      free: boolean;
      sections: BuiltSection[];
    };

export async function buildStatements(session: Session, body: Record<string, unknown>): Promise<Built> {
  const crsId = Math.trunc(Number(body.crsId));
  const month = Math.trunc(Number(body.month));
  const year = Math.trunc(Number(body.year));
  const asked = Array.isArray(body.sectionIds) ? [...new Set((body.sectionIds as unknown[]).map(String))] : [];

  if (!Number.isFinite(crsId) || crsId < 1 || !Number.isFinite(month) || month < 1 || month > 12 || !Number.isFinite(year)) {
    return { ok: false, status: 400, error: 'Bad shop, month or year.' };
  }
  if (!asked.length) {
    return { ok: false, status: 400, error: 'Select at least one statement.' };
  }
  // A ceiling on the fan-out. Each section is a full statement build, and the
  // list of sections is small and known, so anything past it is abuse.
  if (asked.length > 40) {
    return { ok: false, status: 400, error: 'Too many statements in one request.' };
  }

  const admin = isAdmin(session);

  // Authorise BEFORE building anything. Generating the sheets and then
  // deciding whether to return them would still burn the work, and one
  // forgotten early return would leak the document.
  const verdict = await authorise(session, { crsId, kind: 'statement', year, month }, asked);
  if (!verdict.ok) {
    return { ok: false, status: verdict.status, error: verdict.error, unpaid: verdict.unpaid ?? [] };
  }

  const engine = await loadStatementEngine({
    id: session.userId,
    username: session.username,
    role: session.role,
    crsId: session.crsId,
  });

  // Re-derive what this shop is even allowed to ask for. The `coll` section is
  // admin-only; a shop user must not be able to reach it by naming it, paid or
  // not.
  const available = sectionsForShop(engine, crsId, admin);
  const byId = new Map(available.map((s) => [s.id, s]));
  const forbidden = asked.filter((id) => !byId.has(id));
  if (forbidden.length) {
    return { ok: false, status: 403, error: `Not available for this shop: ${forbidden.join(', ')}` };
  }

  let data;
  try {
    data = engine.getData(crsId, month, year);
  } catch (e) {
    console.error('[statements] getData failed:', e);
    return { ok: false, status: 500, error: 'Could not assemble this month’s figures.' };
  }

  const sections: BuiltSection[] = [];
  for (const id of asked) {
    const meta = byId.get(id)!;
    try {
      sections.push({ id, label: meta.label, copies: meta.copies, html: engine.buildSection(id, data) });
    } catch (e) {
      console.error(`[statements] section ${id} failed:`, e);
      return { ok: false, status: 500, error: `Could not build the ${meta.label} statement.` };
    }
  }

  return { ok: true, crsId, month, year, css: engine.printCss, period: { mo: data.mo, yr: data.yr }, free: verdict.free, sections };
}
