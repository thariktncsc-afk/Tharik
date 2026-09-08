/**
 * Loads and saves the engine's stores.
 *
 * GET  → every store row, plus its version.
 * POST → upserts only the stores whose contents changed, each guarded by the
 *        version the client read. A stale version is rejected with 409 rather
 *        than overwriting whatever landed in between.
 *
 * The payload shape is the engine's own backup format (see BACKUP_STORES in
 * src/legacy/18-backup-init.js), so nothing about the in-memory model changes.
 */
import { NextResponse } from 'next/server';
import { supabaseAdmin, supabaseConfigured } from '@/lib/supabaseAdmin';
import { SESSION_COOKIE, decodeSession } from '@/lib/session';
import { cookies } from 'next/headers';
import { describe, inspectWrite, isProtectedStore } from '@/lib/clearGuard';
import { logEvent } from '@/lib/clearServer';
import { CLEAR_STORE_KEY } from '@/lib/clearStore';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** Everything in BACKUP_STORES, plus the three pseudo-stores for counters/config. */
const ALLOWED_KEYS = new Set([
  'entryStore',
  'inspectionStore',
  'monthlyStore',
  'meManualStore',
  'meSourceStore',
  'meRemitStore',
  'meGunnyStore',
  'meCardStore',
  'salesCloseStore',
  'receiptStore',
  // Monthly Entry's card/allotment block (22-allotment.js, 24-coll.js). The
  // legacy client has always tried to save these through the backup registry;
  // accepting them here means the month's allotment finally survives a reload
  // for both apps.
  'meAllotStore',
  'meCardConfirmed',
  'meAdvanceStore',
  // userStore is deliberately absent — users live in their own table with hashed
  // passwords (0002_users.sql) and are served by /api/users. Accepting it here
  // would let a client write a second, competing copy of the roster.
  '__counters',
  '__config',
  '__accounts',
  // Masters — seeded once from the engine's literals, then owned by the database.
  '__shops',
  '__commodities',
  '__crsMaster',
  '__holidays',
  // Full commodity records (id/names/unit/rate/section) for the converted
  // screens — the legacy '__commodities' row is a bare id list and cannot
  // carry rates, so it stays untouched for the classic app.
  '__commodityMaster',
]);

async function requireSession() {
  const jar = await cookies();
  return decodeSession(jar.get(SESSION_COOKIE)?.value);
}

export async function GET() {
  if (!supabaseConfigured()) {
    return NextResponse.json({ error: 'Supabase is not configured on the server.' }, { status: 503 });
  }
  const session = await requireSession();
  if (!session) return NextResponse.json({ error: 'Not signed in.' }, { status: 401 });

  const { data, error } = await supabaseAdmin()
    .from('crs_state')
    .select('store_key, data, version')
    .eq('scope', 'global');

  if (error) {
    console.error('[api/state] read failed:', error.code, error.message);
    const missing = error.code === 'PGRST205';
    return NextResponse.json(
      {
        error: missing
          ? 'The crs_state table does not exist — run supabase/migrations/0001_init.sql.'
          : 'Could not read state.',
      },
      { status: missing ? 503 : 500 },
    );
  }

  const stores: Record<string, unknown> = {};
  const versions: Record<string, number> = {};
  for (const row of data ?? []) {
    // The approval record is not shop state. It carries other shops' reasons,
    // requester names and snapshots, and handing it to every signed-in client
    // would leak all three; /api/clear-requests serves it, scoped to the
    // caller. It is absent from ALLOWED_KEYS below for the matching reason —
    // an approval a client could write would not be an approval.
    if (row.store_key === CLEAR_STORE_KEY) continue;
    stores[row.store_key] = row.data;
    versions[row.store_key] = row.version;
  }

  return NextResponse.json({ stores, versions });
}

