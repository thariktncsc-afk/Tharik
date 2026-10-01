'use client';

/**
 * Reports → OAP / APS / ANP (office, 2026-10-01). One A4-landscape sheet per
 * shop that has an entry for the chosen commodity and month, in the office's
 * "OAP & ANP" layout — engine/oapStatement.ts holds the rule and the markup.
 * Kept apart from the statutory statements: no section, no paywall, no golden.
 *
 * Figures come from the month as Monthly Sales publishes it, worked out from
 * the stores on every render, so a Daily or Monthly Entry save shows at once.
 */
import { useMemo, useState } from 'react';
import { useStore } from '@/lib/dataStore';
import { commodityListsFor, useCommodityMaster, useShops, type CommodityRow } from '@/lib/masters';
import { appAlert } from '@/components/dialog';
import { printHtmlDocument } from '@/lib/printHtmlFrame';
import { OAP_SHEET_CSS, oapFamily, oapLabel, oapPeriod, oapPrintDocument, oapSheetFor, oapSheetHtml } from '@/lib/engine/oapStatement';

const MONTHS = ['', 'January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];

export default function OapStatement({ isAdmin, userCrs }: { isAdmin: boolean; userCrs: number | null }) {
  const shops = useShops();
  const entryStore = useStore<Record<string, unknown>>('entryStore') ?? {};
  const inspectionStore = useStore<Record<string, unknown>>('inspectionStore') ?? {};
  const meManualStore = useStore<Record<string, unknown>>('meManualStore') ?? {};
  const receiptStore = useStore<unknown[]>('receiptStore') ?? [];
  const master = useCommodityMaster();

  // Months: this one and the twelve before it; last month first selected (the month just closed).
  const now = new Date();
  const monthOpts = useMemo(() => {
    const out: { value: string; label: string }[] = [];
    for (let i = 0; i <= 12; i++) {
      const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
      out.push({ value: `${d.getFullYear()}-${d.getMonth() + 1}`, label: `${MONTHS[d.getMonth() + 1]} ${d.getFullYear()}` });
    }
    return out;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  const [monthVal, setMonthVal] = useState(monthOpts[1]?.value ?? monthOpts[0].value);
  const [year, month] = monthVal.split('-').map(Number);

  // The family, from the Commodity Master (every shop's list combined).
  const family = useMemo(() => oapFamily(commodityListsFor(master, null).a), [master]);
  const [commodity, setCommodity] = useState<string>('ALL');
  const ids = commodity === 'ALL' ? family.map((c) => c.id) : [commodity];
  const title = commodity === 'ALL' ? null : oapLabel(commodity);

  // Shops: an administrator chooses any set (all by default); a shop user has their own.
  const allIds = shops.map((s) => s.id);
  const [picked, setPicked] = useState<number[]>(allIds);
  const shopIds = isAdmin ? picked : userCrs ? [userCrs] : [];

  const sheets = useMemo(() => {
    const stores = { entryStore, inspectionStore, meManualStore, receiptStore };
    return shopIds
      .slice()
      .sort((a, b) => a - b)
      .map((crsId) => oapSheetFor(stores, crsId, month, year, ids, commodityListsFor(master as CommodityRow[] | null, crsId)))
      .filter((s): s is NonNullable<typeof s> => !!s);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [entryStore, inspectionStore, meManualStore, receiptStore, master, month, year, ids.join(','), shopIds.join(',')]);

  const period = oapPeriod(month, year);
  // The sheet's title: the commodity chosen; for the whole family, the ones on that shop's sheet ("OAP & APS").
  const titleFor = (s: { rows: { label: string }[] }) => title ?? s.rows.map((r) => r.label).join(' & ');
  const htmlFor = (s: (typeof sheets)[number]) => oapSheetHtml(s, titleFor(s), period);
  const skipped = shopIds.length - sheets.length;

  const print = async () => {
    if (!sheets.length) return;
    try {
      await printHtmlDocument(oapPrintDocument(sheets.map((s) => ({ html: htmlFor(s) })), `OAP-APS-ANP ${period}`));
    } catch (e) {
      void appAlert(e instanceof Error ? e.message : 'Could not print.');
    }
  };

  const sel = { width: '100%', border: '1px solid var(--border)', borderRadius: 8, padding: '8px 12px', fontSize: 13, outline: 'none' } as const;

  return (
    <div className="oap-report">
      <style>{OAP_SHEET_CSS + '.oap-preview{background:#fff;border:1px solid var(--border);border-radius:10px;padding:22px 26px;margin-bottom:14px;max-width:1123px;overflow-x:auto}'}</style>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(200px,1fr))', gap: 12, alignItems: 'end', marginBottom: 12 }}>
        <div>
          <label className="form-label">MONTH</label>
          <select value={monthVal} onChange={(e) => setMonthVal(e.target.value)} style={sel} aria-label="Month">
            {monthOpts.map((o) => (
              <option key={o.value} value={o.value}>{o.label}</option>
            ))}
          </select>
        </div>
        <div>
          <label className="form-label">COMMODITY</label>
          <select value={commodity} onChange={(e) => setCommodity(e.target.value)} style={sel} aria-label="Commodity">
            <option value="ALL">All — {family.map((c) => oapLabel(c.id)).join(' / ')}</option>
            {family.map((c) => (
              <option key={c.id} value={c.id}>{oapLabel(c.id)}</option>
            ))}
          </select>
        </div>
        <div>
          <button className="btn btn-primary" onClick={() => void print()} disabled={!sheets.length} style={{ width: '100%', fontSize: 13, padding: '9px 0' }}>
            🖨️ Print / PDF — {sheets.length} page{sheets.length === 1 ? '' : 's'}
          </button>
        </div>
      </div>

      {isAdmin ? (
        <div style={{ marginBottom: 12 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 6, flexWrap: 'wrap' }}>
            <span className="form-label" style={{ margin: 0 }}>CRS SHOPS</span>
            <button type="button" className="btn btn-outline btn-sm" onClick={() => setPicked(allIds)}>All</button>
            <button type="button" className="btn btn-outline btn-sm" onClick={() => setPicked([])}>None</button>
            <span style={{ fontSize: 11, color: 'var(--muted)' }}>{picked.length} selected</span>
          </div>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
            {shops.map((s) => (
              <label key={s.id} style={{ display: 'inline-flex', alignItems: 'center', gap: 4, fontSize: 12, border: '1px solid var(--border)', borderRadius: 6, padding: '3px 8px', cursor: 'pointer', background: picked.includes(s.id) ? '#EFF6FF' : '#fff' }}>
                <input type="checkbox" checked={picked.includes(s.id)} onChange={() => setPicked((p) => (p.includes(s.id) ? p.filter((x) => x !== s.id) : [...p, s.id]))} style={{ width: 'auto' }} aria-label={`CRS ${s.id}`} />
                CRS {s.id}
              </label>
            ))}
          </div>
        </div>
      ) : null}

      <div style={{ fontSize: 12, color: 'var(--muted)', marginBottom: 12 }} data-oap-summary>
        {sheets.length
          ? `${sheets.length} shop${sheets.length === 1 ? '' : 's'} with ${title ?? 'an OAP / APS / ANP'} entry in ${MONTHS[month]} ${year}: ${sheets.map((s) => `CRS ${s.crsId}`).join(', ')}.`
          : `No ${title ?? 'OAP / APS / ANP'} entry in ${MONTHS[month]} ${year} for the shops chosen.`}
        {skipped > 0 && sheets.length ? ` ${skipped} other shop${skipped === 1 ? '' : 's'} chosen had no entry and ${skipped === 1 ? 'is' : 'are'} left out.` : ''}
        {' '}One sheet per shop · A4 landscape · use “Save as PDF” in the print dialog for a PDF.
      </div>

      {sheets.map((s) => (
        <div key={s.crsId} className="oap-preview" title={`CRS ${s.crsId} — ${shops[s.crsId - 1]?.name ?? ''}`} dangerouslySetInnerHTML={{ __html: htmlFor(s) }} />
      ))}
    </div>
  );
}
