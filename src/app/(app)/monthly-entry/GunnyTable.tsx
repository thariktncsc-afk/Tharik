'use client';

/**
 * Gunny Stock Management — port of buildMeGunnyTable / meGunnyRefreshReceipts
 * (15-monthly-extras.js incl. the receiptImported override).
 *
 * Opening auto-carries from last month's closing; Receipt is automatic — the
 * office's imported figure wins, else the Sales Close totals, else the live
 * Monthly-Sales gunny counts. Total = Opening + Receipt; Closing = Total −
 * Issues (red when negative).
 *
 * Office, 2026-09-26:
 *   · POLY and C.BOX take their Issues from the grid's own Empty Polythene
 *     Bag / Empty Card+Box SALES — the deduction the shop keys once. It used
 *     to run the other way (typing Issues here wrote those sales rows), which
 *     is why the sale had nowhere to go but a negative CB on the grid.
 *   · Opening, Receipt, Total, Closing — and the two automatic Issues — are
 *     read-only for shop staff. Only an administrator may correct them, and
 *     /api/state refuses the write regardless of what this screen allows
 *     (src/lib/stockGuard.ts, rule 5).
 */
import { crsData } from '@/lib/dataStore';
import { ME_GUNNY_ITEMS, gunnyRowFor, type GunnyRec, type MonthCtx, type SalesClose } from './lib';

export default function GunnyTable({
  ctx,
  gunny,
  salesClose,
  gridGunnySales,
  packSales,
  isAdmin,
  subtitle,
}: {
  ctx: MonthCtx;
  gunny: Record<string, Record<string, GunnyRec>>;
  salesClose: SalesClose | undefined;
  gridGunnySales: Record<string, number>;
  /** The month's sales per commodity — EMPTY_BAG / EMPTY_BOX become POLY / C.BOX Issues. */
  packSales: Record<string, number>;
  isAdmin: boolean;
  subtitle: string;
}) {
  const month = gunny[ctx.key] ?? {};
  const prevKey = `${ctx.crsId}_${ctx.month === 1 ? 12 : ctx.month - 1}_${ctx.month === 1 ? ctx.year - 1 : ctx.year}`;
  const prevMonth = gunny[prevKey] ?? {};

  // The row's arithmetic lives in lib.ts (gunnyRowFor), shared with the
  // 3-month PV so the two can never show different September Gunny figures.
  // Opening auto-carries from last month's closing and locks once carried
  // (15-monthly-extras).
  const rowFor = (id: string) => gunnyRowFor(id, month, prevMonth, salesClose, gridGunnySales, packSales);

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

  // No TOTAL summary under the table (office, 2026-09-26): 50 KG SS sacks,
  // polythene bags and card boxes are three different things and adding them
  // into one figure states a quantity of nothing. Each row keeps its own
  // Total — Opening + Receipt — which is what the office does use.
  const rows = ME_GUNNY_ITEMS.map((item) => ({ item, ...rowFor(item.id) }));

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
            {rows.map(({ item, openingVal, openingAuto, rc, issues, issuesAuto, total, closing }, i) => (
              <tr key={item.id} style={{ background: i % 2 === 0 ? '#fff' : '#FAF5FF' }}>
                <td style={{ padding: 8, textAlign: 'center', fontSize: 11, color: 'var(--muted)', borderBottom: '1px solid #EDE9FE' }}>{i + 1}</td>
                <td style={{ padding: '8px 12px', fontWeight: 600, fontSize: 12, borderBottom: '1px solid #EDE9FE' }}>{item.label}</td>
                <td style={{ padding: '4px 5px', borderBottom: '1px solid #EDE9FE' }}>
                  <input
                    type="number"
                    min={0}
                    step={0.01}
                    placeholder="0"
                    // Carried from last month, and never keyed by shop staff
                    // (office, 2026-09-26) — the server refuses it too
                    // (stockGuard rule 5). An administrator may always correct
                    // it, carried or not: that is how a wrong opening is put
                    // right, and the months after it re-carry from the result.
                    readOnly={!isAdmin}
                    tabIndex={!isAdmin ? -1 : undefined}
                    value={openingVal}
                    onChange={(e) => write(item.id, { opening: e.target.value === '' ? '' : Number(e.target.value), openingAuto: false })}
                    title={openingAuto ? "Carried forward from last month's closing" : !isAdmin ? 'Opening is set by the office — an administrator can correct it' : undefined}
                    style={{ width: '100%', border: `1px solid ${openingAuto ? '#FDE68A' : '#DDD6FE'}`, borderRadius: 6, padding: '5px 7px', fontSize: 12, textAlign: 'right', ...(openingAuto ? { background: '#FEF3C7', color: '#92400E', fontWeight: 700 } : !isAdmin ? { background: '#F8FAFC', color: 'var(--muted)', fontWeight: 700 } : {}) }}
                  />
                </td>
                <td style={{ padding: '4px 5px', borderBottom: '1px solid #EDE9FE' }}>
                  <input
                    // Derived for shop staff — the office's imported figure,
                    // the Sales Close totals, or the month's own bag counts.
                    // An administrator typing here sets the imported figure,
                    // which is the override the engine already reads.
                    type={isAdmin ? 'number' : 'text'}
                    readOnly={!isAdmin}
                    tabIndex={isAdmin ? undefined : -1}
                    onChange={isAdmin ? (e) => write(item.id, { receiptImported: e.target.value === '' ? undefined : Number(e.target.value) }) : undefined}
                    value={rc.val ? String(rc.val) : ''}
                    title={isAdmin ? `${rc.src} — type to override` : rc.src}
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
                    // POLY and C.BOX: the month's own sales of those bags, so
                    // the stock leaves once and by the figure the shop keyed
                    // on the grid — not typed again here. 50 KG SS has no
                    // commodity row of its own, so it stays hand-keyed by the
                    // shop, as it always has (office, 2026-09-26).
                    readOnly={issuesAuto && !isAdmin}
                    tabIndex={issuesAuto && !isAdmin ? -1 : undefined}
                    value={issues === '' ? '' : String(issues)}
                    onChange={(e) => write(item.id, { issues: e.target.value === '' ? '' : Number(e.target.value) })}
                    title={issuesAuto ? 'From this month’s sales of these bags on the grid above — an administrator can correct it' : undefined}
                    style={{ width: '100%', border: `1px solid ${issuesAuto ? '#FDE68A' : '#FCA5A5'}`, borderRadius: 6, padding: '5px 7px', fontSize: 12, textAlign: 'right', color: issuesAuto ? '#92400E' : '#DC2626', fontWeight: issuesAuto ? 700 : 600, background: issuesAuto ? '#FEF3C7' : '#FEF2F2' }}
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
        </table>
      </div>
      <div style={{ marginTop: 8, fontSize: 10, color: 'var(--muted)', display: 'flex', gap: 16, flexWrap: 'wrap' }}>
        <span>ⓘ Opening auto-fills from last month&apos;s Closing and locks once carried forward</span>
        <span>ⓘ Receipt is automatic — imported workbook figure, Sales Close totals, or the Monthly Sales gunny/poly/c.box counts</span>
        <span>ⓘ Issues for POLY and C.BOX are this month&apos;s Empty Polythene Bag / Empty Card+Box sales from the grid above</span>
        <span>
          ⓘ Total = Opening + Receipt &nbsp;|&nbsp; Closing = Total − Issues (turns <b style={{ color: '#DC2626' }}>red</b> if Issues exceed Total)
          {isAdmin ? null : <> &nbsp;|&nbsp; these figures are the office&apos;s — an administrator can correct them</>}
        </span>
      </div>
    </div>
  );
}
