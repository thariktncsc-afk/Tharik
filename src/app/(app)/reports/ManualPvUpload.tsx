'use client';

/**
 * Manual 3-Month PV — the quarter's past months from the office's statement
 * PDFs, the current month straight from this system (office, 2026-09-22).
 *
 * SINCE 2026-10-06, EACH MONTH FROM ITS OWN BEST SOURCE: a month this shop
 * has figures for IN THE SYSTEM (Monthly / Daily Sales, Receipts, Gunny,
 * Police — `systemQuarterMonth`, worked out again on every saved change) is
 * fetched automatically — "✓ Data available — automatically fetched", no
 * upload asked for. Only a month with no system figures asks for its PDF
 * ("⚠ Manual upload required", Browse PDF). The system always comes first:
 * an official PDF may still be uploaded beside it and is kept as the source
 * document, but an old PDF can never override a later correction. (Before,
 * every month before the current one HAD to be uploaded, so September —
 * fully keyed in the system — still showed Browse PDF in October.)
 *
 *   A past month      → upload its PDFs. CRS PAGE2 is the one sheet it needs;
 *                       GUNNY and CRS POLICE are read when uploaded. Several
 *                       files at once, any file names: each page is recognised
 *                       by what is on it, and must be this shop and this month
 *                       (pvPdfParse.ts). The month is complete the moment its
 *                       PAGE2 has been read — no monthly record is waited for.
 *   The current month → nothing to upload: it is worked out from the saved
 *                       data the moment the PV is generated (pvQuarter.ts).
 *   A later month     → not yet — it has not happened.
 *
 * Generate stays off until every past month has its PAGE2 and the current
 * month has loaded. It then chains the months (July → August → September):
 * a month that does not open where the last one closed stops the PV with the
 * difference, commodity by commodity, rather than printing it.
 *
 * THE UPLOADS ARE SAVED, per shop and month (office, 2026-10-06;
 * /api/pv-uploads — files in Storage, details in crs_state, no migration). They used to live only in this browser tab, so a
 * new tab, another computer or signing in again showed every month as never
 * uploaded. Now:
 *   - opening the screen asks the server what is saved and reads those PDFs —
 *     it never uploads anything by itself;
 *   - a PDF is read here first (a wrong shop or month is refused before it is
 *     sent), then saved; the card, the counter and the success tick follow
 *     the server's answer, never what was sent, and a failed save says so and
 *     leaves the month as it was;
 *   - Replace PDF makes the new file the month's only one; Add PDF keeps the
 *     others (a GUNNY next to its PAGE2);
 *   - Generate asks the server again and reads any file that changed since,
 *     so the PV is always built from the PDFs saved NOW.
 */
import { useEffect, useMemo, useRef, useState } from 'react';
import { monthName, type PvPeriod, type YearMonth } from '@/lib/engine/pvPeriod';
import { PdfReadError, readMonthPages, type PdfMonth } from '@/lib/engine/pvPdfParse';
import { chainQuarter, pdfQuarterMonth, type QuarterMonth, type QuarterResult } from '@/lib/engine/pvQuarter';
import { fetchSavedMonths, removeSavedMonth, savedFilePages, savePdf, type PdfPage } from '@/lib/pvUploads/client';
import type { SavedPvMonth, UploadMode } from '@/lib/pvUploads/core';
import { appAlert, appConfirm } from '@/components/dialog';
import { saveSuccess } from '@/components/SaveSuccess';
import { dmyTime } from '@/lib/dateFormat';

/**
 * One past month. `saved` is what the server holds; `pages` are those files
 * read, and `pagesOf` the file ids they were read from — so a file replaced
 * elsewhere is noticed and read again. `notices` are per-file messages that do
 * not decide the month (a file that is not a PDF, a duplicate).
 */
type Slot = {
  saved: SavedPvMonth | null;
  pages: PdfPage[];
  pagesOf: string;
  data: PdfMonth | null;
  error: string;
  pending: string;
  notices: string[];
  loading: boolean;
};
const EMPTY_SLOT: Slot = { saved: null, pages: [], pagesOf: '', data: null, error: '', pending: '', notices: [], loading: false };

