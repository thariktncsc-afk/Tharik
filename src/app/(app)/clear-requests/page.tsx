'use client';

/**
 * Clear / Edit Approval Requests.
 *
 * An admin sees every shop's requests and decides them here; a shop user sees
 * its own and may withdraw one it raised by mistake. Approving grants
 * permission — it does not delete anything. The deletion happens when the shop
 * next saves the cleared entry, and /api/state spends the approval then, so
 * what actually went is recorded against the decision that allowed it.
 */
import { useCallback, useEffect, useMemo, useState } from 'react';
import { useAuth } from '@/lib/authClient';
import { decideRequest, listRequests, type ClearRequest } from '@/lib/clearClient';

const TONE: Record<string, { bg: string; fg: string; bd: string; label: string }> = {
  pending: { bg: '#FFFBEB', fg: '#92400E', bd: '#FDE68A', label: 'Pending' },
  clearing: { bg: '#EFF6FF', fg: '#1D4ED8', bd: '#BFDBFE', label: 'Clearing…' },
  cleared: { bg: '#F0FDF4', fg: '#15803D', bd: '#86EFAC', label: 'Approved – Data Cleared' },
  // Written by the earlier build, where approving only granted permission.
  approved: { bg: '#F0FDF4', fg: '#15803D', bd: '#86EFAC', label: 'Approved' },
  rejected: { bg: '#FEF2F2', fg: '#B91C1C', bd: '#FCA5A5', label: 'Rejected' },
  cancelled: { bg: '#F8FAFC', fg: '#475569', bd: '#E2E8F0', label: 'Withdrawn' },
};

