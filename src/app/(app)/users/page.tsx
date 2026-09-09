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
import { crsData, useStore, useUsers } from '@/lib/dataStore';
import { useShops } from '@/lib/masters';
import { appConfirm } from '@/components/dialog';
import type { EngineUser } from '@/lib/authClient';
import {
  clearedMasterSlot,
  occupant,
  planTransfer,
  vacantRoles,
  withMasterSlot,
  type MasterRec,
  type StaffRole,
} from '@/lib/engine/staffAssignment';

type ShopRec = { name: string };

const isStaffRole = (r: string): r is StaffRole => r === 'BC' || r === 'Packer';

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
  const shops: ShopRec[] = useShops();
  const [search, setSearch] = useState('');
  const [filterCrs, setFilterCrs] = useState('');
  const [filterRole, setFilterRole] = useState('');
  const [banner, setBanner] = useState<{ msg: string; error?: boolean } | null>(null);
  const [modal, setModal] = useState<null | { editId: number | null; seed?: { crsId: number; role: StaffRole } }>(null);
  const [moving, setMoving] = useState<EngineUser | null>(null);

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

  /**
   * Keep the office's sheet (__crsMaster) in step with the roster.
   *
   * The users table decides who holds which post — 39-staff-roles.js settled
   * that — but it hands back to the sheet for a shop with NO active accounts,
   * the "never been set up" case. Remove the last person from a shop and that
   * fallback would reprint the name just removed, on statutory paperwork. So
   * the sheet moves with the assignment. It is also what the CRS Shops screen
   * displays, which is the other half of "CRS Master views must update".
   */
  const editMaster = (fn: (m: MasterRec[]) => MasterRec[] | null) => {
    const next = fn(crsData.get<MasterRec[]>('__crsMaster') ?? []);
    if (next) crsData.set('__crsMaster', next);
    return !!next;
  };

  /**
   * Take somebody off a shop without destroying anything they did there.
   *
   * The assignment is one column, so clearing it is enough for the shop card,
   * the Dashboard, the statements and the sign-in list to stop showing them.
   * The row itself stays: every audit entry, day sheet and statement they
   * recorded is attributed by username, and deleting the account would leave
   * that history pointing at nobody. /api/users deactivates an unassigned shop
   * account server-side — see canSignIn().
   */
  const removeFromShop = async (u: EngineUser) => {
    if (!u.crsId) return;
    const from = u.crsId;
    const ok = await appConfirm({
      title: `Remove this user from CRS ${from}?`,
      tone: 'danger',
      confirmLabel: 'Confirm Remove',
      message:
        `${u.fullName} (${u.role}) will no longer appear under ${shopLabel(from)} — not on the shop card, the Dashboard, the statements, or the shop's sign-in list.\n\n` +
        `Everything they recorded while working there is kept. The account is kept too, unassigned, so it can be given a shop again later.`,
    });
    if (!ok) return;
    try {
      await api(`/api/users/${u.id}`, 'PATCH', { crsId: null });
      if (isStaffRole(u.role) && editMaster((m) => clearedMasterSlot(m, from, u.role as StaffRole, u.fullName))) {
        await crsData.save();
      }
      await refresh();
      show(`✅ ${u.fullName} removed from CRS ${from}. The ${u.role} post is now vacant.`);
    } catch (e) {
      show(`⚠️ ${e instanceof Error ? e.message : e}`, true);
    }
  };

  /**
   * Move somebody to another shop, or to the other post at this one.
   *
   * `replaceHolder` is the person already in the destination post, and is only
   * ever set after the admin has been shown who they are and chosen to replace
   * them — they are removed the same way the Remove button removes anyone, so
   * a replacement is a transfer plus a removal and never a silent overwrite.
   *
   * The order matters: the old post is emptied before the new one is filled,
   * so a move between the two posts of ONE shop does not clear the slot it
   * just wrote.
   */
  const doTransfer = async (u: EngineUser, toCrsId: number, toRole: StaffRole, replaceHolder: EngineUser | null) => {
    const from = u.crsId;
    const plan = planTransfer(users, u, toCrsId, toRole);
    try {
      if (replaceHolder) {
        await api(`/api/users/${replaceHolder.id}`, 'PATCH', { crsId: null });
        if (isStaffRole(replaceHolder.role)) {
          editMaster((m) => clearedMasterSlot(m, toCrsId, replaceHolder.role as StaffRole, replaceHolder.fullName));
        }
      }
      if (from && isStaffRole(u.role)) editMaster((m) => clearedMasterSlot(m, from, u.role as StaffRole, u.fullName));

      const payload: Record<string, unknown> = { crsId: toCrsId, role: toRole };
      // A shop-scoped username (`crs24`) is how that shop's sign-in finds its
      // people, so it has to move too or the old shop keeps offering them. A
      // username that is the person's own name stays theirs.
      if (plan.username) payload.username = plan.username;
      await api(`/api/users/${u.id}`, 'PATCH', payload);

      editMaster((m) => withMasterSlot(m, toCrsId, toRole, u.fullName, u.phone));
      await crsData.save();
      await refresh();
      setMoving(null);
      show(
        `✅ ${u.fullName} transferred to ${shopLabel(toCrsId)} as ${toRole}` +
          (from && from !== toCrsId ? `, and removed from CRS ${from}` : '') +
          (replaceHolder ? `. ${replaceHolder.fullName} was removed from that post` : '') +
          (plan.username ? `. Sign-in username is now "${plan.username}"` : '') +
          '.',
      );
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
            // Who actually holds the post — read from the WHOLE roster, not
            // the filtered rows below it, and only counting active accounts.
            // A search for "BC" used to empty the Packer chip, and a disabled
            // account went on being shown as the holder while the statements
            // (getUsersForCRS filters on active) had already stopped printing
            // them. The chip is a statement about the shop, so it answers the
            // same way they do.
            const bc = g.crsId ? occupant(users, g.crsId, 'BC') : null;
            const pk = g.crsId ? occupant(users, g.crsId, 'Packer') : null;
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
                    {/* A post nobody fills is offered here rather than left for
                        the admin to find: the vacancy is the reason they came
                        to this card, and the modal opens on the right shop and
                        the right role. */}
                    {g.crsId
                      ? vacantRoles(users, g.crsId).map((r) => (
                          <button
                            key={r}
                            onClick={() => setModal({ editId: null, seed: { crsId: g.crsId as number, role: r } })}
                            title={`Add a ${r} to ${label}`}
                            style={{ background: 'rgba(255,255,255,.9)', border: 'none', color: '#0369A1', fontSize: 10, fontWeight: 800, padding: '3px 9px', borderRadius: 4, cursor: 'pointer' }}
                          >
                            + Add {r}
                          </button>
                        ))
                      : null}
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
                                {/* Transfer and Remove are only meaningful for
                                    somebody who holds a post at a shop — an
                                    administrator has no shop to be removed from. */}
                                {u.crsId ? (
                                  <>
                                    <button
                                      onClick={() => setMoving(u)}
                                      title="Move this person to another shop or post"
                                      style={{ background: '#fff', border: '1px solid var(--border)', color: '#7C3AED', padding: '5px 10px', borderRadius: 6, fontSize: 12, cursor: 'pointer' }}
                                    >
                                      ⇄ Transfer
                                    </button>
                                    <button
                                      onClick={() => void removeFromShop(u)}
                                      title={`Remove from CRS ${u.crsId} — the account and its history are kept`}
                                      style={{ background: '#fff', border: '1px solid #FCA5A5', color: '#B91C1C', padding: '5px 10px', borderRadius: 6, fontSize: 12, cursor: 'pointer', fontWeight: 600 }}
                                    >
                                      Remove
                                    </button>
                                  </>
                                ) : null}
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
          seed={modal.seed}
          users={users}
          shops={shops}
          onClose={() => setModal(null)}
          onSaved={(msg, filled) => {
            setModal(null);
            // A new hire is the shop's current holder of that post, so the
            // office's sheet records them too — the same slot a Remove empties.
            if (filled && isStaffRole(filled.role)) {
              if (editMaster((m) => withMasterSlot(m, filled.crsId, filled.role as StaffRole, filled.fullName, filled.phone))) {
                void crsData.save();
              }
            }
            show(`✅ ${msg}`);
            void refresh();
          }}
          onError={(msg) => show(`⚠️ ${msg}`, true)}
        />
      ) : null}

      {moving ? (
        <TransferModal
          user={moving}
          users={users}
          shops={shops}
          onClose={() => setMoving(null)}
          onConfirm={(toCrsId, toRole, replaceHolder) => void doTransfer(moving, toCrsId, toRole, replaceHolder)}
        />
      ) : null}
    </div>
  );
}

