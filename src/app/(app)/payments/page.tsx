'use client';

/**
 * Payments.
 *
 * One route, two audiences. An administrator gets the approval queue — the
 * control the whole paywall rests on, since nothing here is verified by a
 * gateway. A shop user gets their own shop's requests and somewhere to finish
 * one they left half-done.
 *
 * The admin's job is a reconciliation: match the UTR against the bank feed,
 * then approve. Approving without that check makes the queue theatre, so the
 * screen puts the reference and the amount next to each other and nothing
 * else competing for attention.
 */
import { useCallback, useEffect, useMemo, useState } from 'react';
import { appAlert, appConfirm } from '@/components/dialog';
import PaymentDialog from '@/components/PaymentDialog';
import { useAuth } from '@/lib/authClient';
import { useShops } from '@/lib/masters';
import { formatRupees } from '@/lib/payments/pricing';
import { decideOrder, fetchOrders, STATUS_COLOR, STATUS_LABEL, type Order } from '@/lib/payments/client';

const MONTHS = ['', 'Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

const FILTERS: { key: string; label: string }[] = [
  { key: 'awaiting_approval', label: 'Awaiting approval' },
  { key: 'pending', label: 'Awaiting payment' },
  { key: 'approved', label: 'Approved' },
  { key: 'rejected', label: 'Rejected' },
  { key: 'all', label: 'All' },
];

function when(iso: string | null) {
  if (!iso) return '—';
  return new Date(iso).toLocaleString('en-IN', { day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' });
}

export default function PaymentsPage() {
  const { user } = useAuth();
  const shops = useShops();
  const isAdmin = user?.role === 'ADMIN';

  const [filter, setFilter] = useState('awaiting_approval');
  const [orders, setOrders] = useState<Order[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [busyId, setBusyId] = useState<number | null>(null);
  const [pay, setPay] = useState<Order | null>(null);
  /** Order id currently being rejected, and the reason being typed for it. */
  const [rejecting, setRejecting] = useState<{ id: number; reason: string } | null>(null);

  const refresh = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      // A shop user's list is already scoped to their shop by the server, so
      // the status filter is the only thing that travels.
      setOrders(await fetchOrders(isAdmin ? filter : 'all'));
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not load payments.');
    } finally {
      setLoading(false);
    }
  }, [filter, isAdmin]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const counts = useMemo(() => {
    const c: Record<string, number> = {};
    for (const o of orders) c[o.status] = (c[o.status] ?? 0) + 1;
    return c;
  }, [orders]);

  const apply = async (o: Order, action: 'approve' | 'reject', reason = '') => {
    setBusyId(o.id);
    try {
      const next = await decideOrder(o.id, action, reason);
      setRejecting(null);
      // A decided order leaves whichever queue it was filtered into.
      setOrders((list) =>
        isAdmin && filter !== 'all' && next.status !== filter
          ? list.filter((x) => x.id !== o.id)
          : list.map((x) => (x.id === o.id ? next : x)),
      );
    } catch (e) {
      void appAlert(e instanceof Error ? e.message : 'Could not save the decision.');
      void refresh();
    } finally {
      setBusyId(null);
    }
  };

  const approve = async (o: Order) => {
    // The one place a human takes responsibility for money this app never saw
    // move. Spelling out what approval unlocks makes that concrete rather than
    // a reflex click.
    const ok = await appConfirm({
      title: 'Approve this payment?',
      message:
        `Confirm that ${formatRupees(o.totalPaise)} against reference ${o.utr} has actually reached the account. ` +
        `Approving permanently unlocks ${o.kind === 'dss' ? 'the DSS download' : `${o.sheetCount} sheet(s)`} for CRS ${o.crsId}.`,
      tone: 'primary',
    });
    if (ok) await apply(o, 'approve');
  };

  return (
    <div className="page active" id="page-payments">
      <div className="page-header">
        <div className="page-title">Payments</div>
        <div className="page-sub">
          {isAdmin
            ? 'Verify each reference against the bank statement before approving — nothing else checks it'
            : 'Your shop’s download payment requests'}
        </div>
      </div>

      {isAdmin ? (
        <div className="card mb-4">
          <div className="card-body flex gap-3" style={{ flexWrap: 'wrap', alignItems: 'center' }}>
            {FILTERS.map((f) => (
              <button
                key={f.key}
                onClick={() => setFilter(f.key)}
                style={{
                  background: filter === f.key ? '#0284C7' : '#fff',
                  color: filter === f.key ? '#fff' : 'var(--text)',
                  border: `1px solid ${filter === f.key ? '#0284C7' : 'var(--border)'}`,
                  borderRadius: 20,
                  padding: '5px 14px',
                  fontSize: 12,
                  fontWeight: 600,
                  cursor: 'pointer',
                }}
              >
                {f.label}
                {counts[f.key] ? ` (${counts[f.key]})` : ''}
              </button>
            ))}
            <button
              onClick={() => void refresh()}
              style={{ marginLeft: 'auto', background: '#fff', border: '1px solid var(--border)', borderRadius: 8, padding: '5px 14px', fontSize: 12, cursor: 'pointer' }}
            >
              ↻ Refresh
            </button>
          </div>
        </div>
      ) : null}

      <div className="card">
        <div className="card-header">
          <div className="card-title">{isAdmin ? 'Approval queue' : 'Your requests'}</div>
          <div style={{ fontSize: 12, color: 'var(--muted)' }}>{orders.length} record(s)</div>
        </div>

        {error ? (
          <div style={{ background: '#FEE2E2', color: '#B91C1C', padding: '12px 16px', fontSize: 12.5 }}>{error}</div>
        ) : null}

        <div style={{ overflowX: 'auto' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12 }}>
            <thead>
              <tr style={{ background: '#F8FAFC', textAlign: 'left' }}>
                <th style={{ padding: '10px 12px', fontWeight: 700 }}>Order</th>
                {isAdmin ? <th style={{ padding: '10px 12px', fontWeight: 700 }}>Shop / User</th> : null}
                <th style={{ padding: '10px 12px', fontWeight: 700 }}>For</th>
                <th style={{ padding: '10px 12px', fontWeight: 700, textAlign: 'right' }}>Amount</th>
                <th style={{ padding: '10px 12px', fontWeight: 700 }}>UTR</th>
                <th style={{ padding: '10px 12px', fontWeight: 700 }}>Status</th>
                <th style={{ padding: '10px 12px', fontWeight: 700, textAlign: 'right' }}>Action</th>
              </tr>
            </thead>
            <tbody>
              {loading ? (
                <tr>
                  <td colSpan={7} style={{ padding: 28, textAlign: 'center', color: 'var(--muted)' }}>
                    Loading…
                  </td>
                </tr>
              ) : orders.length === 0 ? (
                <tr>
                  <td colSpan={7} style={{ padding: 28, textAlign: 'center', color: 'var(--muted)' }}>
                    {isAdmin ? 'Nothing in this queue.' : 'No payment requests yet.'}
                  </td>
                </tr>
              ) : (
                orders.map((o) => {
                  const tone = STATUS_COLOR[o.status];
                  return (
                    <tr key={o.id} style={{ borderTop: '1px solid #F1F5F9' }}>
                      <td style={{ padding: '10px 12px', verticalAlign: 'top' }}>
                        <div style={{ fontWeight: 700 }}>{o.orderNo}</div>
                        <div style={{ color: 'var(--muted)', fontSize: 11, marginTop: 2 }}>{when(o.createdAt)}</div>
                      </td>
                      {isAdmin ? (
                        <td style={{ padding: '10px 12px', verticalAlign: 'top' }}>
                          <div>CRS {o.crsId} — {shops[o.crsId - 1]?.name ?? ''}</div>
                          <div style={{ color: 'var(--muted)', fontSize: 11, marginTop: 2 }}>
                            {o.fullName || o.username} (@{o.username})
                          </div>
                        </td>
                      ) : null}
                      <td style={{ padding: '10px 12px', verticalAlign: 'top' }}>
                        <div>
                          {o.kind === 'dss'
                            ? `DSS — ${o.dayCount} day${o.dayCount === 1 ? '' : 's'}`
                            : `${o.sheetCount} sheet${o.sheetCount === 1 ? '' : 's'}`}
                        </div>
                        <div style={{ color: 'var(--muted)', fontSize: 11, marginTop: 2 }}>
                          {MONTHS[o.month]} {o.year}
                        </div>
                      </td>
                      <td style={{ padding: '10px 12px', textAlign: 'right', verticalAlign: 'top', whiteSpace: 'nowrap' }}>
                        <div style={{ fontWeight: 700 }}>{formatRupees(o.totalPaise)}</div>
                        <div style={{ color: 'var(--muted)', fontSize: 11, marginTop: 2 }}>
                          incl. {formatRupees(o.gstPaise)} GST
                        </div>
                      </td>
                      <td style={{ padding: '10px 12px', verticalAlign: 'top', fontFamily: 'monospace' }}>{o.utr || '—'}</td>
                      <td style={{ padding: '10px 12px', verticalAlign: 'top' }}>
                        <span style={{ background: tone.bg, color: tone.fg, border: `1px solid ${tone.border}`, borderRadius: 20, padding: '3px 10px', fontSize: 10.5, fontWeight: 700, whiteSpace: 'nowrap' }}>
                          {STATUS_LABEL[o.status]}
                        </span>
                        {o.status === 'rejected' && o.rejectReason ? (
                          <div style={{ color: '#B91C1C', fontSize: 11, marginTop: 4, maxWidth: 220 }}>{o.rejectReason}</div>
                        ) : null}
                        {o.decidedAt ? (
                          <div style={{ color: 'var(--muted)', fontSize: 10.5, marginTop: 4 }}>
                            by {o.decidedByName} · {when(o.decidedAt)}
                          </div>
                        ) : null}
                      </td>
                      <td style={{ padding: '10px 12px', textAlign: 'right', verticalAlign: 'top', whiteSpace: 'nowrap' }}>
                        {isAdmin && o.status === 'awaiting_approval' ? (
                          rejecting?.id === o.id ? (
                            <div style={{ display: 'inline-flex', flexDirection: 'column', gap: 6, alignItems: 'stretch', minWidth: 230 }}>
                              <textarea
                                autoFocus
                                value={rejecting.reason}
                                onChange={(e) => setRejecting({ id: o.id, reason: e.target.value })}
                                placeholder="Why? The customer sees this."
                                rows={2}
                                style={{ border: '1px solid var(--border)', borderRadius: 6, padding: '6px 8px', fontSize: 11.5, resize: 'vertical', textAlign: 'left' }}
                              />
                              <div style={{ display: 'flex', gap: 6, justifyContent: 'flex-end' }}>
                                <button
                                  onClick={() => setRejecting(null)}
                                  style={{ background: '#fff', border: '1px solid var(--border)', padding: '5px 12px', borderRadius: 6, fontSize: 11, cursor: 'pointer' }}
                                >
                                  Cancel
                                </button>
                                <button
                                  onClick={() => void apply(o, 'reject', rejecting.reason.trim())}
                                  disabled={busyId === o.id || !rejecting.reason.trim()}
                                  style={{
                                    background: rejecting.reason.trim() ? '#DC2626' : '#94A3B8',
                                    border: 'none',
                                    color: '#fff',
                                    padding: '5px 12px',
                                    borderRadius: 6,
                                    fontSize: 11,
                                    fontWeight: 700,
                                    cursor: rejecting.reason.trim() && busyId !== o.id ? 'pointer' : 'default',
                                  }}
                                >
                                  Confirm reject
                                </button>
                              </div>
                            </div>
                          ) : (
                            <div style={{ display: 'inline-flex', gap: 6 }}>
                              <button
                                onClick={() => void approve(o)}
                                disabled={busyId === o.id}
                                style={{ background: '#16A34A', border: 'none', color: '#fff', padding: '5px 12px', borderRadius: 6, fontSize: 11, fontWeight: 700, cursor: busyId === o.id ? 'default' : 'pointer' }}
                              >
                                ✓ Approve
                              </button>
                              <button
                                onClick={() => setRejecting({ id: o.id, reason: '' })}
                                disabled={busyId === o.id}
                                style={{ background: '#fff', border: '1px solid #FECACA', color: '#B91C1C', padding: '5px 12px', borderRadius: 6, fontSize: 11, fontWeight: 700, cursor: busyId === o.id ? 'default' : 'pointer' }}
                              >
                                ✕ Reject
                              </button>
                            </div>
                          )
                        ) : !isAdmin && (o.status === 'pending' || o.status === 'rejected') ? (
                          <button
                            onClick={() => setPay(o)}
                            style={{ background: '#0284C7', border: 'none', color: '#fff', padding: '5px 12px', borderRadius: 6, fontSize: 11, fontWeight: 700, cursor: 'pointer' }}
                          >
                            Enter UTR
                          </button>
                        ) : (
                          <span style={{ color: 'var(--muted)' }}>—</span>
                        )}
                      </td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>
      </div>

      {pay ? (
        <PaymentDialog
          order={pay}
          upi={null}
          onClose={() => {
            setPay(null);
            void refresh();
          }}
          onSubmitted={(o) => setOrders((list) => list.map((x) => (x.id === o.id ? o : x)))}
        />
      ) : null}
    </div>
  );
}
