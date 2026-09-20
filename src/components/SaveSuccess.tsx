'use client';

/**
 * The one save-success confirmation — a payment-app style green tick that
 * scales in, states what was saved and for which date, and leaves on its own.
 *
 *   saveSuccess(dailySaved(crsId, date));      // '@/lib/saveSuccess' words it
 *
 * Call it ONLY after the write has actually landed in the database
 * (`await crsData.saveConfirmed()` returned true) — this popup is the clerk's
 * evidence that the figures are stored, so it must never appear for a save
 * that failed.
 *
 * <SaveSuccessHost/> is mounted once in the root layout, beside <DialogHost/>,
 * and serves Daily Sales, Monthly Sales and Receipt alike. If it is not
 * mounted (never the case in practice) the call is a no-op rather than an
 * error: a confirmation is not worth breaking a save over.
 *
 * A second press of the same save is dropped instead of stacking a second
 * popup (isRepeat), and the popup never takes the pointer, so nothing behind
 * it is blocked while it shows.
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import { HOLD_MS, LEAVE_MS, isRepeat, type SaveSuccessRequest } from '@/lib/saveSuccess';

let show: ((req: SaveSuccessRequest) => void) | null = null;

/** Show the success popup. Safe to call from anywhere on the client. */
export function saveSuccess(req: SaveSuccessRequest): void {
  show?.(req);
}

const CSS = `
@keyframes crsSsIn{from{opacity:0;transform:translateY(8px) scale(.9)}to{opacity:1;transform:none}}
@keyframes crsSsOut{to{opacity:0;transform:translateY(-6px) scale(.97)}}
@keyframes crsSsPop{0%{transform:scale(0)}60%{transform:scale(1.12)}100%{transform:scale(1)}}
@keyframes crsSsRing{from{opacity:.55;transform:scale(.7)}to{opacity:0;transform:scale(1.9)}}
@keyframes crsSsTick{to{stroke-dashoffset:0}}
.crs-ss{animation:crsSsIn .34s cubic-bezier(.2,.9,.3,1.25) both}
.crs-ss-leaving{animation:crsSsOut .26s ease-in forwards}
.crs-ss-badge{animation:crsSsPop .42s cubic-bezier(.2,.9,.3,1.4) both}
.crs-ss-ring{animation:crsSsRing .9s ease-out .18s both}
.crs-ss-tick{stroke-dasharray:32;stroke-dashoffset:32;animation:crsSsTick .34s ease-out .22s forwards}
@media (prefers-reduced-motion:reduce){
  .crs-ss,.crs-ss-leaving,.crs-ss-badge,.crs-ss-ring,.crs-ss-tick{animation:none!important}
  .crs-ss-tick{stroke-dashoffset:0}
  .crs-ss-ring{opacity:0}
}
`;

export default function SaveSuccessHost() {
  const [item, setItem] = useState<SaveSuccessRequest | null>(null);
  const [leaving, setLeaving] = useState(false);
  // What is showing, and what has just left — both count as the same save.
  const lastRef = useRef<{ key: string; at: number } | null>(null);
  const timers = useRef<ReturnType<typeof setTimeout>[]>([]);

  const clearTimers = useCallback(() => {
    timers.current.forEach(clearTimeout);
    timers.current = [];
  }, []);

  useEffect(() => {
    show = (req) => {
      if (isRepeat(lastRef.current, req.key, Date.now())) return;
      lastRef.current = { key: req.key, at: Date.now() };
      clearTimers();
      setLeaving(false);
      setItem(req);
      timers.current.push(setTimeout(() => setLeaving(true), HOLD_MS));
      timers.current.push(setTimeout(() => setItem(null), HOLD_MS + LEAVE_MS));
    };
    return () => {
      show = null;
      clearTimers();
    };
  }, [clearTimers]);

  if (!item) return null;

  return (
    <div
      // Above the modals (z 9800) so a confirmation is never hidden behind one,
      // and transparent to the pointer so it blocks nothing while it shows.
      style={{ position: 'fixed', inset: 0, zIndex: 9900, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 16, pointerEvents: 'none' }}
      role="status"
      aria-live="polite"
    >
      <style>{CSS}</style>
      <div
        className={`crs-ss${leaving ? ' crs-ss-leaving' : ''}`}
        style={{
          width: 320,
          maxWidth: '100%',
          background: '#fff',
          borderRadius: 18,
          border: '1px solid #BBF7D0',
          boxShadow: '0 18px 44px rgba(13,30,63,.22)',
          padding: '26px 22px 22px',
          textAlign: 'center',
        }}
      >
        <div style={{ position: 'relative', width: 72, height: 72, margin: '0 auto 14px' }}>
          <span className="crs-ss-ring" style={{ position: 'absolute', inset: 0, borderRadius: '50%', background: '#22C55E' }} />
          <div
            className="crs-ss-badge"
            style={{
              position: 'relative',
              width: 72,
              height: 72,
              borderRadius: '50%',
              background: 'linear-gradient(135deg,#16A34A,#22C55E)',
              boxShadow: '0 8px 20px rgba(34,197,94,.38)',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
            }}
          >
            <svg width="40" height="40" viewBox="0 0 36 36" aria-hidden="true">
              <path className="crs-ss-tick" d="M10 18.5l5.2 5.2L26 13" fill="none" stroke="#fff" strokeWidth="3.4" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
          </div>
        </div>
        <div style={{ fontSize: 15, fontWeight: 800, color: '#15803D', lineHeight: 1.35 }}>{item.title}</div>
        <div style={{ fontSize: 12.5, color: 'var(--muted,#64748B)', marginTop: 7, lineHeight: 1.55 }}>{item.detail}</div>
      </div>
    </div>
  );
}
