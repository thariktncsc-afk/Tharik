'use client';

/**
 * UPI Configuration — the office's UPI ID and payee name, the official QR
 * image, and a ₹1.00 test of the app buttons.
 *
 * The UPI ID is the SAME one the statement and DSS download payments use
 * (payment_settings): one office account for everything. Saving here
 * changes only those two fields — the download tariff and the charging
 * switch on Settings are not touched. A blank UPI ID is refused, because it
 * would make every paid download free.
 */
import { useEffect, useRef, useState } from 'react';
import { appAlert, appConfirm } from '@/components/dialog';
import { saveSuccess } from '@/components/SaveSuccess';
import { mediaUrl, removeMedia, saveUpi, uploadMedia } from '@/lib/paymentMgmt/client';
import type { PmMedia, PmSettings, PmUpiLinks } from '@/lib/paymentMgmt/types';
import { looksLikeVpa } from '@/lib/payments/upi';
import { pmMediaSaved, pmUpiSaved } from '@/lib/saveSuccess';
import { dmyTime } from '@/lib/dateFormat';
import { field } from './Modal';
import { MAX_UPLOAD_BYTES, sizeText } from './lib';

const QR_TYPES = ['image/png', 'image/jpeg', 'image/webp'];

const failed = (e: unknown) => (e instanceof Error ? e.message : 'Something went wrong. Please try again.');

export const fileBtn = {
  display: 'inline-flex',
  alignItems: 'center',
  gap: 6,
  border: '1px solid #0284C7',
  background: '#fff',
  color: '#0369A1',
  borderRadius: 8,
  padding: '6px 12px',
  fontSize: 12,
  fontWeight: 700,
  textTransform: 'none',
  letterSpacing: 'normal',
  cursor: 'pointer',
} as const;

/** The four app buttons for a set of links, and the links as text to copy or check. */
export function LinkButtons({ links }: { links: PmUpiLinks }) {
  const apps: [string, string, string][] = [
    ['Google Pay', links.gpay, '#1A73E8'],
    ['PhonePe', links.phonepe, '#5F259F'],
    ['Paytm', links.paytm, '#00B9F1'],
    ['Other UPI App', links.upi, '#0F766E'],
  ];
  return (
    <>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(130px, 1fr))', gap: 8 }}>
        {apps.map(([name, href, bg]) => (
          <a key={name} href={href} style={{ display: 'block', textAlign: 'center', background: bg, color: '#fff', borderRadius: 8, padding: '9px 10px', fontSize: 12.5, fontWeight: 700, textDecoration: 'none' }}>
            {name}
          </a>
        ))}
      </div>
      <div style={{ marginTop: 10, display: 'grid', gap: 4 }}>
        {apps.map(([name, href]) => (
          <div key={name} style={{ fontSize: 11, lineHeight: 1.45 }}>
            <span style={{ fontWeight: 700, color: 'var(--muted)' }}>{name}: </span>
            <code style={{ wordBreak: 'break-all', background: '#F8FAFC', padding: '1px 4px', borderRadius: 4 }}>{href}</code>
          </div>
        ))}
      </div>
    </>
  );
}

