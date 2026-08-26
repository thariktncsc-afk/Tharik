/**
 * Server-side payment helpers: settings, entitlement, and the statement
 * engine running under Node.
 *
 * Only route handlers may import this — it reaches for the service_role key.
 *
 * The entitlement check here is the whole product. Everything else (the QR,
 * the admin queue, the pricing) is bookkeeping around one question: "may this
 * session receive these sheets?"
 */
import { cookies } from 'next/headers';
import { supabaseAdmin } from '@/lib/supabaseAdmin';
import { SESSION_COOKIE, decodeSession, type Session } from '@/lib/session';
import { CRS_NAMES } from '@/lib/engine/shops';
import { rebuildMonthlyFromDaily } from '@/lib/engine/monthlyRollup';
import { DEFAULT_SETTINGS, type PaymentSettings } from './pricing';
import { createStatementEngine } from '@/generated/statements-legacy';

export type Section = {
  id: string;
  label: string;
  icon: string;
  desc: string;
  copies: number;
  color: string;
  availableFor: string;
};

export type StmtData = { crsId: number; mo: string; yr: number; avail: Record<string, boolean | number> };

export type StatementEngine = {
  getData: (crsId: number, month: number, year: number) => StmtData;
  buildSection: (id: string, d: StmtData) => string;
  sectionsFor: (crsId: number) => Section[];
  printCss: string;
};

export async function requireSession(): Promise<Session | null> {
  const jar = await cookies();
  return decodeSession(jar.get(SESSION_COOKIE)?.value);
}

export const isAdmin = (s: Session | null) => s?.role === 'ADMIN';

// ── Settings ────────────────────────────────────────────────────────────────

export async function readSettings(): Promise<PaymentSettings> {
  const { data, error } = await supabaseAdmin()
    .from('payment_settings')
    .select('enabled, upi_vpa, upi_payee_name, statement_sheet_paise, dss_day_paise, gst_rate_bp')
    .eq('id', 1)
    .maybeSingle();

  // A missing table means 0004 has not been run yet. Falling back to the
  // defaults with enabled:false keeps every screen working and every download
  // free, which is the safe direction to fail: nobody is charged for nothing,
  // and nobody is locked out of statutory paperwork by a migration gap.
  if (error || !data) return { ...DEFAULT_SETTINGS };

  return {
    enabled: data.enabled === true,
    upiVpa: (data.upi_vpa as string) ?? '',
    upiPayeeName: (data.upi_payee_name as string) ?? '',
    statementSheetPaise: (data.statement_sheet_paise as number) ?? DEFAULT_SETTINGS.statementSheetPaise,
    dssDayPaise: (data.dss_day_paise as number) ?? DEFAULT_SETTINGS.dssDayPaise,
    gstRateBp: (data.gst_rate_bp as number) ?? DEFAULT_SETTINGS.gstRateBp,
  };
}

/** True when the tables exist and an admin has switched charging on. */
export async function chargingActive(): Promise<boolean> {
  const s = await readSettings();
  return s.enabled && s.upiVpa.trim().length > 0;
}

// ── Entitlement ─────────────────────────────────────────────────────────────

export type Scope = { crsId: number; kind: 'statement' | 'dss'; year: number; month: number };

/**
 * Every section id this SHOP has already paid for, in this month.
 *
 * Keyed on the shop rather than the person on purpose: crs9's Bill Clerk and
 * its Packer are two users behind one shop, and billing the shop twice for one
 * month would be indefensible. Approvals accumulate, so a customer who buys
 * three sheets today and ten more tomorrow ends up entitled to all thirteen.
 */
export async function paidSections(scope: Scope): Promise<Set<string>> {
  const { data, error } = await supabaseAdmin()
    .from('payment_orders')
    .select('section_ids')
    .eq('crs_id', scope.crsId)
    .eq('kind', scope.kind)
    .eq('year', scope.year)
    .eq('month', scope.month)
    .eq('status', 'approved');

  if (error || !data) return new Set();
  const out = new Set<string>();
  for (const row of data) for (const id of (row.section_ids as string[]) ?? []) out.add(id);
  return out;
}

/** True when an approved DSS order covers this shop-month. */
export async function dssPaid(scope: Omit<Scope, 'kind'>): Promise<boolean> {
  const { data, error } = await supabaseAdmin()
    .from('payment_orders')
    .select('id')
    .eq('crs_id', scope.crsId)
    .eq('kind', 'dss')
    .eq('year', scope.year)
    .eq('month', scope.month)
    .eq('status', 'approved')
    .limit(1);
  return !error && (data?.length ?? 0) > 0;
}

export type Denial = { ok: false; status: number; error: string; unpaid?: string[] };
export type Grant = { ok: true; free: boolean };

