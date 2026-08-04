'use client';

/**
 * In-app confirm/alert dialogs — replaces the browser's native popups
 * ("localhost:3000 says…") with the application's own modal design.
 *
 *   const ok = await appConfirm({ title, message, tone: 'danger' });
 *   await appAlert('Saved!');
 *
 * Both accept a plain string as shorthand for { message }. Messages keep
 * their line breaks (white-space: pre-line). <DialogHost/> is mounted once
 * in the root layout; requests queue, Enter confirms, Escape cancels, and
 * the confirm button is focused on open. If the host is not mounted yet
 * (never the case in practice) the native dialogs are the fallback, so a
 * caller can never hang.
 */
import { useCallback, useEffect, useRef, useState } from 'react';

export type DialogTone = 'primary' | 'danger' | 'warning';
export type ConfirmOptions = {
  title?: string;
  message: string;
  confirmLabel?: string;
  cancelLabel?: string;
  tone?: DialogTone;
  icon?: string;
};
export type AlertOptions = {
  title?: string;
  message: string;
  okLabel?: string;
  tone?: DialogTone;
  icon?: string;
};

type Request =
  | { kind: 'confirm'; opts: ConfirmOptions; resolve: (ok: boolean) => void }
  | { kind: 'alert'; opts: AlertOptions; resolve: () => void };

let enqueue: ((req: Request) => void) | null = null;

const asOpts = <T extends { message: string }>(o: T | string): T => (typeof o === 'string' ? ({ message: o } as T) : o);

export function appConfirm(options: ConfirmOptions | string): Promise<boolean> {
  const opts = asOpts<ConfirmOptions>(options);
  if (!enqueue) return Promise.resolve(window.confirm(opts.message));
  return new Promise((resolve) => enqueue!({ kind: 'confirm', opts, resolve }));
}

export function appAlert(options: AlertOptions | string): Promise<void> {
  const opts = asOpts<AlertOptions>(options);
  if (!enqueue) {
    window.alert(opts.message);
    return Promise.resolve();
  }
  return new Promise((resolve) => enqueue!({ kind: 'alert', opts, resolve }));
}

const TONES: Record<DialogTone, { grad: string; btn: string; icon: string }> = {
  primary: { grad: 'linear-gradient(135deg,#0369A1,#0EA5E9)', btn: '#0284C7', icon: 'ℹ️' },
  danger: { grad: 'linear-gradient(135deg,#B91C1C,#DC2626)', btn: '#DC2626', icon: '⚠️' },
  warning: { grad: 'linear-gradient(135deg,#B45309,#F59E0B)', btn: '#D97706', icon: '⚠️' },
};

export default function DialogHost() {
  const [queue, setQueue] = useState<Request[]>([]);
  const current = queue[0] ?? null;
  const confirmRef = useRef<HTMLButtonElement>(null);
  const boxRef = useRef<HTMLDivElement>(null);
  const downOnBackdrop = useRef(false);

  useEffect(() => {
    enqueue = (req) => setQueue((q) => [...q, req]);
    return () => {
      enqueue = null;
    };
  }, []);

  const close = useCallback(
    (ok: boolean) => {
      if (!current) return;
      if (current.kind === 'confirm') current.resolve(ok);
      else current.resolve();
      setQueue((q) => q.slice(1));
    },
    [current],
  );

  useEffect(() => {
    if (!current) return;
    confirmRef.current?.focus();
    const onKey = (e: KeyboardEvent) => {
      if (e.repeat) return; // a held key must not auto-answer dialogs
      if (e.key === 'Escape') {
        e.preventDefault();
        close(false);
      } else if (e.key === 'Tab') {
        // Focus trap: cycle within the dialog's buttons only.
        const btns = Array.from(boxRef.current?.querySelectorAll<HTMLButtonElement>('button') ?? []);
        if (!btns.length) return;
        e.preventDefault();
        const i = btns.indexOf(document.activeElement as HTMLButtonElement);
        const next = btns[(i + (e.shiftKey ? -1 : 1) + btns.length) % btns.length] ?? btns[0];
        next.focus();
      } else if (e.key === 'Enter') {
        // A focused dialog button answers for itself (Enter on Cancel must
        // cancel); Enter elsewhere confirms.
        if (boxRef.current?.contains(document.activeElement)) return;
        e.preventDefault();
        close(true);
      }
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [current, close]);

  if (!current) return null;

  const isConfirm = current.kind === 'confirm';
  const tone = TONES[current.opts.tone ?? (isConfirm ? 'danger' : 'primary')];
  const title = current.opts.title ?? (isConfirm ? 'Please confirm' : 'Notice');
  const icon = current.opts.icon ?? tone.icon;

  return (
    <div
      role={isConfirm ? 'alertdialog' : 'dialog'}
      aria-modal="true"
      style={{
        position: 'fixed',
        inset: 0,
        zIndex: 9800,
        background: 'rgba(13,30,63,.55)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        padding: 20,
      }}
      onMouseDown={(e) => {
        downOnBackdrop.current = e.target === e.currentTarget;
      }}
      onClick={(e) => {
        // Dismiss only when the press STARTED on the backdrop — a text-drag
        // that ends outside the modal must not close it.
        if (e.target === e.currentTarget && downOnBackdrop.current) close(false);
      }}
    >
      <div ref={boxRef} className="modal" style={{ width: 460, maxWidth: '100%' }}>
        <div className="modal-head" style={{ background: tone.grad, display: 'flex', alignItems: 'center', gap: 10 }}>
          <span style={{ fontSize: 20, lineHeight: 1 }}>{icon}</span>
          <h3 style={{ color: '#fff' }}>{title}</h3>
        </div>
        <div className="modal-body" style={{ padding: '18px 20px' }}>
          <div style={{ fontSize: 13, lineHeight: 1.6, color: 'var(--text)', whiteSpace: 'pre-line' }}>{current.opts.message}</div>
        </div>
        <div className="modal-foot">
          {isConfirm ? (
            <button className="btn btn-outline" onClick={() => close(false)}>
              {(current.opts as ConfirmOptions).cancelLabel ?? 'Cancel'}
            </button>
          ) : null}
          <button
            ref={confirmRef}
            className="btn"
            onClick={() => close(true)}
            style={{ background: tone.btn, color: '#fff', border: 'none', fontWeight: 700 }}
          >
            {isConfirm ? ((current.opts as ConfirmOptions).confirmLabel ?? 'Confirm') : ((current.opts as AlertOptions).okLabel ?? 'OK')}
          </button>
        </div>
      </div>
    </div>
  );
}
