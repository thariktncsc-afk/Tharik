'use client';

/**
 * Monthly Remittance — SRCB — port of buildMeRemitTable (15-monthly-extras.js),
 * with the day sheets' deposits folded in.
 *
 * A day that was keyed in Daily Sales Entry shows its deposits here
 * automatically, one row per transaction, and read-only for shop staff —
 * nobody keys the same remittance twice, and because the rows are derived
 * rather than copied they cannot duplicate on a re-save or drift from the day
 * sheet. Shop staff correct them on the Daily Entry page. A day with no sheet
 * keeps the hand-keyed inputs it always had, so the imported months and the
 * monthly-only shops are unchanged.
 *
 * A sales date can carry several deposits: the first is the ordinary one, and
 * each later one is an additional remittance with a reason (Missed / Tea /
 * Salt / C.Box). Those always sit in Non-Cereal, and their reason is shown
 * where a plain row shows a Cereal figure. That substitution is display only —
 * see src/lib/engine/remittance.ts — so the Cereal total below, and the Cereal
 * column on the statutory statement, stay totals of money.
 *
 * ADMINISTRATORS may correct a derived row here rather than going to Daily
 * Entry for it: ✎ changes the amount, the deposit date or the account, ✕
 * removes it and ➕ adds another deposit to the same sales date. Every one of
 * those writes the DAY SHEET the row came from, by id, and recomputes the
 * sheet's own remittance totals (sheetTotals) — the rows here stay derived,
 * so a correction cannot duplicate a deposit or leave this table disagreeing
 * with Daily Entry, the DSS or the statements. It saves immediately; nothing
 * waits for the month-close. Shop users see the table exactly as before.
 */
import { useState } from 'react';
import { crsData } from '@/lib/dataStore';
import { useAuth } from '@/lib/authClient';
import { appAlert, appConfirm } from '@/components/dialog';
import { saveSuccess } from '@/components/SaveSuccess';
import { remittanceSaved } from '@/lib/saveSuccess';
import {
  REMIT_REASONS,
  REMIT_TYPE_LABEL,
  amounts,
  applyRemitType,
  monthTxns,
  newRemitId,
  remitTypeOf,
  sheetTotals,
  toTxn,
  txnsOf,
  type RemitRow,
  type RemitType,
  type SheetLike,
} from '@/lib/engine/remittance';
import type { MonthCtx, RemitDay, RemitExtra, RemitMonth } from './lib';

const inr = (n: number) => '₹' + n.toFixed(2);

