/**
 * Clear/delete approval requests.
 *
 * GET  — an admin sees every request; a shop user sees only its own.
 * POST — a shop user asks for permission to clear an entry. The snapshot of
 *        what is about to be destroyed is taken HERE, from the database, not
 *        from the request body: the whole point is a record of what was there,
 *        and a client that wants the data gone is not the right witness.
 */
import { NextResponse } from 'next/server';
import { cookies } from 'next/headers';
import { supabaseAdmin, supabaseConfigured } from '@/lib/supabaseAdmin';
import { SESSION_COOKIE, decodeSession } from '@/lib/session';
import { crsOfKey, isProtectedStore, periodOfKey, STORE_LABEL } from '@/lib/clearGuard';
import { mutateClearDb, readClearDb, type StoredRequest } from '@/lib/clearStore';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

async function session() {
  const jar = await cookies();
  return decodeSession(jar.get(SESSION_COOKIE)?.value);
}

export async function GET(req: Request) {
  if (!supabaseConfigured()) return NextResponse.json({ error: 'Supabase is not configured on the server.' }, { status: 503 });
  const s = await session();
  if (!s) return NextResponse.json({ error: 'Not signed in.' }, { status: 401 });

  const status = new URL(req.url).searchParams.get('status');

  let requests: StoredRequest[];
  try {
    requests = (await readClearDb()).requests;
  } catch {
    return NextResponse.json({ error: 'Could not read clear requests.' }, { status: 500 });
  }

  // A shop sees only its own — the reasons and snapshots are not public.
  if (s.role !== 'ADMIN') requests = requests.filter((r) => r.crsId === s.crsId);
  if (status && status !== 'all') requests = requests.filter((r) => r.status === status);
  requests = [...requests].sort((a, b) => String(b.createdAt).localeCompare(String(a.createdAt))).slice(0, 200);

  return NextResponse.json({ requests });
}

export async function POST(req: Request) {
  if (!supabaseConfigured()) return NextResponse.json({ error: 'Supabase is not configured on the server.' }, { status: 503 });
  const s = await session();
  if (!s) return NextResponse.json({ error: 'Not signed in.' }, { status: 401 });

  const body = (await req.json().catch(() => ({}))) as {
    crsId?: number;
    shopName?: string;
    storeKeys?: string[];
    scopeKind?: string;
    scopeLabel?: string;
    reason?: string;
  };

  const crsId = Number(body.crsId);
  if (!Number.isInteger(crsId) || crsId <= 0) return NextResponse.json({ error: 'A CRS shop is required.' }, { status: 400 });
  if (s.role !== 'ADMIN' && s.crsId !== crsId) {
    return NextResponse.json({ error: 'You may only request a clear for your own shop.' }, { status: 403 });
  }

  const reason = String(body.reason ?? '').trim();
  if (reason.length < 5) return NextResponse.json({ error: 'Please give a reason for clearing this entry.' }, { status: 400 });

  const storeKeys = [...new Set((body.storeKeys ?? []).map(String).filter(Boolean))];
  if (!storeKeys.length) return NextResponse.json({ error: 'Nothing was selected to clear.' }, { status: 400 });
  if (storeKeys.some((k) => crsOfKey(k) !== crsId)) {
    return NextResponse.json({ error: 'The selected records do not all belong to this shop.' }, { status: 400 });
  }

  // Snapshot what is actually stored for those keys, and note which modules
  // they belong to, so the admin sees the real figures rather than a claim.
  const { data: rows, error: readErr } = await supabaseAdmin().from('crs_state').select('store_key, data').eq('scope', 'global');
  if (readErr) return NextResponse.json({ error: 'Could not read the current data.' }, { status: 500 });

  const snapshot: Record<string, unknown> = {};
  const modules = new Set<string>();
  for (const row of rows ?? []) {
    const store = row.store_key as string;
    if (!isProtectedStore(store)) continue;
    const data = row.data;
    if (store === 'receiptStore') {
      const hit = (Array.isArray(data) ? data : []).filter((r) => r && storeKeys.includes(String((r as { id?: unknown }).id ?? '')));
      if (hit.length) {
        snapshot[store] = hit;
        modules.add(STORE_LABEL[store]);
      }
      continue;
    }
    if (!data || typeof data !== 'object') continue;
    const picked: Record<string, unknown> = {};
    for (const k of storeKeys) {
      const rec = (data as Record<string, unknown>)[k];
      if (rec !== undefined) picked[k] = rec;
    }
    if (Object.keys(picked).length) {
      snapshot[store] = picked;
      modules.add(STORE_LABEL[store] ?? store);
    }
  }

  if (!Object.keys(snapshot).length) {
    return NextResponse.json({ error: 'There is no saved data for this entry — the form can simply be cleared.' }, { status: 400 });
  }

  const scopeLabel = String(body.scopeLabel ?? periodOfKey(storeKeys[0] ?? ''));
  const want = [...storeKeys].sort().join('|');

  try {
    const created = await mutateClearDb(s.username, (db) => {
      // One open request per shop + key set, so the admin queue cannot fill
      // with duplicates of the same day.
      const open = db.requests.find(
        (r) => r.crsId === crsId && (r.status === 'pending' || r.status === 'clearing') && [...r.storeKeys].sort().join('|') === want,
      );
      if (open) return { duplicate: true as const, request: open };

      const rec: StoredRequest = {
        id: ++db.seq,
        crsId,
        shopName: String(body.shopName ?? '').slice(0, 200),
        storeKeys,
        modules: [...modules],
        scopeKind: String(body.scopeKind ?? 'day'),
        scopeLabel,
        requestedBy: s.username,
        requestedById: s.userId ?? null,
        requestedRole: s.role,
        reason: reason.slice(0, 2000),
        snapshot,
        status: 'pending',
        createdAt: new Date().toISOString(),
        decidedBy: null,
        decidedAt: null,
        decisionNote: null,
        clearedAt: null,
        clearedRecords: [],
        lastError: null,
      };
      db.requests.push(rec);
      db.events.push({
        requestId: rec.id,
        event: 'requested',
        actor: s.username,
        actorRole: s.role,
        at: rec.createdAt,
        detail: `${[...modules].join(', ')} — ${scopeLabel}: ${reason}`.slice(0, 2000),
      });
      return { duplicate: false as const, request: rec };
    });

    if (created.duplicate) {
      return NextResponse.json({ error: 'A request for this entry is already waiting for the administrator.', request: created.request }, { status: 409 });
    }
    return NextResponse.json({ request: created.request });
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : 'Could not create the request.' }, { status: 500 });
  }
}
