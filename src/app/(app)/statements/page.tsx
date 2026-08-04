'use client';

/**
 * Statement Generation — React port of the screen (pageStatement.ts,
 * 11-statement-core.js UI logic) on top of the legacy statement engine
 * wrapped in src/generated/statements-legacy.js.
 *
 * The builders themselves are the REAL legacy source behind a context shim
 * (see tools/build-stmt-module.mjs) — their output is verified byte-for-byte
 * against golden/statements/ by tools/verify-statements.mjs, because these
 * are statutory documents. This file only rebuilds the screen around them:
 * section tiles, preview, select/export bar, print and Excel flows.
 */
import { useMemo, useState } from 'react';
import { appAlert } from '@/components/dialog';
import { createStatementEngine } from '@/generated/statements-legacy';
import { useAuth } from '@/lib/authClient';
import { crsData, useDataStatus, useStore, useUsers } from '@/lib/dataStore';
import { useShops } from '@/lib/masters';
import { rebuildMonthlyFromDaily } from '@/lib/engine/monthlyRollup';

type ShopRec = { name: string; code: string; taluk: string; district: string; cards: number; active: boolean };
type Section = { id: string; label: string; icon: string; desc: string; copies: number; color: string; availableFor: string };
type StmtData = {
  crsId: number;
  mo: string;
  yr: number;
  avail: Record<string, boolean | number>;
};
type Engine = {
  getData: (crsId: number, month: number, year: number) => StmtData;
  buildSection: (id: string, d: StmtData) => string;
  sectionsFor: (crsId: number) => Section[];
  printCss: string;
};

