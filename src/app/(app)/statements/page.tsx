'use client';

/**
 * Statement Generation.
 *
 * This screen no longer builds statements. It used to construct the legacy
 * engine in the browser and render every section locally, which meant any
 * paywall here was advisory — the document was already in the page. The
 * builders now run in /api/statements/render, behind the entitlement check,
 * and this file only asks for what the user selected and presents what comes
 * back. Preview, Print and Excel all take that same route, because they are
 * the same document: gating the download alone would have collected nothing.
 *
 * The builders themselves are untouched (src/generated/statements-legacy.js,
 * verified byte-for-byte by tools/verify-statements.mjs) — only their location
 * changed.
 */
import { useCallback, useEffect, useMemo, useState } from 'react';
import { appAlert } from '@/components/dialog';
import PaymentDialog from '@/components/PaymentDialog';
import { useAuth } from '@/lib/authClient';
import { crsData, useDataStatus } from '@/lib/dataStore';
import { useShops } from '@/lib/masters';
import { formatRupees, quoteStatement } from '@/lib/payments/pricing';
import {
  ApiError,
  createOrder,
  fetchAccess,
  fetchOrders,
  renderStatements,
  STATUS_LABEL,
  STATUS_COLOR,
  type Access,
  type Order,
  type Rendered,
  type Section,
  type Upi,
} from '@/lib/payments/client';

