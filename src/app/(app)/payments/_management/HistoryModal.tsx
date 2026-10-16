'use client';

/**
 * Everything that ever happened to one obligation: each payment with its
 * corrections and, if voided, why; each reminder with when it was sent, the
 * figures it stated, and who pressed OK. Nothing here is ever removed — a
 * correction keeps what it replaced, a void keeps the payment.
 *
 * Correct opens the payment form on that entry; Void asks for the reason in
 * place and sends it.
 */
import { useState } from 'react';
import { appAlert } from '@/components/dialog';
import { saveSuccess } from '@/components/SaveSuccess';
import { voidPayment } from '@/lib/paymentMgmt/client';
import type { PmPayment, PmPaymentFields, PmView } from '@/lib/paymentMgmt/types';
import { formatRupees } from '@/lib/payments/pricing';
import { pmPaymentSaved } from '@/lib/saveSuccess';
import { dmy, dmyTime } from '@/lib/dateFormat';
import Modal, { FigureRow, field } from './Modal';
import { STATUS_LABEL, STATUS_TONE, methodLabel, monthYear, whatFor } from './lib';

const fieldsText = (f: PmPaymentFields) =>
  [`${formatRupees(f.amountPaise)} on ${dmy(f.date)}`, methodLabel(f.method), f.utr ? `UTR ${f.utr}` : '', f.remarks ? `“${f.remarks}”` : ''].filter(Boolean).join(' · ');

const section = { fontSize: 11, fontWeight: 800, color: 'var(--muted)', textTransform: 'uppercase', letterSpacing: '.05em', margin: '16px 0 8px' } as const;
const entry = { border: '1px solid var(--border)', borderRadius: 10, padding: '10px 12px', marginBottom: 8, fontSize: 12.5, lineHeight: 1.5 } as const;
const small = { fontSize: 11.5, color: 'var(--muted)' } as const;

