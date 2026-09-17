'use client';

/**
 * The popup a shop user gets when Clear would destroy saved figures.
 *
 * Two options, as specified: Request Admin Approval, or Cancel. It says
 * exactly what an approval will remove — one date, or a whole month with its
 * day sheets — and it follows the request live: an administrator approving or
 * rejecting it elsewhere shows up here without a refresh (dataStore.ts).
 *
 * This dialog is courtesy, not security — /api/state refuses the write either
 * way. It exists so the refusal arrives before the user retypes a day's work.
 */
import { useEffect, useState } from 'react';
import { crsData, useLiveRevision } from '@/lib/dataStore';
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

/** What an approval removes — the rule in clearExecute.ts, in the clerk's words. */
function scopeNote(s: ClearScope): string {
  if (s.scopeKind === 'month') {
    return (
      `Approving clears the whole of ${s.scopeLabel} for CRS ${s.crsId}: Monthly Entry, remittance, gunny, card details, allotment and Sales Close for the month, ` +
      `and every Daily Sales sheet dated in ${s.scopeLabel} with its remittance and inspection. Other months, other shops and the Receipt register are not touched.`
    );
  }
  if (s.scopeKind === 'day') {
    return (
      `Approving clears CRS ${s.crsId} for ${s.scopeLabel} only: that day's Daily Sales sheet, the remittance on it and any inspection recorded that date. ` +
      'No other date is touched. Later saved days that carried their Opening from this day are re-carried from the closing before it.'
    );
  }
  return '';
}

const dayOf = (key: string) => key.slice(key.indexOf('_') + 1).split('-').reverse().join('/');

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
  /** The request this dialog has seen open — the one to follow to its end. */
  const [watching, setWatching] = useState<number | null>(null);
  const [loading, setLoading] = useState(true);
  const clearsRev = useLiveRevision('clears');

  useEffect(() => {
    let alive = true;
    listRequests()
      .then((rs) => {
        if (!alive) return;
        const latest = findLatest(rs, scope.storeKeys) ?? null;
        setExisting(latest);
        if (latest && (latest.status === 'pending' || latest.status === 'clearing')) setWatching(latest.id);
      })
      .catch((e) => alive && setErr(e instanceof Error ? e.message : String(e)))
      .finally(() => alive && setLoading(false));
    return () => {
      alive = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [scope.storeKeys.join('|'), clearsRev]);

  const submit = async () => {
    setBusy(true);
    setErr('');
    try {
      const req = await requestClear(scope, reason);
      setSent(req);
      setWatching(req.id);
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

  // A request cleared BEFORE this dialog opened is history: the entry has been
  // keyed again since (the dialog only opens over saved figures), so it must
  // be possible to ask again. Only the request followed here reports "cleared".
  const followed = existing && existing.id === watching ? existing : null;
  const current = followed ?? sent ?? existing;

  if (followed?.status === 'cleared') {
    const recarried = followed.recalculatedKeys ?? [];
    return card(
      <>
        <div style={{ fontSize: 13, color: '#334155', lineHeight: 1.6 }}>
          The administrator approved this request and <strong>the data has been cleared</strong>
          {followed.decidedBy ? ` (${followed.decidedBy})` : ''}. There is nothing left to remove — this {scope.scopeKind === 'month' ? 'month' : 'day'} is ready to be keyed again.
        </div>
        {followed.clearedRecords?.length ? (
          <div style={{ marginTop: 10, fontSize: 12, color: '#475569' }}>
            Removed: {followed.clearedRecords.map((c) => `${c.module} ${c.key}`).join(', ')}
          </div>
        ) : null}
        {recarried.length ? (
          <div style={{ marginTop: 6, fontSize: 12, color: '#475569' }}>Opening re-carried on: {recarried.map(dayOf).join(', ')}</div>
        ) : null}
        <div style={{ display: 'flex', justifyContent: 'flex-end', marginTop: 16 }}>
          <button
            type="button"
            onClick={() => {
              // Live sync has normally brought the change already; this makes sure.
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

  if (current?.status === 'clearing') {
    return card(
      <>
        <div style={{ fontSize: 13, color: '#334155', lineHeight: 1.6 }}>
          The administrator has approved this request and the data is <strong>being cleared now</strong>. This updates by itself when it is done.
        </div>
        <div style={{ display: 'flex', justifyContent: 'flex-end', marginTop: 16 }}>{closeBtn()}</div>
      </>,
      'linear-gradient(135deg,#1D4ED8,#3B82F6)',
    );
  }

  if (current?.status === 'pending') {
    return card(
      <>
        <div style={{ fontSize: 13, color: '#334155', lineHeight: 1.6 }}>
          Your request is <strong>waiting for the administrator</strong>. The figures stay exactly as they are until it is approved.
        </div>
        <div style={{ marginTop: 12, background: '#F8FAFC', border: '1px solid #E2E8F0', borderRadius: 10, padding: '10px 14px', fontSize: 12, color: '#475569' }}>
          <div><strong>Request #{current.id}</strong> · {current.modules.join(', ') || 'Saved data'}</div>
          <div style={{ marginTop: 4 }}>Reason: {current.reason}</div>
          <div style={{ marginTop: 4, color: '#64748B' }}>Raised {new Date(current.createdAt).toLocaleString('en-IN')}</div>
        </div>
        <div style={{ marginTop: 10, fontSize: 11.5, color: '#64748B', lineHeight: 1.5 }}>{scopeNote(scope)}</div>
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
      {scopeNote(scope) ? (
        <div style={{ marginTop: 10, background: '#FFFBEB', border: '1px solid #FDE68A', borderRadius: 8, padding: '8px 12px', fontSize: 12, color: '#92400E', lineHeight: 1.5 }}>
          {scopeNote(scope)}
        </div>
      ) : null}
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
