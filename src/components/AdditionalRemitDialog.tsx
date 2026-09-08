'use client';

/**
 * "Additional Remittance – Select Reason".
 *
 * Shown when a sales date already carries a deposit and another is being
 * added: the money is not a correction of the first, it is a second payment
 * against the same day's sales, and the office wants to know why it was late.
 * The first deposit of a date never sees this.
 */
import { useState } from 'react';
import { REMIT_REASONS, type RemitReason } from '@/lib/engine/remittance';

const TONE: Record<RemitReason, { icon: string; note: string }> = {
  Missed: { icon: '🕗', note: 'Part of the day’s takings was not banked on the day' },
  Tea: { icon: '🍵', note: 'Tea account collection' },
  Salt: { icon: '🧂', note: 'Salt account collection' },
  'C.Box': { icon: '📦', note: 'Card & box collection' },
};

export default function AdditionalRemitDialog({
  amount,
  salesDate,
  remitDate,
  onPick,
  onClose,
}: {
  amount: number;
  salesDate: string;
  remitDate: string;
  onPick: (reason: RemitReason) => void;
  onClose: () => void;
}) {
  const [picked, setPicked] = useState<RemitReason | null>(null);
  const fmt = (d: string) => (d ? d.split('-').reverse().join('/') : '—');
  const inr = (n: number) => '₹' + n.toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

  return (
    <div
      style={{ position: 'fixed', inset: 0, zIndex: 9600, background: 'rgba(13,30,63,.55)', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 20 }}
      onClick={(e) => e.target === e.currentTarget && onClose()}
    >
      <div style={{ background: '#fff', borderRadius: 16, width: '100%', maxWidth: 460, boxShadow: '0 20px 60px rgba(0,0,0,.3)', overflow: 'hidden' }}>
        <div style={{ background: 'linear-gradient(135deg,#B45309,#F59E0B)', padding: '16px 20px', color: '#fff' }}>
          <div style={{ fontWeight: 800, fontSize: 16 }}>Additional Remittance – Select Reason</div>
          <div style={{ fontSize: 12, opacity: 0.9, marginTop: 3 }}>
            {inr(amount)} banked on {fmt(remitDate)}, against sales of {fmt(salesDate)}
          </div>
        </div>
        <div style={{ padding: '16px 20px' }}>
          <div style={{ fontSize: 12, color: '#64748B', marginBottom: 12 }}>
            This sales date already has a deposit. The new amount is added as a second transaction — the first is not changed, and the sales date stays {fmt(salesDate)}.
          </div>
          {REMIT_REASONS.map((r) => {
            const on = picked === r;
            return (
              <button
                key={r}
                type="button"
                onClick={() => setPicked(r)}
                style={{
                  display: 'flex', alignItems: 'center', gap: 12, width: '100%', textAlign: 'left', marginBottom: 8,
                  background: on ? '#FFFBEB' : '#fff', border: `1.5px solid ${on ? '#F59E0B' : '#E2E8F0'}`,
                  borderRadius: 10, padding: '11px 14px', cursor: 'pointer',
                }}
              >
                <span style={{ fontSize: 20 }}>{TONE[r].icon}</span>
                <span style={{ flex: 1 }}>
                  <span style={{ display: 'block', fontWeight: 800, fontSize: 14, color: on ? '#92400E' : '#334155' }}>{r}</span>
                  <span style={{ display: 'block', fontSize: 11, color: '#64748B', marginTop: 1 }}>{TONE[r].note}</span>
                </span>
                {on ? <span style={{ color: '#B45309', fontWeight: 900 }}>✓</span> : null}
              </button>
            );
          })}
          <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 10, marginTop: 14 }}>
            <button type="button" onClick={onClose} style={{ background: '#F1F5F9', border: 'none', borderRadius: 10, padding: '10px 20px', fontSize: 13, fontWeight: 600, color: '#475569', cursor: 'pointer' }}>
              Cancel
            </button>
            <button
              type="button"
              disabled={!picked}
              onClick={() => picked && onPick(picked)}
              style={{
                background: picked ? 'linear-gradient(135deg,#B45309,#F59E0B)' : '#94A3B8', color: '#fff', border: 'none',
                borderRadius: 10, padding: '10px 22px', fontSize: 13, fontWeight: 700, cursor: picked ? 'pointer' : 'not-allowed',
              }}
            >
              Add remittance
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
