'use client';

/**
 * Daily Sales Entry — React port of the legacy screen and its layers:
 *   03-daily-entry.js   sections A/B, opening auto-carry, totals, save,
 *                       sales-close workflow, inspection adjustment columns
 *   21-remittance.js    mandatory, repeatable remittance rows
 *   27/28-crs29-*.js    the camp keys its own list and has no police section
 *
 * Arithmetic per row: Total = Opening + Receipt + Excess − Shortage −
 * Transfer (adjustments come read-only from the Inspection screen);
 * Closing = Total − Sales; Amount = Sales × rate for priced commodities.
 * Opening auto-carries from the previous day's closing (amber, read-only);
 * a day with no earlier sheet stays hand-editable.
 *
 * Saving writes the sheet to entryStore and republishes the month
 * (monthlyStore/meSourceStore) through the shared rollup, so Monthly Entry
 * and the statements see the day immediately — same as the engine.
 * The Inspection editor and DSS preview still live in the classic app; the
 * buttons open it until those sub-screens convert.
 */
import { useEffect, useMemo, useRef, useState } from 'react';
import { useAuth } from '@/lib/authClient';
import { crsData, useStore } from '@/lib/dataStore';
import { SHOPS } from '@/lib/engine/shops';
import { entryListsFor, isCrs29, type Commodity, type DayEntry } from '@/lib/engine/commodities';
import { isWeeklyHoliday, weeklyHolidayName } from '@/lib/engine/holidays';
import { rebuildMonthlyFromDaily, type MonthlyBlock, type SourceBlock } from '@/lib/engine/monthlyRollup';
import InspectionModal from './InspectionModal';

type ShopRec = { name: string };
type SavedSheet = DayEntry & {
  remits?: { amount: number; date: string }[];
  remitAmount?: number;
  remitDate?: string;
};
type InspDay = { a?: Record<string, { excess?: number; shortage?: number; transfer?: number }>; b?: Record<string, { excess?: number; shortage?: number; transfer?: number }> };
type SalesClose = { date: string; gunny: number; poly: number; cbox: number; updatedAt: string };

const pad2 = (n: number) => String(n).padStart(2, '0');
const todayIso = () => new Date().toISOString().split('T')[0];
const inr = (n: number) => '₹' + n.toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

// Pack-type divisors for the Sales Close aggregates (03-daily-entry.js).
const SC_PACK: Record<'GUNNY' | 'POLY' | 'CBOX', Record<string, number>> = {
  GUNNY: { BRA: 50, NPHH_FRK: 50, PHH_FRK: 50, AAY_FRK: 50, AAY: 50, OAP: 50, APS: 50, TOOR: 50, PHH_BRA: 50, WHEAT: 50, RRA: 50, NPHH_RRA: 50, PB_BRA: 50, PB_WHEAT: 50, PB_TOOR: 50 },
  POLY: { SUGAR: 50, AAY_SUGAR: 50, SALT_CIS: 25, SALT_RFFS: 25, PB_SUGAR: 50 },
  CBOX: { PALM: 10, OOTY: 50, TAN: 50, PB_PALM: 10 },
};

type RowInput = { open?: string; receipt?: string; sales?: string };

function prevDayStr(dateStr: string) {
  const d = new Date(dateStr + 'T00:00:00');
  d.setDate(d.getDate() - 1);
  return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;
}

