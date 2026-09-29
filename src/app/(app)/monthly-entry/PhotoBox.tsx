'use client';

/**
 * One upload box under Card Details: "📷 Upload Card Details Photo" or
 * "📷 Upload Allotment Photo" (office, 2026-09-29).
 *
 * Holds the photos and what the reader made of each (src/lib/ocr/client.ts →
 * /api/ocr). It knows nothing about fields: every time the set of photos read
 * changes it hands the transcriptions up (`onRead`), and CardAllot maps them
 * (engine/photoExtract.ts) into a draft shown in the existing fields. The two
 * boxes are separate instances with separate `kind`s, so a Card Details photo
 * can never fill Allotment, or the other way round.
 *
 * Photos live only in this page: nothing is uploaded anywhere but the reader,
 * and nothing is kept after the page is left or the shop/month changes.
 */
import { useEffect, useRef, useState, type ReactNode } from 'react';
import { readPhotoRemote } from '@/lib/ocr/client';
import type { AllotTranscript, CardTranscript } from '@/lib/engine/photoExtract';

type Kind = 'cards' | 'allot';
type Photo = { id: string; name: string; url: string; file: File; status: 'reading' | 'done' | 'error'; transcript?: CardTranscript | AllotTranscript; error?: string };

let seq = 0;

export default function PhotoBox({
  kind,
  title,
  hint,
  resetKey,
  onRead,
  summary,
}: {
  kind: Kind;
  title: string;
  hint: string;
  /** The shop and month on screen — photos belong to it and go when it changes. */
  resetKey: string;
  onRead: (transcripts: (CardTranscript | AllotTranscript)[]) => void;
  /** What the photos gave, worded by CardAllot. */
  summary: ReactNode;
}) {
  const [photos, setPhotos] = useState<Photo[]>([]);
  const input = useRef<HTMLInputElement>(null);
  const live = useRef<Photo[]>([]);
  live.current = photos;

  // A change of shop or month starts the box empty again.
  useEffect(() => {
    setPhotos((ps) => {
      ps.forEach((p) => URL.revokeObjectURL(p.url));
      return [];
    });
  }, [resetKey]);
  useEffect(() => () => live.current.forEach((p) => URL.revokeObjectURL(p.url)), []);

  // Hand every successful reading up whenever the set changes.
  const readKey = photos.map((p) => `${p.id}:${p.status}`).join('|');
  useEffect(() => {
    onRead(photos.filter((p) => p.status === 'done' && p.transcript).map((p) => p.transcript!));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [readKey]);

  const resetKeyRef = useRef(resetKey);
  resetKeyRef.current = resetKey;
  // A reading that lands after the shop or month changed is dropped.
  const read = (p: Photo, key: string) => {
    readPhotoRemote(kind, p.file).then(
      (transcript) => key === resetKeyRef.current && setPhotos((ps) => ps.map((x) => (x.id === p.id ? { ...x, status: 'done', transcript, error: undefined } : x))),
      (err: unknown) => key === resetKeyRef.current && setPhotos((ps) => ps.map((x) => (x.id === p.id ? { ...x, status: 'error', error: err instanceof Error ? err.message : String(err) } : x))),
    );
  };
  const add = (files: FileList | null) => {
    const list = [...(files ?? [])].filter((f) => f.type.startsWith('image/') || /\.(jpe?g|png|webp|heic)$/i.test(f.name));
    if (!list.length) return;
    const fresh: Photo[] = list.map((file) => ({ id: `ph${++seq}`, name: file.name || 'photo', url: URL.createObjectURL(file), file, status: 'reading' }));
    setPhotos((ps) => [...ps, ...fresh]);
    fresh.forEach((p) => read(p, resetKey));
    if (input.current) input.current.value = '';
  };
  const remove = (id: string) =>
    setPhotos((ps) => {
      const p = ps.find((x) => x.id === id);
      if (p) URL.revokeObjectURL(p.url);
      return ps.filter((x) => x.id !== id);
    });
  const removeAll = () =>
    setPhotos((ps) => {
      ps.forEach((p) => URL.revokeObjectURL(p.url));
      return [];
    });
  const retry = (p: Photo) => {
    setPhotos((ps) => ps.map((x) => (x.id === p.id ? { ...x, status: 'reading', error: undefined } : x)));
    read(p, resetKey);
  };

  return (
    <div className="me-photo-box" data-photo-kind={kind}>
      <div className="me-photo-head">
        <span className="me-photo-title">📷 {title}</span>
        {photos.length ? (
          <button type="button" className="me-photo-link" onClick={removeAll} title="Remove every photo from this box">
            Remove all
          </button>
        ) : null}
      </div>
      <div className="me-photo-hint">{hint}</div>

      {photos.length ? (
        <ul className="me-photo-list">
          {photos.map((p) => (
            <li key={p.id} className={`me-photo-item is-${p.status}`}>
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={p.url} alt="" className="me-photo-thumb" />
              <div className="me-photo-meta">
                <div className="me-photo-name" title={p.name}>{p.name}</div>
                <div className="me-photo-state">
                  {p.status === 'reading' ? '⏳ Reading…' : p.status === 'done' ? '✓ Read' : `⚠ ${p.error}`}
                  {p.status === 'error' ? (
                    <button type="button" className="me-photo-link" onClick={() => retry(p)}>
                      Try again
                    </button>
                  ) : null}
                </div>
              </div>
              <button type="button" className="me-photo-x" onClick={() => remove(p.id)} aria-label={`Remove ${p.name}`} title="Remove this photo">
                ✕
              </button>
            </li>
          ))}
        </ul>
      ) : null}

      <label className="me-photo-add">
        <input ref={input} type="file" accept="image/*" multiple onChange={(e) => add(e.target.files)} aria-label={title} />
        {photos.length ? '➕ Add another photo' : '📷 Choose photo(s)'}
      </label>
      {summary}
    </div>
  );
}
