'use client';

/**
 * PV Officer Assignment.
 *
 * An officer covers a group of shops, so their name and designation are keyed
 * once per group rather than once per shop. The visit DATE is the exception:
 * the same officer reaches each shop on a different day, and the form must
 * carry the day that shop was actually verified — so the group's date is a
 * default and every shop in the table can override it.
 *
 * ADMIN ONLY. Who verifies which shop, and on what date, is the office's
 * decision — a shop has no business editing the name that certifies its own
 * stock. The screen refuses non-admins here rather than only hiding the nav
 * link, because a hidden link is not a lock.
 *
 * The DATA stays readable to every signed-in user through /api/state, and has
 * to: a shop generating its own PV needs the officer resolved onto the form.
 * What is restricted is changing it, not seeing it on one's own statement.
 */
import { useEffect, useMemo, useState } from 'react';
import { useAuth } from '@/lib/authClient';
import { crsData, useStore } from '@/lib/dataStore';
import { useShops } from '@/lib/masters';
import { appAlert } from '@/components/dialog';
import {
  dateFor, duplicateShops, emptyStore, groupOf, normalise, officerLabel,
  unassignedShops, type PvOfficerStore,
} from '@/lib/engine/pvOfficer';

type ShopRec = { name: string };

export default function PvOfficersPage() {
  const { user } = useAuth();
  const isAdmin = user?.role === 'ADMIN';
  const shops: ShopRec[] = useShops();
  const raw = useStore<PvOfficerStore>('__pvOfficers');
  const store = useMemo(() => normalise(raw), [raw]);

  const [groupId, setGroupId] = useState(store.groups[0]?.id ?? 'g1');
  const [name, setName] = useState('');
  const [desig, setDesig] = useState('');
  const [date, setDate] = useState('');
  const [savedMsg, setSavedMsg] = useState('');

  const group = store.groups.find((g) => g.id === groupId) ?? store.groups[0];

  // Load the selected group's stored values into the form.
  useEffect(() => {
    const g = store.groups.find((x) => x.id === groupId);
    setName(g?.officerName ?? '');
    setDesig(g?.designation ?? '');
    setDate(g?.pvDate ?? '');
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [groupId, raw]);

  const write = (mutate: (s: PvOfficerStore) => void) => {
    crsData.update<PvOfficerStore>('__pvOfficers', (d) => {
      const next = normalise(Object.keys(d ?? {}).length ? d : emptyStore());
      mutate(next);
      next.updatedAt = new Date().toISOString();
      next.updatedBy = user?.username ?? '';
      Object.assign(d, next);
    });
    void crsData.save();
  };

  const saveGroup = () => {
    if (!group) return;
    if (!name.trim()) {
      void appAlert('Enter the PV Officer name.');
      return;
    }
    write((s) => {
      const g = s.groups.find((x) => x.id === group.id);
      if (!g) return;
      g.officerName = name.trim();
      g.designation = desig.trim();
      g.pvDate = date;
      // A new group date replaces per-shop overrides inside that group — the
      // alternative is a saved date that silently does nothing for shops the
      // clerk had adjusted earlier.
      for (const id of g.crsIds) delete s.dates[String(id)];
    });
    setSavedMsg(`Saved for ${group.label} — ${group.crsIds.length} shops`);
    setTimeout(() => setSavedMsg(''), 4000);
  };

  const setShopDate = (crsId: number, iso: string) =>
    write((s) => {
      if (iso) s.dates[String(crsId)] = iso;
      else delete s.dates[String(crsId)];
    });

  const dupes = duplicateShops(store);
  const unassigned = unassignedShops(store, shops.length || 30);

  if (!isAdmin) {
    return (
      <div className="page active" id="page-pv-officers">
        <div className="page-header">
          <div className="page-title">PV Officer Assignment</div>
        </div>
        <div className="card">
          <div className="card-body" style={{ textAlign: 'center', padding: '48px 24px' }}>
            <div style={{ fontSize: 42, marginBottom: 12 }}>🔒</div>
            <div style={{ fontWeight: 700, fontSize: 16, marginBottom: 6 }}>Administrators only</div>
            <div style={{ color: 'var(--muted)', fontSize: 13, maxWidth: 480, margin: '0 auto', lineHeight: 1.7 }}>
              PV officers and visit dates are set by the office. The officer assigned to your shop still prints on your PV
              statement automatically — you can see it on the Reports page.
            </div>
          </div>
        </div>
      </div>
    );
  }

  const inp: React.CSSProperties = { width: '100%', border: '1px solid var(--border)', borderRadius: 8, padding: '8px 10px', fontSize: 13 };
  const th: React.CSSProperties = { padding: '8px 10px', fontSize: 10, fontWeight: 700, color: 'var(--muted)', borderBottom: '2px solid var(--border)', textAlign: 'left', whiteSpace: 'nowrap' };
  const td: React.CSSProperties = { padding: '7px 10px', fontSize: 12, borderBottom: '1px solid #F1F5F9' };

  return (
    <div className="page active" id="page-pv-officers">
      <div className="page-header">
        <div className="page-title">PV Officer Assignment</div>
        <div className="page-sub">
          One officer covers a group of shops · name and designation are shared, the visit date can differ per shop
        </div>
      </div>

      {dupes.length ? (
        <div style={{ background: '#FEF2F2', border: '1px solid #FCA5A5', borderRadius: 10, padding: '10px 14px', marginBottom: 14, color: '#B91C1C', fontSize: 12 }}>
          CRS {dupes.join(', ')} {dupes.length === 1 ? 'is' : 'are'} in more than one group — the officer printed on the statement would be whichever group is found first. Fix the grouping.
        </div>
      ) : null}
      {unassigned.length ? (
        <div style={{ background: '#FFFBEB', border: '1px solid #FDE68A', borderRadius: 10, padding: '10px 14px', marginBottom: 14, color: '#92400E', fontSize: 12 }}>
          CRS {unassigned.join(', ')} {unassigned.length === 1 ? 'belongs' : 'belong'} to no group — their PV statements print a blank officer line.
        </div>
      ) : null}

      {/* ── Officer details for one group ─────────────────────────────────── */}
      <div className="card mb-4">
        <div className="card-header">
          <div className="card-title">PV Officer Details</div>
        </div>
        <div className="card-body">
          <div style={{ display: 'grid', gap: 14, gridTemplateColumns: 'repeat(auto-fit, minmax(190px, 1fr))', alignItems: 'end' }}>
            <div>
              <label className="form-label">CRS GROUP</label>
              <select value={groupId} onChange={(e) => setGroupId(e.target.value)} style={inp}>
                {store.groups.map((g) => (
                  <option key={g.id} value={g.id}>
                    {g.label} — CRS {g.crsIds.join(', ')}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label className="form-label">PV OFFICER NAME</label>
              <input value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. R. Kumar" style={inp} />
            </div>
            <div>
              <label className="form-label">DESIGNATION</label>
              <input value={desig} onChange={(e) => setDesig(e.target.value)} placeholder="e.g. Assistant Manager" style={inp} />
            </div>
            <div>
              <label className="form-label">DATE OF P.V.</label>
              <input type="date" value={date} onChange={(e) => setDate(e.target.value)} style={inp} />
            </div>
            <div>
              <button onClick={saveGroup} className="btn btn-primary" style={{ width: '100%', fontSize: 13, padding: '9px 0' }}>
                Save PV Officer Details
              </button>
            </div>
          </div>
          {savedMsg ? (
            <div style={{ marginTop: 12, background: '#DCFCE7', border: '1px solid #86EFAC', borderRadius: 8, padding: '9px 13px', color: '#15803D', fontSize: 12, fontWeight: 600 }}>
              ✅ {savedMsg}. Saving a group date clears any per-shop dates inside it — set those again below if the visits were on different days.
            </div>
          ) : null}
        </div>
      </div>

      {/* ── Every shop, with its own date ─────────────────────────────────── */}
      <div className="card">
        <div className="card-header" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 8 }}>
          <div className="card-title">Shop-wise PV Details</div>
          <div style={{ fontSize: 11, color: 'var(--muted)' }}>
            Change a date here when the officer visited that shop on a different day
          </div>
        </div>
        <div className="table-wrap" style={{ overflowX: 'auto' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse', minWidth: 640 }}>
            <thead>
              <tr>
                <th style={th}>CRS</th>
                <th style={th}>Shop Name</th>
                <th style={th}>Group</th>
                <th style={th}>PV Officer</th>
                <th style={th}>Designation</th>
                <th style={{ ...th, width: 180 }}>PV Date</th>
              </tr>
            </thead>
            <tbody>
              {shops.map((s, i) => {
                const crsId = i + 1;
                const g = groupOf(store, crsId);
                const effective = dateFor(store, crsId);
                const overridden = !!store.dates[String(crsId)];
                const inGroup = g?.id === groupId;
                return (
                  <tr key={crsId} style={{ background: inGroup ? '#F0F9FF' : i % 2 ? '#FAFCFF' : '#fff' }}>
                    <td style={{ ...td, fontWeight: 700, whiteSpace: 'nowrap' }}>CRS {crsId}</td>
                    <td style={td}>{s.name}</td>
                    <td style={{ ...td, color: 'var(--muted)', whiteSpace: 'nowrap' }}>{g?.label ?? '—'}</td>
                    <td style={{ ...td, fontWeight: g?.officerName ? 600 : 400, color: g?.officerName ? 'var(--text)' : 'var(--muted)' }}>
                      {g?.officerName || 'Not assigned'}
                    </td>
                    <td style={{ ...td, color: g?.designation ? 'var(--text)' : 'var(--muted)' }}>{g?.designation || '—'}</td>
                    <td style={td}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                        <input
                          type="date"
                          value={effective}
                          onChange={(e) => setShopDate(crsId, e.target.value)}
                          style={{ ...inp, padding: '5px 7px', fontSize: 12, borderColor: overridden ? '#F59E0B' : 'var(--border)', background: overridden ? '#FFFBEB' : '#fff' }}
                        />
                        {overridden ? (
                          <button
                            type="button"
                            onClick={() => setShopDate(crsId, '')}
                            title="Use the group's date"
                            style={{ background: '#FEF3C7', border: '1px solid #FDE68A', color: '#92400E', borderRadius: 6, padding: '4px 8px', fontSize: 10, fontWeight: 700, cursor: 'pointer', whiteSpace: 'nowrap' }}
                          >
                            ↺ Group
                          </button>
                        ) : null}
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
        <div style={{ padding: '10px 16px', fontSize: 11, color: 'var(--muted)', borderTop: '1px solid var(--border)' }}>
          A date on an amber background overrides its group. The statement prints{' '}
          <strong>{officerLabel(group) || 'the officer'}</strong> and that shop&apos;s own date.
        </div>
      </div>
    </div>
  );
}
