'use client';

/**
 * "Preview what the shop sees" — the shop's own reminder card
 * (PaymentReminderCard), drawn from this row with the office's current UPI
 * ID and QR. No sound and no OK: nothing is sent, and the shop sees nothing
 * until a reminder is.
 */
import PaymentReminderCard from '@/components/PaymentReminderCard';
import { mediaUrl } from '@/lib/paymentMgmt/client';
import type { PmSettings, PmView } from '@/lib/paymentMgmt/types';
import Modal from './Modal';
import { shopViewOf } from './lib';

export default function PreviewModal({ ob, settings, onClose }: { ob: PmView; settings: PmSettings | null; onClose: () => void }) {
  const upi = settings?.upi ?? null;
  const qr = settings?.media.qr ?? null;
  return (
    <Modal
      title="👁 What the shop sees"
      tone="blue"
      width={460}
      dismissable
      sub={`CRS ${ob.crsId} — ${ob.shopName}. A preview only: nothing is sent from here.`}
      onClose={onClose}
      foot={
        <button type="button" className="btn btn-outline" onClick={onClose}>
          Close
        </button>
      }
    >
      {!settings ? <div style={{ fontSize: 12, color: '#92400E', marginBottom: 10 }}>The UPI details could not be read, so the preview shows none.</div> : null}
      <div style={{ border: '1px solid var(--border)', borderRadius: 12, overflow: 'hidden', margin: '-4px -4px 0' }}>
        <PaymentReminderCard item={shopViewOf(ob, upi)} shopName={ob.shopName} upi={upi} qrUrl={qr ? mediaUrl(qr.id) : null} />
      </div>
      <div style={{ fontSize: 11.5, color: 'var(--muted)', marginTop: 10, lineHeight: 1.5 }}>
        On the shop’s screen this opens by itself when a reminder is sent, with the reminder sound, and stays until someone there presses OK.
      </div>
    </Modal>
  );
}
