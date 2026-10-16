'use client';

/**
 * Payment Reminders — a shop's own, on its Payments screen (office,
 * 2026-10-16).
 *
 * Every obligation the office has sent this shop a reminder for, newest
 * reminder first: what was due, what has been received, what is left, and
 * whether the reminder has been acknowledged. "Open" shows the same card the
 * popup shows — QR, UPI ID, app buttons — without the sound and without
 * asking for OK; OK belongs to the popup, which is up whenever one is waiting.
 *
 * The section appears only when the shop has a reminder (a shop with none
 * sees its Payments screen exactly as before). The bell links here as
 * /payments?ob=<id>, handed in as `ob`, which opens that one at once. The
 * list is the server's (/api/payment-management/mine, scoped to the
 * session's shop), re-read when the inbox or the 'paymgmt' live topic moves,
 * so a payment the office records shows here without a refresh.
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import PaymentReminderCard from '@/components/PaymentReminderCard';
import { useLiveRevision } from '@/lib/dataStore';
import { dmyTime } from '@/lib/dateFormat';
import { useInboxRevision } from '@/lib/notify/client';
import { fetchMine } from '@/lib/paymentMgmt/client';
import type { PmMine, PmShopObligation, PmStatus } from '@/lib/paymentMgmt/types';
import { formatRupees } from '@/lib/payments/pricing';

const MONTHS = ['', 'January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];

const STATUS: Record<PmStatus, { label: string; bg: string; fg: string; border: string }> = {
  unpaid: { label: 'Unpaid', bg: '#FEE2E2', fg: '#B91C1C', border: '#FECACA' },
  partial: { label: 'Partly paid', bg: '#FEF3C7', fg: '#92400E', border: '#FDE68A' },
  paid: { label: 'Fully paid', bg: '#DCFCE7', fg: '#15803D', border: '#86EFAC' },
};

const CSS = `
.pmr-page-overlay{position:fixed;inset:0;z-index:9500;background:rgba(13,30,63,.55);display:flex;align-items:center;justify-content:center;padding:16px}
.pmr-page-box{background:#fff;border-radius:14px;width:min(520px,100%);max-height:calc(100vh - 32px);max-height:calc(100dvh - 32px);display:flex;flex-direction:column;overflow:hidden;box-shadow:0 24px 60px rgba(2,17,45,.35)}
.pmr-page-scroll{flex:1 1 auto;overflow-y:auto;-webkit-overflow-scrolling:touch;overscroll-behavior:contain}
.pmr-page-foot{flex:0 0 auto;padding:10px 16px calc(10px + env(safe-area-inset-bottom,0px));border-top:1px solid var(--border);display:flex;justify-content:flex-end}
@media (max-width:560px){
  .pmr-page-overlay{padding:0}
  .pmr-page-box{width:100%;height:100vh;height:100dvh;max-height:none;border-radius:0}
  .pmr-page-foot button{width:100%}
}
`;

export default function ShopReminders({ ob, onDoneWithOb }: { ob: string | null; onDoneWithOb: () => void }) {
  const [mine, setMine] = useState<PmMine | null>(null);
  const [error, setError] = useState('');
  const [openId, setOpenId] = useState<string | null>(null);
  const inboxRev = useInboxRevision();
  const pmRev = useLiveRevision('paymgmt');
  const seq = useRef(0);

  const load = useCallback(async () => {
    const n = ++seq.current;
    try {
      const next = await fetchMine();
      if (n !== seq.current) return;
      setMine(next);
      setError('');
    } catch (e) {
      if (n !== seq.current) return;
      setError(e instanceof Error ? e.message : String(e));
    }
  }, []);

  // Quietly: a list already on screen stays while the next answer comes.
  useEffect(() => {
    void load();
  }, [load, inboxRev, pmRev]);

  /**
   * ?ob=<id> from the bell: open that reminder once it is in the list. A
   * reminder is announced a moment before its record is saved, so one not
   * listed yet is waited for, not refused — the next answer usually has it.
   */
  const handled = useRef<string | null>(null);
  useEffect(() => {
    if (!ob) {
      handled.current = null;
      return;
    }
    if (handled.current === ob || !mine) return;
    if (mine.all.some((o) => o.id === ob)) {
      handled.current = ob;
      setOpenId(ob);
    }
  }, [ob, mine]);
  const notFound = !!ob && !!mine && !mine.all.some((o) => o.id === ob);

  const close = useCallback(() => {
    setOpenId(null);
    // Clear ?ob= so the same bell item opens it again next time.
    if (ob) onDoneWithOb();
  }, [ob, onDoneWithOb]);

  useEffect(() => {
    if (!openId) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') close();
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [openId, close]);

  // The figures stay live while open: a payment the office records shows at once.
  const opened = openId ? (mine?.all.find((o) => o.id === openId) ?? null) : null;
  const all = mine?.all ?? [];
  const outstanding = all.reduce((sum, o) => sum + (o.status === 'paid' ? 0 : Math.max(0, o.balancePaise)), 0);
  const owing = all.filter((o) => o.status !== 'paid').length;
  const waiting = all.filter((o) => o.pendingAck).length;

  // Nothing reminded (and no reminder link followed): the Payments screen is
  // exactly what it was before reminders existed.
  if (!all.length && !ob) return null;

  return (
    <div className="card mb-4" id="payment-reminders">
      <div className="card-header">
        <div className="card-title">⏰ Payment Reminders</div>
        <div style={{ fontSize: 12, color: 'var(--muted)' }}>
          {mine ? `CRS ${mine.crsId}${mine.shopName ? ` — ${mine.shopName}` : ''} · ` : ''}from the office, newest first
        </div>
      </div>

      <div style={{ padding: all.length ? '12px 16px 0' : '12px 16px' }}>
        {notFound ? (
          <div style={{ background: '#FFFBEB', border: '1px solid #FDE68A', color: '#92400E', borderRadius: 10, padding: '10px 14px', fontSize: 13, marginBottom: 12 }}>
            That reminder is not in your list yet. It will open here as soon as it arrives.
          </div>
        ) : null}

        {error && !mine ? (
          <div style={{ color: '#B91C1C', fontSize: 13, display: 'flex', gap: 12, alignItems: 'center', flexWrap: 'wrap', marginBottom: 12 }}>
            <span style={{ flex: '1 1 220px' }}>{error}</span>
            <button type="button" className="btn btn-outline btn-sm" onClick={() => void load()}>
              Try again
            </button>
          </div>
        ) : !mine ? (
          <div style={{ padding: 12, textAlign: 'center', color: 'var(--muted)', fontSize: 13 }}>Loading…</div>
        ) : all.length ? (
          <>
            <div
              style={{
                background: owing ? '#FEF2F2' : '#F0FDF4',
                border: `1px solid ${owing ? '#FECACA' : '#BBF7D0'}`,
                color: owing ? '#991B1B' : '#15803D',
                borderRadius: 10,
                padding: '10px 14px',
                fontSize: 13.5,
                marginBottom: 12,
                display: 'flex',
                gap: 12,
                flexWrap: 'wrap',
                justifyContent: 'space-between',
              }}
            >
              <span>
                {owing ? (
                  <>
                    Outstanding: <strong style={{ fontSize: 16 }}>{formatRupees(outstanding)}</strong> on {owing} {owing === 1 ? 'payment' : 'payments'}
                  </>
                ) : (
                  <strong>Everything reminded here is fully paid.</strong>
                )}
              </span>
              {waiting ? <span style={{ fontWeight: 700, color: '#B45309' }}>{waiting} waiting for OK</span> : null}
            </div>
            {error ? <div style={{ color: '#B91C1C', fontSize: 12, marginBottom: 10 }}>Could not refresh: {error}</div> : null}
          </>
        ) : null}
      </div>

      {all.map((o) => (
        <ReminderRow key={o.id} item={o} onOpen={() => setOpenId(o.id)} />
      ))}

      {opened && mine ? (
        <div
          className="no-print pmr-page-overlay"
          role="dialog"
          aria-modal="true"
          aria-label={`Payment Reminder — CRS ${opened.crsId}`}
          onMouseDown={(e) => {
            if (e.target === e.currentTarget) close();
          }}
        >
          <style>{CSS}</style>
          <div className="pmr-page-box">
            <div className="pmr-page-scroll">
              <PaymentReminderCard item={opened} shopName={mine.shopName} upi={mine.upi} qrUrl={mine.qrUrl} />
            </div>
            <div className="pmr-page-foot">
              <button type="button" className="btn btn-outline" onClick={close} style={{ justifyContent: 'center' }}>
                Close
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}

function ReminderRow({ item, onOpen }: { item: PmShopObligation; onOpen: () => void }) {
  const st = STATUS[item.status];
  const typeText = item.title ? `${item.typeLabel} — ${item.title}` : item.typeLabel;
  return (
    <div
      style={{
        display: 'flex',
        gap: 12,
        alignItems: 'flex-start',
        flexWrap: 'wrap',
        padding: '14px 16px',
        borderTop: '1px solid #F1F5F9',
        borderLeft: `4px solid ${item.pendingAck ? '#DC2626' : 'transparent'}`,
        background: item.pendingAck ? '#FFF7F7' : '#fff',
      }}
    >
      <div style={{ flex: '1 1 240px', minWidth: 0 }}>
        <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
          <span style={{ fontWeight: 800, fontSize: 14 }}>
            {MONTHS[item.month] ?? item.month} {item.year}
          </span>
          <span style={{ fontSize: 13, color: 'var(--text)' }}>· {typeText}</span>
          <span style={{ background: st.bg, color: st.fg, border: `1px solid ${st.border}`, borderRadius: 20, padding: '2px 9px', fontSize: 10.5, fontWeight: 700, whiteSpace: 'nowrap' }}>{st.label}</span>
        </div>
        {item.reference ? <div style={{ fontSize: 11.5, color: 'var(--muted)', marginTop: 2 }}>Reference {item.reference}</div> : null}
        <div style={{ display: 'flex', gap: 14, flexWrap: 'wrap', marginTop: 6, fontSize: 12.5 }}>
          <span>
            <span style={{ color: 'var(--muted)' }}>Due</span> {formatRupees(item.duePaise)}
          </span>
          <span>
            <span style={{ color: 'var(--muted)' }}>Paid</span> {formatRupees(item.paidPaise)}
          </span>
          <span style={{ fontWeight: 800, color: item.balancePaise > 0 ? '#B91C1C' : '#15803D' }}>
            <span style={{ color: 'var(--muted)', fontWeight: 400 }}>Balance</span> {formatRupees(Math.max(0, item.balancePaise))}
          </span>
        </div>
        <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', marginTop: 6, fontSize: 11.5, color: '#94A3B8' }}>
          <span>Reminded {dmyTime(item.reminder.at)}</span>
          {item.pendingAck ? (
            <span style={{ color: '#B45309', fontWeight: 700 }}>Waiting for OK</span>
          ) : item.reminder.ackAt ? (
            <span style={{ color: '#166534', fontWeight: 700 }}>
              ✓ Acknowledged {dmyTime(item.reminder.ackAt)}
              {item.reminder.ackName ? ` by ${item.reminder.ackName}` : ''}
            </span>
          ) : null}
        </div>
      </div>
      <button type="button" className="btn btn-outline btn-sm" onClick={onOpen} style={{ flex: '0 0 auto' }}>
        Open
      </button>
    </div>
  );
}