export default function UpiCard({
  settings,
  loadError,
  onSettings,
  onMedia,
}: {
  settings: PmSettings | null;
  loadError: string;
  onSettings: (s: PmSettings) => void;
  onMedia: (m: PmMedia) => void;
}) {
  const saved = settings?.upi ?? null;
  const [vpa, setVpa] = useState(saved?.vpa ?? '');
  const [payee, setPayee] = useState(saved?.payeeName ?? '');
  const [busy, setBusy] = useState('');

  const dirty = vpa.trim() !== (saved?.vpa ?? '') || payee.trim() !== (saved?.payeeName ?? '');

  // The boxes follow the saved details — when they first arrive (the card can
  // open before the settings have loaded) and when another administrator
  // saves — unless something is being typed here, judged against what the
  // boxes last took from the server, so it is never overwritten.
  const synced = useRef({ vpa: saved?.vpa ?? '', payee: saved?.payeeName ?? '' });
  useEffect(() => {
    const editing = vpa.trim() !== synced.current.vpa || payee.trim() !== synced.current.payee;
    synced.current = { vpa: saved?.vpa ?? '', payee: saved?.payeeName ?? '' };
    if (editing) return;
    setVpa(synced.current.vpa);
    setPayee(synced.current.payee);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [saved?.vpa, saved?.payeeName]);

  const save = async () => {
    const v = vpa.trim();
    if (!v) {
      void appAlert({ title: 'Not saved', tone: 'danger', message: 'Enter the office UPI ID. A blank UPI ID would make every statement and DSS download free.' });
      return;
    }
    if (!looksLikeVpa(v)) {
      void appAlert({ title: 'Not saved', tone: 'danger', message: `“${v}” does not look like a UPI ID. It is written name@bank — copy it exactly as the bank gives it.` });
      return;
    }
    if (saved?.vpa && v !== saved.vpa) {
      const ok = await appConfirm({
        title: 'Change the office UPI ID?',
        tone: 'warning',
        message: `From ${saved.vpa} to ${v}.\n\nStatement and DSS download payments use this UPI ID too, so they will be paid to ${v} from now on.`,
        confirmLabel: 'Change it',
        defaultCancel: true,
      });
      if (!ok) return;
    }
    setBusy('upi');
    try {
      const next = await saveUpi({ vpa: v, payeeName: payee.trim() });
      onSettings(next);
      saveSuccess(pmUpiSaved(next.upi?.vpa ?? v, next.upi?.payeeName ?? payee.trim()));
    } catch (e) {
      void appAlert({ title: 'Not saved', tone: 'danger', message: failed(e) });
    } finally {
      setBusy('');
    }
  };

  const uploadQr = async (file: File) => {
    if (file.type && !QR_TYPES.includes(file.type)) {
      void appAlert({ title: 'Not uploaded', tone: 'danger', message: 'The QR code must be a PNG, JPEG or WEBP image.' });
      return;
    }
    if (file.size > MAX_UPLOAD_BYTES) {
      void appAlert({ title: 'Not uploaded', tone: 'danger', message: `That image is ${sizeText(file.size)}; the most is 4 MB.` });
      return;
    }
    setBusy('qr');
    try {
      const { media } = await uploadMedia('qr', file);
      onMedia(media);
      saveSuccess(pmMediaSaved('qr', media.qr?.id ?? file.name));
    } catch (e) {
      void appAlert({ title: 'Not uploaded', tone: 'danger', message: failed(e) });
    } finally {
      setBusy('');
    }
  };

  const removeQr = async () => {
    const qr = settings?.media.qr;
    if (!qr) return;
    const ok = await appConfirm({
      title: 'Remove the QR code?',
      tone: 'danger',
      message: 'Shops will no longer see a QR code on the payment reminder — only the UPI ID and the app buttons.',
      confirmLabel: 'Remove',
      defaultCancel: true,
    });
    if (!ok) return;
    setBusy('qr');
    try {
      const { media } = await removeMedia(qr.id);
      onMedia(media);
      saveSuccess(pmMediaSaved('qr-removed', qr.id));
    } catch (e) {
      void appAlert({ title: 'Not removed', tone: 'danger', message: failed(e) });
    } finally {
      setBusy('');
    }
  };

  const qr = settings?.media.qr ?? null;

  return (
    <div className="card" style={{ minWidth: 0 }}>
      <div className="card-header">
        <div className="card-title">💳 UPI Configuration</div>
      </div>
      <div className="card-body">
        {loadError ? (
          <div style={{ background: '#FEF2F2', border: '1px solid #FCA5A5', color: '#B91C1C', borderRadius: 10, padding: '10px 14px', marginBottom: 14, fontSize: 13 }}>{loadError}</div>
        ) : null}

        <div style={{ background: '#F0F9FF', border: '1px solid #BAE6FD', color: '#0369A1', borderRadius: 10, padding: '10px 14px', marginBottom: 14, fontSize: 12.5, lineHeight: 1.5 }}>
          This is the office’s one UPI ID: the payment reminders use it, and so do the <strong>statement and DSS download payments</strong>. Changing it here changes it there too.
        </div>

        {!settings && !loadError ? <div style={{ fontSize: 12.5, color: 'var(--muted)', marginBottom: 14 }}>Loading…</div> : null}

        {!saved && settings ? (
          <div style={{ background: '#FFFBEB', border: '1px solid #FDE68A', color: '#92400E', borderRadius: 10, padding: '10px 14px', marginBottom: 14, fontSize: 12.5 }}>
            No UPI ID is set yet, so reminders go out without app buttons.
          </div>
        ) : null}

        <div className="form-group">
          <label htmlFor="pm-upi-vpa">UPI ID</label>
          <input id="pm-upi-vpa" value={vpa} onChange={(e) => setVpa(e.target.value)} placeholder="name@bank" autoComplete="off" spellCheck={false} style={field} />
        </div>
        <div className="form-group">
          <label htmlFor="pm-upi-payee">Payee name</label>
          <input id="pm-upi-payee" value={payee} maxLength={50} onChange={(e) => setPayee(e.target.value)} placeholder="As the bank shows it" style={field} />
        </div>
        <button type="button" className="btn btn-primary" disabled={!!busy || !dirty || !settings} onClick={() => void save()}>
          {busy === 'upi' ? 'Saving…' : 'Save UPI details'}
        </button>

        <div className="sep" />

        <div style={{ fontWeight: 700, fontSize: 13, marginBottom: 4 }}>Official UPI QR code</div>
        <div style={{ fontSize: 12, color: 'var(--muted)', marginBottom: 10, lineHeight: 1.5 }}>
          The bank’s QR image for the UPI ID above. Shops see it on the reminder to scan from another phone. PNG, JPEG or WEBP, at most 4 MB.
        </div>
        {qr ? (
          <div style={{ display: 'flex', gap: 14, alignItems: 'flex-start', flexWrap: 'wrap', marginBottom: 10 }}>
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={mediaUrl(qr.id)} alt="Official UPI QR code" width={160} height={160} style={{ width: 160, height: 160, objectFit: 'contain', border: '1px solid var(--border)', borderRadius: 10, padding: 6, background: '#fff' }} />
            <div style={{ fontSize: 12, lineHeight: 1.6, minWidth: 0, flex: '1 1 160px' }}>
              <div style={{ fontWeight: 700, wordBreak: 'break-all' }}>{qr.name}</div>
              <div style={{ color: 'var(--muted)' }}>{sizeText(qr.size)}</div>
              <div style={{ color: 'var(--muted)' }}>
                Uploaded {dmyTime(qr.at)} by {qr.byName || '—'}
              </div>
            </div>
          </div>
        ) : (
          <div style={{ fontSize: 12.5, color: 'var(--muted)', marginBottom: 10 }}>No QR code uploaded. Shops see the UPI ID and the app buttons only.</div>
        )}
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
          <label style={{ margin: 0 }}>
            <span style={{ ...fileBtn, opacity: busy ? 0.6 : 1, cursor: busy ? 'default' : 'pointer' }}>{busy === 'qr' ? 'Uploading…' : qr ? '⟳ Replace QR' : '⬆ Upload QR'}</span>
            <input
              type="file"
              accept="image/png,image/jpeg,image/webp"
              disabled={!!busy || !settings}
              style={{ display: 'none' }}
              onChange={(e) => {
                const f = e.target.files?.[0];
                e.target.value = '';
                if (f) void uploadQr(f);
              }}
            />
          </label>
          {qr ? (
            <button type="button" className="btn btn-outline btn-sm" disabled={!!busy} onClick={() => void removeQr()} style={{ borderColor: '#FCA5A5', color: '#B91C1C' }}>
              Remove QR
            </button>
          ) : null}
        </div>

        <div className="sep" />

        <div style={{ fontWeight: 700, fontSize: 13, marginBottom: 4 }}>Test UPI links (₹1.00)</div>
        {settings?.sampleLinks ? (
          <>
            <div style={{ fontSize: 12, color: 'var(--muted)', marginBottom: 10, lineHeight: 1.5 }}>
              The buttons a shop gets, for ₹1.00 to {settings.upi?.vpa}. They open an app on a phone only. Opening an app does not record a payment.
            </div>
            <LinkButtons links={settings.sampleLinks} />
          </>
        ) : (
          <div style={{ fontSize: 12.5, color: 'var(--muted)' }}>Save a UPI ID to see the test links.</div>
        )}
      </div>
    </div>
  );
}
