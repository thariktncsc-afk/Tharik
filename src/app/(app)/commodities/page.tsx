'use client';

/**
 * Commodity Master — full CRUD over the `__commodityMaster` row in crs_state
 * (seeded from the engine's lists by tools/seed-masters.mjs; the database is
 * authoritative from then on). Rates, names, units and the active flag edit
 * here and flow straight into the Daily/Monthly entry grids, Receipt and
 * Reports through the data layer.
 *
 * The statement engine deliberately keeps its baked lists (byte-parity with
 * the golden snapshots); statements still follow rate changes because they
 * read the amounts the entry screens store.
 *
 * Scope (office, 2026-10-01): every commodity is for All Shops or one
 * Particular Shop, chosen on Add and Edit; a shop sees the global rows and
 * its own, at their Order (engine/commodityScope.ts — the server holds the
 * same line). Order is the position on every list; a number already taken
 * moves only the rows needed to make room (placeAtOrder).
 */
import React, { useState } from 'react';
import { appConfirm } from '@/components/dialog';
import { crsData, useDataStatus } from '@/lib/dataStore';
import { useCommodityMaster, useShops, type CommodityRow } from '@/lib/masters';
import { placeAtOrder, scopeShop } from '@/lib/engine/commodityScope';

type Draft = {
  id: string;
  ta: string;
  en: string;
  unit: string;
  rate: string;
  free: boolean;
  section: 'a' | 'b';
  order: string;
  scope: 'all' | 'shop';
  shopId: string;
};
const blankDraft = (order = 1): Draft => ({ id: '', ta: '', en: '', unit: 'KG', rate: '0', free: true, section: 'a', order: String(order), scope: 'all', shopId: '' });

type Rec = Record<string, unknown>;
const isObj = (v: unknown): v is Rec => !!v && typeof v === 'object' && !Array.isArray(v);

/**
 * The shops holding a saved figure for this commodity — day sheets, the
 * month's hand-keyed and published rows, inspections, receipts, allotment.
 * A code or section can only change while this is empty (every saved record is
 * keyed by the code and the section), and narrowing the scope away from a shop
 * that has figures is asked about first.
 */
function shopsUsing(id: string): number[] {
  const out = new Set<number>();
  const crsOf = (k: string) => Number(k.split('_')[0]);
  const blockHas = (rec: unknown) =>
    isObj(rec) && ['a', 'b'].some((s) => isObj(rec[s]) && isObj((rec[s] as Rec)[id]) && Object.values((rec[s] as Rec)[id] as Rec).some((v) => Number(v)));
  for (const store of ['entryStore', 'meManualStore', 'monthlyStore', 'inspectionStore'] as const) {
    for (const [k, rec] of Object.entries(crsData.get<Record<string, unknown>>(store) ?? {})) if (blockHas(rec)) out.add(crsOf(k));
  }
  for (const r of crsData.get<Rec[]>('receiptStore') ?? []) if (isObj(r) && isObj(r.items) && (r.items as Rec)[id]) out.add(Number(r.crsId));
  for (const [k, rec] of Object.entries(crsData.get<Record<string, Rec>>('meAllotStore') ?? {})) if (isObj(rec) && Number(rec[id])) out.add(crsOf(k));
  return [...out].filter((n) => n >= 1).sort((a, b) => a - b);
}

