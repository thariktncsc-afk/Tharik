'use client';

/**
 * Payment Management (office, 2026-10-16) — administrators only.
 *
 * What each CRS shop owes the office for a month (a Monthly Statement, a PV
 * Statement, a Previous Month Balance, or Other), what it has paid, and the
 * reminders sent to it. The administrator enters the amount due and each
 * payment as it reaches the account; the balance is always worked out by
 * the server from the payments, never typed. A reminder goes to that shop's
 * own Bill Clerk and Packer, who see it at once with a sound until one of
 * them presses OK — which is recorded here and changes no money.
 *
 * It lives on the Payments screen (office, 2026-10-16: "i need that in this
 * screen"), as two of its tabs for an administrator: `view` 'management' is
 * the records, 'settings' the UPI ID, QR and reminder sound. The Payments
 * page renders it for an ADMIN only; the server holds every rule
 * (src/lib/paymentMgmt, /api/payment-management) and refuses anyone else
 * whatever the screen shows. A change made by another administrator, or a
 * shop's OK, comes in by live sync ('paymgmt') without a refresh.
 *
 * `focusOb` is a /payments?ob=<id> link: that record's month is shown and
 * its history opened, once the list has it.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useAuth } from '@/lib/authClient';
import { useLiveRevision } from '@/lib/dataStore';
import { appAlert, appConfirm } from '@/components/dialog';
import { saveSuccess } from '@/components/SaveSuccess';
import { deleteObligation, fetchSettings, listObligations, sendReminder } from '@/lib/paymentMgmt/client';
import { PM_TYPES, type PmMedia, type PmSettings, type PmStatus, type PmType, type PmView } from '@/lib/paymentMgmt/types';
import { formatRupees } from '@/lib/payments/pricing';
import { pmObligationDeleted, pmReminderSent } from '@/lib/saveSuccess';
import { SHOPS } from '@/lib/engine/shops';
import { dmy, dmyTime } from '@/lib/dateFormat';
import { EditObligationModal, NewObligationModal, PaymentModal } from './ObligationModals';
import HistoryModal from './HistoryModal';
import PreviewModal from './PreviewModal';
import UpiCard from './UpiCard';
import SoundCard from './SoundCard';
import { MONTHS, STATUS_LABEL, STATUS_TONE, applyFilters, currentMonth, methodLabel, monthYear, reminderLine, summarise, whatFor, type Filters } from './lib';

export type PmTab = 'management' | 'settings';

type Open =
  | { kind: 'new' }
  | { kind: 'edit'; id: string }
  | { kind: 'pay'; id: string; paymentId?: string; back?: 'history' }
  | { kind: 'history'; id: string }
  | { kind: 'preview'; id: string };

const failed = (e: unknown) => (e instanceof Error ? e.message : 'Something went wrong. Please try again.');

const labelStyle = { display: 'block', fontSize: 10.5, fontWeight: 700, color: 'var(--muted)', textTransform: 'uppercase', letterSpacing: '.05em', marginBottom: 4 } as const;
const selectStyle = { width: '100%', fontSize: 12.5, padding: '7px 10px', borderRadius: 8, border: '1px solid var(--border)', background: '#fff' } as const;
const th = { padding: '10px 12px', fontWeight: 700, whiteSpace: 'nowrap' } as const;
const td = { padding: '10px 12px', verticalAlign: 'top' } as const;
const money = { ...td, textAlign: 'right', whiteSpace: 'nowrap', fontVariantNumeric: 'tabular-nums' } as const;

/**
 * The two grids are classes, not inline styles: responsive.css rewrites every
 * INLINE grid-template-columns under 900 px, which would put the UPI card in a
 * 170 px column on a phone. Phones get one card per row; the tables scroll
 * inside their own frame.
 */
const PAGE_CSS = `
#pm-admin .pm-summary{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:12px;margin-bottom:16px}
#pm-admin .pm-settings{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:14px;align-items:start}
@media (max-width: 1100px){#pm-admin .pm-settings{grid-template-columns:1fr}}
@media (max-width: 760px){#pm-admin .pm-summary{grid-template-columns:1fr}}
`;

const REMINDER_TONE = {
  none: { color: 'var(--muted)', icon: '—' },
  sent: { color: '#B45309', icon: '🔔' },
  ack: { color: '#15803D', icon: '✓' },
} as const;

