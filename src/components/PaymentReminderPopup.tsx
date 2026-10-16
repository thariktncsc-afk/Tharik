'use client';

/**
 * A payment reminder, in front of everything — with its sound — until one of
 * the shop's staff presses OK (office, 2026-10-16).
 *
 * Mounted once in the app shell beside MessagePopup, so it shows on whatever
 * page the clerk is on and keeps sounding across page changes. Shop staff
 * only: an administrator sends reminders, and gets nothing here.
 *
 * WHAT IT ASKS. /api/payment-management/mine — the signed-in shop's own
 * reminders, its shop taken from the session on the server, never from here.
 * It asks on opening, whenever the inbox moves (a reminder lands as a
 * notification, so the bell's beat carries it within a few seconds), whenever
 * the 'paymgmt' live topic moves (OK pressed on the shop's other phone closes
 * this one), and when the window comes back into focus.
 *
 * ONLY OK ACKNOWLEDGES. Appearing records nothing, the sound starting records
 * nothing, and the tap that turns a blocked sound on records nothing — the
 * office has to know a person saw the balance, not that a screen drew it.
 * OK silences the sound at once, then tells the server; if that fails the
 * reminder stays, with the reason.
 *
 * THE SOUND. The office's active reminder sound on a loop, or — none uploaded,
 * or a file this phone cannot play — a beep every 1.5 s. Phone browsers refuse
 * to start sound before the person has touched the page (after a reload, every
 * time), so a refused start puts a banner up and tries again on the next tap
 * or key press anywhere. It stops on OK, when nothing is waiting any more
 * (acknowledged elsewhere), when the person signs out and when this unmounts.
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import { useAuth } from '@/lib/authClient';
import { useLiveRevision } from '@/lib/dataStore';
import { inbox, useInboxRevision } from '@/lib/notify/client';
import { acknowledgeReminder, fetchMine } from '@/lib/paymentMgmt/client';
import type { PmMine } from '@/lib/paymentMgmt/types';
import PaymentReminderCard from './PaymentReminderCard';

const BEEP_EVERY_MS = 1500;
/** How long to wait on an AudioContext that may never be allowed to start. */
const RESUME_WAIT_MS = 400;

/** The OK button carries data-pm-ok: a press on it silences the sound, it must not start it. */
const OK_SELECTOR = '[data-pm-ok]';

const CSS = `
.pmr-overlay{position:fixed;inset:0;z-index:9600;background:rgba(13,30,63,.62);display:flex;align-items:center;justify-content:center;padding:16px}
.pmr-box{background:#fff;border-radius:14px;width:min(520px,100%);max-height:calc(100vh - 32px);max-height:calc(100dvh - 32px);display:flex;flex-direction:column;overflow:hidden;box-shadow:0 24px 60px rgba(2,17,45,.45);outline:none}
.pmr-scroll{flex:1 1 auto;overflow-y:auto;-webkit-overflow-scrolling:touch;overscroll-behavior:contain}
.pmr-foot{flex:0 0 auto;padding:12px 16px calc(12px + env(safe-area-inset-bottom,0px));border-top:1px solid var(--border);background:#fff}
@media (max-width:560px){
  .pmr-overlay{padding:0}
  .pmr-box{width:100%;height:100vh;height:100dvh;max-height:none;border-radius:0}
}
`;

export default function PaymentReminderPopup() {
  const { status, user } = useAuth();
  if (status !== 'signedIn' || !user || user.role === 'ADMIN') return null;
  // Keyed by person: whoever signs in next on this browser starts from nothing.
  return <ShopReminder key={user.id} />;
}

