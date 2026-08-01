'use client';

/**
 * Monthly Sales Entry — React port of the legacy screen and its layers:
 *   05-monthly-entry.js   sections A/B grid, daily-derived locking, save,
 *                         statement preview
 *   40-cs-column.js       conditional C.S (cumulative shortage) Bags+Kgs
 *   15-monthly-extras.js  remittance / gunny / card tables (own components)
 *   22-allotment.js       card carry-forward + allotment panel
 *   27-crs29-entry.js     the camp's list, no police section, no kero gunny
 *
 * Grid arithmetic: Total = Opening + Receipt + Excess − Shortage − Transfer;
 * Closing = Total − Sales − C.S. Commodities accumulated from Daily Entry
 * are read-only here (edit the day sheets); the rest save into meManualStore
 * and the month republishes through the shared rollup. Bag counts prefer the
 * record's own figures (imported workbooks) over the kgs-derived ones.
 */
import { useEffect, useMemo, useState } from 'react';
import { useAuth } from '@/lib/authClient';
import { crsData, useStore } from '@/lib/dataStore';
import { bagsOf, entryListsFor, isCrs29, type Commodity, type DayEntry } from '@/lib/engine/commodities';
import { rebuildMonthlyFromDaily, type MonthlyBlock, type MonthlyRec, type SourceBlock } from '@/lib/engine/monthlyRollup';
import CardAllot from './CardAllot';
import GunnyTable from './GunnyTable';
import RemitTable from './RemitTable';
import { ME_GUNNY_TO_COMM, ME_MONTH_NAMES, NO_GUNNY, type CardRec, type GunnyRec, type RemitMonth, type SalesClose } from './lib';

type ShopRec = { name: string };
type InspDay = { a?: Record<string, { excess?: number; shortage?: number; transfer?: number }>; b?: Record<string, { excess?: number; shortage?: number; transfer?: number }> };

const pad2 = (n: number) => String(n).padStart(2, '0');
const inr = (n: number) => '₹' + n.toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

type GridEdit = { open?: string; receipt?: string; sales?: string; close?: string; g?: Partial<Record<'open' | 'receipt' | 'total' | 'sales' | 'close', string>> };

