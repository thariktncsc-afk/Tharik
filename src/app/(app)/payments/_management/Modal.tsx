'use client';

/**
 * The screen's one modal frame: the app's .modal-bg / .modal classes, a
 * header that stays put, a body that scrolls, the buttons at the foot — so a
 * long form still fits a 375 px phone with its Save in reach.
 *
 * A form is closed only by its own Cancel / ✕ (a stray tap on the backdrop
 * must not throw away typed figures); a read-only view may close on the
 * backdrop. appAlert / appConfirm (z 9800) always show above it (z 500).
 */
import type { ReactNode } from 'react';

type Props = {
  title: string;
  sub?: ReactNode;
  /** Header gradient. */
  tone?: 'navy' | 'blue' | 'green' | 'violet' | 'red';
  width?: number;
  /** A read-only view: a click on the backdrop closes it. */
  dismissable?: boolean;
  /** While something is being sent, nothing closes it. */
  busy?: boolean;
  onClose: () => void;
  foot?: ReactNode;
  children: ReactNode;
};

const GRAD: Record<NonNullable<Props['tone']>, string> = {
  navy: 'linear-gradient(135deg,#1B3A6B,#2D5AA0)',
  blue: 'linear-gradient(135deg,#0369A1,#0EA5E9)',
  green: 'linear-gradient(135deg,#15803D,#22C55E)',
  violet: 'linear-gradient(135deg,#6D28D9,#8B5CF6)',
  red: 'linear-gradient(135deg,#B91C1C,#DC2626)',
};

export default function Modal({ title, sub, tone = 'navy', width = 500, dismissable, busy, onClose, foot, children }: Props) {
  return (
    <div
      className="modal-bg no-print"
      role="dialog"
      aria-modal="true"
      aria-label={title}
      style={{ display: 'flex', padding: 12 }}
      onMouseDown={(e) => {
        if (dismissable && !busy && e.target === e.currentTarget) onClose();
      }}
    >
      <div className="modal" style={{ width, maxWidth: '100%', maxHeight: '92dvh', display: 'flex', flexDirection: 'column' }}>
        <div className="modal-head" style={{ background: GRAD[tone], display: 'flex', alignItems: 'flex-start', gap: 10, flexShrink: 0 }}>
          <div style={{ flex: 1, minWidth: 0 }}>
            <h3>{title}</h3>
            {sub ? <div style={{ color: 'rgba(255,255,255,.88)', fontSize: 11.5, marginTop: 3, lineHeight: 1.45 }}>{sub}</div> : null}
          </div>
          <button
            type="button"
            className="btn-sm"
            aria-label="Close"
            title="Close"
            disabled={busy}
            onClick={onClose}
            style={{ background: 'none', border: 'none', color: '#fff', fontSize: 18, lineHeight: 1, padding: '0 2px', cursor: busy ? 'default' : 'pointer' }}
          >
            ✕
          </button>
        </div>
        <div className="modal-body" style={{ overflowY: 'auto', flex: '1 1 auto', minHeight: 0 }}>
          {children}
        </div>
        {foot ? (
          <div className="modal-foot" style={{ flexShrink: 0, flexWrap: 'wrap' }}>
            {foot}
          </div>
        ) : null}
      </div>
    </div>
  );
}

/** A labelled figure row inside a modal: "Total due  ₹350.00". */
export function FigureRow({ label, value, strong, color }: { label: string; value: ReactNode; strong?: boolean; color?: string }) {
  return (
    <div style={{ display: 'flex', justifyContent: 'space-between', gap: 10, fontSize: strong ? 14 : 12.5, fontWeight: strong ? 800 : 500, padding: '3px 0', color }}>
      <span style={{ color: strong ? undefined : 'var(--muted)' }}>{label}</span>
      <span style={{ whiteSpace: 'nowrap', fontVariantNumeric: 'tabular-nums' }}>{value}</span>
    </div>
  );
}

/** The red box listing what must be put right before anything is sent. */
export function Problems({ items }: { items: string[] }) {
  if (!items.length) return null;
  return (
    <div role="alert" style={{ background: '#FEE2E2', border: '1px solid #FECACA', borderRadius: 8, padding: '10px 14px', color: '#B91C1C', fontSize: 12.5, marginTop: 12, lineHeight: 1.55 }}>
      {items.map((p) => (
        <div key={p}>⚠ {p}</div>
      ))}
    </div>
  );
}

export const field = { width: '100%', border: '1px solid var(--border)', borderRadius: 8, padding: '9px 12px', fontSize: 13, background: '#fff' } as const;
export const pairGrid = { display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr))', gap: '0 12px' } as const;
