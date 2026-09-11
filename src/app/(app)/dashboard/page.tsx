'use client';

/**
 * Dashboard — React port of the legacy screen and its override layers:
 *   08-dashboard.js        hero, clock, KPIs, day bars, breakdown
 *   20-dashboard-stock.js  closing-stock table (latest entry ≤ selected date)
 *   25-crs-profile.js      shop card filled from the CRS master, YOU chip
 *   39-staff-roles.js      staff blocks hidden when the post is vacant
 *   28-crs29-dashboard.js  CRS 29 counts only its seven stocked commodities
 *   10-holidays.js         weekly + government holiday rules, calendar modal
 *
 * The monkey-patch layering collapses here: the same rules, expressed once.
 * Same layout, colours and copy as the legacy dashboard.
 */
import { useEffect, useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import HolidayCalendar from '@/components/HolidayCalendar';
import { useAuth } from '@/lib/authClient';
import { useStore, useUsers } from '@/lib/dataStore';
import { dashboardEntryView, type DayEntry } from '@/lib/engine/commodities';
import { useShops, useStockLists } from '@/lib/masters';
import { govtHolidayName, isWeeklyHoliday, weeklyHolidayName, type GovtHolidayMap } from '@/lib/engine/holidays';
import { describeActivity, type ActivityItem } from '@/lib/activity';
import { buildChainIndex, closingAsAt } from '@/lib/engine/stockChain';

/**
 * "Today, 10:42 AM" for today, otherwise a dated line. Times are rendered from
 * the stored UTC timestamp in the viewer's own zone, so a shop in Tamil Nadu
 * reads IST without the server having to know that.
 */
function fmtWhen(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  const t = d.toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit' });
  const today = new Date();
  const sameDay = d.toDateString() === today.toDateString();
  const yesterday = new Date(today.getTime() - 86400000).toDateString() === d.toDateString();
  if (sameDay) return `Today, ${t}`;
  if (yesterday) return `Yesterday, ${t}`;
  return `${d.toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' })}, ${t}`;
}

type MasterRec = { id: number; code: string; coll: boolean; police: boolean; status: string };
type ShopRec = { name: string };
type ReceiptRec = { id: number; crsId: number; date: string; receiptNo: string };

const pad2 = (n: number) => String(n).padStart(2, '0');
const dateStr = (d: Date) => `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;
const inr = (n: number) => '₹' + n.toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

const card: React.CSSProperties = {
  background: '#fff',
  borderRadius: 16,
  border: '1px solid #E2E8F0',
  boxShadow: '0 1px 8px rgba(0,0,0,.06)',
};
const sectionTitle = (grad: string, text: string) => (
  <div style={{ fontWeight: 800, fontSize: 14, color: '#1E293B', display: 'flex', alignItems: 'center', gap: 8 }}>
    <span style={{ width: 5, height: 18, background: grad, borderRadius: 3, display: 'inline-block' }} />
    {text}
  </div>
);

export default function DashboardPage() {
  const router = useRouter();
  const { user } = useAuth();
  const users = useUsers();
  const entryStore = useStore<Record<string, DayEntry>>('entryStore') ?? {};
  const receiptStore = useStore<ReceiptRec[]>('receiptStore') ?? [];
  const inspectionStore = useStore<Record<string, unknown>>('inspectionStore') ?? {};
  const master = useStore<MasterRec[]>('__crsMaster') ?? [];
  const shops: ShopRec[] = useShops();
  const holidays = useStore<GovtHolidayMap>('__holidays');

  const [selected, setSelected] = useState<Date>(() => new Date());
  const [clock, setClock] = useState({ time: '--:--:--', ampm: '--' });
  const [calOpen, setCalOpen] = useState(false);
  /** Real activity, scoped by the server to what this account may see. */
  const [activity, setActivity] = useState<ActivityItem[] | null>(null);
  const [activityErr, setActivityErr] = useState('');

  // Re-fetched when the signed-in account changes, because what may be seen
  // changes with it — an admin sees every shop, a shop only its own.
  useEffect(() => {
    let alive = true;
    fetch(`/api/activity?limit=12`, { headers: { Accept: 'application/json' } })
      .then(async (r) => {
        const b = await r.json().catch(() => ({}));
        if (!r.ok) throw new Error(b?.error || 'Could not load recent activity.');
        if (alive) setActivity(b.items ?? []);
      })
      .catch((e) => alive && setActivityErr(e instanceof Error ? e.message : String(e)));
    return () => { alive = false; };
  }, [user?.username, user?.role]);

  useEffect(() => {
    const tick = () => {
      const now = new Date();
      let h = now.getHours();
      const ampm = h >= 12 ? 'PM' : 'AM';
      h = h % 12 || 12;
      setClock({ time: `${h}:${pad2(now.getMinutes())}:${pad2(now.getSeconds())}`, ampm });
    };
    tick();
    const t = setInterval(tick, 1000);
    return () => clearInterval(t);
  }, []);

  const now = new Date();
  const todayStr = dateStr(now);
  const crsId = user?.crsId ?? null;
  const isAdmin = user?.role === 'ADMIN';
  const scopeId = crsId || 1;
  const lists = useStockLists(crsId);
  const allComms = [...lists.a, ...lists.b];

  const entryFor = (ds: string) => dashboardEntryView(crsId, entryStore[`${scopeId}_${ds}`]);

  // ── KPIs: working days entered / missed this month up to today ────────────
  const yr = now.getFullYear();
  const mo = now.getMonth() + 1;
  const toDay = now.getDate();
  const kpi = useMemo(() => {
    let withEntry = 0;
    let withoutEntry = 0;
    for (let d = 1; d <= toDay; d++) {
      const dd = new Date(yr, mo - 1, d);
      if (isWeeklyHoliday(dd)) continue;
      if (entryStore[`${scopeId}_${yr}-${pad2(mo)}-${pad2(d)}`]) withEntry++;
      else withoutEntry++;
    }
    return { withEntry, withoutEntry };
  }, [entryStore, scopeId, yr, mo, toDay]);

  const myReceipts = receiptStore.filter((r) => !crsId || r.crsId === crsId);
  const lastReceipt = myReceipts[myReceipts.length - 1];

  // ── Day bars ──────────────────────────────────────────────────────────────
  const dayData = useMemo(() => {
    const rows: { day: number; holiday: boolean; sales: number; hasEntry: boolean }[] = [];
    for (let d = 1; d <= toDay; d++) {
      const dd = new Date(yr, mo - 1, d);
      const entry = entryFor(`${yr}-${pad2(mo)}-${pad2(d)}`);
      let sales = 0;
      if (entry) {
        for (const rec of Object.values(entry.a ?? {})) sales += rec.sales || 0;
        for (const rec of Object.values(entry.b ?? {})) sales += rec.sales || 0;
      }
      rows.push({ day: d, holiday: isWeeklyHoliday(dd), sales, hasEntry: !!entry });
    }
    return rows;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [entryStore, scopeId, yr, mo, toDay, crsId]);
  const maxSales = Math.max(1, ...dayData.map((d) => d.sales));
  const barW = Math.max(12, Math.floor(555 / Math.max(dayData.length, 1)) - 3);

  // ── Selected-date breakdown ───────────────────────────────────────────────
  const selStr = dateStr(selected);
  const isTodaySel = selStr === todayStr;
  const selLabel = isTodaySel
    ? 'Today'
    : selected.toLocaleDateString('en-IN', { weekday: 'short', day: 'numeric', month: 'short' });
  const selEntry = entryFor(selStr);
  const breakdown = useMemo(() => {
    if (!selEntry) return { rows: [], amt: 0, qty: 0 };
    let amt = 0;
    let qty = 0;
    const rows: { ta: string; en: string; unit: string; rate: number; free: boolean; sales: number; amount: number }[] = [];
    for (const c of allComms) {
      const rec = selEntry.a?.[c.id] ?? selEntry.b?.[c.id];
      const sales = rec ? Number(rec.sales) || 0 : 0;
      if (sales <= 0) continue;
      const amount = c.free ? 0 : sales * c.rate;
      qty += sales;
      amt += amount;
      rows.push({ ta: c.ta, en: c.en, unit: c.unit, rate: c.rate, free: c.free, sales, amount });
    }
    return { rows, amt, qty };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selEntry, crsId]);

  // ── Closing stock ─────────────────────────────────────────────────────────
  /**
   * The stock card is its own view. A shop user is pinned to their own shop; an
   * administrator picks one here — or every shop at once — WITHOUT moving the
   * rest of the dashboard, which stays on their own scope. Before this, an
   * admin was hard-wired to CRS 1 (`crsId || 1`) with no way to look elsewhere.
   */
  const [stockCrs, setStockCrs] = useState<number | 'all'>(crsId ?? 1);
  // The signed-in account arrives after the first render.
  useEffect(() => {
    if (crsId) setStockCrs(crsId);
  }, [crsId]);
  const stockLists = useStockLists(stockCrs === 'all' ? null : stockCrs);

  /**
   * The newest day sheet on or before the selected date for one shop. The date
   * shape is checked because a bare `1_` prefix also matches CRS 1's monthly
   * keys, and a month key is not a stock position.
   */
  const latestKeyFor = (id: number): string | null => {
    const prefix = `${id}_`;
    let best: string | null = null;
    let bestDate = '';
    for (const k of Object.keys(entryStore)) {
      if (!k.startsWith(prefix)) continue;
      const dt = k.slice(prefix.length);
      if (!/^\d{4}-\d{2}-\d{2}$/.test(dt)) continue;
      if (dt <= selStr && dt > bestDate) {
        bestDate = dt;
        best = k;
      }
    }
    return best;
  };

  const latestKey = useMemo(
    () => (stockCrs === 'all' ? null : latestKeyFor(stockCrs)),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [entryStore, stockCrs, selStr],
  );

  /**
   * The date this position actually speaks for: the last day sheet, or a later
   * day a godown delivery landed on. Naming the sheet alone would date the
   * figure earlier than the movements now folded into it.
   */
  const stockAsOf = useMemo(() => {
    const sheetDate = latestKey?.split('_')[1] ?? '';
    if (stockCrs === 'all' || !sheetDate) return sheetDate;
    let latest = sheetDate;
    for (const r of receiptStore) {
      if (Number(r.crsId) !== stockCrs) continue;
      const d = String(r.date ?? '');
      if (/^\d{4}-\d{2}-\d{2}$/.test(d) && d > latest && d <= selStr) latest = d;
    }
    return latest;
  }, [latestKey, receiptStore, stockCrs, selStr]);

  /**
   * Each commodity's closing from the LATEST sheet — never the sum of every
   * day's closing, because closing is a balance, not a flow. Across all shops
   * it is the sum of each shop's own latest closing, which is a regional
   * position rather than one shop's.
   *
   * Derived from entryStore, so it follows a save with no refresh, and an old
   * sheet being edited or cleared re-points it automatically.
   */
  const stock = useMemo(() => {
    const closingFor = (id: number): Record<string, number> => {
      const key = latestKeyFor(id);
      // dashboardEntryView keeps CRS 29 to its own commodities, per shop.
      const e = key ? dashboardEntryView(id, entryStore[key]) : undefined;
      const out: Record<string, number> = {};
      if (!e) return out;
      // The latest sheet states the position AS OF ITS OWN DATE. A godown
      // delivery on a later day with no sheet moved stock since, and the
      // shop's Daily Entry already opens at the higher figure — so this walks
      // the same chain rather than showing a balance the entry screen
      // disagrees with. src/lib/engine/stockChain.ts.
      const ix = buildChainIndex(entryStore, inspectionStore, receiptStore, id);
      for (const sec of ['a', 'b'] as const) {
        for (const [cid, rec] of Object.entries(e[sec] ?? {})) {
          const carried = closingAsAt(ix, selStr, cid, sec).value;
          out[cid] = (out[cid] ?? 0) + (carried ?? (Number(rec.close) || 0));
        }
      }
      return out;
    };

    const totals: Record<string, number> = {};
    let shopsWithData = 0;
    if (stockCrs === 'all') {
      for (let id = 1; id <= shops.length; id++) {
        const c = closingFor(id);
        if (Object.keys(c).length) shopsWithData++;
        for (const [cid, v] of Object.entries(c)) totals[cid] = (totals[cid] ?? 0) + v;
      }
    } else {
      Object.assign(totals, closingFor(stockCrs));
      if (Object.keys(totals).length) shopsWithData = 1;
    }

    let inStock = 0;
    let outStock = 0;
    const rows = (comms: typeof stockLists.a) =>
      comms.map((c) => {
        const closing = totals[c.id] ?? 0;
        if (closing <= 0) outStock++;
        else inStock++;
        return { c, closing };
      });
    const a = rows(stockLists.a);
    const b = rows(stockLists.b);
    return { a, b, inStock, outStock, total: a.length + b.length, shopsWithData };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [entryStore, stockCrs, selStr, stockLists, shops.length]);

  // ── Shop card ─────────────────────────────────────────────────────────────
  const m = crsId ? master.find((r) => r.id === crsId) : null;
  const staffBC = crsId ? users.find((u) => u.crsId === crsId && u.role === 'BC' && u.active) : null;
  const staffPK = crsId ? users.find((u) => u.crsId === crsId && u.role === 'Packer' && u.active) : null;
  const isMe = (holder: typeof staffBC) =>
    !!holder && !!user && (holder.id === user.id || (!!holder.phone && !!user.phone && String(holder.phone) === String(user.phone)));

  const holToday = weeklyHolidayName(now) ?? govtHolidayName(now, holidays);

  const chip = (text: string, bg: string, fg: string) => (
    <span key={text} style={{ background: bg, color: fg, fontSize: 10, fontWeight: 800, padding: '3px 9px', borderRadius: 20, letterSpacing: '.03em' }}>
      {text}
    </span>
  );

  const staffBlock = (label: string, holder: typeof staffBC) =>
    holder ? (
      <div style={{ background: 'rgba(255,255,255,.12)', borderRadius: 10, padding: '10px 14px', outline: isMe(holder) ? '2px solid rgba(255,255,255,.7)' : undefined }}>
        <div style={{ color: 'rgba(255,255,255,.6)', fontSize: 10, textTransform: 'uppercase', letterSpacing: '.05em' }}>
          {label}
          {isMe(holder) ? (
            <span style={{ marginLeft: 7, background: '#fff', color: '#0369A1', fontSize: 9, fontWeight: 800, padding: '2px 7px', borderRadius: 20, letterSpacing: '.04em' }}>YOU</span>
          ) : null}
        </div>
        <div style={{ color: '#fff', fontWeight: 800, fontSize: 14, marginTop: 3 }}>{holder.fullName}</div>
        <div style={{ color: '#67E8F9', fontSize: 12, marginTop: 2 }}>{holder.phone}</div>
      </div>
    ) : (
      <div />
    );

  const quick = (href: string, icon: string, title: string, sub: string, grad: string, border: string, fg: string, subFg: string) => (
    <div
      key={href}
      onClick={() => router.push(href)}
      style={{ background: grad, border: `1px solid ${border}`, borderRadius: 14, padding: '18px 12px', textAlign: 'center', cursor: 'pointer', transition: '.2s' }}
    >
      <div style={{ fontSize: 28, marginBottom: 8 }}>{icon}</div>
      <div style={{ fontWeight: 700, fontSize: 12, color: fg }}>{title}</div>
      <div style={{ fontSize: 10, color: subFg, marginTop: 3 }}>{sub}</div>
    </div>
  );

  const adminQuick = (href: string, icon: string, title: string) => (
    <div
      key={href}
      onClick={() => router.push(href)}
      style={{ background: 'linear-gradient(135deg,#F8FAFC,#F1F5F9)', border: '1px solid #CBD5E1', borderRadius: 14, padding: '14px 12px', textAlign: 'center', cursor: 'pointer', transition: '.2s' }}
    >
      <div style={{ fontSize: 22, marginBottom: 6 }}>{icon}</div>
      <div style={{ fontWeight: 700, fontSize: 11, color: '#475569' }}>{title}</div>
    </div>
  );

  const tdStock = { padding: '6px 10px', borderBottom: '1px solid #F1F5F9' } as const;
  const thStock: React.CSSProperties = {
    position: 'sticky',
    top: 0,
    background: '#fff',
    zIndex: 1,
    padding: '7px 10px',
    fontSize: 10,
    fontWeight: 700,
    color: '#94A3B8',
    textTransform: 'uppercase',
    letterSpacing: '.05em',
    borderBottom: '2px solid #E2E8F0',
  };

  const tile = (label: string, val: number, color: string, bg: string) => (
    <div key={label} style={{ flex: 1, background: bg, borderRadius: 9, padding: '7px 10px', textAlign: 'center' }}>
      <div style={{ fontSize: 16, fontWeight: 900, color, lineHeight: 1.2 }}>{val}</div>
      <div style={{ fontSize: 9, fontWeight: 700, color: 'var(--muted)', textTransform: 'uppercase', letterSpacing: '.04em' }}>{label}</div>
    </div>
  );

  const stockRow = ({ c, closing }: { c: (typeof allComms)[number]; closing: number }, i: number) => {
    const out = closing <= 0;
    const bg = out ? '#FFFBEB' : i % 2 === 0 ? '#fff' : '#F8FAFC';
    const col = closing < 0 ? '#DC2626' : out ? '#B45309' : '#0369A1';
    return (
      <tr key={c.id} style={{ background: bg }}>
        <td style={{ ...tdStock, textAlign: 'left' }}>
          <span style={{ fontWeight: 600, fontSize: 11.5, color: '#1E293B' }}>{c.ta}</span>
          <span style={{ fontSize: 10, color: 'var(--muted)', marginLeft: 6 }}>{c.en}</span>
        </td>
        <td style={{ ...tdStock, textAlign: 'right', whiteSpace: 'nowrap', fontWeight: out ? 600 : 800, color: col, fontSize: 12 }}>
          {closing.toFixed(3)} <span style={{ fontSize: 9, fontWeight: 400, color: 'var(--muted)' }}>{c.unit}</span>
        </td>
      </tr>
    );
  };

  return (
    <div className="page active" id="page-dashboard">
      {/* ── HERO ── */}
      <div style={{ background: 'linear-gradient(135deg,#1B3A6B 0%,#1e4d9b 45%,#1565C0 100%)', borderRadius: 18, padding: '26px 28px 22px', marginBottom: 20, position: 'relative', overflow: 'hidden' }}>
        <div style={{ position: 'absolute', top: -40, right: -40, width: 200, height: 200, borderRadius: '50%', background: 'rgba(255,255,255,.05)' }} />
        <div style={{ position: 'absolute', bottom: -60, right: 120, width: 160, height: 160, borderRadius: '50%', background: 'rgba(255,255,255,.04)' }} />
        <div style={{ position: 'absolute', top: 10, left: '50%', width: 80, height: 80, borderRadius: '50%', background: 'rgba(255,255,255,.03)' }} />
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', flexWrap: 'wrap', gap: 16, position: 'relative', zIndex: 1 }}>
          <div style={{ flex: '1 1 200px', minWidth: 200 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 6 }}>
              <div style={{ background: 'rgba(255,255,255,.18)', borderRadius: 10, padding: '8px 11px', fontSize: 22, lineHeight: 1 }}>📊</div>
              <div>
                <div style={{ color: '#fff', fontWeight: 900, fontSize: 22, letterSpacing: '-.3px' }}>Dashboard</div>
                <div style={{ color: 'rgba(255,255,255,.7)', fontSize: 12, marginTop: 2 }}>
                  Welcome, {user?.fullName ?? ''} · {now.toLocaleDateString('en-IN', { month: 'long', year: 'numeric' })}
                </div>
              </div>
            </div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginTop: 10 }}>
              <div onClick={() => setCalOpen(true)} style={{ cursor: 'pointer', fontSize: 11 }}>
                {holToday ? (
                  <span style={{ color: '#FDBA74', fontSize: 11, fontWeight: 700 }}>🏕 Holiday</span>
                ) : (
                  <span style={{ color: '#4ADE80', fontSize: 11, fontWeight: 700 }}>✓ Working Day</span>
                )}
              </div>
            </div>
          </div>
          <div style={{ flex: '2 1 300px', minWidth: 260, display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 8 }}>
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src="/img/cm-tamilnadu.jpg"
              alt="Hon'ble Chief Minister of Tamil Nadu"
              style={{ width: 104, height: 130, borderRadius: '50%', objectFit: 'cover', border: '4px solid rgba(255,255,255,.85)', boxShadow: '0 4px 14px rgba(0,0,0,.3)', flexShrink: 0 }}
            />
            <div style={{ width: '100%', maxWidth: 700, overflow: 'hidden', padding: '5px 0' }}>
              <div className="dash-cm-marquee-track">
                <span style={{ color: '#fff', fontWeight: 800, fontSize: 12, letterSpacing: '.01em', padding: '0 24px', whiteSpace: 'nowrap' }}>
                  தமிழ்நாடு நுகர்பொருள் வாணிபக் கழகம் (Tamil Nadu Civil Supplies Corporation - TNCSC)
                </span>
                <span aria-hidden="true" style={{ color: '#fff', fontWeight: 800, fontSize: 12, letterSpacing: '.01em', padding: '0 24px', whiteSpace: 'nowrap' }}>
                  தமிழ்நாடு நுகர்பொருள் வாணிபக் கழகம் (Tamil Nadu Civil Supplies Corporation - TNCSC)
                </span>
              </div>
            </div>
          </div>
          <div style={{ flex: '1 1 200px', minWidth: 200, display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: 8 }}>
            <div style={{ background: 'rgba(255,255,255,.14)', backdropFilter: 'blur(6px)', border: '1px solid rgba(255,255,255,.22)', borderRadius: 12, padding: '10px 16px', textAlign: 'center', minWidth: 170 }}>
              <div style={{ fontSize: 9, color: 'rgba(255,255,255,.6)', textTransform: 'uppercase', letterSpacing: '.1em', marginBottom: 3 }}>CURRENT TIME</div>
              <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'center', gap: 4 }}>
                <div style={{ fontWeight: 900, fontSize: 22, color: '#fff', fontFamily: 'monospace', letterSpacing: '.06em' }}>{clock.time}</div>
                <div style={{ fontSize: 11, fontWeight: 800, color: '#93C5FD', letterSpacing: '.05em' }}>{clock.ampm}</div>
              </div>
              <div style={{ fontSize: 10, color: 'rgba(255,255,255,.5)', marginTop: 2 }}>
                {now.toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' })}
              </div>
            </div>
            <div style={{ background: 'rgba(255,255,255,.14)', backdropFilter: 'blur(6px)', border: '1px solid rgba(255,255,255,.22)', borderRadius: 12, padding: '8px 14px', display: 'flex', alignItems: 'center', gap: 8, minWidth: 170 }}>
              <span style={{ fontSize: 16 }}>📅</span>
              <div style={{ flex: 1 }}>
                <div style={{ fontSize: 9, color: 'rgba(255,255,255,.6)', textTransform: 'uppercase', letterSpacing: '.09em', marginBottom: 2 }}>VIEW DATE</div>
                <input
                  type="date"
                  value={selStr}
                  max={todayStr}
                  onChange={(e) => {
                    if (!e.target.value) return;
                    const [y, m, d] = e.target.value.split('-').map(Number);
                    setSelected(new Date(y, m - 1, d));
                  }}
                  style={{ border: 'none', outline: 'none', fontWeight: 700, fontSize: 12, color: '#fff', background: 'transparent', width: '100%', cursor: 'pointer', fontFamily: 'inherit', padding: 0, colorScheme: 'dark' }}
                />
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* Holiday notice */}
      {holToday ? (
        <div style={{ display: 'flex', marginBottom: 16, background: '#FFF7ED', border: '1px solid #FED7AA', borderRadius: 12, padding: '12px 18px', alignItems: 'center', gap: 10 }}>
          <span style={{ fontSize: 22 }}>🏪</span>
          <div>
            <div style={{ fontWeight: 700, color: '#C2410C', fontSize: 13 }}>Today is a {holToday}</div>
            <div style={{ fontSize: 11, color: '#9A3412' }}>1st &amp; 2nd Fridays holiday · 3rd &amp; 4th Sundays holiday</div>
          </div>
        </div>
      ) : null}

      {/* Shop card (CRS users) */}
      {crsId ? (
        <div style={{ marginBottom: 16 }}>
          <div style={{ background: 'linear-gradient(135deg,#0369A1,#0EA5E9)', borderRadius: 14, padding: '18px 22px' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 12, flexWrap: 'wrap', marginBottom: 10 }}>
              <div style={{ color: 'rgba(255,255,255,.6)', fontSize: 10, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '.08em' }}>Your Civil Ration Shop</div>
              <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                {m
                  ? [
                      m.coll ? chip('COLL statement', 'rgba(255,255,255,.9)', '#0369A1') : chip('No COLL', 'rgba(255,255,255,.16)', '#E0F2FE'),
                      m.police ? chip('Had Police', 'rgba(255,255,255,.9)', '#6D28D9') : chip('No Police', 'rgba(255,255,255,.16)', '#E0F2FE'),
                      m.status === 'active' ? chip('Active', '#DCFCE7', '#15803D') : chip('No Usage', '#FEF3C7', '#92400E'),
                    ]
                  : null}
              </div>
            </div>
            <div style={{ display: 'grid', gridTemplateColumns: 'auto 1fr 1fr', gap: 16, alignItems: 'center' }}>
              <div style={{ textAlign: 'center', minWidth: 150 }}>
                <div style={{ color: 'rgba(255,255,255,.6)', fontSize: 10 }}>CRS No.</div>
                <div style={{ color: '#fff', fontWeight: 900, fontSize: 28, lineHeight: 1, marginTop: 2 }}>CRS {crsId}</div>
                <div style={{ color: '#fff', fontWeight: 700, fontSize: 13, marginTop: 5 }}>{shops[crsId - 1]?.name ?? ''}</div>
                <div style={{ color: '#BAE6FD', fontSize: 11, fontFamily: 'monospace', marginTop: 2 }}>{m?.code ?? ''}</div>
              </div>
              {staffBlock('Bill Clerk (BC)', staffBC)}
              {staffBlock('Packer', staffPK)}
            </div>
          </div>
        </div>
      ) : null}

      {/* ── KPI CARDS ── */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3,1fr)', gap: 14, marginBottom: 20 }}>
        <div style={{ ...card, padding: '20px 22px', display: 'flex', alignItems: 'center', gap: 16 }}>
          <div style={{ width: 56, height: 56, borderRadius: 14, background: 'linear-gradient(135deg,#D1FAE5,#A7F3D0)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 26, flexShrink: 0 }}>📋</div>
          <div>
            <div style={{ fontWeight: 900, fontSize: 32, lineHeight: 1, color: '#059669' }}>{kpi.withEntry}</div>
            <div style={{ fontWeight: 700, fontSize: 13, color: '#1E293B', marginTop: 3 }}>Entries This Month</div>
            <div style={{ fontSize: 11, color: '#94A3B8', marginTop: 1 }}>Working days entered</div>
          </div>
        </div>
        <div style={{ ...card, padding: '20px 22px', display: 'flex', alignItems: 'center', gap: 16 }}>
          <div style={{ width: 56, height: 56, borderRadius: 14, background: 'linear-gradient(135deg,#FEE2E2,#FECACA)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 26, flexShrink: 0 }}>📅</div>
          <div>
            <div style={{ fontWeight: 900, fontSize: 32, lineHeight: 1, color: '#DC2626' }}>{kpi.withoutEntry}</div>
            <div style={{ fontWeight: 700, fontSize: 13, color: '#1E293B', marginTop: 3 }}>Days Without Entry</div>
            <div style={{ fontSize: 11, color: '#94A3B8', marginTop: 1 }}>Working days missed</div>
          </div>
        </div>
        <div onClick={() => router.push('/receipt')} style={{ ...card, padding: '20px 22px', display: 'flex', alignItems: 'center', gap: 16, cursor: 'pointer' }}>
          <div style={{ width: 56, height: 56, borderRadius: 14, background: 'linear-gradient(135deg,#E0F2FE,#BAE6FD)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 26, flexShrink: 0 }}>🧾</div>
          <div>
            <div style={{ fontWeight: 900, fontSize: 32, lineHeight: 1, color: '#0369A1' }}>{myReceipts.length}</div>
            <div style={{ fontWeight: 700, fontSize: 13, color: '#1E293B', marginTop: 3 }}>Receipt Dates</div>
            <div style={{ fontSize: 11, color: '#0284C7', fontWeight: 600, marginTop: 1 }}>
              {lastReceipt ? `Last: ${lastReceipt.date} → View` : 'Click to view →'}
            </div>
          </div>
        </div>
      </div>

      {/* ── QUICK ACTIONS ── */}
      <div style={{ ...card, padding: '20px 22px', marginBottom: 20 }}>
        <div style={{ marginBottom: 14 }}>{sectionTitle('linear-gradient(180deg,#1B3A6B,#2563EB)', 'Quick Actions')}</div>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4,1fr)', gap: 12 }}>
          {quick('/daily-entry', '📝', 'Daily Entry', "Record today's sales", 'linear-gradient(135deg,#EFF6FF,#DBEAFE)', '#BAE6FD', '#1D4ED8', '#60A5FA')}
          {quick('/monthly-entry', '📅', 'Monthly Entry', 'Monthly totals & remittance', 'linear-gradient(135deg,#F0FDF4,#DCFCE7)', '#86EFAC', '#15803D', '#4ADE80')}
          {quick('/receipt', '🧾', 'Receipt', 'Godown receipts', 'linear-gradient(135deg,#FFFBEB,#FEF3C7)', '#FDE68A', '#B45309', '#FCD34D')}
          {quick('/statements', '📄', 'Statement', 'Generate reports', 'linear-gradient(135deg,#FDF4FF,#FAE8FF)', '#E879F9', '#7E22CE', '#C084FC')}
        </div>
        {isAdmin ? (
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4,1fr)', gap: 12, marginTop: 12 }}>
            {adminQuick('/crs', '🏪', 'CRS Shops')}
            {adminQuick('/commodities', '🧺', 'Commodities')}
            {adminQuick('/users', '👥', 'Users')}
            {adminQuick('/reports', '📈', 'Reports')}
          </div>
        ) : null}
      </div>

      {/* ── MAIN GRID ── */}
      <div style={{ display: 'grid', gridTemplateColumns: 'minmax(598px,3fr) minmax(0,2fr)', gap: 16, marginBottom: 16 }}>
        {/* Sales chart + breakdown */}
        <div style={{ ...card, overflow: 'hidden' }}>
          <div style={{ padding: '16px 20px 12px', display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', borderBottom: '1px solid #F1F5F9' }}>
            <div>
              {sectionTitle('linear-gradient(180deg,#0EA5E9,#38BDF8)', 'Current Month Sales — Quantity')}
              <div style={{ fontSize: 11, color: '#94A3B8', marginTop: 3 }}>
                {now.toLocaleDateString('en-IN', { month: 'long', year: 'numeric' })} — daily qty
              </div>
            </div>
            <div style={{ textAlign: 'right' }}>
              <div style={{ fontSize: 10, color: '#94A3B8', textTransform: 'uppercase', letterSpacing: '.05em' }}>{selLabel}</div>
              <div style={{ fontWeight: 900, fontSize: 20, color: '#16A34A', lineHeight: 1.1 }}>{inr(breakdown.amt)}</div>
              <div style={{ fontSize: 11, color: '#94A3B8' }}>{breakdown.qty.toFixed(3)} kg total</div>
            </div>
          </div>
          <div style={{ padding: '14px 18px 6px' }}>
            <div style={{ overflowX: 'auto' }}>
              <div style={{ display: 'flex', alignItems: 'flex-end', gap: 3, height: 100, minWidth: 560 }}>
                {dayData.map((d) => {
                  const h = d.holiday ? 6 : d.sales ? Math.max(8, Math.round((d.sales / maxSales) * 96)) : 6;
                  const bg = d.holiday ? '#F1F5F9' : d.hasEntry ? 'linear-gradient(180deg,#0EA5E9,#0369A1)' : '#FEE2E2';
                  const isSel = selected.getDate() === d.day && selected.getMonth() === mo - 1 && selected.getFullYear() === yr;
                  return (
                    <div
                      key={d.day}
                      onClick={() => setSelected(new Date(yr, mo - 1, d.day))}
                      style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', flex: `0 0 ${barW}px`, cursor: 'pointer' }}
                      title={`Day ${d.day}${d.holiday ? ': Holiday' : `: ${d.sales.toFixed(1)} kg`}`}
                    >
                      <div
                        style={{
                          height: h,
                          width: barW,
                          background: bg,
                          borderRadius: '3px 3px 0 0',
                          outline: isSel ? '2px solid #D97706' : undefined,
                          outlineOffset: isSel ? 2 : undefined,
                          border: d.holiday ? '1px dashed #CBD5E1' : undefined,
                          transition: '.15s',
                        }}
                      />
                    </div>
                  );
                })}
              </div>
              <div style={{ display: 'flex', gap: 3, minWidth: 560, marginTop: 3 }}>
                {dayData.map((d) => {
                  const isSel = selected.getDate() === d.day && selected.getMonth() === mo - 1 && selected.getFullYear() === yr;
                  return (
                    <div
                      key={d.day}
                      onClick={() => setSelected(new Date(yr, mo - 1, d.day))}
                      style={{
                        flex: `0 0 ${barW}px`,
                        textAlign: 'center',
                        fontSize: 8,
                        color: d.holiday ? '#CBD5E1' : d.hasEntry ? '#0369A1' : '#EF4444',
                        fontWeight: isSel ? 900 : 600,
                        cursor: 'pointer',
                        textDecoration: isSel ? 'underline' : undefined,
                        textUnderlineOffset: isSel ? 2 : undefined,
                      }}
                    >
                      {d.day}
                    </div>
                  );
                })}
              </div>
            </div>
            <div style={{ display: 'flex', gap: 14, marginTop: 10, fontSize: 11, color: '#94A3B8' }}>
              <span style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
                <span style={{ width: 11, height: 11, borderRadius: 3, background: '#0EA5E9', display: 'inline-block' }} />
                Entry done
              </span>
              <span style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
                <span style={{ width: 11, height: 11, borderRadius: 3, background: '#FEE2E2', border: '1px dashed #FCA5A5', display: 'inline-block' }} />
                No entry
              </span>
              <span style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
                <span style={{ width: 11, height: 11, borderRadius: 3, background: '#F1F5F9', border: '1px dashed #CBD5E1', display: 'inline-block' }} />
                Holiday
              </span>
            </div>
          </div>
          <div style={{ borderTop: '1px solid #F1F5F9', padding: '12px 18px' }}>
            <div style={{ fontSize: 10, fontWeight: 700, color: '#94A3B8', textTransform: 'uppercase', letterSpacing: '.05em', marginBottom: 8 }}>
              {selLabel} — Commodity Breakdown
            </div>
            <div style={{ maxHeight: 200, overflowY: 'auto' }}>
              {!selEntry ? (
                <div style={{ color: 'var(--muted)', fontSize: 12, textAlign: 'center', padding: 14 }}>
                  {isWeeklyHoliday(selected) ? '🏕 Holiday — no entry' : `No entry for ${selLabel}`}
                </div>
              ) : breakdown.rows.length === 0 ? (
                <div style={{ color: 'var(--muted)', fontSize: 12, textAlign: 'center', padding: 14 }}>No sales data for {selLabel}</div>
              ) : (
                breakdown.rows.map((r) => (
                  <div key={r.en} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '7px 0', borderBottom: '1px solid #F0F9FF', gap: 8 }}>
                    <div style={{ minWidth: 0 }}>
                      <span style={{ fontWeight: 600, fontSize: 12 }}>{r.ta}</span>
                      <span style={{ color: 'var(--muted)', fontSize: 11, marginLeft: 6 }}>{r.en}</span>
                    </div>
                    <div style={{ textAlign: 'right', flexShrink: 0, fontSize: 12 }}>
                      <span style={{ fontWeight: 700, color: '#0369A1' }}>
                        {r.sales.toFixed(3)} {r.unit}
                      </span>
                      <span style={{ color: 'var(--muted)', margin: '0 4px' }}>×</span>
                      {r.free ? (
                        <span style={{ color: '#16A34A', fontWeight: 700 }}>Free = விலையில்லா</span>
                      ) : (
                        <>
                          <span style={{ color: '#374151' }}>
                            ₹{r.rate.toFixed(2)} × {r.sales.toFixed(3)}
                          </span>{' '}
                          = <strong style={{ color: '#0369A1' }}>{inr(r.amount)}</strong>
                        </>
                      )}
                    </div>
                  </div>
                ))
              )}
            </div>
          </div>
        </div>

        {/* Closing stock */}
        <div style={{ ...card, overflow: 'hidden' }}>
          <div style={{ padding: '16px 20px 12px', display: 'flex', justifyContent: 'space-between', alignItems: 'center', borderBottom: '1px solid #F1F5F9' }}>
            {sectionTitle('linear-gradient(180deg,#F59E0B,#FBBF24)', 'Closing Stock')}
            <span style={{ fontSize: 20 }}>📦</span>
          </div>
          {/* Only an administrator chooses; a shop user is pinned to their own
              shop and never offered another. */}
          {isAdmin ? (
            <div style={{ padding: '12px 18px 0' }}>
              <label className="form-label" style={{ display: 'block', marginBottom: 5 }}>CRS SHOP</label>
              <select
                value={String(stockCrs)}
                onChange={(e) => setStockCrs(e.target.value === 'all' ? 'all' : Number(e.target.value))}
                style={{ width: '100%', border: '1px solid var(--border)', borderRadius: 8, padding: '7px 10px', fontSize: 12 }}
              >
                {shops.map((s, i) => (
                  <option key={i + 1} value={String(i + 1)}>
                    CRS {i + 1} — {s.name}
                  </option>
                ))}
                <option value="all">All CRS Shops — combined position</option>
              </select>
            </div>
          ) : null}
          <div style={{ fontSize: 10, color: '#94A3B8', padding: '8px 18px 0', fontStyle: 'italic' }}>
            {stockCrs === 'all'
              ? stock.shopsWithData
                ? `Combined latest stock across ${stock.shopsWithData} shop${stock.shopsWithData === 1 ? '' : 's'} with entries, on or before ${selStr.split('-').reverse().join('-')}`
                : `No stock entry available yet for any shop on or before ${selStr.split('-').reverse().join('-')}`
              : latestKey
                ? `Stock as of: ${stockAsOf.split('-').reverse().join('-')}${
                    stockAsOf !== latestKey.split('_')[1]
                      ? ` — last day sheet ${latestKey.split('_')[1].split('-').reverse().join('-')}, plus godown receipts since`
                      : ''
                  }`
                : `No stock entry available yet — nothing keyed on or before ${selStr.split('-').reverse().join('-')}, values default to 0`}
          </div>
          <div style={{ padding: '10px 18px 16px' }}>
            <div style={{ maxHeight: 430, overflowY: 'auto', border: '1px solid #F1F5F9', borderRadius: 10 }}>
              <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                <thead>
                  <tr>
                    <th style={{ ...thStock, textAlign: 'left' }}>Commodity</th>
                    <th style={{ ...thStock, textAlign: 'right' }}>Closing Stock</th>
                  </tr>
                </thead>
                <tbody>
                  {stock.a.map(stockRow)}
                  {stock.b.length ? (
                    <tr>
                      <td
                        colSpan={2}
                        style={{ padding: '7px 10px 4px', fontSize: 9.5, fontWeight: 800, color: '#7C3AED', textTransform: 'uppercase', letterSpacing: '.07em', background: '#FAF5FF', borderBottom: '1px solid #EDE9FE' }}
                      >
                        காவலர் — Police Ration
                      </td>
                    </tr>
                  ) : null}
                  {stock.b.map(stockRow)}
                </tbody>
              </table>
            </div>
            <div style={{ display: 'flex', gap: 8, marginTop: 10 }}>
              {tile('Total Commodities', stock.total, '#1E293B', '#F1F5F9')}
              {tile('In Stock', stock.inStock, '#15803D', '#F0FDF4')}
              {tile('Out of Stock', stock.outStock, '#B45309', '#FFFBEB')}
            </div>
          </div>
        </div>
      </div>

      {/* ── RECENT ACTIVITY ── */}
      <div style={{ ...card, overflow: 'hidden' }}>
        <div style={{ padding: '16px 20px', borderBottom: '1px solid #F1F5F9', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          {sectionTitle('linear-gradient(180deg,#8B5CF6,#A78BFA)', 'Recent Activity')}
          <span style={{ fontSize: 20 }}>🕐</span>
        </div>
        <div style={{ padding: '12px 18px' }}>
          {activityErr ? (
            <div style={{ fontSize: 12, color: '#B91C1C' }}>{activityErr}</div>
          ) : activity === null ? (
            <div style={{ fontSize: 12, color: 'var(--muted)' }}>Loading recent activity…</div>
          ) : activity.length === 0 ? (
            <div style={{ fontSize: 12, color: 'var(--muted)' }}>
              {isAdmin
                ? 'Nothing saved yet. Activity from every shop appears here.'
                : 'Nothing recorded for this shop yet. Saving a day sheet or a receipt will show up here.'}
            </div>
          ) : (
            activity.map((a) => (
              <div className="activity-item" key={a.id}>
                <div className="activity-dot" />
                <div>
                  <div className="activity-text">
                    <strong>{a.actor}</strong> — {describeActivity(a)}
                  </div>
                  <div className="activity-time">{fmtWhen(a.at)}</div>
                </div>
              </div>
            ))
          )}
        </div>
      </div>

      {calOpen ? <HolidayCalendar holidays={holidays} onClose={() => setCalOpen(false)} /> : null}
    </div>
  );
}