/**
 * The gate. Answers for a concrete request, not in general.
 *
 * Order matters: the session check comes before the shop check, which comes
 * before the money. A shop user asking for another shop's statements is a 403
 * however much they have paid.
 */
export async function authorise(
  session: Session | null,
  scope: Scope,
  sectionIds: string[],
): Promise<Grant | Denial> {
  if (!session) return { ok: false, status: 401, error: 'Not signed in.' };

  if (isAdmin(session)) return { ok: true, free: true };

  if (session.crsId == null || session.crsId !== scope.crsId) {
    return { ok: false, status: 403, error: 'You can only open your own shop’s statements.' };
  }

  if (!(await chargingActive())) return { ok: true, free: true };

  if (scope.kind === 'dss') {
    return (await dssPaid(scope))
      ? { ok: true, free: false }
      : { ok: false, status: 402, error: 'This DSS download has not been paid for and approved yet.' };
  }

  const paid = await paidSections(scope);
  const unpaid = sectionIds.filter((id) => !paid.has(id));
  if (unpaid.length) {
    return { ok: false, status: 402, error: 'Payment for these sheets has not been approved yet.', unpaid };
  }
  return { ok: true, free: false };
}

// ── Statement engine, server side ───────────────────────────────────────────

const STORE_KEYS = [
  'entryStore', 'inspectionStore', 'monthlyStore', 'meManualStore', 'meSourceStore',
  'meRemitStore', 'meGunnyStore', 'meCardStore', 'salesCloseStore', 'receiptStore',
  'meAllotStore', 'meCardConfirmed', 'meAdvanceStore',
] as const;

/**
 * Builds the legacy statement engine under Node, from the database rather than
 * from whatever the browser happens to be holding.
 *
 * Same construction the /statements page used to do client-side and that
 * tools/verify-statements.mjs already does in Node — same stores, same
 * CRS_LIST — so the golden-file guarantee still covers exactly what ships to
 * the customer. Nothing about the builders changes; only where they run.
 */
export async function loadStatementEngine(currentUser: unknown): Promise<StatementEngine> {
  const db = supabaseAdmin();

  const [stateRes, userRes] = await Promise.all([
    db.from('crs_state').select('store_key, data').eq('scope', 'global'),
    db.from('users').select('id, username, full_name, phone, email, role, crs_id, active').order('id'),
  ]);

  const raw = new Map<string, unknown>();
  for (const r of stateRes.data ?? []) raw.set(r.store_key as string, r.data);

  const stores: Record<string, unknown> = {};
  for (const k of STORE_KEYS) stores[k] = raw.get(k) ?? (k === 'receiptStore' ? [] : {});

  const users = (userRes.data ?? []).map((r) => ({
    id: r.id as number,
    fullName: (r.full_name as string) ?? '',
    username: (r.username as string) ?? '',
    phone: (r.phone as string) ?? '',
    email: (r.email as string) ?? '',
    role: (r.role as string) ?? '',
    crsId: (r.crs_id as number) ?? null,
    active: r.active !== false,
  }));

  const shopExtras = (raw.get('__shops') as Record<string, unknown>[]) ?? [];
  const CRS_LIST = Array.from({ length: 30 }, (_, i) => ({
    ...(shopExtras[i] ?? {}),
    id: i + 1,
    name: CRS_NAMES[i + 1],
  }));

  return createStatementEngine({
    stores,
    users,
    CRS_LIST,
    CRS_MASTER: raw.get('__crsMaster') ?? [],
    TN_GOVT_HOLIDAYS: raw.get('__holidays'),
    APP_CONFIG: raw.get('__config') ?? {},
    CRS_ACCOUNTS: raw.get('__accounts') ?? {},
    currentUser,
    // Same behaviour as the legacy stmtGetData: refresh the month from the
    // daily sheets + manual values before the sections read it.
    rebuildMonthlyFromDaily: (cid: number, m: number, y: number) => {
      const key = `${cid}_${m}_${y}`;
      const manual = (stores.meManualStore as Record<string, unknown>)[key];
      const next = rebuildMonthlyFromDaily(
        cid, m, y,
        stores.entryStore as never,
        stores.inspectionStore as never,
        manual as never,
        undefined,
        stores.receiptStore as never,
      );
      (stores.monthlyStore as Record<string, unknown>)[key] = next.merged;
      (stores.meSourceStore as Record<string, unknown>)[key] = next.source;
    },
  }) as StatementEngine;
}

/**
 * The section list for a shop, straight from the engine — never a copy.
 *
 * CRS 29 runs a different family of twelve sections, so "13 sheets" is not a
 * constant anywhere in this codebase and must not become one.
 */
export function sectionsForShop(engine: StatementEngine, crsId: number, admin: boolean): Section[] {
  return engine.sectionsFor(crsId).filter((s) => s.availableFor === 'all' || (s.availableFor === 'admin' && admin));
}
