'use client';

/**
 * The popup a shop user gets when Clear would destroy saved figures.
 *
 * Two options, as specified: Request Admin Approval, or Cancel. It also shows
 * the state of an existing request, so pressing Clear again tells the user
 * where their last one got to rather than silently doing nothing.
 *
 * This dialog is courtesy, not security — /api/state refuses the write either
 * way. It exists so the refusal arrives before the user retypes a day's work.
 */
import { useEffect, useState } from 'react';
import { crsData } from '@/lib/dataStore';
import { findLatest, listRequests, requestClear, type ClearRequest, type ClearScope } from '@/lib/clearClient';

const overlay: React.CSSProperties = {
  position: 'fixed',
  inset: 0,
  zIndex: 9600,
  background: 'rgba(13,30,63,.55)',
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  padding: 20,
};

export default function ClearRequestDialog({
  scope,
  onClose,
  onApprovedClear,
}: {
  scope: ClearScope;
  onClose: () => void;
  /** Called when an approval is already in hand, so the caller may clear now. */
  onApprovedClear?: () => void;
}) {
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const [existing, setExisting] = useState<ClearRequest | null>(null);
  const [sent, setSent] = useState<ClearRequest | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let alive = true;
    listRequests()
      .then((rs) => {
        if (alive) setExisting(findLatest(rs, scope.storeKeys) ?? null);
      })
      .catch((e) => alive && setErr(e instanceof Error ? e.message : String(e)))
      .finally(() => alive && setLoading(false));
    return () => {
      alive = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [scope.storeKeys.join('|')]);

  const submit = async () => {
    setBusy(true);
    setErr('');
    try {
      setSent(await requestClear(scope, reason));
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  const card = (children: React.ReactNode, tone: string) => (
    <div style={overlay} onClick={(e) => e.target === e.currentTarget && onClose()}>
      <div style={{ background: '#fff', borderRadius: 16, width: '100%', maxWidth: 520, boxShadow: '0 20px 60px rgba(0,0,0,.3)', overflow: 'hidden' }}>
        <div style={{ background: tone, padding: '16px 20px', color: '#fff' }}>
          <div style={{ fontWeight: 800, fontSize: 16 }}>🔒 Admin approval required</div>
          <div style={{ fontSize: 12, opacity: 0.85, marginTop: 2 }}>
            CRS {scope.crsId} — {scope.shopName} • {scope.scopeLabel}
          </div>
        </div>
        <div style={{ padding: '18px 20px' }}>{children}</div>
      </div>
    </div>
  );

  const closeBtn = (label = 'Close') => (
    <button type="button" onClick={onClose} style={{ background: '#F1F5F9', border: 'none', borderRadius: 10, padding: '10px 20px', fontSize: 13, fontWeight: 600, color: '#475569', cursor: 'pointer' }}>
      {label}
    </button>
  );

  if (loading) return card(<div style={{ fontSize: 13, color: '#64748B' }}>Checking for an existing request…</div>, 'linear-gradient(135deg,#B45309,#F59E0B)');

  if (existing?.status === 'cleared') {
    return card(
      <>
        <div style={{ fontSize: 13, color: '#334155', lineHeight: 1.6 }}>
          The administrator approved this request and <strong>the data has been cleared</strong>
          {existing.decidedBy ? ` (${existing.decidedBy})` : ''}. There is nothing left to remove — this day is ready to be keyed again.
        </div>
        {existing.clearedRecords?.length ? (
          <div style={{ marginTop: 10, fontSize: 12, color: '#475569' }}>
            Removed: {existing.clearedRecords.map((c) => `${c.module} ${c.key}`).join(', ')}
          </div>
        ) : null}
        <div style={{ display: 'flex', justifyContent: 'flex-end', marginTop: 16 }}>
          <button
            type="button"
            onClick={() => {
              // This browser still holds the figures the server just removed.
              void crsData.load();
              onApprovedClear?.();
              onClose();
            }}
            style={{ background: '#16A34A', color: '#fff', border: 'none', borderRadius: 10, padding: '10px 20px', fontSize: 13, fontWeight: 700, cursor: 'pointer' }}
          >
            Reload this entry
          </button>
        </div>
      </>,
      'linear-gradient(135deg,#15803D,#22C55E)',
    );
  }

  if (existing?.status === 'clearing') {
    return card(
      <>
        <div style={{ fontSize: 13, color: '#334155', lineHeight: 1.6 }}>
          The administrator has approved this request and the data is <strong>being cleared now</strong>. Reopen this in a moment.
        </div>
        <div style={{ display: 'flex', justifyContent: 'flex-end', marginTop: 16 }}>{closeBtn()}</div>
      </>,
      'linear-gradient(135deg,#1D4ED8,#3B82F6)',
    );
  }

  if (sent || existing?.status === 'pending') {
    const r = sent ?? existing!;
    return card(
      <>
        <div style={{ fontSize: 13, color: '#334155', lineHeight: 1.6 }}>
          Your request is <strong>waiting for the administrator</strong>. The figures stay exactly as they are until it is approved.
        </div>
        <div style={{ marginTop: 12, background: '#F8FAFC', border: '1px solid #E2E8F0', borderRadius: 10, padding: '10px 14px', fontSize: 12, color: '#475569' }}>
          <div><strong>Request #{r.id}</strong> · {r.modules.join(', ') || 'Saved data'}</div>
          <div style={{ marginTop: 4 }}>Reason: {r.reason}</div>
          <div style={{ marginTop: 4, color: '#64748B' }}>Raised {new Date(r.createdAt).toLocaleString('en-IN')}</div>
        </div>
        <div style={{ display: 'flex', justifyContent: 'flex-end', marginTop: 16 }}>{closeBtn()}</div>
      </>,
      'linear-gradient(135deg,#B45309,#F59E0B)',
    );
  }


  return card(
    <>
      <div style={{ fontSize: 13, color: '#334155', lineHeight: 1.6 }}>
        This entry already contains saved data. Admin approval is required to clear or reset this entry.
      </div>
      {existing?.status === 'rejected' ? (
        <div style={{ marginTop: 10, background: '#FEF2F2', border: '1px solid #FCA5A5', borderRadius: 8, padding: '8px 12px', fontSize: 12, color: '#B91C1C' }}>
          Your clear request was rejected by the administrator.
          {existing.decisionNote ? ` — ${existing.decisionNote}` : ''}
        </div>
      ) : null}
      <label style={{ display: 'block', marginTop: 14, fontSize: 12, fontWeight: 700, color: '#475569' }}>
        Reason for clearing <span style={{ color: '#DC2626' }}>*</span>
      </label>
      <textarea
        value={reason}
        onChange={(e) => setReason(e.target.value)}
        rows={3}
        placeholder="Why does this entry need to be cleared?"
        style={{ width: '100%', marginTop: 6, border: '1px solid #CBD5E1', borderRadius: 8, padding: '8px 10px', fontSize: 13, resize: 'vertical', fontFamily: 'inherit' }}
      />
      {err ? <div style={{ marginTop: 10, fontSize: 12, color: '#B91C1C' }}>{err}</div> : null}
      <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 10, marginTop: 16 }}>
        {closeBtn('Cancel')}
        <button
          type="button"
          disabled={busy || reason.trim().length < 5}
          onClick={() => void submit()}
          style={{
            background: busy || reason.trim().length < 5 ? '#94A3B8' : 'linear-gradient(135deg,#B45309,#F59E0B)',
            color: '#fff', border: 'none', borderRadius: 10, padding: '10px 20px', fontSize: 13, fontWeight: 700,
            cursor: busy || reason.trim().length < 5 ? 'not-allowed' : 'pointer',
          }}
        >
          {busy ? 'Sending…' : 'Request Admin Approval'}
        </button>
      </div>
    </>,
    'linear-gradient(135deg,#B45309,#F59E0B)',
  );
}