/** Previous day's closing (or the last sheet of the previous month). */
function getAutoOpening(entryStore: Record<string, SavedSheet>, crsId: string, dateStr: string, commId: string, sec: 'a' | 'b'): number | null {
  const prev = entryStore[`${crsId}_${prevDayStr(dateStr)}`];
  if (prev?.[sec]?.[commId] !== undefined) return Number(prev[sec]![commId].close) || 0;
  if (dateStr.endsWith('-01') || new Date(dateStr + 'T00:00:00').getDate() === 1) {
    const d = new Date(dateStr + 'T00:00:00');
    d.setDate(0); // last day of previous month
    const month = d.getMonth();
    for (let i = 0; i < 31; i++) {
      const k = `${crsId}_${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;
      const e = entryStore[k];
      if (e?.[sec]?.[commId] !== undefined) return Number(e[sec]![commId].close) || 0;
      d.setDate(d.getDate() - 1);
      if (d.getMonth() !== month) break;
    }
  }
  return null;
}

export default function DailyEntryPage() {
  const { user } = useAuth();
  const shops: ShopRec[] = SHOPS;
  const entryStore = useStore<Record<string, SavedSheet>>('entryStore') ?? {};
  const inspectionStore = useStore<Record<string, InspDay>>('inspectionStore') ?? {};
  const meManualStore = useStore<Record<string, Partial<MonthlyBlock>>>('meManualStore') ?? {};
  const salesCloseStore = useStore<Record<string, SalesClose>>('salesCloseStore') ?? {};

  const isCrsUser = !!user?.crsId && user.role !== 'ADMIN';
  const shopIds = isCrsUser ? [user!.crsId as number] : shops.map((_, i) => i + 1);

  const [crsVal, setCrsVal] = useState(isCrsUser ? String(user!.crsId) : '');
  const [date, setDate] = useState(todayIso());
  const [rows, setRows] = useState<Record<string, RowInput>>({});
  const [remits, setRemits] = useState<{ amount: number; date: string }[]>([]);
  const [remitAmt, setRemitAmt] = useState('');
  const [remitDate, setRemitDate] = useState(todayIso());
  const [remitErr, setRemitErr] = useState<{ amount?: string; date?: string }>({});
  const [savedMsg, setSavedMsg] = useState('');
  const [inspOpen, setInspOpen] = useState(false);
  const gridRef = useRef<HTMLDivElement>(null);

  const crsId = crsVal ? Number(crsVal) : null;
  const key = crsVal && date ? `${crsVal}_${date}` : '';
  const saved = key ? entryStore[key] : undefined;
  const insp = key ? inspectionStore[key] : undefined;
  const lists = entryListsFor(crsId);

  // Re-open the sheet whenever the shop or date changes.
  useEffect(() => {
    if (!key) return;
    const next: Record<string, RowInput> = {};
    const sheet = entryStore[key];
    if (sheet) {
      for (const sec of ['a', 'b'] as const) {
        for (const [id, r] of Object.entries(sheet[sec] ?? {})) {
          next[`${sec}:${id}`] = {
            open: r.open ? Number(r.open).toFixed(3) : '',
            receipt: r.receipt ? Number(r.receipt).toFixed(3) : '',
            sales: r.sales ? Number(r.sales).toFixed(3) : '',
          };
        }
      }
      if (sheet.remits?.length) {
        setRemits(sheet.remits.map((r) => ({ amount: Number(r.amount) || 0, date: r.date || '' })));
      } else if (Number(sheet.remitAmount)) {
        setRemits([{ amount: Number(sheet.remitAmount), date: sheet.remitDate || date }]);
      } else {
        setRemits([]);
      }
    } else {
      setRemits([]);
    }
    setRows(next);
    setRemitAmt('');
    setRemitDate(date);
    setRemitErr({});
    setSavedMsg('');
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);

  const adjFor = (sec: 'a' | 'b', id: string) => {
    const r = insp?.[sec]?.[id];
    return { excess: Number(r?.excess) || 0, shortage: Number(r?.shortage) || 0, transfer: Number(r?.transfer) || 0 };
  };

  type Derived = { open: number; openAuto: boolean; receipt: number; sales: number; total: number; close: number; amount: number; adj: ReturnType<typeof adjFor> };
  const derive = (sec: 'a' | 'b', c: Commodity): Derived => {
    const r = rows[`${sec}:${c.id}`] ?? {};
    const auto = crsVal ? getAutoOpening(entryStore, crsVal, date, c.id, sec) : null;
    const savedOpen = saved?.[sec]?.[c.id]?.open;
    const openAuto = auto !== null && !savedOpen && r.open === undefined;
    const open = openAuto ? auto! : Number(r.open) || 0;
    const receipt = Number(r.receipt) || 0;
    const sales = Number(r.sales) || 0;
    const adj = adjFor(sec, c.id);
    const total = open + receipt + adj.excess - adj.shortage - adj.transfer;
    const close = total - sales;
    const amount = c.free ? 0 : sales * c.rate;
    return { open, openAuto, receipt, sales, total, close, amount, adj };
  };

  const totals = useMemo(() => {
    const sum = { a: { open: 0, rec: 0, ex: 0, sh: 0, tr: 0, total: 0, sales: 0, close: 0, amt: 0 }, b: { open: 0, rec: 0, ex: 0, sh: 0, tr: 0, total: 0, sales: 0, close: 0, amt: 0 } };
    for (const [sec, comms] of [['a', lists.a], ['b', lists.b]] as const) {
      for (const c of comms) {
        const d = derive(sec, c);
        const s = sum[sec];
        s.open += d.open;
        s.rec += d.receipt;
        s.ex += d.adj.excess;
        s.sh += d.adj.shortage;
        s.tr += d.adj.transfer;
        s.total += d.total;
        s.sales += d.sales;
        s.close += d.close;
        s.amt += d.amount;
      }
    }
    return sum;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rows, insp, entryStore, crsVal, date, lists]);
  const grand = totals.a.amt + totals.b.amt;
  const remitTotal = remits.reduce((t, r) => t + r.amount, 0);

  const anyAdj = (['excess', 'shortage', 'transfer'] as const).filter((f) =>
    [...lists.a.map((c) => adjFor('a', c.id)), ...lists.b.map((c) => adjFor('b', c.id))].some((a) => a[f] !== 0),
  );
  const showAdj = new Set(anyAdj);

  const setField = (sec: 'a' | 'b', id: string, field: keyof RowInput, val: string) => {
    if (val !== '' && (isNaN(Number(val)) || Number(val) < 0)) return;
    setRows((prev) => ({ ...prev, [`${sec}:${id}`]: { ...prev[`${sec}:${id}`], [field]: val } }));
  };

  // Enter / arrow-key navigation down and up the editable inputs.
  const gridKey = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key !== 'Enter' && e.key !== 'ArrowDown' && e.key !== 'ArrowUp') return;
    e.preventDefault();
    const inputs = Array.from(gridRef.current?.querySelectorAll<HTMLInputElement>('input[data-nav]') ?? []);
    const i = inputs.indexOf(e.currentTarget);
    if (i === -1) return;
    const next = e.key === 'ArrowUp' ? inputs[i - 1] : inputs[i + 1];
    if (next) {
      next.focus();
      next.select();
    }
  };

  const remitCollect = (): { amount: number; date: string }[] | null => {
    setRemitErr({});
    const raw = remitAmt.trim();
    const amt = parseFloat(raw);
    const hasAmount = raw !== '' && !isNaN(amt) && amt > 0;
    const list = [...remits];
    if (hasAmount) {
      if (!remitDate) {
        setRemitErr({ date: 'Please select the Remittance Date.' });
        return null;
      }
      list.push({ amount: amt, date: remitDate });
    } else if (!list.length) {
      setRemitErr({ amount: 'Please enter the Remittance Amount.', date: remitDate ? undefined : 'Please select the Remittance Date.' });
      return null;
    }
    return list;
  };

  const addRemit = () => {
    setRemitErr({});
    const amt = parseFloat(remitAmt.trim());
    const errs: typeof remitErr = {};
    if (!(remitAmt.trim() !== '' && !isNaN(amt) && amt > 0)) errs.amount = 'Please enter the Remittance Amount.';
    if (!remitDate) errs.date = 'Please select the Remittance Date.';
    if (errs.amount || errs.date) {
      setRemitErr(errs);
      return;
    }
    setRemits((r) => [...r, { amount: amt, date: remitDate }]);
    setRemitAmt('');
  };

  /** Save the sheet; returns true when written. */
  const save = async (): Promise<boolean> => {
    if (!crsVal || !date) return false;
    const list = remitCollect();
    if (!list) return false;

    if (saved) {
      const when = new Date(date + 'T00:00:00').toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' });
      const ok = confirm(
        `A day sheet is already saved for CRS ${crsVal} — ${shops[Number(crsVal) - 1]?.name ?? ''} on ${when}.\n\n` +
          'Saving now replaces it with what is currently on screen. This cannot be undone.\n\nReplace the saved sheet?',
      );
      if (!ok) return false;
    }

    const snap: SavedSheet = { a: {}, b: {} };
    for (const [sec, comms] of [['a', lists.a], ['b', lists.b]] as const) {
      for (const c of comms) {
        const d = derive(sec, c);
        snap[sec]![c.id] = {
          open: d.open, receipt: d.receipt, total: d.total, sales: d.sales, close: d.close, amount: d.amount,
          ...d.adj,
        } as never;
      }
    }
    const total = list.reduce((t, r) => t + r.amount, 0);
    snap.remits = list;
    snap.remitAmount = total;
    snap.remitDate = list.map((r) => r.date).filter(Boolean).sort()[0] ?? '';

    crsData.update<Record<string, SavedSheet>>('entryStore', (d) => {
      d[key] = snap;
    });

    // Republish the month so Monthly Entry and statements see this day.
    const [y, m] = date.split('-').map(Number);
    const nextEntryStore = { ...entryStore, [key]: snap };
    const { merged, source } = rebuildMonthlyFromDaily(Number(crsVal), m, y, nextEntryStore, inspectionStore, meManualStore[`${crsVal}_${m}_${y}`]);
    const moKey = `${crsVal}_${m}_${y}`;
    crsData.update<Record<string, MonthlyBlock>>('monthlyStore', (d) => {
      d[moKey] = merged;
    });
    crsData.update<Record<string, SourceBlock>>('meSourceStore', (d) => {
      d[moKey] = source;
    });

    setRemits(list);
    setRemitAmt('');
    if (snap.remitDate) setRemitDate(snap.remitDate);
    setSavedMsg(
      `CRS ${crsVal} — ${shops[Number(crsVal) - 1]?.name ?? ''} (${new Date(date + 'T00:00:00').toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' })})`,
    );
    setTimeout(() => setSavedMsg(''), 5000);
    void crsData.save();
    return true;
  };

  const markSalesClose = async () => {
    if (!crsVal || !date) {
      alert('Select a CRS shop and date first.');
      return;
    }
    const ok = await save();
    if (!ok) return;
    const [y, m, lastDay] = date.split('-').map(Number);
    // Aggregate the month's sales (kgs) per commodity up to this date, from
    // the store as it stands AFTER save() wrote the sheet.
    const kgsById: Record<string, number> = {};
    const store = crsData.get<Record<string, SavedSheet>>('entryStore') ?? {};
    for (let day = 1; day <= lastDay; day++) {
      const sheet = store[`${crsVal}_${y}-${pad2(m)}-${pad2(day)}`];
      if (!sheet) continue;
      for (const sec of ['a', 'b'] as const) {
        for (const [cid, r] of Object.entries(sheet[sec] ?? {})) kgsById[cid] = (kgsById[cid] ?? 0) + (Number(r.sales) || 0);
      }
    }
    const sumType = (map: Record<string, number>) =>
      Object.entries(map).reduce((bags, [cid, div]) => bags + ((kgsById[cid] ?? 0) > 0 ? Math.floor((kgsById[cid] ?? 0) / div) : 0), 0);
    const agg = { gunny: sumType(SC_PACK.GUNNY), poly: sumType(SC_PACK.POLY), cbox: sumType(SC_PACK.CBOX) };

    const scKey = `${crsVal}_${m}_${y}`;
    const prev = salesCloseStore[scKey];
    crsData.update<Record<string, SalesClose>>('salesCloseStore', (d) => {
      d[scKey] = { date, ...agg, updatedAt: new Date().toISOString() };
    });
    void crsData.save();
    alert(
      `Sales Close marked for ${date.split('-').reverse().join('/')}` +
        (prev && prev.date !== date ? `\n(previous mark on ${prev.date.split('-').reverse().join('/')} was replaced)` : '') +
        `\n\nMonth totals up to this date:\n  Sales Gunny = ${agg.gunny}  → 50 KG SS Receipt\n  Sales Poly  = ${agg.poly}  → POLY Receipt\n  Sales C.Box = ${agg.cbox}  → C.BOX Receipt`,
    );
  };

  const clearForm = () => {
    setRows({});
    setRemits([]);
    setRemitAmt('');
    setRemitErr({});
  };

  // DSS preview/export — the verbatim legacy builder behind a real-DOM shim
  // (src/generated/dss-legacy.js). Loaded on demand; the viewer overlay,
  // print flow and styled .xlsx work exactly as in the classic app.
  const openDss = async () => {
    if (!crsVal) {
      alert('Please select a CRS shop first.');
      return;
    }
    const { createDssEngine } = await import('@/generated/dss-legacy');
    const engine = createDssEngine({
      stores: {
        entryStore: crsData.get('entryStore') ?? {},
        inspectionStore: crsData.get('inspectionStore') ?? {},
      },
      CRS_LIST: SHOPS,
      APP_CONFIG: crsData.get('__config') ?? {},
      CRS_ACCOUNTS: crsData.get('__accounts') ?? {},
    });
    engine.openPreview(crsVal, date);
  };

  const scRec = crsVal && date ? salesCloseStore[`${crsVal}_${Number(date.split('-')[1])}_${Number(date.split('-')[0])}`] : undefined;
  const holName = date ? weeklyHolidayName(new Date(date + 'T00:00:00')) : null;
  const d = date ? new Date(date + 'T00:00:00') : null;
  const dateLabel = d
    ? `${['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'][d.getDay()]}, ${d.toLocaleDateString('en-IN', { day: 'numeric', month: 'long', year: 'numeric' })}` +
      (holName ? ` · ${holName}` : isWeeklyHoliday(d) ? ' · Holiday' : '')
    : '';

  const inspParts: string[] = [];
  if (insp) {
    const lookup = new Map<string, string>([...lists.a.map((c) => [`a${c.id}`, c.en] as [string, string]), ...lists.b.map((c) => [`b${c.id}`, c.en] as [string, string])]);
    for (const sec of ['a', 'b'] as const) {
      for (const [id, r] of Object.entries(insp[sec] ?? {})) {
        for (const [f, sign, color] of [['excess', '+', '#166534'], ['shortage', '−', '#B91C1C'], ['transfer', '→', '#92400E']] as const) {
          const v = Number(r[f]) || 0;
          if (v) inspParts.push(`<span style="display:inline-block;margin-right:10px"><strong style="color:${color}">${sign}${+v.toFixed(3)}</strong> ${lookup.get(sec + id) ?? id} <span style="opacity:.7">(${f})</span></span>`);
        }
      }
    }
  }

  const thA = (label: React.ReactNode, extra?: React.CSSProperties, cls?: string) => (
    <th className={cls} style={{ padding: '9px 8px', textAlign: 'center', fontSize: 10, fontWeight: 700, color: 'var(--muted)', borderBottom: '1px solid var(--border)', ...extra }}>{label}</th>
  );

  const adjCell = (val: number, kind: 'excess' | 'shortage' | 'transfer', bdr: string) => {
    const theme = { excess: { bg: '#DCFCE7', fg: '#166534', bd: '#86EFAC', sign: '+' }, shortage: { bg: '#FEE2E2', fg: '#B91C1C', bd: '#FCA5A5', sign: '−' }, transfer: { bg: '#FEF3C7', fg: '#92400E', bd: '#FDE047', sign: '→' } }[kind];
    if (!showAdj.has(kind)) return null;
    return (
      <td style={{ padding: '4px 3px', textAlign: 'center', borderBottom: bdr }}>
        {val ? (
          <span style={{ display: 'inline-block', background: theme.bg, border: `1px solid ${theme.bd}`, color: theme.fg, fontSize: 11, fontWeight: 800, padding: '3px 7px', borderRadius: 5, minWidth: 38 }}>
            {theme.sign}
            {+val.toFixed(3)}
          </span>
        ) : (
          <span style={{ color: '#CBD5E1', fontSize: 11 }}>—</span>
        )}
      </td>
    );
  };

  const numInput = (sec: 'a' | 'b', c: Commodity, field: 'open' | 'receipt' | 'sales', d2: Derived, extra?: React.CSSProperties) => {
    const r = rows[`${sec}:${c.id}`] ?? {};
    const isAuto = field === 'open' && d2.openAuto;
    const val = isAuto ? d2.open.toFixed(3) : (r[field] ?? (saved?.[sec]?.[c.id]?.[field] !== undefined && r[field] === undefined ? '' : r[field]) ?? '');
    return (
      <input
        type="number"
        min={0}
        step={0.001}
        placeholder="0.000"
        readOnly={isAuto}
        data-nav={isAuto ? undefined : '1'}
        value={isAuto ? val : (r[field] ?? '')}
        onChange={(e) => setField(sec, c.id, field, e.target.value)}
        onKeyDown={gridKey}
        title={isAuto ? "Auto-carried from the previous day's closing" : undefined}
        style={{ width: '100%', border: '1px solid #E2E8F0', borderRadius: 6, padding: '5px 7px', fontSize: 12, textAlign: 'right', ...(isAuto ? { background: '#FEF3C7', color: '#92400E', fontWeight: 700 } : {}), ...extra }}
      />
    );
  };

  const roCell = (val: number, style?: React.CSSProperties) => (
    <input type="number" readOnly value={val ? val.toFixed(3) : ''} placeholder="0.000" style={{ width: '100%', border: '1px solid #E2E8F0', borderRadius: 6, padding: '5px 7px', fontSize: 12, textAlign: 'right', background: '#F8FAFC', color: 'var(--muted)', ...style }} />
  );

  const section = (sec: 'a' | 'b', comms: Commodity[]) => {
    const secA = sec === 'a';
    if (!comms.length) return null;
    const bdr = secA ? '1px solid #EFF6FF' : '1px solid #FFF7ED';
    const t = totals[sec];
    const footBg = secA ? '#EFF6FF' : '#FFF7ED';
    const footCol = secA ? '#0369A1' : '#C2410C';
    const footBd = secA ? '2px solid #BAE6FD' : '2px solid #FED7AA';
    return (
      <div className="card" style={{ borderRadius: 0, borderTop: 'none', borderBottom: 'none', marginTop: secA ? undefined : 2 }}>
        <div style={{ background: secA ? '#F0F9FF' : '#FFF7ED', padding: '9px 16px', borderBottom: secA ? '1px solid #BAE6FD' : '1px solid #FED7AA', display: 'flex', alignItems: 'center', gap: 8 }}>
          <span style={{ background: footCol, color: '#fff', fontSize: 10, fontWeight: 800, padding: '2px 8px', borderRadius: 4 }}>SECTION {sec.toUpperCase()}</span>
          <span style={{ fontWeight: 700, fontSize: 12, color: footCol }}>{secA ? 'நியாய வகுப்பு / Main Ration Sales' : 'காவலர் அட்டை / Police Ration Card'}</span>
          <span style={{ marginLeft: 'auto', fontSize: 11, color: footCol }}>{comms.length} commodities</span>
        </div>
        <div style={{ overflowX: 'auto' }}>
          <table className="frz-table" style={{ width: '100%', borderCollapse: 'collapse', minWidth: 900 }}>
            <thead>
              <tr style={{ background: secA ? '#F8FAFC' : '#FFFBF5' }}>
                {thA('#')}
                {thA('பொருட்கள் / Commodity', { textAlign: 'left', padding: '9px 12px' }, 'frz-comm')}
                {thA('Unit')}
                {thA(<>Rate<br />(₹)</>)}
                {thA(<>ஆரம்ப இருப்பு<br />Opening</>)}
                {thA(<>வரவு<br />Receipt</>)}
                {showAdj.has('excess') ? thA(<>கூடுதல்<br />Excess</>, { color: '#166534', background: '#F0FDF4' }) : null}
                {showAdj.has('shortage') ? thA(<>போத்தாக்குறை<br />Shortage</>, { color: '#B91C1C', background: '#FEF2F2' }) : null}
                {showAdj.has('transfer') ? thA(<>மாற்றம்<br />Transfer</>, { color: '#92400E', background: '#FFFBEB' }) : null}
                {thA(<>மொத்தம்<br />Total</>, { color: '#0284C7', background: '#EFF6FF' })}
                {thA(<>மொத்த விற்பனை<br />Total Sales</>)}
                {thA(<>இறுதி இருப்பு<br />Closing</>)}
                {thA(<>விற்பனை தொகை<br />Amount (₹)</>)}
              </tr>
            </thead>
            <tbody>
              {comms.map((c, i) => {
                const d2 = derive(sec, c);
                return (
                  <tr key={c.id} style={{ background: i % 2 === 0 ? '#fff' : '#FAFCFF' }}>
                    <td style={{ padding: 8, textAlign: 'center', fontSize: 11, color: 'var(--muted)', borderBottom: bdr }}>{i + 1}</td>
                    <td className="frz-comm" style={{ padding: '8px 12px', borderBottom: bdr }}>
                      <div style={{ fontWeight: 600, fontSize: 12 }}>{c.ta}</div>
                      <div style={{ fontSize: 10, color: 'var(--muted)' }}>{c.en}</div>
                    </td>
                    <td style={{ padding: 8, textAlign: 'center', fontSize: 11, color: 'var(--muted)', borderBottom: bdr }}>{c.unit}</td>
                    <td style={{ padding: 8, textAlign: 'center', borderBottom: bdr }}>
                      {c.free ? <span style={{ color: '#16A34A', fontWeight: 600, fontSize: 10 }}>Free</span> : <span style={{ fontSize: 12, fontWeight: 600 }}>₹{c.rate.toFixed(2)}</span>}
                    </td>
                    <td style={{ padding: '4px 5px', borderBottom: bdr }}>{numInput(sec, c, 'open', d2)}</td>
                    <td style={{ padding: '4px 5px', borderBottom: bdr }}>{numInput(sec, c, 'receipt', d2)}</td>
                    {adjCell(d2.adj.excess, 'excess', bdr)}
                    {adjCell(d2.adj.shortage, 'shortage', bdr)}
                    {adjCell(d2.adj.transfer, 'transfer', bdr)}
                    <td style={{ padding: '4px 5px', borderBottom: bdr, background: '#EFF6FF' }}>{roCell(d2.total, { background: '#EFF6FF', color: '#0284C7', fontWeight: 700 })}</td>
                    <td style={{ padding: '4px 5px', borderBottom: bdr }}>{numInput(sec, c, 'sales', d2, { fontWeight: 700 })}</td>
                    <td style={{ padding: '4px 5px', borderBottom: bdr }}>
                      {roCell(d2.close, d2.close < 0 ? { color: '#DC2626', background: '#FEF2F2', borderColor: '#FCA5A5', fontWeight: 800 } : undefined)}
                    </td>
                    <td style={{ padding: '4px 5px', borderBottom: bdr }}>
                      {c.free ? (
                        <div style={{ textAlign: 'center', padding: '6px 4px', fontSize: 11, color: '#16A34A', fontStyle: 'italic' }}>விலையில்லா</div>
                      ) : (
                        <input readOnly value={d2.amount ? d2.amount.toFixed(2) : ''} placeholder="0.00" style={{ width: '100%', border: '1px solid #E2E8F0', borderRadius: 6, padding: '5px 7px', fontSize: 12, textAlign: 'right', background: secA ? '#EFF6FF' : '#FFF3E8', color: footCol, fontWeight: 700 }} />
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
            <tfoot>
              <tr style={{ background: footBg, fontWeight: 800 }}>
                <td colSpan={4} className="frz-comm" style={{ padding: '10px 12px', fontSize: 12, color: footCol, borderTop: footBd }}>Section {sec.toUpperCase()} Total</td>
                {[t.open, t.rec].map((v, i) => (
                  <td key={i} style={{ padding: '10px 6px', textAlign: 'right', fontSize: 12, color: footCol, borderTop: footBd }}>{v.toFixed(3)}</td>
                ))}
                {showAdj.has('excess') ? <td style={{ padding: '10px 6px', textAlign: 'right', fontSize: 12, color: '#166534', borderTop: footBd, background: '#F0FDF4' }}>{t.ex.toFixed(3)}</td> : null}
                {showAdj.has('shortage') ? <td style={{ padding: '10px 6px', textAlign: 'right', fontSize: 12, color: '#B91C1C', borderTop: footBd, background: '#FEF2F2' }}>{t.sh.toFixed(3)}</td> : null}
                {showAdj.has('transfer') ? <td style={{ padding: '10px 6px', textAlign: 'right', fontSize: 12, color: '#92400E', borderTop: footBd, background: '#FFFBEB' }}>{t.tr.toFixed(3)}</td> : null}
                <td style={{ padding: '10px 6px', textAlign: 'right', fontSize: 12, color: '#0284C7', borderTop: footBd, background: '#EFF6FF' }}>{t.total.toFixed(3)}</td>
                <td style={{ padding: '10px 6px', textAlign: 'right', fontSize: 12, color: footCol, borderTop: footBd }}>{t.sales.toFixed(3)}</td>
                <td style={{ padding: '10px 6px', textAlign: 'right', fontSize: 12, color: footCol, borderTop: footBd }}>{t.close.toFixed(3)}</td>
                <td style={{ padding: '10px 6px', textAlign: 'right', fontSize: 12, color: footCol, borderTop: footBd }}>{inr(t.amt)}</td>
              </tr>
            </tfoot>
          </table>
        </div>
      </div>
    );
  };

  return (
    <div className="page active" id="page-entry">
      <div className="page-header" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', flexWrap: 'wrap', gap: 12 }}>
        <div>
          <div className="page-title">Daily Sales Entry</div>
          <div className="page-sub">தினசரி இறுப்பு / வேறுவாறு அறிக்கை — TNCSC Madurai Region</div>
        </div>
        <div style={{ display: 'flex', gap: 10, flexShrink: 0 }}>
          <button
            onClick={() => {
              if (!crsVal || !date) {
                alert('Please select a CRS shop and date first.');
                return;
              }
              setInspOpen(true);
            }}
            style={{ background: 'linear-gradient(135deg,#7C3AED,#9333EA)', color: '#fff', border: 'none', padding: '9px 18px', borderRadius: 8, fontWeight: 700, fontSize: 13, cursor: 'pointer' }}
          >
            🔍 Inspection
          </button>
          <button
            onClick={() => void openDss()}
            title="Preview the daily statement (DSS) for this month — print or export the styled Excel from the viewer"
            style={{ background: 'linear-gradient(135deg,#0369A1,#0EA5E9)', color: '#fff', border: 'none', padding: '9px 18px', borderRadius: 8, fontWeight: 700, fontSize: 13, cursor: 'pointer' }}
          >
            📄 DSS
          </button>
        </div>
      </div>

      <div className="card mb-4">
        <div className="card-body">
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 16, alignItems: 'end' }}>
            <div>
              <label className="form-label">CRS Shop (நியாயவிலைக்கடை)</label>
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
              <label className="form-label">Entry Date (நாள்)</label>
              <input type="date" value={date} max={todayIso()} onChange={(e) => setDate(e.target.value)} />
            </div>
            {crsVal && date ? (
              <div style={{ background: 'var(--bg)', borderRadius: 10, padding: '10px 14px' }}>
                <div style={{ fontSize: 10, color: 'var(--muted)', textTransform: 'uppercase', letterSpacing: '.05em' }}>Selected</div>
                <div style={{ fontWeight: 700, color: '#0369A1', fontSize: 13, marginTop: 2 }}>{dateLabel}</div>
              </div>
            ) : null}
          </div>
        </div>
      </div>

      {!crsVal || !date ? (
        <div style={{ textAlign: 'center', padding: '64px 24px', color: 'var(--muted)' }}>
          <div style={{ fontSize: 52, marginBottom: 14 }}>📋</div>
          <div style={{ fontWeight: 700, fontSize: 16, color: 'var(--text)', marginBottom: 6 }}>Select a CRS shop and date to begin</div>
          <div style={{ fontSize: 13 }}>The TNCSC daily sales form will appear automatically</div>
        </div>
      ) : (
        <div ref={gridRef}>
          {saved ? (
            <div style={{ display: 'flex', background: '#FEF3C7', border: '1px solid #F59E0B', borderRadius: 10, padding: '12px 16px', marginBottom: 14, alignItems: 'center', gap: 10 }}>
              <span style={{ fontSize: 18 }}>⚠</span>
              <div>
                <div style={{ fontWeight: 700, color: '#92400E', fontSize: 13 }}>Duplicate Entry</div>
                <div style={{ fontSize: 12, color: '#92400E' }}>An entry already exists for this shop &amp; date. Saving will overwrite it.</div>
              </div>
            </div>
          ) : null}
          {savedMsg ? (
            <div style={{ display: 'flex', background: '#DCFCE7', border: '1px solid #86EFAC', borderRadius: 10, padding: '12px 16px', marginBottom: 14, color: '#15803D', fontSize: 13, fontWeight: 600, alignItems: 'center', gap: 8 }}>
              ✓ Entry saved: <span>{savedMsg}</span>
            </div>
          ) : null}

          <div style={{ background: 'linear-gradient(135deg,#0369A1,#0EA5E9)', borderRadius: '12px 12px 0 0', padding: '14px 20px', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <div>
              <div style={{ color: '#fff', fontWeight: 800, fontSize: 15 }}>CRS {crsVal} — {shops[Number(crsVal) - 1]?.name ?? ''}</div>
              <div style={{ color: 'rgba(255,255,255,.65)', fontSize: 11, marginTop: 2 }}>{dateLabel}</div>
            </div>
            <div style={{ textAlign: 'right' }}>
              <div style={{ color: 'rgba(255,255,255,.6)', fontSize: 10, textTransform: 'uppercase', letterSpacing: '.08em' }}>Grand Total</div>
              <div style={{ color: '#fff', fontWeight: 900, fontSize: 22 }}>{inr(grand)}</div>
            </div>
          </div>

          {inspParts.length ? (
            <div style={{ display: 'flex', margin: '0 0 2px', padding: '11px 16px', border: '1px solid #FDE047', background: '#FFFBEB', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
              <span style={{ fontSize: 18 }}>🔍</span>
              <div style={{ flex: 1, minWidth: 220 }}>
                <div style={{ fontWeight: 800, fontSize: 12, color: '#92400E' }}>Inspection adjustments applied to this date</div>
                <div style={{ fontSize: 11, color: '#A16207', marginTop: 3 }} dangerouslySetInnerHTML={{ __html: inspParts.join('') }} />
              </div>
              <div style={{ fontSize: 11, color: '#A16207', fontWeight: 600 }}>Total = Opening + Receipt + Excess − Shortage − Transfer</div>
            </div>
          ) : null}

          {section('a', lists.a)}
          {section('b', lists.b)}

          <div className="card" style={{ borderRadius: '0 0 12px 12px', borderTop: 'none' }}>
            <div style={{ padding: '14px 20px', display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: 12 }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 20 }}>
                {[['Section A', totals.a.amt, '#0369A1'], ['Section B', totals.b.amt, '#C2410C'], ['Grand Total', grand, '#16A34A']].map(([label, val, col], i) => (
                  <div key={label as string} style={{ display: 'flex', alignItems: 'center', gap: 20 }}>
                    {i > 0 ? <div style={{ width: 1, height: 32, background: 'var(--border)' }} /> : null}
                    <div style={{ textAlign: 'center' }}>
                      <div style={{ fontSize: 10, color: 'var(--muted)', textTransform: 'uppercase', letterSpacing: '.05em' }}>{label as string}</div>
                      <div style={{ fontWeight: i === 2 ? 900 : 800, fontSize: i === 2 ? 18 : 16, color: col as string }}>{inr(val as number)}</div>
                    </div>
                  </div>
                ))}
              </div>

              {/* Remittance */}
              <div style={{ width: '100%', borderTop: '1px solid var(--border)', margin: '14px 0 10px', paddingTop: 14 }}>
                <div style={{ fontSize: 10, fontWeight: 800, color: 'var(--muted)', textTransform: 'uppercase', letterSpacing: '.06em', marginBottom: 10 }}>
                  🏭 Remittance Details <span style={{ color: '#DC2626' }}>*</span>
                  <span style={{ fontWeight: 400, fontSize: 9, color: 'var(--muted)', marginLeft: 6 }}>(required — bank deposit amount &amp; date; add more than one for the same day if the deposit was split)</span>
                </div>
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr auto', gap: 14, alignItems: 'start' }}>
                  <div>
                    <label style={{ display: 'block', fontSize: 11, fontWeight: 700, color: 'var(--text)', marginBottom: 5 }}>
                      Remittance Amount (₹) <span style={{ color: '#DC2626' }}>*</span>
                    </label>
                    <div style={{ position: 'relative' }}>
                      <span style={{ position: 'absolute', left: 10, top: 19, transform: 'translateY(-50%)', fontSize: 13, fontWeight: 700, color: '#0369A1' }}>₹</span>
                      <input
                        type="number"
                        min={0}
                        step={0.01}
                        placeholder="0.00"
                        value={remitAmt}
                        onChange={(e) => {
                          setRemitAmt(e.target.value);
                          setRemitErr((p) => ({ ...p, amount: undefined }));
                        }}
                        onKeyDown={(e) => {
                          if (e.key === 'Enter') {
                            e.preventDefault();
                            addRemit();
                          }
                        }}
                        style={{ width: '100%', border: `2px solid ${remitErr.amount ? '#DC2626' : '#BAE6FD'}`, borderRadius: 8, padding: '9px 12px 9px 26px', fontSize: 14, fontWeight: 700, color: '#0369A1', background: '#F0F9FF', outline: 'none' }}
                      />
                      {remitErr.amount ? <div style={{ fontSize: 10, marginTop: 3, color: '#DC2626', fontWeight: 600 }}>{remitErr.amount}</div> : null}
                      {(() => {
                        const pend = parseFloat(remitAmt.trim());
                        const remit = remitTotal + (remitAmt.trim() !== '' && !isNaN(pend) && pend > 0 ? pend : 0);
                        if (!remit) return null;
                        const diff = remit - grand;
                        const many = remits.length > 1 ? ` (${remits.length} deposits)` : '';
                        if (Math.abs(diff) < 0.001) return <div style={{ fontSize: 10, marginTop: 3, color: '#16A34A' }}>✓ Matches sales total{many}</div>;
                        if (diff > 0) return <div style={{ fontSize: 10, marginTop: 3, color: '#D97706' }}>▲ +₹{diff.toFixed(2)} above sales total{many}</div>;
                        return <div style={{ fontSize: 10, marginTop: 3, color: '#DC2626' }}>▼ ₹{Math.abs(diff).toFixed(2)} below sales total{many}</div>;
                      })()}
                    </div>
                  </div>
                  <div>
                    <label style={{ display: 'block', fontSize: 11, fontWeight: 700, color: 'var(--text)', marginBottom: 5 }}>
                      Remittance Date 📅 <span style={{ color: '#DC2626' }}>*</span>
                    </label>
                    <input
                      type="date"
                      value={remitDate}
                      onChange={(e) => {
                        setRemitDate(e.target.value);
                        setRemitErr((p) => ({ ...p, date: undefined }));
                      }}
                      style={{ width: '100%', border: `2px solid ${remitErr.date ? '#DC2626' : '#BAE6FD'}`, borderRadius: 8, padding: '9px 12px', fontSize: 13, fontWeight: 600, color: '#0369A1', background: '#F0F9FF', outline: 'none' }}
                    />
                    {remitErr.date ? <div style={{ fontSize: 10, marginTop: 3, color: '#DC2626', fontWeight: 600 }}>{remitErr.date}</div> : null}
                  </div>
                  <div>
                    <label style={{ display: 'block', fontSize: 11, fontWeight: 700, color: 'transparent', marginBottom: 5 }}>.</label>
                    <button type="button" onClick={addRemit} title="Add this amount and date to the day's remittance list" style={{ background: 'linear-gradient(135deg,#047857,#10B981)', color: '#fff', border: 'none', padding: '10px 20px', borderRadius: 8, fontWeight: 700, fontSize: 13, cursor: 'pointer', whiteSpace: 'nowrap', boxShadow: '0 2px 8px rgba(16,185,129,.3)' }}>
                      ➕ Add
                    </button>
                  </div>
                </div>
                <div style={{ marginTop: 12 }}>
                  {!remits.length ? (
                    <div style={{ fontSize: 11, color: '#B45309', background: '#FFFBEB', border: '1px dashed #FDE047', borderRadius: 8, padding: '8px 12px' }}>
                      ⚠ No remittance added yet — enter the amount and date, then press <strong>Add</strong>. At least one is required to complete the day.
                    </div>
                  ) : (
                    <div style={{ border: '1px solid #E2E8F0', borderRadius: 9, overflow: 'hidden' }}>
                      <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                        <thead>
                          <tr style={{ background: '#F8FAFC' }}>
                            {['#', 'Amount', 'Deposit Date', ''].map((h, i) => (
                              <th key={i} style={{ padding: '6px 10px', fontSize: 9.5, fontWeight: 800, color: 'var(--muted)', textTransform: 'uppercase', letterSpacing: '.05em', borderBottom: '1px solid #E2E8F0', textAlign: i === 1 ? 'right' : i === 3 ? 'right' : 'center', width: i === 0 ? 34 : i === 3 ? 56 : undefined }}>{h}</th>
                            ))}
                          </tr>
                        </thead>
                        <tbody>
                          {remits.map((r, i) => (
                            <tr key={i} style={{ background: i % 2 === 0 ? '#fff' : '#F8FAFC' }}>
                              <td style={{ padding: '6px 10px', fontSize: 11, color: 'var(--muted)', textAlign: 'center', borderBottom: '1px solid #F1F5F9' }}>{i + 1}</td>
                              <td style={{ padding: '6px 10px', fontSize: 13, fontWeight: 800, color: '#0369A1', textAlign: 'right', borderBottom: '1px solid #F1F5F9', whiteSpace: 'nowrap' }}>{inr(r.amount)}</td>
                              <td style={{ padding: '6px 10px', fontSize: 12, fontWeight: 600, color: '#334155', textAlign: 'center', borderBottom: '1px solid #F1F5F9', whiteSpace: 'nowrap' }}>{r.date.split('-').reverse().join('/')}</td>
                              <td style={{ padding: '4px 10px', textAlign: 'right', borderBottom: '1px solid #F1F5F9' }}>
                                <button type="button" onClick={() => setRemits((list) => list.filter((_, j) => j !== i))} title="Remove this remittance" style={{ background: '#FEE2E2', color: '#B91C1C', border: '1px solid #FCA5A5', borderRadius: 6, padding: '3px 9px', fontSize: 11, fontWeight: 700, cursor: 'pointer' }}>✕</button>
                              </td>
                            </tr>
                          ))}
                        </tbody>
                        <tfoot>
                          <tr style={{ background: '#F0F9FF' }}>
                            <td />
                            <td style={{ padding: '7px 10px', fontSize: 13, fontWeight: 900, color: '#0369A1', textAlign: 'right', whiteSpace: 'nowrap' }}>{inr(remitTotal)}</td>
                            <td colSpan={2} style={{ padding: '7px 10px', fontSize: 10, fontWeight: 700, color: 'var(--muted)' }}>{remits.length} remittance{remits.length === 1 ? '' : 's'}</td>
                          </tr>
                        </tfoot>
                      </table>
                    </div>
                  )}
                </div>
              </div>

              {/* Actions */}
              <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap', width: '100%' }}>
                {scRec ? (
                  <span style={{ background: scRec.date === date ? '#DCFCE7' : '#FEF3C7', border: `1px solid ${scRec.date === date ? '#86EFAC' : '#FDE047'}`, color: scRec.date === date ? '#15803D' : '#92400E', fontSize: 11, fontWeight: 700, padding: '5px 10px', borderRadius: 7 }}>
                    {scRec.date === date ? '🔒 THIS DAY is the Sales Close (last sales day)' : `🔒 Sales Close: ${scRec.date.split('-').reverse().join('/')}`}
                  </span>
                ) : null}
                <button className="btn btn-outline btn-sm" onClick={clearForm}>🗑 Clear</button>
                <button onClick={() => void save()} title="Save this day sheet. Requires at least one remittance." style={{ background: 'linear-gradient(135deg,#0284C7,#0EA5E9)', color: '#fff', border: 'none', padding: '10px 22px', borderRadius: 9, fontWeight: 700, fontSize: 13, cursor: 'pointer', boxShadow: '0 2px 10px rgba(14,165,233,.3)' }}>
                  💾 தினசரி விற்பனை நிறைவு
                </button>
                <button onClick={() => void markSalesClose()} title="Mark this date as the LAST SALES DAY of the month. Totals up to this date auto-fill Monthly Entry & Gunny Receipt." style={{ marginLeft: 'auto', background: 'linear-gradient(135deg,#B45309,#F59E0B)', color: '#fff', border: 'none', padding: '10px 18px', borderRadius: 9, fontWeight: 700, fontSize: 13, cursor: 'pointer', boxShadow: '0 2px 10px rgba(245,158,11,.3)' }}>
                  🔒 மாத விற்பனை நிறைவு
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
      {inspOpen && crsId ? <InspectionModal crsId={crsId} date={date} onClose={() => setInspOpen(false)} /> : null}
    </div>
  );
}
