'use client';

/**
 * Reminder Sound — what a shop hears, on a loop, while a payment reminder
 * waits for its OK. Sounds are uploaded here; one of them is the active one.
 * With none active the shop hears a plain beep.
 *
 * The active sound cannot be removed: another is chosen first (or the beep),
 * so a shop is never left pointing at a file that is gone.
 */
import { useEffect, useRef, useState } from 'react';
import { appAlert, appConfirm } from '@/components/dialog';
import { saveSuccess } from '@/components/SaveSuccess';
import { mediaUrl, removeMedia, setActiveSound, uploadMedia } from '@/lib/paymentMgmt/client';
import type { PmAsset, PmMedia } from '@/lib/paymentMgmt/types';
import { pmMediaSaved } from '@/lib/saveSuccess';
import { dmyTime } from '@/lib/dateFormat';
import { fileBtn } from './UpiCard';
import { MAX_UPLOAD_BYTES, sizeText } from './lib';

const SOUND_ACCEPT = 'audio/mpeg,audio/wav,audio/x-wav,audio/ogg,audio/mp4,audio/aac,audio/webm,.mp3,.wav,.ogg,.m4a,.aac,.webm';

const failed = (e: unknown) => (e instanceof Error ? e.message : 'Something went wrong. Please try again.');

/** Two short tones — the beep a shop hears when no sound is set. False when this browser has no audio. */
function beep(): boolean {
  const Ctx = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
  if (!Ctx) return false;
  const ctx = new Ctx();
  const t0 = ctx.currentTime;
  for (const start of [0, 0.32]) {
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = 'sine';
    osc.frequency.value = 880;
    gain.gain.setValueAtTime(0.0001, t0 + start);
    gain.gain.exponentialRampToValueAtTime(0.35, t0 + start + 0.02);
    gain.gain.exponentialRampToValueAtTime(0.0001, t0 + start + 0.25);
    osc.connect(gain).connect(ctx.destination);
    osc.start(t0 + start);
    osc.stop(t0 + start + 0.27);
  }
  setTimeout(() => void ctx.close().catch(() => undefined), 900);
  return true;
}

