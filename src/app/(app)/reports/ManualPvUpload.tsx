'use client';

/**
 * Manual 3-Month PV — the quarter's past months from the office's statement
 * PDFs, the current month straight from this system (office, 2026-09-22).
 *
 *   A past month      → upload its PDFs: CRS PAGE2 and GUNNY, plus CRS POLICE
 *                       for a shop with police ration. Several files at once;
 *                       each page is recognised by its own title, and must be
 *                       this shop and this month (pvPdfParse.ts).
 *   The current month → nothing to upload: it is worked out from the saved
 *                       data the moment the PV is generated (pvQuarter.ts).
 *   A later month     → not yet — it has not happened.
 *
 * Generate stays off until every past month has its sheets and the current
 * month has loaded. It then chains the months (July → August → September):
 * a month that does not open where the last one closed stops the PV with the
 * difference, commodity by commodity, rather than printing it.
 *
 * Uploaded PDFs live only in this screen's state. Nothing is saved.
 */
import { useMemo, useRef, useState } from 'react';
import { monthName, type PvPeriod, type YearMonth } from '@/lib/engine/pvPeriod';
import { PdfReadError, readMonthPages, type PdfMonth, type TextItem } from '@/lib/engine/pvPdfParse';
import { chainQuarter, pdfQuarterMonth, type QuarterMonth, type QuarterResult } from '@/lib/engine/pvQuarter';

type Page = { file: string; items: TextItem[] };
type Slot = { files: string[]; pages: Page[]; data: PdfMonth | null; error: string; pending: string; noPolice: boolean };
const EMPTY_SLOT: Slot = { files: [], pages: [], data: null, error: '', pending: '', noPolice: false };

const keyOf = (m: YearMonth) => `${m.year}-${m.month}`;

