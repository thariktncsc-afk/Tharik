'use client';

/**
 * One payment reminder as its shop sees it (office, 2026-10-16): what is owed
 * for which month, what the office has received, what is left, and how to pay
 * it — the office's own QR, its UPI ID, and a button per UPI app.
 *
 * PRESENTATION ONLY. The popup (PaymentReminderPopup), the shop's own list
 * (Payments screen) and the administrator's "what the shop sees" preview
 * all draw this, so it fetches nothing, plays nothing and acknowledges
 * nothing — whoever mounts it does those. It has no frame of its own either:
 * the popup, the list's modal and the preview each put it in theirs.
 *
 * NOTHING HERE RECORDS A PAYMENT. A UPI app opening, or not, is invisible to
 * the server; a payment counts only once the office has matched it against
 * the bank and entered it on Payment Management. The card says so in as many
 * words, so a clerk who tapped "Google Pay" does not take the balance as
 * settled.
 *
 * The QR is the office's uploaded image or nothing — never one made up here.
 * It carries no amount, so the card says what to enter.
 */
import { useEffect, useRef, useState } from 'react';
import { formatRupees } from '@/lib/payments/pricing';
import { dmy, dmyTime } from '@/lib/dateFormat';
import { PAY_METHODS, type PmShopObligation, type PmStatus, type PmUpiConfig, type PmUpiLinks } from '@/lib/paymentMgmt/types';

export type PaymentReminderCardProps = {
  item: PmShopObligation;
  shopName: string;
  upi: PmUpiConfig | null;
  qrUrl: string | null;
};