/**
 * Move one person to a shop and a post.
 *
 * The destination post being taken is not an error — staff replace each other
 * — but it is never resolved silently: the holder is named, and the confirm
 * button changes to say what will happen to them. Cancelling is the other
 * option the spec asks for, and it is the dialog's own close.
 */
function TransferModal({
  user,
  users,
  shops,
  onClose,
  onConfirm,
}: {
  user: EngineUser;
  users: EngineUser[];
  shops: ShopRec[];
  onClose: () => void;
  onConfirm: (toCrsId: number, toRole: StaffRole, replaceHolder: EngineUser | null) => void;
}) {
  const [crsVal, setCrsVal] = useState('');
  const [role, setRole] = useState<StaffRole | ''>(isStaffRole(user.role) ? user.role : '');
  const toCrsId = crsVal ? Number(crsVal) : null;
  const plan = toCrsId && role ? planTransfer(users, user, toCrsId, role) : null;
  const holder = plan?.blocked?.holder ?? null;
  const ready = !!toCrsId && !!role && !plan?.noop;

  const label = (id: number) => `CRS ${id} — ${shops[id - 1]?.name ?? ''}`;
  const box = { border: '1px solid var(--border)', borderRadius: 8, padding: '9px 12px', fontSize: 13, width: '100%' } as const;

  return (
    <div className="modal-bg" style={{ display: 'flex' }} onClick={(e) => e.target === e.currentTarget && onClose()}>
      <div className="modal" style={{ maxWidth: 460 }}>
        <div className="modal-head" style={{ background: 'linear-gradient(135deg,#6D28D9,#8B5CF6)' }}>
          <div style={{ fontWeight: 800 }}>⇄ Transfer staff</div>
        </div>
        <div style={{ padding: 18, display: 'grid', gap: 14 }}>
          <div style={{ background: '#F8FAFC', border: '1px solid var(--border)', borderRadius: 8, padding: '10px 12px' }}>
            <div style={{ fontWeight: 700, fontSize: 13 }}>{user.fullName}</div>
            <div style={{ fontSize: 11, color: 'var(--muted)' }}>
              Currently {user.role}
              {user.crsId ? ` at ${label(user.crsId)}` : ' — no shop'} · @{user.username}
            </div>
          </div>

          <label style={{ display: 'grid', gap: 5 }}>
            <span style={{ fontSize: 11, fontWeight: 700, color: 'var(--muted)' }}>NEW CRS SHOP</span>
            <select value={crsVal} onChange={(e) => setCrsVal(e.target.value)} style={box}>
              <option value="">Select a shop…</option>
              {shops.map((_, i) => (
                <option key={i + 1} value={i + 1}>
                  {label(i + 1)}
                </option>
              ))}
            </select>
          </label>

          <div style={{ display: 'grid', gap: 5 }}>
            <span style={{ fontSize: 11, fontWeight: 700, color: 'var(--muted)' }}>ROLE</span>
            <div style={{ display: 'flex', gap: 8 }}>
              {(['BC', 'Packer'] as const).map((r) => (
                <button
                  key={r}
                  onClick={() => setRole(r)}
                  style={{
                    flex: 1,
                    border: `2px solid ${role === r ? (r === 'BC' ? '#0369A1' : '#C2410C') : 'var(--border)'}`,
                    background: role === r ? (r === 'BC' ? '#E0F2FE' : '#FFF3E8') : '#fff',
                    color: r === 'BC' ? '#0369A1' : '#C2410C',
                    borderRadius: 9,
                    padding: '10px 12px',
                    fontWeight: 700,
                    fontSize: 13,
                    cursor: 'pointer',
                  }}
                >
                  {r === 'BC' ? 'Bill Clerk (BC)' : 'Packer'}
                </button>
              ))}
            </div>
          </div>

          {plan?.noop ? (
            <div style={{ background: '#F1F5F9', border: '1px solid var(--border)', borderRadius: 8, padding: '9px 12px', fontSize: 12, color: 'var(--muted)' }}>
              That is the post {user.fullName} already holds — nothing to transfer.
            </div>
          ) : null}

          {holder ? (
            <div style={{ background: '#FEF3C7', border: '1px solid #FDE047', borderRadius: 8, padding: '10px 12px', fontSize: 12, color: '#92400E' }}>
              <strong>{label(toCrsId!)} already has a {role}: {holder.fullName}.</strong>
              <div style={{ marginTop: 4 }}>
                Transferring {user.fullName} into that post removes {holder.fullName} from it. They keep their account and everything they
                recorded, and can be given another shop. Cancel if that is not what you meant.
              </div>
            </div>
          ) : null}

          {plan && !holder && !plan.noop && plan.username ? (
            <div style={{ background: '#EFF6FF', border: '1px solid #BAE6FD', borderRadius: 8, padding: '9px 12px', fontSize: 12, color: '#0369A1' }}>
              Sign-in username changes from <strong>@{user.username}</strong> to <strong>@{plan.username}</strong>, so the old shop&apos;s
              sign-in list stops offering them.
            </div>
          ) : null}
        </div>
        <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 10, padding: '0 18px 18px' }}>
          <button onClick={onClose} style={{ background: '#fff', border: '1px solid var(--border)', padding: '9px 18px', borderRadius: 8, fontSize: 13, cursor: 'pointer' }}>
            Cancel
          </button>
          <button
            disabled={!ready}
            onClick={() => ready && onConfirm(toCrsId!, role as StaffRole, holder)}
            style={{
              background: ready ? (holder ? 'linear-gradient(135deg,#B45309,#D97706)' : 'linear-gradient(135deg,#6D28D9,#8B5CF6)') : '#E2E8F0',
              color: ready ? '#fff' : '#94A3B8',
              border: 'none',
              padding: '9px 20px',
              borderRadius: 8,
              fontWeight: 700,
              fontSize: 13,
              cursor: ready ? 'pointer' : 'not-allowed',
            }}
          >
            {holder ? `Replace ${holder.fullName}` : 'Confirm Transfer'}
          </button>
        </div>
      </div>
    </div>
  );
}

