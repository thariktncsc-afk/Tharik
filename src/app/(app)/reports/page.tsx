'use client';

/**
 * Reports — React port of 04-reports.js and the CRS 29 report scoping in
 * 28-crs29-dashboard.js.
 *
 * Daily/Monthly: commodity sales summary over the picked month with the
 * sales/receipts/days KPI row (the legacy Daily tab aggregated by month too;
 * behaviour kept). Quarterly/Yearly: the printable PV statement, built by
 * src/lib/engine/pvStatement.ts and printed via the #pv-print-area rules.
 *
 * CRS 29: when the camp is the selected shop, its report keeps only the
 * commodities it keys (the seven stocked lines plus the two paid packing
 * lines) and drops the police section — same scope the engine enforced.
 * Receipt totals count item quantities (the legacy sum over item objects
 * was always 0 — noted in pvStatement.ts too).
 */
import { useMemo, useState } from 'react';
import { useAuth } from '@/lib/authClient';
import { useStore } from '@/lib/dataStore';
import { CRS29_STOCK, DSS_A, DSS_B, isCrs29, type DayEntry } from '@/lib/engine/commodities';
import { useCommodityMaster, useShops } from '@/lib/masters';
import { buildPVTable, pvAggregatePeriod } from '@/lib/engine/pvStatement';

type ShopRec = { name: string };
type ReceiptRec = { crsId: number; date: string; items?: Record<string, { qty: number }> };
type ReportType = 'daily' | 'monthly' | 'quarterly' | 'yearly';