const MONTHS = ['', 'January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];

const MODULES: { key: string; label: string }[] = [
  { key: 'monthly', label: 'Monthly Entry' },
  { key: 'daily', label: 'Daily Entry' },
  { key: 'receipt', label: 'Receipt' },
  { key: 'inspection', label: 'Inspection' },
  { key: 'gunny', label: 'Gunny Stock' },
  { key: 'cards', label: 'Card Details' },
  { key: 'remittance', label: 'Remittance' },
];

export default function StatementsPage() {
  const { user } = useAuth();
  const { status } = useDataStatus();
  const shops = useShops();
  const now = new Date();

  const isCrsUser = !!user?.crsId && user.role !== 'ADMIN';
  const isAdmin = !user || user.role === 'ADMIN';
  const shopIds = isCrsUser ? [user!.crsId as number] : shops.map((_, i) => i + 1);

  const [crsVal, setCrsVal] = useState(isCrsUser ? String(user!.crsId) : '');
  const [month, setMonth] = useState(now.getMonth() + 1);
  const [year, setYear] = useState(now.getFullYear());
  const [selected, setSelected] = useState<Record<string, boolean>>({});
  const [preview, setPreview] = useState<null | { section: Section; html: string; sub: string }>(null);
  const [history, setHistory] = useState<{ at: string; label: string; crsId: number; period: string }[]>([]);

  const [access, setAccess] = useState<Access | null>(null);
  const [orders, setOrders] = useState<Order[]>([]);
  const [busy, setBusy] = useState('');
  const [pay, setPay] = useState<null | { order: Order; upi: Upi | null }>(null);

  const crsId = crsVal ? Number(crsVal) : null;

  // ── Access ────────────────────────────────────────────────────────────────
  const refreshAccess = useCallback(async () => {
    if (!crsId) {
      setAccess(null);
      return;
    }
    try {
      const [a, o] = await Promise.all([fetchAccess(crsId, month, year), fetchOrders().catch(() => [])]);
      setAccess(a);
      setOrders(o);
    } catch (e) {
      setAccess(null);
      if (e instanceof ApiError && e.status !== 403) console.error('[statements] access failed:', e.message);
    }
  }, [crsId, month, year]);

  useEffect(() => {
    void refreshAccess();
  }, [refreshAccess]);

  const sections = access?.sections ?? [];
  const avail = access?.avail ?? null;
  const paid = useMemo(() => new Set(access?.paidSections ?? []), [access]);
  const free = access?.free ?? false;
  const locked = useCallback((id: string) => !free && !paid.has(id), [free, paid]);

  const labels = useMemo(() => Object.fromEntries(sections.map((s) => [s.id, s.label])), [sections]);

  const selectedIds = useMemo(() => Object.keys(selected).filter((id) => selected[id]), [selected]);
  const unpaidSelected = useMemo(() => selectedIds.filter(locked), [selectedIds, locked]);

  const quote = access ? quoteStatement(unpaidSelected.length, access.settings) : null;

  const openForMonth = orders.filter(
    (o) => o.crsId === crsId && o.month === month && o.year === year && (o.status === 'pending' || o.status === 'awaiting_approval'),
  );

  const record = (label: string) =>
    setHistory((h) => [{ at: new Date().toLocaleString('en-IN'), label, crsId: crsId!, period: `${MONTHS[month]} ${year}` }, ...h].slice(0, 50));

  // ── Rendering (server) ────────────────────────────────────────────────────

  /**
   * The statements are built from the DATABASE now, not from this tab's
   * memory, so anything typed in the last few seconds has to be flushed first
   * — otherwise a figure entered and immediately previewed would be missing.
   */
  const render = async (ids: string[], what: string): Promise<Rendered | null> => {
    if (!crsId) {
      void appAlert('Please select a CRS shop first.');
      return null;
    }
    if (!ids.length) {
      void appAlert('Please select at least one section.');
      return null;
    }
    setBusy(what);
    try {
      await crsData.save();
      return await renderStatements({ crsId, month, year, sectionIds: ids });
    } catch (e) {
      if (e instanceof ApiError && e.status === 402) {
        // Not paid for. Raise the order for exactly the sheets that are owing
        // and put the QR in front of the customer rather than an error.
        await startPayment(e.unpaid.length ? e.unpaid : ids);
        return null;
      }
      void appAlert(e instanceof Error ? e.message : 'Could not build the statements.');
      return null;
    } finally {
      setBusy('');
    }
  };

  const openPrintWindow = (title: string, css: string, html: string) => {
    const win = window.open('', '_blank', 'width=900,height=700');
    if (!win) {
      void appAlert('The print window was blocked by the browser. Allow pop-ups for this site and try again.');
      return;
    }
    win.document.write(`<html><head><title>${title}</title><style>${css}</style></head><body>${html}</body></html>`);
    win.document.close();
    win.focus();
    setTimeout(() => win.print(), 600);
  };

  const doPreview = async (section: Section) => {
    const out = await render([section.id], `preview:${section.id}`);
    if (!out) return;
    const built = out.sections[0];
    setPreview({
      section,
      html: `<style>${out.css}</style>` + built.html,
      sub: `CRS ${crsId} — ${out.period.mo} ${out.period.yr}${section.copies > 1 ? ` — ×${section.copies} copies` : ''}`,
    });
    record(section.label);
  };

  const printSelected = async () => {
    const out = await render(selectedIds, 'print');
    if (!out) return;
    let html = '';
    for (const s of out.sections) for (let i = 0; i < s.copies; i++) html += s.html;
    openPrintWindow(`TNCSC Statements - CRS ${crsId} ${MONTHS[month]} ${year}`, out.css, html);
    out.sections.forEach((s) => record(s.label));
  };

  const excelSelected = async () => {
    const out = await render(selectedIds, 'excel');
    if (!out) return;
    let html = '<html><head><meta charset="UTF-8"/></head><body>';
    for (const s of out.sections) html += `<h2>${s.label}</h2>` + s.html + '<br><br>';
    html += '</body></html>';
    const blob = new Blob([html], { type: 'application/vnd.ms-excel' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `TNCSC_CRS${crsId}_${MONTHS[month]}_${year}_Statements.xls`;
    a.click();
    URL.revokeObjectURL(url);
    out.sections.forEach((s) => record(s.label));
  };

  // ── Payment ───────────────────────────────────────────────────────────────
  const startPayment = async (ids: string[]) => {
    if (!crsId) return;
    setBusy('order');
    try {
      const { order, upi } = await createOrder({ kind: 'statement', month, year, sectionIds: ids });
      setPay({ order, upi });
    } catch (e) {
      void appAlert(e instanceof Error ? e.message : 'Could not raise the payment order.');
    } finally {
      setBusy('');
    }
  };

  const sel = { width: '100%', border: '1px solid var(--border)', borderRadius: 8, padding: '8px 12px', fontSize: 13 } as const;
  const selectedCount = selectedIds.length;
  const working = busy !== '';

  return (
    <div className="page active" id="page-statement">
      <div className="page-header" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', flexWrap: 'wrap', gap: 10 }}>
        <div>
          <div className="page-title">Statement Generation</div>
          <div className="page-sub">
            {crsId ? `CRS ${crsId} — ${shops[crsId - 1]?.name ?? ''} · ${MONTHS[month]} ${year}` : 'Generate official TNCSC monthly statements'}
          </div>
        </div>
        {access && !free ? (
          <div style={{ background: '#FEF3C7', border: '1px solid #FDE68A', color: '#92400E', borderRadius: 8, padding: '8px 14px', fontSize: 12, fontWeight: 700 }}>
            🔒 {formatRupees(access.settings.statementSheetPaise)} per sheet, GST included
          </div>
        ) : null}
        {access && free && access.isAdmin ? (
          <div style={{ background: '#DCFCE7', border: '1px solid #86EFAC', color: '#15803D', borderRadius: 8, padding: '8px 14px', fontSize: 12, fontWeight: 700 }}>
            ✓ Administrator — downloads are free
          </div>
        ) : null}
      </div>

      <div className="card mb-4">
        <div className="card-header">
          <div className="card-title">Select Parameters</div>
        </div>
        <div className="card-body">
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 14, alignItems: 'end', marginBottom: 16 }}>
            <div>
              <label className="form-label">CRS Shop</label>
              <select value={crsVal} onChange={(e) => { setCrsVal(e.target.value); setPreview(null); setSelected({}); }} style={sel}>
                <option value="">Select CRS Shop...</option>
                {shopIds.map((id) => (
                  <option key={id} value={String(id)}>
                    CRS {id} — {shops[id - 1]?.name ?? ''}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label className="form-label">Month</label>
              <select value={String(month)} onChange={(e) => { setMonth(Number(e.target.value)); setPreview(null); }} style={sel}>
                {MONTHS.slice(1).map((m, i) => (
                  <option key={m} value={String(i + 1)}>
                    {m}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label className="form-label">Year</label>
              <select value={String(year)} onChange={(e) => { setYear(Number(e.target.value)); setPreview(null); }} style={sel}>
                {[2025, 2026, 2027].map((y) => (
                  <option key={y} value={String(y)}>
                    {y}
                  </option>
                ))}
              </select>
            </div>
          </div>

          <div style={{ borderTop: '1px dashed var(--border)', paddingTop: 14 }}>
            <div style={{ fontSize: 12, fontWeight: 700, color: 'var(--text)', marginBottom: 10 }}>Source modules</div>
            <div style={{ display: 'flex', gap: 7, flexWrap: 'wrap' }}>
              {!crsId || !avail ? (
                <span style={{ fontSize: 11, color: 'var(--muted)' }}>Select a CRS shop to see which modules hold data.</span>
              ) : (
                MODULES.map((m) => {
                  const has = !!avail[m.key];
                  return (
                    <span
                      key={m.key}
                      style={{
                        fontSize: 10.5,
                        fontWeight: 700,
                        padding: '4px 10px',
                        borderRadius: 20,
                        background: has ? '#DCFCE7' : '#F1F5F9',
                        color: has ? '#15803D' : '#94A3B8',
                        border: `1px solid ${has ? '#86EFAC' : '#E2E8F0'}`,
                      }}
                    >
                      {has ? '●' : '○'} {m.label}
                      {m.key === 'daily' && avail.dailyDays ? ` (${avail.dailyDays}d)` : ''}
                    </span>
                  );
                })
              )}
            </div>
            <div style={{ fontSize: 11, color: 'var(--muted)', marginTop: 9, lineHeight: 1.5 }}>
              Every section below reads live data: <strong>CRS Page 1</strong> → Card Details + Receipt · <strong>Receipt</strong> → Receipt + Gunny Stock ·{' '}
              <strong>Daily Sales</strong> → Daily Entry + Remittance + Inspection · <strong>Page 2 / Free Com / Cost Com / B6 / RBI / COLL</strong> → Monthly Entry
              (falling back to the Daily Entry roll-up) + Inspection · <strong>Gunny</strong> → Gunny Stock · <strong>Remittance / Sale Tax</strong> → Remittance ·{' '}
              <strong>CRS Police</strong> → Monthly Entry Section&nbsp;B.
            </div>
          </div>
        </div>
      </div>

      {openForMonth.length ? (
        <div className="card mb-4">
          <div className="card-header">
            <div className="card-title">Your payment requests for this month</div>
          </div>
          <div style={{ padding: '10px 16px' }}>
            {openForMonth.map((o) => {
              const tone = STATUS_COLOR[o.status];
              return (
                <div key={o.id} style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 10, padding: '8px 0', borderBottom: '1px solid #F1F5F9', flexWrap: 'wrap' }}>
                  <div style={{ fontSize: 12 }}>
                    <strong>{o.orderNo}</strong> — {formatRupees(o.totalPaise)} ·{' '}
                    {o.kind === 'dss' ? `DSS ${o.dayCount} day(s)` : `${o.sheetCount} sheet(s)`}
                    <div style={{ fontSize: 11, color: 'var(--muted)', marginTop: 2 }}>
                      {o.kind === 'statement' ? o.sectionIds.map((id) => labels[id] ?? id).join(' · ') : ''}
                    </div>
                  </div>
                  <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                    <span style={{ background: tone.bg, color: tone.fg, border: `1px solid ${tone.border}`, borderRadius: 20, padding: '3px 10px', fontSize: 10.5, fontWeight: 700 }}>
                      {STATUS_LABEL[o.status]}
                    </span>
                    {o.status === 'pending' ? (
                      <button
                        onClick={() => setPay({ order: o, upi: null })}
                        style={{ background: '#0284C7', border: 'none', color: '#fff', padding: '5px 12px', borderRadius: 6, fontSize: 11, fontWeight: 700, cursor: 'pointer' }}
                      >
                        Enter UTR
                      </button>
                    ) : null}
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      ) : null}

      <div className="card mb-4">
        <div className="card-header">
          <div className="card-title">Statement Sections</div>
          <div style={{ fontSize: 12, color: 'var(--muted)' }}>
            {free ? 'Click a heading to preview · Select checkboxes to export' : 'Select the sheets you need, then pay to unlock them'}
          </div>
        </div>
        <div className="card-body">
          {!crsId ? (
            <div style={{ textAlign: 'center', padding: 24, color: 'var(--muted)', fontSize: 13 }}>Select a CRS shop above to list its statement sections.</div>
          ) : !access ? (
            <div style={{ textAlign: 'center', padding: 24, color: 'var(--muted)', fontSize: 13 }}>Loading…</div>
          ) : (
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4,1fr)', gap: 10 }}>
              {sections.map((s) => {
                const isSel = !!selected[s.id];
                const isLocked = locked(s.id);
                return (
                  <div
                    key={s.id}
                    onClick={() => setSelected((p) => ({ ...p, [s.id]: !p[s.id] }))}
                    style={{
                      border: '2px solid',
                      borderColor: isSel ? s.color : 'var(--border)',
                      background: isSel ? `${s.color}18` : '#fff',
                      borderRadius: 12,
                      padding: 14,
                      cursor: 'pointer',
                      transition: '.15s',
                      position: 'relative',
                    }}
                  >
                    <div
                      style={{
                        position: 'absolute',
                        top: 10,
                        right: 10,
                        width: 20,
                        height: 20,
                        border: '2px solid',
                        borderColor: isSel ? s.color : '#CBD5E1',
                        background: isSel ? s.color : '#fff',
                        color: isSel ? '#fff' : 'transparent',
                        borderRadius: 4,
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'center',
                        fontSize: 11,
                        fontWeight: 800,
                      }}
                    >
                      ✓
                    </div>
                    <div style={{ fontSize: 24, marginBottom: 6 }}>{s.icon}</div>
                    <div style={{ fontWeight: 800, fontSize: 13, color: s.color, marginBottom: 3 }}>{s.label}</div>
                    <div style={{ fontSize: 10, color: 'var(--muted)', lineHeight: 1.4, marginBottom: 6 }}>{s.desc}</div>
                    {s.copies > 1 ? <div style={{ fontSize: 10, color: '#D97706', fontWeight: 700 }}>✖{s.copies} copies</div> : null}
                    {!free ? (
                      <div style={{ fontSize: 10, fontWeight: 700, color: isLocked ? '#B45309' : '#15803D', marginTop: 4 }}>
                        {isLocked ? `🔒 ${formatRupees(access.settings.statementSheetPaise)}` : '✓ Paid'}
                      </div>
                    ) : null}
                    <button
                      onClick={(e) => {
                        e.stopPropagation();
                        void doPreview(s);
                      }}
                      disabled={working}
                      style={{
                        marginTop: 8,
                        width: '100%',
                        background: working ? '#94A3B8' : s.color,
                        color: '#fff',
                        border: 'none',
                        padding: 5,
                        borderRadius: 6,
                        fontSize: 11,
                        fontWeight: 700,
                        cursor: working ? 'default' : 'pointer',
                      }}
                    >
                      {busy === `preview:${s.id}` ? 'Loading…' : isLocked ? '🔒 Pay & Preview' : '👁 Preview'}
                    </button>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </div>

      {selectedCount > 0 ? (
        <div
          style={{
            background: 'linear-gradient(135deg,#0369A1,#0EA5E9)',
            borderRadius: 12,
            padding: '14px 20px',
            marginBottom: 14,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            flexWrap: 'wrap',
            gap: 10,
          }}
        >
          <div>
            <div style={{ color: '#fff', fontWeight: 700, fontSize: 14 }}>{selectedCount} section(s) selected</div>
            <div style={{ color: 'rgba(255,255,255,.7)', fontSize: 11, marginTop: 2 }}>
              for CRS {crsId ? `${crsId} — ${shops[crsId - 1]?.name ?? ''}` : '—'}
              {quote && unpaidSelected.length ? ` · ${unpaidSelected.length} unpaid — ${formatRupees(quote.totalPaise)}` : ''}
            </div>
          </div>
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
            <button onClick={() => setSelected(Object.fromEntries(sections.map((s) => [s.id, true])))} style={{ background: 'rgba(255,255,255,.15)', border: '1px solid rgba(255,255,255,.3)', color: '#fff', padding: '7px 14px', borderRadius: 7, fontSize: 12, cursor: 'pointer', fontWeight: 600 }}>
              ☑ Select All
            </button>
            <button onClick={() => setSelected({})} style={{ background: 'rgba(255,255,255,.15)', border: '1px solid rgba(255,255,255,.3)', color: '#fff', padding: '7px 14px', borderRadius: 7, fontSize: 12, cursor: 'pointer' }}>
              ✕ Clear
            </button>
            {quote && unpaidSelected.length ? (
              <button
                onClick={() => void startPayment(unpaidSelected)}
                disabled={working}
                style={{ background: '#F59E0B', border: 'none', color: '#fff', padding: '7px 14px', borderRadius: 7, fontSize: 12, cursor: working ? 'default' : 'pointer', fontWeight: 700 }}
              >
                {busy === 'order' ? 'Please wait…' : `🔒 Pay ${formatRupees(quote.totalPaise)}`}
              </button>
            ) : (
              <>
                <button onClick={() => void excelSelected()} disabled={working} style={{ background: working ? '#94A3B8' : '#16A34A', border: 'none', color: '#fff', padding: '7px 14px', borderRadius: 7, fontSize: 12, cursor: working ? 'default' : 'pointer', fontWeight: 700 }}>
                  {busy === 'excel' ? 'Building…' : '📊 Excel'}
                </button>
                <button onClick={() => void printSelected()} disabled={working} style={{ background: working ? '#94A3B8' : '#DC2626', border: 'none', color: '#fff', padding: '7px 14px', borderRadius: 7, fontSize: 12, cursor: working ? 'default' : 'pointer', fontWeight: 700 }}>
                  {busy === 'print' ? 'Building…' : '📄 PDF'}
                </button>
                <button onClick={() => void printSelected()} disabled={working} style={{ background: working ? '#94A3B8' : '#D97706', border: 'none', color: '#fff', padding: '7px 14px', borderRadius: 7, fontSize: 12, cursor: working ? 'default' : 'pointer', fontWeight: 700 }}>
                  🖨️ Print
                </button>
              </>
            )}
          </div>
        </div>
      ) : null}

      {preview ? (
        <div>
          <div className="card">
            <div className="card-header" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 10 }}>
              <div>
                <div className="card-title">{preview.section.label}</div>
                <div style={{ fontSize: 11, color: 'var(--muted)', marginTop: 2 }}>{preview.sub}</div>
              </div>
              <div style={{ display: 'flex', gap: 8 }}>
                <button onClick={() => setPreview(null)} style={{ background: '#fff', border: '1px solid var(--border)', padding: '6px 14px', borderRadius: 7, fontSize: 12, cursor: 'pointer' }}>
                  ✕ Close Preview
                </button>
                <button
                  onClick={() => {
                    let html = '';
                    for (let i = 0; i < preview.section.copies; i++) html += preview.html;
                    openPrintWindow(`${preview.section.label} - CRS ${crsId} ${MONTHS[month]} ${year}`, '', html);
                  }}
                  style={{ background: '#0284C7', color: '#fff', border: 'none', padding: '6px 14px', borderRadius: 7, fontSize: 12, cursor: 'pointer', fontWeight: 600 }}
                >
                  🖨️ Print This
                </button>
              </div>
            </div>
            <div className="card-body" style={{ padding: 20 }}>
              <div style={{ fontFamily: "'Courier New',monospace", fontSize: 12, lineHeight: 1.6, overflowX: 'auto' }} dangerouslySetInnerHTML={{ __html: preview.html }} />
            </div>
          </div>
        </div>
      ) : null}

      <div className="card" style={{ marginTop: 14 }}>
        <div className="card-header">
          <div className="card-title">Previously Generated</div>
        </div>
        <div style={{ padding: '12px 16px' }}>
          {history.length === 0 ? (
            <div style={{ color: 'var(--muted)', fontSize: 12, textAlign: 'center', padding: 20 }}>No statements generated yet</div>
          ) : (
            history.slice(0, 10).map((h, i) => (
              <div key={i} style={{ display: 'flex', justifyContent: 'space-between', padding: '7px 0', borderBottom: '1px solid #F1F5F9', fontSize: 12 }}>
                <span>
                  <strong>{h.label}</strong> — CRS {h.crsId} · {h.period}
                </span>
                <span style={{ color: 'var(--muted)', fontSize: 11 }}>{h.at}</span>
              </div>
            ))
          )}
        </div>
      </div>

      {pay ? (
        <PaymentDialog
          order={pay.order}
          upi={pay.upi}
          labels={labels}
          onClose={() => {
            setPay(null);
            void refreshAccess();
          }}
          onSubmitted={(o) => {
            setOrders((list) => [o, ...list.filter((x) => x.id !== o.id)]);
          }}
        />
      ) : null}

      {status === 'error' ? (
        <div style={{ background: '#FEE2E2', color: '#B91C1C', border: '1px solid #FECACA', borderRadius: 8, padding: '10px 14px', fontSize: 12, marginTop: 12 }}>
          The data layer could not reach the server — statements may be out of date.
        </div>
      ) : null}
    </div>
  );
}
