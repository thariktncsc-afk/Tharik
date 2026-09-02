'use client';

/**
 * The customer's side of a fee order: what is owed, how to pay it, and the box
 * for the reference number afterwards.
 *
 * Three states in one dialog, because they are three moments in one errand and
 * splitting them across screens loses the order number:
 *
 *   pending            → QR / UPI ID / link, then "I have paid" + UTR
 *   awaiting_approval  → nothing to do but wait for the office
 *   rejected           → the reason, and a second chance at the UTR
 *
 * Nothing here decides entitlement. It reports what the server said.
 */
import { useEffect, useRef, useState } from 'react';
import { formatRupees } from '@/lib/payments/pricing';
import { fetchOrder, STATUS_COLOR, STATUS_LABEL, submitUtr, type Order, type Upi } from '@/lib/payments/client';

const MONTHS = ['', 'January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];

type Props = {
  order: Order;
  upi: Upi | null;
  /** Section id → label, so the dialog can name what is being bought. */
  labels?: Record<string, string>;
  onClose: () => void;
  /** Fired after a successful UTR submission, with the updated order. */
  onSubmitted: (order: Order) => void;
};

export default function PaymentDialog({ order: initial, upi: given, labels = {}, onClose, onSubmitted }: Props) {
  const [order, setOrder] = useState(initial);
  const [upi, setUpi] = useState<Upi | null>(given);
  const [utr, setUtr] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [copied, setCopied] = useState('');
  const boxRef = useRef<HTMLDivElement>(null);

  useEffect(() => setOrder(initial), [initial]);

  // Opened from a list rather than straight after checkout, so the QR was
  // never handed over. Fetch the intent instead of telling the customer to go
  // and find it somewhere else.
  useEffect(() => {
    if (given || (initial.status !== 'pending' && initial.status !== 'rejected')) return;
    let alive = true;
    fetchOrder(initial.id)
      .then((r) => {
        if (!alive) return;
        setOrder(r.order);
        setUpi(r.upi);
      })
      .catch(() => {
        /* The amount and order number are already on screen; the UPI block
           simply stays hidden with its own explanation. */
      });
    return () => {
      alive = false;
    };
  }, [given, initial.id, initial.status]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && !busy) onClose();
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [busy, onClose]);

  const copy = async (what: string, value: string) => {
    try {
      await navigator.clipboard.writeText(value);
      setCopied(what);
      setTimeout(() => setCopied(''), 1600);
    } catch {
      // Clipboard is blocked in some embedded webviews. The value is on screen
      // and selectable, so this is not worth an error message.
    }
  };

  const submit = async () => {
    setBusy(true);
    setError('');
    try {
      const next = await submitUtr(order.id, utr.trim());
      setOrder(next);
      onSubmitted(next);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not record the reference.');
    } finally {
      setBusy(false);
    }
  };

  const tone = STATUS_COLOR[order.status];
  const what =
    order.kind === 'dss'
      ? `DSS bulk download — ${order.dayCount} day${order.dayCount === 1 ? '' : 's'}`
      : `${order.sheetCount} statement sheet${order.sheetCount === 1 ? '' : 's'}`;

  const canPay = order.status === 'pending' || order.status === 'rejected';

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label="Payment"
      style={{
        position: 'fixed',
        inset: 0,
        zIndex: 9700,
        background: 'rgba(13,30,63,.55)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        padding: 20,
        overflow: 'auto',
      }}
      onMouseDown={(e) => {
        if (e.target === e.currentTarget && !busy) onClose();
      }}
    >
      <div
        ref={boxRef}
        style={{
          background: '#fff',
          borderRadius: 14,
          width: 'min(460px, 100%)',
          maxHeight: '92vh',
          overflow: 'auto',
          boxShadow: '0 24px 60px rgba(2,17,45,.35)',
        }}
      >
        <div style={{ background: 'linear-gradient(135deg,#0369A1,#0EA5E9)', color: '#fff', padding: '16px 20px', borderRadius: '14px 14px 0 0' }}>
          <div style={{ fontWeight: 800, fontSize: 15 }}>Download fee</div>
          <div style={{ fontSize: 11.5, opacity: 0.85, marginTop: 3 }}>
            Order {order.orderNo} · CRS {order.crsId} · {MONTHS[order.month]} {order.year}
          </div>
        </div>

        <div style={{ padding: 20 }}>
          {/* ── What is owed ─────────────────────────────────────────────── */}
          <div style={{ border: '1px solid var(--border)', borderRadius: 10, padding: 14, marginBottom: 14 }}>
            <div style={{ fontSize: 12, fontWeight: 700, marginBottom: 8 }}>{what}</div>

            {order.kind === 'statement' && order.sectionIds.length ? (
              <div style={{ fontSize: 11, color: 'var(--muted)', lineHeight: 1.6, marginBottom: 10 }}>
                {order.sectionIds.map((id) => labels[id] ?? id).join(' · ')}
              </div>
            ) : null}

            <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 12, padding: '3px 0' }}>
              <span style={{ color: 'var(--muted)' }}>Taxable value</span>
              <span>{formatRupees(order.basePaise)}</span>
            </div>
            <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 12, padding: '3px 0' }}>
              <span style={{ color: 'var(--muted)' }}>
                GST @ {(order.gstRateBp / 100).toFixed(order.gstRateBp % 100 ? 2 : 0)}%
                {order.gstInclusive ? ' (included)' : ''}
              </span>
              <span>{formatRupees(order.gstPaise)}</span>
            </div>
            <div
              style={{
                display: 'flex',
                justifyContent: 'space-between',
                fontSize: 15,
                fontWeight: 800,
                paddingTop: 8,
                marginTop: 6,
                borderTop: '1px solid var(--border)',
              }}
            >
              <span>Total payable</span>
              <span>{formatRupees(order.totalPaise)}</span>
            </div>
          </div>

          {/* ── Status ───────────────────────────────────────────────────── */}
          <div
            style={{
              background: tone.bg,
              color: tone.fg,
              border: `1px solid ${tone.border}`,
              borderRadius: 8,
              padding: '8px 12px',
              fontSize: 12,
              fontWeight: 700,
              marginBottom: 14,
            }}
          >
            {STATUS_LABEL[order.status]}
            {order.status === 'rejected' && order.rejectReason ? (
              <div style={{ fontWeight: 500, marginTop: 4, lineHeight: 1.5 }}>{order.rejectReason}</div>
            ) : null}
            {order.status === 'awaiting_approval' ? (
              <div style={{ fontWeight: 500, marginTop: 4, lineHeight: 1.5 }}>
                The office will check reference {order.utr} against the bank statement. The download unlocks as soon as it is approved.
              </div>
            ) : null}
          </div>

          {/* ── Pay ──────────────────────────────────────────────────────── */}
          {canPay && upi ? (
            <>
              {upi.qr ? (
                <div style={{ textAlign: 'center', marginBottom: 12 }}>
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img
                    src={upi.qr}
                    alt={`UPI QR code for ${formatRupees(order.totalPaise)}`}
                    width={200}
                    height={200}
                    style={{ border: '1px solid var(--border)', borderRadius: 10, padding: 6, background: '#fff' }}
                  />
                  <div style={{ fontSize: 11, color: 'var(--muted)', marginTop: 6 }}>Scan with any UPI app</div>
                </div>
              ) : null}

              <div style={{ display: 'flex', gap: 8, alignItems: 'center', marginBottom: 8 }}>
                <div style={{ flex: 1, border: '1px solid var(--border)', borderRadius: 8, padding: '8px 10px', fontSize: 12.5, wordBreak: 'break-all' }}>
                  <div style={{ fontSize: 10, color: 'var(--muted)', marginBottom: 2 }}>UPI ID</div>
                  <strong>{upi.vpa}</strong>
                  {upi.payeeName ? <div style={{ fontSize: 11, color: 'var(--muted)' }}>{upi.payeeName}</div> : null}
                </div>
                <button
                  type="button"
                  onClick={() => copy('vpa', upi.vpa)}
                  style={{ background: '#fff', border: '1px solid var(--border)', borderRadius: 8, padding: '8px 12px', fontSize: 11.5, cursor: 'pointer', fontWeight: 600 }}
                >
                  {copied === 'vpa' ? '✓ Copied' : 'Copy'}
                </button>
              </div>

              <a
                href={upi.uri}
                style={{
                  display: 'block',
                  textAlign: 'center',
                  background: '#0284C7',
                  color: '#fff',
                  padding: '10px 14px',
                  borderRadius: 8,
                  fontSize: 13,
                  fontWeight: 700,
                  textDecoration: 'none',
                  marginBottom: 16,
                }}
              >
                Open UPI app — pay {formatRupees(order.totalPaise)}
              </a>

              {/* ── UTR ──────────────────────────────────────────────────── */}
              <label className="form-label" htmlFor="pay-utr">
                UPI reference (UTR) after paying
              </label>
              <input
                id="pay-utr"
                value={utr}
                onChange={(e) => setUtr(e.target.value.replace(/\D/g, '').slice(0, 12))}
                inputMode="numeric"
                placeholder="12-digit reference from your payment app"
                style={{ width: '100%', border: '1px solid var(--border)', borderRadius: 8, padding: '9px 12px', fontSize: 13, letterSpacing: 0.5 }}
              />
              <div style={{ fontSize: 11, color: 'var(--muted)', marginTop: 6, lineHeight: 1.5 }}>
                Quote order <strong>{order.orderNo}</strong> if the office asks. The download stays locked until an administrator approves this payment.
              </div>

              {error ? (
                <div style={{ background: '#FEE2E2', color: '#B91C1C', border: '1px solid #FECACA', borderRadius: 8, padding: '8px 12px', fontSize: 12, marginTop: 10 }}>
                  {error}
                </div>
              ) : null}
            </>
          ) : null}

          {canPay && !upi ? (
            <div style={{ background: '#FEF3C7', color: '#92400E', border: '1px solid #FDE68A', borderRadius: 8, padding: '10px 12px', fontSize: 12, marginBottom: 12 }}>
              The payment details could not be loaded. Check that a UPI ID is configured in Settings, or quote order{' '}
              <strong>{order.orderNo}</strong> to the office.
            </div>
          ) : null}

          {/* ── Actions ──────────────────────────────────────────────────── */}
          <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end', marginTop: 16 }}>
            <button
              type="button"
              onClick={onClose}
              disabled={busy}
              style={{ background: '#fff', border: '1px solid var(--border)', borderRadius: 8, padding: '8px 16px', fontSize: 12.5, cursor: busy ? 'default' : 'pointer' }}
            >
              Close
            </button>
            {canPay ? (
              <button
                type="button"
                onClick={submit}
                disabled={busy || utr.trim().length !== 12}
                style={{
                  background: utr.trim().length === 12 && !busy ? '#16A34A' : '#94A3B8',
                  border: 'none',
                  color: '#fff',
                  borderRadius: 8,
                  padding: '8px 16px',
                  fontSize: 12.5,
                  fontWeight: 700,
                  cursor: utr.trim().length === 12 && !busy ? 'pointer' : 'default',
                }}
              >
                {busy ? 'Sending…' : 'I have paid'}
              </button>
            ) : null}
          </div>
        </div>
      </div>
    </div>
  );
}
