/**
 * Payment Access Control — administrators switch, per shop, whether the DSS
 * and the Statements need paying for (src/lib/payments/gate.ts).
 *
 * GET   → every shop's two switches, plus whether charging is on at all.
 * PATCH { crsId, kind, required }        one switch
 *       { all: true, kind, required }    every shop, one kind (the bulk buttons)
 *
 * Administrators only, checked here on the session — the page hiding itself is
 * manners. The record is written with the row's version, so two administrators
 * switching at once cannot lose each other's change, and every change is one
 * activity-log row per shop and kind, with ON → OFF. Payment orders and
 * approvals are never touched.
 */
import { NextResponse } from 'next/server';
import { supabaseAdmin, supabaseConfigured } from '@/lib/supabaseAdmin';
import { chargingActive, isAdmin, readSettings, requireSession } from '@/lib/payments/server';
import { GATE_KEY, GATE_LABEL, applyGate, gateRequired, onOff, readGate, type GateKind } from '@/lib/payments/gate';
import { SHOP_IDS } from '@/lib/engine/shops';
import { recordActivity } from '@/lib/activityLog/server';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

async function admin() {
  if (!supabaseConfigured()) return { error: NextResponse.json({ error: 'Supabase is not configured on the server.' }, { status: 503 }) };
  const s = await requireSession();
  if (!s) return { error: NextResponse.json({ error: 'Not signed in.' }, { status: 401 }) };
  if (!isAdmin(s)) return { error: NextResponse.json({ error: 'Payment Access Control is for administrators only.' }, { status: 403 }) };
  return { s };
}

async function load() {
  const { data, error } = await supabaseAdmin().from('crs_state').select('data, version').eq('scope', 'global').eq('store_key', GATE_KEY).maybeSingle();
  if (error) throw error;
  return { gate: readGate(data?.data), version: data ? Number(data.version) : null };
}

const view = (gate: ReturnType<typeof readGate>) =>
  SHOP_IDS.map((crsId) => ({ crsId, dss: gateRequired(gate, crsId, 'dss'), statement: gateRequired(gate, crsId, 'statement') }));

export async function GET() {
  const g = await admin();
  if (g.error) return g.error;
  const [{ gate }, charging, settings] = await Promise.all([load(), chargingActive(), readSettings()]);
  return NextResponse.json({ shops: view(gate), charging, chargingEnabled: settings.enabled, at: gate.at ?? null, by: gate.by ?? null });
}

export async function PATCH(req: Request) {
  const g = await admin();
  if (g.error) return g.error;
  const s = g.s!;

  const body = (await req.json().catch(() => ({}))) as { crsId?: unknown; kind?: unknown; required?: unknown; all?: unknown };
  const kind: GateKind | null = body.kind === 'dss' || body.kind === 'statement' ? body.kind : null;
  if (!kind) return NextResponse.json({ error: 'Choose DSS or Statement.' }, { status: 400 });
  if (typeof body.required !== 'boolean') return NextResponse.json({ error: 'Say whether payment is required.' }, { status: 400 });
  const bulk = body.all === true;
  const crsId = Number(body.crsId);
  if (!bulk && !SHOP_IDS.includes(crsId)) return NextResponse.json({ error: 'Unknown CRS shop.' }, { status: 400 });
  const targets = bulk ? SHOP_IDS : [crsId];
  const required = body.required;

  const db = supabaseAdmin();
  for (let round = 0; round < 4; round++) {
    const { gate, version } = await load();
    const at = new Date().toISOString();
    const { next, changes } = applyGate(gate, targets.map((id) => ({ crsId: id, kind, required })), s.username, at);
    if (!changes.length) return NextResponse.json({ shops: view(gate), changed: 0 });

    if (version === null) {
      const { error } = await db.from('crs_state').insert({ scope: 'global', store_key: GATE_KEY, data: next, version: 1, updated_by: s.username });
      if (error) continue; // created by someone else first — read again
    } else {
      const { data: upd, error } = await db
        .from('crs_state')
        .update({ data: next, version: version + 1, updated_at: at, updated_by: s.username })
        .eq('scope', 'global')
        .eq('store_key', GATE_KEY)
        .eq('version', version)
        .select('version')
        .maybeSingle();
      if (error) return NextResponse.json({ error: 'Could not save the switch.' }, { status: 500 });
      if (!upd) continue; // another administrator switched something — apply on top of theirs
    }

    // "Administrator — CRS 20 — DSS Payment Requirement — ON → OFF"
    await recordActivity(
      s,
      changes.map((c) => ({
        crsId: c.crsId,
        module: 'Payment Access',
        action: 'updated',
        source: 'user',
        recordKey: `${GATE_KEY}:${c.crsId}:${c.kind}`,
        summary: `${GATE_LABEL[c.kind]} Payment Requirement ${onOff(c.from)} → ${onOff(c.to)}${bulk ? ' (applied to all shops)' : ''}`,
        changes: [{ label: `${GATE_LABEL[c.kind]} Payment Required`, before: onOff(c.from), after: onOff(c.to) }],
      })),
    );
    return NextResponse.json({ shops: view(next), changed: changes.length });
  }
  return NextResponse.json({ error: 'Someone else was changing these switches — please try again.' }, { status: 409 });
}