function UserModal({
  editUser,
  seed,
  users,
  shops,
  onClose,
  onSaved,
  onError,
}: {
  editUser: EngineUser | null;
  /** Opened from a shop card's vacancy — that shop and post are filled in. */
  seed?: { crsId: number; role: StaffRole };
  users: EngineUser[];
  shops: ShopRec[];
  onClose: () => void;
  /** `filled` is the post this save now holds, so the sheet can record it. */
  onSaved: (msg: string, filled: { crsId: number; role: string; fullName: string; phone: string } | null) => void;
  onError: (msg: string) => void;
}) {
  const [name, setName] = useState(editUser?.fullName ?? '');
  const [phone, setPhone] = useState(editUser?.phone ?? '');
  const [email, setEmail] = useState(editUser?.email ?? '');
  const [role, setRole] = useState(editUser?.role ?? seed?.role ?? '');
  const [crsVal, setCrsVal] = useState(editUser?.crsId ? String(editUser.crsId) : seed ? String(seed.crsId) : '');
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
      const filled = { crsId, role, fullName: name.trim(), phone: phone.trim() };
      if (editUser) {
        await api(`/api/users/${editUser.id}`, 'PATCH', payload);
        onSaved(`User "${name.trim()}" updated successfully.`, filled);
      } else {
        payload.password = 'pds123';
        await api('/api/users', 'POST', payload);
        onSaved(`User "${name.trim()}" added successfully to CRS ${crsId} — ${shops[crsId - 1]?.name ?? ''} as ${role}.`, filled);
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
