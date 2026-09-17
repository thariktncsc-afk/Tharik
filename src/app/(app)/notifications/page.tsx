'use client';

/**
 * Notification history — everything addressed to the signed-in person, with
 * the same filters as the bell and room to read each one properly.
 *
 * A request's "View request" opens the exact record on the page where it is
 * decided. Approve and Reject are not duplicated here: approving a clear
 * performs a deletion and rejecting a payment needs a reason, and those
 * controls already exist, with their own guards, one click away. A second copy
 * of them in a list would be a second place for a destructive action to go
 * wrong.
 */
import { useRouter } from 'next/navigation';
import { Fragment, useCallback, useEffect, useState } from 'react';
import { useAuth } from '@/lib/authClient';
import { statusLabel, type InboxItem } from '@/lib/notify/core';
import {
  FILTER_LABEL,
  PRIORITY_STYLE,
  dayHeading,
  fetchInbox,
  filtersFor,
  fmtWhen,
  iconFor,
  markAllRead,
  markNotification,
  statusStyle,
  toQuery,
  useInboxRevision,
  useInboxSummary,
  type Filter,
} from '@/lib/notify/client';
import MessageView from '@/components/MessageView';

const PAGE = 30;

export default function NotificationsPage() {
  const { user } = useAuth();
  const router = useRouter();
  const isAdmin = user?.role === 'ADMIN';
  const { unread } = useInboxSummary();
  const revision = useInboxRevision();

  const [filter, setFilter] = useState<Filter>('all');
  const [items, setItems] = useState<InboxItem[]>([]);
  const [installed, setInstalled] = useState(true);
  const [loading, setLoading] = useState(true);
  const [more, setMore] = useState(false);
  const [error, setError] = useState('');
  const [reading, setReading] = useState<InboxItem | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const b = await fetchInbox({ ...toQuery(filter), limit: PAGE });
      setInstalled(b.installed);
      setItems(b.items);
      setMore(b.items.length === PAGE);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  }, [filter]);

  useEffect(() => {
    void load();
  }, [load, revision]);

  const older = async () => {
    const last = items[items.length - 1];
    if (!last) return;
    try {
      const b = await fetchInbox({ ...toQuery(filter), limit: PAGE, before: last.createdAt });
      setItems((prev) => [...prev, ...b.items.filter((x) => !prev.some((p) => p.id === x.id))]);
      setMore(b.items.length === PAGE);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  };

  const open = (it: InboxItem) => {
    setReading(it);
    if (!it.openedAt) void markNotification(it.id, 'open').catch(() => undefined);
  };

  const viewRequest = (it: InboxItem) => {
    if (!it.link) return;
    void markNotification(it.id, 'open').catch(() => undefined);
    router.push(it.link);
  };

  const btn = { background: '#fff', border: '1px solid var(--border)', padding: '5px 11px', borderRadius: 7, fontSize: 12, cursor: 'pointer', fontWeight: 600 } as const;

  return (
    <div className="page active" id="page-notifications">
      <div className="page-header" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 12, flexWrap: 'wrap' }}>
        <div>
          <div className="page-title">Notifications</div>
          <div className="page-sub">
            {isAdmin ? 'Approval requests from every shop, decisions, and system notices' : 'Messages from Admin and the outcome of your requests'}
            {unread ? ` · ${unread} unread` : ''}
          </div>
        </div>
        {installed && unread > 0 ? (
          <button type="button" onClick={() => void markAllRead(toQuery(filter).category, toQuery(filter).requests)} style={{ ...btn, color: '#0369A1', padding: '8px 14px' }}>
            Mark all as read{filter !== 'all' && filter !== 'unread' ? ` in ${FILTER_LABEL[filter]}` : ''}
          </button>
        ) : null}
      </div>

      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginBottom: 14 }}>
        {filtersFor(isAdmin).map((f) => (
          <button
            key={f}
            type="button"
            onClick={() => setFilter(f)}
            style={{
              border: `1px solid ${filter === f ? '#0369A1' : 'var(--border)'}`,
              background: filter === f ? '#0369A1' : '#fff',
              color: filter === f ? '#fff' : 'var(--text)',
              borderRadius: 20,
              padding: '6px 14px',
              fontSize: 12,
              fontWeight: 600,
              cursor: 'pointer',
            }}
          >
            {FILTER_LABEL[f]}
          </button>
        ))}
      </div>

      {!installed ? (
        <div className="card" style={{ padding: 18, background: '#FFFBEB', borderColor: '#FDE68A', color: '#92400E', fontSize: 13 }}>
          <strong>Notifications are not set up yet.</strong>{' '}
          {isAdmin ? (
            <>
              Run <code>supabase/migrations/0005_notifications.sql</code> on the database. Payments, clear approvals and every other screen keep working in the meantime.
            </>
          ) : (
            'They will appear here once the office has switched them on.'
          )}
        </div>
      ) : error ? (
        <div className="card" style={{ padding: 16, color: '#B91C1C', fontSize: 13 }}>{error}</div>
      ) : loading && !items.length ? (
        <div className="card" style={{ padding: 30, textAlign: 'center', color: 'var(--muted)' }}>Loading…</div>
      ) : !items.length ? (
        <div className="card" style={{ padding: 40, textAlign: 'center', color: 'var(--muted)' }}>
          <div style={{ fontSize: 34 }}>🔔</div>
          <div style={{ fontWeight: 600, marginTop: 6 }}>No notifications{filter !== 'all' ? ` under ${FILTER_LABEL[filter]}` : ''}</div>
        </div>
      ) : (
        <div className="card" style={{ padding: 0, overflow: 'hidden' }}>
          {items.map((it, i) => {
            const pr = PRIORITY_STYLE[it.priority];
            const st = statusLabel(it.status);
            const sc = statusStyle(it.status);
            // Date-wise history: a heading wherever the day changes.
            const day = dayHeading(it.createdAt);
            const newDay = i === 0 || dayHeading(items[i - 1].createdAt) !== day;
            return (
              <Fragment key={it.id}>
              {newDay ? (
                <div style={{ padding: '8px 16px', background: '#F8FAFC', borderBottom: '1px solid #E2E8F0', fontSize: 11.5, fontWeight: 800, color: '#475569', textTransform: 'uppercase', letterSpacing: 0.4 }}>
                  {day}
                </div>
              ) : null}
              <div
                style={{
                  display: 'flex',
                  gap: 12,
                  padding: '14px 16px',
                  borderBottom: '1px solid #F1F5F9',
                  borderLeft: `4px solid ${pr.bar !== 'transparent' ? pr.bar : it.isRead ? 'transparent' : '#0EA5E9'}`,
                  background: it.isRead ? '#fff' : '#F0F9FF',
                }}
              >
                <div style={{ fontSize: 22, lineHeight: '24px' }}>{iconFor(it)}</div>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
                    <span style={{ fontWeight: it.isRead ? 600 : 800, fontSize: 14 }}>{it.title}</span>
                    {pr.label ? <span style={{ fontSize: 10, fontWeight: 800, color: pr.fg, background: pr.bg, padding: '1px 7px', borderRadius: 4, textTransform: 'uppercase' }}>{pr.label}</span> : null}
                    {st ? <span style={{ fontSize: 11, fontWeight: 700, color: sc.fg, background: sc.bg, padding: '1px 8px', borderRadius: 4 }}>{st}</span> : null}
                    {!it.isRead ? <span style={{ fontSize: 11, fontWeight: 800, color: '#0284C7' }}>● Unread</span> : null}
                  </div>
                  <div style={{ fontSize: 12.5, color: 'var(--muted)', marginTop: 3, whiteSpace: 'pre-wrap', display: '-webkit-box', WebkitLineClamp: 3, WebkitBoxOrient: 'vertical', overflow: 'hidden' }}>
                    {it.message}
                  </div>
                  <div style={{ display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap', marginTop: 6, fontSize: 11, color: '#94A3B8' }}>
                    {it.relatedCrsId ? <span style={{ fontWeight: 700, color: '#0369A1' }}>CRS {it.relatedCrsId}</span> : null}
                    <span>{fmtWhen(it.createdAt)}</span>
                    {it.senderName ? <span>From {it.senderName}</span> : null}
                    {it.readAt ? <span>Read {fmtWhen(it.readAt)}</span> : null}
                    {it.requiresAck ? (
                      it.acknowledgedAt ? <span style={{ color: '#166534', fontWeight: 700 }}>✓ Acknowledged</span> : <span style={{ color: '#B45309', fontWeight: 700 }}>Needs acknowledgement</span>
                    ) : null}
                  </div>
                  <div style={{ display: 'flex', gap: 8, marginTop: 10, flexWrap: 'wrap' }}>
                    <button type="button" onClick={() => open(it)} style={btn}>
                      {it.type === 'MESSAGE' ? 'Open message' : 'Details'}
                    </button>
                    {it.link ? (
                      <button type="button" onClick={() => viewRequest(it)} style={{ ...btn, color: '#0369A1', borderColor: '#BAE6FD' }}>
                        {isAdmin && it.status === 'pending' ? 'Review & decide →' : 'View request →'}
                      </button>
                    ) : null}
                    {!it.isRead ? (
                      <button type="button" onClick={() => void markNotification(it.id, 'read')} style={btn}>
                        Mark as read
                      </button>
                    ) : null}
                  </div>
                </div>
              </div>
              </Fragment>
            );
          })}
          {more ? (
            <button type="button" onClick={() => void older()} style={{ width: '100%', padding: 12, border: 'none', background: '#F8FAFC', color: '#0369A1', fontWeight: 700, fontSize: 12, cursor: 'pointer' }}>
              Load older
            </button>
          ) : null}
        </div>
      )}

      {reading ? <MessageView item={reading} onClose={() => setReading(null)} /> : null}
    </div>
  );
}