function ShopReminder() {
  const [mine, setMine] = useState<PmMine | null>(null);
  /** The obligation whose sound OK has silenced, until the next answer. */
  const [silenced, setSilenced] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<{ id: string; message: string } | null>(null);
  const inboxRev = useInboxRevision();
  const pmRev = useLiveRevision('paymgmt');
  const seq = useRef(0);
  /** True while an OK is on its way: nothing may start the sound again meanwhile. */
  const acking = useRef(false);
  const boxRef = useRef<HTMLDivElement>(null);

  const load = useCallback(async () => {
    const n = ++seq.current;
    try {
      const next = await fetchMine();
      // A later question is already out (or OK was pressed since): its answer wins.
      if (n !== seq.current) return;
      setMine(next);
      if (!acking.current) setSilenced(null);
    } catch {
      /* offline for a moment, or not a shop account — the next beat tries again */
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load, inboxRev, pmRev]);

  useEffect(() => {
    const onFocus = () => void load();
    const onVisible = () => {
      if (document.visibilityState === 'visible') void load();
    };
    window.addEventListener('focus', onFocus);
    document.addEventListener('visibilitychange', onVisible);
    return () => {
      window.removeEventListener('focus', onFocus);
      document.removeEventListener('visibilitychange', onVisible);
    };
  }, [load]);

  // Oldest reminder first: a backlog is worked through in the order it was sent.
  const current = mine?.pending[0] ?? null;
  const waiting = mine?.pending.length ?? 0;
  const sound = useLoopingSound(!!current && silenced !== current.id, mine?.soundUrl ?? null);

  // A reminder that pops up over a form takes the focus off it, so the
  // figures being typed do not carry on into whatever is underneath. Not the
  // OK button: an Enter meant for the form must not acknowledge unread.
  const currentId = current?.id ?? null;
  useEffect(() => {
    if (currentId) boxRef.current?.focus({ preventScroll: true });
  }, [currentId]);

  const ok = async () => {
    if (!current || busy) return;
    const id = current.id;
    seq.current++; // an answer already on its way predates this OK
    acking.current = true;
    sound.stop();
    setSilenced(id);
    setBusy(true);
    setErr(null);
    try {
      await acknowledgeReminder(id);
      // The notification it came as is acknowledged too: let the bell catch up.
      void inbox.refresh();
      // The next reminder waiting, if any, sounds: it is not the one silenced.
      await load();
    } catch (e) {
      // The reminder stays, with the reason; it stays quiet until the next answer.
      setErr({ id, message: e instanceof Error ? e.message : String(e) });
    } finally {
      acking.current = false;
      setBusy(false);
    }
  };

  if (!current || !mine) return null;

  return (
    <div className="no-print pmr-overlay" role="alertdialog" aria-modal="true" aria-label={`Payment Reminder — CRS ${current.crsId}`}>
      <style>{CSS}</style>
      <div ref={boxRef} className="pmr-box" tabIndex={-1}>
        {sound.blocked ? (
          <div
            role="status"
            style={{
              flex: '0 0 auto',
              background: '#FEF3C7',
              borderBottom: '2px solid #F59E0B',
              color: '#92400E',
              padding: '12px 16px',
              fontSize: 15,
              fontWeight: 800,
              textAlign: 'center',
              cursor: 'pointer',
            }}
          >
            🔇 Tap anywhere to turn on the reminder sound
          </div>
        ) : null}

        <div className="pmr-scroll">
          <PaymentReminderCard item={current} shopName={mine.shopName} upi={mine.upi} qrUrl={mine.qrUrl} />
        </div>

        <div className="pmr-foot">
          {err && err.id === current.id ? (
            <div role="alert" style={{ background: '#FEE2E2', color: '#B91C1C', border: '1px solid #FECACA', borderRadius: 8, padding: '8px 12px', fontSize: 13, marginBottom: 10 }}>
              {err.message}
            </div>
          ) : null}
          {waiting > 1 ? (
            <div style={{ fontSize: 12, color: 'var(--muted)', textAlign: 'center', marginBottom: 8 }}>
              1 of {waiting} reminders waiting for OK
            </div>
          ) : null}
          <button
            type="button"
            data-pm-ok=""
            disabled={busy}
            onClick={() => void ok()}
            style={{
              display: 'block',
              width: '100%',
              minHeight: 54,
              background: busy ? '#94A3B8' : 'linear-gradient(135deg,#0369A1,#0EA5E9)',
              color: '#fff',
              border: 'none',
              borderRadius: 12,
              fontSize: 18,
              fontWeight: 800,
              letterSpacing: 0.5,
              cursor: busy ? 'wait' : 'pointer',
            }}
          >
            {busy ? 'Saving…' : 'OK'}
          </button>
        </div>
      </div>
    </div>
  );
}

type AudioContextCtor = typeof AudioContext;

/** Two short tones — loud enough to be heard across a shop counter, short enough not to grate. */
function beep(ctx: AudioContext) {
  const t = ctx.currentTime;
  for (const [at, freq] of [
    [0, 880],
    [0.22, 660],
  ] as const) {
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = 'sine';
    osc.frequency.value = freq;
    gain.gain.setValueAtTime(0.0001, t + at);
    gain.gain.exponentialRampToValueAtTime(0.4, t + at + 0.02);
    gain.gain.exponentialRampToValueAtTime(0.0001, t + at + 0.18);
    osc.connect(gain).connect(ctx.destination);
    osc.start(t + at);
    osc.stop(t + at + 0.2);
  }
}

/**
 * Sound on a loop for as long as `on` holds: `url` when there is one, else
 * the beep. `blocked` says the browser refused to start it; the next tap or
 * key press anywhere (other than on OK) tries again.
 */
function useLoopingSound(on: boolean, url: string | null): { blocked: boolean; stop: () => void } {
  const [blocked, setBlocked] = useState(false);
  const want = useRef(false);
  const urlRef = useRef<string | null>(null);
  const audio = useRef<HTMLAudioElement | null>(null);
  const audioSrc = useRef<string | null>(null);
  /** A sound file this browser refused to play: the beep is used instead. */
  const broken = useRef<string | null>(null);
  const ctxRef = useRef<AudioContext | null>(null);
  const beepTimer = useRef<ReturnType<typeof setInterval> | null>(null);
  /** Bumped by every start and stop, so a start still waiting on the browser knows it is stale. */
  const attempt = useRef(0);
  /**
   * Bumped by every stop only. One tap is several events (pointerdown,
   * touchstart, pointerup, touchend, click), each starting the sound again on
   * the same element: an earlier start that finds a newer one must leave the
   * sound playing — only a stop silences it.
   */
  const stops = useRef(0);

  const stop = useCallback(() => {
    attempt.current++;
    stops.current++;
    const a = audio.current;
    if (a) {
      a.pause();
      try {
        a.currentTime = 0;
      } catch {
        /* not loaded yet — nothing to rewind */
      }
    }
    if (beepTimer.current !== null) clearInterval(beepTimer.current);
    beepTimer.current = null;
  }, []);

  /** The beep. False when the browser will not let it start yet. */
  const startBeep = useCallback(async (id: number): Promise<boolean> => {
    const AC: AudioContextCtor | undefined = window.AudioContext ?? (window as unknown as { webkitAudioContext?: AudioContextCtor }).webkitAudioContext;
    if (!AC) return true; // a browser with no sound at all: nothing to turn on
    let ctx = ctxRef.current;
    if (!ctx) {
      try {
        ctx = ctxRef.current = new AC();
      } catch {
        return true;
      }
    }
    if (ctx.state !== 'running') {
      // Without a tap, resume() may never settle — wait a moment, then judge.
      await Promise.race([ctx.resume().catch(() => undefined), new Promise((r) => setTimeout(r, RESUME_WAIT_MS))]);
    }
    if (id !== attempt.current || !want.current) return true;
    if (ctx.state !== 'running') return false;
    const c = ctx;
    beep(c);
    if (beepTimer.current === null) beepTimer.current = setInterval(() => beep(c), BEEP_EVERY_MS);
    return true;
  }, []);

  const start = useCallback(async () => {
    const id = ++attempt.current;
    const gen = stops.current;
    const src = urlRef.current && urlRef.current !== broken.current ? urlRef.current : null;
    // Unlock the beep's AudioContext now, while a tap that called this still
    // counts: if the file then will not play, the beep can still start (an
    // iPhone allows it only inside the tap, never after an await).
    const AC: AudioContextCtor | undefined = window.AudioContext ?? (window as unknown as { webkitAudioContext?: AudioContextCtor }).webkitAudioContext;
    if (AC && !ctxRef.current) {
      try {
        ctxRef.current = new AC();
      } catch {
        /* no sound at all on this browser — startBeep says so */
      }
    }
    if (ctxRef.current && ctxRef.current.state !== 'running') void ctxRef.current.resume().catch(() => undefined);
    if (src) {
      let a = audio.current;
      if (!a || audioSrc.current !== src) {
        a?.pause();
        a = new Audio(src);
        a.loop = true;
        a.preload = 'auto';
        audio.current = a;
        audioSrc.current = src;
      }
      try {
        // Called before any await, so a tap that called start() counts as the gesture.
        await a.play();
        // Stopped (OK, or nothing waiting) while the browser was starting it.
        if (gen !== stops.current || !want.current) {
          a.pause();
          return;
        }
        // Playing — whether this start or a newer one of the same tap owns it.
        setBlocked(false);
        return;
      } catch (e) {
        if (id !== attempt.current || !want.current) return;
        if (e instanceof DOMException && e.name === 'NotAllowedError') {
          setBlocked(true);
          return;
        }
        // The file would not play (removed since, or a format this phone
        // lacks): the beep instead, rather than silence — now and on every
        // later try, so a tap is not spent on the same failing file again.
        broken.current = src;
        a.removeAttribute('src');
        audio.current = null;
        audioSrc.current = null;
      }
    }
    const started = await startBeep(id);
    if (id !== attempt.current) return;
    setBlocked(!started);
  }, [startBeep]);

  useEffect(() => {
    want.current = on;
    urlRef.current = url;
    stop();
    if (!on) {
      setBlocked(false);
      return;
    }
    void start();
  }, [on, url, start, stop]);

  // Blocked: try again on the person's next touch or key. pointerdown /
  // touchstart are the first sign of a tap, but a phone only counts the tap as
  // permission at its END (pointerup / touchend / click), so those try too.
  useEffect(() => {
    if (!blocked) return;
    const retry = (e: Event) => {
      const t = e.target;
      if (t instanceof Element && t.closest(OK_SELECTOR)) return;
      if (want.current) void start();
    };
    const events = ['pointerdown', 'touchstart', 'keydown', 'pointerup', 'touchend', 'click'] as const;
    for (const ev of events) document.addEventListener(ev, retry, true);
    return () => {
      for (const ev of events) document.removeEventListener(ev, retry, true);
    };
  }, [blocked, start]);

  // Unmounted (signed out, or the shell went away): silence, and let go of the audio.
  useEffect(
    () => () => {
      want.current = false;
      stop();
      const a = audio.current;
      if (a) a.removeAttribute('src');
      audio.current = null;
      audioSrc.current = null;
      const ctx = ctxRef.current;
      ctxRef.current = null;
      if (ctx) void ctx.close().catch(() => undefined);
    },
    [stop],
  );

  return { blocked: blocked && on, stop };
}