const MONTHS = ['', 'January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];

/** After a tap, how long the page may stay in view before we say the app did not open. */
const DID_NOT_OPEN_MS = 1600;

const APPS: { key: keyof Pick<PmUpiLinks, 'gpay' | 'phonepe' | 'paytm' | 'upi'>; label: string; bg: string }[] = [
  { key: 'gpay', label: 'Google Pay', bg: '#1A73E8' },
  { key: 'phonepe', label: 'PhonePe', bg: '#5F259F' },
  { key: 'paytm', label: 'Paytm', bg: '#002E6E' },
  { key: 'upi', label: 'Other UPI App', bg: '#0369A1' },
];

const STATUS: Record<PmStatus, { label: string; bg: string; fg: string; border: string }> = {
  unpaid: { label: 'Unpaid', bg: '#FEE2E2', fg: '#B91C1C', border: '#FECACA' },
  partial: { label: 'Partly paid', bg: '#FEF3C7', fg: '#92400E', border: '#FDE68A' },
  paid: { label: 'Fully paid', bg: '#DCFCE7', fg: '#15803D', border: '#86EFAC' },
};

const methodLabel = (id: string) => PAY_METHODS.find((m) => m.id === id)?.label ?? id;

/** Phones get the app buttons' own note; a computer is told to scan instead. */
function onPhone(): boolean {
  const ua = navigator.userAgent;
  // iPadOS reports itself as a Mac; a touch screen gives it away.
  const iPad = /Macintosh/.test(ua) && navigator.maxTouchPoints > 1;
  return /Android|iPhone|iPad|iPod/i.test(ua) || iPad;
}

export default function PaymentReminderCard({ item, shopName, upi, qrUrl }: PaymentReminderCardProps) {
  const [copied, setCopied] = useState(false);
  const [qrBroken, setQrBroken] = useState(false);
  // Assume a phone until the browser says otherwise, so a phone never flashes
  // the computer's note.
  const [phone, setPhone] = useState(true);
  /** The app a tap did not open, for the note under the buttons. */
  const [missed, setMissed] = useState('');
  const watching = useRef<(() => void) | null>(null);

  useEffect(() => setPhone(onPhone()), []);
  useEffect(() => setQrBroken(false), [qrUrl]);
  // A different reminder, a fresh card: no note left over from the last one.
  useEffect(() => setMissed(''), [item.id]);
  useEffect(() => () => watching.current?.(), []);

  const paid = item.status === 'paid' || item.balancePaise <= 0;
  const links = paid ? null : item.links;
  const st = STATUS[paid ? 'paid' : item.status];
  const month = `${MONTHS[item.month] ?? item.month} ${item.year}`;
  const typeText = item.title ? `${item.typeLabel} — ${item.title}` : item.typeLabel;

  const copy = async (vpa: string) => {
    try {
      await navigator.clipboard.writeText(vpa);
      setCopied(true);
      setTimeout(() => setCopied(false), 1600);
    } catch {
      // Clipboard is blocked in some embedded webviews. The UPI ID is on
      // screen and selectable, so this is not worth an error message.
    }
  };

  /**
   * A UPI app that opens takes the page out of view (or at least its focus).
   * If neither has happened 1.6 s after the tap, the app is not on this
   * device — say so, rather than leave the clerk tapping a dead button.
   */
  const tapped = (label: string) => {
    watching.current?.();
    setMissed('');
    let left = false;
    const away = () => {
      if (document.visibilityState === 'hidden') left = true;
    };
    const gone = () => {
      left = true;
    };
    const done = () => {
      clearTimeout(timer);
      document.removeEventListener('visibilitychange', away);
      window.removeEventListener('blur', gone);
      window.removeEventListener('pagehide', gone);
      watching.current = null;
    };
    const timer = setTimeout(() => {
      done();
      if (!left && document.visibilityState === 'visible') setMissed(label);
    }, DID_NOT_OPEN_MS);
    document.addEventListener('visibilitychange', away);
    window.addEventListener('blur', gone);
    window.addEventListener('pagehide', gone);
    watching.current = done;
  };

  const row = (label: string, value: React.ReactNode, strong = false) => (
    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', gap: 12, padding: '7px 0', borderTop: '1px solid #F1F5F9' }}>
      <span style={{ color: 'var(--muted)', fontSize: 13 }}>{label}</span>
      <span style={{ fontWeight: strong ? 800 : 600, fontSize: strong ? 17 : 14, textAlign: 'right', wordBreak: 'break-word' }}>{value}</span>
    </div>
  );

  return (
    <div style={{ background: '#fff' }}>
      {/* ── Heading ──────────────────────────────────────────────────────── */}
      <div
        style={{
          background: paid ? 'linear-gradient(135deg,#15803D,#22C55E)' : 'linear-gradient(135deg,#991B1B,#DC2626)',
          color: '#fff',
          padding: '16px 18px',
        }}
      >
        <div style={{ fontWeight: 800, fontSize: 18, lineHeight: 1.3 }}>
          Payment Reminder — CRS {item.crsId}
        </div>
        {shopName ? <div style={{ fontSize: 12.5, opacity: 0.9, marginTop: 2 }}>{shopName}</div> : null}
      </div>

      <div style={{ padding: '14px 18px 18px' }}>
        {/* ── What is owed ─────────────────────────────────────────────── */}
        <div style={{ display: 'flex', justifyContent: 'flex-end', marginBottom: 6 }}>
          <span style={{ background: st.bg, color: st.fg, border: `1px solid ${st.border}`, borderRadius: 20, padding: '3px 10px', fontSize: 11, fontWeight: 700 }}>{st.label}</span>
        </div>
        {row('Month', month)}
        {row('Payment Type', typeText)}
        {item.reference ? row('Reference', item.reference) : null}
        {row('Total Amount Due', formatRupees(item.duePaise))}
        {row('Amount Paid', formatRupees(item.paidPaise))}
        <div style={{ borderTop: '1px solid #F1F5F9' }}>
          <div
            style={{
              display: 'flex',
              justifyContent: 'space-between',
              alignItems: 'baseline',
              gap: 12,
              margin: '8px 0 0',
              padding: '10px 12px',
              borderRadius: 10,
              background: paid ? '#F0FDF4' : '#FEF2F2',
              border: `1px solid ${paid ? '#BBF7D0' : '#FECACA'}`,
            }}
          >
            <span style={{ fontWeight: 700, fontSize: 13.5, color: paid ? '#15803D' : '#991B1B' }}>Outstanding Balance</span>
            <span style={{ fontWeight: 900, fontSize: 22, color: paid ? '#15803D' : '#B91C1C' }}>{formatRupees(Math.max(0, item.balancePaise))}</span>
          </div>
        </div>

        {/* The message asks for the balance; once it is paid, "Fully paid" says it instead. */}
        {item.message && !paid ? <div style={{ fontSize: 14, lineHeight: 1.6, marginTop: 14, color: 'var(--text)' }}>{item.message}</div> : null}

        {/* ── How to pay ───────────────────────────────────────────────── */}
        {paid ? (
          <div style={{ marginTop: 14, background: '#DCFCE7', border: '1px solid #86EFAC', color: '#15803D', borderRadius: 10, padding: '10px 14px', fontSize: 14, fontWeight: 700 }}>
            ✓ Fully paid — nothing is outstanding.
          </div>
        ) : (
          <div style={{ marginTop: 16 }}>
            {qrUrl && !qrBroken ? (
              <div style={{ textAlign: 'center', marginBottom: 12 }}>
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img
                  key={qrUrl}
                  src={qrUrl}
                  alt="The office's UPI QR code"
                  width={220}
                  height={220}
                  onError={() => setQrBroken(true)}
                  style={{ width: 220, height: 220, maxWidth: '100%', objectFit: 'contain', border: '1px solid var(--border)', borderRadius: 10, padding: 6, background: '#fff' }}
                />
                <div style={{ fontSize: 12, color: 'var(--muted)', marginTop: 6, lineHeight: 1.5 }}>
                  Scan with any UPI app and enter <strong style={{ color: 'var(--text)' }}>{formatRupees(item.balancePaise)}</strong>.
                </div>
              </div>
            ) : (
              <div style={{ background: '#F8FAFC', border: '1px solid var(--border)', borderRadius: 10, padding: '10px 12px', fontSize: 12.5, color: 'var(--muted)', marginBottom: 12, lineHeight: 1.5 }}>
                {qrUrl
                  ? 'The office’s QR code could not be loaded just now.'
                  : 'The office has not set a QR code yet.'}
                {upi ? ' Pay to the UPI ID below.' : ''}
              </div>
            )}

            {upi ? (
              <div style={{ display: 'flex', gap: 8, alignItems: 'center', marginBottom: 10, flexWrap: 'wrap' }}>
                <div style={{ flex: '1 1 200px', minWidth: 0, border: '1px solid var(--border)', borderRadius: 8, padding: '8px 10px', fontSize: 13, wordBreak: 'break-all' }}>
                  <div style={{ fontSize: 10.5, color: 'var(--muted)', marginBottom: 2 }}>UPI ID</div>
                  <strong>{upi.vpa}</strong>
                  {upi.payeeName ? <div style={{ fontSize: 11.5, color: 'var(--muted)' }}>{upi.payeeName}</div> : null}
                </div>
                <button
                  type="button"
                  onClick={() => void copy(upi.vpa)}
                  style={{ background: '#fff', border: '1px solid var(--border)', borderRadius: 8, padding: '10px 14px', fontSize: 12.5, cursor: 'pointer', fontWeight: 700 }}
                >
                  {copied ? '✓ Copied' : 'Copy'}
                </button>
              </div>
            ) : (
              <div style={{ background: '#FEF3C7', border: '1px solid #FDE68A', color: '#92400E', borderRadius: 10, padding: '10px 12px', fontSize: 12.5, marginBottom: 10, lineHeight: 1.5 }}>
                The office has not set up its UPI ID yet. Please contact the office to pay.
              </div>
            )}

            {links ? (
              <>
                <div style={{ fontSize: 12, color: 'var(--muted)', marginBottom: 8 }}>
                  Payment reference: <strong style={{ color: 'var(--text)' }}>{links.reference}</strong>
                </div>
                {!phone ? (
                  <div style={{ background: '#EFF6FF', border: '1px solid #BFDBFE', color: '#1E40AF', borderRadius: 10, padding: '9px 12px', fontSize: 12.5, marginBottom: 10, lineHeight: 1.5 }}>
                    UPI app buttons work on a phone. On this computer, scan the QR code with your phone.
                  </div>
                ) : null}
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
                  {APPS.map((a) => (
                    <a
                      key={a.key}
                      href={links[a.key]}
                      onClick={() => tapped(a.label)}
                      style={{
                        flex: '1 1 140px',
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'center',
                        minHeight: 46,
                        textAlign: 'center',
                        background: a.bg,
                        color: '#fff',
                        padding: '10px 12px',
                        borderRadius: 10,
                        fontSize: 14,
                        fontWeight: 700,
                        textDecoration: 'none',
                      }}
                    >
                      {a.label}
                    </a>
                  ))}
                </div>
                {missed ? (
                  <div role="status" style={{ background: '#FEF3C7', border: '1px solid #FDE68A', color: '#92400E', borderRadius: 10, padding: '9px 12px', fontSize: 12.5, marginTop: 10, lineHeight: 1.5 }}>
                    {missed === 'Other UPI App' ? 'No UPI app opened on this device.' : `${missed} did not open on this device.`}{' '}
                    {qrUrl && !qrBroken ? 'Scan the QR code from another phone, or try another app.' : 'Pay to the UPI ID from another phone, or try another app.'}
                  </div>
                ) : null}
              </>
            ) : null}

            {links || upi || qrUrl ? (
              <div style={{ fontSize: 12, color: 'var(--muted)', marginTop: 12, lineHeight: 1.5 }}>
                Opening an app does not record a payment — the office confirms it.
              </div>
            ) : null}
          </div>
        )}

        {/* ── What the office has received ─────────────────────────────── */}
        {item.payments.length ? (
          <div style={{ marginTop: 16 }}>
            <div style={{ fontSize: 11, fontWeight: 700, color: 'var(--muted)', textTransform: 'uppercase', letterSpacing: 0.4, marginBottom: 4 }}>Payments received</div>
            {item.payments.map((p, i) => (
              <div key={i} style={{ display: 'flex', justifyContent: 'space-between', gap: 10, fontSize: 12.5, padding: '5px 0', borderTop: '1px solid #F1F5F9' }}>
                <span>
                  {dmy(p.date)} · {methodLabel(p.method)}
                </span>
                <strong>{formatRupees(p.amountPaise)}</strong>
              </div>
            ))}
          </div>
        ) : null}

        {/* ── When the reminder came, and who said OK ──────────────────── */}
        <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', marginTop: 14, fontSize: 11.5, color: '#94A3B8' }}>
          <span>Reminder sent {dmyTime(item.reminder.at)}</span>
          {item.reminder.ackAt ? (
            <span style={{ color: '#166534', fontWeight: 700 }}>
              ✓ Acknowledged {dmyTime(item.reminder.ackAt)}
              {item.reminder.ackName ? ` by ${item.reminder.ackName}` : ''}
            </span>
          ) : null}
        </div>
      </div>
    </div>
  );
}