const keyOf = (m: YearMonth) => `${m.year}-${m.month}`;
const idsOf = (s: SavedPvMonth | null | undefined) => (s?.files ?? []).map((f) => f.id).join(',');

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
  const scopeId = `${crsId}|${period.months.map(keyOf).join('|')}`;

  /** Read a month from the pages it holds. */
  const settle = (m: YearMonth, s: Slot): Slot => {
    if (!s.pages.length) return { ...s, data: null, error: '', pending: '' };
    try {
      return { ...s, data: readMonthPages(s.pages, { crsId, month: m.month, year: m.year }), error: '', pending: '' };
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      // "still needs CRS PAGE2" is a month part-way through, not a fault.
      if (e instanceof PdfReadError && / still needs /.test(msg)) return { ...s, data: null, error: '', pending: msg };
      return { ...s, data: null, error: msg, pending: '' };
    }
  };

  const ym = (m: YearMonth) => m.year * 12 + m.month;
  const isFuture = (m: YearMonth) => ym(m) > today.year * 12 + today.month;
  const isCurrent = (m: YearMonth) => ym(m) === today.year * 12 + today.month;

  /**
   * Every month of the quarter AS THIS SYSTEM HOLDS IT NOW (office,
   * 2026-10-06): worked out from the saved Daily / Monthly Sales, Receipts,
   * Inspection and Gunny (pvQuarter.systemQuarterMonth) — again whenever any
   * of them changes, so a figure an administrator corrects and saves is the
   * figure the PV takes. `has` = the shop really has figures for that month.
   */
  const systemStates = useMemo(() => {
    const out: Record<string, { data: QuarterMonth | null; error: string; has: boolean }> = {};
    const nonZero = (o: unknown) =>
      !!o && typeof o === 'object' && Object.values(o as Record<string, unknown>).some((r) =>
        !!r && typeof r === 'object' && ['open', 'opening', 'receipt', 'sales', 'issues', 'closing', 'total', 'shortage', 'excess'].some((f) => Number((r as Record<string, unknown>)[f]) !== 0 && Number.isFinite(Number((r as Record<string, unknown>)[f]))),
      );
    for (const m of period.months) {
      if (isFuture(m)) continue;
      try {
        const data = systemMonth(m);
        out[keyOf(m)] = { data, error: '', has: nonZero(data.rows) || nonZero(data.gunny) || nonZero(data.police) };
      } catch (e) {
        out[keyOf(m)] = { data: null, error: e instanceof Error ? e.message : String(e), has: false };
      }
    }
    return out;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [period, systemMonth, today.year, today.month]);

  /**
   * Where a month's figures come from, for each month on its own:
   *   the system's saved data, if the shop has any for that month (and the
   *   current month, which can only come from here) → 'system';
   *   otherwise the office's PDF → 'pdf' (saved upload, else Browse PDF);
   *   a month not yet happened → 'future'.
   * The system's data always comes first, so an old PDF can never override
   * a later correction.
   */
  const kindOf = (m: YearMonth): 'pdf' | 'system' | 'future' =>
    isFuture(m) ? 'future' : isCurrent(m) || systemStates[keyOf(m)]?.has ? 'system' : 'pdf';
  const pdfMonths = period.months.filter((m) => kindOf(m) === 'pdf');
  const systemMonths = period.months.filter((m) => kindOf(m) === 'system');
  const future = period.months.filter((m) => kindOf(m) === 'future');
  /** Months a PDF may be kept for: every month that has happened (an official PDF beside system data, too). */
  const docMonths = period.months.filter((m) => !isFuture(m));

  const [slots, setSlots] = useState<Record<string, Slot>>({});
  const [busy, setBusy] = useState<string | null>(null);
  const [checking, setChecking] = useState(true);
  const [loadError, setLoadError] = useState('');
  const [problems, setProblems] = useState<string[]>([]);
  const [generating, setGenerating] = useState(false);

  // Where an answer must land — or nowhere, if the shop or quarter changed
  // while it was on its way.
  const scopeRef = useRef(scopeId);
  scopeRef.current = scopeId;

  /** A saved month read into pages (its files fetched from the server). */
  const readSaved = async (m: YearMonth, saved: SavedPvMonth | null, notices: string[] = []): Promise<Slot> => {
    if (!saved?.files.length) return { ...EMPTY_SLOT, notices };
    const pages: PdfPage[] = [];
    for (const f of saved.files) pages.push(...(await savedFilePages(f)));
    return settle(m, { ...EMPTY_SLOT, saved, pages, pagesOf: idsOf(saved), notices });
  };

  /**
   * Ask the server what is saved for these months and read what changed.
   * Returns the slots as they now are (also set into state).
   */
  const refresh = async (only?: YearMonth[], notices: Record<string, string[]> = {}): Promise<Record<string, Slot> | null> => {
    const startedIn = scopeId;
    const months = only ?? docMonths;
    if (!months.length) return {};
    setSlots((p) => {
      const n = { ...p };
      for (const m of months) n[keyOf(m)] = { ...(p[keyOf(m)] ?? EMPTY_SLOT), loading: true };
      return n;
    });
    try {
      const saved = await fetchSavedMonths(crsId, months);
      const out: Record<string, Slot> = {};
      for (const m of months) {
        const k = keyOf(m);
        const sv = saved[k] ?? null;
        const cur = slotsRef.current[k];
        try {
          out[k] =
            cur && cur.pagesOf === idsOf(sv) && !notices[k]
              ? { ...cur, saved: sv, loading: false }
              : { ...(await readSaved(m, sv, notices[k] ?? [])), loading: false };
        } catch (e) {
          out[k] = { ...EMPTY_SLOT, saved: sv, error: `The saved PDF could not be read: ${e instanceof Error ? e.message : String(e)}` };
        }
      }
      if (scopeRef.current !== startedIn) return null;
      setLoadError('');
      setSlots((p) => ({ ...p, ...out }));
      return { ...slotsRef.current, ...out };
    } catch (e) {
      if (scopeRef.current !== startedIn) return null;
      setLoadError(e instanceof Error ? e.message : String(e));
      setSlots((p) => {
        const n = { ...p };
        for (const m of months) n[keyOf(m)] = { ...(p[keyOf(m)] ?? EMPTY_SLOT), loading: false };
        return n;
      });
      return null;
    }
  };
  const slotsRef = useRef(slots);
  slotsRef.current = slots;

  // On opening, and on a new shop or quarter: what the SERVER holds for it —
  // never the last shop's, never anything uploaded by itself.
  useEffect(() => {
    setSlots({});
    slotsRef.current = {};
    setProblems([]);
    setLoadError('');
    setChecking(true);
    void refresh().finally(() => setChecking(false));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [scopeId]);


  /**
   * Save the picked PDFs, EACH ON ITS OWN (office, 2026-10-06). The original
   * file is what is kept; reading its figures is a separate step and never
   * stops a save: a sheet the reader cannot fully read is saved all the same,
   * and the card says "Data extraction needs review".
   *
   * Refused before saving, and only these: not a PDF, a file that will not
   * open, or a statement for ANOTHER shop or month (it must never land under
   * this one). One file failing never undoes another; Replace removes the
   * month's older files only once the first new file is saved.
   */
  const addFiles = async (m: YearMonth, list: File[], mode: UploadMode) => {
    if (!list.length) return;
    const k = keyOf(m);
    const label = `${monthName(m.month)} ${m.year}`;
    const startedIn = scopeId;
    const cur = slotsRef.current[k] ?? EMPTY_SLOT;
    setBusy(k);
    setProblems([]);
    /** Said on the card, not a failure (a file already saved). */
    const info: string[] = [];
    /** Files refused before saving, with why. */
    const refused: string[] = [];
    const ok: File[] = [];
    try {
      const have = new Set(mode === 'add' ? (cur.saved?.files ?? []).map((x) => `${x.name}|${x.size}`) : []);
      try {
        const { pdfPages } = await import('@/lib/engine/pvPdfLoad');
        for (const file of list) {
          if (have.has(`${file.name}|${file.size}`)) {
            info.push(`${file.name} is already saved for ${label} — not uploaded again.`);
            continue;
          }
          if (!/\.pdf$/i.test(file.name)) {
            refused.push(`${file.name} is not a PDF. Please upload the statement as PDF.`);
            continue;
          }
          let pages: PdfPage[];
          try {
            pages = await pdfPages(file);
          } catch {
            refused.push(`${file.name} could not be opened as a PDF (the file is damaged or not a PDF).`);
            continue;
          }
          // Another shop's or another month's statement is the one thing a
          // reading can refuse; any other reading problem is for the card.
          try {
            readMonthPages(pages, { crsId, month: m.month, year: m.year });
          } catch (e) {
            if (e instanceof PdfReadError && e.code) {
              refused.push(e.message);
              continue;
            }
          }
          ok.push(file);
          have.add(`${file.name}|${file.size}`);
        }
      } catch (e) {
        refused.push(`The PDF reader could not start (${e instanceof Error ? e.message : String(e)}). Reload the page and try again.`);
      }
      if (scopeRef.current !== startedIn) return;
      const sent: string[] = [];
      const failed: string[] = [];
      let first = true;
      for (const file of ok) {
        try {
          await savePdf(crsId, m.year, m.month, file, first ? mode : 'add');
          sent.push(file.name);
          first = false;
        } catch (e) {
          failed.push(`${file.name}: ${e instanceof Error ? e.message : String(e)}`);
        }
      }
      if (scopeRef.current !== startedIn) return;
      // Whatever happened, the card now shows what the server holds.
      const notes = [...info, ...refused.map((r) => `Not saved — ${r}`), ...failed.map((r) => `Not saved — ${r}`)];
      const after = await refresh([m], { [k]: notes });
      const saved = after?.[k]?.saved;
      if (sent.length && saved && sent.every((n) => saved.files.some((x) => x.name === n))) {
        saveSuccess({
          title: `${label} PDF Saved`,
          detail: `✓ ${label}: ${sent.join(', ')} saved`,
          key: `pv-upload:${crsId}:${k}:${idsOf(saved)}`,
        });
      }
      if (refused.length || failed.length) {
        await appAlert({
          title: sent.length ? 'Some PDFs were not saved' : 'PDF not saved',
          tone: 'danger',
          message: [...refused, ...failed].join('\n\n') + (sent.length ? `\n\nSaved: ${sent.join(', ')}.` : ''),
        });
      }
    } finally {
      setBusy(null);
    }
  };

  const removeAll = async (m: YearMonth) => {
    const k = keyOf(m);
    const label = `${monthName(m.month)} ${m.year}`;
    const s = slotsRef.current[k];
    if (!s?.saved?.files.length) return;
    const yes = await appConfirm({
      title: `Remove ${label}'s PDFs?`,
      message: `${s.saved.files.map((f) => f.name).join(', ')} will be removed from CRS ${crsId}'s saved uploads. ${label} will need uploading again before the PV can be generated.`,
      confirmLabel: 'Remove',
      tone: 'danger',
      defaultCancel: true,
    });
    if (!yes) return;
    setBusy(k);
    try {
      await removeSavedMonth(crsId, m.year, m.month);
    } catch (e) {
      await appAlert({ title: 'Not removed', tone: 'danger', message: e instanceof Error ? e.message : String(e) });
    } finally {
      await refresh([m]);
      setBusy(null);
    }
  };

  /** A month is ready when its figures can be had: from the system, else from a saved PDF with its PAGE2. */
  const monthReady = (m: YearMonth) =>
    kindOf(m) === 'system' ? !!systemStates[keyOf(m)]?.data : kindOf(m) === 'pdf' ? !!(slots[keyOf(m)]?.saved && slots[keyOf(m)]?.data) : false;
  const readyCount = period.months.filter(monthReady).length;
  const missing = period.months.filter((m) => !isFuture(m) && !monthReady(m));
  const allReady = !checking && !(loadError && pdfMonths.length) && !future.length && readyCount === period.months.length;

  /** Build the PV from the PDFs saved NOW: the server is asked again first. */
  const generate = async () => {
    setGenerating(true);
    try {
      const fresh = await refresh();
      if (!fresh && pdfMonths.length) return;
      const notReady = pdfMonths.filter((m) => !(fresh?.[keyOf(m)]?.saved && fresh?.[keyOf(m)]?.data));
      if (notReady.length) {
        setProblems([`Not generated — ${notReady.map((m) => `${monthName(m.month)} ${m.year}`).join(', ')} ${notReady.length === 1 ? 'has' : 'have'} no saved CRS PAGE2 now.`]);
        return;
      }
      // Each month from its own source; a system month is worked out NOW, from the stores as saved.
      const months: QuarterMonth[] = period.months.map((m) =>
        kindOf(m) === 'system' ? systemMonth(m) : pdfQuarterMonth(fresh![keyOf(m)].data!, hasPolice),
      );
      const q = chainQuarter(crsId, months);
      if (!q.ok) {
        setProblems(q.problems);
        return;
      }
      setProblems([]);
      onGenerate(q);
    } finally {
      setGenerating(false);
    }
  };

  const card: React.CSSProperties = { border: '1px solid var(--border)', borderRadius: 12, background: '#fff', padding: 14, display: 'flex', flexDirection: 'column', gap: 8, minHeight: 160 };
  const btn: React.CSSProperties = { display: 'block', textAlign: 'center', borderRadius: 7, padding: '8px 0', fontSize: 12, fontWeight: 700 };
  const line = (ok: boolean): React.CSSProperties => ({ color: ok ? '#15803D' : 'var(--muted)', fontWeight: ok ? 700 : 400 });

  const picker = (m: YearMonth, mode: UploadMode, text: string, style: React.CSSProperties, disabled: boolean) => (
    <label style={{ flex: 1, minWidth: 90, margin: 0 }} data-pv-upload={`${keyOf(m)}:${mode}`}>
      <span style={{ ...btn, ...style, cursor: disabled ? 'default' : 'pointer', opacity: disabled ? 0.7 : 1 }}>{text}</span>
      <input
        type="file"
        accept=".pdf,application/pdf"
        multiple
        disabled={disabled}
        style={{ display: 'none' }}
        onChange={(e) => {
          // Copied out first: clearing the input (so the same file can be picked again) empties its list.
          const picked = Array.from(e.target.files ?? []);
          e.target.value = '';
          void addFiles(m, picked, mode);
        }}
      />
    </label>
  );

  return (
    <div className="card mb-4">
      <div className="card-header">
        <div className="card-title">📊 Manual 3-Month PV Generator</div>
        <div style={{ fontSize: 11, color: 'var(--muted)', marginTop: 2 }}>
          {pdfMonths.length ? `Upload the statement PDFs for ${pdfMonths.map((m) => monthName(m.month)).join(' and ')}` : 'No uploads needed'}
          {systemMonths.length ? ` · ${systemMonths.map((m) => monthName(m.month)).join(' and ')} from the system's saved data` : ''} · CRS {crsId} — {crsName}
        </div>
      </div>
      <div className="card-body">
        {loadError ? (
          <div role="alert" style={{ marginBottom: 12, border: '1px solid #FCA5A5', background: '#FEF2F2', color: '#991B1B', borderRadius: 10, padding: '10px 14px', fontSize: 12, lineHeight: 1.5 }}>
            <b>The saved PDFs could not be read:</b> {loadError}{' '}
            <button type="button" onClick={() => { setChecking(true); void refresh().finally(() => setChecking(false)); }} style={{ marginLeft: 6, background: '#fff', border: '1px solid #FCA5A5', color: '#B91C1C', borderRadius: 6, padding: '2px 10px', fontWeight: 700, cursor: 'pointer' }}>
              Try again
            </button>
          </div>
        ) : null}
        <div style={{ display: 'grid', gap: 14, gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))' }}>
          {period.months.map((m) => {
            const k = keyOf(m);
            const kind = kindOf(m);
            if (kind === 'system') {
              const st = systemStates[k];
              const ok = !!st?.data;
              const s = slots[k] ?? EMPTY_SLOT;
              const official = s.saved?.files.length ? s.saved : null;
              const isBusy = busy === k || checking || s.loading;
              return (
                <div key={k} data-pv-month={k} data-pv-state="system" style={{ ...card, borderColor: ok ? '#86EFAC' : '#FCA5A5', background: ok ? '#F0FDF4' : '#FEF2F2' }}>
                  <div style={{ fontWeight: 800, fontSize: 13, color: ok ? '#15803D' : '#B91C1C', textTransform: 'uppercase', letterSpacing: '.03em' }}>
                    {ok ? '✓' : '🗂'} {monthName(m.month)} {m.year}
                  </div>
                  {ok ? (
                    <>
                      <div style={{ fontSize: 12, fontWeight: 700, color: '#15803D' }} data-pv-source="system">
                        {st.has ? '✓ Data available — automatically fetched' : `✓ ${monthName(m.month)} is this month — read from the system`}
                      </div>
                      <div style={{ fontSize: 11, color: 'var(--muted)', lineHeight: 1.5 }}>
                        Fetched from the system: {Object.keys(st.data!.rows).length} commodities · Gunny{st.data!.police ? ' · Police' : ''} — from the saved Monthly / Daily Sales, Receipts and Gunny, and follows every change saved there.
                      </div>
                    </>
                  ) : (
                    <div style={{ fontSize: 11, color: '#B91C1C', lineHeight: 1.5 }}>Could not load {monthName(m.month)}: {st?.error}</div>
                  )}
                  {official ? (
                    <div style={{ fontSize: 11, lineHeight: 1.5 }} data-pv-files>
                      {official.files.map((f) => <div key={f.id}>📎 {f.name}</div>)}
                      <div style={{ color: 'var(--muted)' }}>Official PDF kept as the source document — the PV's figures come from the system's saved data.</div>
                    </div>
                  ) : null}
                  {s.notices.map((n) => (
                    <div key={n} style={{ fontSize: 11, color: /already saved/.test(n) ? 'var(--muted)' : '#B91C1C', lineHeight: 1.5 }}>{n}</div>
                  ))}
                  <div style={{ display: 'flex', gap: 8, marginTop: 'auto', flexWrap: 'wrap' }}>
                    {picker(m, 'replace', busy === k ? 'Saving…' : official ? 'Replace PDF' : 'Upload PDF', { background: '#fff', color: 'var(--navy, #0369A1)', border: '1px solid var(--navy, #0369A1)' }, isBusy)}
                    {official ? (
                      <button type="button" disabled={isBusy} onClick={() => void removeAll(m)} style={{ ...btn, flex: 1, minWidth: 90, background: '#FEE2E2', color: '#B91C1C', border: '1px solid #FCA5A5', cursor: isBusy ? 'default' : 'pointer' }}>
                        Remove
                      </button>
                    ) : null}
                  </div>
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
            const d = s.data;
            const saved = s.saved?.files.length ? s.saved : null;
            const waiting = checking || s.loading;
            // A saved PDF is never shown red: a reading problem is amber ("needs review").
            const review = d?.review ?? [];
            const tone = waiting ? 'idle' : saved && d && !review.length ? 'ok' : saved ? 'pending' : s.error ? 'err' : 'idle';
            const border = { ok: '#86EFAC', err: '#FCA5A5', pending: '#FDE68A', idle: 'var(--border)' }[tone];
            const bg = { ok: '#F0FDF4', err: '#FEF2F2', pending: '#FFFBEB', idle: '#fff' }[tone];
            const isBusy = busy === k || waiting;
            const last = saved?.files[saved.files.length - 1];
            return (
              <div key={k} data-pv-month={k} data-pv-state={waiting ? 'checking' : saved ? (d ? 'saved' : 'incomplete') : 'empty'} style={{ ...card, borderColor: border, background: bg }}>
                <div style={{ fontWeight: 800, fontSize: 13, color: saved && d ? '#15803D' : !saved && s.error ? '#B91C1C' : 'var(--text)', textTransform: 'uppercase', letterSpacing: '.03em' }}>
                  {saved && d ? '✓' : '📄'} {monthName(m.month)} {m.year}
                </div>
                {waiting ? (
                  <div style={{ fontSize: 12, color: 'var(--muted)' }}>Checking saved PDF…</div>
                ) : saved ? (
                  <>
                    {/* Storage first: the PDF is saved, whatever its reading says. */}
                    <div style={{ fontSize: 12, fontWeight: 700, color: '#15803D' }} data-pv-stored>
                      ✓ {monthName(m.month)} PDF Saved
                    </div>
                    <div style={{ fontSize: 11, wordBreak: 'break-all' }} data-pv-files>
                      {saved.files.map((f) => <div key={f.id}>📎 {f.name}</div>)}
                    </div>
                    {last ? (
                      <div style={{ fontSize: 10.5, color: 'var(--muted)' }}>
                        Saved {dmyTime(last.uploadedAt)}{last.uploadedBy ? ` by ${last.uploadedBy}` : ''}
                      </div>
                    ) : null}
                  </>
                ) : (
                  <>
                    <div style={{ fontSize: 12, fontWeight: 700, color: '#B45309' }} data-pv-source="manual">⚠ Manual upload required</div>
                    <div style={{ fontSize: 11, color: 'var(--muted)', lineHeight: 1.5 }}>
                      CRS {crsId} has no {monthName(m.month)} {m.year} figures in the system — upload the office's statement PDF.
                    </div>
                    <div style={{ fontSize: 11, color: 'var(--muted)', lineHeight: 1.5 }}>
                      CRS PAGE2 (required) · GUNNY{hasPolice ? ' · CRS POLICE' : ''} when you have them — several PDFs at once is fine
                    </div>
                  </>
                )}
                {!waiting && saved && d ? (
                  <div style={{ fontSize: 12, lineHeight: 1.6 }}>
                    <div style={line(true)}>✓ CRS PAGE2 · {Object.keys(d.rows).length} commodities</div>
                    <div style={line(!!d.gunny)}>{d.gunny ? '✓ GUNNY' : '– No GUNNY (optional)'}</div>
                    {hasPolice ? (
                      <div style={line(!!d.police)}>{d.police ? '✓ CRS POLICE' : '– No CRS POLICE (optional)'}</div>
                    ) : d.police ? (
                      <div style={line(false)}>– CRS POLICE not used: CRS {crsId} has no police ration</div>
                    ) : null}
                    {d.notes.length ? <div style={{ color: '#15803D', fontWeight: 600 }}>Note: {d.notes.join('; ')}</div> : null}
                    {review.length ? (
                      <div style={{ fontSize: 11, color: '#92400E', lineHeight: 1.5, marginTop: 4 }} data-pv-review>
                        <b>⚠ Data extraction needs review</b> — read, with these left out:
                        {review.map((r) => <div key={r}>• {r}</div>)}
                      </div>
                    ) : null}
                  </div>
                ) : !waiting && saved && s.error ? (
                  <div style={{ fontSize: 11, color: '#92400E', lineHeight: 1.5 }} data-pv-review>
                    <b>⚠ Data extraction needs review</b> — the PDF is saved, but its figures could not be read: {s.error}
                  </div>
                ) : !waiting && s.error ? (
                  <div style={{ fontSize: 11, color: '#B91C1C', lineHeight: 1.5 }}>{s.error}</div>
                ) : !waiting && s.pending ? (
                  <div style={{ fontSize: 11, color: '#92400E', lineHeight: 1.5 }}>{s.pending}</div>
                ) : null}
                {s.notices.map((n) => (
                  <div key={n} style={{ fontSize: 11, color: /already saved/.test(n) ? 'var(--muted)' : '#B91C1C', lineHeight: 1.5 }}>{n}</div>
                ))}
                <div style={{ display: 'flex', gap: 8, marginTop: 'auto', flexWrap: 'wrap' }}>
                  {saved ? (
                    <>
                      {picker(m, 'replace', busy === k ? 'Saving…' : 'Replace PDF', { background: isBusy ? '#94A3B8' : 'var(--navy, #0369A1)', color: '#fff' }, isBusy)}
                      {picker(m, 'add', 'Add PDF', { background: '#fff', color: 'var(--navy, #0369A1)', border: '1px solid var(--navy, #0369A1)' }, isBusy)}
                      <button type="button" disabled={isBusy} onClick={() => void removeAll(m)} style={{ ...btn, flex: 1, minWidth: 90, background: '#FEE2E2', color: '#B91C1C', border: '1px solid #FCA5A5', cursor: isBusy ? 'default' : 'pointer' }}>
                        Remove
                      </button>
                    </>
                  ) : (
                    picker(m, 'replace', busy === k ? 'Saving…' : waiting ? 'Checking…' : 'Browse PDF', { background: isBusy ? '#94A3B8' : 'var(--navy, #0369A1)', color: '#fff' }, isBusy)
                  )}
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
          <div>
            <div data-pv-count style={{ fontSize: 13, fontWeight: 700, color: allReady ? '#15803D' : 'var(--muted)' }}>
              {checking && pdfMonths.length
                ? 'Checking saved PDFs…'
                : `${readyCount} / ${period.months.length} month${period.months.length === 1 ? '' : 's'} ready`}
              {systemMonths.length ? ` · ${systemMonths.map((m) => monthName(m.month)).join(', ')} from the system` : ''}
            </div>
            {!checking && missing.length ? (
              <div data-pv-missing style={{ fontSize: 11.5, color: '#B45309', marginTop: 2 }}>
                Missing: {missing.map((m) => `${monthName(m.month)} ${m.year}`).join(', ')}
              </div>
            ) : null}
          </div>
          <button
            type="button"
            disabled={!allReady || generating}
            onClick={() => void generate()}
            style={{ marginLeft: 'auto', background: allReady ? 'linear-gradient(135deg,#0284C7,#0EA5E9)' : '#94A3B8', color: '#fff', border: 'none', padding: '10px 22px', borderRadius: 9, fontWeight: 700, fontSize: 13, cursor: allReady && !generating ? 'pointer' : 'not-allowed' }}
          >
            {generating ? 'Reading saved PDFs…' : 'Generate 3-Month PV'}
          </button>
        </div>
      </div>
    </div>
  );
}