const MONTHS = ['', 'January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];

export default function StatementsPage() {
  const { user } = useAuth();
  const { status } = useDataStatus();
  const users = useUsers();
  // Dropdowns and headings use the full 30-shop list; the `__shops` master
  // (nine demo rows from the original port) only lends its extra fields to
  // the engine's CRS_LIST, matching the environment the goldens verify.
  const shopExtras = useStore<ShopRec[]>('__shops') ?? [];
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

  const crsId = crsVal ? Number(crsVal) : null;

  // The engine reads the SAME store objects the data layer holds, so a
  // republished month lands exactly where the legacy app put it.
  const engine: Engine | null = useMemo(() => {
    if (status !== 'ready') return null;
    const stores = {
      entryStore: crsData.get('entryStore') ?? {},
      inspectionStore: crsData.get('inspectionStore') ?? {},
      monthlyStore: crsData.get('monthlyStore') ?? {},
      meManualStore: crsData.get('meManualStore') ?? {},
      meSourceStore: crsData.get('meSourceStore') ?? {},
      meRemitStore: crsData.get('meRemitStore') ?? {},
      meGunnyStore: crsData.get('meGunnyStore') ?? {},
      meCardStore: crsData.get('meCardStore') ?? {},
      salesCloseStore: crsData.get('salesCloseStore') ?? {},
      receiptStore: crsData.get('receiptStore') ?? [],
      meAllotStore: crsData.get('meAllotStore') ?? {},
      meCardConfirmed: crsData.get('meCardConfirmed') ?? {},
      meAdvanceStore: crsData.get('meAdvanceStore') ?? {},
    } as Record<string, Record<string, unknown> | unknown[]>;
    const CRS_LIST = shops.map((s) => ({ ...(shopExtras[s.id - 1] ?? {}), id: s.id, name: s.name }));
    return createStatementEngine({
      stores,
      users,
      CRS_LIST,
      CRS_MASTER: crsData.get('__crsMaster') ?? [],
      TN_GOVT_HOLIDAYS: crsData.get('__holidays'),
      APP_CONFIG: crsData.get('__config') ?? {},
      CRS_ACCOUNTS: crsData.get('__accounts') ?? {},
      currentUser: user,
      // Same behaviour as the legacy stmtGetData: refresh the month from the
      // daily sheets + manual values before the sections read it.
      rebuildMonthlyFromDaily: (cid: number, m: number, y: number) => {
        const manual = (stores.meManualStore as Record<string, unknown>)[`${cid}_${m}_${y}`];
        const next = rebuildMonthlyFromDaily(cid, m, y, stores.entryStore as never, stores.inspectionStore as never, manual as never);
        (stores.monthlyStore as Record<string, unknown>)[`${cid}_${m}_${y}`] = next.merged;
        (stores.meSourceStore as Record<string, unknown>)[`${cid}_${m}_${y}`] = next.source;
      },
    }) as Engine;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [status, shopExtras, shops, users, user, crsId, month, year]);

  const sections = engine && crsId ? engine.sectionsFor(crsId) : [];
  const visibleSections = sections.filter((s) => s.availableFor === 'all' || (s.availableFor === 'admin' && isAdmin));

  const avail = useMemo(() => {
    if (!engine || !crsId) return null;
    try {
      return engine.getData(crsId, month, year).avail;
    } catch {
      return null;
    }
  }, [engine, crsId, month, year]);

  const record = (section: Section) =>
    setHistory((h) => [{ at: new Date().toLocaleString('en-IN'), label: section.label, crsId: crsId!, period: `${MONTHS[month]} ${year}` }, ...h].slice(0, 50));

  const doPreview = (section: Section) => {
    if (!engine || !crsId) {
      void appAlert('Please select a CRS shop first.');
      return;
    }
    const d = engine.getData(crsId, month, year);
    const html = engine.buildSection(section.id, d);
    setPreview({
      section,
      html: `<style>${engine.printCss}</style>` + html,
      sub: `CRS ${crsId} — ${d.mo} ${d.yr}${section.copies > 1 ? ` — ×${section.copies} copies` : ''}`,
    });
    record(section);
  };

  const openPrintWindow = (title: string, html: string) => {
    const win = window.open('', '_blank', 'width=900,height=700');
    if (!win) return;
    win.document.write(`<html><head><title>${title}</title><style>${engine!.printCss}</style></head><body>${html}</body></html>`);
    win.document.close();
    win.focus();
    setTimeout(() => win.print(), 600);
  };

  const printSelected = () => {
    if (!engine || !crsId) {
      void appAlert('Please select a CRS shop.');
      return;
    }
    const ids = Object.keys(selected).filter((id) => selected[id]);
    if (!ids.length) {
      void appAlert('Please select at least one section.');
      return;
    }
    const d = engine.getData(crsId, month, year);
    let html = '';
    for (const id of ids) {
      const sec = sections.find((s) => s.id === id);
      const secHtml = engine.buildSection(id, d);
      for (let i = 0; i < (sec?.copies ?? 1); i++) html += secHtml;
    }
    openPrintWindow(`TNCSC Statements - CRS ${crsId} ${MONTHS[month]} ${year}`, html);
  };

  const excelSelected = () => {
    if (!engine || !crsId) {
      void appAlert('Please select a CRS shop.');
      return;
    }
    const ids = Object.keys(selected).filter((id) => selected[id]);
    if (!ids.length) {
      void appAlert('Please select at least one section.');
      return;
    }
    const d = engine.getData(crsId, month, year);
    let html = '<html><head><meta charset="UTF-8"/></head><body>';
    for (const id of ids) {
      const sec = sections.find((s) => s.id === id);
      html += `<h2>${sec?.label ?? id}</h2>` + engine.buildSection(id, d) + '<br><br>';
    }
    html += '</body></html>';
    const blob = new Blob([html], { type: 'application/vnd.ms-excel' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `TNCSC_CRS${crsId}_${MONTHS[month]}_${year}_Statements.xls`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const selectedCount = Object.values(selected).filter(Boolean).length;
  const sel = { width: '100%', border: '1px solid var(--border)', borderRadius: 8, padding: '8px 12px', fontSize: 13 } as const;

  const MODULES: { key: string; label: string }[] = [
    { key: 'monthly', label: 'Monthly Entry' },
    { key: 'daily', label: 'Daily Entry' },
    { key: 'receipt', label: 'Receipt' },
    { key: 'inspection', label: 'Inspection' },
    { key: 'gunny', label: 'Gunny Stock' },
    { key: 'cards', label: 'Card Details' },
    { key: 'remittance', label: 'Remittance' },
  ];

  return (
    <div className="page active" id="page-statement">
      <div className="page-header" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', flexWrap: 'wrap', gap: 10 }}>
        <div>
          <div className="page-title">Statement Generation</div>
          <div className="page-sub">
            {crsId ? `CRS ${crsId} — ${shops[crsId - 1]?.name ?? ''} · ${MONTHS[month]} ${year}` : 'Generate official TNCSC monthly statements'}
          </div>
        </div>
      </div>

      <div className="card mb-4">
        <div className="card-header">
          <div className="card-title">Select Parameters</div>
        </div>
        <div className="card-body">
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 14, alignItems: 'end', marginBottom: 16 }}>
            <div>
              <label className="form-label">CRS Shop</label>
              <select value={crsVal} onChange={(e) => { setCrsVal(e.target.value); setPreview(null); }} style={sel}>
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

      <div className="card mb-4">
        <div className="card-header">
          <div className="card-title">Statement Sections</div>
          <div style={{ fontSize: 12, color: 'var(--muted)' }}>Click a heading to preview · Select checkboxes to export</div>
        </div>
        <div className="card-body">
          {!crsId ? (
            <div style={{ textAlign: 'center', padding: 24, color: 'var(--muted)', fontSize: 13 }}>Select a CRS shop above to list its statement sections.</div>
          ) : (
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4,1fr)', gap: 10 }}>
              {visibleSections.map((s) => {
                const isSel = !!selected[s.id];
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
                    <button
                      onClick={(e) => {
                        e.stopPropagation();
                        doPreview(s);
                      }}
                      style={{ marginTop: 8, width: '100%', background: s.color, color: '#fff', border: 'none', padding: 5, borderRadius: 6, fontSize: 11, fontWeight: 700, cursor: 'pointer' }}
                    >
                      👁 Preview
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
            </div>
          </div>
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
            <button onClick={() => setSelected(Object.fromEntries(visibleSections.map((s) => [s.id, true])))} style={{ background: 'rgba(255,255,255,.15)', border: '1px solid rgba(255,255,255,.3)', color: '#fff', padding: '7px 14px', borderRadius: 7, fontSize: 12, cursor: 'pointer', fontWeight: 600 }}>
              ☑ Select All
            </button>
            <button onClick={() => setSelected({})} style={{ background: 'rgba(255,255,255,.15)', border: '1px solid rgba(255,255,255,.3)', color: '#fff', padding: '7px 14px', borderRadius: 7, fontSize: 12, cursor: 'pointer' }}>
              ✕ Clear
            </button>
            <button onClick={excelSelected} style={{ background: '#16A34A', border: 'none', color: '#fff', padding: '7px 14px', borderRadius: 7, fontSize: 12, cursor: 'pointer', fontWeight: 700 }}>
              📊 Excel
            </button>
            <button onClick={printSelected} style={{ background: '#DC2626', border: 'none', color: '#fff', padding: '7px 14px', borderRadius: 7, fontSize: 12, cursor: 'pointer', fontWeight: 700 }}>
              📄 PDF
            </button>
            <button onClick={printSelected} style={{ background: '#D97706', border: 'none', color: '#fff', padding: '7px 14px', borderRadius: 7, fontSize: 12, cursor: 'pointer', fontWeight: 700 }}>
              🖨️ Print
            </button>
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
                    const inner = preview.html;
                    for (let i = 0; i < preview.section.copies; i++) html += inner;
                    openPrintWindow(`${preview.section.label} - CRS ${crsId} ${MONTHS[month]} ${year}`, html);
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
    </div>
  );
}