export default function CommoditiesPage() {
  const { status } = useDataStatus();
  const master = useCommodityMaster();
  const shops = useShops();
  const [editingId, setEditingId] = useState<string | null>(null);
  const [draft, setDraft] = useState<Draft>(blankDraft());
  const [adding, setAdding] = useState(false);
  const [banner, setBanner] = useState<{ msg: string; error?: boolean } | null>(null);

  const rows = (master ?? []).slice().sort((a, b) => (a.section === b.section ? a.order - b.order : a.section < b.section ? -1 : 1));

  const show = (msg: string, error = false) => {
    setBanner({ msg, error });
    setTimeout(() => setBanner(null), 5000);
  };

  const write = (mutate: (list: CommodityRow[]) => void, done: string) => {
    crsData.update<CommodityRow[]>('__commodityMaster', mutate);
    void crsData.save();
    show(done);
  };

  const startEdit = (c: CommodityRow) => {
    setAdding(false);
    setEditingId(c.id);
    const only = scopeShop(c);
    setDraft({
      id: c.id, ta: c.ta, en: c.en, unit: c.unit, rate: String(c.rate), free: !!c.free, section: c.section,
      order: String(c.order), scope: only === null ? 'all' : 'shop', shopId: only === null ? '' : String(only),
    });
  };

  /** The commodity being edited: which shops hold saved figures for it (code / section lock, re-scope question). */
  const usedBy = editingId && !adding ? shopsUsing(editingId) : [];

  const saveEdit = async () => {
    const rate = parseFloat(draft.rate) || 0;
    if (!draft.en.trim()) {
      show('⚠ Enter the English name.', true);
      return;
    }
    const id = draft.id.trim().toUpperCase().replace(/\s+/g, '_');
    if (!id) {
      show('⚠ Enter a code for the commodity (e.g. RAGI).', true);
      return;
    }
    if (rows.some((c) => c.id === id && c.id !== editingId)) {
      show(`⚠ Code ${id} already exists.`, true);
      return;
    }
    const order = Number(draft.order);
    if (!Number.isInteger(order) || order < 1) {
      show('⚠ Enter the Order — the position on every list (1, 2, 3 …).', true);
      return;
    }
    const shopId = Number(draft.shopId);
    if (draft.scope === 'shop' && !(Number.isInteger(shopId) && shopId >= 1 && shopId <= 30)) {
      show('⚠ Choose the CRS shop this commodity is for.', true);
      return;
    }
    const scopeLabel = draft.scope === 'shop' ? `CRS ${shopId} only` : 'every shop';

    if (adding) {
      write(
        (list) => {
          list.push({
            id, ta: draft.ta.trim() || draft.en.trim(), en: draft.en.trim(), unit: draft.unit.trim() || 'KG', rate, free: draft.free,
            section: draft.section, order, active: true, ...(draft.scope === 'shop' ? { scope: 'shop' as const, shopId } : {}),
          });
          placeAtOrder(list, id, order);
        },
        `✓ ${draft.en.trim()} added at Order ${order} — ${scopeLabel}.`,
      );
    } else {
      const cur = rows.find((c) => c.id === editingId);
      if (!cur) return;
      const used = shopsUsing(cur.id);
      if ((id !== cur.id || draft.section !== cur.section) && used.length) {
        show(`⚠ ${cur.id} holds saved figures for CRS ${used.join(', ')} — its code and section cannot change.`, true);
        return;
      }
      // Narrowing to one shop hides the commodity from the others: say whose saved figures stop showing.
      const hidden = draft.scope === 'shop' ? used.filter((n) => n !== shopId) : [];
      if (hidden.length) {
        const ok = await appConfirm({
          title: 'Restrict to one shop?',
          tone: 'warning',
          confirmLabel: `CRS ${shopId} only`,
          cancelLabel: 'Go back',
          defaultCancel: true,
          message:
            `${cur.en} has saved figures for CRS ${hidden.join(', ')}. Those figures stay in the database, but the commodity ` +
            `will no longer appear on ${hidden.length === 1 ? "that shop's" : "those shops'"} screens and nothing new can be keyed into it there.`,
        });
        if (!ok) return;
      }
      write(
        (list) => {
          const c = list.find((x) => x.id === editingId);
          if (!c) return;
          c.id = id;
          c.section = draft.section;
          c.ta = draft.ta.trim() || c.ta;
          c.en = draft.en.trim() || c.en;
          c.unit = draft.unit.trim() || c.unit;
          c.rate = rate;
          c.free = draft.free;
          if (draft.scope === 'shop') {
            c.scope = 'shop';
            c.shopId = shopId;
          } else {
            delete c.scope;
            delete c.shopId;
          }
          if (c.order !== order) placeAtOrder(list, c.id, order);
        },
        `✓ ${draft.en.trim()} updated — Order ${order}, ${scopeLabel}.`,
      );
    }
    setEditingId(null);
    setAdding(false);
  };

  const toggleActive = (c: CommodityRow) => {
    write(
      (list) => {
        const x = list.find((y) => y.id === c.id);
        if (x) x.active = x.active === false ? true : false;
      },
      c.active === false ? `✓ ${c.en} re-activated.` : `✓ ${c.en} deactivated — it leaves the entry screens but keeps its saved history.`,
    );
  };

  const remove = async (c: CommodityRow) => {
    const ok = await appConfirm({
      title: 'Delete commodity',
      tone: 'danger',
      confirmLabel: 'Delete',
      message:
        `Delete ${c.en} (${c.id}) from the commodity master?\n\n` +
        'Existing entries that used it keep their figures, but it disappears from every screen. ' +
        'Prefer Deactivate unless it was added by mistake.\n\nThis cannot be undone.',
    });
    if (!ok) return;
    write((list) => {
      const i = list.findIndex((x) => x.id === c.id);
      if (i !== -1) list.splice(i, 1);
    }, `✓ ${c.en} deleted from the master.`);
  };

  const inputS = { border: '1px solid var(--border)', borderRadius: 6, padding: '5px 8px', fontSize: 12 } as const;
  const codeLocked = !adding && usedBy.length > 0;

  const editorRow = (
    <tr style={{ background: '#F0F9FF' }}>
      <td style={{ textAlign: 'center', fontFamily: 'monospace', color: 'var(--muted)' }}>{adding ? '+' : ''}</td>
      <td>
        {codeLocked ? (
          <span title={`Holds saved figures for CRS ${usedBy.join(', ')} — the code cannot change`} style={{ fontFamily: 'monospace', fontWeight: 700, color: 'var(--navy)' }}>
            {draft.id}
          </span>
        ) : (
          <input value={draft.id} onChange={(e) => setDraft({ ...draft, id: e.target.value })} placeholder="CODE" aria-label="Code" style={{ ...inputS, width: 110, fontFamily: 'monospace', fontWeight: 700 }} />
        )}
      </td>
      <td>
        <input value={draft.en} onChange={(e) => setDraft({ ...draft, en: e.target.value })} placeholder="English name" aria-label="Name (EN)" style={{ ...inputS, width: 150 }} />
      </td>
      <td>
        <input value={draft.ta} onChange={(e) => setDraft({ ...draft, ta: e.target.value })} placeholder="தமிழ் பெயர்" aria-label="Name (Tamil)" style={{ ...inputS, width: 160 }} />
      </td>
      <td style={{ textAlign: 'center' }}>
        <select value={draft.unit} onChange={(e) => setDraft({ ...draft, unit: e.target.value })} aria-label="Unit" style={{ ...inputS, width: 70 }}>
          {['KG', 'LTR', 'PKT', 'NOS'].map((u) => (
            <option key={u}>{u}</option>
          ))}
        </select>
      </td>
      <td style={{ textAlign: 'center' }}>
        {codeLocked ? (
          draft.section === 'a' ? 'Main' : 'Police'
        ) : (
          <select value={draft.section} onChange={(e) => setDraft({ ...draft, section: e.target.value as 'a' | 'b' })} aria-label="Section" style={{ ...inputS, width: 110 }}>
            <option value="a">A — Main</option>
            <option value="b">B — Police</option>
          </select>
        )}
      </td>
      <td style={{ textAlign: 'center' }}>
        <label style={{ display: 'inline-flex', alignItems: 'center', gap: 5, fontSize: 12, cursor: 'pointer' }}>
          <input type="checkbox" checked={draft.free} onChange={(e) => setDraft({ ...draft, free: e.target.checked })} style={{ width: 'auto' }} />
          Free
        </label>
        {!draft.free ? (
          <input type="number" min={0} step={0.01} value={draft.rate} onChange={(e) => setDraft({ ...draft, rate: e.target.value })} aria-label="Rate" style={{ ...inputS, width: 80, marginLeft: 6, textAlign: 'right' }} />
        ) : null}
      </td>
      <td style={{ textAlign: 'center' }} colSpan={2}>
        <button className="btn btn-primary btn-sm" onClick={() => void saveEdit()}>💾 Save</button>{' '}
        <button
          className="btn btn-outline btn-sm"
          onClick={() => {
            setEditingId(null);
            setAdding(false);
          }}
        >
          Cancel
        </button>
      </td>
    </tr>
  );

  // Order, Scope and Shop — the row under the editor; it wraps on a phone.
  const scopeRow = (
    <tr style={{ background: '#F0F9FF' }}>
      <td colSpan={9} style={{ paddingTop: 0 }}>
        {/* Pinned to the visible part of the scrolling table and no wider than the screen, so on a
            phone it wraps in view instead of running off with the table's columns. */}
        <div
          className="commodity-scope"
          style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: '8px 18px', fontSize: 12, position: 'sticky', left: 0, maxWidth: 'calc(100vw - 64px)' }}
        >
          <label style={{ display: 'inline-flex', alignItems: 'center', gap: 6, fontWeight: 700 }}>
            Order
            <input type="number" min={1} step={1} value={draft.order} onChange={(e) => setDraft({ ...draft, order: e.target.value })} aria-label="Order" style={{ ...inputS, width: 70, textAlign: 'center' }} />
          </label>
          <span style={{ fontWeight: 700 }}>Scope</span>
          <label style={{ display: 'inline-flex', alignItems: 'center', gap: 5, cursor: 'pointer' }}>
            <input type="radio" name="commodity-scope" value="all" checked={draft.scope === 'all'} onChange={() => setDraft({ ...draft, scope: 'all' })} style={{ width: 'auto' }} />
            All Shops
          </label>
          <label style={{ display: 'inline-flex', alignItems: 'center', gap: 5, cursor: 'pointer' }}>
            <input type="radio" name="commodity-scope" value="shop" checked={draft.scope === 'shop'} onChange={() => setDraft({ ...draft, scope: 'shop' })} style={{ width: 'auto' }} />
            Particular Shop
          </label>
          {draft.scope === 'shop' ? (
            <select
              value={draft.shopId}
              onChange={(e) => setDraft({ ...draft, shopId: e.target.value })}
              aria-label="CRS shop"
              style={{ ...inputS, width: 'auto', minWidth: 200, maxWidth: '100%', borderColor: draft.shopId ? 'var(--border)' : '#F59E0B' }}
            >
              <option value="">Select CRS Shop</option>
              {shops.map((s) => (
                <option key={s.id} value={s.id}>
                  CRS {s.id} — {s.name}
                </option>
              ))}
            </select>
          ) : null}
          <span style={{ color: 'var(--muted)', fontSize: 11 }}>
            {draft.scope === 'shop'
              ? draft.shopId
                ? `Only CRS ${draft.shopId} sees it, at Order ${draft.order || '?'}.`
                : 'Choose the shop.'
              : `Every CRS sees it, at Order ${draft.order || '?'}.`}
            {codeLocked ? ` Saved figures: CRS ${usedBy.join(', ')} — code and section stay as they are.` : ''}
          </span>
        </div>
      </td>
    </tr>
  );

  return (
    <div className="page active" id="page-commodity">
      <div className="page-header flex justify-between items-center">
        <div>
          <div className="page-title">Commodity Master</div>
          <div className="page-sub">Names, units and rates — stored in the database and read by every entry screen</div>
        </div>
        <button
          className="btn btn-primary"
          onClick={() => {
            setAdding(true);
            setEditingId(null);
            setDraft(blankDraft(Math.max(0, ...rows.map((c) => c.order)) + 1));
          }}
        >
          + Add Commodity
        </button>
      </div>

      {banner ? (
        <div
          style={{
            background: banner.error ? '#FEE2E2' : '#DCFCE7',
            border: `1px solid ${banner.error ? '#FECACA' : '#86EFAC'}`,
            borderRadius: 10,
            padding: '10px 14px',
            color: banner.error ? '#991B1B' : '#15803D',
            fontSize: 13,
            fontWeight: 600,
            marginBottom: 12,
          }}
        >
          {banner.msg}
        </div>
      ) : null}

      <div className="card">
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>Order</th>
                <th>Code</th>
                <th>Name (EN)</th>
                <th>Name (Tamil)</th>
                <th>Unit</th>
                <th>Section</th>
                <th>Rate (₹)</th>
                <th>Status</th>
                <th>Actions</th>
              </tr>
            </thead>
            <tbody>
              {adding ? (
                <>
                  {editorRow}
                  {scopeRow}
                </>
              ) : null}
              {status !== 'ready' && !master ? (
                <tr>
                  <td colSpan={9} style={{ textAlign: 'center', padding: 24, color: 'var(--muted)', fontSize: 12 }}>
                    Loading commodity master…
                  </td>
                </tr>
              ) : (
                rows.map((c) =>
                  editingId === c.id && !adding ? (
                    <React.Fragment key={c.id}>
                      {editorRow}
                      {scopeRow}
                    </React.Fragment>
                  ) : (
                    <tr key={c.id} style={c.active === false ? { background: '#F8FAFC', color: '#94A3B8' } : undefined}>
                      <td style={{ textAlign: 'center', fontFamily: 'monospace' }}>{c.order}</td>
                      <td>
                        <span style={{ fontFamily: 'monospace', fontWeight: 700, color: 'var(--navy)' }}>{c.id}</span>
                        {c.crs29Only ? <span style={{ marginLeft: 6, fontSize: 9, fontWeight: 800, color: '#B45309', background: '#FFFBEB', border: '1px solid #FDE68A', borderRadius: 4, padding: '1px 5px' }}>CRS 29</span> : null}
                        {scopeShop(c) !== null ? (
                          <span title="Particular Shop — only this CRS sees it" style={{ marginLeft: 6, fontSize: 9, fontWeight: 800, color: '#6D28D9', background: '#F5F3FF', border: '1px solid #DDD6FE', borderRadius: 4, padding: '1px 5px', whiteSpace: 'nowrap' }}>
                            CRS {scopeShop(c)} only
                          </span>
                        ) : null}
                      </td>
                      <td>{c.en}</td>
                      <td>{c.ta}</td>
                      <td style={{ textAlign: 'center' }}>
                        <span className="badge badge-blue">{c.unit}</span>
                      </td>
                      <td style={{ textAlign: 'center' }}>{c.section === 'a' ? 'Main' : 'Police'}</td>
                      <td style={{ textAlign: 'center' }}>
                        {c.free ? <span style={{ color: '#16A34A', fontWeight: 700, fontSize: 11 }}>Free</span> : <strong>₹{Number(c.rate).toFixed(2)}</strong>}
                      </td>
                      <td style={{ textAlign: 'center' }}>
                        {c.active === false ? <span className="badge badge-amber">Inactive</span> : <span className="badge badge-green">Active</span>}
                      </td>
                      <td style={{ whiteSpace: 'nowrap' }}>
                        <button className="btn btn-outline btn-sm" onClick={() => startEdit(c)}>Edit</button>{' '}
                        <button className="btn btn-outline btn-sm" style={{ color: c.active === false ? 'var(--green)' : '#B45309' }} onClick={() => toggleActive(c)}>
                          {c.active === false ? 'Activate' : 'Deactivate'}
                        </button>{' '}
                        <button className="btn btn-outline btn-sm" style={{ color: 'var(--red)' }} onClick={() => void remove(c)}>Delete</button>
                      </td>
                    </tr>
                  ),
                )
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