export default function RemitTable({
  ctx,
  remit,
  entryStore,
  subtitle,
}: {
  ctx: MonthCtx;
  remit: Record<string, RemitMonth>;
  entryStore: Record<string, SheetLike>;
  subtitle: string;
}) {
  const { user } = useAuth();
  const isAdmin = user?.role === 'ADMIN';
  /** The deposit being corrected, or a new one being added to a sales date. */
  const [edit, setEdit] = useState<null | { salesDate: string; id: string | null; amount: string; date: string; type: RemitType }>(null);

  const month = remit[ctx.key] ?? {};
  const daysInMonth = new Date(ctx.year, ctx.month, 0).getDate();
  const extra = (month['extra'] ?? {}) as RemitExtra;

  /**
   * Rewrite one day sheet's deposits and save at once.
   *
   * The sheet is re-read from the store rather than from this render: the
   * table is derived, and a deposit may have moved on a live-sync beat while
   * the editor sat open. `sheetTotals` keeps `remitAmount` / `remitDate` /
   * `remitNonCereal` / `remitCereal` in step, which is what the statements
   * read — the classification rules themselves are untouched.
   */
  const commit = async (salesDate: string, mutate: (list: ReturnType<typeof toTxn>[]) => ReturnType<typeof toTxn>[], ref: string) => {
    const key = `${ctx.crsId}_${salesDate}`;
    const sheet = (crsData.get<Record<string, SheetLike>>('entryStore') ?? {})[key];
    if (!sheet) {
      void appAlert('That day sheet is no longer there — reopen the month and try again.');
      return;
    }
    const list = mutate(txnsOf(sheet, salesDate).map(toTxn));
    crsData.markEdited('entryStore', key);
    crsData.update<Record<string, SheetLike>>('entryStore', (d) => {
      d[key] = { ...(d[key] as SheetLike), remits: list, ...sheetTotals(list) };
    });
    setEdit(null);
    if (await crsData.saveConfirmed()) saveSuccess(remittanceSaved(ctx.crsId, salesDate, ref));
  };

  const applyEdit = () => {
    if (!edit) return;
    const amount = parseFloat(edit.amount);
    if (!(amount > 0) || !edit.date) {
      void appAlert('Enter an amount above zero and a remittance date.');
      return;
    }
    const { salesDate, id, date, type } = edit;
    void commit(
      salesDate,
      (list) =>
        id
          ? list.map((t) => (t.id !== id ? t : applyRemitType({ ...t, amount, date }, type)))
          : [...list, applyRemitType({ id: newRemitId(), amount, date, account: 'nc', createdBy: user?.username, createdAt: new Date().toISOString() }, type)],
      id ?? 'new',
    );
  };

  const removeTxn = async (t: RemitRow, onlyOne: boolean) => {
    const ok = await appConfirm({
      title: 'Remove remittance',
      tone: 'danger',
      confirmLabel: 'Remove',
      message:
        `Remove the ₹${t.amount.toFixed(2)} deposit dated ${t.date.split('-').reverse().join('/')} from ${t.salesDate.split('-').reverse().join('/')}?` +
        (onlyOne ? '\n\nIt is the only deposit recorded for that sales date, which will be left with none.' : '') +
        '\n\nThis cannot be undone.',
    });
    if (!ok) return;
    await commit(t.salesDate, (list) => list.filter((x) => x.id !== t.id), t.id);
  };

  // Deposits recorded on this month's day sheets, grouped by the sales date
  // they belong to — an additional deposit banked in October still belongs to
  // its September sales date, and stays under it.
  const byDay = new Map<number, RemitRow[]>();
  for (const t of monthTxns(entryStore, ctx.crsId, ctx.month, ctx.year)) {
    const d = Number(t.salesDate.slice(8));
    byDay.set(d, [...(byDay.get(d) ?? []), t]);
  }

  const writeDay = (day: number, field: keyof RemitDay, value: string) => {
    crsData.update<Record<string, RemitMonth>>('meRemitStore', (d) => {
      const m = { ...(d[ctx.key] ?? {}) };
      const rec = { ...((m[day] ?? {}) as RemitDay) };
      if (field === 'nonCereal') rec.nonCereal = parseFloat(value) || 0;
      else rec[field] = value as never;
      m[day] = rec;
      d[ctx.key] = m;
    });
  };
  const writeExtra = (field: string, value: string) => {
    crsData.update<Record<string, RemitMonth>>('meRemitStore', (d) => {
      const m = { ...(d[ctx.key] ?? {}) };
      const rec = { ...((m['extra'] ?? {}) as RemitExtra) };
      rec[field] = field.endsWith('nc') ? parseFloat(value) || 0 : value;
      m['extra'] = rec;
      d[ctx.key] = m;
    });
  };

  const num = (v: unknown) => (typeof v === 'number' ? v : parseFloat(String(v ?? '')) || 0);

  let totNC = 0;
  let totCE = 0;
  const dayRows = [];
  /**
   * Every remittance is one row, numbered in sequence — a sales date with two
   * deposits simply appears twice. The S.No is therefore a row counter, not
   * the day of the month, and the striping follows it, so a derived row is
   * indistinguishable from a keyed one.
   */
  let serial = 0;
  const stripe = () => (serial % 2 === 0 ? '#F8FAFF' : '#fff');

  /**
   * A read-only cell that occupies exactly the space an input would. The keyed
   * rows put a 1px-bordered, 5px/8px-padded, 12px control inside a 4px/6px
   * cell; matching all three here keeps the row height identical whether the
   * figure came from a day sheet or was typed in.
   */
  const ro = (content: React.ReactNode, align: 'center' | 'right', style?: React.CSSProperties) => (
    <span
      style={{
        display: 'inline-block', width: '100%', boxSizing: 'border-box',
        border: '1px solid transparent', borderRadius: 6, padding: '5px 8px',
        fontSize: 12, textAlign: align, whiteSpace: 'nowrap', ...style,
      }}
    >
      {content}
    </span>
  );

  const actBtn = (bg: string, fg: string, bd: string): React.CSSProperties => ({
    background: bg, color: fg, border: `1px solid ${bd}`, borderRadius: 6,
    padding: '3px 8px', fontSize: 11, fontWeight: 800, cursor: 'pointer', marginLeft: 4,
  });
  const act = {
    edit: actBtn('#FAF5FF', '#5B21B6', '#A78BFA'),
    del: actBtn('#FEE2E2', '#B91C1C', '#FCA5A5'),
    add: actBtn('#ECFDF5', '#047857', '#6EE7B7'),
  };

  /**
   * One deposit open for correction, or a new one for a sales date. It stands
   * in the row's own place so the table does not jump, and it writes only when
   * ✓ is pressed.
   */
  const editRow = (key: string, no: number, salesLabel: string, dow: string) => (
    <tr key={key} style={{ background: '#FAF5FF' }}>
      <td style={{ padding: '6px 10px', textAlign: 'center', color: 'var(--muted)', fontSize: 11, borderBottom: '1px solid #EFF6FF' }}>{no}</td>
      <td style={{ padding: '6px 12px', fontSize: 12, borderBottom: '1px solid #EFF6FF', whiteSpace: 'nowrap' }}>
        <span style={{ fontWeight: 600 }}>{salesLabel}</span>
        <span style={{ color: 'var(--muted)', fontSize: 10, marginLeft: 6 }}>{dow}</span>
      </td>
      <td style={{ padding: '4px 6px', borderBottom: '1px solid #EFF6FF', textAlign: 'center' }}>
        <input
          type="date"
          aria-label="Remittance date"
          value={edit!.date}
          onChange={(e) => setEdit({ ...edit!, date: e.target.value })}
          style={{ border: '1px dashed #A78BFA', borderRadius: 6, padding: '4px 7px', fontSize: 11, width: 130 }}
        />
      </td>
      <td style={{ padding: '4px 6px', borderBottom: '1px solid #EFF6FF' }}>
        <input
          type="number"
          min={0}
          step={0.01}
          placeholder="0.00"
          aria-label="Amount"
          value={edit!.amount}
          onChange={(e) => setEdit({ ...edit!, amount: e.target.value })}
          style={{ width: '100%', border: '1px dashed #A78BFA', borderRadius: 6, padding: '5px 8px', fontSize: 12, textAlign: 'right', fontWeight: 700 }}
        />
      </td>
      <td style={{ padding: '4px 6px', borderBottom: '1px solid #EFF6FF' }}>
        {/* Account and reason are one choice — an additional deposit is
            Non-Cereal by rule, so the two can never contradict each other. */}
        <select
          value={edit!.type}
          onChange={(e) => setEdit({ ...edit!, type: e.target.value as RemitType })}
          aria-label="Account or reason"
          style={{ width: '100%', border: '1px dashed #A78BFA', borderRadius: 6, padding: '5px 8px', fontSize: 12, background: '#fff' }}
        >
          {(['nc', 'ce', ...REMIT_REASONS] as RemitType[]).map((x) => (
            <option key={x} value={x}>{REMIT_TYPE_LABEL[x]}</option>
          ))}
        </select>
      </td>
      <td style={{ padding: '6px 8px', textAlign: 'right', borderBottom: '1px solid #EFF6FF', background: '#EFF6FF' }}>
        <span style={{ fontWeight: 800, color: '#0369A1', fontSize: 12 }}>{inr(parseFloat(edit!.amount) || 0)}</span>
      </td>
      <td style={{ padding: '4px 8px', textAlign: 'right', borderBottom: '1px solid #EFF6FF', whiteSpace: 'nowrap' }}>
        <button type="button" onClick={applyEdit} title="Save this correction" style={act.edit}>✓</button>
        <button type="button" onClick={() => setEdit(null)} title="Cancel" style={actBtn('#fff', '#475569', '#CBD5E1')}>↺</button>
      </td>
    </tr>
  );

  for (let day = 1; day <= daysInMonth; day++) {
    const dateObj = new Date(ctx.year, ctx.month - 1, day);
    const salesLabel = `${String(day).padStart(2, '0')}/${String(ctx.month).padStart(2, '0')}/${ctx.year}`;
    const dow = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'][dateObj.getDay()];
    const txns = byDay.get(day);

    // ── Days keyed in Daily Entry: one row per deposit ─────────────────────
    // Read-only, except for an administrator's ✎ / ✕ / ➕ (editRow below).
    if (txns?.length) {
      txns.forEach((t, ti) => {
        const { nc, ce } = amounts(t);
        totNC += nc;
        totCE += ce;
        serial++;
        if (isAdmin && edit && edit.id === t.id) {
          dayRows.push(editRow(`${day}-${t.id}`, serial, salesLabel, dow));
          return;
        }
        dayRows.push(
          <tr key={`${day}-${t.id}`} style={{ background: stripe() }}>
            <td style={{ padding: '6px 10px', textAlign: 'center', color: 'var(--muted)', fontSize: 11, borderBottom: '1px solid #EFF6FF' }}>{serial}</td>
            <td style={{ padding: '6px 12px', fontSize: 12, borderBottom: '1px solid #EFF6FF', whiteSpace: 'nowrap' }}>
              <span style={{ fontWeight: 600 }}>{salesLabel}</span>
              <span style={{ color: 'var(--muted)', fontSize: 10, marginLeft: 6 }}>{dow}</span>
            </td>
            <td style={{ padding: '4px 6px', borderBottom: '1px solid #EFF6FF' }}>
              {ro(t.date ? t.date.split('-').reverse().join('/') : '—', 'center', { color: '#0369A1', fontWeight: 600 })}
            </td>
            <td style={{ padding: '4px 6px', borderBottom: '1px solid #EFF6FF' }}>
              {ro(nc ? inr(nc) : '—', 'right', { color: '#0369A1', fontWeight: 700 })}
            </td>
            <td style={{ padding: '4px 6px', borderBottom: '1px solid #EFF6FF' }}>
              {/* The reason sits where a Cereal figure would, in the same box
                  with no tint or border of its own — a row carrying one must
                  not read as a different KIND of row. Its colour is the only
                  hint that it is a label rather than an amount. */}
              {t.reason
                ? ro(t.reason, 'right', { color: '#92400E', fontWeight: 700 })
                : ro(ce ? inr(ce) : '—', 'right', ce ? { color: '#15803D', fontWeight: 700 } : { color: 'var(--muted)' })}
            </td>
            <td style={{ padding: '6px 8px', textAlign: 'right', borderBottom: '1px solid #EFF6FF', background: '#EFF6FF' }}>
              <span style={{ fontWeight: 800, color: '#0369A1', fontSize: 12 }}>{inr(nc + ce)}</span>
            </td>
            {isAdmin ? (
              <td style={{ padding: '4px 8px', textAlign: 'right', borderBottom: '1px solid #EFF6FF', whiteSpace: 'nowrap' }}>
                <button type="button" onClick={() => setEdit({ salesDate: t.salesDate, id: t.id, amount: String(t.amount), date: t.date, type: remitTypeOf(t) })} title="Correct this remittance — amount, deposit date or account" style={act.edit}>✎</button>
                <button type="button" onClick={() => void removeTxn(t, (byDay.get(day) ?? []).length === 1)} title="Remove this remittance" style={act.del}>✕</button>
                {/* On the date's last deposit only, so one date offers one
                    place to add another one. */}
                {ti === (byDay.get(day) ?? []).length - 1 ? (
                  <button type="button" onClick={() => setEdit({ salesDate: t.salesDate, id: null, amount: '', date: t.date, type: REMIT_REASONS[0] })} title="Add another remittance for this sales date" style={act.add}>➕</button>
                ) : null}
              </td>
            ) : null}
          </tr>,
        );
      });
      // The new deposit being added for this date sits under its own rows.
      if (isAdmin && edit && !edit.id && edit.salesDate === `${ctx.year}-${String(ctx.month).padStart(2, '0')}-${String(day).padStart(2, '0')}`) {
        serial++;
        dayRows.push(editRow(`${day}-new`, serial, salesLabel, dow));
      }
      continue;
    }

    // ── Days with no sheet: the hand-keyed row, exactly as before ──────────
    serial++;
    const d = (month[day] ?? {}) as RemitDay;
    const nonCereal = d.nonCereal !== undefined ? d.nonCereal : '';
    const cereal = d.cereal !== undefined ? d.cereal : '';
    totNC += num(nonCereal);
    totCE += num(cereal);
    const rowTotal = num(nonCereal) + num(cereal);
    dayRows.push(
      <tr key={day} style={{ background: stripe() }}>
        <td style={{ padding: '6px 10px', textAlign: 'center', color: 'var(--muted)', fontSize: 11, borderBottom: '1px solid #EFF6FF' }}>{serial}</td>
        <td style={{ padding: '6px 12px', fontSize: 12, borderBottom: '1px solid #EFF6FF', whiteSpace: 'nowrap' }}>
          <span style={{ fontWeight: 600 }}>{salesLabel}</span>
          <span style={{ color: 'var(--muted)', fontSize: 10, marginLeft: 6 }}>{dow}</span>
        </td>
        <td style={{ padding: '4px 6px', borderBottom: '1px solid #EFF6FF', textAlign: 'center' }}>
          <input type="date" value={d.remitDate ?? ''} onChange={(e) => writeDay(day, 'remitDate', e.target.value)} style={{ border: '1px solid #BAE6FD', borderRadius: 6, padding: '4px 7px', fontSize: 11, color: '#0369A1', background: '#F0F9FF', width: 130 }} />
        </td>
        <td style={{ padding: '4px 6px', borderBottom: '1px solid #EFF6FF' }}>
          <input
            type="number"
            min={0}
            step={0.01}
            placeholder="0.00"
            defaultValue={nonCereal !== '' ? Number(nonCereal).toFixed(2) : ''}
            onBlur={(e) => writeDay(day, 'nonCereal', e.target.value)}
            style={{ width: '100%', border: '1px solid #BAE6FD', borderRadius: 6, padding: '5px 8px', fontSize: 12, textAlign: 'right', fontWeight: 700, color: '#0369A1', background: '#F0F9FF' }}
          />
        </td>
        <td style={{ padding: '4px 6px', borderBottom: '1px solid #EFF6FF' }}>
          <input
            type="text"
            defaultValue={cereal === '' ? '' : String(cereal)}
            onBlur={(e) => writeDay(day, 'cereal', e.target.value)}
            style={{ width: '100%', border: '1px solid #E2E8F0', borderRadius: 6, padding: '5px 8px', fontSize: 12, color: 'var(--muted)', background: '#FAFCFF' }}
          />
        </td>
        <td style={{ padding: '6px 8px', textAlign: 'right', borderBottom: '1px solid #EFF6FF', background: '#EFF6FF' }}>
          <span style={{ fontWeight: 800, color: '#0369A1', fontSize: 12 }}>{nonCereal !== '' || cereal !== '' ? inr(rowTotal) : '—'}</span>
        </td>
        {/* A date with no day sheet is keyed here as it always was; the
            actions column is empty for it. */}
        {isAdmin ? <td style={{ borderBottom: '1px solid #EFF6FF' }} /> : null}
      </tr>,
    );
  }

  const extraRow = (n: 1 | 2 | 3) => {
    const nc = extra[`e${n}nc`];
    const ce = extra[`e${n}ce`];
    const dt = (extra[`e${n}date`] as string) ?? '';
    const tot = num(nc) + num(ce);
    totNC += num(nc);
    totCE += num(ce);
    const amber = n === 1;
    const bd = amber ? '1px solid #FEF3C7' : '1px solid #EFF6FF';
    const inputBd = amber ? '#FDE047' : '#BAE6FD';
    const inputBg = amber ? '#FFFBEB' : '#F0F9FF';
    const inputCol = amber ? '#92400E' : '#0369A1';
    return (
      <tr key={`e${n}`} style={{ background: amber ? '#FEF9C3' : n === 2 ? '#F8FAFF' : '#fff', borderTop: amber ? '2px solid #FDE047' : undefined }}>
        <td style={{ padding: '6px 10px', textAlign: 'center', fontSize: 11, fontWeight: 700, color: amber ? '#92400E' : 'var(--muted)', borderBottom: bd }}>{serial + n}</td>
        <td style={{ padding: '6px 12px', borderBottom: bd, fontSize: 11, fontWeight: 700, color: amber ? '#92400E' : undefined, whiteSpace: amber ? 'nowrap' : undefined }}>
          {amber ? (
            <>📦 Poly &amp; C.Box Amount</>
          ) : (
            <input
              type="text"
              placeholder={n === 2 ? 'Label (e.g. Inspection Charges)' : 'Label (optional)'}
              defaultValue={(extra[`e${n}label`] as string) ?? ''}
              onBlur={(e) => writeExtra(`e${n}label`, e.target.value)}
              style={{ width: '100%', border: '1px solid #E2E8F0', borderRadius: 5, padding: '3px 7px', fontSize: 11, color: 'var(--text)' }}
            />
          )}
        </td>
        <td style={{ padding: '4px 6px', borderBottom: bd, textAlign: 'center' }}>
          <input type="date" value={dt} onChange={(e) => writeExtra(`e${n}date`, e.target.value)} style={{ border: `1px solid ${inputBd}`, borderRadius: 6, padding: '4px 7px', fontSize: 11, color: inputCol, background: inputBg, width: 130 }} />
        </td>
        <td style={{ padding: '4px 6px', borderBottom: bd }}>
          <input
            type="number"
            min={0}
            step={0.01}
            placeholder="0.00"
            defaultValue={nc !== undefined && nc !== '' ? Number(nc).toFixed(2) : ''}
            onBlur={(e) => writeExtra(`e${n}nc`, e.target.value)}
            style={{ width: '100%', border: `1px solid ${inputBd}`, borderRadius: 6, padding: '5px 8px', fontSize: 12, textAlign: 'right', fontWeight: 700, color: inputCol, background: inputBg }}
          />
        </td>
        <td style={{ padding: '4px 6px', borderBottom: bd }}>
          <input type="text" defaultValue={ce === undefined ? '' : String(ce)} onBlur={(e) => writeExtra(`e${n}ce`, e.target.value)} style={{ width: '100%', border: '1px solid #E2E8F0', borderRadius: 6, padding: '5px 8px', fontSize: 12, color: 'var(--muted)', background: amber ? '#FFFBEB' : '#FAFCFF' }} />
        </td>
        <td style={{ padding: '6px 8px', textAlign: 'right', borderBottom: bd, background: amber ? '#FEF3C7' : '#EFF6FF' }}>
          <span style={{ fontWeight: 800, color: inputCol, fontSize: 12 }}>{nc !== undefined || ce !== undefined ? inr(tot) : '—'}</span>
        </td>
        {isAdmin ? <td style={{ borderBottom: bd }} /> : null}
      </tr>
    );
  };
  const extraRows = [extraRow(1), extraRow(2), extraRow(3)];

  const th = { padding: '8px 10px', textAlign: 'center' as const, fontSize: 10, fontWeight: 700, color: '#1D4ED8', borderBottom: '2px solid #BFDBFE', whiteSpace: 'nowrap' as const };

  return (
    <div style={{ width: '100%', marginTop: 20 }}>
      <div style={{ background: 'linear-gradient(135deg,#1E40AF,#2563EB)', borderRadius: '10px 10px 0 0', padding: '10px 16px', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <div>
          <div style={{ color: '#fff', fontWeight: 800, fontSize: 13 }}>🏭 Monthly Remittance — SRCB</div>
          <div style={{ color: 'rgba(255,255,255,.7)', fontSize: 10, marginTop: 1 }}>{subtitle}</div>
        </div>
        <div style={{ color: 'rgba(255,255,255,.6)', fontSize: 10 }}>Date-wise bank deposit details</div>
      </div>
      <div style={{ overflowX: 'auto', border: '1px solid #DBEAFE', borderTop: 'none', borderRadius: '0 0 10px 10px' }}>
        <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12, minWidth: 700 }}>
          <thead>
            <tr style={{ background: '#EFF6FF' }}>
              <th style={th}>S.No</th>
              <th style={{ ...th, textAlign: 'left', padding: '8px 12px' }}>Sales Date</th>
              <th style={th}>Remittance Date</th>
              <th style={{ ...th, textAlign: 'right' }}>Non-Cereal A/C (₹)</th>
              <th style={{ ...th, textAlign: 'right' }}>Cereal A/C (₹)</th>
              <th style={{ ...th, textAlign: 'right', color: '#0369A1', background: '#DBEAFE' }}>Total Amount (₹)</th>
              {isAdmin ? <th style={{ ...th, textAlign: 'right' }} title="Administrator: correct, remove or add a deposit">Edit</th> : null}
            </tr>
          </thead>
          <tbody>
            {dayRows}
            {extraRows}
          </tbody>
          <tfoot>
            <tr style={{ background: '#1E40AF' }}>
              <td colSpan={3} style={{ padding: '8px 12px', fontWeight: 800, fontSize: 12, color: '#fff', textAlign: 'right' }}>TOTAL</td>
              <td style={{ padding: '8px 10px', fontWeight: 800, fontSize: 13, color: '#fff', textAlign: 'right' }}>{inr(totNC)}</td>
              <td style={{ padding: '8px 10px', fontWeight: 800, fontSize: 13, color: '#fff', textAlign: 'right' }}>{inr(totCE)}</td>
              <td style={{ padding: '8px 10px', fontWeight: 900, fontSize: 14, color: '#FDE68A', textAlign: 'right' }}>{inr(totNC + totCE)}</td>
              {isAdmin ? <td /> : null}
            </tr>
          </tfoot>
        </table>
      </div>
      <div style={{ marginTop: 8, fontSize: 10, color: 'var(--muted)', display: 'flex', gap: 16 }}>
        <span>ⓘ Same Remittance Date allowed for multiple days (batch deposit)</span>
        <span>ⓘ Leave Remittance Date empty if no deposit was made that day</span>
      </div>
    </div>
  );
}