export default function ManualPvUpload({
  period,
  crsId,
  crsName,
  hasPolice,
  today,
  systemMonth,
  onGenerate,
}: {
  period: PvPeriod;
  crsId: number;
  crsName: string;
  /** The shop's police ration, from the CRS master. */
  hasPolice: boolean;
  today: YearMonth;
  /** The current month, worked out now from the stores (pvQuarter.systemQuarterMonth). */
  systemMonth: (m: YearMonth) => QuarterMonth;
  onGenerate: (q: Extract<QuarterResult, { ok: true }>) => void;
}) {
  const [slots, setSlots] = useState<Record<string, Slot>>({});
  const [busy, setBusy] = useState<string | null>(null);
  const [problems, setProblems] = useState<string[]>([]);

  // A new shop or period means the old files no longer belong to these slots.
  const scopeId = `${crsId}|${period.months.map(keyOf).join('|')}`;
  const [seen, setSeen] = useState(scopeId);
  // Where a PDF still being read must land — or nowhere, if the shop or
  // period changed while it was read.
  const scopeRef = useRef(scopeId);
  scopeRef.current = scopeId;
  if (seen !== scopeId) {
    setSeen(scopeId);
    setSlots({});
    setProblems([]);
  }

  const kindOf = (m: YearMonth): 'pdf' | 'system' | 'future' => {
    const a = m.year * 12 + m.month;
    const t = today.year * 12 + today.month;
    return a < t ? 'pdf' : a === t ? 'system' : 'future';
  };

  // The current month, recomputed whenever the stores change underneath.
  const current = period.months.find((m) => kindOf(m) === 'system');
  const systemState = useMemo((): { data: QuarterMonth | null; error: string } => {
    if (!current) return { data: null, error: '' };
    try {
      return { data: systemMonth(current), error: '' };
    } catch (e) {
      return { data: null, error: e instanceof Error ? e.message : String(e) };
    }
  }, [current, systemMonth]);

  /** Re-read a slot from every page it now holds. */
  const settle = (m: YearMonth, s: Slot): Slot => {
    if (!s.pages.length) return { ...s, data: null, error: '', pending: '' };
    try {
      const data = readMonthPages(s.pages, { crsId, month: m.month, year: m.year, needsPolice: hasPolice && !s.noPolice });
      return { ...s, data, error: '', pending: '' };
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      // "still needs GUNNY" is where a clerk is part-way through, not a fault.
      if (e instanceof PdfReadError && / still needs /.test(msg)) return { ...s, data: null, error: '', pending: msg };
      return { ...s, data: null, error: msg, pending: '' };
    }
  };

  const addFiles = async (m: YearMonth, list: File[]) => {
    if (!list.length) return;
    const k = keyOf(m);
    const startedIn = scopeId;
    setBusy(k);
    setProblems([]);
    try {
      const { pdfPages } = await import('@/lib/engine/pvPdfLoad');
      const pages: Page[] = [];
      const names: string[] = [];
      for (const f of list) {
        if (!/\.pdf$/i.test(f.name)) throw new PdfReadError(`${f.name}: upload the statement as PDF.`);
        pages.push(...(await pdfPages(f)));
        names.push(f.name);
      }
      if (scopeRef.current !== startedIn) return; // another shop or period now
      setSlots((p) => {
        const cur = p[k] ?? EMPTY_SLOT;
        return { ...p, [k]: settle(m, { ...cur, files: [...cur.files, ...names], pages: [...cur.pages, ...pages] }) };
      });
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      if (scopeRef.current !== startedIn) return;
      setSlots((p) => ({ ...p, [k]: { ...(p[k] ?? EMPTY_SLOT), error: /password|Invalid PDF/i.test(msg) ? 'This file could not be opened as a PDF.' : msg } }));
    } finally {
      setBusy(null);
    }
  };

  const setNoPolice = (m: YearMonth, v: boolean) => {
    const k = keyOf(m);
    setSlots((p) => ({ ...p, [k]: settle(m, { ...(p[k] ?? EMPTY_SLOT), noPolice: v }) }));
  };

  const pdfMonths = period.months.filter((m) => kindOf(m) === 'pdf');
  const future = period.months.filter((m) => kindOf(m) === 'future');
  const pdfReady = pdfMonths.filter((m) => slots[keyOf(m)]?.data).length;
  const systemReady = !current || !!systemState.data;
  const allReady = !future.length && pdfReady === pdfMonths.length && systemReady;

  const generate = () => {
    const months: QuarterMonth[] = period.months.map((m) =>
      kindOf(m) === 'system' ? systemMonth(m) : pdfQuarterMonth(slots[keyOf(m)].data!),
    );
    const q = chainQuarter(crsId, months);
    if (!q.ok) {
      setProblems(q.problems);
      return;
    }
    setProblems([]);
    onGenerate(q);
  };

  const card: React.CSSProperties = { border: '1px solid var(--border)', borderRadius: 12, background: '#fff', padding: 14, display: 'flex', flexDirection: 'column', gap: 8, minHeight: 160 };
  const btn: React.CSSProperties = { display: 'block', textAlign: 'center', borderRadius: 7, padding: '8px 0', fontSize: 12, fontWeight: 700 };

  return (
    <div className="card mb-4">
      <div className="card-header">
        <div className="card-title">📊 Manual 3-Month PV Generator</div>
        <div style={{ fontSize: 11, color: 'var(--muted)', marginTop: 2 }}>
          {pdfMonths.length ? `Upload the statement PDFs for ${pdfMonths.map((m) => monthName(m.month)).join(' and ')}` : 'No uploads needed'}
          {current ? ` · ${monthName(current.month)} is read from the system` : ''} · CRS {crsId} — {crsName}
        </div>
      </div>
      <div className="card-body">
        <div style={{ display: 'grid', gap: 14, gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))' }}>
          {period.months.map((m) => {
            const k = keyOf(m);
            const kind = kindOf(m);
            if (kind === 'system') {
              const ok = !!systemState.data;
              return (
                <div key={k} style={{ ...card, borderColor: ok ? '#86EFAC' : '#FCA5A5', background: ok ? '#F0FDF4' : '#FEF2F2' }}>
                  <div style={{ fontWeight: 800, fontSize: 13, color: ok ? '#15803D' : '#B91C1C', textTransform: 'uppercase', letterSpacing: '.03em' }}>🗂 {monthName(m.month)} {m.year}</div>
                  <div style={{ fontSize: 12, fontWeight: 700, color: ok ? '#15803D' : '#B91C1C' }}>Automatic – Current System Data</div>
                  {ok ? (
                    <div style={{ fontSize: 12, color: '#15803D' }}>
                      ✓ Current {monthName(m.month)} data loaded automatically
                      <div style={{ fontSize: 11, color: 'var(--muted)', marginTop: 4 }}>
                        {Object.keys(systemState.data!.rows).length} commodities · Gunny{systemState.data!.police ? ' · Police' : ''} · updates as {monthName(m.month)} is keyed
                      </div>
                    </div>
                  ) : (
                    <div style={{ fontSize: 11, color: '#B91C1C', lineHeight: 1.5 }}>Could not load {monthName(m.month)}: {systemState.error}</div>
                  )}
                </div>
              );
            }
            if (kind === 'future') {
              return (
                <div key={k} style={{ ...card, background: '#F8FAFC' }}>
                  <div style={{ fontWeight: 800, fontSize: 13, color: 'var(--muted)', textTransform: 'uppercase' }}>📄 {monthName(m.month)} {m.year}</div>
                  <div style={{ fontSize: 12, color: 'var(--muted)' }}>Not yet — this month has not happened. A PV for this quarter can be made once it has.</div>
                </div>
              );
            }
            const s = slots[k] ?? EMPTY_SLOT;
            const ok = !!s.data;
            const tone = ok ? 'ok' : s.error ? 'err' : s.pending ? 'pending' : 'idle';
            const border = { ok: '#86EFAC', err: '#FCA5A5', pending: '#FDE68A', idle: 'var(--border)' }[tone];
            const bg = { ok: '#F0FDF4', err: '#FEF2F2', pending: '#FFFBEB', idle: '#fff' }[tone];
            return (
              <div key={k} style={{ ...card, borderColor: border, background: bg }}>
                <div style={{ fontWeight: 800, fontSize: 13, color: ok ? '#15803D' : s.error ? '#B91C1C' : 'var(--text)', textTransform: 'uppercase', letterSpacing: '.03em' }}>📄 {monthName(m.month)} {m.year}</div>
                <div style={{ fontSize: 12, fontWeight: 700 }}>Upload PDF</div>
                <div style={{ fontSize: 11, color: 'var(--muted)', lineHeight: 1.5 }}>
                  CRS PAGE2 + GUNNY{hasPolice ? ' + CRS POLICE' : ''} — several PDFs at once is fine
                </div>
                {s.files.length ? <div style={{ fontSize: 11, wordBreak: 'break-all' }}>{s.files.map((f) => <div key={f}>• {f}</div>)}</div> : null}
                {ok ? (
                  <div style={{ fontSize: 12, color: '#15803D', fontWeight: 700 }}>
                    ✅ {Object.keys(s.data!.rows).length} commodities · Gunny{s.data!.police ? ' · Police' : ''}
                    {s.data!.notes.length ? <div style={{ fontWeight: 600, marginTop: 3 }}>Note: {s.data!.notes.join('; ')}</div> : null}
                  </div>
                ) : s.error ? (
                  <div style={{ fontSize: 11, color: '#B91C1C', lineHeight: 1.5 }}>{s.error}</div>
                ) : s.pending ? (
                  <div style={{ fontSize: 11, color: '#92400E', lineHeight: 1.5 }}>{s.pending}</div>
                ) : null}
                {hasPolice ? (
                  <label style={{ display: 'flex', gap: 6, alignItems: 'center', fontSize: 11, color: 'var(--muted)', textTransform: 'none', letterSpacing: 0, margin: 0, cursor: 'pointer' }}>
                    <input type="checkbox" style={{ width: 'auto', margin: 0, flex: 'none' }} checked={s.noPolice} onChange={(e) => setNoPolice(m, e.target.checked)} />
                    No police ration this month
                  </label>
                ) : null}
                <div style={{ display: 'flex', gap: 8, marginTop: 'auto', flexWrap: 'wrap' }}>
                  <label style={{ flex: 1, minWidth: 90 }}>
                    <span style={{ ...btn, background: busy === k ? '#94A3B8' : 'var(--navy, #0369A1)', color: '#fff', cursor: busy === k ? 'default' : 'pointer' }}>
                      {busy === k ? 'Reading…' : s.files.length ? 'Add PDF' : 'Browse PDF'}
                    </span>
                    <input type="file" accept=".pdf,application/pdf" multiple disabled={busy === k} style={{ display: 'none' }} onChange={(e) => {
                      // Copied out first: clearing the input (so the same file can be picked again) empties its list.
                      const picked = Array.from(e.target.files ?? []);
                      e.target.value = '';
                      void addFiles(m, picked);
                    }} />
                  </label>
                  {s.files.length ? (
                    <button type="button" onClick={() => setSlots((p) => ({ ...p, [k]: EMPTY_SLOT }))} style={{ ...btn, flex: 1, minWidth: 90, background: '#FEE2E2', color: '#B91C1C', border: '1px solid #FCA5A5', cursor: 'pointer' }}>
                      Remove all
                    </button>
                  ) : null}
                </div>
              </div>
            );
          })}
        </div>

        {problems.length ? (
          <div style={{ marginTop: 14, border: '1px solid #FCA5A5', background: '#FEF2F2', borderRadius: 10, padding: '10px 14px' }}>
            <div style={{ fontWeight: 800, fontSize: 13, color: '#B91C1C', marginBottom: 6 }}>The PV was not generated — these figures do not carry over:</div>
            <ul style={{ margin: 0, paddingLeft: 18, fontSize: 12, color: '#7F1D1D', lineHeight: 1.6 }}>
              {problems.map((p) => <li key={p}>{p}</li>)}
            </ul>
          </div>
        ) : null}

        <div style={{ display: 'flex', alignItems: 'center', gap: 14, marginTop: 16, flexWrap: 'wrap' }}>
          <div style={{ fontSize: 13, fontWeight: 700, color: allReady ? '#15803D' : 'var(--muted)' }}>
            {pdfReady} / {pdfMonths.length} month{pdfMonths.length === 1 ? '' : 's'} uploaded{current ? ` · ${monthName(current.month)} ${systemReady ? 'loaded' : 'not loaded'}` : ''}
          </div>
          <button
            type="button"
            disabled={!allReady}
            onClick={generate}
            style={{ marginLeft: 'auto', background: allReady ? 'linear-gradient(135deg,#0284C7,#0EA5E9)' : '#94A3B8', color: '#fff', border: 'none', padding: '10px 22px', borderRadius: 9, fontWeight: 700, fontSize: 13, cursor: allReady ? 'pointer' : 'not-allowed' }}
          >
            Generate 3-Month PV
          </button>
        </div>
      </div>
    </div>
  );
}