export default function SoundCard({ media, loadError, onMedia }: { media: PmMedia | null; loadError: string; onMedia: (m: PmMedia) => void }) {
  const [busy, setBusy] = useState('');
  const test = useRef<HTMLAudioElement | null>(null);

  // A test still playing stops when the page is left.
  useEffect(
    () => () => {
      test.current?.pause();
      test.current = null;
    },
    [],
  );

  const sounds = media?.sounds ?? [];
  const active = sounds.find((s) => s.id === media?.activeSoundId) ?? null;

  const upload = async (file: File) => {
    if (file.size > MAX_UPLOAD_BYTES) {
      void appAlert({ title: 'Not uploaded', tone: 'danger', message: `That sound is ${sizeText(file.size)}; the most is 4 MB. A few seconds of sound is enough — it plays on a loop.` });
      return;
    }
    setBusy('upload');
    try {
      const { media: next } = await uploadMedia('sound', file);
      onMedia(next);
      saveSuccess(pmMediaSaved('sound', file.name));
    } catch (e) {
      void appAlert({ title: 'Not uploaded', tone: 'danger', message: failed(e) });
    } finally {
      setBusy('');
    }
  };

  const choose = async (s: PmAsset | null) => {
    setBusy(s ? `active:${s.id}` : 'beep');
    try {
      const { media: next } = await setActiveSound(s ? s.id : null);
      onMedia(next);
      saveSuccess(s ? pmMediaSaved('sound-active', s.name) : pmMediaSaved('sound-beep', ''));
    } catch (e) {
      void appAlert({ title: 'Not saved', tone: 'danger', message: failed(e) });
    } finally {
      setBusy('');
    }
  };

  const remove = async (s: PmAsset) => {
    const ok = await appConfirm({ title: 'Remove this sound?', tone: 'danger', message: `${s.name} will be removed.`, confirmLabel: 'Remove', defaultCancel: true });
    if (!ok) return;
    setBusy(`remove:${s.id}`);
    try {
      const { media: next } = await removeMedia(s.id);
      onMedia(next);
      saveSuccess(pmMediaSaved('sound-removed', s.name));
    } catch (e) {
      void appAlert({ title: 'Not removed', tone: 'danger', message: failed(e) });
    } finally {
      setBusy('');
    }
  };

  const playTest = async () => {
    test.current?.pause();
    test.current = null;
    if (!active) {
      if (!beep()) void appAlert({ title: 'No sound', tone: 'warning', message: 'This browser cannot play the beep.' });
      return;
    }
    const a = new Audio(mediaUrl(active.id));
    test.current = a;
    try {
      await a.play();
    } catch {
      void appAlert({ title: 'Sound did not play', tone: 'warning', message: 'This browser could not play the sound. Check the volume, or try another file (MP3 plays everywhere).' });
    }
  };

  return (
    <div className="card" style={{ minWidth: 0 }}>
      <div className="card-header">
        <div className="card-title">🔔 Reminder Sound</div>
      </div>
      <div className="card-body">
        <div style={{ fontSize: 12.5, color: 'var(--muted)', marginBottom: 12, lineHeight: 1.55 }}>
          A shop hears the active sound, on a loop, until someone there presses OK on the reminder. <strong>With no sound set, shops hear a beep.</strong> MP3, WAV, OGG or M4A, at most 4 MB.
        </div>

        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center', marginBottom: 14 }}>
          <label style={{ margin: 0 }}>
            <span style={{ ...fileBtn, opacity: busy ? 0.6 : 1, cursor: busy ? 'default' : 'pointer' }}>{busy === 'upload' ? 'Uploading…' : '⬆ Upload sound'}</span>
            <input
              type="file"
              accept={SOUND_ACCEPT}
              disabled={!!busy || !media}
              style={{ display: 'none' }}
              onChange={(e) => {
                const f = e.target.files?.[0];
                e.target.value = '';
                if (f) void upload(f);
              }}
            />
          </label>
          <button type="button" className="btn btn-outline btn-sm" onClick={() => void playTest()}>
            ▶ Play test {active ? `(${active.name})` : '(beep)'}
          </button>
        </div>

        <div style={{ fontSize: 12.5, marginBottom: 8 }}>
          Active:{' '}
          {active ? (
            <strong style={{ color: '#15803D', wordBreak: 'break-all' }}>{active.name}</strong>
          ) : (
            <strong style={{ color: '#92400E' }}>the beep (no sound set)</strong>
          )}
        </div>

        {!media ? <div style={{ fontSize: 12.5, color: loadError ? '#B91C1C' : 'var(--muted)' }}>{loadError || 'Loading…'}</div> : sounds.length === 0 ? <div style={{ fontSize: 12.5, color: 'var(--muted)' }}>No sound uploaded yet.</div> : null}
        {sounds.map((s) => {
          const isActive = s.id === active?.id;
          return (
            <div key={s.id} style={{ border: `1px solid ${isActive ? '#86EFAC' : 'var(--border)'}`, background: isActive ? '#F0FDF4' : '#fff', borderRadius: 10, padding: '10px 12px', marginBottom: 8 }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', gap: 8, flexWrap: 'wrap', alignItems: 'baseline' }}>
                <div style={{ minWidth: 0, flex: '1 1 160px' }}>
                  <div style={{ fontWeight: 700, fontSize: 12.5, wordBreak: 'break-all' }}>
                    {s.name} {isActive ? <span className="badge badge-green">Active</span> : null}
                  </div>
                  <div style={{ fontSize: 11, color: 'var(--muted)' }}>
                    {sizeText(s.size)} · uploaded {dmyTime(s.at)} by {s.byName || '—'}
                  </div>
                </div>
                <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                  {!isActive ? (
                    <button type="button" className="btn btn-outline btn-sm" disabled={!!busy} onClick={() => void choose(s)}>
                      {busy === `active:${s.id}` ? 'Saving…' : 'Set active'}
                    </button>
                  ) : null}
                  {!isActive ? (
                    <button type="button" className="btn btn-outline btn-sm" disabled={!!busy} onClick={() => void remove(s)} style={{ borderColor: '#FCA5A5', color: '#B91C1C' }}>
                      Remove
                    </button>
                  ) : null}
                </div>
              </div>
              <audio controls preload="none" src={mediaUrl(s.id)} style={{ width: '100%', height: 36, marginTop: 8 }} />
            </div>
          );
        })}

        {active ? (
          <button type="button" className="btn btn-outline btn-sm" disabled={!!busy} onClick={() => void choose(null)} style={{ marginTop: 4 }}>
            {busy === 'beep' ? 'Saving…' : 'Use the beep instead'}
          </button>
        ) : null}
      </div>
    </div>
  );
}
