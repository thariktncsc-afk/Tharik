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
 */
import React, { useState } from 'react';
import { crsData, useDataStatus } from '@/lib/dataStore';
import { useCommodityMaster, type CommodityRow } from '@/lib/masters';

type Draft = {
  id: string;
  ta: string;
  en: string;
  unit: string;
  rate: string;
  free: boolean;
  section: 'a' | 'b';
};
const blankDraft = (): Draft => ({ id: '', ta: '', en: '', unit: 'KG', rate: '0', free: true, section: 'a' });

export default function CommoditiesPage() {
  const { status } = useDataStatus();
  const master = useCommodityMaster();
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
    setDraft({ id: c.id, ta: c.ta, en: c.en, unit: c.unit, rate: String(c.rate), free: !!c.free, section: c.section });
  };

  const saveEdit = () => {
    const rate = parseFloat(draft.rate) || 0;
    if (!draft.en.trim()) {
      show('⚠ Enter the English name.', true);
      return;
    }
    if (adding) {
      const id = draft.id.trim().toUpperCase().replace(/\s+/g, '_');
      if (!id) {
        show('⚠ Enter a code for the new commodity (e.g. RAGI).', true);
        return;
      }
      if (rows.some((c) => c.id === id)) {
        show(`⚠ Code ${id} already exists.`, true);
        return;
      }
      write(
        (list) => {
          const order = Math.max(0, ...list.map((c) => c.order)) + 1;
          list.push({ id, ta: draft.ta.trim() || draft.en.trim(), en: draft.en.trim(), unit: draft.unit.trim() || 'KG', rate, free: draft.free, section: draft.section, order, active: true });
        },
        `✓ ${draft.en.trim()} added. It now appears on the entry screens.`,
      );
    } else {
      write(
        (list) => {
          const c = list.find((x) => x.id === editingId);
          if (!c) return;
          c.ta = draft.ta.trim() || c.ta;
          c.en = draft.en.trim() || c.en;
          c.unit = draft.unit.trim() || c.unit;
          c.rate = rate;
          c.free = draft.free;
        },
        `✓ ${draft.en.trim()} updated.`,
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

  const remove = (c: CommodityRow) => {
    const ok = confirm(
      `Delete ${c.en} (${c.id}) from the commodity master?\n\n` +
        'Existing entries that used it keep their figures, but it disappears from every screen. ' +
        'Prefer Deactivate unless it was added by mistake.\n\nThis cannot be undone.',
    );
    if (!ok) return;
    write((list) => {
      const i = list.findIndex((x) => x.id === c.id);
      if (i !== -1) list.splice(i, 1);
    }, `✓ ${c.en} deleted from the master.`);
  };

  const inputS = { border: '1px solid var(--border)', borderRadius: 6, padding: '5px 8px', fontSize: 12 } as const;

  const editorRow = (
    <tr style={{ background: '#F0F9FF' }}>
      <td style={{ textAlign: 'center', fontFamily: 'monospace', color: 'var(--muted)' }}>{adding ? '+' : ''}</td>
      <td>
        {adding ? (
          <input value={draft.id} onChange={(e) => setDraft({ ...draft, id: e.target.value })} placeholder="CODE" style={{ ...inputS, width: 110, fontFamily: 'monospace', fontWeight: 700 }} />
        ) : (
          <span style={{ fontFamily: 'monospace', fontWeight: 700, color: 'var(--navy)' }}>{draft.id}</span>
        )}
      </td>
      <td>
        <input value={draft.en} onChange={(e) => setDraft({ ...draft, en: e.target.value })} placeholder="English name" style={{ ...inputS, width: 150 }} />
      </td>
      <td>
        <input value={draft.ta} onChange={(e) => setDraft({ ...draft, ta: e.target.value })} placeholder="தமிழ் பெயர்" style={{ ...inputS, width: 160 }} />
      </td>
      <td style={{ textAlign: 'center' }}>
        <select value={draft.unit} onChange={(e) => setDraft({ ...draft, unit: e.target.value })} style={{ ...inputS, width: 70 }}>
          {['KG', 'LTR', 'PKT', 'NOS'].map((u) => (
            <option key={u}>{u}</option>
          ))}
        </select>
      </td>
      <td style={{ textAlign: 'center' }}>
        {adding ? (
          <select value={draft.section} onChange={(e) => setDraft({ ...draft, section: e.target.value as 'a' | 'b' })} style={{ ...inputS, width: 110 }}>
            <option value="a">A — Main</option>
            <option value="b">B — Police</option>
          </select>
        ) : draft.section === 'a' ? (
          'Main'
        ) : (
          'Police'
        )}
      </td>
      <td style={{ textAlign: 'center' }}>
        <label style={{ display: 'inline-flex', alignItems: 'center', gap: 5, fontSize: 12, cursor: 'pointer' }}>
          <input type="checkbox" checked={draft.free} onChange={(e) => setDraft({ ...draft, free: e.target.checked })} style={{ width: 'auto' }} />
          Free
        </label>
        {!draft.free ? (
          <input type="number" min={0} step={0.01} value={draft.rate} onChange={(e) => setDraft({ ...draft, rate: e.target.value })} style={{ ...inputS, width: 80, marginLeft: 6, textAlign: 'right' }} />
        ) : null}
      </td>
      <td style={{ textAlign: 'center' }} colSpan={2}>
        <button className="btn btn-primary btn-sm" onClick={saveEdit}>💾 Save</button>{' '}
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
            setDraft(blankDraft());
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
              {adding ? editorRow : null}
              {status !== 'ready' && !master ? (
                <tr>
                  <td colSpan={9} style={{ textAlign: 'center', padding: 24, color: 'var(--muted)', fontSize: 12 }}>
                    Loading commodity master…
                  </td>
                </tr>
              ) : (
                rows.map((c) =>
                  editingId === c.id && !adding ? (
                    <React.Fragment key={c.id}>{editorRow}</React.Fragment>
                  ) : (
                    <tr key={c.id} style={c.active === false ? { background: '#F8FAFC', color: '#94A3B8' } : undefined}>
                      <td style={{ textAlign: 'center', fontFamily: 'monospace' }}>{c.order}</td>
                      <td>
                        <span style={{ fontFamily: 'monospace', fontWeight: 700, color: 'var(--navy)' }}>{c.id}</span>
                        {c.crs29Only ? <span style={{ marginLeft: 6, fontSize: 9, fontWeight: 800, color: '#B45309', background: '#FFFBEB', border: '1px solid #FDE68A', borderRadius: 4, padding: '1px 5px' }}>CRS 29</span> : null}
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
                        <button className="btn btn-outline btn-sm" style={{ color: 'var(--red)' }} onClick={() => remove(c)}>Delete</button>
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
