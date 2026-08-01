'use client';

/**
 * CRS Master Configuration — React port of the legacy screen
 * (src/markup/pageCrs.ts + buildCrsTable in src/legacy/23-crs-master.js).
 * Same structure and class names, so the existing CSS styles it identically.
 *
 * Reads the __crsMaster and __shops masters through the data layer; the
 * Active/No-Usage toggle writes __crsMaster back, which the autosave loop
 * persists — the legacy app sees the same change on its next load.
 */
import { useState } from 'react';
import { crsData, useDataStatus, useStore } from '@/lib/dataStore';
import { useShops, type ShopRow } from '@/lib/masters';

type MasterRec = {
  id: number;
  code: string;
  bc: string;
  bcMobile: string;
  packer: string;
  packerMobile: string;
  coll: boolean;
  police: boolean;
  status: 'active' | 'no_usage';
};
type ShopRec = { code: string; name: string; cards: number; taluk: string; active: boolean; district: string };

const Dash = () => <span style={{ color: '#CBD5E1' }}>—</span>;

export default function CrsShopsPage() {
  const { status } = useDataStatus();
  const master = useStore<MasterRec[]>('__crsMaster') ?? [];
  const shops = useShops();
  const [filter, setFilter] = useState<'all' | 'active' | 'no_usage'>('all');
  const [query, setQuery] = useState('');
  const [renaming, setRenaming] = useState<{ id: number; name: string } | null>(null);

  const shopName = (id: number) => shops[id - 1]?.name ?? '';

  /** Rename a shop — writes the `__shops` master, which every screen reads. */
  const saveRename = () => {
    if (!renaming) return;
    const name = renaming.name.trim();
    if (!name) return;
    crsData.update<ShopRow[]>('__shops', (draft) => {
      while (draft.length < 30) draft.push({ name: '' });
      draft[renaming.id - 1] = { ...draft[renaming.id - 1], name };
    });
    void crsData.save();
    setRenaming(null);
  };

  const toggle = (id: number) => {
    const m = master.find((r) => r.id === id);
    if (!m) return;
    const goingOff = m.status === 'active';
    const label = `CRS ${m.id}${shopName(m.id) ? ' — ' + shopName(m.id) : ''}`;
    if (
      goingOff &&
      !confirm(
        `Mark ${label} as No Usage?\n\nIt stops being offered for new entry. Its saved data and master details are kept, so it can be set back to Active later.`,
      )
    ) {
      return;
    }
    crsData.update<MasterRec[]>('__crsMaster', (draft) => {
      const rec = draft.find((r) => r.id === id);
      if (rec) rec.status = goingOff ? 'no_usage' : 'active';
    });
  };

  const counts = { active: 0, noUse: 0, coll: 0, police: 0 };
  for (const m of master) {
    if (m.status === 'active') counts.active++;
    else counts.noUse++;
    if (m.coll) counts.coll++;
    if (m.police) counts.police++;
  }

  const q = query.trim().toLowerCase();
  const visible = master.filter((m) => {
    if (filter === 'active' && m.status !== 'active') return false;
    if (filter === 'no_usage' && m.status !== 'no_usage') return false;
    if (!q) return true;
    const hay = [m.code, `crs ${m.id}`, shopName(m.id), m.bc, m.bcMobile, m.packer, m.packerMobile]
      .join(' ')
      .toLowerCase();
    return hay.includes(q);
  });

  return (
    <div className="page active" id="page-crs">
      <div className="page-header flex justify-between items-center">
        <div>
          <div className="page-title">CRS Master Configuration</div>
          <div className="page-sub">
            30 shops in Madurai Region — codes, staff, COLL / police requirement and usage status
          </div>
        </div>
        <button
          className="btn btn-primary"
          disabled
          title="Adding shops arrives with the modal conversion — the master carries all 30 Madurai shops"
        >
          + Add CRS Shop
        </button>
      </div>
      <div className="card">
        <div className="card-header">
          <div className="search-box" style={{ width: 280 }}>
            <span className="search-icon">🔍</span>
            <input
              className="search-input"
              type="text"
              placeholder="Search by code, shop or staff…"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
            />
          </div>
          <div className="flex gap-2">
            <select
              value={filter}
              onChange={(e) => setFilter(e.target.value as typeof filter)}
              style={{ width: 'auto', fontSize: 12, padding: '6px 10px' }}
            >
              <option value="all">All Status</option>
              <option value="active">Active</option>
              <option value="no_usage">No Usage</option>
            </select>
          </div>
        </div>
        <div style={{ padding: '8px 20px 0', fontSize: 11, color: 'var(--muted)' }}>
          {status === 'ready'
            ? `${visible.length} of ${master.length} shown · ${counts.active} active · ${counts.noUse} no usage · ${counts.coll} file COLL · ${counts.police} have police ration`
            : 'Loading saved data…'}
        </div>
        <div className="table-wrap">
          <table id="crs-table" style={{ minWidth: 1120 }}>
            <thead>
              <tr>
                <th>Shop Code</th>
                <th>CRS Name</th>
                <th>BC Name</th>
                <th>BC Mobile</th>
                <th>Packer Name</th>
                <th>Packer Mobile</th>
                <th style={{ textAlign: 'center' }}>COLL</th>
                <th style={{ textAlign: 'center' }}>Police</th>
                <th style={{ textAlign: 'center' }}>Usage</th>
                <th style={{ textAlign: 'center' }}>Actions</th>
              </tr>
            </thead>
            <tbody>
              {visible.map((m) => {
                const off = m.status !== 'active';
                return (
                  <tr key={m.id} style={off ? { background: '#F8FAFC', color: '#94A3B8' } : undefined}>
                    <td>
                      <strong style={{ color: 'var(--navy)', fontFamily: 'monospace' }}>
                        {m.code || <Dash />}
                      </strong>
                    </td>
                    <td>
                      {renaming?.id === m.id ? (
                        <span style={{ display: 'inline-flex', gap: 6, alignItems: 'center' }}>
                          <strong>CRS {m.id}</strong>
                          <input
                            autoFocus
                            value={renaming.name}
                            onChange={(e) => setRenaming({ id: m.id, name: e.target.value })}
                            onKeyDown={(e) => {
                              if (e.key === 'Enter') saveRename();
                              if (e.key === 'Escape') setRenaming(null);
                            }}
                            style={{ border: '1px solid var(--border)', borderRadius: 6, padding: '4px 8px', fontSize: 12, width: 180 }}
                          />
                          <button className="btn btn-primary btn-sm" onClick={saveRename}>✓</button>
                          <button className="btn btn-outline btn-sm" onClick={() => setRenaming(null)}>✕</button>
                        </span>
                      ) : (
                        <>
                          <strong>CRS {m.id}</strong>{' '}
                          <span style={{ color: 'var(--muted)' }}>— {shopName(m.id)}</span>
                          <button
                            onClick={() => setRenaming({ id: m.id, name: shopName(m.id) })}
                            title="Rename this shop (stored in the database)"
                            style={{ marginLeft: 6, background: 'none', border: 'none', cursor: 'pointer', fontSize: 12, color: 'var(--muted)' }}
                          >
                            ✏️
                          </button>
                        </>
                      )}
                    </td>
                    <td>{m.bc || <Dash />}</td>
                    <td style={{ fontFamily: 'monospace' }}>{m.bcMobile || <Dash />}</td>
                    <td>{m.packer || <Dash />}</td>
                    <td style={{ fontFamily: 'monospace' }}>{m.packerMobile || <Dash />}</td>
                    <td style={{ textAlign: 'center' }}>
                      {m.coll ? <span className="badge badge-blue">COLL</span> : <Dash />}
                    </td>
                    <td style={{ textAlign: 'center' }}>
                      {m.police ? (
                        <span className="badge badge-purple">Had Police</span>
                      ) : (
                        <span style={{ fontSize: 11, color: 'var(--muted)' }}>No Police</span>
                      )}
                    </td>
                    <td style={{ textAlign: 'center' }}>
                      {off ? (
                        <span className="badge badge-amber">No Usage</span>
                      ) : (
                        <span className="badge badge-green">Active</span>
                      )}
                    </td>
                    <td style={{ textAlign: 'center' }}>
                      <button
                        className="btn btn-outline btn-sm"
                        onClick={() => toggle(m.id)}
                        title={off ? 'Bring this shop back into use' : 'Mark this shop as not in use'}
                        style={{ color: off ? 'var(--green)' : 'var(--red)' }}
                      >
                        {off ? 'Set Active' : 'Set No Usage'}
                      </button>
                    </td>
                  </tr>
                );
              })}
              {visible.length === 0 ? (
                <tr>
                  <td
                    colSpan={10}
                    style={{ textAlign: 'center', padding: 24, color: 'var(--muted)', fontSize: 12 }}
                  >
                    {status === 'ready' ? 'No shops match this filter.' : 'Loading…'}
                  </td>
                </tr>
              ) : null}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
