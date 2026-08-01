'use client';

/**
 * User Management — React port of the legacy screen
 * (src/markup/pageUsers.ts, renderUsersTable in 06-users.js, add/edit modal
 * in modals.ts, DB-backed actions in 38-user-management.js).
 *
 * Same layout: CRS-grouped cards, BC/Packer chips in each group header, and
 * the add/edit modal with the role cards and the existing-staff preview.
 * All writes go to /api/users (bcrypt-hashed passwords server-side); the
 * roster re-reads after every change so the screen always shows what stored.
 */
import { useMemo, useState } from 'react';
import { crsData, useUsers } from '@/lib/dataStore';
import { SHOPS } from '@/lib/engine/shops';
import type { EngineUser } from '@/lib/authClient';

type ShopRec = { name: string };

async function api(url: string, method: string, body?: unknown) {
  const r = await fetch(url, {
    method,
    headers: { 'Content-Type': 'application/json' },
    body: body ? JSON.stringify(body) : undefined,
  });
  const b = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(b?.error || `server returned ${r.status}`);
  return b;
}

export default function UsersPage() {
  const users = useUsers();
  const shops: ShopRec[] = SHOPS;
  const [search, setSearch] = useState('');
  const [filterCrs, setFilterCrs] = useState('');
  const [filterRole, setFilterRole] = useState('');
  const [banner, setBanner] = useState<{ msg: string; error?: boolean } | null>(null);
  const [modal, setModal] = useState<null | { editId: number | null }>(null);

  const shopLabel = (id: number) => `CRS ${id} — ${shops[id - 1]?.name ?? ''}`;

  const show = (msg: string, error = false) => {
    setBanner({ msg, error });
    setTimeout(() => setBanner(null), error ? 8000 : 5000);
  };

  const refresh = () => crsData.reloadUsers();

  const toggleActive = async (u: EngineUser) => {
    try {
      await api(`/api/users/${u.id}`, 'PATCH', { active: !u.active });
      await refresh();
    } catch (e) {
      show(`⚠️ ${e instanceof Error ? e.message : e}`, true);
    }
  };

  const resetPassword = async (u: EngineUser) => {
    try {
      await api(`/api/users/${u.id}`, 'PATCH', { password: 'pds123' });
      show(`✅ Password for "${u.fullName}" reset to default: pds123`);
    } catch (e) {
      show(`⚠️ ${e instanceof Error ? e.message : e}`, true);
    }
  };

  const filtered = useMemo(() => {
    const q = search.toLowerCase();
    return users.filter((u) => {
      if (q && !u.fullName.toLowerCase().includes(q) && !(u.crsId && `crs ${u.crsId}`.includes(q))) return false;
      if (filterCrs && String(u.crsId) !== filterCrs) return false;
      if (filterRole && u.role !== filterRole) return false;
      return true;
    });
  }, [users, search, filterCrs, filterRole]);

  const groups = useMemo(() => {
    const by = new Map<string, { crsId: number | null; users: EngineUser[] }>();
    for (const u of filtered) {
      const key = u.crsId ? `CRS ${u.crsId}` : 'system';
      if (!by.has(key)) by.set(key, { crsId: u.crsId, users: [] });
      by.get(key)!.users.push(u);
    }
    return [...by.values()].sort((a, b) => (a.crsId ?? 0) - (b.crsId ?? 0));
  }, [filtered]);

  const crsUserCount = users.filter((u) => u.crsId).length;

  return (
    <div className="page active" id="page-users">
      <div className="page-header" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
        <div>
          <div className="page-title">User Management</div>
          <div className="page-sub">
            {crsUserCount} CRS user(s) registered · Showing {filtered.length}
          </div>
        </div>
        <button
          onClick={() => setModal({ editId: null })}
          style={{
            background: 'linear-gradient(135deg,#0284C7,#0EA5E9)',
            color: '#fff',
            border: 'none',
            padding: '9px 18px',
            borderRadius: 8,
            fontWeight: 700,
            fontSize: 13,
            cursor: 'pointer',
            boxShadow: '0 2px 10px rgba(14,165,233,.3)',
          }}
        >
          + Add User
        </button>
      </div>

      {banner ? (
        <div
          style={{
            background: banner.error ? '#FEE2E2' : '#DCFCE7',
            border: `1px solid ${banner.error ? '#FECACA' : '#86EFAC'}`,
            borderRadius: 10,
            padding: '11px 16px',
            color: banner.error ? '#991B1B' : '#15803D',
            fontSize: 13,
            fontWeight: 600,
            marginBottom: 14,
          }}
        >
          {banner.msg}
        </div>
      ) : null}

      <div className="card" style={{ marginBottom: 14 }}>
        <div style={{ padding: '12px 16px', display: 'flex', gap: 12, alignItems: 'center', flexWrap: 'wrap' }}>
          <input
            type="text"
            placeholder="Search by name, CRS..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            style={{ flex: 1, minWidth: 180, border: '1px solid var(--border)', borderRadius: 8, padding: '8px 12px', fontSize: 13, outline: 'none' }}
          />
          <select
            value={filterCrs}
            onChange={(e) => setFilterCrs(e.target.value)}
            style={{ border: '1px solid var(--border)', borderRadius: 8, padding: '8px 12px', fontSize: 13, outline: 'none' }}
          >
            <option value="">All CRS Shops</option>
            {shops.map((s, i) => (
              <option key={i + 1} value={String(i + 1)}>
                CRS {i + 1} — {s.name}
              </option>
            ))}
          </select>
          <select
            value={filterRole}
            onChange={(e) => setFilterRole(e.target.value)}
            style={{ border: '1px solid var(--border)', borderRadius: 8, padding: '8px 12px', fontSize: 13, outline: 'none' }}
          >
            <option value="">All Roles</option>
            <option value="BC">Bill Clerk (BC)</option>
            <option value="Packer">Packer</option>
          </select>
        </div>
      </div>

      <div>
        {groups.length === 0 ? (
          <div style={{ textAlign: 'center', padding: 40, color: 'var(--muted)' }}>
            <div style={{ fontSize: 36, marginBottom: 10 }}>👥</div>
            <div style={{ fontWeight: 600 }}>No users found</div>
          </div>
        ) : (
          groups.map((g) => {
            const label = g.crsId ? shopLabel(g.crsId) : 'System Users';
            const bc = g.users.find((u) => u.role === 'BC');
            const pk = g.users.find((u) => u.role === 'Packer');
            return (
              <div className="card" style={{ marginBottom: 12 }} key={label}>
                <div
                  style={{
                    background: 'linear-gradient(135deg,#0369A1,#0EA5E9)',
                    padding: '10px 16px',
                    borderRadius: '11px 11px 0 0',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'space-between',
                  }}
                >
                  <div style={{ color: '#fff', fontWeight: 800, fontSize: 13 }}>{label}</div>
                  <div style={{ display: 'flex', gap: 6 }}>
                    {bc ? (
                      <span style={{ background: 'rgba(255,255,255,.15)', color: '#fff', fontSize: 10, fontWeight: 700, padding: '2px 8px', borderRadius: 4 }}>
                        BC: {bc.fullName}
                      </span>
                    ) : (
                      <span style={{ background: 'rgba(255,255,255,.1)', color: 'rgba(255,255,255,.5)', fontSize: 10, padding: '2px 8px', borderRadius: 4 }}>No BC</span>
                    )}
                    {pk ? (
                      <span style={{ background: 'rgba(255,165,0,.3)', color: '#FFE082', fontSize: 10, fontWeight: 700, padding: '2px 8px', borderRadius: 4 }}>
                        Packer: {pk.fullName}
                      </span>
                    ) : (
                      <span style={{ background: 'rgba(255,255,255,.1)', color: 'rgba(255,255,255,.5)', fontSize: 10, padding: '2px 8px', borderRadius: 4 }}>No Packer</span>
                    )}
                  </div>
                </div>
                <div style={{ overflowX: 'auto' }}>
                  <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                    <thead>
                      <tr style={{ background: '#F8FAFC' }}>
                        {['Name', 'Role', 'Phone', 'Email', 'Status', 'Actions'].map((h, i) => (
                          <th
                            key={h}
                            style={{
                              padding: i === 0 ? '9px 14px' : '9px 10px',
                              textAlign: i === 1 || i >= 4 ? 'center' : 'left',
                              fontSize: 10,
                              fontWeight: 700,
                              color: 'var(--muted)',
                              borderBottom: '1px solid var(--border)',
                            }}
                          >
                            {h}
                          </th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {g.users.map((u) => {
                        const roleColor = u.role === 'BC' ? '#0369A1' : '#C2410C';
                        const roleBg = u.role === 'BC' ? '#E0F2FE' : '#FFF3E8';
                        const bd = { borderBottom: '1px solid #F0F9FF' } as const;
                        return (
                          <tr key={u.id}>
                            <td style={{ padding: '11px 14px', ...bd }}>
                              <div style={{ fontWeight: 700, fontSize: 13 }}>{u.fullName}</div>
                              <div style={{ fontSize: 11, color: 'var(--muted)' }}>@{u.username}</div>
                            </td>
                            <td style={{ padding: '11px 10px', textAlign: 'center', ...bd }}>
                              <span style={{ background: roleBg, color: roleColor, fontSize: 11, fontWeight: 700, padding: '3px 9px', borderRadius: 20 }}>{u.role}</span>
                            </td>
                            <td style={{ padding: '11px 10px', fontSize: 12, ...bd }}>{u.phone}</td>
                            <td style={{ padding: '11px 10px', fontSize: 12, color: 'var(--muted)', ...bd }}>{u.email || '—'}</td>
                            <td style={{ padding: '11px 10px', textAlign: 'center', ...bd }}>
                              <span
                                style={{
                                  background: u.active ? '#DCFCE7' : '#FEE2E2',
                                  color: u.active ? '#15803D' : '#B91C1C',
                                  fontSize: 11,
                                  fontWeight: 700,
                                  padding: '3px 9px',
                                  borderRadius: 20,
                                }}
                              >
                                {u.active ? 'Active' : 'Inactive'}
                              </span>
                            </td>
                            <td style={{ padding: '11px 10px', textAlign: 'center', ...bd }}>
                              <div style={{ display: 'flex', gap: 6, justifyContent: 'center' }}>
                                <button
                                  onClick={() => setModal({ editId: u.id })}
                                  style={{ background: '#fff', border: '1px solid var(--border)', color: 'var(--text)', padding: '5px 10px', borderRadius: 6, fontSize: 12, cursor: 'pointer', fontWeight: 600 }}
                                >
                                  Edit
                                </button>
                                <button
                                  onClick={() => void resetPassword(u)}
                                  style={{ background: '#fff', border: '1px solid var(--border)', color: '#D97706', padding: '5px 10px', borderRadius: 6, fontSize: 12, cursor: 'pointer' }}
                                >
                                  🔑 Reset
                                </button>
                                <button
                                  onClick={() => void toggleActive(u)}
                                  style={{ background: '#fff', border: '1px solid var(--border)', color: u.active ? '#DC2626' : '#16A34A', padding: '5px 10px', borderRadius: 6, fontSize: 12, cursor: 'pointer' }}
                                >
                                  {u.active ? 'Disable' : 'Enable'}
                                </button>
                              </div>
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              </div>
            );
          })
        )}
      </div>

      {modal ? (
        <UserModal
          editUser={modal.editId != null ? users.find((u) => u.id === modal.editId) ?? null : null}
          users={users}
          shops={shops}
          onClose={() => setModal(null)}
          onSaved={(msg) => {
            setModal(null);
            show(`✅ ${msg}`);
            void refresh();
          }}
          onError={(msg) => show(`⚠️ ${msg}`, true)}
        />
      ) : null}
    </div>
  );
}

function UserModal({
  editUser,
  users,
  shops,
  onClose,
  onSaved,
  onError,
}: {
  editUser: EngineUser | null;
  users: EngineUser[];
  shops: ShopRec[];
  onClose: () => void;
  onSaved: (msg: string) => void;
  onError: (msg: string) => void;
}) {
  const [name, setName] = useState(editUser?.fullName ?? '');
  const [phone, setPhone] = useState(editUser?.phone ?? '');
  const [email, setEmail] = useState(editUser?.email ?? '');
  const [role, setRole] = useState(editUser?.role ?? '');
  const [crsVal, setCrsVal] = useState(editUser?.crsId ? String(editUser.crsId) : '');
  const [errs, setErrs] = useState<{ name?: boolean; phone?: boolean; role?: boolean; crs?: boolean }>({});
  const [busy, setBusy] = useState(false);

  const existing = crsVal ? users.filter((u) => u.crsId === Number(crsVal) && u.active) : [];

  const save = async () => {
    const e = {
      name: !name.trim(),
      phone: !/^[6-9][0-9]{9}$/.test(phone.trim()),
      role: !role,
      crs: !crsVal,
    };
    setErrs(e);
    if (e.name || e.phone || e.role || e.crs) return;

    const crsId = Number(crsVal);
    const payload: Record<string, unknown> = {
      fullName: name.trim(),
      username: name.trim(), // username follows fullName, as the screen always did
      phone: phone.trim(),
      email: email.trim(),
      role,
      crsId,
    };
    setBusy(true);
    try {
      if (editUser) {
        await api(`/api/users/${editUser.id}`, 'PATCH', payload);
        onSaved(`User "${name.trim()}" updated successfully.`);
      } else {
        payload.password = 'pds123';
        await api('/api/users', 'POST', payload);
        onSaved(`User "${name.trim()}" added successfully to CRS ${crsId} — ${shops[crsId - 1]?.name ?? ''} as ${role}.`);
      }
    } catch (err) {
      onError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  };

  const inputStyle = { border: '1px solid var(--border)', borderRadius: 8, padding: '9px 12px', fontSize: 13, width: '100%', outline: 'none' } as const;
  const errStyle = { color: '#DC2626', fontSize: 11, marginTop: 3 } as const;

  const roleCard = (r: 'BC' | 'Packer', title: string, sub: string, color: string, bg: string) => (
    <label
      onClick={() => setRole(r)}
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: 10,
        border: `2px solid ${role === r ? color : 'var(--border)'}`,
        background: role === r ? bg : '#fff',
        borderRadius: 10,
        padding: 12,
        cursor: 'pointer',
        transition: '.15s',
      }}
    >
      <div style={{ width: 18, height: 18, borderRadius: '50%', border: `2px solid ${color}`, flexShrink: 0, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
        <div style={{ width: 8, height: 8, borderRadius: '50%', background: role === r ? color : 'transparent' }} />
      </div>
      <div>
        <div style={{ fontWeight: 700, fontSize: 13, color: 'var(--text)' }}>{title}</div>
        <div style={{ fontSize: 10, color: 'var(--muted)' }}>{sub}</div>
      </div>
    </label>
  );

  return (
    <div className="modal-bg" style={{ display: 'flex' }} onClick={(e) => e.target === e.currentTarget && onClose()}>
      <div className="modal" style={{ width: 520, maxHeight: '90vh', overflowY: 'auto' }}>
        <div className="modal-head" style={{ background: 'linear-gradient(135deg,#0369A1,#0EA5E9)' }}>
          <h3 style={{ color: '#fff' }}>{editUser ? 'Edit User' : 'Add New User'}</h3>
          <div style={{ color: 'rgba(255,255,255,.6)', fontSize: 11, marginTop: 2 }}>
            Default password: <code style={{ background: 'rgba(255,255,255,.15)', padding: '1px 6px', borderRadius: 4 }}>pds123</code>
          </div>
        </div>
        <div className="modal-body" style={{ padding: 20 }}>
          <div className="form-group">
            <label>
              Full Name <span style={{ color: '#DC2626' }}>*</span>
            </label>
            <input type="text" placeholder="Enter full name" value={name} onChange={(e) => setName(e.target.value)} style={inputStyle} />
            {errs.name ? <div style={errStyle}>Full name is required</div> : null}
          </div>

          <div className="form-group">
            <label>
              Username <span style={{ fontSize: 10, color: 'var(--muted)', fontWeight: 400 }}>(auto-generated from full name)</span>
            </label>
            <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
              <input
                type="text"
                readOnly
                placeholder="Will be set automatically"
                value={name.trim()}
                style={{ flex: 1, background: '#F8FAFC', border: '1px solid var(--border)', borderRadius: 8, padding: '9px 12px', fontSize: 13, color: 'var(--muted)', cursor: 'not-allowed' }}
              />
              <div style={{ background: '#E0F2FE', color: '#0369A1', fontSize: 10, fontWeight: 700, padding: '4px 8px', borderRadius: 6, whiteSpace: 'nowrap' }}>AUTO</div>
            </div>
          </div>

          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
            <div className="form-group">
              <label>
                Phone Number <span style={{ color: '#DC2626' }}>*</span>
              </label>
              <input
                type="tel"
                placeholder="10-digit mobile number"
                maxLength={10}
                value={phone}
                onChange={(e) => setPhone(e.target.value.replace(/[^0-9]/g, ''))}
                style={inputStyle}
              />
              {errs.phone ? <div style={errStyle}>Valid 10-digit number required</div> : null}
            </div>
            <div className="form-group">
              <label>
                Email <span style={{ fontSize: 10, color: 'var(--muted)', fontWeight: 400 }}>(optional)</span>
              </label>
              <input type="email" placeholder="email@tncsc.gov.in" value={email} onChange={(e) => setEmail(e.target.value)} style={inputStyle} />
            </div>
          </div>

          <div className="form-group">
            <label>
              Role <span style={{ color: '#DC2626' }}>*</span>
            </label>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
              {roleCard('BC', 'Bill Clerk (BC)', 'Handles billing & entry', '#0369A1', '#EFF6FF')}
              {roleCard('Packer', 'Packer', 'Handles packing & dispatch', '#C2410C', '#FFF7ED')}
            </div>
            {errs.role ? <div style={{ ...errStyle, marginTop: 4 }}>Please select a role</div> : null}
          </div>

          <div className="form-group">
            <label>
              CRS Assignment <span style={{ color: '#DC2626' }}>*</span>
            </label>
            <div style={{ position: 'relative' }}>
              <select value={crsVal} onChange={(e) => setCrsVal(e.target.value)} style={{ ...inputStyle, appearance: 'auto' }}>
                <option value="">Select CRS Shop...</option>
                {shops.map((s, i) => (
                  <option key={i + 1} value={String(i + 1)}>
                    CRS {i + 1} — {s.name}
                  </option>
                ))}
              </select>
            </div>
            {errs.crs ? <div style={errStyle}>CRS assignment is required</div> : null}
            {existing.length ? (
              <div style={{ marginTop: 8, background: '#F0F9FF', border: '1px solid #BAE6FD', borderRadius: 8, padding: '10px 12px' }}>
                <div style={{ fontSize: 10, fontWeight: 700, color: '#0369A1', textTransform: 'uppercase', letterSpacing: '.05em', marginBottom: 6 }}>
                  Currently assigned to this CRS
                </div>
                {existing.map((u) => (
                  <div key={u.id} style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '3px 0' }}>
                    <span
                      style={{
                        background: u.role === 'BC' ? '#E0F2FE' : '#FFF3E8',
                        color: u.role === 'BC' ? '#0369A1' : '#C2410C',
                        fontSize: 10,
                        fontWeight: 700,
                        padding: '2px 6px',
                        borderRadius: 4,
                        minWidth: 60,
                        textAlign: 'center',
                      }}
                    >
                      {u.role}
                    </span>
                    <span style={{ fontSize: 12, fontWeight: 600 }}>{u.fullName}</span>
                    <span style={{ fontSize: 11, color: 'var(--muted)' }}>{u.phone}</span>
                  </div>
                ))}
              </div>
            ) : null}
          </div>

          <div style={{ background: '#F0F9FF', border: '1px solid #BAE6FD', borderRadius: 8, padding: '10px 14px', display: 'flex', alignItems: 'center', gap: 10 }}>
            <span style={{ fontSize: 16 }}>🔐</span>
            <div>
              <div style={{ fontSize: 12, fontWeight: 700, color: '#0369A1' }}>Default Password</div>
              <div style={{ fontSize: 12, color: 'var(--muted)' }}>
                New user will login with: <code style={{ background: '#fff', padding: '1px 6px', borderRadius: 4, fontWeight: 700, color: '#0369A1' }}>pds123</code>
              </div>
            </div>
          </div>

          {errs.name || errs.phone || errs.role || errs.crs ? (
            <div style={{ background: '#FEE2E2', border: '1px solid #FECACA', borderRadius: 8, padding: '10px 14px', color: '#B91C1C', fontSize: 12, marginTop: 12 }}>
              ⚠ Please fix the errors above before saving.
            </div>
          ) : null}
        </div>
        <div className="modal-foot">
          <button className="btn btn-outline" onClick={onClose}>
            Cancel
          </button>
          <button className="btn btn-primary" onClick={() => void save()} disabled={busy}>
            {busy ? 'Saving…' : 'Save User'}
          </button>
        </div>
      </div>
    </div>
  );
}