export default function MonthlyEntryPage() {
  const { user } = useAuth();
  const now = new Date();
  const shops = useStore<ShopRec[]>('__shops') ?? [];
  const entryStore = useStore<Record<string, DayEntry>>('entryStore') ?? {};
  const inspectionStore = useStore<Record<string, InspDay>>('inspectionStore') ?? {};
  const meManualStore = useStore<Record<string, Partial<MonthlyBlock>>>('meManualStore') ?? {};
  const meGunnyStore = useStore<Record<string, Record<string, GunnyRec>>>('meGunnyStore') ?? {};
  const meRemitStore = useStore<Record<string, RemitMonth>>('meRemitStore') ?? {};
  const meCardStore = useStore<Record<string, Record<string, CardRec>>>('meCardStore') ?? {};
  const meAllotStore = useStore<Record<string, Record<string, number>>>('meAllotStore') ?? {};
  const meAdvanceStore = useStore<Record<string, Record<string, number>>>('meAdvanceStore') ?? {};
  const meCardConfirmed = useStore<Record<string, boolean>>('meCardConfirmed') ?? {};
  const salesCloseStore = useStore<Record<string, SalesClose>>('salesCloseStore') ?? {};

  const isCrsUser = !!user?.crsId && user.role !== 'ADMIN';
  const shopIds = isCrsUser ? [user!.crsId as number] : shops.map((_, i) => i + 1);

  const [crsVal, setCrsVal] = useState(isCrsUser ? String(user!.crsId) : '');
  const [month, setMonth] = useState(now.getMonth() + 1);
  const [year, setYear] = useState(now.getFullYear());
  const [edits, setEdits] = useState<Record<string, GridEdit>>({});
  const [saved, setSaved] = useState(false);
  const [stmtOpen, setStmtOpen] = useState(false);

  const crsId = crsVal ? Number(crsVal) : null;
  const key = crsVal ? `${crsVal}_${month}_${year}` : '';
  const ctx = crsId ? { crsId, month, year, key } : null;
  const lists = entryListsFor(crsId);

  useEffect(() => {
    setEdits({});
    setSaved(false);
    setStmtOpen(false);
  }, [key]);

  // Merge the daily roll-up with the saved manual values (rule: daily wins).
  const { merged, source } = useMemo(() => {
    if (!crsId) return { merged: { a: {}, b: {} } as MonthlyBlock, source: { a: {}, b: {} } as SourceBlock };
    return rebuildMonthlyFromDaily(crsId, month, year, entryStore, inspectionStore, meManualStore[key]);
  }, [crsId, month, year, entryStore, inspectionStore, meManualStore, key]);

  // Inspection adjustments summed over the month, per section+commodity.
  const inspMonth = useMemo(() => {
    const out: Record<string, { excess: number; shortage: number; transfer: number }> = {};
    if (!crsId) return out;
    const days = new Date(year, month, 0).getDate();
    for (let d = 1; d <= days; d++) {
      const rec = inspectionStore[`${crsId}_${year}-${pad2(month)}-${pad2(d)}`];
      if (!rec) continue;
      for (const sec of ['a', 'b'] as const) {
        for (const [id, r] of Object.entries(rec[sec] ?? {})) {
          const t = (out[`${sec}:${id}`] ??= { excess: 0, shortage: 0, transfer: 0 });
          t.excess += Number(r.excess) || 0;
          t.shortage += Number(r.shortage) || 0;
          t.transfer += Number(r.transfer) || 0;
        }
      }
    }
    return out;
  }, [crsId, month, year, inspectionStore]);

  type Row = {
    c: Commodity;
    sec: 'a' | 'b';
    derived: boolean;
    open: number;
    receipt: number;
    sales: number;
    total: number;
    close: number;
    amount: number;
    adj: { excess: number; shortage: number; transfer: number };
    cs: number;
    gCs: number;
    g: Record<'open' | 'receipt' | 'total' | 'sales' | 'close', number>;
  };

  const rowFor = (sec: 'a' | 'b', c: Commodity): Row => {
    const rec = merged[sec][c.id] as MonthlyRec | undefined;
    const derived = source[sec][c.id] === 'daily';
    const e = edits[`${sec}:${c.id}`] ?? {};
    const num = (edit: string | undefined, stored: number | undefined) => (edit !== undefined ? Number(edit) || 0 : Number(stored) || 0);
    const open = derived ? Number(rec?.open) || 0 : num(e.open, rec?.open);
    const receipt = derived ? Number(rec?.receipt) || 0 : num(e.receipt, rec?.receipt);
    const sales = derived ? Number(rec?.sales) || 0 : num(e.sales, rec?.sales);
    let adj = inspMonth[`${sec}:${c.id}`] ?? { excess: 0, shortage: 0, transfer: 0 };
    if (!adj.excess && !adj.shortage && !adj.transfer && rec) {
      adj = { excess: Number(rec.excess) || 0, shortage: Number(rec.shortage) || 0, transfer: Number(rec.transfer) || 0 };
    }
    const cs = Number(rec?.cs) || 0;
    const gCs = Number(rec?.g_cs) || 0;
    const total = open + receipt + adj.excess - adj.shortage - adj.transfer;
    const close = total - sales - cs;
    const amount = c.free ? 0 : sales * c.rate;

    const kgs = { open, receipt, total, sales, close };
    const g = {} as Row['g'];
    for (const f of ['open', 'receipt', 'total', 'sales', 'close'] as const) {
      const edited = e.g?.[f];
      if (edited !== undefined) {
        g[f] = Number(edited) || 0;
        continue;
      }
      const auto = bagsOf(kgs[f], c.id);
      const storedG = Number(rec?.[`g_${f}` as keyof MonthlyRec]) || 0;
      // A stored bag count that differs from the kgs-derived one is the
      // office's own figure (imported workbook) — it wins (40-cs-column.js
      // era fix in 05-monthly-entry.js).
      g[f] = !derived && storedG > 0 && storedG !== auto ? storedG : auto;
    }
    return { c, sec, derived, open, receipt, sales, total, close, amount, adj, cs, gCs, g };
  };

  const rows = useMemo(() => {
    const a = lists.a.map((c) => rowFor('a', c));
    const b = lists.b.map((c) => rowFor('b', c));
    return { a, b };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [lists, merged, source, inspMonth, edits]);

  const showAdj = {
    excess: [...rows.a, ...rows.b].some((r) => r.adj.excess !== 0),
    shortage: [...rows.a, ...rows.b].some((r) => r.adj.shortage !== 0),
    transfer: [...rows.a, ...rows.b].some((r) => r.adj.transfer !== 0),
    cs: [...rows.a, ...rows.b].some((r) => r.cs !== 0 || r.gCs !== 0),
  };

  const sums = (list: Row[]) => {
    const s = { open: 0, rec: 0, ex: 0, sh: 0, tr: 0, cs: 0, gcs: 0, total: 0, sales: 0, close: 0, amt: 0, gopen: 0, grec: 0, gtotal: 0, gsales: 0, gclose: 0 };
    for (const r of list) {
      s.open += r.open;
      s.rec += r.receipt;
      s.ex += r.adj.excess;
      s.sh += r.adj.shortage;
      s.tr += r.adj.transfer;
      s.cs += r.cs;
      s.gcs += r.gCs;
      s.total += r.total;
      s.sales += r.sales;
      s.close += r.close;
      s.amt += r.amount;
      s.gopen += r.g.open;
      s.grec += r.g.receipt;
      s.gtotal += r.g.total;
      s.gsales += r.g.sales;
      s.gclose += r.g.close;
    }
    return s;
  };
  const sumA = sums(rows.a);
  const sumB = sums(rows.b);
  const grand = sumA.amt + sumB.amt;

  const gridGunnySales = useMemo(() => {
    const out: Record<string, number> = {};
    for (const r of [...rows.a, ...rows.b]) out[r.c.id] = r.g.sales;
    return out;
  }, [rows]);

  const setEdit = (sec: 'a' | 'b', id: string, patch: Partial<GridEdit>) =>
    setEdits((prev) => ({ ...prev, [`${sec}:${id}`]: { ...prev[`${sec}:${id}`], ...patch } }));
  const setGunnyEdit = (sec: 'a' | 'b', id: string, f: string, val: string) =>
    setEdits((prev) => ({ ...prev, [`${sec}:${id}`]: { ...prev[`${sec}:${id}`], g: { ...prev[`${sec}:${id}`]?.g, [f]: val } } }));

  /** Gunny Issues → the Empty Bag / Empty Box sales rows (rule in 15-monthly-extras). */
  const issuesToMonthly = (itemId: string, issues: string) => {
    const commId = ME_GUNNY_TO_COMM[itemId];
    if (!commId || isCrs29(crsId)) return;
    setEdit('a', commId, { sales: issues === '' ? '' : String(Number(issues) || 0) });
  };

  const save = () => {
    if (!ctx) return;
    const manual: Partial<MonthlyBlock> = { a: {}, b: {} };
    for (const [sec, list] of [['a', rows.a], ['b', rows.b]] as const) {
      for (const r of list) {
        if (r.derived) continue;
        const rec: MonthlyRec = {
          open: r.open, receipt: r.receipt, total: r.total, sales: r.sales, close: r.close, amount: r.amount,
          excess: r.adj.excess, shortage: r.adj.shortage, transfer: r.adj.transfer,
          cs: r.cs, g_cs: r.gCs,
          g_open: r.g.open, g_receipt: r.g.receipt, g_total: r.g.total, g_sales: r.g.sales, g_close: r.g.close,
        };
        const empty = !rec.open && !rec.receipt && !rec.sales && !rec.close && !rec.amount && !rec.cs;
        if (!empty) manual[sec]![r.c.id] = rec;
      }
    }
    crsData.update<Record<string, Partial<MonthlyBlock>>>('meManualStore', (d) => {
      d[ctx.key] = manual;
    });
    const next = rebuildMonthlyFromDaily(ctx.crsId, ctx.month, ctx.year, entryStore, inspectionStore, manual);
    crsData.update<Record<string, MonthlyBlock>>('monthlyStore', (d) => {
      d[ctx.key] = next.merged;
    });
    crsData.update<Record<string, SourceBlock>>('meSourceStore', (d) => {
      d[ctx.key] = next.source;
    });
    void crsData.save();
    setSaved(true);
    setTimeout(() => setSaved(false), 4000);
  };

  const subtitle = ctx ? `CRS ${ctx.crsId} — ${shops[ctx.crsId - 1]?.name ?? ''} — ${ME_MONTH_NAMES[month]} ${year}` : '';

  const th = (label: React.ReactNode, extra?: React.CSSProperties) => (
    <th style={{ padding: '8px 6px', textAlign: 'center', fontSize: 9, fontWeight: 700, color: 'var(--muted)', borderBottom: '1px solid var(--border)', ...extra }}>{label}</th>
  );

  const gridSection = (sec: 'a' | 'b', list: Row[]) => {
    if (!list.length) return null;
    const secA = sec === 'a';
    const col = secA ? '#0369A1' : '#C2410C';
    const bdr = secA ? '1px solid #EFF6FF' : '1px solid #FFF7ED';
    const footBd = secA ? '2px solid #BAE6FD' : '2px solid #FED7AA';
    const s = sec === 'a' ? sumA : sumB;
    const kgsInput = (r: Row, field: 'open' | 'receipt' | 'sales', style?: React.CSSProperties) => {
      const locked = r.derived;
      const e = edits[`${sec}:${r.c.id}`] ?? {};
      const stored = merged[sec][r.c.id]?.[field];
      const val = locked
        ? (Number(stored) || 0) ? Number(stored).toFixed(3) : ''
        : e[field] !== undefined
          ? e[field]
          : stored !== undefined && Number(stored) !== 0
            ? Number(stored).toFixed(3)
            : '';
      return (
        <input
          type="number"
          min={0}
          step={0.001}
          readOnly={locked}
          placeholder="0.000"
          value={val}
          title={locked ? 'Accumulated from Daily Entry — edit the day sheet to change this' : undefined}
          onChange={(e2) => setEdit(sec, r.c.id, { [field]: e2.target.value } as Partial<GridEdit>)}
          style={{ width: '100%', border: '1px solid #E2E8F0', borderRadius: 5, padding: '4px 5px', fontSize: 11, textAlign: 'right', ...(locked ? { background: '#F0F9FF', color: '#0369A1', fontWeight: 700 } : {}), ...style }}
        />
      );
    };
    const roKgs = (val: number, style?: React.CSSProperties) => (
      <input readOnly value={val ? val.toFixed(3) : ''} placeholder="0.000" style={{ width: '100%', border: '1px solid #E2E8F0', borderRadius: 5, padding: '4px 5px', fontSize: 11, textAlign: 'right', background: '#F8FAFC', color: 'var(--muted)', ...style }} />
    );
    const gunnyCell = (r: Row, f: 'open' | 'receipt' | 'total' | 'sales' | 'close', isTot = false) => {
      if (NO_GUNNY.has(r.c.id)) {
        return <td key={f + 'g'} style={{ padding: '3px 4px', textAlign: 'center', fontSize: 10, color: '#D1D5DB', borderBottom: bdr, borderRight: '1px solid #E2E8F0', background: '#FAFAFA' }}>—</td>;
      }
      const v = r.g[f];
      return (
        <td key={f + 'g'} style={{ padding: '2px 3px', borderBottom: bdr, borderRight: '1px solid #E2E8F0', background: isTot ? '#DBEAFE' : '#FFFBEB' }}>
          <input
            type="number"
            min={0}
            step={1}
            value={v || ''}
            placeholder=""
            onChange={(e2) => setGunnyEdit(sec, r.c.id, f, e2.target.value)}
            style={{ width: 42, border: `1px solid ${isTot ? '#BAE6FD' : '#FDE047'}`, borderRadius: 4, padding: '3px 4px', fontSize: 11, fontWeight: 800, textAlign: 'center', color: isTot ? '#0369A1' : '#92400E', background: '#fff' }}
          />
        </td>
      );
    };
    const adjBadge = (val: number, kind: 'excess' | 'shortage' | 'transfer') => {
      const theme = { excess: { bg: '#DCFCE7', fg: '#166534', bd: '#86EFAC', sign: '+' }, shortage: { bg: '#FEE2E2', fg: '#B91C1C', bd: '#FCA5A5', sign: '−' }, transfer: { bg: '#FEF3C7', fg: '#92400E', bd: '#FDE047', sign: '→' } }[kind];
      return val ? (
        <span style={{ display: 'inline-block', background: theme.bg, border: `1px solid ${theme.bd}`, color: theme.fg, fontSize: 11, fontWeight: 800, padding: '3px 7px', borderRadius: 5, minWidth: 38 }}>{theme.sign}{+val.toFixed(3)}</span>
      ) : (
        <span style={{ color: '#CBD5E1', fontSize: 11 }}>—</span>
      );
    };

    return (
      <div className="card" style={{ borderRadius: 0, borderTop: 'none', borderBottom: 'none', marginTop: secA ? undefined : 2 }}>
        <div style={{ background: secA ? '#F0F9FF' : '#FFF7ED', padding: '9px 16px', borderBottom: `1px solid ${secA ? '#BAE6FD' : '#FED7AA'}`, display: 'flex', alignItems: 'center', gap: 8 }}>
          <span style={{ background: col, color: '#fff', fontSize: 10, fontWeight: 800, padding: '2px 8px', borderRadius: 4 }}>SECTION {sec.toUpperCase()}</span>
          <span style={{ fontWeight: 700, fontSize: 12, color: col }}>{secA ? 'நியாய வகுப்பு / Main Ration — Monthly' : 'காவலர் அட்டை / Police Ration — Monthly'}</span>
        </div>
        <div style={{ overflowX: 'auto' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse', minWidth: 780 }}>
            <thead>
              <tr style={{ background: secA ? '#F8FAFC' : '#FFFBF5' }}>
                {th('#', { width: 30 })}
                {th('பொருட்கள் / Commodity', { textAlign: 'left', minWidth: 130, padding: '8px 10px' })}
                {th('Unit', { width: 38 })}
                {th('Opening', { colSpan: 2 } as never)}
                {th('Receipt', { colSpan: 2 } as never)}
                {showAdj.excess ? th('Excess', { color: '#166534', background: '#F0FDF4', width: 52 }) : null}
                {showAdj.shortage ? th(<>Short<br />age</>, { color: '#B91C1C', background: '#FEF2F2', width: 52 }) : null}
                {showAdj.transfer ? th(<>Trans<br />fer</>, { color: '#92400E', background: '#FFFBEB', width: 52 }) : null}
                {th('Total', { colSpan: 2, color: '#0284C7', background: '#EFF6FF' } as never)}
                {th('Sales', { colSpan: 2 } as never)}
                {showAdj.cs ? th('C.S / Cum.Short', { colSpan: 2, color: '#7C3AED', background: '#F3E8FF' } as never) : null}
                {th('Closing', { colSpan: 2 } as never)}
                {th('Rate (₹)', { width: 52, background: '#FFFBEB', color: '#D97706' })}
                {th('Amount (₹)', { minWidth: 80, background: secA ? '#EFF6FF' : '#FFF3E8', color: col })}
              </tr>
            </thead>
            <tbody>
              {list.map((r, i) => (
                <tr key={r.c.id} style={{ background: i % 2 === 0 ? '#fff' : '#FAFCFF' }}>
                  <td style={{ padding: '7px 6px', textAlign: 'center', fontSize: 11, color: 'var(--muted)', borderBottom: bdr }}>{i + 1}</td>
                  <td style={{ padding: '7px 10px', borderBottom: bdr }}>
                    <div style={{ fontWeight: 600, fontSize: 12 }}>{r.c.ta}</div>
                    <div style={{ fontSize: 10, color: 'var(--muted)' }}>{r.c.en}</div>
                    {r.derived ? (
                      <div style={{ display: 'inline-block', marginTop: 3, background: '#DBEAFE', color: '#1D4ED8', border: '1px solid #BFDBFE', fontSize: 9, fontWeight: 700, padding: '1px 6px', borderRadius: 4 }}>↑ from Daily</div>
                    ) : null}
                  </td>
                  <td style={{ padding: '7px 5px', textAlign: 'center', fontSize: 11, color: 'var(--muted)', borderBottom: bdr }}>{r.c.unit}</td>
                  {gunnyCell(r, 'open')}
                  <td style={{ padding: '3px 4px', borderBottom: bdr }}>{kgsInput(r, 'open')}</td>
                  {gunnyCell(r, 'receipt')}
                  <td style={{ padding: '3px 4px', borderBottom: bdr }}>{kgsInput(r, 'receipt', { fontWeight: 600 })}</td>
                  {showAdj.excess ? <td style={{ padding: '4px 3px', textAlign: 'center', borderBottom: bdr }}>{adjBadge(r.adj.excess, 'excess')}</td> : null}
                  {showAdj.shortage ? <td style={{ padding: '4px 3px', textAlign: 'center', borderBottom: bdr }}>{adjBadge(r.adj.shortage, 'shortage')}</td> : null}
                  {showAdj.transfer ? <td style={{ padding: '4px 3px', textAlign: 'center', borderBottom: bdr }}>{adjBadge(r.adj.transfer, 'transfer')}</td> : null}
                  {gunnyCell(r, 'total', true)}
                  <td style={{ padding: '3px 4px', borderBottom: bdr, background: '#EFF6FF' }}>{roKgs(r.total, { background: '#EFF6FF', color: '#0284C7', fontWeight: 700 })}</td>
                  {gunnyCell(r, 'sales')}
                  <td style={{ padding: '3px 4px', borderBottom: bdr }}>{kgsInput(r, 'sales', { fontWeight: 700 })}</td>
                  {showAdj.cs ? (
                    <>
                      <td style={{ padding: '4px 3px', textAlign: 'center', borderBottom: bdr, background: '#F3E8FF' }}>
                        {r.gCs ? <span style={{ color: '#7C3AED', fontWeight: 800, fontSize: 11 }}>{r.gCs}</span> : <span style={{ color: '#CBD5E1', fontSize: 11 }}>—</span>}
                      </td>
                      <td style={{ padding: '4px 3px', textAlign: 'center', borderBottom: bdr }}>
                        {r.cs ? (
                          <span style={{ display: 'inline-block', background: '#F3E8FF', border: '1px solid #D8B4FE', color: '#7C3AED', fontSize: 11, fontWeight: 800, padding: '3px 7px', borderRadius: 5, minWidth: 38 }}>−{+r.cs.toFixed(3)}</span>
                        ) : (
                          <span style={{ color: '#CBD5E1', fontSize: 11 }}>—</span>
                        )}
                      </td>
                    </>
                  ) : null}
                  {gunnyCell(r, 'close')}
                  <td style={{ padding: '3px 4px', borderBottom: bdr }}>{roKgs(r.close, r.close < 0 ? { color: '#DC2626', background: '#FEF2F2', fontWeight: 800 } : undefined)}</td>
                  <td style={{ padding: '5px 4px', textAlign: 'center', borderBottom: bdr, background: '#FFFBEB' }}>
                    {r.c.free ? <span style={{ color: '#16A34A', fontWeight: 600, fontSize: 10 }}>Free</span> : <span style={{ fontWeight: 700, fontSize: 11, color: '#D97706' }}>₹{r.c.rate.toFixed(2)}</span>}
                  </td>
                  <td style={{ padding: '3px 4px', borderBottom: bdr }}>
                    {r.c.free ? (
                      <div style={{ textAlign: 'center', padding: 5, fontSize: 11, color: '#16A34A', fontStyle: 'italic' }}>விலையில்லா</div>
                    ) : (
                      <input readOnly value={r.amount ? r.amount.toFixed(2) : ''} placeholder="0.00" style={{ width: '100%', border: '1px solid #E2E8F0', borderRadius: 5, padding: '4px 5px', fontSize: 11, textAlign: 'right', background: secA ? '#EFF6FF' : '#FFF3E8', color: col, fontWeight: 700 }} />
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
            <tfoot>
              <tr style={{ background: secA ? '#EFF6FF' : '#FFF7ED', fontWeight: 800 }}>
                <td colSpan={3} style={{ padding: '10px 12px', fontSize: 12, color: col, borderTop: footBd }}>Section {sec.toUpperCase()} Total</td>
                <td style={{ padding: '9px 3px', textAlign: 'center', fontSize: 10, fontWeight: 800, color: '#92400E', background: '#FFFBEB', borderTop: footBd }}>{Math.round(s.gopen)}</td>
                <td style={{ padding: '9px 4px', textAlign: 'right', fontSize: 11, color: col, borderTop: footBd }}>{s.open.toFixed(3)}</td>
                <td style={{ padding: '9px 3px', textAlign: 'center', fontSize: 10, fontWeight: 800, color: '#92400E', background: '#FFFBEB', borderTop: footBd }}>{Math.round(s.grec)}</td>
                <td style={{ padding: '9px 4px', textAlign: 'right', fontSize: 11, color: col, borderTop: footBd }}>{s.rec.toFixed(3)}</td>
                {showAdj.excess ? <td style={{ padding: '9px 4px', textAlign: 'right', fontSize: 11, color: '#166534', background: '#F0FDF4', borderTop: footBd }}>{s.ex.toFixed(3)}</td> : null}
                {showAdj.shortage ? <td style={{ padding: '9px 4px', textAlign: 'right', fontSize: 11, color: '#B91C1C', background: '#FEF2F2', borderTop: footBd }}>{s.sh.toFixed(3)}</td> : null}
                {showAdj.transfer ? <td style={{ padding: '9px 4px', textAlign: 'right', fontSize: 11, color: '#92400E', background: '#FFFBEB', borderTop: footBd }}>{s.tr.toFixed(3)}</td> : null}
                <td style={{ padding: '9px 3px', textAlign: 'center', fontSize: 10, fontWeight: 800, color: '#0369A1', background: '#DBEAFE', borderTop: footBd }}>{Math.round(s.gtotal)}</td>
                <td style={{ padding: '9px 4px', textAlign: 'right', fontSize: 11, color: '#0284C7', background: '#EFF6FF', borderTop: footBd }}>{s.total.toFixed(3)}</td>
                <td style={{ padding: '9px 3px', textAlign: 'center', fontSize: 10, fontWeight: 800, color: '#92400E', background: '#FFFBEB', borderTop: footBd }}>{Math.round(s.gsales)}</td>
                <td style={{ padding: '9px 4px', textAlign: 'right', fontSize: 11, color: col, borderTop: footBd }}>{s.sales.toFixed(3)}</td>
                {showAdj.cs ? (
                  <>
                    <td style={{ padding: '9px 3px', textAlign: 'center', fontSize: 10, fontWeight: 800, color: '#7C3AED', background: '#F3E8FF', borderTop: footBd }}>{Math.round(s.gcs)}</td>
                    <td style={{ padding: '9px 4px', textAlign: 'right', fontSize: 11, color: '#7C3AED', background: '#FAF5FF', borderTop: footBd }}>{s.cs.toFixed(3)}</td>
                  </>
                ) : null}
                <td style={{ padding: '9px 3px', textAlign: 'center', fontSize: 10, fontWeight: 800, color: '#92400E', background: '#FFFBEB', borderTop: footBd }}>{Math.round(s.gclose)}</td>
                <td style={{ padding: '9px 4px', textAlign: 'right', fontSize: 11, color: col, borderTop: footBd }}>{s.close.toFixed(3)}</td>
                <td style={{ borderTop: footBd, background: '#FFFBEB' }} />
                <td style={{ padding: '9px 4px', textAlign: 'right', fontSize: 11, color: col, borderTop: footBd }}>{inr(s.amt)}</td>
              </tr>
            </tfoot>
          </table>
        </div>
      </div>
    );
  };

  const stmtTable = (comms: Commodity[], data: Record<string, MonthlyRec>, title: string, color: string) => (
    <div style={{ marginBottom: 14 }} key={title}>
      <div style={{ background: color, color: '#fff', padding: '8px 14px', fontWeight: 800, fontSize: 12, borderRadius: '6px 6px 0 0' }}>{title}</div>
      <div style={{ overflowX: 'auto' }}>
        <table style={{ width: '100%', borderCollapse: 'collapse', minWidth: 680 }}>
          <thead>
            <tr style={{ background: '#F8FAFC' }}>
              {['#', 'Commodity', 'Unit', 'Opening', 'Receipt', 'Total', 'Sales', 'Closing', 'Amount (₹)'].map((h, i) => (
                <th key={h} style={{ padding: i === 1 ? '8px 12px' : 8, fontSize: 10, color: '#888', borderBottom: '1px solid #ddd', textAlign: i === 1 ? 'left' : 'center', ...(h === 'Total' ? { color: '#0284C7', background: '#EFF6FF' } : {}) }}>{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {comms.map((c, i) => {
              const sv = data[c.id] ?? ({} as MonthlyRec);
              const fq = (n: number | undefined) => (n ? Number(n).toFixed(3) : '—');
              return (
                <tr key={c.id} style={{ background: i % 2 ? '#FAFCFF' : '#fff' }}>
                  <td style={{ padding: '7px 8px', textAlign: 'center', fontSize: 11, color: '#888', borderBottom: '1px solid #F1F5F9' }}>{i + 1}</td>
                  <td style={{ padding: '7px 12px', borderBottom: '1px solid #F1F5F9' }}>
                    <div style={{ fontWeight: 600, fontSize: 12 }}>{c.ta}</div>
                    <div style={{ fontSize: 10, color: '#888' }}>{c.en}</div>
                  </td>
                  <td style={{ padding: '7px 8px', textAlign: 'center', fontSize: 11, borderBottom: '1px solid #F1F5F9' }}>{c.unit}</td>
                  <td style={{ padding: '7px 8px', textAlign: 'right', fontSize: 11, borderBottom: '1px solid #F1F5F9' }}>{fq(sv.open)}</td>
                  <td style={{ padding: '7px 8px', textAlign: 'right', fontWeight: 600, borderBottom: '1px solid #F1F5F9' }}>{fq(sv.receipt)}</td>
                  <td style={{ padding: '7px 8px', textAlign: 'right', fontWeight: 700, background: '#EFF6FF', color: '#0284C7', borderBottom: '1px solid #F1F5F9' }}>{fq(sv.total)}</td>
                  <td style={{ padding: '7px 8px', textAlign: 'right', fontWeight: 700, borderBottom: '1px solid #F1F5F9' }}>{fq(sv.sales)}</td>
                  <td style={{ padding: '7px 8px', textAlign: 'right', borderBottom: '1px solid #F1F5F9' }}>{fq(sv.close)}</td>
                  {c.free ? (
                    <td style={{ textAlign: 'center', color: '#16A34A', fontStyle: 'italic', fontSize: 11 }}>விலையில்லா</td>
                  ) : (
                    <td style={{ textAlign: 'right', fontWeight: 700, color }}>{sv.amount ? inr(Number(sv.amount)) : '—'}</td>
                  )}
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );

  return (
    <div className="page active" id="page-monthly">
      <div className="page-header">
        <div className="page-title">Monthly Sales Entry</div>
        <div className="page-sub">மாதாந்திர விற்பனை அறிக்கை — Enter full month receipt &amp; sales, then generate statement</div>
      </div>

      <div className="card mb-4">
        <div className="card-body">
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr auto', gap: 14, alignItems: 'end' }}>
            <div>
              <label className="form-label">CRS Shop</label>
              <select value={crsVal} onChange={(e) => setCrsVal(e.target.value)}>
                <option value="">Select CRS Shop...</option>
                {shopIds.map((id) => (
                  <option key={id} value={String(id)}>
                    CRS {id} — {shops[id - 1]?.name ?? ''}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label className="form-label">Month</label>
              <select value={String(month)} onChange={(e) => setMonth(Number(e.target.value))}>
                {ME_MONTH_NAMES.slice(1).map((m, i) => (
                  <option key={m} value={String(i + 1)}>
                    {m}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label className="form-label">Year</label>
              <select value={String(year)} onChange={(e) => setYear(Number(e.target.value))}>
                {[2025, 2026].map((y) => (
                  <option key={y} value={String(y)}>
                    {y}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <button
                onClick={() => setStmtOpen(true)}
                style={{ background: 'linear-gradient(135deg,#0284C7,#0EA5E9)', color: '#fff', border: 'none', padding: '10px 18px', borderRadius: 9, fontWeight: 700, fontSize: 13, cursor: 'pointer', whiteSpace: 'nowrap', boxShadow: '0 2px 10px rgba(14,165,233,.3)' }}
              >
                📄 Generate Statement
              </button>
            </div>
          </div>
        </div>
      </div>

      {!ctx ? (
        <div style={{ textAlign: 'center', padding: '64px 24px', color: 'var(--muted)' }}>
          <div style={{ fontSize: 52, marginBottom: 14 }}>📅</div>
          <div style={{ fontWeight: 700, fontSize: 16, color: 'var(--text)', marginBottom: 6 }}>Select a CRS shop and month</div>
          <div style={{ fontSize: 13 }}>The monthly commodity entry table will appear</div>
        </div>
      ) : (
        <div>
          {saved ? (
            <div style={{ background: '#DCFCE7', border: '1px solid #86EFAC', borderRadius: 10, padding: '12px 16px', marginBottom: 14, color: '#15803D', fontSize: 13, fontWeight: 600 }}>
              ✅ மாத விற்பனை நிறைவு — this month&apos;s entry, remittance, gunny stock and card details are saved.
            </div>
          ) : null}

          <div style={{ background: 'linear-gradient(135deg,#0369A1,#0EA5E9)', borderRadius: '12px 12px 0 0', padding: '14px 20px', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <div>
              <div style={{ color: '#fff', fontWeight: 800, fontSize: 15 }}>CRS {ctx.crsId} — {shops[ctx.crsId - 1]?.name ?? ''}</div>
              <div style={{ color: 'rgba(255,255,255,.65)', fontSize: 11, marginTop: 2 }}>{ME_MONTH_NAMES[month]} {year} — Monthly Sales Entry</div>
            </div>
            <div style={{ textAlign: 'right' }}>
              <div style={{ color: 'rgba(255,255,255,.6)', fontSize: 10, textTransform: 'uppercase', letterSpacing: '.08em' }}>Total Amount</div>
              <div style={{ color: '#fff', fontWeight: 900, fontSize: 22 }}>{inr(grand)}</div>
            </div>
          </div>

          {gridSection('a', rows.a)}
          {gridSection('b', rows.b)}

          <div className="card" style={{ borderRadius: '0 0 12px 12px', borderTop: 'none' }}>
            <div style={{ padding: '14px 20px', display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: 12 }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 20 }}>
                {[['Section A', sumA.amt, '#0369A1'], ['Section B', sumB.amt, '#C2410C'], ['Grand Total', grand, '#16A34A']].map(([label, val, col2], i) => (
                  <div key={label as string} style={{ display: 'flex', alignItems: 'center', gap: 20 }}>
                    {i > 0 ? <div style={{ width: 1, height: 32, background: 'var(--border)' }} /> : null}
                    <div style={{ textAlign: 'center' }}>
                      <div style={{ fontSize: 10, color: 'var(--muted)', textTransform: 'uppercase', letterSpacing: '.05em' }}>{label as string}</div>
                      <div style={{ fontWeight: i === 2 ? 900 : 800, fontSize: i === 2 ? 18 : 16, color: col2 as string }}>{inr(val as number)}</div>
                    </div>
                  </div>
                ))}
              </div>

              <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginTop: 14, width: '100%' }}>
                <button className="btn btn-outline btn-sm" onClick={() => setEdits({})}>🗑 Clear</button>
                <button
                  onClick={save}
                  title="மாத விற்பனை நிறைவு — store this month's entry, remittance, gunny stock and card details"
                  style={{ marginLeft: 'auto', background: 'linear-gradient(135deg,#0284C7,#0EA5E9)', color: '#fff', border: 'none', padding: '10px 22px', borderRadius: 9, fontWeight: 700, fontSize: 13, cursor: 'pointer', boxShadow: '0 2px 10px rgba(14,165,233,.3)' }}
                >
                  💾 மாத விற்பனை நிறைவு
                </button>
              </div>

              <RemitTable ctx={ctx} remit={meRemitStore} subtitle={subtitle} />
              <GunnyTable ctx={ctx} gunny={meGunnyStore} salesClose={salesCloseStore[ctx.key]} gridGunnySales={gridGunnySales} onIssuesToMonthly={issuesToMonthly} subtitle={subtitle} />
              <CardAllot ctx={ctx} cards={meCardStore} allot={meAllotStore} advance={meAdvanceStore} confirmed={meCardConfirmed} subtitle={subtitle} />
            </div>
          </div>

          {stmtOpen ? (
            <div style={{ marginTop: 20 }}>
              <div className="card">
                <div className="card-header" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                  <div>
                    <div className="card-title">Monthly Statement Preview</div>
                    <div style={{ fontSize: 11, color: 'var(--muted)', marginTop: 2 }}>CRS {ctx.crsId} — {shops[ctx.crsId - 1]?.name ?? ''} · {ME_MONTH_NAMES[month]} {year}</div>
                  </div>
                  <div style={{ display: 'flex', gap: 8 }}>
                    <button className="btn btn-outline btn-sm" onClick={() => window.print()}>🖨️ Print</button>
                    <button className="btn btn-outline btn-sm" onClick={() => setStmtOpen(false)}>✕ Close</button>
                  </div>
                </div>
                <div className="card-body">
                  <div style={{ textAlign: 'center', marginBottom: 14, padding: 14, background: 'linear-gradient(135deg,#0369A1,#0EA5E9)', borderRadius: 10 }}>
                    <div style={{ color: '#fff', fontSize: 15, fontWeight: 800 }}>Tamil Nadu Civil Supplies Corporation</div>
                    <div style={{ color: 'rgba(255,255,255,.8)', fontSize: 12, marginTop: 2 }}>Monthly Statement — Civil Ration Shop</div>
                    <div style={{ color: '#fff', fontWeight: 700, fontSize: 13, marginTop: 5 }}>CRS {ctx.crsId} — {shops[ctx.crsId - 1]?.name ?? ''} | {ME_MONTH_NAMES[month]} {year}</div>
                  </div>
                  {stmtTable(lists.a, merged.a, 'SECTION A — நியாய வகுப்பு / Main Ration', '#0369A1')}
                  {lists.b.length ? stmtTable(lists.b, merged.b, 'SECTION B — காவலர் அட்டை / Police Ration', '#C2410C') : null}
                </div>
              </div>
            </div>
          ) : null}
        </div>
      )}
    </div>
  );
}
