'use client';

/**
 * One notification, read in full: the whole message, its labelled details and
 * — for a message that must be acknowledged — the button that does it.
 *
 * Shared by the bell, the history page and the popup, so a message reads the
 * same wherever it is opened. Opening is recorded by whoever mounts this; the
 * view itself only records an acknowledgement, and only when it is pressed.
 */
import { useState } from 'react';
import { statusLabel, type InboxItem } from '@/lib/notify/core';
import { PRIORITY_STYLE, fmtWhen, markNotification, statusStyle } from '@/lib/notify/client';

export default function MessageView({
  item,
  onClose,
  heading,
  onAcknowledged,
  onLater,
}: {
  item: InboxItem;
  onClose: () => void;
  /** "Message from Admin" in the popup; the notification's own kind elsewhere. */
  heading?: string;
  onAcknowledged?: () => void;
  /** Offered only by the popup: hide it for this session, ask again next time. */
  onLater?: () => void;
}) {
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const [acked, setAcked] = useState(!!item.acknowledgedAt);
  const pr = PRIORITY_STYLE[item.priority];
  const st = statusLabel(item.status);
  const sc = statusStyle(item.status);
  const needsAck = item.requiresAck && !acked;

  const acknowledge = async () => {
    setBusy(true);
    setErr('');
    try {
      await markNotification(item.id, 'acknowledge');
      setAcked(true);
      onAcknowledged?.();
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  const localDate = (iso: string) => {
    const d = new Date(iso);
    return Number.isNaN(d.getTime())
      ? iso
      : d.toLocaleString('en-IN', { day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' });
  };

  return (
    <div
      className="modal-bg"
      style={{ display: 'flex', zIndex: 1000 }}
      onClick={(e) => {
        // A message that still needs acknowledging is not dismissed by a stray
        // click beside it — that is exactly how an urgent notice goes unread.
        if (e.target === e.currentTarget && !needsAck) onClose();
      }}
    >
      <div className="modal" style={{ maxWidth: 560, width: 'calc(100vw - 24px)' }}>
        <div
          className="modal-head"
          style={{
            background: item.priority === 'urgent' ? 'linear-gradient(135deg,#991B1B,#DC2626)' : item.priority === 'important' ? 'linear-gradient(135deg,#B45309,#F59E0B)' : 'linear-gradient(135deg,#0369A1,#0EA5E9)',
            display: 'flex',
            alignItems: 'center',
            gap: 8,
          }}
        >
          <span style={{ fontWeight: 800 }}>{heading ?? (item.type === 'MESSAGE' ? 'Message from Admin' : item.title)}</span>
          {pr.label ? <span style={{ fontSize: 10, fontWeight: 800, background: 'rgba(255,255,255,.25)', padding: '2px 8px', borderRadius: 4, textTransform: 'uppercase' }}>{pr.label}</span> : null}
        </div>

        <div style={{ padding: '16px 18px', maxHeight: 'calc(100vh - 220px)', overflowY: 'auto' }}>
          {item.type === 'MESSAGE' || heading ? <div style={{ fontWeight: 800, fontSize: 16, marginBottom: 8 }}>{item.title}</div> : null}
          {item.message ? <div style={{ fontSize: 13.5, lineHeight: 1.6, whiteSpace: 'pre-wrap', color: 'var(--text)' }}>{item.message}</div> : null}

          {item.details.length ? (
            <table style={{ width: '100%', borderCollapse: 'collapse', marginTop: 12, fontSize: 12.5 }}>
              <tbody>
                {item.details.map((d, i) => (
                  <tr key={i} style={{ borderTop: '1px solid #F1F5F9' }}>
                    <td style={{ padding: '6px 10px 6px 0', color: 'var(--muted)', whiteSpace: 'nowrap', verticalAlign: 'top', width: '38%' }}>{d.label}</td>
                    <td style={{ padding: '6px 0', fontWeight: 600, wordBreak: 'break-word' }}>{d.kind === 'date' ? localDate(d.value) : d.value}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          ) : null}

          <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', marginTop: 12, fontSize: 11, color: '#94A3B8' }}>
            <span>Sent: {fmtWhen(item.createdAt)}</span>
            {item.senderName ? <span>From: {item.senderName}</span> : null}
            {st ? <span style={{ fontWeight: 700, color: sc.fg, background: sc.bg, padding: '0 6px', borderRadius: 4 }}>{st}</span> : null}
            {acked && item.requiresAck ? <span style={{ color: '#166534', fontWeight: 700 }}>✓ Acknowledged</span> : null}
          </div>
          {err ? <div style={{ marginTop: 10, color: '#B91C1C', fontSize: 12 }}>{err}</div> : null}
        </div>

        <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 10, padding: '0 18px 16px', flexWrap: 'wrap' }}>
          {needsAck && onLater ? (
            <button type="button" onClick={onLater} style={{ background: '#fff', border: '1px solid var(--border)', padding: '9px 16px', borderRadius: 8, fontSize: 13, cursor: 'pointer' }}>
              Remind me later
            </button>
          ) : null}
          {!needsAck ? (
            <button type="button" onClick={onClose} style={{ background: '#fff', border: '1px solid var(--border)', padding: '9px 18px', borderRadius: 8, fontSize: 13, cursor: 'pointer' }}>
              Close
            </button>
          ) : null}
          {needsAck ? (
            <button
              type="button"
              disabled={busy}
              onClick={() => void acknowledge()}
              style={{ background: 'linear-gradient(135deg,#0369A1,#0EA5E9)', color: '#fff', border: 'none', padding: '9px 22px', borderRadius: 8, fontWeight: 700, fontSize: 13, cursor: busy ? 'wait' : 'pointer' }}
            >
              {busy ? 'Saving…' : 'Acknowledge'}
            </button>
          ) : null}
        </div>
      </div>
    </div>
  );
}
