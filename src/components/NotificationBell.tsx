'use client';

/**
 * The bell in the top bar: unread count, and a panel of the latest.
 *
 * Clicking a request opens the record it is about; clicking a message opens it
 * in place. Either counts as opening it, which is what sets the read time —
 * the badge appearing, or the panel being opened, does not.
 */
import { useRouter } from 'next/navigation';
import { useCallback, useEffect, useRef, useState } from 'react';
import { useAuth } from '@/lib/authClient';
import { statusLabel, type InboxItem } from '@/lib/notify/core';
import {
  FILTER_LABEL,
  PRIORITY_STYLE,
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
import MessageView from './MessageView';

export default function NotificationBell() {
  const { user } = useAuth();
  const router = useRouter();
  const isAdmin = user?.role === 'ADMIN';
  const { unread, installed } = useInboxSummary();
  const revision = useInboxRevision();

  const [open, setOpen] = useState(false);
  const [filter, setFilter] = useState<Filter>('all');
  const [items, setItems] = useState<InboxItem[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [reading, setReading] = useState<InboxItem | null>(null);
  const wrap = useRef<HTMLDivElement>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const b = await fetchInbox({ ...toQuery(filter), limit: 15 });
      setItems(b.items);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  }, [filter]);

  // Refetch while open whenever the inbox may have moved — a poll that found
  // something new, or this person's own action.
  useEffect(() => {
    if (open && installed) void load();
  }, [open, installed, load, revision]);

  useEffect(() => {
    if (!open) return;
    const away = (e: MouseEvent) => {
      if (wrap.current && !wrap.current.contains(e.target as Node)) setOpen(false);
    };
    const esc = (e: KeyboardEvent) => e.key === 'Escape' && setOpen(false);
    document.addEventListener('mousedown', away);
    document.addEventListener('keydown', esc);
    return () => {
      document.removeEventListener('mousedown', away);
      document.removeEventListener('keydown', esc);
    };
  }, [open]);

  const choose = async (it: InboxItem) => {
    if (it.type === 'MESSAGE' || !it.link) {
      setReading(it);
      if (!it.openedAt) void markNotification(it.id, 'open').catch(() => undefined);
      return;
    }
    setOpen(false);
    void markNotification(it.id, 'open').catch(() => undefined);
    router.push(it.link);
  };

  const badge = unread > 99 ? '99+' : String(unread);

  return (
    <div ref={wrap} style={{ position: 'relative' }}>
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-label={unread ? `Notifications, ${unread} unread` : 'Notifications'}
        title="Notifications"
        style={{
          position: 'relative',
          width: 38,
          height: 38,
          borderRadius: 10,
          border: '1px solid var(--border)',
          background: open ? '#EFF6FF' : '#fff',
          fontSize: 18,
          cursor: 'pointer',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
        }}
      >
        🔔
        {unread > 0 ? (
          <span
            style={{
              position: 'absolute',
              top: -6,
              right: -6,
              minWidth: 19,
              height: 19,
              padding: '0 5px',
              borderRadius: 10,
              background: '#DC2626',
              color: '#fff',
              fontSize: 10,
              fontWeight: 800,
              lineHeight: '19px',
              textAlign: 'center',
              border: '2px solid #fff',
            }}
          >
            {badge}
          </span>
        ) : null}
      </button>

      {open ? (
        <div
          role="dialog"
          aria-label="Notifications"
          style={{
            position: 'absolute',
            right: 0,
            top: 46,
            width: 'min(400px, calc(100vw - 24px))',
            maxHeight: 'min(560px, calc(100vh - 90px))',
            display: 'flex',
            flexDirection: 'column',
            background: '#fff',
            border: '1px solid var(--border)',
            borderRadius: 14,
            boxShadow: '0 12px 40px rgba(15,23,42,.18)',
            zIndex: 900,
            overflow: 'hidden',
          }}
        >
          <div style={{ padding: '12px 14px 8px', display: 'flex', alignItems: 'center', justifyContent: 'space-between', borderBottom: '1px solid #F1F5F9' }}>
            <div style={{ fontWeight: 800, fontSize: 14 }}>
              Notifications {unread ? <span style={{ color: '#DC2626', fontSize: 12 }}>· {unread} unread</span> : null}
            </div>
            {installed && unread > 0 ? (
              <button
                type="button"
                onClick={() => void markAllRead(toQuery(filter).category).then(load)}
                style={{ border: 'none', background: 'none', color: '#0369A1', fontSize: 12, fontWeight: 700, cursor: 'pointer' }}
              >
                Mark all as read
              </button>
            ) : null}
          </div>

          <div style={{ display: 'flex', gap: 6, padding: '8px 12px', overflowX: 'auto', borderBottom: '1px solid #F1F5F9' }}>
            {filtersFor(isAdmin).map((f) => (
              <button
                key={f}
                type="button"
                onClick={() => setFilter(f)}
                style={{
                  flexShrink: 0,
                  border: `1px solid ${filter === f ? '#0369A1' : 'var(--border)'}`,
                  background: filter === f ? '#0369A1' : '#fff',
                  color: filter === f ? '#fff' : 'var(--text)',
                  borderRadius: 20,
                  padding: '3px 10px',
                  fontSize: 11,
                  fontWeight: 600,
                  cursor: 'pointer',
                }}
              >
                {FILTER_LABEL[f]}
              </button>
            ))}
          </div>

          <div style={{ overflowY: 'auto', flex: 1 }}>
            {!installed ? (
              <div style={{ padding: 20, fontSize: 12, color: 'var(--muted)', textAlign: 'center' }}>
                Notifications are not set up yet.
                {isAdmin ? (
                  <div style={{ marginTop: 6 }}>
                    Run <code>supabase/migrations/0005_notifications.sql</code> on the database.
                  </div>
                ) : null}
              </div>
            ) : error ? (
              <div style={{ padding: 16, fontSize: 12, color: '#B91C1C' }}>{error}</div>
            ) : loading && !items.length ? (
              <div style={{ padding: 20, fontSize: 12, color: 'var(--muted)', textAlign: 'center' }}>Loading…</div>
            ) : !items.length ? (
              <div style={{ padding: 24, fontSize: 12, color: 'var(--muted)', textAlign: 'center' }}>Nothing here.</div>
            ) : (
              items.map((it) => {
                const pr = PRIORITY_STYLE[it.priority];
                const st = statusLabel(it.status);
                const sc = statusStyle(it.status);
                return (
                  <button
                    key={it.id}
                    type="button"
                    onClick={() => void choose(it)}
                    style={{
                      display: 'flex',
                      gap: 10,
                      width: '100%',
                      textAlign: 'left',
                      padding: '10px 14px',
                      border: 'none',
                      borderBottom: '1px solid #F1F5F9',
                      borderLeft: `3px solid ${it.isRead ? pr.bar : pr.bar === 'transparent' ? '#0EA5E9' : pr.bar}`,
                      background: it.isRead ? '#fff' : '#F0F9FF',
                      cursor: 'pointer',
                    }}
                  >
                    <span style={{ fontSize: 18, lineHeight: '20px' }}>{iconFor(it)}</span>
                    <span style={{ flex: 1, minWidth: 0 }}>
                      <span style={{ display: 'flex', gap: 6, alignItems: 'center', flexWrap: 'wrap' }}>
                        <span style={{ fontSize: 12.5, fontWeight: it.isRead ? 600 : 800, color: 'var(--text)' }}>{it.title}</span>
                        {pr.label ? (
                          <span style={{ fontSize: 9, fontWeight: 800, color: pr.fg, background: pr.bg, padding: '1px 6px', borderRadius: 4, textTransform: 'uppercase' }}>{pr.label}</span>
                        ) : null}
                      </span>
                      <span
                        style={{
                          display: '-webkit-box',
                          WebkitLineClamp: 2,
                          WebkitBoxOrient: 'vertical',
                          overflow: 'hidden',
                          fontSize: 11.5,
                          color: 'var(--muted)',
                          marginTop: 2,
                          whiteSpace: 'pre-wrap',
                        }}
                      >
                        {it.message}
                      </span>
                      <span style={{ display: 'flex', gap: 6, alignItems: 'center', marginTop: 4, flexWrap: 'wrap', fontSize: 10.5, color: '#94A3B8' }}>
                        {it.relatedCrsId ? <span style={{ fontWeight: 700, color: '#0369A1' }}>CRS {it.relatedCrsId}</span> : null}
                        <span>{fmtWhen(it.createdAt)}</span>
                        {st ? <span style={{ fontWeight: 700, color: sc.fg, background: sc.bg, padding: '0 6px', borderRadius: 4 }}>{st}</span> : null}
                        {!it.isRead ? <span style={{ fontWeight: 800, color: '#0284C7' }}>● Unread</span> : null}
                      </span>
                    </span>
                  </button>
                );
              })
            )}
          </div>

          <button
            type="button"
            onClick={() => {
              setOpen(false);
              router.push('/notifications');
            }}
            style={{ padding: '10px 14px', border: 'none', borderTop: '1px solid #F1F5F9', background: '#F8FAFC', color: '#0369A1', fontWeight: 700, fontSize: 12, cursor: 'pointer' }}
          >
            View all notifications →
          </button>
        </div>
      ) : null}

      {reading ? <MessageView item={reading} onClose={() => setReading(null)} /> : null}
    </div>
  );
}
