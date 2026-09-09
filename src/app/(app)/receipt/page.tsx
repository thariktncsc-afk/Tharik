'use client';

/**
 * Receipt Register — React port of the legacy screen and its layers:
 *   09-receipt.js             form, packing calculator, log
 *   33-receipt-type.js        Regular / Advance type (COLL counts Regular only)
 *   35-receipt-commodities.js Empty Card+Box / Polythene Bag are not receipts
 *   27-crs29-entry.js         CRS 29 keys only its own commodity list
 *
 * Packing rules are the engine's: GUNNY ÷50, C.BOX ÷10 (palm) or ÷50,
 * POLY ÷50 (sugar) or ÷25 (salt); Wheat/RRA/NPHH-RRA/PB-BRA can switch
 * GUNNY ↔ POLY. Counts and pack-quantities are editable and stop mirroring
 * once hand-edited, exactly like the legacy inputs.
 *
 * One deliberate fix over the legacy save: the stored quantity is the pack
 * quantity when present, else the entered quantity — the legacy collector
 * read every input in DOM order, so a cleared pack-qty could silently store
 * the bag COUNT as the received quantity.
 */
import { useMemo, useRef, useState } from 'react';
import { crsData, useStore } from '@/lib/dataStore';
import { appAlert, appConfirm } from '@/components/dialog';
import { commodityListsFor, useCommodityLists, useCommodityMaster, useShops } from '@/lib/masters';
import { useAuth } from '@/lib/authClient';
import { CRS29_STOCK, DSS_A, DSS_B, isCrs29, type Commodity, type DayEntry } from '@/lib/engine/commodities';
import { type MonthlyBlock, type SourceBlock } from '@/lib/engine/monthlyRollup';
import { type ReceiptRow } from '@/lib/engine/receiptRollup';
import { resyncReceiptMonth } from '@/lib/engine/receiptSync';

type ShopRec = { name: string };
type ReceiptRec = {
  id: number;
  crsId: number;
  date: string;
  receiptNo: string;
  items: Record<string, { qty: number }>;
  savedAt: string;
  type?: 'regular' | 'advance';
};

type PackType = 'GUNNY' | 'CBOX' | 'POLY';
type PackRule = { type: PackType; div: number; countLabel: string; qtyLabel: string };

const PACK_RULES: Record<string, PackRule> = {
  BRA: { type: 'GUNNY', div: 50, countLabel: 'bags', qtyLabel: 'kgs' },
  NPHH_FRK: { type: 'GUNNY', div: 50, countLabel: 'bags', qtyLabel: 'kgs' },
  PHH_FRK: { type: 'GUNNY', div: 50, countLabel: 'bags', qtyLabel: 'kgs' },
  AAY_FRK: { type: 'GUNNY', div: 50, countLabel: 'bags', qtyLabel: 'kgs' },
  AAY: { type: 'GUNNY', div: 50, countLabel: 'bags', qtyLabel: 'kgs' },
  OAP: { type: 'GUNNY', div: 50, countLabel: 'bags', qtyLabel: 'kgs' },
  APS: { type: 'GUNNY', div: 50, countLabel: 'bags', qtyLabel: 'kgs' },
  TOOR: { type: 'GUNNY', div: 50, countLabel: 'bags', qtyLabel: 'kgs' },
  PHH_BRA: { type: 'GUNNY', div: 50, countLabel: 'bags', qtyLabel: 'kgs' },
  WHEAT: { type: 'GUNNY', div: 50, countLabel: 'bags', qtyLabel: 'kgs' },
  RRA: { type: 'GUNNY', div: 50, countLabel: 'bags', qtyLabel: 'kgs' },
  NPHH_RRA: { type: 'GUNNY', div: 50, countLabel: 'bags', qtyLabel: 'kgs' },
  PALM: { type: 'CBOX', div: 10, countLabel: 'boxes', qtyLabel: 'pkts' },
  OOTY: { type: 'CBOX', div: 50, countLabel: 'boxes', qtyLabel: 'pkts' },
  TAN: { type: 'CBOX', div: 50, countLabel: 'boxes', qtyLabel: 'pkts' },
  SUGAR: { type: 'POLY', div: 50, countLabel: 'poly', qtyLabel: 'kgs' },
  AAY_SUGAR: { type: 'POLY', div: 50, countLabel: 'poly', qtyLabel: 'kgs' },
  SALT_CIS: { type: 'POLY', div: 25, countLabel: 'poly', qtyLabel: 'pkts' },
  SALT_RFFS: { type: 'POLY', div: 25, countLabel: 'poly', qtyLabel: 'pkts' },
  PB_BRA: { type: 'GUNNY', div: 50, countLabel: 'bags', qtyLabel: 'kgs' },
  PB_WHEAT: { type: 'GUNNY', div: 50, countLabel: 'bags', qtyLabel: 'kgs' },
  PB_TOOR: { type: 'GUNNY', div: 50, countLabel: 'bags', qtyLabel: 'kgs' },
  PB_SUGAR: { type: 'POLY', div: 50, countLabel: 'poly', qtyLabel: 'kgs' },
  PB_PALM: { type: 'CBOX', div: 10, countLabel: 'boxes', qtyLabel: 'pkts' },
};
const SWITCHABLE = new Set(['WHEAT', 'RRA', 'NPHH_RRA', 'PB_BRA']);
const EXCLUDED = new Set(['EMPTY_BOX', 'EMPTY_BAG']);

