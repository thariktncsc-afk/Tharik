'use client';

/**
 * Payment Access Control — administrators choose, shop by shop, whether the
 * DSS and the Statements need paying for (src/lib/payments/gate.ts).
 *
 * 🔴 ON = Payment Required: the existing pay → approve → open flow.
 * 🟢 OFF = Free Access: Preview, Print and Download open at once.
 *
 * The switches are enforced on the server (/api/statements/render,
 * /api/payments/access, order creation); this page only sets them. Changes
 * reach an open shop screen through live sync, so nobody refreshes. Payment
 * orders and approvals are never touched by a switch.
 */
import { useCallback, useEffect, useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import { useAuth } from '@/lib/authClient';
import { useShops } from '@/lib/masters';
import { useStore } from '@/lib/dataStore';
import { appAlert, appConfirm } from '@/components/dialog';
import { GATE_LABEL, type GateKind } from '@/lib/payments/gate';

type Row = { crsId: number; dss: boolean; statement: boolean };
type Filter = 'all' | 'dss-on' | 'dss-off' | 'stmt-on' | 'stmt-off';

const FILTERS: [Filter, string][] = [
  ['all', 'All shops'],
  ['dss-on', 'DSS: Payment Required'],
  ['dss-off', 'DSS: Free'],
  ['stmt-on', 'Statement: Payment Required'],
  ['stmt-off', 'Statement: Free'],
];

export default function PaymentAccessPage() {
  const { user, status } = useAuth();
  const router = useRouter();
  const isAdmin = user?.role === 'ADMIN';
  const shops = useShops();
  // Another administrator's change arrives by live sync; the list re-reads.
  const gateRow = useStore<unknown>('__paymentGate');

  const [rows, setRows] = useState<Row[] | null>(null);
  const [charging, setCharging] = useState(true);
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState<string>('');
  const [q, setQ] = useState('');
  const [filter, setFilter] = useState<Filter>('all');

  useEffect(() => {
    if (status === 'signedIn' && user && !isAdmin) router.replace('/dashboard');
  }, [status, user, isAdmin, router]);

  const load = useCallback(async () => {
    try {
      const r = await fetch('/api/payments/gate', { cache: 'no-store' });
      const b = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(b?.error || `Server returned ${r.status}`);
      setRows(b.shops);
      setCharging(b.charging !== false);
      setErr('');
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    }
  }, []);

  useEffect(() => {
    if (isAdmin) void load();
  }, [isAdmin, load, gateRow]);

  const send = async (body: Record<string, unknown>, key: string) => {
    setBusy(key);
    try {
      const r = await fetch('/api/payments/gate', { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
      const b = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(b?.error || `Server returned ${r.status}`);
      setRows(b.shops);
    } catch (e) {
      void appAlert({ title: 'Not saved', tone: 'danger', message: e instanceof Error ? e.message : String(e) });
    } finally {
      setBusy('');
    }
  };

  const toggle = (row: Row, kind: GateKind) => void send({ crsId: row.crsId, kind, required: !row[kind] }, `${row.crsId}:${kind}`);

  const bulk = async (kind: GateKind, required: boolean) => {
    const ok = await appConfirm({
      title: `${required ? 'Enable' : 'Disable'} ${GATE_LABEL[kind]} payment for all shops`,
      tone: 'warning',
      message: `${required ? 'Enable' : 'Disable'} ${GATE_LABEL[kind]} payment requirement for all CRS shops?`,
      cancelLabel: 'Cancel',
      confirmLabel: 'Confirm',
      defaultCancel: true,
    });
    if (ok) await send({ all: true, kind, required }, `all:${kind}`);
  };

  const name = (id: number) => shops.find((s) => s.id === id)?.name ?? '';
  const visible = useMemo(() => {
    const term = q.trim().toLowerCase().replace(/^crs\s*/, '');
    return (rows ?? []).filter((r) => {
      if (filter === 'dss-on' && !r.dss) return false;
      if (filter === 'dss-off' && r.dss) return false;
      if (filter === 'stmt-on' && !r.statement) return false;
      if (filter === 'stmt-off' && r.statement) return false;
      if (!term) return true;
      return String(r.crsId) === term || `crs ${r.crsId}`.includes(q.trim().toLowerCase()) || name(r.crsId).toLowerCase().includes(q.trim().toLowerCase());
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rows, q, filter, shops]);

  const counts = useMemo(() => {
    const r = rows ?? [];
    return { dssOn: r.filter((x) => x.dss).length, stmtOn: r.filter((x) => x.statement).length, total: r.length };
  }, [rows]);

  if (!isAdmin) {
    return (
      <div className="page active">
        <div className="card" style={{ padding: 30, textAlign: 'center', color: 'var(--muted)' }}>Payment Access Control is for administrators only.</div>
      </div>
    );
  }

  const sw = (row: Row, kind: GateKind) => {
    const on = row[kind];
    const key = `${row.crsId}:${kind}`;
    return (
      <button
        type="button"
        role="switch"
        aria-checked={on}
        aria-label={`CRS ${row.crsId} ${GATE_LABEL[kind]} payment ${on ? 'required' : 'free'}`}
        disabled={!!busy}
        onClick={() => toggle(row, kind)}
        title={on ? 'Payment Required — click to make it free' : 'Free Access — click to require payment'}
        style={{
          display: 'inline-flex', alignItems: 'center', gap: 8, minWidth: 176, justifyContent: 'flex-start',
          border: `1px solid ${on ? '#FCA5A5' : '#86EFAC'}`, background: on ? '#FEF2F2' : '#F0FDF4', color: on ? '#B91C1C' : '#15803D',
          borderRadius: 999, padding: '5px 12px 5px 5px', fontSize: 12.5, fontWeight: 700, cursor: busy ? 'wait' : 'pointer', opacity: busy === key ? 0.6 : 1,
        }}
      >
        <span style={{ position: 'relative', width: 38, height: 22, borderRadius: 999, background: on ? '#DC2626' : '#16A34A', flexShrink: 0 }}>
          <span style={{ position: 'absolute', top: 3, left: on ? 19 : 3, width: 16, height: 16, borderRadius: '50%', background: '#fff', transition: 'left .15s' }} />
        </span>
        {on ? '🔴 ON – Payment Required' : '🟢 OFF – Free Access'}
      </button>
    );
  };

  const bulkBtn = (label: string, onClick: () => void, tone: 'on' | 'off') => (
    <button
      type="button"
      disabled={!!busy}
      onClick={onClick}
      style={{ border: `1px solid ${tone === 'on' ? '#FCA5A5' : '#86EFAC'}`, background: '#fff', color: tone === 'on' ? '#B91C1C' : '#15803D', borderRadius: 8, padding: '7px 12px', fontSize: 12.5, fontWeight: 700, cursor: 'pointer' }}
    >
      {label}
    </button>
  );

  return (
    <div className="page active" id="page-payment-access">
      <div className="page-header">
        <div className="page-title">Payment Access Control</div>
        <div className="page-sub">Choose, for each CRS shop, whether the DSS and the Statements need paying for. Administrators always open both free.</div>
      </div>

      {!charging ? (
        <div style={{ background: '#FFFBEB', border: '1px solid #FDE68A', color: '#92400E', borderRadius: 10, padding: '10px 14px', marginBottom: 14, fontSize: 13 }}>
          <strong>Charging is switched off in Settings,</strong> so every shop has free access right now. These switches take effect once charging is on.
        </div>
      ) : null}

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(260px, 1fr))', gap: 12, marginBottom: 14 }}>
        {(['dss', 'statement'] as GateKind[]).map((kind) => (
          <div key={kind} className="card" style={{ padding: 14 }}>
            <div style={{ fontWeight: 800, fontSize: 14 }}>{kind === 'dss' ? '📄 DSS' : '📑 Statements'}</div>
            <div style={{ fontSize: 12, color: 'var(--muted)', margin: '2px 0 10px' }}>
              {rows ? `${kind === 'dss' ? counts.dssOn : counts.stmtOn} of ${counts.total} shops require payment` : '…'}
            </div>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
              {bulkBtn('🔴 Enable Payment for All', () => void bulk(kind, true), 'on')}
              {bulkBtn('🟢 Disable Payment for All', () => void bulk(kind, false), 'off')}
            </div>
          </div>
        ))}
      </div>

      <div className="card" style={{ padding: 12, marginBottom: 14, display: 'flex', flexWrap: 'wrap', gap: 10, alignItems: 'center' }}>
        <input
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder="Search: CRS 20, 20 or shop name"
          aria-label="Search shops"
          style={{ flex: '1 1 200px', minWidth: 0, border: '1px solid var(--border)', borderRadius: 8, padding: '8px 10px', fontSize: 13 }}
        />
        <select value={filter} onChange={(e) => setFilter(e.target.value as Filter)} aria-label="Filter" style={{ flex: '0 1 240px', border: '1px solid var(--border)', borderRadius: 8, padding: '8px 10px', fontSize: 13, background: '#fff' }}>
          {FILTERS.map(([id, label]) => (
            <option key={id} value={id}>
              {label}
            </option>
          ))}
        </select>
        <span style={{ fontSize: 12, color: 'var(--muted)' }}>{rows ? `${visible.length} of ${rows.length} shown` : ''}</span>
      </div>

      {err ? <div style={{ background: '#FEF2F2', border: '1px solid #FCA5A5', color: '#B91C1C', borderRadius: 10, padding: '10px 14px', marginBottom: 14, fontSize: 13 }}>{err}</div> : null}

      {!rows ? (
        <div className="card" style={{ padding: 30, textAlign: 'center', color: 'var(--muted)' }}>Loading…</div>
      ) : (
        <div className="card" style={{ padding: 0, overflow: 'hidden' }}>
          <div className="pac-head" style={{ display: 'grid', gridTemplateColumns: 'minmax(160px, 1fr) 200px 200px', gap: 10, padding: '10px 16px', background: '#F8FAFC', borderBottom: '1px solid #E2E8F0', fontSize: 11, fontWeight: 800, color: 'var(--muted)', textTransform: 'uppercase', letterSpacing: '.05em' }}>
            <span>CRS Shop</span>
            <span>DSS Payment Required</span>
            <span>Statement Payment Required</span>
          </div>
          {visible.map((r) => (
            <div key={r.crsId} className="pac-row" style={{ display: 'grid', gridTemplateColumns: 'minmax(160px, 1fr) 200px 200px', gap: 10, padding: '10px 16px', borderBottom: '1px solid #F1F5F9', alignItems: 'center' }}>
              <span style={{ minWidth: 0 }}>
                <strong style={{ color: '#0369A1' }}>CRS {r.crsId}</strong>
                <span style={{ color: 'var(--muted)', fontSize: 12.5 }}> — {name(r.crsId)}</span>
              </span>
              <span className="pac-cell" data-label="DSS">{sw(r, 'dss')}</span>
              <span className="pac-cell" data-label="Statement">{sw(r, 'statement')}</span>
            </div>
          ))}
          {!visible.length ? <div style={{ padding: 24, textAlign: 'center', color: 'var(--muted)', fontSize: 13 }}>No shop matches.</div> : null}
        </div>
      )}

      {/* Phones: one card per shop, the two switches stacked under its name. */}
      <style>{`
        @media (max-width: 640px) {
          #page-payment-access .pac-head { display: none !important; }
          #page-payment-access .pac-row { grid-template-columns: 1fr !important; gap: 8px !important; }
          #page-payment-access .pac-cell { display: flex; align-items: center; justify-content: space-between; gap: 8px; }
          #page-payment-access .pac-cell::before { content: attr(data-label); font-size: 11px; font-weight: 800; color: var(--muted); text-transform: uppercase; }
        }
      `}</style>
    </div>
  );
}
