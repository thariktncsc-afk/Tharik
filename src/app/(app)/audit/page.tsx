'use client';

/**
 * Activity Log — every action across every CRS shop, for administrators only.
 *
 * The rows come from the activity log (migration 0006), written on the server
 * at the moment data changes (src/lib/activityLog). /api/activity/log refuses
 * anyone but an administrator; the guard below is the page's manners.
 *
 * Two dates on every row, never confused: the ENTRY date is the day the data
 * belongs to, the activity time is when somebody acted. Updating 1 September's
 * sheet on 17 September shows under 17 September, Entry Date 01-09-2026.
 *
 * Live: while the page is open, rows logged since it loaded are added at the
 * top within a few seconds (dataStore.ts live sync) — only rows matching the
 * current filters, and never twice.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useAuth } from '@/lib/authClient';
import { useLiveRevision, useUsers } from '@/lib/dataStore';
import { useShops } from '@/lib/masters';
import { ACTION_LABEL, ACTIONS, MODULES, entryLabel, roleLabel, type ActivityRow } from '@/lib/activityLog/core';

const IST = 'Asia/Kolkata';
const isoInIst = (d: Date) => new Intl.DateTimeFormat('en-CA', { timeZone: IST }).format(d);
const todayIso = () => isoInIst(new Date());
const shift = (iso: string, days: number) => {
  const d = new Date(`${iso}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
};
const dmy = (iso: string) => iso.split('-').reverse().join('-');
const dayHeading = (iso: string) =>
  new Date(`${iso}T00:00:00`).toLocaleDateString('en-IN', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' });
const timeOf = (at: string) => new Date(at).toLocaleTimeString('en-IN', { timeZone: IST, hour: '2-digit', minute: '2-digit', hour12: true });
const stampOf = (at: string) =>
  new Date(at).toLocaleString('en-IN', { timeZone: IST, day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: true });

type Range = 'today' | 'yesterday' | 'week' | 'month' | 'custom';
const RANGES: [Range, string][] = [
  ['today', 'Today'],
  ['yesterday', 'Yesterday'],
  ['week', 'Last 7 Days'],
  ['month', 'This Month'],
  ['custom', 'Custom Date'],
];

function bounds(range: Range, from: string, to: string): [string, string] {
  const t = todayIso();
  if (range === 'today') return [t, t];
  if (range === 'yesterday') return [shift(t, -1), shift(t, -1)];
  if (range === 'week') return [shift(t, -6), t];
  if (range === 'month') return [`${t.slice(0, 8)}01`, t];
  const f = from || t;
  const e = to || f;
  return f <= e ? [f, e] : [e, f];
}

const TONE: Record<string, { bg: string; fg: string }> = {
  created: { bg: '#DCFCE7', fg: '#15803D' },
  updated: { bg: '#DBEAFE', fg: '#1D4ED8' },
  closed: { bg: '#EDE9FE', fg: '#6D28D9' },
  deleted: { bg: '#FEE2E2', fg: '#B91C1C' },
  cleared: { bg: '#FEE2E2', fg: '#B91C1C' },
  refused: { bg: '#FEE2E2', fg: '#B91C1C' },
  failed: { bg: '#FEE2E2', fg: '#B91C1C' },
  rejected: { bg: '#FEE2E2', fg: '#B91C1C' },
  requested: { bg: '#FEF3C7', fg: '#92400E' },
  submitted: { bg: '#FEF3C7', fg: '#92400E' },
  approved: { bg: '#DCFCE7', fg: '#15803D' },
  recalculated: { bg: '#F1F5F9', fg: '#475569' },
};
const toneOf = (a: string) => TONE[a] ?? { bg: '#F1F5F9', fg: '#475569' };

/** Who the row names, by what they did. */
function doneByLabel(r: ActivityRow): string {
  if (r.source === 'system') return 'Triggered by';
  if (r.action === 'created') return 'Created by';
  if (r.action === 'deleted' || r.action === 'cleared') return r.action === 'cleared' ? 'Cleared by' : 'Deleted by';
  if (r.action === 'approved' || r.action === 'rejected') return 'Decided by';
  return 'Updated by';
}

const selectStyle: React.CSSProperties = { width: '100%', fontSize: 12.5, padding: '7px 10px', borderRadius: 8, border: '1px solid var(--border)', background: '#fff' };
const labelStyle: React.CSSProperties = { display: 'block', fontSize: 10.5, fontWeight: 700, color: 'var(--muted)', textTransform: 'uppercase', letterSpacing: '.05em', marginBottom: 4 };

