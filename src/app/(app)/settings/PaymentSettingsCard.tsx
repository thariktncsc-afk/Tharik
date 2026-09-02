'use client';

/**
 * Download charges: the payee handle and the tariff.
 *
 * Kept apart from the rest of Settings because it saves somewhere else. The
 * other rows live in `__config`, which any signed-in user can write through
 * /api/state; the payee VPA cannot live there, or a shop user could point every
 * payment at their own handle. This card talks to /api/payments/settings, which
 * is admin-only.
 *
 * Prices are entered in rupees and stored in paise — the conversion happens
 * once, here, at the edge.
 */
import { useEffect, useState } from 'react';
import { appAlert } from '@/components/dialog';
import { DEFAULT_SETTINGS, formatRupees, quoteDss, quoteStatement, type PaymentSettings } from '@/lib/payments/pricing';
import { saveSettings } from '@/lib/payments/client';

const toRupees = (paise: number) => (paise / 100).toFixed(2);
const toPaise = (rupees: string) => Math.round(Number(rupees || '0') * 100);

export default function PaymentSettingsCard() {
  const [s, setS] = useState<PaymentSettings>(DEFAULT_SETTINGS);
  const [loaded, setLoaded] = useState(false);
  const [busy, setBusy] = useState(false);
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    fetch('/api/payments/settings', { headers: { Accept: 'application/json' } })
      .then((r) => (r.ok ? r.json() : null))
      .then((b) => {
        if (b?.settings) setS(b.settings);
        setLoaded(true);
      })
      .catch(() => setLoaded(true));
  }, []);

  const save = async () => {
    setBusy(true);
    try {
      setS(await saveSettings(s));
      setSaved(true);
      setTimeout(() => setSaved(false), 3000);
    } catch (e) {
      void appAlert(e instanceof Error ? e.message : 'Could not save payment settings.');
    } finally {
      setBusy(false);
    }
  };

  const field = { width: '100%', border: '1px solid var(--border)', borderRadius: 8, padding: '8px 12px', fontSize: 13 } as const;

  // Worked examples, so the effect of a rate change is visible before saving
  // rather than discovered by a customer.
  const thirteen = quoteStatement(13, s);
  const fourteen = quoteStatement(14, s);
  const dss30 = quoteDss(30, s);

  return (
    <div className="card">
      <div className="card-body">
        <div style={{ fontWeight: 700, fontSize: 15, marginBottom: 4 }}>Download Charges</div>
        <div className="text-sm text-muted" style={{ marginBottom: 14 }}>
          Shop users pay per sheet before a statement can be previewed, printed or exported. Administrator
          downloads are always free. Payment is settled over UPI and approved by hand on the Payments screen —
          this application never sees the money move.
        </div>

        {saved ? (
          <div className="success-banner" style={{ marginBottom: 14 }}>
            ✅ Payment settings saved.
          </div>
        ) : null}

        <label style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 16, cursor: 'pointer' }}>
          <input type="checkbox" checked={s.enabled} onChange={(e) => setS({ ...s, enabled: e.target.checked })} style={{ width: 16, height: 16 }} />
          <span style={{ fontSize: 13, fontWeight: 700 }}>Charge shop users for downloads</span>
          <span style={{ fontSize: 11.5, color: 'var(--muted)' }}>
            {s.enabled ? 'On — sheets are locked until an admin approves payment' : 'Off — every download is free for everyone'}
          </span>
        </label>

        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 14, marginBottom: 14 }}>
          <div>
            <label className="form-label" htmlFor="pay-vpa">
              UPI ID (payee VPA)
            </label>
            <input id="pay-vpa" value={s.upiVpa} onChange={(e) => setS({ ...s, upiVpa: e.target.value.trim() })} placeholder="office@okaxis" style={field} />
          </div>
          <div>
            <label className="form-label" htmlFor="pay-payee">
              Payee name shown in the UPI app
            </label>
            <input id="pay-payee" value={s.upiPayeeName} onChange={(e) => setS({ ...s, upiPayeeName: e.target.value })} placeholder="TNCSC CRS Madurai" style={field} />
          </div>
        </div>

        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 14, marginBottom: 14 }}>
          <div>
            <label className="form-label" htmlFor="pay-sheet">
              Per statement sheet (₹, GST included)
            </label>
            <input
              id="pay-sheet"
              type="number"
              min={0}
              step="0.01"
              value={toRupees(s.statementSheetPaise)}
              onChange={(e) => setS({ ...s, statementSheetPaise: toPaise(e.target.value) })}
              style={field}
            />
          </div>
          <div>
            <label className="form-label" htmlFor="pay-dss">
              DSS per day (₹, plus GST)
            </label>
            <input
              id="pay-dss"
              type="number"
              min={0}
              step="0.01"
              value={toRupees(s.dssDayPaise)}
              onChange={(e) => setS({ ...s, dssDayPaise: toPaise(e.target.value) })}
              style={field}
            />
          </div>
          <div>
            <label className="form-label" htmlFor="pay-gst">
              GST rate (%)
            </label>
            <input
              id="pay-gst"
              type="number"
              min={0}
              max={100}
              step="0.01"
              value={(s.gstRateBp / 100).toString()}
              onChange={(e) => setS({ ...s, gstRateBp: Math.round(Number(e.target.value || '0') * 100) })}
              style={field}
            />
          </div>
        </div>

        <div style={{ background: '#F8FAFC', border: '1px solid var(--border)', borderRadius: 10, padding: '12px 14px', fontSize: 12, lineHeight: 1.7 }}>
          <strong>At these rates</strong>
          <div style={{ color: 'var(--muted)' }}>
            13 sheets (a shop user’s full set) — <strong>{formatRupees(thirteen.totalPaise)}</strong>, of which{' '}
            {formatRupees(thirteen.gstPaise)} is GST · 14 sheets (including the admin-only COLL) —{' '}
            <strong>{formatRupees(fourteen.totalPaise)}</strong> · A 30-day DSS —{' '}
            <strong>{formatRupees(dss30.totalPaise)}</strong> ({formatRupees(dss30.basePaise)} + {formatRupees(dss30.gstPaise)} GST)
          </div>
          <div style={{ color: 'var(--muted)', marginTop: 6 }}>
            A sheet is a statement section, not a printed copy — the sections that print twice still cost one
            sheet. CRS 29 uses a different twelve-section family and is priced the same way, per section.
          </div>
        </div>

        <div style={{ display: 'flex', justifyContent: 'flex-end', marginTop: 14 }}>
          <button className="btn btn-primary" onClick={() => void save()} disabled={busy || !loaded}>
            {busy ? 'Saving…' : '💾 Save Charges'}
          </button>
        </div>
      </div>
    </div>
  );
}