const fmt = (iso: string) => (iso ? new Date(iso).toLocaleString('en-IN', { day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' }) : '—');

/** The snapshot rendered as "module → record → figures the clerk would know". */
function Snapshot({ snap }: { snap: Record<string, unknown> }) {
  const lines: string[] = [];
  for (const [store, recs] of Object.entries(snap)) {
    if (Array.isArray(recs)) {
      for (const r of recs) {
        const row = r as { id?: unknown; date?: unknown; items?: Record<string, { qty?: unknown }> };
        const items = Object.entries(row.items ?? {}).map(([k, v]) => `${k} ${Number(v?.qty) || 0}`);
        lines.push(`${store} · ${String(row.date ?? row.id ?? '')} — ${items.join(', ') || 'no items'}`);
      }
      continue;
    }
    if (!recs || typeof recs !== 'object') continue;
    for (const [key, rec] of Object.entries(recs as Record<string, unknown>)) {
      let detail = '';
      if (rec && typeof rec === 'object') {
        const secs = rec as Record<string, unknown>;
        const parts: string[] = [];
        for (const sec of ['a', 'b']) {
          const blk = secs[sec];
          if (!blk || typeof blk !== 'object') continue;
          for (const [cid, v] of Object.entries(blk as Record<string, Record<string, unknown>>)) {
            const sales = Number(v?.sales) || 0;
            const open = Number(v?.open) || 0;
            if (sales || open) parts.push(`${cid} open ${open} sales ${sales}`);
          }
        }
        detail = parts.slice(0, 6).join(', ') + (parts.length > 6 ? ` … +${parts.length - 6} more` : '');
      }
      lines.push(`${store} · ${key}${detail ? ` — ${detail}` : ''}`);
    }
  }
  if (!lines.length) return <div style={{ fontSize: 11, color: '#94A3B8' }}>No stored figures captured.</div>;
  return (
    <div style={{ fontSize: 11, color: '#475569', fontFamily: 'ui-monospace, monospace', lineHeight: 1.7 }}>
      {lines.slice(0, 24).map((l, i) => (
        <div key={i}>{l}</div>
      ))}
      {lines.length > 24 ? <div style={{ color: '#94A3B8' }}>… {lines.length - 24} more records</div> : null}
    </div>
  );
}

export default function ClearRequestsPage() {
  const { user } = useAuth();
  const isAdmin = user?.role === 'ADMIN';
  const [rows, setRows] = useState<ClearRequest[]>([]);
  const [status, setStatus] = useState('pending');
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState<number | null>(null);
  const [notes, setNotes] = useState<Record<number, string>>({});
  const [open, setOpen] = useState<Record<number, boolean>>({});
  const [loading, setLoading] = useState(true);

  const load = useCallback(() => {
    setLoading(true);
    listRequests(status)
      .then((rs) => {
        setRows(rs);
        setErr('');
      })
      .catch((e) => setErr(e instanceof Error ? e.message : String(e)))
      .finally(() => setLoading(false));
  }, [status]);

  useEffect(load, [load]);

  const decide = async (id: number, action: 'approve' | 'reject' | 'cancel') => {
    setBusy(id);
    try {
      await decideRequest(id, action, notes[id] ?? '');
      load();
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(null);
    }
  };

  const counts = useMemo(() => rows.length, [rows]);

  return (
    <div className="page active" id="page-clear-requests">
      <div className="page-header">
        <div className="page-title">Clear / Edit Approval Requests</div>
        <div className="page-sub">
          {isAdmin
            ? 'Shop staff cannot remove saved figures on their own — every clear is decided here and recorded.'
            : 'Your requests to clear saved entries. The figures stay unchanged until an administrator approves.'}
        </div>
      </div>

      <div className="card mb-4">
        <div className="card-body flex gap-3" style={{ alignItems: 'center' }}>
          <span style={{ fontSize: 18, color: 'var(--muted)' }}>🔍</span>
          <select value={status} onChange={(e) => setStatus(e.target.value)} style={{ width: 180, fontSize: 12, padding: '6px 10px' }}>
            {['pending', 'approved', 'rejected', 'consumed', 'cancelled', 'all'].map((s) => (
              <option key={s} value={s}>
                {s === 'all' ? 'All requests' : (TONE[s]?.label ?? s)}
              </option>
            ))}
          </select>
          <button className="btn btn-outline btn-sm" onClick={load}>↻ Refresh</button>
          <span className="text-muted text-sm" style={{ marginLeft: 'auto' }}>{counts} request{counts === 1 ? '' : 's'}</span>
        </div>
      </div>

      {err ? (
        <div style={{ background: '#FEF2F2', border: '1px solid #FCA5A5', borderRadius: 10, padding: '12px 16px', marginBottom: 14, color: '#B91C1C', fontSize: 13 }}>{err}</div>
      ) : null}

      {loading ? (
        <div style={{ textAlign: 'center', padding: '48px 24px', color: 'var(--muted)', fontSize: 13 }}>Loading…</div>
      ) : !rows.length ? (
        <div style={{ textAlign: 'center', padding: '64px 24px', color: 'var(--muted)' }}>
          <div style={{ fontSize: 52, marginBottom: 14 }}>🗂</div>
          <div style={{ fontWeight: 700, fontSize: 16, color: 'var(--text)', marginBottom: 6 }}>Nothing here</div>
          <div style={{ fontSize: 13 }}>No {status === 'all' ? '' : (TONE[status]?.label ?? status).toLowerCase()} clear requests.</div>
        </div>
      ) : (
        rows.map((r) => {
          const tone = TONE[r.status] ?? TONE.pending;
          const canDecide = isAdmin && (r.status === 'pending' || r.status === 'approved');
          const canCancel = !isAdmin && r.status === 'pending' && r.requestedBy === user?.username;
          return (
            <div key={r.id} className="card mb-4">
              <div style={{ padding: '14px 18px', display: 'flex', gap: 14, alignItems: 'flex-start', flexWrap: 'wrap' }}>
                <div style={{ flex: 1, minWidth: 260 }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
                    <strong style={{ fontSize: 14 }}>CRS {r.crsId} — {r.shopName}</strong>
                    <span style={{ background: tone.bg, color: tone.fg, border: `1px solid ${tone.bd}`, borderRadius: 6, padding: '2px 9px', fontSize: 11, fontWeight: 800 }}>{tone.label}</span>
                    <span style={{ fontSize: 11, color: '#64748B' }}>#{r.id}</span>
                  </div>
                  <div style={{ marginTop: 6, fontSize: 13, color: '#334155' }}>
                    <strong>{r.scopeLabel}</strong> · {r.modules.join(', ') || 'Saved data'}
                  </div>
                  <div style={{ marginTop: 6, fontSize: 12, color: '#475569' }}>Reason: {r.reason}</div>
                  <div style={{ marginTop: 4, fontSize: 11, color: '#64748B' }}>
                    Requested by <strong>{r.requestedBy}</strong>
                    {r.requestedRole ? ` (${r.requestedRole})` : ''} · {fmt(r.createdAt)}
                  </div>
                  {r.decidedBy ? (
                    <div style={{ marginTop: 4, fontSize: 11, color: tone.fg }}>
                      Approved by <strong>{r.decidedBy}</strong> · {fmt(r.decidedAt ?? '')}
                      {r.decisionNote ? ` — ${r.decisionNote}` : ''}
                      {r.clearedAt ? ` · data cleared ${fmt(r.clearedAt)}` : ''}
                    </div>
                  ) : null}
                  {r.lastError ? (
                    <div style={{ marginTop: 6, background: '#FEF2F2', border: '1px solid #FCA5A5', borderRadius: 8, padding: '7px 11px', fontSize: 11, color: '#B91C1C' }}>
                      The last approval failed and nothing was removed — still pending. {r.lastError}
                    </div>
                  ) : null}
                  {r.clearedRecords?.length ? (
                    <div style={{ marginTop: 6, fontSize: 11, color: '#15803D' }}>
                      Removed: {r.clearedRecords.map((c) => `${c.module} ${c.key}`).join(', ')}
                    </div>
                  ) : null}
                  <button
                    className="btn btn-outline btn-sm"
                    style={{ marginTop: 10 }}
                    onClick={() => setOpen((p) => ({ ...p, [r.id]: !p[r.id] }))}
                  >
                    {open[r.id] ? '▾ Hide existing values' : '▸ Existing values'}
                  </button>
                  {open[r.id] ? (
                    <div style={{ marginTop: 10, background: '#F8FAFC', border: '1px solid #E2E8F0', borderRadius: 8, padding: '10px 12px', maxHeight: 260, overflow: 'auto' }}>
                      <Snapshot snap={r.snapshot} />
                    </div>
                  ) : null}
                </div>

                {r.status === 'approved' ? (
                  <div style={{ marginTop: 8, background: '#FFFBEB', border: '1px solid #FDE68A', borderRadius: 8, padding: '8px 12px', fontSize: 11, color: '#92400E' }}>
                    Approved under the earlier build, which only granted permission — the figures were never removed. Press Approve again to run the clear.
                  </div>
                ) : null}

                {canDecide || canCancel ? (
                  <div style={{ width: 260, flexShrink: 0 }}>
                    {canDecide ? (
                      <>
                        <input
                          value={notes[r.id] ?? ''}
                          onChange={(e) => setNotes((p) => ({ ...p, [r.id]: e.target.value }))}
                          placeholder="Note (optional)"
                          style={{ width: '100%', border: '1px solid #CBD5E1', borderRadius: 8, padding: '7px 10px', fontSize: 12 }}
                        />
                        <div style={{ display: 'flex', gap: 8, marginTop: 8 }}>
                          <button
                            disabled={busy === r.id}
                            onClick={() => void decide(r.id, 'approve')}
                            style={{ flex: 1, background: '#16A34A', color: '#fff', border: 'none', borderRadius: 8, padding: '9px 0', fontSize: 13, fontWeight: 700, cursor: 'pointer' }}
                          >
                            ✓ Approve
                          </button>
                          <button
                            disabled={busy === r.id}
                            onClick={() => void decide(r.id, 'reject')}
                            style={{ flex: 1, background: '#DC2626', color: '#fff', border: 'none', borderRadius: 8, padding: '9px 0', fontSize: 13, fontWeight: 700, cursor: 'pointer' }}
                          >
                            ✕ Reject
                          </button>
                        </div>
                      </>
                    ) : (
                      <button
                        disabled={busy === r.id}
                        onClick={() => void decide(r.id, 'cancel')}
                        style={{ width: '100%', background: '#F1F5F9', color: '#475569', border: '1px solid var(--border)', borderRadius: 8, padding: '9px 0', fontSize: 13, fontWeight: 700, cursor: 'pointer' }}
                      >
                        Withdraw request
                      </button>
                    )}
                  </div>
                ) : null}
              </div>
            </div>
          );
        })
      )}
    </div>
  );
}