export default function ActivityLogPage() {
  const { user } = useAuth();
  const isAdmin = user?.role === 'ADMIN';
  const shops = useShops();
  const users = useUsers();

  const [range, setRange] = useState<Range>('today');
  const [customFrom, setCustomFrom] = useState(todayIso());
  const [customTo, setCustomTo] = useState(todayIso());
  const [crsId, setCrsId] = useState('');
  const [userId, setUserId] = useState('');
  const [module, setModule] = useState('');
  const [action, setAction] = useState('');
  const [source, setSource] = useState('');

  const [items, setItems] = useState<ActivityRow[]>([]);
  const [cursor, setCursor] = useState<number | null>(null);
  const [loading, setLoading] = useState(true);
  const [more, setMore] = useState(false);
  const [error, setError] = useState('');
  const [hint, setHint] = useState('');
  const [open, setOpen] = useState<number | null>(null);
  const [fresh, setFresh] = useState<Set<number>>(new Set());

  const [from, to] = bounds(range, customFrom, customTo);
  const query = useMemo(() => {
    const q = new URLSearchParams({ from, to, limit: '100' });
    if (crsId) q.set('crsId', crsId);
    if (userId) q.set('userId', userId);
    if (module) q.set('module', module);
    if (action) q.set('action', action);
    if (source) q.set('source', source);
    return q.toString();
  }, [from, to, crsId, userId, module, action, source]);

  const fetchLog = useCallback(async (extra: string) => {
    const r = await fetch(`/api/activity/log?${query}${extra}`, { cache: 'no-store', headers: { Accept: 'application/json' } });
    const b = await r.json().catch(() => ({}));
    if (!r.ok) throw new Error(b?.error || `Server returned ${r.status}`);
    return b as { installed: boolean; items: ActivityRow[]; nextCursor: number | null; hint?: string };
  }, [query]);

  // The filters changed: start the list again.
  useEffect(() => {
    if (!isAdmin) return;
    let alive = true;
    setLoading(true);
    setError('');
    setOpen(null);
    fetchLog('')
      .then((b) => {
        if (!alive) return;
        setItems(b.items);
        setCursor(b.nextCursor);
        setHint(b.installed ? '' : b.hint || 'The activity log is not installed yet.');
      })
      .catch((e) => alive && setError(e instanceof Error ? e.message : String(e)))
      .finally(() => alive && setLoading(false));
    return () => {
      alive = false;
    };
  }, [fetchLog, isAdmin]);

  // Live: rows logged since, matching the same filters, added at the top once.
  const rev = useLiveRevision('activity');
  const itemsRef = useRef(items);
  itemsRef.current = items;
  useEffect(() => {
    if (!isAdmin || !rev || loading || hint) return;
    const top = itemsRef.current[0]?.id ?? 0;
    let alive = true;
    fetchLog(`&after=${top}`)
      .then((b) => {
        if (!alive || !b.items.length) return;
        setItems((cur) => {
          const seen = new Set(cur.map((i) => i.id));
          return [...b.items.filter((i) => !seen.has(i.id)), ...cur];
        });
        const ids = new Set(b.items.map((i) => i.id));
        setFresh(ids);
        setTimeout(() => setFresh(new Set()), 4000);
      })
      .catch(() => {
        /* the next beat tries again */
      });
    return () => {
      alive = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rev]);

  const loadMore = async () => {
    if (!cursor) return;
    setMore(true);
    try {
      const b = await fetchLog(`&before=${cursor}`);
      setItems((cur) => [...cur, ...b.items.filter((i) => !cur.some((c) => c.id === i.id))]);
      setCursor(b.nextCursor);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setMore(false);
    }
  };

  const groups = useMemo(() => {
    const out: { day: string; rows: ActivityRow[] }[] = [];
    for (const r of items) {
      const day = isoInIst(new Date(r.at));
      const last = out[out.length - 1];
      if (last && last.day === day) last.rows.push(r);
      else out.push({ day, rows: [r] });
    }
    return out;
  }, [items]);

  const staff = useMemo(
    () => [...users].sort((a, b) => (a.crsId ?? 0) - (b.crsId ?? 0) || String(a.fullName).localeCompare(String(b.fullName))),
    [users],
  );

  const filtered = !!(crsId || userId || module || action || source);
  const rangeText = from === to ? dmy(from) : `${dmy(from)} to ${dmy(to)}`;

  if (!isAdmin) {
    return (
      <div className="page active">
        <div className="card" style={{ padding: 30, textAlign: 'center', color: 'var(--muted)' }}>The activity log is for administrators only.</div>
      </div>
    );
  }

  return (
    <div className="page active" id="page-audit">
      <div className="page-header" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', flexWrap: 'wrap', gap: 10 }}>
        <div>
          <div className="page-title">Activity Log</div>
          <div className="page-sub">Every action across all CRS shops — who did it, to which date&apos;s data, and when</div>
        </div>
        <span title="New activity appears here automatically" style={{ display: 'inline-flex', alignItems: 'center', gap: 6, fontSize: 12, fontWeight: 700, color: '#15803D', background: '#DCFCE7', border: '1px solid #86EFAC', borderRadius: 999, padding: '5px 12px' }}>
          <span style={{ width: 8, height: 8, borderRadius: '50%', background: '#16A34A' }} /> Live
        </span>
      </div>

      {hint ? (
        <div style={{ background: '#FFFBEB', border: '1px solid #FDE68A', color: '#92400E', borderRadius: 10, padding: '12px 16px', marginBottom: 14, fontSize: 13 }}>
          <strong>Not recording yet.</strong> {hint} Until then nothing is logged; everything else in the app works as before.
        </div>
      ) : null}

      <div className="card" style={{ marginBottom: 14 }}>
        <div className="card-body" style={{ display: 'grid', gap: 12 }}>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, alignItems: 'center' }}>
            {RANGES.map(([id, label]) => (
              <button
                key={id}
                type="button"
                onClick={() => setRange(id)}
                style={{
                  border: `1px solid ${range === id ? '#0369A1' : 'var(--border)'}`,
                  background: range === id ? '#E0F2FE' : '#fff',
                  color: range === id ? '#0369A1' : 'var(--text)',
                  borderRadius: 8, padding: '7px 12px', fontSize: 12.5, fontWeight: 700, cursor: 'pointer',
                }}
              >
                {label}
              </button>
            ))}
            {range === 'custom' ? (
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, alignItems: 'center' }}>
                <input type="date" value={customFrom} max={todayIso()} onChange={(e) => setCustomFrom(e.target.value)} style={{ ...selectStyle, width: 'auto' }} aria-label="From date" />
                <span style={{ fontSize: 12, color: 'var(--muted)' }}>to</span>
                <input type="date" value={customTo} max={todayIso()} onChange={(e) => setCustomTo(e.target.value)} style={{ ...selectStyle, width: 'auto' }} aria-label="To date" />
              </div>
            ) : null}
          </div>

          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(170px, 1fr))', gap: 10 }}>
            <div>
              <label style={labelStyle}>CRS Shop</label>
              <select value={crsId} onChange={(e) => setCrsId(e.target.value)} style={selectStyle}>
                <option value="">All shops</option>
                {shops.map((s) => (
                  <option key={s.id} value={s.id}>
                    CRS {s.id} — {s.name}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label style={labelStyle}>User</label>
              <select value={userId} onChange={(e) => setUserId(e.target.value)} style={selectStyle}>
                <option value="">All users</option>
                {staff.map((u) => (
                  <option key={u.id} value={u.id}>
                    {u.fullName || u.username} ({roleLabel(u.role)}){u.crsId ? ` · CRS ${u.crsId}` : ''}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label style={labelStyle}>Module</label>
              <select value={module} onChange={(e) => setModule(e.target.value)} style={selectStyle}>
                <option value="">All modules</option>
                {MODULES.map((m) => (
                  <option key={m}>{m}</option>
                ))}
              </select>
            </div>
            <div>
              <label style={labelStyle}>Action Type</label>
              <select value={action} onChange={(e) => setAction(e.target.value)} style={selectStyle}>
                <option value="">All actions</option>
                {ACTIONS.map((a) => (
                  <option key={a} value={a}>
                    {ACTION_LABEL[a]}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label style={labelStyle}>Done by</label>
              <select value={source} onChange={(e) => setSource(e.target.value)} style={selectStyle}>
                <option value="">People and system</option>
                <option value="user">People only</option>
                <option value="system">System updates only</option>
              </select>
            </div>
          </div>

          <div style={{ display: 'flex', flexWrap: 'wrap', justifyContent: 'space-between', alignItems: 'center', gap: 8, fontSize: 12.5, color: 'var(--muted)' }}>
            <span>
              {loading ? 'Loading…' : `${items.length}${cursor ? '+' : ''} ${items.length === 1 ? 'activity' : 'activities'}`} · {rangeText}
            </span>
            {filtered ? (
              <button
                type="button"
                className="btn btn-outline btn-sm"
                onClick={() => {
                  setCrsId('');
                  setUserId('');
                  setModule('');
                  setAction('');
                  setSource('');
                }}
              >
                Clear filters
              </button>
            ) : null}
          </div>
        </div>
      </div>

      {error ? (
        <div style={{ background: '#FEF2F2', border: '1px solid #FCA5A5', color: '#B91C1C', borderRadius: 10, padding: '10px 14px', marginBottom: 14, fontSize: 13 }}>{error}</div>
      ) : null}

      {!loading && !items.length && !hint ? (
        <div className="card" style={{ padding: 30, textAlign: 'center', color: 'var(--muted)', fontSize: 13 }}>
          Nothing recorded {from === to ? `on ${dmy(from)}` : `from ${dmy(from)} to ${dmy(to)}`}
          {filtered ? ' for these filters' : ''}.
        </div>
      ) : null}

      {groups.map((g) => (
        <div key={g.day} className="card" style={{ marginBottom: 14, overflow: 'hidden' }}>
          <div style={{ padding: '10px 16px', background: '#F8FAFC', borderBottom: '1px solid #E2E8F0', fontSize: 12.5, fontWeight: 800, color: '#334155' }}>
            {dayHeading(g.day)} <span style={{ fontWeight: 500, color: 'var(--muted)' }}>· {g.rows.length}</span>
          </div>
          {g.rows.map((r) => {
            const tone = toneOf(r.action);
            const expanded = open === r.id;
            const entry = entryLabel(r);
            return (
              <div key={r.id} style={{ borderBottom: '1px solid #F1F5F9', background: fresh.has(r.id) ? '#F0FDF4' : '#fff', transition: 'background .6s' }}>
                <button
                  type="button"
                  onClick={() => setOpen(expanded ? null : r.id)}
                  aria-expanded={expanded}
                  style={{ display: 'flex', gap: 12, width: '100%', textAlign: 'left', background: 'transparent', border: 'none', padding: '12px 16px', cursor: 'pointer', alignItems: 'flex-start' }}
                >
                  <span style={{ minWidth: 70, fontSize: 12, fontWeight: 700, color: '#475569', paddingTop: 2 }}>{timeOf(r.at)}</span>
                  <span style={{ flex: 1, minWidth: 0 }}>
                    <span style={{ display: 'block', fontSize: 13, color: '#0F172A' }}>
                      <strong>{r.crsId ? `CRS ${r.crsId}${r.shopName ? ` — ${r.shopName}` : ''}` : 'Office'}</strong>
                      <span style={{ color: '#64748B' }}> · </span>
                      {r.actorName || r.actorUsername}
                      {r.actorRole ? <span style={{ color: '#64748B' }}> ({roleLabel(r.actorRole)})</span> : null}
                    </span>
                    <span style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: 6, marginTop: 4, fontSize: 12.5, color: '#334155' }}>
                      <span>{r.module}</span>
                      {entry ? <span style={{ color: '#64748B' }}>· {entry}</span> : null}
                      <span style={{ background: tone.bg, color: tone.fg, fontWeight: 800, fontSize: 11, borderRadius: 6, padding: '2px 8px' }}>{ACTION_LABEL[r.action] ?? r.action}</span>
                      {r.source === 'system' ? (
                        <span style={{ border: '1px dashed #94A3B8', color: '#475569', fontSize: 10.5, fontWeight: 700, borderRadius: 6, padding: '1px 6px' }}>Automatic</span>
                      ) : null}
                    </span>
                    {r.summary ? (
                      <span style={{ display: 'block', marginTop: 3, fontSize: 12, color: '#64748B', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: expanded ? 'normal' : 'nowrap' }}>{r.summary}</span>
                    ) : null}
                  </span>
                  <span style={{ fontSize: 12, color: '#94A3B8', paddingTop: 2 }}>{expanded ? '▲' : '▼'}</span>
                </button>

                {expanded ? (
                  <div style={{ padding: '0 16px 16px' }}>
                    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(190px, 1fr))', gap: 10, background: '#F8FAFC', border: '1px solid #E2E8F0', borderRadius: 10, padding: 12, fontSize: 12.5 }}>
                      {(
                        [
                          ['CRS Shop', r.crsId ? `CRS ${r.crsId}${r.shopName ? ` — ${r.shopName}` : ''}` : '—'],
                          [r.entryDate ? 'Entry Date' : 'Entry Period', entry || '—'],
                          ['Module', r.module],
                          ['Action', `${ACTION_LABEL[r.action] ?? r.action}${r.source === 'system' ? ' (automatic recalculation)' : ''}`],
                          [doneByLabel(r), `${r.actorName || r.actorUsername}${r.actorRole ? ` (${roleLabel(r.actorRole)})` : ''}${r.actorUsername && r.actorName !== r.actorUsername ? ` · ${r.actorUsername}` : ''}`],
                          ['Activity Time', stampOf(r.at)],
                        ] as [string, string][]
                      ).map(([k, v]) => (
                        <div key={k}>
                          <div style={labelStyle}>{k}</div>
                          <div style={{ color: '#0F172A', fontWeight: 600 }}>{v}</div>
                        </div>
                      ))}
                      {r.relatedId && (r.module === 'Clear Request' || r.action === 'cleared') ? (
                        <div>
                          <div style={labelStyle}>Request</div>
                          <a href={`/clear-requests?id=${r.relatedId}`} style={{ fontWeight: 700, color: '#0369A1' }}>#{r.relatedId} →</a>
                        </div>
                      ) : null}
                      {r.relatedId && r.module === 'Payment' ? (
                        <div>
                          <div style={labelStyle}>Order</div>
                          <a href={`/payments?id=${r.relatedId}`} style={{ fontWeight: 700, color: '#0369A1' }}>{r.recordKey ?? `#${r.relatedId}`} →</a>
                        </div>
                      ) : null}
                    </div>

                    {r.changes.length ? (
                      <div style={{ marginTop: 12, overflowX: 'auto', border: '1px solid #E2E8F0', borderRadius: 10 }}>
                        <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12.5, minWidth: 420 }}>
                          <thead>
                            <tr style={{ background: '#F8FAFC' }}>
                              <th style={{ textAlign: 'left', padding: '8px 12px', fontSize: 10.5, color: 'var(--muted)', textTransform: 'uppercase', letterSpacing: '.05em' }}>What</th>
                              <th style={{ textAlign: 'right', padding: '8px 12px', fontSize: 10.5, color: 'var(--muted)', textTransform: 'uppercase', letterSpacing: '.05em' }}>Before</th>
                              <th style={{ width: 24 }} />
                              <th style={{ textAlign: 'left', padding: '8px 12px', fontSize: 10.5, color: 'var(--muted)', textTransform: 'uppercase', letterSpacing: '.05em' }}>After</th>
                            </tr>
                          </thead>
                          <tbody>
                            {r.changes.map((c, i) => (
                              <tr key={i} style={{ borderTop: '1px solid #F1F5F9' }}>
                                <td style={{ padding: '7px 12px', color: '#334155' }}>{c.label}</td>
                                <td style={{ padding: '7px 12px', textAlign: 'right', color: c.before ? '#B91C1C' : '#94A3B8', fontVariantNumeric: 'tabular-nums' }}>{c.before || ''}</td>
                                <td style={{ textAlign: 'center', color: '#94A3B8' }}>{c.before ? '→' : ''}</td>
                                <td style={{ padding: '7px 12px', color: '#15803D', fontWeight: 700, fontVariantNumeric: 'tabular-nums' }}>{c.after}</td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>
                    ) : (
                      <div style={{ marginTop: 10, fontSize: 12, color: 'var(--muted)' }}>No figure-level detail for this action.</div>
                    )}
                  </div>
                ) : null}
              </div>
            );
          })}
        </div>
      ))}

      {cursor ? (
        <div style={{ textAlign: 'center', marginBottom: 20 }}>
          <button type="button" className="btn btn-outline" disabled={more} onClick={() => void loadMore()}>
            {more ? 'Loading…' : 'Load earlier activity'}
          </button>
        </div>
      ) : null}
    </div>
  );
}
