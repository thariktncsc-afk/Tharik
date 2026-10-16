'use client';

/**
 * The three forms of Payment Management: a new obligation (with what was
 * already paid, if anything), an edit of its amount / reference / title, and
 * a payment — recorded, or a recorded one corrected.
 *
 * Each checks what it can before sending (the same rules the server keeps),
 * sends the rupees exactly as typed, and on the server's OK hands the record
 * back and shows the tick. A refusal shows the server's own sentence.
 */
import { useMemo, useState } from 'react';
import DateField from '@/components/DateField';
import { appAlert } from '@/components/dialog';
import { saveSuccess } from '@/components/SaveSuccess';
import { createObligation, correctPayment, recordPayment, updateObligation } from '@/lib/paymentMgmt/client';
import { PAY_METHODS, PM_TYPES, type PayMethod, type PmPayment, type PmType, type PmView } from '@/lib/paymentMgmt/types';
import { formatRupees } from '@/lib/payments/pricing';
import { pmObligationSaved, pmPaymentSaved } from '@/lib/saveSuccess';
import { SHOPS } from '@/lib/engine/shops';
import { dmy } from '@/lib/dateFormat';
import Modal, { FigureRow, Problems, field, pairGrid } from './Modal';
import { MONTHS, duplicateOf, monthYear, toPaise, toRupeeText, todayIst, typeLabel, whatFor } from './lib';

const failed = (e: unknown) => (e instanceof Error ? e.message : 'Something went wrong. Please try again.');

const AMOUNT_HINT = 'in rupees, for example 350 or 350.50';

// ── New obligation ──────────────────────────────────────────────────────────

