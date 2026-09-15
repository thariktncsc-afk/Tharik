'use client';

/**
 * Messages / Announcements — administrators write to shop staff, and see
 * exactly who has read what.
 *
 * WHO IT REACHES IS SHOWN BEFORE IT IS SENT. The recipient count and names are
 * worked out on this page with the same resolveAudience the server uses, from
 * the roster already loaded — so "This will reach 25 people" is the same 25
 * the server will write rows for, not an estimate. The server resolves it
 * again from the users table when the message is posted, and that is the list
 * that counts.
 *
 * Administrator-only, both here and in /api/messages.
 */
import { useCallback, useEffect, useMemo, useState } from 'react';
import { useAuth } from '@/lib/authClient';
import { useUsers } from '@/lib/dataStore';
import { useShops } from '@/lib/masters';
import { appConfirm } from '@/components/dialog';
import {
  MESSAGE_MAX,
  PRIORITIES,
  TITLE_MAX,
  describeAudience,
  resolveAudience,
  type Audience,
  type Priority,
  type RecipientReport,
  type ReadStats,
  type SentMessage,
  type StaffRole,
} from '@/lib/notify/core';
import { PRIORITY_STYLE, fetchReport, fetchSent, fmtWhen, postMessage } from '@/lib/notify/client';

type Mode = Audience['mode'];
const MODES: { id: Mode; label: string }[] = [
  { id: 'users', label: 'Individual user' },
  { id: 'shop', label: 'One CRS shop' },
  { id: 'shops', label: 'Multiple CRS shops' },
  { id: 'roles', label: 'Selected roles' },
  { id: 'all', label: 'All CRS shops' },
];
const ROLE_CHOICES: { id: string; label: string; roles: StaffRole[] }[] = [
  { id: 'BC', label: 'BC', roles: ['BC'] },
  { id: 'Packer', label: 'Packer', roles: ['Packer'] },
  { id: 'both', label: 'Both', roles: ['BC', 'Packer'] },
];

const input = { border: '1px solid var(--border)', borderRadius: 8, padding: '9px 12px', fontSize: 13, width: '100%', outline: 'none', fontFamily: 'inherit' } as const;
const label = { fontSize: 11, fontWeight: 700, color: 'var(--muted)', textTransform: 'uppercase', letterSpacing: '.04em', marginBottom: 6, display: 'block' } as const;

