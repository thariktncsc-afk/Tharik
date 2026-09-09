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
import { appAlert } from '@/components/dialog';
import { CRS29_STOCK, DSS_A, DSS_B, isCrs29, type DayEntry } from '@/lib/engine/commodities';
import { useCommodityMaster, useShops } from '@/lib/masters';
import { buildPVTable, pvAggregatePeriod, pvCommodityScope, type PvCommRow } from '@/lib/engine/pvStatement';
import { annualFor, annualOptions, monthName, quarterByIndex, quarterIndexOf, QUARTER_LABELS, type PvPeriod, type YearMonth } from '@/lib/engine/pvPeriod';
import { buildMonthlySheet, consolidateMonths, loadXlsx, monthlyFileName, type PvMonthData, type PvMonthRow } from '@/lib/engine/pvExcel';
import { normalise as normalisePvOfficers, resolveForStatement, type PvOfficerStore } from '@/lib/engine/pvOfficer';
import ManualPvUpload from './ManualPvUpload';

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
  const rawPvOfficers = useStore<PvOfficerStore>('__pvOfficers');

  const isAdmin = user?.role === 'ADMIN';
  const now = new Date();

  const [type, setType] = useState<ReportType>('monthly');
  const [crsVal, setCrsVal] = useState(isAdmin ? '' : String(user?.crsId ?? ''));
  const [dateVal, setDateVal] = useState(now.toISOString().split('T')[0]);
  const [monthVal, setMonthVal] = useState(`${now.getFullYear()}-${pad2(now.getMonth() + 1)}`);
  /**
   * A quarter is a financial year plus which of its four it is, so the screen
   * needs one year selector and four buttons rather than a dropdown of every
   * quarter ever. Both PV tabs share the year.
   */
  const [quarterIdx, setQuarterIdx] = useState(() => quarterIndexOf({ year: now.getFullYear(), month: now.getMonth() + 1 }));
  const curFY = now.getMonth() >= 3 ? now.getFullYear() : now.getFullYear() - 1;
  const [fyVal, setFyVal] = useState(String(curFY));
  const [generated, setGenerated] = useState(0); // bump to (re)generate
  /**
   * Automatic reads the shop's own stored months; Manual consolidates uploaded
   * Excel statements. Automatic is the default because for a shop using this
   * system the figures are already here, and re-reading them from a file can
   * only lose fidelity.
   */
  const [pvSource, setPvSource] = useState<'auto' | 'manual'>('auto');
  /**
   * Who verified this shop and on what day. Resolved from the group assignment
   * (src/lib/engine/pvOfficer.ts) so it reaches every PV the same way —
   * quarterly or annual, automatic or from uploaded files.
   */
  const pvOfficerStore = useMemo(() => normalisePvOfficers(rawPvOfficers), [rawPvOfficers]);
  const pvOfficer = useMemo(
    () => (crsVal ? resolveForStatement(pvOfficerStore, Number(crsVal)) : { officer: '', date: '' }),
    [pvOfficerStore, crsVal],
  );
  const [manualRows, setManualRows] = useState<PvMonthRow[] | null>(null);
  const [exporting, setExporting] = useState(false);

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
  /**
   * A PV period is a financial year plus which quarter of it — so the screen
   * offers one year list and four fixed quarters, rather than a dropdown of
   * rolling three-month windows. Those windows were the old bug: opened in
   * September they offered "Sep–Nov", a period no PV covers, whose opening and
   * closing came from the wrong months.
   */
  const fyList = useMemo(() => annualOptions(now), []); // eslint-disable-line react-hooks/exhaustive-deps

  // ── Daily / Monthly aggregation ───────────────────────────────────────────
  const summary = useMemo(() => {
    const [moYear, moNum] = monthVal ? monthVal.split('-').map(Number) : [0, 0];
    const commMap: Record<string, { name: string; unit: string; qty: number; amount: number; free: boolean }> = {};
    let totalSales = 0;
    let totalReceipts = 0;
    let totalRemit = 0;
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
            // A day sheet writes a row for EVERY commodity, so an all-zero row
            // is "not sold", not "sold nothing". Counting them filled the
            // table with 21 zero rows and hid the real empty state behind it.
            if (!qty && !amt) continue;
            totalSales += amt;
            if (!commMap[commId]) {
              const cm = lookup.find((x) => x.id === commId);
              commMap[commId] = { name: cm?.en ?? commId, unit: cm?.unit ?? 'KG', qty: 0, amount: 0, free: !!cm?.free };
            }
            commMap[commId].qty += qty;
            commMap[commId].amount += amt;
          }
        }
        // Deposits recorded on the day sheet. A month can hold remittance and
        // no sales at all — that month is not empty, and reporting it as
        // "₹0.00" with nothing else is what made this screen look broken.
        totalRemit += Number((entryStore[dk] as { remitAmount?: number }).remitAmount) || 0;
      }
      for (const r of receiptStore) {
        if (r.crsId !== cid) continue;
        const [ry, rm] = r.date.split('-').map(Number);
        if (moYear && (ry !== moYear || rm !== moNum)) continue;
        for (const it of Object.values(r.items ?? {})) totalReceipts += Number(it?.qty) || 0;
      }
    }
    return { commMap, totalSales, totalReceipts, totalRemit, days: daysSet.size, moYear, moNum };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [entryStore, receiptStore, monthVal, crsVal, generated, commodityMaster]);

  // ── PV statement HTML ─────────────────────────────────────────────────────
  /** The period the PV covers — decided by pvPeriod.ts, never by the clock. */
  const pvPeriod: PvPeriod | null = useMemo(() => {
    if (!isPV) return null;
    if (type === 'quarterly') return quarterByIndex(Number(fyVal), quarterIdx);
    return annualFor(Number(fyVal));
  }, [isPV, type, quarterIdx, fyVal]);

  /** Which of the period's months have a published monthly record. */
  const pvCoverage = useMemo((): { have: YearMonth[]; missing: YearMonth[] } => {
    if (!pvPeriod || !crsVal) return { have: [], missing: [] };
    const cid = Number(crsVal);
    const have = pvPeriod.months.filter((m) => !!monthlyStore[`${cid}_${m.month}_${m.year}`]);
    const missing = pvPeriod.months.filter((m) => !monthlyStore[`${cid}_${m.month}_${m.year}`]);
    return { have, missing };
  }, [pvPeriod, crsVal, monthlyStore]);

  const pvHtml = useMemo(() => {
    if (!isPV || !crsVal || !pvPeriod) return '';
    const crsId = Number(crsVal);
    // Manual: the uploaded months, already consolidated. Automatic: the stored
    // months. Both then go through the same builder, so the printed PV is the
    // same document either way.
    if (pvSource === 'manual') {
      if (!manualRows) return '';
      const commMap: Record<string, PvCommRow> = {};
      for (const r of manualRows) {
        commMap[r.commId] = {
          name: r.name, unit: r.unit, open: r.open, receipt: r.receipt,
          total: r.total, issues: r.sales, closing: r.closing, amount: r.amount, free: false,
        };
      }
      const first = pvPeriod.months[0];
      return buildPVTable({
        commMap,
        periodLabel: pvPeriod.rangeLabel,
        crsId,
        crsName: shops[crsId - 1]?.name ?? '',
        gunny: meGunnyStore[`${crsId}_${first.month}_${first.year}`] ?? {},
        billClerk: user?.fullName ?? '',
        pvOfficer: pvOfficer.officer,
        pvDate: pvOfficer.date,
      });
    }
    const agg = pvAggregatePeriod([crsId], pvPeriod.months, { entryStore, receiptStore, monthlyStore }, pvCommodityScope(crsId));
    const first = pvPeriod.months[0];
    const gunny = meGunnyStore[`${crsId}_${first.month}_${first.year}`] ?? {};
    return buildPVTable({
      commMap: agg.commMap,
      periodLabel: pvPeriod.rangeLabel,
      crsId,
      crsName: shops[crsId - 1]?.name ?? '',
      gunny,
      billClerk: user?.fullName ?? '',
        pvOfficer: pvOfficer.officer,
        pvDate: pvOfficer.date,
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isPV, pvPeriod, crsVal, pvSource, manualRows, pvOfficer, entryStore, receiptStore, monthlyStore, meGunnyStore, generated]);

  /**
   * The rows this month would export.
   *
   * Prefer the published month — it is what the statements read, and a
   * monthly-keyed shop has one even with no day sheets at all. Gating the
   * export on day-sheet sales alone would refuse exactly those shops.
   */
  const exportRows = useMemo((): PvMonthRow[] => {
    if (!crsVal || !summary.moNum) return [];
    const crsId = Number(crsVal);
    const scope = pvCommodityScope(crsId);
    const lookup = commodityMaster ?? [...DSS_A, ...DSS_B, ...CRS29_STOCK];
    const out: PvMonthRow[] = [];
    const mo = monthlyStore[`${crsId}_${summary.moNum}_${summary.moYear}`] as
      | { a?: Record<string, Record<string, number>>; b?: Record<string, Record<string, number>> }
      | undefined;
    if (mo) {
      for (const sec of ['a', 'b'] as const) {
        for (const [commId, v] of Object.entries(mo[sec] ?? {})) {
          if (scope && !scope.has(commId)) continue;
          const open = Number(v.open) || 0;
          const receipt = Number(v.receipt) || 0;
          const sales = Number(v.sales) || 0;
          if (!open && !receipt && !sales) continue;
          const cm = lookup.find((x) => x.id === commId);
          out.push({
            commId, name: cm?.en ?? commId, unit: cm?.unit ?? 'KG',
            open, receipt, total: open + receipt, sales, closing: open + receipt - sales,
            amount: Number(v.amount) || 0,
          });
        }
      }
    }
    if (out.length) return out;
    for (const [commId, r] of Object.entries(summary.commMap)) {
      if (scope && !scope.has(commId)) continue;
      out.push({ commId, name: r.name, unit: r.unit, open: 0, receipt: 0, total: 0, sales: r.qty, closing: 0, amount: r.amount });
    }
    return out;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [crsVal, summary, monthlyStore, commodityMaster]);

  /** This month as the sheet readMonthlyStatement() expects. */
  const exportMonthlyData = async () => {
    if (!crsVal || !exportRows.length) return;
    setExporting(true);
    try {
      const xlsx = await loadXlsx();
      const crsId = Number(crsVal);
      const data: PvMonthData = {
        crsId,
        crsName: shops[crsId - 1]?.name ?? '',
        month: summary.moNum,
        year: summary.moYear,
        rows: exportRows,
      };
      xlsx.writeFile(buildMonthlySheet(xlsx, data), monthlyFileName(data));
    } catch (e) {
      void appAlert(e instanceof Error ? e.message : 'Could not build the Excel file.');
    } finally {
      setExporting(false);
    }
  };

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
            {isPV ? (
              <div>
                <label className="form-label">PV SOURCE</label>
                <div style={{ display: 'flex', gap: 6 }}>
                  {([['auto', '⚡ Automatic'], ['manual', '📤 Manual Upload']] as const).map(([v, label]) => (
                    <button
                      key={v}
                      type="button"
                      onClick={() => { setPvSource(v); setManualRows(null); }}
                      disabled={v === 'manual' && type !== 'quarterly'}
                      title={v === 'manual' && type !== 'quarterly' ? 'Manual upload is available for the 3-Month PV' : undefined}
                      style={{
                        padding: '8px 14px', borderRadius: 8, fontSize: 12, fontWeight: 700, whiteSpace: 'nowrap',
                        cursor: v === 'manual' && type !== 'quarterly' ? 'not-allowed' : 'pointer',
                        border: `1px solid ${pvSource === v ? 'var(--navy, #0369A1)' : 'var(--border)'}`,
                        background: pvSource === v ? 'var(--navy, #0369A1)' : '#fff',
                        color: pvSource === v ? '#fff' : v === 'manual' && type !== 'quarterly' ? '#94A3B8' : 'var(--text)',
                      }}
                    >
                      {label}
                    </button>
                  ))}
                </div>
              </div>
            ) : null}
            {isPV ? (
              <div>
                <label className="form-label">FINANCIAL YEAR</label>
                <select value={fyVal} onChange={(e) => setFyVal(e.target.value)} style={sel}>
                  {fyList.map((p) => (
                    <option key={p.fy} value={String(p.fy)}>
                      {p.fyLabel} — Apr {p.fy} to Mar {p.fy + 1}
                    </option>
                  ))}
                </select>
              </div>
            ) : null}
            <div>
              <button onClick={() => setGenerated((g) => g + 1)} className="btn btn-primary" style={{ width: '100%', fontSize: 13, padding: '9px 0' }}>
                Generate Report
              </button>
            </div>
          </div>

          {/* All four quarters of the chosen year, always visible, so the PV
              cycle reads at a glance and switching between them is one click.
              Jan–Mar carries the NEXT calendar year — that is the financial
              year, not a typo, so each card prints its own year. */}
          {type === 'quarterly' ? (
            <div style={{ marginTop: 16 }}>
              <label className="form-label" style={{ display: 'block', marginBottom: 8 }}>SELECT 3-MONTH PERIOD</label>
              <div style={{ display: 'grid', gap: 10, gridTemplateColumns: 'repeat(auto-fit, minmax(160px, 1fr))' }}>
                {QUARTER_LABELS.map((label, qi) => {
                  const p = quarterByIndex(Number(fyVal), qi);
                  const on = qi === quarterIdx;
                  const covered = crsVal && p.months.every((m) => !!monthlyStore[`${crsVal}_${m.month}_${m.year}`]);
                  return (
                    <button
                      key={qi}
                      type="button"
                      onClick={() => { setQuarterIdx(qi); setManualRows(null); }}
                      style={{
                        textAlign: 'left', cursor: 'pointer', borderRadius: 10, padding: '12px 14px',
                        border: `2px solid ${on ? 'var(--navy, #0369A1)' : 'var(--border)'}`,
                        background: on ? '#EFF6FF' : '#fff',
                        boxShadow: on ? '0 2px 10px rgba(3,105,161,.15)' : 'none',
                      }}
                    >
                      <div style={{ fontWeight: 800, fontSize: 13, color: on ? '#0369A1' : 'var(--text)', whiteSpace: 'nowrap' }}>
                        {label.toUpperCase()}
                      </div>
                      <div style={{ fontSize: 11, color: 'var(--muted)', marginTop: 3 }}>
                        3-Month PV · {p.months[0].year === p.months[2].year ? p.months[0].year : `${p.months[0].year}–${p.months[2].year}`}
                      </div>
                      <div style={{ fontSize: 10, marginTop: 5, fontWeight: 700, color: covered ? '#15803D' : 'var(--muted)' }}>
                        {covered ? '● All 3 months in system' : crsVal ? '○ Needs upload or entry' : '○ Select a shop'}
                      </div>
                    </button>
                  );
                })}
              </div>
            </div>
          ) : null}

          {isPV ? (
            <div style={{ display: 'flex', marginTop: 12, gap: 10, alignItems: 'center' }}>
              <button
                onClick={() => {
                  if (!pvHtml) {
                    void appAlert('Generate a PV Statement first.');
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

      {isPV && pvSource === 'manual' && type === 'quarterly' && pvPeriod && crsVal ? (
        <ManualPvUpload
          period={pvPeriod}
          crsId={Number(crsVal)}
          crsName={shops[Number(crsVal) - 1]?.name ?? ''}
          onGenerate={(months) => { setManualRows(consolidateMonths(months)); setGenerated((g) => g + 1); }}
        />
      ) : null}
      {isPV && pvSource === 'manual' && !crsVal ? (
        <div className="card mb-4">
          <div className="card-body" style={{ textAlign: 'center', color: 'var(--muted)', fontSize: 13 }}>
            Select a CRS shop to upload its monthly statements.
          </div>
        </div>
      ) : null}

      {/* Four cards, so the row divides evenly at every breakpoint — g3 left a
          lone third card stranded below two once the grid halved. */}
      {!isPV ? (
        <div className="grid g4 mb-4">
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
            <div className="kpi-icon" style={{ background: '#E0E7FF' }}>🏦</div>
            <div>
              <div className="kpi-val" style={{ color: '#4338CA' }}>{fmtAmt(summary.totalRemit)}</div>
              <div className="kpi-label">Remittance Deposited</div>
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

      {/* The month as a machine-readable sheet. Without this there is nothing
          for the manual PV to consume: the Statements "Excel" button writes
          the statement's HTML with a .xls extension, which Excel opens but
          which carries no reliable figures to read back. */}
      {type === 'monthly' && crsVal ? (
        <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 16, flexWrap: 'wrap' }}>
          <button
            type="button"
            disabled={exporting || !exportRows.length}
            onClick={() => void exportMonthlyData()}
            style={{
              background: exporting || !exportRows.length ? '#94A3B8' : '#16A34A', color: '#fff', border: 'none',
              padding: '9px 18px', borderRadius: 8, fontSize: 13, fontWeight: 700,
              cursor: exporting || !exportRows.length ? 'not-allowed' : 'pointer',
            }}
          >
            {exporting ? 'Building…' : '📊 PV Data (Excel)'}
          </button>
          <span style={{ fontSize: 11, color: 'var(--muted)' }}>
            {exportRows.length
              ? `${exportRows.length} commodities. Download this month for a Manual 3-Month PV — it carries the CRS number, month and year, so it cannot be uploaded into the wrong slot.`
              : 'Nothing to export — this month has no published figures.'}
          </span>
        </div>
      ) : null}

      <div className="card">
        <div className="card-header" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <div className="card-title">
            {isPV && pvPeriod ? (
              <>
                {pvPeriod.kind === 'quarter' ? '3-Month PV' : 'Annual PV'} — {pvPeriod.label}
                {crsVal ? (
                  <div style={{ fontSize: 11, fontWeight: 500, color: 'var(--muted)', marginTop: 3 }}>
                    CRS {crsVal} — {shops[Number(crsVal) - 1]?.name ?? ''} · FY {pvPeriod.fyLabel} · generated{' '}
                    {new Date().toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' })}
                  </div>
                ) : null}
              </>
            ) : (
              `Sales by Commodity — ${moLabel} · ${crsLabel}`
            )}
          </div>
        </div>
        <div style={{ overflowX: 'auto' }}>
          {isPV ? (
            crsVal ? (
              <>
                {/* A PV built from an incomplete period is the failure mode
                    that matters: the figures look finished. Say which months
                    the shop has not published rather than quietly totalling
                    the ones it has. */}
                {pvCoverage.missing.length ? (
                  <div style={{ margin: '0 0 12px', background: '#FFFBEB', border: '1px solid #FDE68A', borderRadius: 8, padding: '10px 14px', color: '#92400E', fontSize: 12 }}>
                    <strong>
                      {pvCoverage.have.length} of {(pvPeriod?.months.length ?? 0)} months published.
                    </strong>{' '}
                    No monthly record yet for{' '}
                    {pvCoverage.missing.map((m) => `${MNAMES[m.month]} ${m.year}`).join(', ')} — this PV covers only what has been keyed.
                  </div>
                ) : (
                  <div style={{ margin: '0 0 12px', background: '#F0FDF4', border: '1px solid #86EFAC', borderRadius: 8, padding: '10px 14px', color: '#15803D', fontSize: 12 }}>
                    <strong>All {pvPeriod?.months.length} months published.</strong> This PV is complete for {pvPeriod?.label}.
                  </div>
                )}
                <div dangerouslySetInnerHTML={{ __html: pvHtml }} />
              </>
            ) : (
              <div style={{ textAlign: 'center', padding: 24, color: 'var(--muted)' }}>Please select a specific CRS shop to generate a PV Statement.</div>
            )
          ) : rows.length === 0 ? (
            // Distinguish "nothing keyed" from "days keyed, but no commodity
            // sold". Both used to read as the same blank month, which is what
            // made a remittance-only month look like a broken report.
            <div style={{ textAlign: 'center', padding: 32, color: 'var(--muted)', fontSize: 13, lineHeight: 1.7 }}>
              {summary.days === 0 ? (
                <>No day sheets were keyed for {moLabel} · {crsLabel}.</>
              ) : (
                <>
                  <strong style={{ color: 'var(--text)' }}>
                    {summary.days} day {summary.days === 1 ? 'sheet' : 'sheets'} keyed for {moLabel}, but no commodity was sold.
                  </strong>
                  <br />
                  {summary.totalRemit > 0 ? (
                    <>Remittance of {fmtAmt(summary.totalRemit)} is recorded against {summary.days === 1 ? 'it' : 'them'} — see the Remittance card above, and Monthly Entry for the day-by-day deposits.</>
                  ) : (
                    <>Nothing to report until sales figures are keyed on the Daily Entry page.</>
                  )}
                </>
              )}
            </div>
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