export function NewObligationModal({
  list,
  defaults,
  years,
  onClose,
  onSaved,
}: {
  list: PmView[];
  defaults: { crsId: number; month: number; year: number };
  years: number[];
  onClose: () => void;
  onSaved: (o: PmView) => void;
}) {
  const today = todayIst();
  const [crs, setCrs] = useState(defaults.crsId ? String(defaults.crsId) : '');
  const [month, setMonth] = useState(String(defaults.month));
  const [year, setYear] = useState(String(defaults.year));
  const [type, setType] = useState<PmType>('monthly');
  const [title, setTitle] = useState('');
  const [reference, setReference] = useState('');
  const [due, setDue] = useState('');
  const [hasPaid, setHasPaid] = useState(false);
  const [pDate, setPDate] = useState(today);
  const [pAmount, setPAmount] = useState('');
  const [pMethod, setPMethod] = useState<PayMethod>('upi');
  const [pUtr, setPUtr] = useState('');
  const [pRemarks, setPRemarks] = useState('');
  const [tried, setTried] = useState(false);
  const [busy, setBusy] = useState(false);

  const duePaise = toPaise(due);
  const paidPaise = hasPaid ? toPaise(pAmount) : 0;
  const crsId = Number(crs) || 0;
  const dup = crsId ? duplicateOf(list, crsId, Number(month), Number(year), type) : null;

  const problems = useMemo(() => {
    const p: string[] = [];
    if (!crsId) p.push('Choose the CRS shop.');
    if (dup) p.push(`A ${typeLabel(type)} for CRS ${crsId}, ${monthYear(Number(month), Number(year))} already exists — edit that one.`);
    if (type === 'other' && !title.trim()) p.push('Say what this payment is for (Title).');
    if (title.trim().length > 80) p.push('The title can be at most 80 characters.');
    if (reference.trim().length > 60) p.push('The reference can be at most 60 characters.');
    if (!duePaise) p.push(`Enter the total amount due, ${AMOUNT_HINT}.`);
    if (hasPaid) {
      if (!pDate) p.push('Enter the date the money was received.');
      else if (pDate > today) p.push('The payment date cannot be after today.');
      if (!paidPaise) p.push(`Enter the amount already paid, ${AMOUNT_HINT}.`);
      else if (duePaise && paidPaise > duePaise) p.push(`The amount already paid is more than the amount due (${formatRupees(duePaise)}).`);
      if (pUtr.trim().length > 40) p.push('The UTR can be at most 40 characters.');
      if (pRemarks.trim().length > 300) p.push('Remarks can be at most 300 characters.');
    }
    return p;
  }, [crsId, dup, type, title, reference, duePaise, hasPaid, pDate, today, paidPaise, pUtr, pRemarks, month, year]);

  const outstanding = duePaise != null && paidPaise != null ? duePaise - paidPaise : null;

  const save = async () => {
    setTried(true);
    if (problems.length || busy) return;
    setBusy(true);
    try {
      const { obligation } = await createObligation({
        crsId,
        month: Number(month),
        year: Number(year),
        type,
        title: type === 'other' ? title.trim() : '',
        reference: reference.trim(),
        dueRupees: due.trim(),
        initialPayment: hasPaid ? { date: pDate, amountRupees: pAmount.trim(), method: pMethod, utr: pUtr.trim(), remarks: pRemarks.trim() } : null,
      });
      onSaved(obligation);
      saveSuccess(pmObligationSaved(obligation.id, obligation.crsId, whatFor(obligation), obligation.month, obligation.year));
      onClose();
    } catch (e) {
      void appAlert({ title: 'Not saved', tone: 'danger', message: failed(e) });
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal
      title="+ New obligation"
      sub="What one CRS shop owes the office for one month."
      busy={busy}
      onClose={onClose}
      foot={
        <>
          <button type="button" className="btn btn-outline" onClick={onClose} disabled={busy}>
            Cancel
          </button>
          <button type="button" className="btn btn-primary" onClick={() => void save()} disabled={busy}>
            {busy ? 'Saving…' : 'Save'}
          </button>
        </>
      }
    >
      <div className="form-group">
        <label htmlFor="pm-new-crs">CRS shop</label>
        <select id="pm-new-crs" value={crs} onChange={(e) => setCrs(e.target.value)} style={field}>
          <option value="">Select a shop…</option>
          {SHOPS.map((s) => (
            <option key={s.id} value={s.id}>
              CRS {s.id} — {s.name}
            </option>
          ))}
        </select>
      </div>
      <div style={pairGrid}>
        <div className="form-group">
          <label htmlFor="pm-new-month">Month</label>
          <select id="pm-new-month" value={month} onChange={(e) => setMonth(e.target.value)} style={field}>
            {MONTHS.map((m, i) => (
              <option key={m} value={i + 1}>
                {m}
              </option>
            ))}
          </select>
        </div>
        <div className="form-group">
          <label htmlFor="pm-new-year">Year</label>
          <select id="pm-new-year" value={year} onChange={(e) => setYear(e.target.value)} style={field}>
            {years.map((y) => (
              <option key={y} value={y}>
                {y}
              </option>
            ))}
          </select>
        </div>
      </div>
      <div className="form-group">
        <label htmlFor="pm-new-type">Payment type</label>
        <select id="pm-new-type" value={type} onChange={(e) => setType(e.target.value as PmType)} style={field}>
          {PM_TYPES.map((t) => (
            <option key={t.id} value={t.id}>
              {t.label}
            </option>
          ))}
        </select>
      </div>
      {type === 'other' ? (
        <div className="form-group">
          <label htmlFor="pm-new-title">Title — what it is for</label>
          <input id="pm-new-title" value={title} maxLength={80} onChange={(e) => setTitle(e.target.value)} placeholder="e.g. Weighing scale repair" style={field} />
        </div>
      ) : null}
      <div style={pairGrid}>
        <div className="form-group">
          <label htmlFor="pm-new-ref">Reference (optional)</label>
          <input id="pm-new-ref" value={reference} maxLength={60} onChange={(e) => setReference(e.target.value)} placeholder="Statement / report no." style={field} />
        </div>
        <div className="form-group">
          <label htmlFor="pm-new-due">Total amount due (₹)</label>
          <input id="pm-new-due" value={due} inputMode="decimal" autoComplete="off" onChange={(e) => setDue(e.target.value)} placeholder="350" style={field} />
        </div>
      </div>

      <label style={{ display: 'flex', alignItems: 'center', gap: 8, textTransform: 'none', letterSpacing: 'normal', fontSize: 13, color: 'var(--text)', cursor: 'pointer', margin: '2px 0 10px' }}>
        <input type="checkbox" checked={hasPaid} onChange={(e) => setHasPaid(e.target.checked)} style={{ width: 'auto' }} />
        Some of it has already been paid
      </label>

      {hasPaid ? (
        <div style={{ border: '1px solid #BBF7D0', background: '#F0FDF4', borderRadius: 10, padding: '12px 12px 0', marginBottom: 12 }}>
          <div style={{ fontSize: 12, fontWeight: 700, color: '#15803D', marginBottom: 8 }}>Amount already paid — saved as the first payment</div>
          <div style={pairGrid}>
            <div className="form-group">
              <label>Date received</label>
              <DateField value={pDate} onChange={setPDate} max={today} aria-label="Date received" style={field} />
            </div>
            <div className="form-group">
              <label htmlFor="pm-new-pamt">Amount paid (₹)</label>
              <input id="pm-new-pamt" value={pAmount} inputMode="decimal" autoComplete="off" onChange={(e) => setPAmount(e.target.value)} placeholder="200" style={field} />
            </div>
          </div>
          <div style={pairGrid}>
            <div className="form-group">
              <label htmlFor="pm-new-pmethod">Method</label>
              <select id="pm-new-pmethod" value={pMethod} onChange={(e) => setPMethod(e.target.value as PayMethod)} style={field}>
                {PAY_METHODS.map((m) => (
                  <option key={m.id} value={m.id}>
                    {m.label}
                  </option>
                ))}
              </select>
            </div>
            <div className="form-group">
              <label htmlFor="pm-new-putr">UTR / transaction id</label>
              <input id="pm-new-putr" value={pUtr} maxLength={40} onChange={(e) => setPUtr(e.target.value)} placeholder="If paid by UPI" style={field} />
            </div>
          </div>
          <div className="form-group">
            <label htmlFor="pm-new-prem">Remarks</label>
            <textarea id="pm-new-prem" value={pRemarks} maxLength={300} rows={2} onChange={(e) => setPRemarks(e.target.value)} style={{ ...field, resize: 'vertical' }} />
          </div>
        </div>
      ) : null}

      <div style={{ border: '1px solid var(--border)', borderRadius: 10, padding: '10px 14px' }}>
        <FigureRow label="Total amount due" value={duePaise != null ? formatRupees(duePaise) : '—'} />
        <FigureRow label="Already paid" value={hasPaid ? (paidPaise != null ? formatRupees(paidPaise) : '—') : formatRupees(0)} />
        <div style={{ borderTop: '1px solid var(--border)', marginTop: 6, paddingTop: 6 }}>
          <FigureRow
            label="Outstanding"
            strong
            value={outstanding == null ? '—' : outstanding < 0 ? 'More than due' : formatRupees(outstanding)}
            color={outstanding == null ? undefined : outstanding < 0 ? '#B91C1C' : outstanding > 0 ? '#B91C1C' : '#15803D'}
          />
        </div>
      </div>

      {dup && !tried ? (
        <div style={{ background: '#FFFBEB', border: '1px solid #FDE68A', color: '#92400E', borderRadius: 8, padding: '8px 12px', fontSize: 12, marginTop: 10 }}>
          CRS {crsId} already has a {typeLabel(type)} for {monthYear(Number(month), Number(year))} — edit that one instead.
        </div>
      ) : null}
      <Problems items={tried ? problems : []} />
    </Modal>
  );
}

// ── Edit ────────────────────────────────────────────────────────────────────

export function EditObligationModal({ ob, onClose, onSaved }: { ob: PmView; onClose: () => void; onSaved: (o: PmView) => void }) {
  const [due, setDue] = useState(toRupeeText(ob.duePaise));
  const [reference, setReference] = useState(ob.reference);
  const [title, setTitle] = useState(ob.title);
  const [tried, setTried] = useState(false);
  const [busy, setBusy] = useState(false);

  const duePaise = toPaise(due);
  const patch: { dueRupees?: string; reference?: string; title?: string } = {};
  if (duePaise != null && duePaise !== ob.duePaise) patch.dueRupees = due.trim();
  if (reference.trim() !== ob.reference) patch.reference = reference.trim();
  if (ob.type === 'other' && title.trim() !== ob.title) patch.title = title.trim();

  const problems: string[] = [];
  if (!duePaise) problems.push(`Enter the total amount due, ${AMOUNT_HINT}.`);
  else if (duePaise < ob.paidPaise) problems.push(`${formatRupees(ob.paidPaise)} has already been received; the amount due cannot be less.`);
  if (ob.type === 'other' && !title.trim()) problems.push('Say what this payment is for (Title).');
  if (title.trim().length > 80) problems.push('The title can be at most 80 characters.');
  if (reference.trim().length > 60) problems.push('The reference can be at most 60 characters.');
  const unchanged = !Object.keys(patch).length;

  const save = async () => {
    setTried(true);
    if (problems.length || busy) return;
    if (unchanged) {
      onClose();
      return;
    }
    setBusy(true);
    try {
      const { obligation } = await updateObligation(ob.id, patch);
      onSaved(obligation);
      saveSuccess(pmObligationSaved(obligation.id, obligation.crsId, whatFor(obligation), obligation.month, obligation.year, true, obligation.updatedAt));
      onClose();
    } catch (e) {
      void appAlert({ title: 'Not saved', tone: 'danger', message: failed(e) });
    } finally {
      setBusy(false);
    }
  };

  const balance = duePaise != null ? duePaise - ob.paidPaise : null;

  return (
    <Modal
      title="✎ Edit payment record"
      sub={`CRS ${ob.crsId} — ${ob.shopName} · ${whatFor(ob)} · ${monthYear(ob.month, ob.year)}`}
      busy={busy}
      onClose={onClose}
      foot={
        <>
          <button type="button" className="btn btn-outline" onClick={onClose} disabled={busy}>
            Cancel
          </button>
          <button type="button" className="btn btn-primary" onClick={() => void save()} disabled={busy}>
            {busy ? 'Saving…' : 'Save changes'}
          </button>
        </>
      }
    >
      {ob.type === 'other' ? (
        <div className="form-group">
          <label htmlFor="pm-edit-title">Title — what it is for</label>
          <input id="pm-edit-title" value={title} maxLength={80} onChange={(e) => setTitle(e.target.value)} style={field} />
        </div>
      ) : null}
      <div style={pairGrid}>
        <div className="form-group">
          <label htmlFor="pm-edit-due">Total amount due (₹)</label>
          <input id="pm-edit-due" value={due} inputMode="decimal" autoComplete="off" onChange={(e) => setDue(e.target.value)} style={field} />
        </div>
        <div className="form-group">
          <label htmlFor="pm-edit-ref">Reference</label>
          <input id="pm-edit-ref" value={reference} maxLength={60} onChange={(e) => setReference(e.target.value)} style={field} />
        </div>
      </div>
      <div style={{ border: '1px solid var(--border)', borderRadius: 10, padding: '10px 14px' }}>
        <FigureRow label="Total amount due" value={duePaise != null ? formatRupees(duePaise) : '—'} />
        <FigureRow label="Received so far" value={formatRupees(ob.paidPaise)} />
        <div style={{ borderTop: '1px solid var(--border)', marginTop: 6, paddingTop: 6 }}>
          <FigureRow label="Outstanding" strong value={balance == null || balance < 0 ? '—' : formatRupees(balance)} color={balance && balance > 0 ? '#B91C1C' : '#15803D'} />
        </div>
      </div>
      <div style={{ fontSize: 11.5, color: 'var(--muted)', marginTop: 10, lineHeight: 1.5 }}>
        The shop, month and payment type cannot be changed. Payments are changed from History (Correct / Void), never here.
      </div>
      {tried && unchanged && !problems.length ? <div style={{ fontSize: 12, color: 'var(--muted)', marginTop: 8 }}>Nothing has changed.</div> : null}
      <Problems items={tried ? problems : []} />
    </Modal>
  );
}

// ── A payment: recorded, or a recorded one corrected ────────────────────────

export function PaymentModal({ ob, payment, onClose, onSaved }: { ob: PmView; payment?: PmPayment | null; onClose: () => void; onSaved: (o: PmView) => void }) {
  const today = todayIst();
  const correcting = !!payment;
  const [date, setDate] = useState(payment?.date ?? today);
  const [amount, setAmount] = useState(payment ? toRupeeText(payment.amountPaise) : '');
  const [method, setMethod] = useState<PayMethod>(payment?.method ?? 'upi');
  const [utr, setUtr] = useState(payment?.utr ?? '');
  const [remarks, setRemarks] = useState(payment?.remarks ?? '');
  const [tried, setTried] = useState(false);
  const [busy, setBusy] = useState(false);

  // Correcting a payment frees its own amount: the most it may now be is
  // what the OTHER payments leave outstanding.
  const othersPaid = ob.paidPaise - (payment && !payment.voided ? payment.amountPaise : 0);
  const room = ob.duePaise - othersPaid;
  const amountPaise = toPaise(amount);
  const after = amountPaise != null ? room - amountPaise : null;

  const problems: string[] = [];
  if (!correcting && ob.balancePaise <= 0) problems.push(`${whatFor(ob)} for ${monthYear(ob.month, ob.year)} is fully paid.`);
  if (!date) problems.push('Enter the date the money was received.');
  else if (date > today) problems.push('The payment date cannot be after today.');
  if (!amountPaise) problems.push(`Enter the amount received, ${AMOUNT_HINT}.`);
  else if (amountPaise > room) problems.push(`That is more than the outstanding ${formatRupees(room)}.`);
  if (utr.trim().length > 40) problems.push('The UTR can be at most 40 characters.');
  if (remarks.trim().length > 300) problems.push('Remarks can be at most 300 characters.');

  const save = async () => {
    setTried(true);
    if (problems.length || busy) return;
    setBusy(true);
    const input = { date, amountRupees: amount.trim(), method, utr: utr.trim(), remarks: remarks.trim() };
    try {
      if (payment) {
        const { obligation } = await correctPayment(ob.id, payment.id, input);
        onSaved(obligation);
        saveSuccess(pmPaymentSaved(payment.id, formatRupees(amountPaise ?? 0), ob.crsId, whatFor(ob), ob.month, ob.year, 'corrected', obligation.updatedAt));
      } else {
        const { obligation } = await recordPayment(ob.id, input);
        onSaved(obligation);
        const known = new Set(ob.payments.map((p) => p.id));
        const added = obligation.payments.find((p) => !known.has(p.id));
        saveSuccess(pmPaymentSaved(added?.id ?? obligation.updatedAt, formatRupees(amountPaise ?? 0), ob.crsId, whatFor(ob), ob.month, ob.year, 'recorded'));
      }
      onClose();
    } catch (e) {
      void appAlert({ title: 'Not saved', tone: 'danger', message: failed(e) });
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal
      title={correcting ? '✎ Correct payment' : '₹ Record payment'}
      tone="green"
      sub={`CRS ${ob.crsId} — ${ob.shopName} · ${whatFor(ob)} · ${monthYear(ob.month, ob.year)}`}
      busy={busy}
      onClose={onClose}
      foot={
        <>
          <button type="button" className="btn btn-outline" onClick={onClose} disabled={busy}>
            Cancel
          </button>
          <button type="button" className="btn btn-success" onClick={() => void save()} disabled={busy}>
            {busy ? 'Saving…' : correcting ? 'Save correction' : 'Record payment'}
          </button>
        </>
      }
    >
      {payment ? (
        <div style={{ background: '#F8FAFC', border: '1px solid var(--border)', borderRadius: 8, padding: '8px 12px', fontSize: 12, marginBottom: 12, lineHeight: 1.5 }}>
          Correcting {formatRupees(payment.amountPaise)} received {dmy(payment.date)}. What it said now is kept in its history.
        </div>
      ) : null}

      <div style={{ border: '1px solid var(--border)', borderRadius: 10, padding: '10px 14px', marginBottom: 14 }}>
        <FigureRow label="Total amount due" value={formatRupees(ob.duePaise)} />
        <FigureRow label={correcting ? 'Paid (other payments)' : 'Paid so far'} value={formatRupees(othersPaid)} />
        <FigureRow label={correcting ? 'Outstanding without this payment' : 'Outstanding balance'} value={formatRupees(room)} color="#B91C1C" />
        <div style={{ borderTop: '1px solid var(--border)', marginTop: 6, paddingTop: 6 }}>
          <FigureRow
            label="Balance after this payment"
            strong
            value={after == null ? '—' : after < 0 ? 'More than outstanding' : formatRupees(after)}
            color={after == null ? undefined : after === 0 ? '#15803D' : '#B91C1C'}
          />
        </div>
      </div>

      <div style={pairGrid}>
        <div className="form-group">
          <label>Date received</label>
          <DateField value={date} onChange={setDate} max={today} aria-label="Date received" style={field} />
        </div>
        <div className="form-group">
          <label htmlFor="pm-pay-amt">Amount (₹)</label>
          <input id="pm-pay-amt" value={amount} inputMode="decimal" autoComplete="off" onChange={(e) => setAmount(e.target.value)} placeholder={toRupeeText(Math.max(0, room))} style={field} />
          {!correcting && room > 0 && amountPaise !== room ? (
            <button type="button" className="btn-sm" onClick={() => setAmount(toRupeeText(room))} style={{ background: 'none', border: 'none', color: '#0369A1', fontSize: 11.5, fontWeight: 700, padding: '4px 0 0', cursor: 'pointer' }}>
              Full balance {formatRupees(room)}
            </button>
          ) : null}
        </div>
      </div>
      <div style={pairGrid}>
        <div className="form-group">
          <label htmlFor="pm-pay-method">Method</label>
          <select id="pm-pay-method" value={method} onChange={(e) => setMethod(e.target.value as PayMethod)} style={field}>
            {PAY_METHODS.map((m) => (
              <option key={m.id} value={m.id}>
                {m.label}
              </option>
            ))}
          </select>
        </div>
        <div className="form-group">
          <label htmlFor="pm-pay-utr">UTR / transaction id</label>
          <input id="pm-pay-utr" value={utr} maxLength={40} onChange={(e) => setUtr(e.target.value)} placeholder={method === 'upi' ? 'From the bank statement' : 'Optional'} style={field} />
        </div>
      </div>
      <div className="form-group">
        <label htmlFor="pm-pay-rem">Remarks</label>
        <textarea id="pm-pay-rem" value={remarks} maxLength={300} rows={2} onChange={(e) => setRemarks(e.target.value)} style={{ ...field, resize: 'vertical' }} />
      </div>
      <div style={{ fontSize: 11.5, color: 'var(--muted)', lineHeight: 1.5 }}>Record only money that has reached the office account.</div>
      <Problems items={tried ? problems : []} />
    </Modal>
  );
}
