/**
 * Approve, reject or withdraw one clear request.
 *
 * APPROVE PERFORMS THE CLEAR. It is not a status change and not a permission
 * the shop spends later: the records are deleted here, the affected months are
 * republished, and only then is the request marked cleared. If the deletion
 * fails the request is put back to pending with the reason, so an administrator
 * never sees "approved" over data that is still sitting there.
 *
 * The sequence is pending → clearing → cleared. `clearing` is written before
 * the deletion starts, so a crash half-way leaves evidence instead of a row
 * that looks finished.
 */
import { NextResponse } from 'next/server';
import { cookies } from 'next/headers';
import { supabaseConfigured } from '@/lib/supabaseAdmin';
import { SESSION_COOKIE, decodeSession } from '@/lib/session';
import { mutateClearDb, type StoredRequest } from '@/lib/clearStore';
import { executeClear } from '@/lib/clearExecute';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

type Claim =
  | { ok: true; request: StoredRequest }
  | { ok: false; status: number; error: string };

export async function PATCH(req: Request, ctx: { params: Promise<{ id: string }> }) {
  if (!supabaseConfigured()) return NextResponse.json({ error: 'Supabase is not configured on the server.' }, { status: 503 });

  const jar = await cookies();
  const s = decodeSession(jar.get(SESSION_COOKIE)?.value);
  if (!s) return NextResponse.json({ error: 'Not signed in.' }, { status: 401 });

  const id = Number((await ctx.params).id);
  if (!Number.isInteger(id)) return NextResponse.json({ error: 'Unknown request.' }, { status: 400 });

  const body = (await req.json().catch(() => ({}))) as { action?: string; note?: string };
  const action = String(body.action ?? '');
  const note = String(body.note ?? '').trim().slice(0, 2000);
  if (!['approve', 'reject', 'cancel'].includes(action)) {
    return NextResponse.json({ error: 'Unknown action.' }, { status: 400 });
  }

  const isAdmin = s.role === 'ADMIN';
  const at = new Date().toISOString();

  // ── Reject / withdraw: a decision and nothing else ────────────────────────
  if (action !== 'approve') {
    try {
      const outcome = await mutateClearDb(s.username, (db): Claim => {
        const r = db.requests.find((x) => x.id === id);
        if (!r) return { ok: false, status: 404, error: 'Unknown request.' };
        if (action === 'cancel') {
          if (!isAdmin && (r.crsId !== s.crsId || r.requestedBy !== s.username)) {
            return { ok: false, status: 403, error: 'You may only withdraw your own request.' };
          }
        } else if (!isAdmin) {
          return { ok: false, status: 403, error: 'Only an administrator can approve or reject a clear request.' };
        }
        if (r.status !== 'pending') return { ok: false, status: 409, error: `This request has already been ${r.status}.` };

        r.status = action === 'reject' ? 'rejected' : 'cancelled';
        r.decidedBy = s.username;
        r.decidedAt = at;
        r.decisionNote = note;
        db.events.push({ requestId: r.id, event: r.status, actor: s.username, actorRole: s.role, at, detail: note || `${r.status} by ${s.username}` });
        return { ok: true, request: r };
      });
      if (!outcome.ok) return NextResponse.json({ error: outcome.error }, { status: outcome.status });
      return NextResponse.json({ request: outcome.request });
    } catch (e) {
      return NextResponse.json({ error: e instanceof Error ? e.message : 'Could not record the decision.' }, { status: 500 });
    }
  }

  // ── Approve: claim it, clear the data, then confirm ───────────────────────
  if (!isAdmin) return NextResponse.json({ error: 'Only an administrator can approve a clear request.' }, { status: 403 });

  let claimed: StoredRequest;
  try {
    // Moving to `clearing` inside the read-modify-write is what stops two
    // admins approving the same request at once — the second sees `clearing`.
    const outcome = await mutateClearDb(s.username, (db): Claim => {
      const r = db.requests.find((x) => x.id === id);
      if (!r) return { ok: false, status: 404, error: 'Unknown request.' };
      // `approved` is the legacy state: granted by the earlier build, which
      // never performed the deletion. Pressing Approve on one of those now
      // runs the clear it was always supposed to run.
      if (r.status !== 'pending' && r.status !== 'approved') {
        return { ok: false, status: 409, error: `This request has already been ${r.status}.` };
      }
      r.status = 'clearing';
      r.decidedBy = s.username;
      r.decidedAt = at;
      r.decisionNote = note;
      r.lastError = null;
      db.events.push({ requestId: r.id, event: 'approved', actor: s.username, actorRole: s.role, at, detail: note || `Approved by ${s.username}` });
      return { ok: true, request: { ...r } };
    });
    if (!outcome.ok) return NextResponse.json({ error: outcome.error }, { status: outcome.status });
    claimed = outcome.request;
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : 'Could not record the decision.' }, { status: 500 });
  }

  try {
    const cleared = await executeClear(claimed, s.username);
    const doneAt = new Date().toISOString();
    const final = await mutateClearDb(s.username, (db) => {
      const r = db.requests.find((x) => x.id === id)!;
      r.status = 'cleared';
      r.clearedAt = doneAt;
      r.clearedRecords = cleared;
      db.events.push({
        requestId: r.id,
        event: 'cleared',
        actor: s.username,
        actorRole: s.role,
        at: doneAt,
        detail: cleared.length
          ? `Removed ${cleared.length} record(s): ${cleared.map((c) => `${c.module} ${c.key}`).join(', ')}`.slice(0, 2000)
          : 'Nothing left to remove — the records were already gone.',
      });
      return { ...r };
    });
    return NextResponse.json({ request: final, cleared });
  } catch (e) {
    // The data is untouched (executeClear rolls its own writes back), so the
    // request must not be left looking decided.
    const reason = e instanceof Error ? e.message : String(e);
    try {
      await mutateClearDb(s.username, (db) => {
        const r = db.requests.find((x) => x.id === id);
        if (!r) return;
        r.status = 'pending';
        r.decidedBy = null;
        r.decidedAt = null;
        r.lastError = reason.slice(0, 500);
        db.events.push({
          requestId: r.id,
          event: 'clear-failed',
          actor: s.username,
          actorRole: s.role,
          at: new Date().toISOString(),
          detail: reason.slice(0, 2000),
        });
      });
    } catch {
      /* the failure is reported to the admin either way */
    }
    return NextResponse.json({ error: `The clear failed, so nothing was removed and the request is still pending. ${reason}` }, { status: 500 });
  }
}