const MNAMES = ['', 'January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
const pad2 = (n: number) => String(n).padStart(2, '0');
const fmtAmt = (n: number) => '₹' + n.toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

// CRS 29 report scope: the stocked lines plus the paid packing lines.
const CRS29_REPORT_IDS = new Set([...CRS29_STOCK.map((c) => c.id), 'EMPTY_BAG', 'EMPTY_BOX']);

function scopedEntry(crsId: number | '', entry: DayEntry | undefined): DayEntry | undefined {
  if (!entry || crsId === '' || !isCrs29(crsId)) return entry;
  const a: DayEntry['a'] = {};
  for (const [id, rec] of Object.entries(entry.a ?? {})) if (CRS29_REPORT_IDS.has(id)) a![id] = rec;
  return { a, b: {} };
}

export default function ReportsPage() {
  const { user } = useAuth();
  const shops: ShopRec[] = useShops();
  const commodityMaster = useCommodityMaster();
  const entryStore = useStore<Record<string, DayEntry>>('entryStore') ?? {};
  const receiptStore = useStore<ReceiptRec[]>('receiptStore') ?? [];
  const monthlyStore = useStore<Record<string, never>>('monthlyStore') ?? {};
  const meGunnyStore = useStore<Record<string, Record<string, { opening?: number }>>>('meGunnyStore') ?? {};

  const isAdmin = user?.role === 'ADMIN';
  const now = new Date();

  const [type, setType] = useState<ReportType>('monthly');
  const [crsVal, setCrsVal] = useState(isAdmin ? '' : String(user?.crsId ?? ''));
  const [dateVal, setDateVal] = useState(now.toISOString().split('T')[0]);
  const [monthVal, setMonthVal] = useState(`${now.getFullYear()}-${pad2(now.getMonth() + 1)}`);
  const [quarterVal, setQuarterVal] = useState(`${now.getFullYear()}-${pad2(now.getMonth() + 1)}`);
  const curFY = now.getMonth() >= 3 ? now.getFullYear() : now.getFullYear() - 1;
  const [fyVal, setFyVal] = useState(String(curFY));
  const [generated, setGenerated] = useState(0); // bump to (re)generate

  const shopIds = shops.map((_, i) => i + 1);
  const crsIds = crsVal ? [Number(crsVal)] : shopIds;
  const isPV = type === 'quarterly' || type === 'yearly';

  const monthOptions = useMemo(() => {
    const out: { value: string; label: string }[] = [];
    for (let back = 0; back < 24; back++) {
      const d = new Date(now.getFullYear(), now.getMonth() - back, 1);
      out.push({ value: `${d.getFullYear()}-${pad2(d.getMonth() + 1)}`, label: `${MNAMES[d.getMonth() + 1]} ${d.getFullYear()}` });
    }
    return out;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  const quarterOptions = useMemo(() => {
    const out: { value: string; label: string }[] = [];
    for (let back = 0; back < 8; back++) {
      const qd = new Date(now.getFullYear(), now.getMonth() - back * 3, 1);
      const endMo = new Date(qd.getFullYear(), qd.getMonth() + 3, 0);
      out.push({
        value: `${qd.getFullYear()}-${pad2(qd.getMonth() + 1)}`,
        label: `${MNAMES[qd.getMonth() + 1]} ${qd.getFullYear()} — ${MNAMES[endMo.getMonth() + 1]} ${endMo.getFullYear()}`,
      });
    }
    return out;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ── Daily / Monthly aggregation ───────────────────────────────────────────
  const summary = useMemo(() => {
    const [moYear, moNum] = monthVal ? monthVal.split('-').map(Number) : [0, 0];
    const commMap: Record<string, { name: string; unit: string; qty: number; amount: number; free: boolean }> = {};
    let totalSales = 0;
    let totalReceipts = 0;
    const daysSet = new Set<string>();
    const daysInMo = moYear ? new Date(moYear, moNum, 0).getDate() : 0;
    const lookup = commodityMaster ?? [...DSS_A, ...DSS_B, ...CRS29_STOCK];
    for (const cid of crsIds) {
      for (let d = 1; d <= daysInMo; d++) {
        const dk = `${cid}_${moYear}-${pad2(moNum)}-${pad2(d)}`;
        const e = scopedEntry(crsVal ? Number(crsVal) : '', entryStore[dk]);
        if (!e || !entryStore[dk]) continue;
        daysSet.add(dk);
        for (const sec of ['a', 'b'] as const) {
          for (const [commId, row] of Object.entries(e[sec] ?? {})) {
            const qty = Number(row.sales) || 0;
            const amt = Number(row.amount) || 0;
            totalSales += amt;
            if (!commMap[commId]) {
              const cm = lookup.find((x) => x.id === commId);
              commMap[commId] = { name: cm?.en ?? commId, unit: cm?.unit ?? 'KG', qty: 0, amount: 0, free: !!cm?.free };
            }
            commMap[commId].qty += qty;
            commMap[commId].amount += amt;
          }
        }
      }
      for (const r of receiptStore) {
        if (r.crsId !== cid) continue;
        const [ry, rm] = r.date.split('-').map(Number);
        if (moYear && (ry !== moYear || rm !== moNum)) continue;
        for (const it of Object.values(r.items ?? {})) totalReceipts += Number(it?.qty) || 0;
      }
    }
    return { commMap, totalSales, totalReceipts, days: daysSet.size, moYear, moNum };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [entryStore, receiptStore, monthVal, crsVal, generated, commodityMaster]);

  // ── PV statement HTML ─────────────────────────────────────────────────────
  const pvHtml = useMemo(() => {
    if (!isPV || !crsVal) return '';
    const months: { year: number; month: number }[] = [];
    let periodLabel = '';
    if (type === 'quarterly') {
      const [qYear, qMo] = quarterVal.split('-').map(Number);
      for (let i = 0; i < 3; i++) {
        let m = qMo + i;
        let y = qYear;
        if (m > 12) {
          m -= 12;
          y++;
        }
        months.push({ year: y, month: m });
      }
      const end = months[2];
      const endDate = new Date(end.year, end.month, 0);
      periodLabel = `1.${pad2(months[0].month)}.${months[0].year} TO ${endDate.getDate()}.${pad2(end.month)}.${end.year}`;
    } else {
      const fy = Number(fyVal);
      for (let m = 4; m <= 12; m++) months.push({ year: fy, month: m });
      for (let m = 1; m <= 3; m++) months.push({ year: fy + 1, month: m });
      periodLabel = `1.04.${fy} TO 31.03.${fy + 1}`;
    }
    const crsId = Number(crsVal);
    const agg = pvAggregatePeriod([crsId], months, { entryStore, receiptStore, monthlyStore });
    const gunny = meGunnyStore[`${crsId}_${months[0].month}_${months[0].year}`] ?? {};
    return buildPVTable({
      commMap: agg.commMap,
      periodLabel,
      crsId,
      crsName: shops[crsId - 1]?.name ?? '',
      gunny,
      billClerk: user?.fullName ?? '',
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isPV, type, crsVal, quarterVal, fyVal, entryStore, receiptStore, monthlyStore, meGunnyStore, generated]);

  const rows = Object.entries(summary.commMap)
    .map(([id, r]) => ({ id, ...r }))
    .sort((a, b) => b.amount - a.amount);
  const maxAmt = rows.length ? Math.max(...rows.map((r) => r.amount)) : 1;

  const tabBtn = (t: ReportType, label: string) => (
    <button key={t} className={t === type ? 'btn btn-primary btn-sm' : 'btn btn-outline btn-sm'} onClick={() => setType(t)}>
      {label}
    </button>
  );
  const sel = { width: '100%', border: '1px solid var(--border)', borderRadius: 8, padding: '8px 12px', fontSize: 13, outline: 'none' } as const;
  const crsLabel = crsVal ? `CRS ${crsVal}` : 'All CRS Shops';
  const moLabel = summary.moYear ? `${MNAMES[summary.moNum]} ${summary.moYear}` : '';

  return (
    <div className="page active" id="page-reports">
      <div className="page-header">
        <div className="page-title">Reports</div>
        <div className="page-sub">Daily, monthly, quarterly and yearly analysis · PV Statement generator</div>
      </div>
      <div className="card mb-4">
        <div className="card-body">
          <div className="flex gap-2 mb-4">
            {tabBtn('daily', 'Daily')}
            {tabBtn('monthly', 'Monthly')}
            {tabBtn('quarterly', '📋 Quarterly PV (3-Month)')}
            {tabBtn('yearly', '📋 Yearly PV')}
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr 1fr', gap: 12, alignItems: 'end' }}>
            <div>
              <label className="form-label">CRS SHOP</label>
              <select
                value={crsVal}
                onChange={(e) => setCrsVal(e.target.value)}
                disabled={!isAdmin}
                style={{ ...sel, background: isAdmin ? undefined : '#F1F5F9', color: isAdmin ? undefined : '#64748B' }}
              >
                {isAdmin ? <option value="">All CRS Shops</option> : null}
                {(isAdmin ? shopIds : [user?.crsId].filter(Boolean)).map((id) => (
                  <option key={id} value={String(id)}>
                    CRS {id} — {shops[(id as number) - 1]?.name ?? ''}
                  </option>
                ))}
              </select>
            </div>
            {type === 'daily' ? (
              <div>
                <label className="form-label">DATE</label>
                <input type="date" value={dateVal} onChange={(e) => setDateVal(e.target.value)} style={sel} />
              </div>
            ) : null}
            {type === 'daily' || type === 'monthly' ? (
              <div>
                <label className="form-label">MONTH</label>
                <select value={monthVal} onChange={(e) => setMonthVal(e.target.value)} style={sel}>
                  {monthOptions.map((o) => (
                    <option key={o.value} value={o.value}>
                      {o.label}
                    </option>
                  ))}
                </select>
              </div>
            ) : null}
            {type === 'quarterly' ? (
              <div>
                <label className="form-label">QUARTER START MONTH</label>
                <select value={quarterVal} onChange={(e) => setQuarterVal(e.target.value)} style={sel}>
                  {quarterOptions.map((o) => (
                    <option key={o.value} value={o.value}>
                      {o.label}
                    </option>
                  ))}
                </select>
              </div>
            ) : null}
            {type === 'yearly' ? (
              <div>
                <label className="form-label">FINANCIAL YEAR</label>
                <select value={fyVal} onChange={(e) => setFyVal(e.target.value)} style={sel}>
                  {[0, 1, 2, 3].map((back) => {
                    const fy = curFY - back;
                    return (
                      <option key={fy} value={String(fy)}>
                        {fy}-{String(fy + 1).slice(-2)} (Apr {fy} — Mar {fy + 1})
                      </option>
                    );
                  })}
                </select>
              </div>
            ) : null}
            <div>
              <button onClick={() => setGenerated((g) => g + 1)} className="btn btn-primary" style={{ width: '100%', fontSize: 13, padding: '9px 0' }}>
                Generate Report
              </button>
            </div>
          </div>
          {isPV ? (
            <div style={{ display: 'flex', marginTop: 12, gap: 10, alignItems: 'center' }}>
              <button
                onClick={() => {
                  if (!pvHtml) {
                    alert('Generate a PV Statement first.');
                    return;
                  }
                  window.print();
                }}
                style={{ background: 'linear-gradient(135deg,#1B3A6B,#2563EB)', color: '#fff', border: 'none', padding: '9px 20px', borderRadius: 8, fontWeight: 700, fontSize: 13, cursor: 'pointer' }}
              >
                🖨️ Print PV Statement
              </button>
              <span style={{ fontSize: 11, color: 'var(--muted)' }}>Physical verification columns are left blank for the PV officer to fill on-site</span>
            </div>
          ) : null}
        </div>
      </div>

      {!isPV ? (
        <div className="grid g3 mb-4">
          <div className="kpi">
            <div className="kpi-icon" style={{ background: '#FEE2E2' }}>💰</div>
            <div>
              <div className="kpi-val" style={{ color: 'var(--red)' }}>{fmtAmt(summary.totalSales)}</div>
              <div className="kpi-label">Total Sales</div>
            </div>
          </div>
          <div className="kpi">
            <div className="kpi-icon" style={{ background: '#DCFCE7' }}>📦</div>
            <div>
              <div className="kpi-val" style={{ color: 'var(--green)' }}>
                {summary.totalReceipts.toLocaleString('en-IN', { maximumFractionDigits: 3 })}
              </div>
              <div className="kpi-label">Total Receipts (qty)</div>
            </div>
          </div>
          <div className="kpi">
            <div className="kpi-icon" style={{ background: '#DBEAFE' }}>📅</div>
            <div>
              <div className="kpi-val" style={{ color: 'var(--navy)' }}>{summary.days}</div>
              <div className="kpi-label">Days with Entries</div>
            </div>
          </div>
        </div>
      ) : null}

      <div className="card">
        <div className="card-header" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <div className="card-title">
            {isPV
              ? crsVal
                ? `PV Statement — CRS ${crsVal}`
                : 'PV Statement'
              : `Sales by Commodity — ${moLabel} · ${crsLabel}`}
          </div>
        </div>
        <div style={{ overflowX: 'auto' }}>
          {isPV ? (
            crsVal ? (
              <div dangerouslySetInnerHTML={{ __html: pvHtml }} />
            ) : (
              <div style={{ textAlign: 'center', padding: 24, color: 'var(--muted)' }}>Please select a specific CRS shop to generate a PV Statement.</div>
            )
          ) : rows.length === 0 ? (
            <div style={{ textAlign: 'center', padding: 32, color: 'var(--muted)' }}>No entry data found for the selected period.</div>
          ) : (
            <>
              <div className="table-wrap">
                <table>
                  <thead>
                    <tr>
                      <th>Commodity</th>
                      <th>Unit</th>
                      <th>Total Qty</th>
                      <th>Total Amount</th>
                      <th>% of Sales</th>
                    </tr>
                  </thead>
                  <tbody>
                    {rows.map((r) => {
                      const pct = summary.totalSales > 0 ? Math.round((r.amount / summary.totalSales) * 100) : 0;
                      const col = r.free ? 'var(--navy)' : r.amount > 10000 ? 'var(--gold)' : '#10B981';
                      const bw = maxAmt > 0 ? Math.round((r.amount / maxAmt) * 100) : 0;
                      return (
                        <tr key={r.id}>
                          <td>
                            <strong>{r.name}</strong>
                          </td>
                          <td>{r.unit}</td>
                          <td>{r.qty.toLocaleString('en-IN', { maximumFractionDigits: 3 })}</td>
                          <td style={{ fontWeight: 700, color: r.free ? 'var(--muted)' : 'var(--red)' }}>{r.free ? 'Free' : fmtAmt(r.amount)}</td>
                          <td>
                            <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                              <div style={{ height: 6, width: `${bw}%`, background: col, borderRadius: 3, minWidth: 2, maxWidth: 140 }} />
                              <span style={{ fontSize: 11, color: 'var(--muted)' }}>{pct}%</span>
                            </div>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
              <div style={{ margin: 12, padding: '10px 14px', background: '#F8FAFC', borderRadius: 10, display: 'flex', gap: 24, fontSize: 12, flexWrap: 'wrap' }}>
                <span>
                  <strong>Total Paid Sales:</strong> {fmtAmt(summary.totalSales)}
                </span>
                <span>
                  <strong>Entries:</strong> {summary.days} days
                </span>
                <span style={{ color: 'var(--muted)' }}>Free commodities shown at qty only</span>
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
