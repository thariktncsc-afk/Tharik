/**
 * Payment Access Control — which shops pay before opening their DSS and their
 * Statements. Pure rules; no database, so the screens, the routes and the
 * tools share one definition.
 *
 * Stored in crs_state under `__paymentGate`:
 *
 *     { "shops": { "11": { "dss": false, "statement": true } }, "at": "…", "by": "admin" }
 *
 * `true` = Payment Required (the existing pay → approve → open flow), `false`
 * = Free Access. A shop with no entry, or no entry for one kind, is Payment
 * Required — exactly how the app behaved before this existed, so nothing
 * changes until an administrator switches a shop off.
 *
 * Only the server writes it (/api/payments/gate, administrators only); it is
 * not in /api/state's writable keys. It sits on top of the global charging
 * switch (payment_settings.enabled): with charging off, everything is free, as
 * before. Administrators are always free. Payment orders and approvals are
 * never touched by a switch — switching a shop back ON uses the approvals it
 * already has.
 */

export const GATE_KEY = '__paymentGate';
export type GateKind = 'dss' | 'statement';
export const GATE_KINDS: GateKind[] = ['dss', 'statement'];
export const GATE_LABEL: Record<GateKind, string> = { dss: 'DSS', statement: 'Statement' };

export type ShopGate = Partial<Record<GateKind, boolean>>;
export type PaymentGate = { shops: Record<string, ShopGate>; at?: string; by?: string };

const isObj = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v);

export function readGate(raw: unknown): PaymentGate {
  const shops = isObj(raw) && isObj(raw.shops) ? (raw.shops as Record<string, ShopGate>) : {};
  return { shops, at: isObj(raw) ? (raw.at as string | undefined) : undefined, by: isObj(raw) ? (raw.by as string | undefined) : undefined };
}

/** Is payment required for this shop and kind? Unset = required (the old behaviour). */
export function gateRequired(gate: PaymentGate, crsId: number, kind: GateKind): boolean {
  const v = gate.shops[String(crsId)]?.[kind];
  return v !== false;
}

export type GateChange = { crsId: number; kind: GateKind; from: boolean; to: boolean };

/** The same record with these settings applied, and what actually changed. */
export function applyGate(
  gate: PaymentGate,
  wanted: { crsId: number; kind: GateKind; required: boolean }[],
  by: string,
  at: string,
): { next: PaymentGate; changes: GateChange[] } {
  const shops: Record<string, ShopGate> = {};
  for (const [k, v] of Object.entries(gate.shops)) shops[k] = { ...v };
  const changes: GateChange[] = [];
  for (const w of wanted) {
    const from = gateRequired(gate, w.crsId, w.kind);
    const key = String(w.crsId);
    shops[key] = { ...(shops[key] ?? {}), [w.kind]: w.required };
    if (from !== w.required) changes.push({ crsId: w.crsId, kind: w.kind, from, to: w.required });
  }
  return { next: { shops, at, by }, changes };
}

export const onOff = (required: boolean) => (required ? 'ON' : 'OFF');