export async function POST(req: Request) {
  if (!supabaseConfigured()) {
    return NextResponse.json({ error: 'Supabase is not configured on the server.' }, { status: 503 });
  }
  const session = await requireSession();
  if (!session) return NextResponse.json({ error: 'Not signed in.' }, { status: 401 });

  let body: { stores?: Record<string, unknown>; versions?: Record<string, number> };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: 'Malformed request.' }, { status: 400 });
  }

  const stores = body.stores ?? {};
  const versions = body.versions ?? {};
  const db = supabaseAdmin();
  const savedVersions: Record<string, number> = {};
  const conflicts: string[] = [];

  // ── Clear/delete guard ────────────────────────────────────────────────────
  // Destroying saved figures needs an administrator's approval, and a shop may
  // only touch its own records. Both are decided here, on the difference
  // between what is stored and what is being written, because this endpoint is
  // where the data actually changes — a dialog in the browser is only manners.
  // Admins bypass: the point is a reviewed trail for shop staff.
  const isAdmin = session.role === 'ADMIN';

  if (!isAdmin) {
    const touched = Object.keys(stores).filter(isProtectedStore);
    if (touched.length) {
      const { data: current } = await db
        .from('crs_state')
        .select('store_key, data, version')
        .eq('scope', 'global')
        .in('store_key', touched);

      const stored: Record<string, unknown> = {};
      const stale: string[] = [];
      for (const row of current ?? []) {
        const key = row.store_key as string;
        stored[key] = row.data;
        if (Number(versions[key] ?? 0) !== Number(row.version)) stale.push(key);
      }

      // Version first, guard second. A client that has not seen someone else's
      // save is holding an old copy of every shop's data, and diffing against
      // it would read those untouched records as changes this user is making —
      // reported as another shop's, when the real answer is "reload". The 409
      // is also what the data layer already knows how to recover from.
      if (stale.length) {
        return NextResponse.json(
          { error: 'Someone else saved these first. Reload before saving again.', conflicts: stale, versions: {} },
          { status: 409 },
        );
      }

      const ownCrsId = typeof session.crsId === 'number' ? session.crsId : null;
      const verdict = inspectWrite(stored, stores, ownCrsId);

      if (verdict.foreign.length) {
        const shops = [...new Set(verdict.foreign.map((f) => f.crsId))].join(', ');
        await logEvent(null, 'blocked', session, `Attempted to change CRS ${shops} while signed in to CRS ${ownCrsId}`);
        return NextResponse.json(
          { error: `This account may only change CRS ${ownCrsId} records — the save also altered CRS ${shops}.` },
          { status: 403 },
        );
      }

      // Shop staff never destroy saved figures — not even with an approval in
      // hand, because approving now does the deleting itself (clearExecute.ts).
      // So there is nothing to check against here: destructive is refused.
      if (verdict.destructive.length) {
        await logEvent(null, 'blocked', session, `Clear refused: ${describe(verdict.destructive)}`);
        return NextResponse.json(
          {
            error: 'This entry already contains saved data. Admin approval is required to clear or reset this entry.',
            needsApproval: true,
            records: verdict.destructive,
          },
          { status: 403 },
        );
      }
    }
  }

  for (const [key, value] of Object.entries(stores)) {
    if (!ALLOWED_KEYS.has(key)) continue;

    const expected = Number(versions[key] ?? 0);

    // New row: insert. A unique-violation means someone else created it first,
    // which is a conflict, not an error to swallow.
    if (!expected) {
      const { data, error } = await db
        .from('crs_state')
        .insert({ scope: 'global', store_key: key, data: value, version: 1, updated_by: session.username })
        .select('version')
        .maybeSingle();

      if (error) conflicts.push(key);
      else if (data) savedVersions[key] = data.version;
      continue;
    }

    // Existing row: the update only matches while the version is untouched.
    const { data, error } = await db
      .from('crs_state')
      .update({
        data: value,
        version: expected + 1,
        updated_at: new Date().toISOString(),
        updated_by: session.username,
      })
      .eq('scope', 'global')
      .eq('store_key', key)
      .eq('version', expected)
      .select('version')
      .maybeSingle();

    if (error || !data) conflicts.push(key);
    else savedVersions[key] = data.version;
  }

  if (conflicts.length) {
    return NextResponse.json(
      {
        error: 'Someone else saved these first. Reload before saving again.',
        conflicts,
        versions: savedVersions,
      },
      { status: 409 },
    );
  }

  return NextResponse.json({ ok: true, versions: savedVersions });
}
