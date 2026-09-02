'use client';

/**
 * Gunny Stock Management — port of buildMeGunnyTable / meGunnyRefreshReceipts
 * (15-monthly-extras.js incl. the receiptImported override).
 *
 * Opening auto-carries from last month's closing and locks once carried;
 * Receipt is automatic — the office's imported figure wins, else the Sales
 * Close totals, else the live Monthly-Sales gunny counts; Issues are typed
 * and flow into the grid's Empty Polythene Bag / Empty Card+Box sales rows.
 * Total = Opening + Receipt; Closing = Total − Issues (red when negative).
 */
import { crsData } from '@/lib/dataStore';
import { ME_GUNNY_ITEMS, ME_GUNNY_TYPE, monthlySalesBags, type GunnyRec, type MonthCtx, type SalesClose } from './lib';

export default function GunnyTable({
  ctx,
  gunny,
  salesClose,
  gridGunnySales,
  onIssuesToMonthly,
  subtitle,
}: {
  ctx: MonthCtx;
  gunny: Record<string, Record<string, GunnyRec>>;
  salesClose: SalesClose | undefined;
  gridGunnySales: Record<string, number>;
  onIssuesToMonthly: (commId: string, issues: string) => void;
  subtitle: string;
}) {
  const month = gunny[ctx.key] ?? {};
  const prevKey = `${ctx.crsId}_${ctx.month === 1 ? 12 : ctx.month - 1}_${ctx.month === 1 ? ctx.year - 1 : ctx.year}`;
  const prevMonth = gunny[prevKey] ?? {};

  const receiptFor = (id: string): { val: number; src: string; imported: boolean } => {
    const rec = month[id];
    if (rec?.receiptImported !== undefined && rec.receiptImported !== null && String(rec.receiptImported) !== '') {
      return { val: Number(rec.receiptImported) || 0, src: 'Imported from the office workbook', imported: true };
    }
    if (salesClose) {
      const type = ME_GUNNY_TYPE[id];
      const v = type === 'GUNNY' ? salesClose.gunny : type === 'POLY' ? salesClose.poly : salesClose.cbox;
      return { val: v || 0, src: `Auto from Sales Close (${salesClose.date.split('-').reverse().join('/')})`, imported: false };
    }
    return { val: monthlySalesBags(ME_GUNNY_TYPE[id], gridGunnySales), src: `Auto from Monthly Entry Sales (${ME_GUNNY_TYPE[id].toLowerCase()} counts)`, imported: false };
  };

  const rowFor = (id: string) => {
    const rec = month[id] ?? {};
    // Opening: auto-carry from the previous month's closing when this month
    // has no figure of its own (locked once carried — 15-monthly-extras).
    const prevClosing = prevMonth[id]?.closing;
    const hasOwnOpening = rec.opening !== undefined && rec.opening !== '';
    const openingAuto = !hasOwnOpening && prevClosing !== undefined ? true : !!rec.openingAuto && hasOwnOpening;
    const opening = hasOwnOpening ? Number(rec.opening) || 0 : prevClosing !== undefined ? Number(prevClosing) || 0 : 0;
    const openingVal = hasOwnOpening ? String(rec.opening) : prevClosing !== undefined ? String(prevClosing) : '';
    const rc = receiptFor(id);
    const issues = rec.issues !== undefined && rec.issues !== '' ? Number(rec.issues) : '';
    const total = opening + rc.val;
    const closing = total - (Number(issues) || 0);
    return { rec, opening, openingVal, openingAuto, rc, issues, total, closing };
  };

  const write = (id: string, patch: Partial<GunnyRec>) => {
    crsData.update<Record<string, Record<string, GunnyRec>>>('meGunnyStore', (d) => {
      const m = { ...(d[ctx.key] ?? {}) };
      const label = ME_GUNNY_ITEMS.find((i) => i.id === id)?.label ?? id;
      const cur = { ...(m[id] ?? {}) };
      const r = rowFor(id);
      m[id] = {
        itemName: cur.itemName ?? label,
        crsId: String(ctx.crsId),
        month: ctx.month,
        year: ctx.year,
        opening: cur.opening !== undefined && cur.opening !== '' ? cur.opening : r.openingVal !== '' ? Number(r.openingVal) : undefined,
        openingAuto: cur.opening === undefined || cur.opening === '' ? r.openingAuto : cur.openingAuto,
        ...cur,
        ...patch,
        updatedAt: new Date().toISOString(),
      };
      // keep the derived fields stored, as the legacy table did
      const after = m[id];
      const rc = after.receiptImported !== undefined && String(after.receiptImported) !== '' ? Number(after.receiptImported) || 0 : r.rc.val;
      const open = Number(after.opening) || 0;
      const iss = Number(after.issues) || 0;
      after.receipt = rc;
      after.total = open + rc;
      after.closing = open + rc - iss;
      d[ctx.key] = m;
    });
  };

  const totals = { opening: 0, receipt: 0, total: 0, issues: 0, closing: 0 };
  const rows = ME_GUNNY_ITEMS.map((item) => {
    const r = rowFor(item.id);
    totals.opening += r.opening;
    totals.receipt += r.rc.val;
    totals.total += r.total;
    totals.issues += Number(r.issues) || 0;
    totals.closing += r.closing;
    return { item, ...r };
  });

  const th = { padding: '9px 10px', textAlign: 'center' as const, fontSize: 10, fontWeight: 700, color: '#6D28D9', borderBottom: '2px solid #DDD6FE' };

  return (
    <div style={{ width: '100%', marginTop: 20 }}>
      <div style={{ background: 'linear-gradient(135deg,#6D28D9,#8B5CF6)', borderRadius: '10px 10px 0 0', padding: '10px 16px', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <div>
          <div style={{ color: '#fff', fontWeight: 800, fontSize: 13 }}>📦 Gunny Stock Management</div>
          <div style={{ color: 'rgba(255,255,255,.7)', fontSize: 10, marginTop: 1 }}>{subtitle}</div>
        </div>
        <div style={{ color: 'rgba(255,255,255,.6)', fontSize: 10 }}>Gunny bags / sacks — opening, receipt, issues &amp; closing</div>
      </div>
      <div style={{ overflowX: 'auto', border: '1px solid #EDE9FE', borderTop: 'none', borderRadius: '0 0 10px 10px' }}>
        <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12, minWidth: 560 }}>
          <thead>
            <tr style={{ background: '#F5F3FF' }}>
              <th style={{ ...th, width: 55 }}>S.No</th>
              <th style={{ ...th, textAlign: 'left', padding: '9px 14px' }}>Item</th>
              <th style={th}>Opening</th>
              <th style={th}>Receipt</th>
              <th style={{ ...th, background: '#EDE9FE' }}>Total</th>
              <th style={th}>Issues</th>
              <th style={th}>Closing</th>
            </tr>
          </thead>
          <tbody>
            {rows.map(({ item, openingVal, openingAuto, rc, issues, total, closing }, i) => (
              <tr key={item.id} style={{ background: i % 2 === 0 ? '#fff' : '#FAF5FF' }}>
                <td style={{ padding: 8, textAlign: 'center', fontSize: 11, color: 'var(--muted)', borderBottom: '1px solid #EDE9FE' }}>{i + 1}</td>
                <td style={{ padding: '8px 12px', fontWeight: 600, fontSize: 12, borderBottom: '1px solid #EDE9FE' }}>{item.label}</td>
                <td style={{ padding: '4px 5px', borderBottom: '1px solid #EDE9FE' }}>
                  <input
                    type="number"
                    min={0}
                    step={0.01}
                    placeholder="0"
                    readOnly={openingAuto}
                    value={openingVal}
                    onChange={(e) => write(item.id, { opening: e.target.value === '' ? '' : Number(e.target.value), openingAuto: false })}
                    title={openingAuto ? "Carried forward from last month's closing" : undefined}
                    style={{ width: '100%', border: `1px solid ${openingAuto ? '#FDE68A' : '#DDD6FE'}`, borderRadius: 6, padding: '5px 7px', fontSize: 12, textAlign: 'right', ...(openingAuto ? { background: '#FEF3C7', color: '#92400E', fontWeight: 700 } : {}) }}
                  />
                </td>
                <td style={{ padding: '4px 5px', borderBottom: '1px solid #EDE9FE' }}>
                  <input
                    type="text"
                    readOnly
                    tabIndex={-1}
                    value={rc.val ? String(rc.val) : ''}
                    title={rc.src}
                    style={{ width: '100%', border: `1px solid ${rc.imported ? '#BAE6FD' : '#BBF7D0'}`, borderRadius: 6, padding: '5px 7px', fontSize: 12, textAlign: 'right', color: rc.imported ? '#0369A1' : '#15803D', fontWeight: 700, background: rc.imported ? '#F0F9FF' : '#F0FDF4' }}
                  />
                </td>
                <td style={{ padding: '4px 5px', borderBottom: '1px solid #EDE9FE' }}>
                  <input type="text" readOnly tabIndex={-1} value={String(total)} style={{ width: '100%', border: '1px solid #DDD6FE', borderRadius: 6, padding: '5px 7px', fontSize: 12, textAlign: 'right', fontWeight: 700, background: '#EDE9FE', color: '#6D28D9' }} />
                </td>
                <td style={{ padding: '4px 5px', borderBottom: '1px solid #EDE9FE' }}>
                  <input
                    type="number"
                    min={0}
                    step={0.01}
                    placeholder="0"
                    value={issues === '' ? '' : String(issues)}
                    onChange={(e) => {
                      write(item.id, { issues: e.target.value === '' ? '' : Number(e.target.value) });
                      onIssuesToMonthly(item.id, e.target.value);
                    }}
                    style={{ width: '100%', border: '1px solid #FCA5A5', borderRadius: 6, padding: '5px 7px', fontSize: 12, textAlign: 'right', color: '#DC2626', fontWeight: 600, background: '#FEF2F2' }}
                  />
                </td>
                <td style={{ padding: '4px 5px', borderBottom: '1px solid #EDE9FE' }}>
                  <input
                    type="text"
                    readOnly
                    tabIndex={-1}
                    value={String(closing)}
                    title={closing < 0 ? 'Deficit: Issues exceed Total' : undefined}
                    style={{ width: '100%', border: `1px solid ${closing < 0 ? '#FCA5A5' : '#E2E8F0'}`, borderRadius: 6, padding: '5px 7px', fontSize: 12, textAlign: 'right', fontWeight: closing < 0 ? 800 : 700, background: closing < 0 ? '#FEF2F2' : '#F8FAFC', color: closing < 0 ? '#DC2626' : 'var(--muted)' }}
                  />
                </td>
              </tr>
            ))}
          </tbody>
          <tfoot>
            <tr style={{ background: '#6D28D9' }}>
              <td colSpan={2} style={{ padding: '9px 14px', fontWeight: 800, color: '#fff', fontSize: 12, textAlign: 'right', letterSpacing: '.03em' }}>TOTAL</td>
              {[totals.opening, totals.receipt, totals.total, totals.issues, totals.closing].map((v, i) => (
                <td key={i} style={{ padding: '9px 10px', fontWeight: i === 2 || i === 4 ? 900 : 800, fontSize: i === 2 || i === 4 ? 14 : 13, color: i === 2 || i === 4 ? '#FDE68A' : '#fff', textAlign: 'center' }}>{v}</td>
              ))}
            </tr>
          </tfoot>
        </table>
      </div>
      <div style={{ marginTop: 8, fontSize: 10, color: 'var(--muted)', display: 'flex', gap: 16, flexWrap: 'wrap' }}>
        <span>ⓘ Opening auto-fills from last month&apos;s Closing and locks once carried forward</span>
        <span>ⓘ Receipt is automatic — imported workbook figure, Sales Close totals, or the Monthly Sales gunny/poly/c.box counts</span>
        <span>
          ⓘ Total = Opening + Receipt &nbsp;|&nbsp; Closing = Total − Issues (turns <b style={{ color: '#DC2626' }}>red</b> if Issues exceed Total) &nbsp;|&nbsp; Issues flow into Monthly Sales (Poly → Poly Bag, C.Box → Card+Box)
        </span>
      </div>
    </div>
  );
}