const PACK_COLORS: Record<PackType, { bg: string; border: string; text: string; badge: string; label: string; countLabel: string; qtyLabel: string }> = {
  GUNNY: { bg: '#FEF9C3', border: '#FDE047', text: '#854D0E', badge: '#F59E0B', label: 'Gunny', countLabel: 'bags', qtyLabel: 'kgs' },
  CBOX: { bg: '#FEE2E2', border: '#FCA5A5', text: '#991B1B', badge: '#EF4444', label: 'C.Box', countLabel: 'boxes', qtyLabel: 'pkts' },
  POLY: { bg: '#DCFCE7', border: '#86EFAC', text: '#14532D', badge: '#16A34A', label: 'Poly', countLabel: 'poly', qtyLabel: 'kgs' },
};

type RowState = { qty: string; type: PackType; count: string; countManual: boolean; packQty: string; packQtyManual: boolean };
const emptyRow = (id: string): RowState => ({ qty: '', type: PACK_RULES[id]?.type ?? 'GUNNY', count: '', countManual: false, packQty: '', packQtyManual: false });

// Receipt rows come from the database commodity master (via useCommodityLists),
// minus the two empties the shop returns rather than receives.

const todayIso = () => new Date().toISOString().split('T')[0];

export default function ReceiptPage() {
  const { user } = useAuth();
  const shops: ShopRec[] = useShops();
  const receiptStore = useStore<ReceiptRec[]>('receiptStore') ?? [];
  const counters = useStore<Record<string, number>>('__counters') ?? {};

  const isCrsUser = !!user?.crsId && user.role !== 'ADMIN';
  const shopIds = isCrsUser ? [user!.crsId as number] : shops.map((_, i) => i + 1);
  const shopLabel = (id: number) => `CRS ${id} — ${shops[id - 1]?.name ?? ''}`;

  const [formOpen, setFormOpen] = useState(false);
  const [crsVal, setCrsVal] = useState(isCrsUser ? String(user!.crsId) : '');
  const [date, setDate] = useState(todayIso());
  const [receiptNo, setReceiptNo] = useState('');
  const [rcpType, setRcpType] = useState<'regular' | 'advance'>('regular');
  const [rows, setRows] = useState<Record<string, RowState>>({});
  const [banner, setBanner] = useState('');
  const [filterCrs, setFilterCrs] = useState(isCrsUser ? String(user!.crsId) : '');
  const [filterMonth, setFilterMonth] = useState(() => todayIso().slice(0, 7));

  const formCrsId = crsVal ? Number(crsVal) : null;
  const formLists = useCommodityLists(formCrsId);
  const comms = useMemo(() => [...formLists.a, ...formLists.b].filter((c) => !EXCLUDED.has(c.id)), [formLists]);
  const commodityMaster = useCommodityMaster();

  /**
   * Republish one shop-month after the register changed.
   *
   * Receipts now fill the Receipt column of Daily Entry and roll into the
   * month (src/lib/engine/receiptRollup.ts), so monthlyStore is stale the
   * moment a receipt is saved or deleted. Rebuilding here means Monthly Entry
   * and the statements are correct straight away instead of waiting for
   * someone to open that date in Daily Entry and press Save.
   *
   * Stores are re-read rather than closed over: this runs after a confirm
   * dialog and after crsData.set, so the snapshot in render is already old.
   */
  const republishMonth = (rCrsId: number, dateIso: string, before?: ReceiptRow[]) => {
    const [y, m] = dateIso.split('-').map(Number);
    if (!rCrsId || !y || !m) return;

    // Everything downstream of the register — the day sheet, the manual
    // month's copy of the figure, the published month and a monthly-keyed
    // month's projected sheet — is brought back in step in one place, shared
    // with the approved-clear path so both leave the data identical.
    const patch = resyncReceiptMonth(
      {
        entryStore: crsData.get<Record<string, DayEntry>>('entryStore') ?? {},
        inspectionStore: crsData.get('inspectionStore') ?? {},
        meManualStore: crsData.get<Record<string, Partial<MonthlyBlock>>>('meManualStore') ?? {},
        meSourceStore: crsData.get<Record<string, SourceBlock>>('meSourceStore') ?? {},
        monthlyStore: crsData.get<Record<string, MonthlyBlock>>('monthlyStore') ?? {},
        receiptStore: crsData.get<ReceiptRow[]>('receiptStore') ?? [],
      },
      rCrsId,
      m,
      y,
      { dateIso, before, lists: commodityListsFor(commodityMaster, rCrsId) },
    );
    for (const [store, value] of Object.entries(patch)) crsData.set(store as never, value as never);
  };

  /**
   * What to say when the server refused the write.
   *
   * The data layer has already taken the stored copy back, so the register on
   * screen is the truth again — which is the point: a shop user's delete needs
   * an administrator's approval, and before this the row simply vanished from
   * the page while staying in the database. Daily and Monthly went on showing
   * the receipt, which looked like a sync bug and was the opposite.
   *
   * No auto-dismiss: a refusal the reader missed is a refusal they will act on
   * as though it were a success.
   */
  const refusal = (what: string) => `⚠ ${what}. ${crsData.lastError || 'The server refused the change.'}`;

  /**
   * Enter walks down the QTY RECEIVED column — type, Enter, type, Enter — so a
   * whole godown receipt can be keyed without reaching for the mouse. Same
   * handling Daily Entry has had (`data-nav` there), and the reason is the
   * same: most rows on a receipt are left blank, so the run down the column is
   * the fast path.
   *
   * ONLY the quantity boxes carry the marker. The packing counts beside them
   * are auto-calculated from the quantity, and stopping at each one would put
   * four keystrokes between one commodity and the next. Tab is untouched and
   * still walks everything in the ordinary browser order, so the packing boxes
   * remain reachable for the rows that need hand-correcting.
   *
   * On the last commodity there is nowhere further down, so focus moves to
   * Save — the next thing the clerk was going to do. It is focused, not
   * pressed; saving still takes a deliberate keystroke.
   */
  const qtyRef = useRef<HTMLTableSectionElement>(null);
  const saveRef = useRef<HTMLButtonElement>(null);
  const qtyKey = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key !== 'Enter') return;
    e.preventDefault();
    const boxes = Array.from(
      qtyRef.current?.querySelectorAll<HTMLInputElement>('input[data-qty]:not([disabled]):not([readonly])') ?? [],
    );
    const at = boxes.indexOf(e.currentTarget);
    const next = at === -1 ? undefined : boxes[at + 1];
    if (next) {
      next.focus();
      next.select();
    } else {
      saveRef.current?.focus();
    }
  };

  const setRow = (id: string, patch: Partial<RowState>) =>
    setRows((prev) => ({ ...prev, [id]: { ...(prev[id] ?? emptyRow(id)), ...patch } }));

  const onQty = (c: Commodity, val: string) => {
    const rule = PACK_RULES[c.id];
    const r = rows[c.id] ?? emptyRow(c.id);
    const qty = parseFloat(val) || 0;
    const patch: Partial<RowState> = { qty: val };
    if (rule) {
      if (!r.countManual) patch.count = qty ? String(Math.floor(qty / rule.div)) : '';
      if (!r.packQtyManual) patch.packQty = qty ? qty.toFixed(3) : '';
    }
    setRow(c.id, patch);
  };

  const onCount = (c: Commodity, val: string) => {
    const rule = PACK_RULES[c.id];
    const r = rows[c.id] ?? emptyRow(c.id);
    const cnt = parseFloat(val) || 0;
    const patch: Partial<RowState> = { count: val, countManual: true };
    if (rule && !r.packQtyManual) patch.packQty = cnt ? (cnt * rule.div).toFixed(3) : '';
    setRow(c.id, patch);
  };

  const onPackQty = (c: Commodity, val: string) => {
    const rule = PACK_RULES[c.id];
    const r = rows[c.id] ?? emptyRow(c.id);
    const qty = parseFloat(val) || 0;
    const patch: Partial<RowState> = { packQty: val, packQtyManual: true };
    if (rule && !r.countManual) patch.count = qty ? String(Math.round(qty / rule.div)) : '';
    setRow(c.id, patch);
  };

  const toggleType = (id: string) => {
    const r = rows[id] ?? emptyRow(id);
    setRow(id, { type: r.type === 'GUNNY' ? 'POLY' : 'GUNNY' });
  };

  const openForm = () => {
    setRows({});
    setRcpType('regular');
    setDate(todayIso());
    setReceiptNo('');
    setFormOpen(true);
  };

  const save = async () => {
    const crsId = Number(crsVal);
    if (!crsId) {
      void appAlert('Please select a CRS shop.');
      return;
    }
    if (!date) {
      void appAlert('Please select a date.');
      return;
    }
    const items: Record<string, { qty: number }> = {};
    for (const c of comms) {
      const r = rows[c.id];
      if (!r) continue;
      const packQty = parseFloat(r.packQty) || 0;
      const mainQty = parseFloat(r.qty) || 0;
      const qty = PACK_RULES[c.id] && packQty > 0 ? packQty : mainQty;
      if (qty > 0) items[c.id] = { qty };
    }
    if (!Object.keys(items).length) {
      void appAlert('Enter at least one commodity quantity.');
      return;
    }

    const nextId = (counters.rpNextId as number) || receiptStore.reduce((m, r) => Math.max(m, r.id), 0) + 1 || 1;
    const rec: ReceiptRec = {
      id: nextId,
      crsId,
      date,
      receiptNo: receiptNo.trim() || `R/${new Date().getFullYear()}/${String(nextId + 1).padStart(3, '0')}`,
      items,
      savedAt: new Date().toLocaleString('en-IN'),
      type: rcpType,
    };
    const beforeSave = receiptStore;
    crsData.set('receiptStore', [...receiptStore, rec]);
    crsData.update<Record<string, number>>('__counters', (d) => {
      d.rpNextId = nextId + 1;
    });
    republishMonth(crsId, date, beforeSave);
    if (!(await crsData.save())) {
      setBanner(refusal('Receipt not saved'));
      return;
    }
    setFormOpen(false);
    setBanner('✓ Receipt saved — Daily and Monthly Entry updated.');
    setTimeout(() => setBanner(''), 4000);
  };

  /** Clear one commodity's row in the form (qty, packing and manual flags). */
  const clearRow = (id: string) =>
    setRows((prev) => {
      const next = { ...prev };
      delete next[id];
      return next;
    });

  /** Remove ONE commodity from a saved receipt (deletes the receipt when it was the last one). */
  const deleteItem = async (rec: ReceiptRec, commId: string) => {
    const qty = rec.items[commId]?.qty ?? 0;
    const last = Object.keys(rec.items).length === 1;
    const ok = await appConfirm({
      title: 'Remove commodity from receipt',
      tone: 'danger',
      confirmLabel: 'Remove',
      message:
        `Remove ${commName(commId)} (${Number(qty).toFixed(3)}) from receipt ${rec.receiptNo}?` +
        (last ? '\n\nIt is the only commodity on this receipt — the whole receipt will be deleted.' : '') +
        '\n\nThis cannot be undone.',
    });
    if (!ok) return;
    // Re-read after the dialog: the receipt may have changed (or gone) while
    // the confirm sat open, and the last-commodity rule must use the truth.
    const store = crsData.get<ReceiptRec[]>('receiptStore') ?? [];
    const fresh = store.find((x) => x.id === rec.id);
    if (!fresh || fresh.items[commId] === undefined) {
      setBanner(`⚠ Receipt ${rec.receiptNo} changed while confirming — nothing removed. Check the list and retry.`);
      setTimeout(() => setBanner(''), 4000);
      return;
    }
    const lastNow = Object.keys(fresh.items).length === 1;
    if (lastNow) {
      crsData.set('receiptStore', store.filter((x) => x.id !== rec.id));
      setBanner(`✓ Receipt ${rec.receiptNo} deleted (last commodity removed).`);
    } else {
      crsData.set(
        'receiptStore',
        store.map((x) => {
          if (x.id !== rec.id) return x;
          const items = { ...x.items };
          delete items[commId];
          return { ...x, items };
        }),
      );
      setBanner(`✓ ${commName(commId)} removed from receipt ${rec.receiptNo}.`);
    }
    republishMonth(Number(rec.crsId), rec.date, store);
    if (!(await crsData.save())) {
      setBanner(refusal('Nothing was removed'));
      return;
    }
    setTimeout(() => setBanner(''), 4000);
  };

  /** Delete a saved receipt from the register. */
  const deleteReceipt = async (rec: ReceiptRec) => {
    const ok = await appConfirm({
      title: 'Delete receipt',
      tone: 'danger',
      confirmLabel: 'Delete',
      message:
        `Delete receipt ${rec.receiptNo} of ${rec.date.split('-').reverse().join('/')} (CRS ${rec.crsId})?\n\n` +
        'Its quantities stop counting in Daily Entry, Monthly Entry, the statements and the COLL report. This cannot be undone.',
    });
    if (!ok) return;
    const beforeDelete = crsData.get<ReceiptRec[]>('receiptStore') ?? [];
    crsData.set('receiptStore', beforeDelete.filter((x) => x.id !== rec.id));
    republishMonth(Number(rec.crsId), rec.date, beforeDelete);
    if (!(await crsData.save())) {
      setBanner(refusal(`Receipt ${rec.receiptNo} was NOT deleted`));
      return;
    }
    setBanner(`✓ Receipt ${rec.receiptNo} deleted — Daily and Monthly Entry updated.`);
    setTimeout(() => setBanner(''), 4000);
  };

  const logs = receiptStore
    .filter((r) => {
      if (isCrsUser && r.crsId !== user!.crsId) return false;
      if (filterCrs && String(r.crsId) !== filterCrs) return false;
      if (filterMonth && !r.date.startsWith(filterMonth)) return false;
      return true;
    })
    .sort((a, b) => b.date.localeCompare(a.date));

  const commName = (id: string) =>
    comms.find((c) => c.id === id)?.en ?? [...DSS_A, ...DSS_B, ...CRS29_STOCK].find((c) => c.id === id)?.en ?? id;

  const input = { border: '1px solid var(--border)', borderRadius: 8, padding: '8px 12px', fontSize: 13 } as const;
  const th = { padding: '8px 10px', textAlign: 'center' as const, fontSize: 10, fontWeight: 700, color: 'var(--muted)', borderBottom: '1px solid var(--border)' };
  const logTh = { padding: '9px 10px', fontSize: 10, fontWeight: 700, color: 'var(--muted)', borderBottom: '1px solid var(--border)' } as const;

  return (
    <div className="page active" id="page-receipt">
      {/* Chip delete appears on hover only, so the register stays readable. */}
      <style>{'.rcp-chip .rcp-chip-x{display:none}.rcp-chip:hover .rcp-chip-x{display:inline-flex}'}</style>
      <div className="page-header" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 10 }}>
        <div>
          <div className="page-title">Receipt Register</div>
          <div className="page-sub">Godown receipts — commodities received from depot</div>
        </div>
        <button
          onClick={openForm}
          style={{ background: 'linear-gradient(135deg,#0284C7,#0EA5E9)', color: '#fff', border: 'none', padding: '9px 18px', borderRadius: 8, fontWeight: 700, fontSize: 13, cursor: 'pointer' }}
        >
          + Add Receipt
        </button>
      </div>

      {formOpen ? (
        <div style={{ marginBottom: 16 }}>
          <div className="card">
            <div style={{ background: 'linear-gradient(135deg,#0369A1,#0EA5E9)', borderRadius: '12px 12px 0 0', padding: '12px 18px' }}>
              <div style={{ color: '#fff', fontWeight: 700 }}>New Godown Receipt</div>
              <div style={{ color: 'rgba(255,255,255,.65)', fontSize: 11 }}>Record commodities received from depot</div>
            </div>
            <div className="card-body">
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr auto', gap: 12, marginBottom: 14, alignItems: 'end' }}>
                <div>
                  <label className="form-label">CRS Shop</label>
                  <select value={crsVal} onChange={(e) => setCrsVal(e.target.value)} style={{ ...input, width: '100%' }}>
                    <option value="">Select CRS...</option>
                    {shopIds.map((id) => (
                      <option key={id} value={String(id)}>
                        {shopLabel(id)}
                      </option>
                    ))}
                  </select>
                </div>
                <div>
                  <label className="form-label">Receipt Date</label>
                  <input type="date" value={date} onChange={(e) => setDate(e.target.value)} style={{ ...input, width: '100%' }} />
                </div>
                <div>
                  <label className="form-label">Receipt No.</label>
                  <input type="text" value={receiptNo} onChange={(e) => setReceiptNo(e.target.value)} placeholder="e.g. R/2026/001" style={{ ...input, width: 140 }} />
                </div>
              </div>

              {/* Receipt type — Regular counts toward COLL */}
              <div style={{ margin: '4px 0 14px', padding: '12px 14px', border: '1px solid var(--border)', borderRadius: 10, background: 'var(--bg)' }}>
                <div style={{ fontSize: 11, fontWeight: 800, color: 'var(--text)', textTransform: 'uppercase', letterSpacing: '.05em', marginBottom: 9 }}>
                  Receipt Type <span style={{ color: '#DC2626' }}>*</span>
                </div>
                <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
                  {(
                    [
                      { id: 'regular', label: 'Regular', desc: 'Counts toward COLL', color: '#0369A1' },
                      { id: 'advance', label: 'Advance', desc: 'Excluded from COLL', color: '#B45309' },
                    ] as const
                  ).map((t) => {
                    const on = rcpType === t.id;
                    return (
                      <label
                        key={t.id}
                        style={{ flex: '1 1 190px', display: 'flex', alignItems: 'flex-start', gap: 9, border: `2px solid ${on ? t.color : 'var(--border)'}`, borderRadius: 9, padding: '10px 12px', cursor: 'pointer', background: on ? `${t.color}12` : '#fff' }}
                      >
                        <input type="radio" name="rcp-type" value={t.id} checked={on} onChange={() => setRcpType(t.id)} style={{ width: 'auto', marginTop: 2, cursor: 'pointer' }} />
                        <span>
                          <span style={{ display: 'block', fontSize: 13, fontWeight: 800, color: t.color }}>{t.label}</span>
                          <span style={{ display: 'block', fontSize: 10, color: 'var(--muted)', marginTop: 1 }}>{t.desc}</span>
                        </span>
                      </label>
                    );
                  })}
                </div>
              </div>

              <div style={{ overflowX: 'auto' }}>
                <table id="receipt-comm-table" className="frz-table" style={{ width: '100%', borderCollapse: 'collapse', minWidth: 500 }}>
                  <thead>
                    <tr style={{ background: '#F8FAFC' }}>
                      <th style={th}>#</th>
                      <th className="frz-comm" style={{ ...th, textAlign: 'left', padding: '8px 12px' }}>Commodity</th>
                      <th style={th}>Unit</th>
                      <th style={{ ...th, color: '#0369A1', background: '#EFF6FF' }}>Qty Received</th>
                      <th style={th}>
                        Packing <span style={{ fontSize: 9, fontWeight: 400 }}>(auto-calculated)</span>
                        <br />
                        <span style={{ display: 'inline-flex', gap: 4, marginTop: 2 }}>
                          <span style={{ background: '#F59E0B', color: '#fff', fontSize: 8, padding: '1px 4px', borderRadius: 3 }}>GUNNY ÷50</span>
                          <span style={{ background: '#EF4444', color: '#fff', fontSize: 8, padding: '1px 4px', borderRadius: 3 }}>C.BOX ÷10/50</span>
                          <span style={{ background: '#16A34A', color: '#fff', fontSize: 8, padding: '1px 4px', borderRadius: 3 }}>POLY ÷50/25</span>
                        </span>
                      </th>
                      <th style={{ ...th, width: 44 }}>Clear</th>
                    </tr>
                  </thead>
                  <tbody ref={qtyRef}>
                    {comms.map((c, i) => {
                      const rule = PACK_RULES[c.id];
                      const r = rows[c.id] ?? emptyRow(c.id);
                      const type = SWITCHABLE.has(c.id) ? r.type : rule?.type;
                      const col = type ? PACK_COLORS[type] : null;
                      return (
                        <tr key={c.id} style={{ background: i % 2 === 0 ? '#fff' : '#FAFCFF' }}>
                          <td style={{ padding: '7px 10px', textAlign: 'center', fontSize: 11, color: 'var(--muted)', borderBottom: '1px solid #F0F9FF' }}>{i + 1}</td>
                          <td className="frz-comm" style={{ padding: '7px 12px', borderBottom: '1px solid #F0F9FF' }}>
                            <div style={{ fontWeight: 600, fontSize: 12 }}>{c.ta}</div>
                            <div style={{ fontSize: 10, color: 'var(--muted)' }}>{c.en}</div>
                          </td>
                          <td style={{ padding: '7px 10px', textAlign: 'center', fontSize: 11, color: 'var(--muted)', borderBottom: '1px solid #F0F9FF' }}>{c.unit}</td>
                          <td style={{ padding: '5px 8px', borderBottom: '1px solid #F0F9FF', background: '#EFF6FF' }}>
                            <input
                              type="number"
                              min={0}
                              step={0.001}
                              placeholder="0.000"
                              value={r.qty}
                              data-qty="1"
                              onChange={(e) => onQty(c, e.target.value)}
                              onKeyDown={qtyKey}
                              style={{ width: 100, border: '1px solid #BAE6FD', borderRadius: 6, padding: '5px 8px', fontSize: 12, textAlign: 'right', fontWeight: 600 }}
                            />
                          </td>
                          {rule && col && type ? (
                            <td style={{ padding: '4px 8px', borderBottom: '1px solid #F0F9FF', minWidth: 300 }}>
                              <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 3, background: col.bg, borderRadius: 6, padding: '4px 6px', border: `1px solid ${col.border}` }}>
                                <span style={{ background: col.badge, color: '#fff', fontSize: 9, fontWeight: 800, padding: '1px 5px', borderRadius: 3, flexShrink: 0 }}>{col.label.toUpperCase()}</span>
                                <input
                                  type="number"
                                  min={0}
                                  step={1}
                                  placeholder="0"
                                  value={r.count}
                                  onChange={(e) => onCount(c, e.target.value)}
                                  style={{ width: 52, border: `1px solid ${col.border}`, borderRadius: 5, padding: '3px 5px', fontSize: 12, fontWeight: 800, textAlign: 'center', color: col.text, background: '#fff' }}
                                />
                                <span style={{ fontSize: 9, color: col.text }}>{col.countLabel}</span>
                                <span style={{ fontSize: 10, color: col.text, marginLeft: 2 }}>= </span>
                                <input
                                  type="number"
                                  min={0}
                                  step={0.001}
                                  placeholder="0.000"
                                  value={r.packQty}
                                  onChange={(e) => onPackQty(c, e.target.value)}
                                  style={{ width: 70, border: `1px solid ${col.border}`, borderRadius: 5, padding: '3px 5px', fontSize: 11, fontWeight: 600, textAlign: 'right', color: col.text, background: '#fff' }}
                                />
                                <span style={{ fontSize: 9, color: col.text }}>{col.qtyLabel}</span>
                                {SWITCHABLE.has(c.id) ? (
                                  <button
                                    type="button"
                                    onClick={() => toggleType(c.id)}
                                    title="Switch between GUNNY / POLY"
                                    style={{ background: col.badge, color: '#fff', border: 'none', borderRadius: 4, padding: '2px 6px', fontSize: 8, fontWeight: 800, cursor: 'pointer', flexShrink: 0, whiteSpace: 'nowrap' }}
                                  >
                                    ⇄ Switch
                                  </button>
                                ) : null}
                              </div>
                            </td>
                          ) : (
                            <td style={{ padding: '5px 8px', borderBottom: '1px solid #F0F9FF', textAlign: 'center', color: '#CBD5E1', fontSize: 11 }}>—</td>
                          )}
                          <td style={{ padding: '5px 6px', borderBottom: '1px solid #F0F9FF', textAlign: 'center' }}>
                            {r.qty || r.count || r.packQty ? (
                              <button
                                type="button"
                                onClick={() => clearRow(c.id)}
                                title={`Clear ${c.en} from this receipt`}
                                style={{ background: '#FEE2E2', color: '#B91C1C', border: '1px solid #FCA5A5', borderRadius: 6, padding: '3px 9px', fontSize: 11, fontWeight: 700, cursor: 'pointer' }}
                              >
                                ✕
                              </button>
                            ) : null}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
              <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 10, marginTop: 14 }}>
                <button
                  onClick={() => setRows({})}
                  title="Clear every commodity entered on this receipt"
                  style={{ marginRight: 'auto', background: '#fff', border: '1px solid #FCA5A5', color: '#B91C1C', padding: '8px 18px', borderRadius: 8, fontSize: 13, fontWeight: 600, cursor: 'pointer' }}
                >
                  🗑 Clear All
                </button>
                <button onClick={() => setFormOpen(false)} style={{ background: '#fff', border: '1px solid var(--border)', padding: '8px 18px', borderRadius: 8, fontSize: 13, cursor: 'pointer' }}>
                  Cancel
                </button>
                <button
                  ref={saveRef}
                  onClick={() => void save()}
                  style={{ background: 'linear-gradient(135deg,#0284C7,#0EA5E9)', color: '#fff', border: 'none', padding: '8px 22px', borderRadius: 8, fontWeight: 700, fontSize: 13, cursor: 'pointer' }}
                >
                  💾 Save Receipt
                </button>
              </div>
            </div>
          </div>
        </div>
      ) : null}

      {/* A refusal reads amber, not green — "was NOT deleted" on a success
          background is the sentence a reader skims straight past. */}
      {banner ? (
        <div
          style={
            banner.startsWith('⚠')
              ? { background: '#FEF3C7', border: '1px solid #FDE047', borderRadius: 8, padding: '10px 14px', color: '#92400E', fontSize: 13, fontWeight: 600, marginBottom: 14 }
              : { background: '#DCFCE7', border: '1px solid #86EFAC', borderRadius: 8, padding: '10px 14px', color: '#15803D', fontSize: 13, fontWeight: 600, marginBottom: 14 }
          }
        >
          {banner}
        </div>
      ) : null}

      <div className="card">
        <div style={{ padding: '12px 16px', borderBottom: '1px solid var(--border)', display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap' }}>
          <select value={filterCrs} onChange={(e) => setFilterCrs(e.target.value)} style={{ border: '1px solid var(--border)', borderRadius: 7, padding: '7px 10px', fontSize: 12 }}>
            <option value="">All CRS Shops</option>
            {shopIds.map((id) => (
              <option key={id} value={String(id)}>
                {shopLabel(id)}
              </option>
            ))}
          </select>
          <input type="month" value={filterMonth} onChange={(e) => setFilterMonth(e.target.value)} style={{ border: '1px solid var(--border)', borderRadius: 7, padding: '7px 10px', fontSize: 12 }} />
          <span style={{ marginLeft: 'auto', fontSize: 12, color: 'var(--muted)' }}>{logs.length} receipt(s) found</span>
        </div>
        {logs.length === 0 ? (
          <div style={{ textAlign: 'center', padding: 40, color: 'var(--muted)' }}>
            <div style={{ fontSize: 36, marginBottom: 10 }}>🧾</div>
            <div style={{ fontWeight: 600 }}>No receipts found</div>
          </div>
        ) : (
          <table style={{ width: '100%', borderCollapse: 'collapse' }}>
            <thead>
              <tr style={{ background: '#F8FAFC' }}>
                <th style={{ ...logTh, padding: '9px 14px', textAlign: 'left' }}>Date</th>
                <th style={logTh}>CRS</th>
                <th style={logTh}>Type</th>
                <th style={logTh}>Receipt No.</th>
                <th style={logTh}>Commodities Received</th>
                <th style={{ ...logTh, textAlign: 'center' }}>Saved At</th>
                <th style={{ ...logTh, textAlign: 'center', width: 70 }}>Actions</th>
              </tr>
            </thead>
            <tbody>
              {logs.map((r) => (
                <tr key={r.id}>
                  <td style={{ padding: '11px 14px', borderBottom: '1px solid #F0F9FF', fontWeight: 700, fontSize: 13 }}>{r.date}</td>
                  <td style={{ padding: '11px 10px', borderBottom: '1px solid #F0F9FF', fontSize: 12 }}>
                    <strong>CRS {r.crsId}</strong> — {shops[r.crsId - 1]?.name ?? ''}
                  </td>
                  <td style={{ padding: '11px 10px', borderBottom: '1px solid #F0F9FF', textAlign: 'center' }}>
                    {r.type === 'advance' ? (
                      <span style={{ background: '#FEF3C7', color: '#B45309', fontSize: 10, fontWeight: 800, padding: '2px 8px', borderRadius: 4 }}>ADVANCE</span>
                    ) : (
                      <span style={{ background: '#E0F2FE', color: '#0369A1', fontSize: 10, fontWeight: 800, padding: '2px 8px', borderRadius: 4 }}>REGULAR</span>
                    )}
                  </td>
                  <td style={{ padding: '11px 10px', borderBottom: '1px solid #F0F9FF', fontSize: 12, fontFamily: 'monospace', color: '#0369A1' }}>{r.receiptNo}</td>
                  <td style={{ padding: '11px 10px', borderBottom: '1px solid #F0F9FF' }}>
                    {Object.entries(r.items).map(([id, it]) => (
                      <span
                        key={id}
                        className="rcp-chip"
                        style={{ display: 'inline-flex', alignItems: 'center', gap: 3, background: '#E0F2FE', color: '#0369A1', fontSize: 11, fontWeight: 700, padding: '2px 8px', borderRadius: 4, margin: 2 }}
                      >
                        {commName(id)}: {Number(it.qty).toFixed(3)}
                        <button
                          className="rcp-chip-x"
                          onClick={() => void deleteItem(r, id)}
                          title={`Remove ${commName(id)} from this receipt`}
                          style={{ border: 'none', background: '#DC2626', color: '#fff', width: 14, height: 14, borderRadius: '50%', fontSize: 9, fontWeight: 800, lineHeight: 1, cursor: 'pointer', alignItems: 'center', justifyContent: 'center', padding: 0, marginLeft: 3 }}
                        >
                          ✕
                        </button>
                      </span>
                    ))}
                  </td>
                  <td style={{ padding: '11px 10px', borderBottom: '1px solid #F0F9FF', textAlign: 'center', fontSize: 11, color: 'var(--muted)' }}>{r.savedAt}</td>
                  <td style={{ padding: '11px 10px', borderBottom: '1px solid #F0F9FF', textAlign: 'center' }}>
                    <button
                      onClick={() => void deleteReceipt(r)}
                      title="Delete this receipt"
                      style={{ background: '#fff', border: '1px solid #FCA5A5', color: '#DC2626', padding: '5px 10px', borderRadius: 6, fontSize: 12, cursor: 'pointer', fontWeight: 600 }}
                    >
                      🗑 Delete
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}