export default function MessagesPage() {
  const { user } = useAuth();
  const users = useUsers();
  const shops = useShops();
  const isAdmin = user?.role === 'ADMIN';

  const [title, setTitle] = useState('');
  const [body, setBody] = useState('');
  const [priority, setPriority] = useState<Priority>('normal');
  const [mode, setMode] = useState<Mode>('all');
  const [userIds, setUserIds] = useState<number[]>([]);
  const [userSearch, setUserSearch] = useState('');
  const [shopId, setShopId] = useState('');
  const [shopIds, setShopIds] = useState<number[]>([]);
  const [roleChoice, setRoleChoice] = useState('both');
  const [pickRoles, setPickRoles] = useState<StaffRole[]>(['BC', 'Packer']);
  const [sending, setSending] = useState(false);
  const [banner, setBanner] = useState<{ ok: boolean; text: string } | null>(null);

  const [sent, setSent] = useState<SentMessage[]>([]);
  const [installed, setInstalled] = useState(true);
  const [loadingSent, setLoadingSent] = useState(true);
  const [report, setReport] = useState<null | { msg: SentMessage; rows: RecipientReport[] | null; stats: ReadStats | null; err: string }>(null);
  const [reportFilter, setReportFilter] = useState<'all' | 'read' | 'unread'>('all');

  const roleSet = ROLE_CHOICES.find((r) => r.id === roleChoice)?.roles ?? ['BC', 'Packer'];

  const audience: Audience | null = useMemo(() => {
    switch (mode) {
      case 'users':
        return userIds.length ? { mode, userIds } : null;
      case 'shop':
        return shopId ? { mode, crsId: Number(shopId), roles: roleSet } : null;
      case 'shops':
        return shopIds.length ? { mode, crsIds: shopIds, roles: roleSet } : null;
      case 'roles':
        return pickRoles.length ? { mode, roles: pickRoles } : null;
      default:
        return { mode: 'all' };
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mode, userIds, shopId, shopIds, roleChoice, pickRoles]);

  const reach = useMemo(() => (audience ? resolveAudience(users, audience) : []), [users, audience]);
  const staff = useMemo(() => resolveAudience(users, { mode: 'all' }), [users]);
  const shopLabel = (id: number | null) => (id ? `CRS ${id} — ${shops[id - 1]?.name ?? ''}` : '—');

  const loadSent = useCallback(async () => {
    try {
      const b = await fetchSent();
      setInstalled(b.installed);
      setSent(b.messages);
    } catch (e) {
      setBanner({ ok: false, text: e instanceof Error ? e.message : String(e) });
    } finally {
      setLoadingSent(false);
    }
  }, []);

  // Read receipts keep arriving after a message goes out, so the sent list
  // refreshes itself while this page is being looked at.
  useEffect(() => {
    if (!isAdmin) return;
    void loadSent();
    const t = setInterval(() => document.visibilityState === 'visible' && void loadSent(), 20_000);
    return () => clearInterval(t);
  }, [isAdmin, loadSent]);

  const openReport = async (msg: SentMessage) => {
    setReport({ msg, rows: null, stats: null, err: '' });
    setReportFilter('all');
    try {
      const b = await fetchReport(msg.id);
      setReport({ msg, rows: b.recipients, stats: b.stats, err: '' });
    } catch (e) {
      setReport({ msg, rows: [], stats: null, err: e instanceof Error ? e.message : String(e) });
    }
  };

  const send = async () => {
    if (!audience || !reach.length || !title.trim() || !body.trim()) return;
    const ok = await appConfirm({
      title: 'Send this message?',
      tone: priority === 'urgent' ? 'danger' : 'primary',
      confirmLabel: `Send to ${reach.length}`,
      message:
        `"${title.trim()}"\n\nTo: ${describeAudience(audience)} — ${reach.length} ${reach.length === 1 ? 'person' : 'people'}.` +
        (priority !== 'normal' ? `\n\nMarked ${PRIORITY_STYLE[priority].label}: it will pop up for each of them until they acknowledge it.` : ''),
    });
    if (!ok) return;
    setSending(true);
    setBanner(null);
    try {
      const r = await postMessage({ title: title.trim(), message: body.trim(), priority, audience });
      setBanner({ ok: true, text: `Sent to ${r.recipients} ${r.recipients === 1 ? 'person' : 'people'}.` });
      setTitle('');
      setBody('');
      setPriority('normal');
      void loadSent();
    } catch (e) {
      setBanner({ ok: false, text: e instanceof Error ? e.message : String(e) });
    } finally {
      setSending(false);
    }
  };

  if (!isAdmin) {
    return (
      <div className="page active">
        <div className="card" style={{ padding: 30, textAlign: 'center', color: 'var(--muted)' }}>Only administrators can send messages.</div>
      </div>
    );
  }

  const chip = (on: boolean) =>
    ({
      border: `1px solid ${on ? '#0369A1' : 'var(--border)'}`,
      background: on ? '#E0F2FE' : '#fff',
      color: on ? '#0369A1' : 'var(--text)',
      borderRadius: 8,
      padding: '7px 12px',
      fontSize: 12.5,
      fontWeight: 600,
      cursor: 'pointer',
    }) as const;

  const filteredUsers = staff.filter((u) => {
    const q = userSearch.trim().toLowerCase();
    return !q || u.fullName.toLowerCase().includes(q) || `crs ${u.crsId}`.includes(q) || u.role.toLowerCase().includes(q);
  });

  const rows = (report?.rows ?? []).filter((r) => (reportFilter === 'all' ? true : reportFilter === 'read' ? r.isRead : !r.isRead));

  return (
    <div className="page active" id="page-messages">
      <div className="page-header">
        <div className="page-title">Messages / Announcements</div>
        <div className="page-sub">Write to shop staff, and see exactly who has read it and when</div>
      </div>

      {!installed ? (
        <div className="card" style={{ padding: 16, marginBottom: 14, background: '#FFFBEB', borderColor: '#FDE68A', color: '#92400E', fontSize: 13 }}>
          <strong>Messages are not set up yet.</strong> Run <code>supabase/migrations/0005_notifications.sql</code> on the database, then reload this page.
        </div>
      ) : null}

      {banner ? (
        <div
          className="card"
          style={{ padding: '10px 14px', marginBottom: 14, background: banner.ok ? '#DCFCE7' : '#FEE2E2', borderColor: banner.ok ? '#86EFAC' : '#FECACA', color: banner.ok ? '#166534' : '#991B1B', fontSize: 13, fontWeight: 600 }}
        >
          {banner.ok ? '✓ ' : '⚠ '}
          {banner.text}
        </div>
      ) : null}

      <div className="card" style={{ padding: 18, marginBottom: 18 }}>
        <div style={{ fontWeight: 800, fontSize: 15, marginBottom: 14 }}>📣 New message</div>

        <div style={{ marginBottom: 14 }}>
          <label style={label} htmlFor="msg-title">
            Title
          </label>
          <input id="msg-title" style={input} value={title} maxLength={TITLE_MAX} onChange={(e) => setTitle(e.target.value)} placeholder="e.g. Complete September entries today" />
        </div>

        <div style={{ marginBottom: 14 }}>
          <label style={label} htmlFor="msg-body">
            Message
          </label>
          <textarea
            id="msg-body"
            style={{ ...input, minHeight: 190, resize: 'vertical', lineHeight: 1.55 }}
            value={body}
            maxLength={MESSAGE_MAX}
            onChange={(e) => setBody(e.target.value)}
            placeholder="Type the detailed message here. Line breaks are kept exactly as typed."
          />
          <div style={{ textAlign: 'right', fontSize: 11, color: 'var(--muted)', marginTop: 4 }}>
            {body.length.toLocaleString('en-IN')} / {MESSAGE_MAX.toLocaleString('en-IN')}
          </div>
        </div>

        <div style={{ marginBottom: 16 }}>
          <span style={label}>Priority</span>
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
            {PRIORITIES.map((p) => (
              <button key={p} type="button" onClick={() => setPriority(p)} style={chip(priority === p)}>
                {p === 'normal' ? 'Normal' : p === 'important' ? '⚠ Important' : '🚨 Urgent'}
              </button>
            ))}
          </div>
          <div style={{ fontSize: 11.5, color: 'var(--muted)', marginTop: 6 }}>
            {priority === 'normal'
              ? 'Appears in their notifications.'
              : 'Also pops up after sign-in for each recipient until they press Acknowledge. It is not counted as read until they do.'}
          </div>
        </div>

        <div style={{ marginBottom: 12 }}>
          <span style={label}>Send to</span>
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
            {MODES.map((m) => (
              <button key={m.id} type="button" onClick={() => setMode(m.id)} style={chip(mode === m.id)}>
                {mode === m.id ? '● ' : '○ '}
                {m.label}
              </button>
            ))}
          </div>
        </div>

        <div style={{ background: '#F8FAFC', border: '1px solid var(--border)', borderRadius: 10, padding: 14, marginBottom: 14 }}>
          {mode === 'users' ? (
            <>
              <input style={{ ...input, marginBottom: 10 }} placeholder="Search by name, CRS number or role" value={userSearch} onChange={(e) => setUserSearch(e.target.value)} />
              <div style={{ maxHeight: 240, overflowY: 'auto', display: 'grid', gap: 4 }}>
                {filteredUsers.map((u) => (
                  <label key={u.id} style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 13, padding: '4px 2px', cursor: 'pointer' }}>
                    <input
                      type="checkbox"
                      checked={userIds.includes(u.id)}
                      onChange={(e) => setUserIds((prev) => (e.target.checked ? [...prev, u.id] : prev.filter((x) => x !== u.id)))}
                    />
                    <span style={{ fontWeight: 600 }}>{u.fullName}</span>
                    <span style={{ color: 'var(--muted)', fontSize: 12 }}>
                      {u.role} · {shopLabel(u.crsId)}
                    </span>
                  </label>
                ))}
                {!filteredUsers.length ? <div style={{ fontSize: 12, color: 'var(--muted)' }}>No active shop staff match.</div> : null}
              </div>
            </>
          ) : mode === 'shop' || mode === 'shops' ? (
            <>
              {mode === 'shop' ? (
                <select style={{ ...input, marginBottom: 12 }} value={shopId} onChange={(e) => setShopId(e.target.value)}>
                  <option value="">Select a CRS shop…</option>
                  {shops.map((s) => (
                    <option key={s.id} value={s.id}>
                      {shopLabel(s.id)}
                    </option>
                  ))}
                </select>
              ) : (
                <>
                  <div style={{ display: 'flex', gap: 8, marginBottom: 8 }}>
                    <button type="button" style={chip(false)} onClick={() => setShopIds(shops.map((s) => s.id))}>
                      Select all
                    </button>
                    <button type="button" style={chip(false)} onClick={() => setShopIds([])}>
                      Clear
                    </button>
                  </div>
                  <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(210px, 1fr))', gap: 4, maxHeight: 260, overflowY: 'auto', marginBottom: 12 }}>
                    {shops.map((s) => (
                      <label key={s.id} style={{ display: 'flex', alignItems: 'center', gap: 7, fontSize: 12.5, cursor: 'pointer', padding: '3px 2px' }}>
                        <input
                          type="checkbox"
                          checked={shopIds.includes(s.id)}
                          onChange={(e) => setShopIds((prev) => (e.target.checked ? [...prev, s.id] : prev.filter((x) => x !== s.id)))}
                        />
                        {shopLabel(s.id)}
                      </label>
                    ))}
                  </div>
                </>
              )}
              <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                {ROLE_CHOICES.map((r) => (
                  <button key={r.id} type="button" onClick={() => setRoleChoice(r.id)} style={chip(roleChoice === r.id)}>
                    {roleChoice === r.id ? '● ' : '○ '}
                    {r.label}
                  </button>
                ))}
              </div>
            </>
          ) : mode === 'roles' ? (
            <div style={{ display: 'flex', gap: 16 }}>
              {(['BC', 'Packer'] as StaffRole[]).map((r) => (
                <label key={r} style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 13, cursor: 'pointer' }}>
                  <input type="checkbox" checked={pickRoles.includes(r)} onChange={(e) => setPickRoles((prev) => (e.target.checked ? [...prev, r] : prev.filter((x) => x !== r)))} />
                  {r === 'BC' ? 'Bill Clerks (BC)' : 'Packers'} — every shop
                </label>
              ))}
            </div>
          ) : (
            <div style={{ fontSize: 13 }}>Every active BC and Packer in every CRS shop.</div>
          )}
        </div>

        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12, flexWrap: 'wrap' }}>
          <div style={{ fontSize: 13 }}>
            {audience ? (
              reach.length ? (
                <>
                  This will reach <strong>{reach.length}</strong> {reach.length === 1 ? 'person' : 'people'}
                  <span style={{ color: 'var(--muted)' }}> — {describeAudience(audience)}</span>
                  <details style={{ marginTop: 4 }}>
                    <summary style={{ cursor: 'pointer', fontSize: 12, color: '#0369A1' }}>Show recipients</summary>
                    <div style={{ fontSize: 12, color: 'var(--muted)', marginTop: 4, lineHeight: 1.6 }}>
                      {reach.map((u) => `CRS ${u.crsId} · ${u.fullName} (${u.role})`).join(' · ')}
                    </div>
                  </details>
                </>
              ) : (
                <span style={{ color: '#B45309' }}>Nobody matches — no active BC or Packer is assigned there.</span>
              )
            ) : (
              <span style={{ color: 'var(--muted)' }}>Choose who the message is for.</span>
            )}
          </div>
          <button
            type="button"
            disabled={sending || !installed || !audience || !reach.length || !title.trim() || !body.trim()}
            onClick={() => void send()}
            style={{
              background: sending || !installed || !audience || !reach.length || !title.trim() || !body.trim() ? '#CBD5E1' : 'linear-gradient(135deg,#0284C7,#0EA5E9)',
              color: '#fff',
              border: 'none',
              padding: '10px 22px',
              borderRadius: 9,
              fontWeight: 700,
              fontSize: 13.5,
              cursor: sending ? 'wait' : 'pointer',
            }}
          >
            {sending ? 'Sending…' : '📤 Send message'}
          </button>
        </div>
      </div>

      <div className="card" style={{ padding: 0, overflow: 'hidden' }}>
        <div style={{ padding: '14px 18px', display: 'flex', justifyContent: 'space-between', alignItems: 'center', borderBottom: '1px solid var(--border)' }}>
          <div style={{ fontWeight: 800, fontSize: 15 }}>Sent messages</div>
          <button type="button" onClick={() => void loadSent()} style={chip(false)}>
            ↻ Refresh
          </button>
        </div>
        {loadingSent ? (
          <div style={{ padding: 24, textAlign: 'center', color: 'var(--muted)' }}>Loading…</div>
        ) : !sent.length ? (
          <div style={{ padding: 28, textAlign: 'center', color: 'var(--muted)', fontSize: 13 }}>No messages sent yet.</div>
        ) : (
          sent.map((m) => {
            const pr = PRIORITY_STYLE[m.priority];
            const stat = (n: number, text: string, color: string) => (
              <div style={{ textAlign: 'center', minWidth: 70 }}>
                <div style={{ fontSize: 18, fontWeight: 800, color }}>{n}</div>
                <div style={{ fontSize: 10, color: 'var(--muted)', textTransform: 'uppercase', letterSpacing: '.04em' }}>{text}</div>
              </div>
            );
            return (
              <div key={m.id} style={{ padding: '14px 18px', borderBottom: '1px solid #F1F5F9', borderLeft: `4px solid ${pr.bar}` }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12, flexWrap: 'wrap' }}>
                  <div style={{ minWidth: 0, flex: '1 1 320px' }}>
                    <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
                      <span style={{ fontWeight: 700, fontSize: 14 }}>{m.title}</span>
                      {pr.label ? <span style={{ fontSize: 10, fontWeight: 800, color: pr.fg, background: pr.bg, padding: '1px 7px', borderRadius: 4, textTransform: 'uppercase' }}>{pr.label}</span> : null}
                    </div>
                    <div style={{ fontSize: 12, color: 'var(--muted)', marginTop: 3 }}>
                      {m.audienceLabel} · Sent {fmtWhen(m.createdAt)}
                      {m.senderName ? ` by ${m.senderName}` : ''}
                    </div>
                    <div style={{ fontSize: 12.5, marginTop: 6, whiteSpace: 'pre-wrap', display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical', overflow: 'hidden' }}>{m.message}</div>
                  </div>
                  <div style={{ display: 'flex', gap: 6, alignItems: 'center', flexWrap: 'wrap' }}>
                    {stat(m.stats.recipients, 'Recipients', '#0F172A')}
                    {stat(m.stats.delivered, 'Delivered', '#0369A1')}
                    {stat(m.stats.read, 'Read', '#166534')}
                    {stat(m.stats.unread, 'Unread', m.stats.unread ? '#B45309' : '#94A3B8')}
                    {m.requiresAck ? stat(m.stats.acknowledged, 'Acknowledged', '#7C3AED') : null}
                    <button type="button" onClick={() => void openReport(m)} style={{ ...chip(false), color: '#0369A1', borderColor: '#BAE6FD', marginLeft: 6 }}>
                      View Read Details
                    </button>
                  </div>
                </div>
              </div>
            );
          })
        )}
      </div>

      {report ? (
        <div className="modal-bg" style={{ display: 'flex' }} onClick={(e) => e.target === e.currentTarget && setReport(null)}>
          <div className="modal" style={{ maxWidth: 860, width: 'calc(100vw - 24px)' }}>
            <div className="modal-head" style={{ background: 'linear-gradient(135deg,#0369A1,#0EA5E9)' }}>
              <div style={{ fontWeight: 800 }}>Read details — {report.msg.title}</div>
            </div>
            <div style={{ padding: 16 }}>
              {report.stats ? (
                <div style={{ display: 'flex', gap: 14, flexWrap: 'wrap', fontSize: 13, marginBottom: 12 }}>
                  <span>
                    Recipients <strong>{report.stats.recipients}</strong>
                  </span>
                  <span>
                    Delivered <strong>{report.stats.delivered}</strong>
                  </span>
                  <span style={{ color: '#166534' }}>
                    Read <strong>{report.stats.read}</strong>
                  </span>
                  <span style={{ color: '#B45309' }}>
                    Unread <strong>{report.stats.unread}</strong>
                  </span>
                  {report.msg.requiresAck ? (
                    <span style={{ color: '#7C3AED' }}>
                      Acknowledged <strong>{report.stats.acknowledged}</strong>
                    </span>
                  ) : null}
                </div>
              ) : null}
              <div style={{ display: 'flex', gap: 6, marginBottom: 10 }}>
                {(['all', 'read', 'unread'] as const).map((f) => (
                  <button key={f} type="button" onClick={() => setReportFilter(f)} style={chip(reportFilter === f)}>
                    {f === 'all' ? 'All' : f === 'read' ? 'Read' : 'Unread'}
                  </button>
                ))}
              </div>
              {report.err ? <div style={{ color: '#B91C1C', fontSize: 13 }}>{report.err}</div> : null}
              {!report.rows ? (
                <div style={{ padding: 20, textAlign: 'center', color: 'var(--muted)' }}>Loading…</div>
              ) : (
                <div style={{ overflowX: 'auto', maxHeight: '60vh', overflowY: 'auto' }}>
                  <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12.5, minWidth: 640 }}>
                    <thead>
                      <tr style={{ background: '#F8FAFC', textAlign: 'left' }}>
                        {['CRS', 'User', 'Role', 'Status', 'Delivered', 'Read At', report.msg.requiresAck ? 'Acknowledged' : ''].filter(Boolean).map((h) => (
                          <th key={h} style={{ padding: '8px 10px', fontSize: 10.5, color: 'var(--muted)', textTransform: 'uppercase', borderBottom: '1px solid var(--border)', position: 'sticky', top: 0, background: '#F8FAFC' }}>
                            {h}
                          </th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {rows.map((r) => (
                        <tr key={r.userId} style={{ borderBottom: '1px solid #F1F5F9' }}>
                          <td style={{ padding: '7px 10px', fontWeight: 700, color: '#0369A1' }}>{r.crsId ? `CRS ${r.crsId}` : '—'}</td>
                          <td style={{ padding: '7px 10px' }}>{r.name}</td>
                          <td style={{ padding: '7px 10px' }}>{r.role}</td>
                          <td style={{ padding: '7px 10px' }}>
                            {r.isRead ? (
                              <span style={{ color: '#166534', background: '#DCFCE7', fontWeight: 700, padding: '1px 8px', borderRadius: 4 }}>Read</span>
                            ) : r.deliveredAt ? (
                              <span style={{ color: '#0369A1', background: '#E0F2FE', fontWeight: 700, padding: '1px 8px', borderRadius: 4 }}>Delivered</span>
                            ) : (
                              <span style={{ color: '#92400E', background: '#FEF3C7', fontWeight: 700, padding: '1px 8px', borderRadius: 4 }}>Unread</span>
                            )}
                          </td>
                          <td style={{ padding: '7px 10px', color: 'var(--muted)' }}>{fmtWhen(r.deliveredAt)}</td>
                          <td style={{ padding: '7px 10px', fontWeight: r.readAt ? 600 : 400 }}>{fmtWhen(r.readAt)}</td>
                          {report.msg.requiresAck ? <td style={{ padding: '7px 10px' }}>{fmtWhen(r.acknowledgedAt)}</td> : null}
                        </tr>
                      ))}
                      {!rows.length && report.rows ? (
                        <tr>
                          <td colSpan={7} style={{ padding: 16, textAlign: 'center', color: 'var(--muted)' }}>
                            Nobody in this view.
                          </td>
                        </tr>
                      ) : null}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
            <div style={{ display: 'flex', justifyContent: 'flex-end', padding: '0 16px 16px' }}>
              <button type="button" onClick={() => setReport(null)} style={chip(false)}>
                Close
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}
