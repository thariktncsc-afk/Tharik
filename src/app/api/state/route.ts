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
  'userStore',
  '__counters',
  '__config',
  '__accounts',
  // Masters — seeded once from the engine's literals, then owned by the database.
  '__shops',
  '__commodities',
  '__crsMaster',
  '__holidays',
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