export default function HistoryModal({
  ob,
  onClose,
  onCorrect,
  onSaved,
}: {
  ob: PmView;
  onClose: () => void;
  onCorrect: (paymentId: string) => void;
  onSaved: (o: PmView) => void;
}) {
  const [voiding, setVoiding] = useState<{ id: string; reason: string } | null>(null);
  const [busy, setBusy] = useState(false);

  const payments = [...ob.payments].sort((a, b) => b.date.localeCompare(a.date) || b.at.localeCompare(a.at));
  const reminders = [...ob.reminders].sort((a, b) => b.at.localeCompare(a.at));
  const tone = STATUS_TONE[ob.status];

  const doVoid = async (p: PmPayment) => {
    const reason = voiding?.reason.trim() ?? '';
    if (!reason || busy) return;
    setBusy(true);
    try {
      const { obligation } = await voidPayment(ob.id, p.id, reason);
      onSaved(obligation);
      setVoiding(null);
      saveSuccess(pmPaymentSaved(p.id, formatRupees(p.amountPaise), ob.crsId, whatFor(ob), ob.month, ob.year, 'voided'));
    } catch (e) {
      void appAlert({ title: 'Not voided', tone: 'danger', message: e instanceof Error ? e.message : 'Something went wrong. Please try again.' });
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal
      title="🕘 History"
      tone="violet"
      width={560}
      dismissable
      busy={busy}
      sub={`CRS ${ob.crsId} — ${ob.shopName} · ${whatFor(ob)} · ${monthYear(ob.month, ob.year)}${ob.reference ? ` · Ref ${ob.reference}` : ''}`}
      onClose={onClose}
      foot={
        <button type="button" className="btn btn-outline" onClick={onClose} disabled={busy}>
          Close
        </button>
      }
    >
      <div style={{ border: '1px solid var(--border)', borderRadius: 10, padding: '10px 14px' }}>
        <FigureRow label="Total amount due" value={formatRupees(ob.duePaise)} />
        <FigureRow label="Received" value={formatRupees(ob.paidPaise)} color="#15803D" />
        <FigureRow label="Outstanding" strong value={formatRupees(ob.balancePaise)} color={ob.balancePaise > 0 ? '#B91C1C' : '#15803D'} />
        <div style={{ marginTop: 6 }}>
          <span style={{ background: tone.bg, color: tone.fg, border: `1px solid ${tone.border}`, borderRadius: 20, padding: '3px 10px', fontSize: 10.5, fontWeight: 700 }}>{STATUS_LABEL[ob.status]}</span>
        </div>
      </div>
      <div style={{ ...small, marginTop: 8 }}>
        Entered {dmyTime(ob.createdAt)} by {ob.createdByName || '—'}
        {ob.updatedAt && ob.updatedAt !== ob.createdAt ? ` · last changed ${dmyTime(ob.updatedAt)} by ${ob.updatedByName || '—'}` : ''}
      </div>

      <div style={section}>Payments ({payments.length})</div>
      {payments.length === 0 ? <div style={{ ...small, marginBottom: 8 }}>No payment recorded yet.</div> : null}
      {payments.map((p) => (
        <div key={p.id} style={{ ...entry, background: p.voided ? '#F8FAFC' : '#fff' }}>
          <div style={{ display: 'flex', flexWrap: 'wrap', justifyContent: 'space-between', gap: 8, alignItems: 'baseline' }}>
            <div style={{ minWidth: 0 }}>
              <strong style={{ fontSize: 14, textDecoration: p.voided ? 'line-through' : undefined, color: p.voided ? 'var(--muted)' : '#15803D' }}>{formatRupees(p.amountPaise)}</strong>
              <span style={{ marginLeft: 8 }}>received {dmy(p.date)}</span>
              {p.voided ? <span className="badge badge-red" style={{ marginLeft: 8 }}>Voided</span> : null}
            </div>
            {!p.voided ? (
              <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                <button type="button" className="btn btn-outline btn-sm" disabled={busy} onClick={() => onCorrect(p.id)}>
                  ✎ Correct
                </button>
                <button
                  type="button"
                  className="btn btn-outline btn-sm"
                  disabled={busy}
                  onClick={() => setVoiding(voiding?.id === p.id ? null : { id: p.id, reason: '' })}
                  style={{ borderColor: '#FCA5A5', color: '#B91C1C' }}
                >
                  Void
                </button>
              </div>
            ) : null}
          </div>
          <div style={{ marginTop: 3 }}>
            {methodLabel(p.method)}
            {p.utr ? <span style={{ fontFamily: 'monospace' }}> · UTR {p.utr}</span> : null}
          </div>
          {p.remarks ? <div style={{ marginTop: 2, whiteSpace: 'pre-line' }}>“{p.remarks}”</div> : null}
          <div style={small}>
            Recorded {dmyTime(p.at)} by {p.byName || '—'}
          </div>

          {p.edits.length ? (
            <div style={{ marginTop: 6, borderLeft: '3px solid #DDD6FE', paddingLeft: 8 }}>
              {[...p.edits].reverse().map((e, i) => (
                <div key={`${e.at}-${i}`} style={small}>
                  Corrected {dmyTime(e.at)} by {e.byName || '—'} — it said: {fieldsText(e.before)}
                </div>
              ))}
            </div>
          ) : null}

          {p.voided ? (
            <div style={{ marginTop: 6, color: '#B91C1C', fontSize: 12 }}>
              Voided {dmyTime(p.voided.at)} by {p.voided.byName || '—'} — {p.voided.reason}
            </div>
          ) : null}

          {voiding?.id === p.id && !p.voided ? (
            <div style={{ marginTop: 8, display: 'grid', gap: 6 }}>
              <label htmlFor={`pm-void-${p.id}`} style={{ margin: 0 }}>
                Why is this payment void?
              </label>
              <input
                id={`pm-void-${p.id}`}
                value={voiding.reason}
                maxLength={200}
                onChange={(e) => setVoiding({ id: p.id, reason: e.target.value })}
                placeholder="e.g. Entered twice by mistake"
                style={field}
              />
              <div style={{ display: 'flex', gap: 6, justifyContent: 'flex-end', flexWrap: 'wrap' }}>
                <button type="button" className="btn btn-outline btn-sm" disabled={busy} onClick={() => setVoiding(null)}>
                  Cancel
                </button>
                <button
                  type="button"
                  className="btn btn-sm"
                  disabled={busy || !voiding.reason.trim()}
                  onClick={() => void doVoid(p)}
                  style={{ background: voiding.reason.trim() ? '#DC2626' : '#94A3B8', color: '#fff', fontWeight: 700 }}
                >
                  {busy ? 'Voiding…' : `Void ${formatRupees(p.amountPaise)}`}
                </button>
              </div>
              <div style={small}>The payment stays in this history, struck through, with the reason. The balance goes back up by its amount.</div>
            </div>
          ) : null}
        </div>
      ))}

      <div style={section}>Reminders ({reminders.length})</div>
      {reminders.length === 0 ? <div style={small}>No reminder sent yet.</div> : null}
      {reminders.map((r) => (
        <div key={r.id} style={entry}>
          <div>
            <strong>Sent {dmyTime(r.at)}</strong> by {r.byName || '—'}
          </div>
          <div style={small}>
            It said: due {formatRupees(r.duePaise)} · paid {formatRupees(r.paidPaise)} · outstanding {formatRupees(r.balancePaise)}
          </div>
          <div style={small}>
            {r.notificationId == null ? 'Not delivered as a notification (notifications are not set up).' : `Reached ${r.recipients} ${r.recipients === 1 ? 'person' : 'people'} at the shop.`}
          </div>
          {r.ackAt ? (
            <div style={{ color: '#15803D', fontWeight: 600, marginTop: 3 }}>
              ✓ Acknowledged {dmyTime(r.ackAt)}
              {r.ackName ? ` by ${r.ackName}` : ''}
            </div>
          ) : (
            <div style={{ color: '#92400E', fontWeight: 600, marginTop: 3 }}>Waiting for the shop to press OK</div>
          )}
        </div>
      ))}
    </Modal>
  );
}
