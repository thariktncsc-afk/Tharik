'use client';

/**
 * Monthly Remittance — SRCB — port of buildMeRemitTable (15-monthly-extras.js),
 * with the day sheets' deposits folded in.
 *
 * A day that was keyed in Daily Sales Entry shows its deposits here
 * automatically, one row per transaction, READ-ONLY — nobody keys the same
 * remittance twice, and because the rows are derived rather than copied they
 * cannot duplicate on a re-save or drift from the day sheet. Correct them on
 * the Daily Entry page. A day with no sheet keeps the hand-keyed inputs it
 * always had, so the imported months and the monthly-only shops are unchanged.
 *
 * A sales date can carry several deposits: the first is the ordinary one, and
 * each later one is an additional remittance with a reason (Missed / Tea /
 * Salt / C.Box). Those always sit in Non-Cereal, and their reason is shown
 * where a plain row shows a Cereal figure. That substitution is display only —
 * see src/lib/engine/remittance.ts — so the Cereal total below, and the Cereal
 * column on the statutory statement, stay totals of money.
 */
import { crsData } from '@/lib/dataStore';
import { amounts, monthTxns, type RemitRow, type SheetLike } from '@/lib/engine/remittance';
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
  const month = remit[ctx.key] ?? {};
  const daysInMonth = new Date(ctx.year, ctx.month, 0).getDate();
  const extra = (month['extra'] ?? {}) as RemitExtra;

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

  for (let day = 1; day <= daysInMonth; day++) {
    const dateObj = new Date(ctx.year, ctx.month - 1, day);
    const salesLabel = `${String(day).padStart(2, '0')}/${String(ctx.month).padStart(2, '0')}/${ctx.year}`;
    const dow = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'][dateObj.getDay()];
    const txns = byDay.get(day);

    // ── Days keyed in Daily Entry: one read-only row per deposit ───────────
    if (txns?.length) {
      txns.forEach((t) => {
        const { nc, ce } = amounts(t);
        totNC += nc;
        totCE += ce;
        serial++;
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
          </tr>,
        );
      });
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