export default function PaymentManagement({ view, focusOb = null, onDoneWithOb }: { view: PmTab; focusOb?: string | null; onDoneWithOb?: () => void }) {
  const { user } = useAuth();
  const isAdmin = user?.role === 'ADMIN';

  const now = useMemo(currentMonth, []);
  const [list, setList] = useState<PmView[] | null>(null);
  const [err, setErr] = useState('');
  const [settings, setSettings] = useState<PmSettings | null>(null);
  const [settingsErr, setSettingsErr] = useState('');
  const [filters, setFilters] = useState<Filters>({ crsId: 0, month: now.month, year: now.year, type: '', status: '' });
  const [open, setOpen] = useState<Open | null>(null);
  const [busy, setBusy] = useState('');

  const loadList = useCallback(async (quiet = false) => {
    try {
      const { obligations } = await listObligations();
      setList(obligations);
      setErr('');
    } catch (e) {
      // A quiet re-read that fails leaves what is on screen; the next beat tries again.
      if (!quiet) setErr(failed(e));
    }
  }, []);

  const loadSettings = useCallback(async (quiet = false) => {
    try {
      setSettings(await fetchSettings());
      setSettingsErr('');
    } catch (e) {
      if (!quiet) setSettingsErr(failed(e));
    }
  }, []);

  useEffect(() => {
    if (!isAdmin) return;
    void loadList();
    void loadSettings();
  }, [isAdmin, loadList, loadSettings]);

  // Another administrator's change, or a shop's OK, arrives here within a
  // beat — quietly: no spinner, and an open form keeps what is typed in it.
  const rev = useLiveRevision('paymgmt');
  useEffect(() => {
    if (!isAdmin || !rev) return;
    void loadList(true);
    void loadSettings(true);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rev]);

  /** The server's answer for one record replaces what was on screen. */
  const put = useCallback((o: PmView) => {
    setList((l) => (l ? (l.some((x) => x.id === o.id) ? l.map((x) => (x.id === o.id ? o : x)) : [o, ...l]) : [o]));
  }, []);

  const onMedia = useCallback((media: PmMedia) => setSettings((s) => (s ? { ...s, media } : s)), []);

  const shown = useMemo(() => applyFilters(list ?? [], filters), [list, filters]);
  const sum = useMemo(() => summarise(shown), [shown]);
  const years = useMemo(() => {
    const ys = new Set<number>([now.year - 1, now.year, now.year + 1]);
    for (const o of list ?? []) ys.add(o.year);
    return [...ys].sort((a, b) => b - a);
  }, [list, now.year]);

  const byId = (id: string) => list?.find((o) => o.id === id) ?? null;
  const current = open && open.kind !== 'new' ? byId(open.id) : null;

  // The record a form is open on was deleted elsewhere: the form goes too.
  useEffect(() => {
    if (open && open.kind !== 'new' && list && !current) setOpen(null);
  }, [open, list, current]);

  /**
   * /payments?ob=<id>: show that record's shop and month and open its
   * history — once, when the list first has it. A record not in the list
   * says so instead of opening something else.
   */
  const focused = useRef<string | null>(null);
  const [focusMissing, setFocusMissing] = useState(false);
  useEffect(() => {
    if (!focusOb || !list || focused.current === focusOb) return;
    focused.current = focusOb;
    const o = list.find((x) => x.id === focusOb);
    // Applied once: the address lets go of it, so coming back to the tab later
    // does not open it again.
    if (!o) {
      setFocusMissing(true);
      onDoneWithOb?.();
      return;
    }
    setFocusMissing(false);
    setFilters({ crsId: o.crsId, month: o.month, year: o.year, type: '', status: '' });
    setOpen({ kind: 'history', id: o.id });
    onDoneWithOb?.();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [focusOb, list]);

  // The Payments page shows these tabs to an administrator only; the server
  // refuses everyone else anyway.
  if (!isAdmin) return null;

  const setF = (patch: Partial<Filters>) => setFilters((f) => ({ ...f, ...patch }));
  const isThisMonth = filters.month === now.month && filters.year === now.year && !filters.crsId && !filters.type && !filters.status;

  const remind = async (o: PmView) => {
    const ok = await appConfirm({
      title: 'Send payment reminder?',
      tone: 'warning',
      icon: '🔔',
      message:
        `CRS ${o.crsId} — ${o.shopName}\n${whatFor(o)} · ${monthYear(o.month, o.year)}\nOutstanding balance: ${formatRupees(o.balancePaise)}\n\n` +
        'The shop’s Bill Clerk and Packer see it at once, with the reminder sound, until one of them presses OK.',
      confirmLabel: 'Send Reminder',
      defaultCancel: true,
    });
    if (!ok) return;
    setBusy(`${o.id}:remind`);
    try {
      const { obligation, reminder } = await sendReminder(o.id);
      put(obligation);
      saveSuccess(pmReminderSent(reminder.id, o.crsId, reminder.recipients));
    } catch (e) {
      void appAlert({ title: 'Reminder not sent', tone: 'danger', message: failed(e) });
    } finally {
      setBusy('');
    }
  };

  const remove = async (o: PmView) => {
    const ok = await appConfirm({
      title: 'Delete this payment record?',
      tone: 'danger',
      message: `CRS ${o.crsId} — ${o.shopName}\n${whatFor(o)} · ${monthYear(o.month, o.year)}\nAmount due ${formatRupees(o.duePaise)}\n\nIt has no payments and no reminders, so nothing else is lost.`,
      confirmLabel: 'Delete',
      defaultCancel: true,
    });
    if (!ok) return;
    setBusy(`${o.id}:delete`);
    try {
      await deleteObligation(o.id);
      setList((l) => (l ? l.filter((x) => x.id !== o.id) : l));
      saveSuccess(pmObligationDeleted(o.id, o.crsId, whatFor(o), o.month, o.year));
    } catch (e) {
      void appAlert({ title: 'Not deleted', tone: 'danger', message: failed(e) });
      void loadList(true);
    } finally {
      setBusy('');
    }
  };

  const stat = (label: string, value: string | number, color?: string) => (
    <div className="stat-row" style={{ padding: '7px 0', gap: 10 }}>
      <span style={{ fontSize: 12.5, color: 'var(--muted)' }}>{label}</span>
      <strong style={{ fontSize: 15, color, whiteSpace: 'nowrap', fontVariantNumeric: 'tabular-nums' }}>{value}</strong>
    </div>
  );

  const scope = [filters.crsId ? `CRS ${filters.crsId}` : 'All shops', filters.month ? MONTHS[filters.month - 1] : 'all months', filters.year || 'all years'].join(' · ');

  return (
    <div id="pm-admin">
      {view === 'management' ? (
        <div style={{ display: 'flex', justifyContent: 'flex-end', marginBottom: 12 }}>
          <button
            type="button"
            onClick={() => setOpen({ kind: 'new' })}
            disabled={!list}
            style={{ background: 'linear-gradient(135deg,#0284C7,#0EA5E9)', color: '#fff', border: 'none', padding: '9px 18px', borderRadius: 8, fontWeight: 700, fontSize: 13, cursor: list ? 'pointer' : 'default', whiteSpace: 'nowrap' }}
          >
            + New obligation
          </button>
        </div>
      ) : null}

      {err && view === 'management' ? <div style={{ background: '#FEF2F2', border: '1px solid #FCA5A5', color: '#B91C1C', borderRadius: 10, padding: '10px 14px', marginBottom: 14, fontSize: 13 }}>{err}</div> : null}
      {focusMissing && view === 'management' ? (
        <div style={{ background: '#FFFBEB', border: '1px solid #FDE68A', color: '#92400E', borderRadius: 10, padding: '10px 14px', marginBottom: 14, fontSize: 13 }}>
          The payment record that link points to is not in the list — it may have been deleted.
        </div>
      ) : null}

      {view === 'settings' ? (
        <div className="pm-settings">
          <UpiCard settings={settings} loadError={settingsErr} onSettings={setSettings} onMedia={onMedia} />
          <SoundCard media={settings?.media ?? null} loadError={settingsErr} onMedia={onMedia} />
        </div>
      ) : (
        <>
          {/* ── Filters ───────────────────────────────────────────────── */}
          <div className="card mb-4" style={{ padding: 14 }}>
            <div className="pm-filters" style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr))', gap: 10 }}>
              <div>
                <label style={labelStyle} htmlFor="pm-f-crs">CRS shop</label>
                <select id="pm-f-crs" value={filters.crsId} onChange={(e) => setF({ crsId: Number(e.target.value) })} style={selectStyle}>
                  <option value={0}>All CRS Shops</option>
                  {SHOPS.map((s) => (
                    <option key={s.id} value={s.id}>
                      CRS {s.id} — {s.name}
                    </option>
                  ))}
                </select>
              </div>
              <div>
                <label style={labelStyle} htmlFor="pm-f-month">Month</label>
                <select id="pm-f-month" value={filters.month} onChange={(e) => setF({ month: Number(e.target.value) })} style={selectStyle}>
                  <option value={0}>All months</option>
                  {MONTHS.map((m, i) => (
                    <option key={m} value={i + 1}>
                      {m}
                    </option>
                  ))}
                </select>
              </div>
              <div>
                <label style={labelStyle} htmlFor="pm-f-year">Year</label>
                <select id="pm-f-year" value={filters.year} onChange={(e) => setF({ year: Number(e.target.value) })} style={selectStyle}>
                  <option value={0}>All years</option>
                  {years.map((y) => (
                    <option key={y} value={y}>
                      {y}
                    </option>
                  ))}
                </select>
              </div>
              <div>
                <label style={labelStyle} htmlFor="pm-f-type">Payment type</label>
                <select id="pm-f-type" value={filters.type} onChange={(e) => setF({ type: e.target.value as PmType | '' })} style={selectStyle}>
                  <option value="">All types</option>
                  {PM_TYPES.map((t) => (
                    <option key={t.id} value={t.id}>
                      {t.label}
                    </option>
                  ))}
                </select>
              </div>
              <div>
                <label style={labelStyle} htmlFor="pm-f-status">Status</label>
                <select id="pm-f-status" value={filters.status} onChange={(e) => setF({ status: e.target.value as PmStatus | '' })} style={selectStyle}>
                  <option value="">All</option>
                  {(Object.keys(STATUS_LABEL) as PmStatus[]).map((s) => (
                    <option key={s} value={s}>
                      {STATUS_LABEL[s]}
                    </option>
                  ))}
                </select>
              </div>
            </div>
            <div style={{ display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap', marginTop: 10, fontSize: 12, color: 'var(--muted)' }}>
              <span>
                {list ? `${shown.length} of ${list.length} record${list.length === 1 ? '' : 's'}` : 'Loading…'} · {scope}
              </span>
              {!isThisMonth ? (
                <button type="button" className="btn btn-outline btn-sm" onClick={() => setFilters({ crsId: 0, month: now.month, year: now.year, type: '', status: '' })}>
                  Back to {monthYear(now.month, now.year)}
                </button>
              ) : null}
            </div>
          </div>

          {/* ── Summary for the filter ────────────────────────────────── */}
          <div className="pm-summary">
            <div className="card" style={{ padding: '12px 16px' }}>
              <div style={{ fontWeight: 800, fontSize: 13, marginBottom: 2 }}>💰 Money</div>
              {stat('Total due', formatRupees(sum.duePaise))}
              {stat('Received', formatRupees(sum.paidPaise), '#15803D')}
              {stat('Outstanding', formatRupees(sum.balancePaise), sum.balancePaise > 0 ? '#B91C1C' : '#15803D')}
            </div>
            <div className="card" style={{ padding: '12px 16px' }}>
              <div style={{ fontWeight: 800, fontSize: 13, marginBottom: 2 }}>🏪 Shops</div>
              {stat('Fully paid', sum.shops.paid, '#15803D')}
              {stat('Partly paid', sum.shops.partial, '#B45309')}
              {stat('Unpaid', sum.shops.unpaid, '#B91C1C')}
            </div>
            <div className="card" style={{ padding: '12px 16px' }}>
              <div style={{ fontWeight: 800, fontSize: 13, marginBottom: 2 }}>🔔 Reminders</div>
              {stat('Sent', sum.remindersSent)}
              {stat('Acknowledged', sum.remindersAcknowledged, '#15803D')}
              {stat('Waiting for OK', sum.remindersSent - sum.remindersAcknowledged, sum.remindersSent - sum.remindersAcknowledged ? '#B45309' : undefined)}
            </div>
          </div>

          {/* ── Obligations ───────────────────────────────────────────── */}
          <div className="card mb-4">
            <div className="card-header">
              <div className="card-title">Payment records</div>
              <div style={{ fontSize: 12, color: 'var(--muted)' }}>{shown.length} record(s)</div>
            </div>
            <div className="pm-table-wrap" style={{ overflowX: 'auto', overscrollBehaviorX: 'contain' }}>
              <table style={{ width: '100%', minWidth: 1060, borderCollapse: 'collapse', fontSize: 12 }}>
                <thead>
                  <tr style={{ background: '#F8FAFC', textAlign: 'left' }}>
                    <th style={th}>CRS</th>
                    <th style={th}>Month</th>
                    <th style={th}>Payment type</th>
                    <th style={{ ...th, textAlign: 'right' }}>Due</th>
                    <th style={{ ...th, textAlign: 'right' }}>Paid</th>
                    <th style={{ ...th, textAlign: 'right' }}>Balance</th>
                    <th style={th}>Status</th>
                    <th style={th}>Reminder</th>
                    <th style={th}>Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {!list ? (
                    <tr>
                      <td colSpan={9} style={{ padding: 28, textAlign: 'center', color: 'var(--muted)' }}>
                        {err ? 'Could not load the payment records.' : 'Loading…'}
                      </td>
                    </tr>
                  ) : shown.length === 0 ? (
                    <tr>
                      <td colSpan={9} style={{ padding: 28, textAlign: 'center', color: 'var(--muted)' }}>
                        No payment records for {scope}. Use “+ New obligation” to enter one.
                      </td>
                    </tr>
                  ) : (
                    shown.map((o) => {
                      const tone = STATUS_TONE[o.status];
                      const rl = reminderLine(o);
                      const paid = o.status === 'paid';
                      const canDelete = o.payments.length === 0 && o.reminders.length === 0;
                      const rowBusy = busy.startsWith(`${o.id}:`);
                      return (
                        <tr key={o.id} style={{ borderTop: '1px solid #F1F5F9' }}>
                          <td style={td}>
                            <strong style={{ color: '#0369A1', whiteSpace: 'nowrap' }}>CRS {o.crsId}</strong>
                            <div style={{ color: 'var(--muted)', fontSize: 11, marginTop: 2 }}>{o.shopName}</div>
                          </td>
                          <td style={{ ...td, whiteSpace: 'nowrap' }}>{monthYear(o.month, o.year)}</td>
                          <td style={td}>
                            <div style={{ fontWeight: 600 }}>{whatFor(o)}</div>
                            {o.type === 'other' ? <div style={{ color: 'var(--muted)', fontSize: 11, marginTop: 2 }}>Other</div> : null}
                            {o.reference ? <div style={{ color: 'var(--muted)', fontSize: 11, marginTop: 2 }}>Ref {o.reference}</div> : null}
                          </td>
                          <td style={money}>{formatRupees(o.duePaise)}</td>
                          <td style={{ ...money, color: o.paidPaise ? '#15803D' : undefined }}>{formatRupees(o.paidPaise)}</td>
                          <td style={{ ...money, fontWeight: 800, color: o.balancePaise > 0 ? '#B91C1C' : '#15803D' }}>{formatRupees(o.balancePaise)}</td>
                          <td style={td}>
                            <span style={{ background: tone.bg, color: tone.fg, border: `1px solid ${tone.border}`, borderRadius: 20, padding: '3px 10px', fontSize: 10.5, fontWeight: 700, whiteSpace: 'nowrap' }}>{STATUS_LABEL[o.status]}</span>
                          </td>
                          <td style={{ ...td, minWidth: 150, maxWidth: 220 }}>
                            <div style={{ color: REMINDER_TONE[rl.tone].color, fontWeight: rl.tone === 'none' ? 500 : 600, lineHeight: 1.4 }}>
                              {REMINDER_TONE[rl.tone].icon} {rl.text}
                            </div>
                            {o.reminders.length > 1 ? <div style={{ color: 'var(--muted)', fontSize: 10.5, marginTop: 2 }}>{o.reminders.length} reminders sent</div> : null}
                          </td>
                          <td style={{ ...td, minWidth: 250 }}>
                            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
                              <button
                                type="button"
                                className="btn btn-sm"
                                disabled={paid || rowBusy}
                                title={paid ? 'Fully paid' : 'Record a payment received'}
                                onClick={() => setOpen({ kind: 'pay', id: o.id })}
                                style={{ background: paid ? '#E2E8F0' : '#16A34A', color: paid ? '#94A3B8' : '#fff', fontWeight: 700, cursor: paid ? 'default' : 'pointer' }}
                              >
                                ₹ Record Payment
                              </button>
                              <button type="button" className="btn btn-outline btn-sm" disabled={rowBusy} onClick={() => setOpen({ kind: 'edit', id: o.id })}>
                                ✎ Edit
                              </button>
                              <button
                                type="button"
                                className="btn btn-outline btn-sm"
                                disabled={paid || rowBusy}
                                title={paid ? 'Fully paid — nothing to remind' : 'Send a payment reminder to the shop'}
                                onClick={() => void remind(o)}
                                style={paid ? { color: '#94A3B8', cursor: 'default' } : { borderColor: '#FCD34D', color: '#B45309' }}
                              >
                                {busy === `${o.id}:remind` ? 'Sending…' : '🔔 Send Reminder'}
                              </button>
                              <button type="button" className="btn btn-outline btn-sm" onClick={() => setOpen({ kind: 'history', id: o.id })}>
                                🕘 History
                              </button>
                              <button type="button" className="btn btn-outline btn-sm" onClick={() => setOpen({ kind: 'preview', id: o.id })} title="Preview what the shop sees">
                                👁 Shop view
                              </button>
                              {canDelete ? (
                                <button type="button" className="btn btn-outline btn-sm" disabled={rowBusy} onClick={() => void remove(o)} style={{ borderColor: '#FCA5A5', color: '#B91C1C' }}>
                                  {busy === `${o.id}:delete` ? 'Deleting…' : 'Delete'}
                                </button>
                              ) : null}
                            </div>
                          </td>
                        </tr>
                      );
                    })
                  )}
                </tbody>
              </table>
            </div>
          </div>

          {/* ── Latest payments ───────────────────────────────────────── */}
          <div className="card mb-4">
            <div className="card-header">
              <div className="card-title">Latest payments</div>
              <div style={{ fontSize: 12, color: 'var(--muted)' }}>last {sum.latest.length} for {scope}</div>
            </div>
            {sum.latest.length === 0 ? (
              <div style={{ padding: 20, textAlign: 'center', color: 'var(--muted)', fontSize: 13 }}>No payment recorded for {scope}.</div>
            ) : (
              <div style={{ overflowX: 'auto', overscrollBehaviorX: 'contain' }}>
                <table style={{ width: '100%', minWidth: 720, borderCollapse: 'collapse', fontSize: 12 }}>
                  <thead>
                    <tr style={{ background: '#F8FAFC', textAlign: 'left' }}>
                      <th style={th}>Received</th>
                      <th style={th}>CRS</th>
                      <th style={th}>For</th>
                      <th style={{ ...th, textAlign: 'right' }}>Amount</th>
                      <th style={th}>Method</th>
                      <th style={th}>UTR</th>
                      <th style={th}>Entered by</th>
                    </tr>
                  </thead>
                  <tbody>
                    {sum.latest.map((p) => (
                      <tr key={p.id} style={{ borderTop: '1px solid #F1F5F9' }}>
                        <td style={{ ...td, whiteSpace: 'nowrap' }}>{dmy(p.date)}</td>
                        <td style={{ ...td, whiteSpace: 'nowrap' }}>CRS {p.ob.crsId}</td>
                        <td style={td}>
                          {whatFor(p.ob)} · {monthYear(p.ob.month, p.ob.year)}
                        </td>
                        <td style={{ ...money, fontWeight: 700, color: '#15803D' }}>{formatRupees(p.amountPaise)}</td>
                        <td style={td}>{methodLabel(p.method)}</td>
                        <td style={{ ...td, fontFamily: 'monospace' }}>{p.utr || '—'}</td>
                        <td style={td}>
                          {p.byName || '—'}
                          <div style={{ color: 'var(--muted)', fontSize: 10.5, marginTop: 2 }}>{dmyTime(p.at)}</div>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        </>
      )}

      {/* ── Forms and views ─────────────────────────────────────────────── */}
      {open?.kind === 'new' && list ? (
        <NewObligationModal
          list={list}
          years={years}
          defaults={{ crsId: filters.crsId, month: filters.month || now.month, year: filters.year || now.year }}
          onClose={() => setOpen(null)}
          onSaved={put}
        />
      ) : null}
      {open?.kind === 'edit' && current ? <EditObligationModal ob={current} onClose={() => setOpen(null)} onSaved={put} /> : null}
      {open?.kind === 'pay' && current ? (
        <PaymentModal
          key={`${current.id}:${open.paymentId ?? 'new'}`}
          ob={current}
          payment={open.paymentId ? (current.payments.find((p) => p.id === open.paymentId) ?? null) : null}
          onClose={() => setOpen(open.back === 'history' ? { kind: 'history', id: current.id } : null)}
          onSaved={put}
        />
      ) : null}
      {open?.kind === 'history' && current ? (
        <HistoryModal ob={current} onClose={() => setOpen(null)} onCorrect={(paymentId) => setOpen({ kind: 'pay', id: current.id, paymentId, back: 'history' })} onSaved={put} />
      ) : null}
      {open?.kind === 'preview' && current ? <PreviewModal ob={current} settings={settings} onClose={() => setOpen(null)} /> : null}

      <style>{PAGE_CSS}</style>
    </div>
  );
}
