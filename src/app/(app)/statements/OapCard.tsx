'use client';

/**
 * The OAP / APS / ANP statement on the Statements page (office, 2026-10-01) —
 * for the shop and month chosen there, beside the statutory sections but NOT
 * one of them: no checkbox, not in select-all / Excel / PDF / Print of the
 * sections, no payment. It is the same separate sheet as Reports → 🧓 OAP /
 * APS / ANP (engine/oapStatement.ts — one rule, one layout), previewed here
 * and printed on its own A4 landscape page (lib/printHtmlFrame.ts).
 *
 * Figures are the month as Monthly Sales publishes it, from the stores on
 * screen, so a Daily or Monthly Entry save shows at once.
 */
import { useMemo, useState } from 'react';
import { useStore } from '@/lib/dataStore';
import { commodityListsFor, useCommodityMaster, type CommodityRow } from '@/lib/masters';
import { appAlert } from '@/components/dialog';
import { printHtmlDocument } from '@/lib/printHtmlFrame';
import { OAP_SHEET_CSS, oapFamily, oapPeriod, oapPrintDocument, oapSheetFor, oapSheetHtml } from '@/lib/engine/oapStatement';

const MONTHS = ['', 'January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];

export default function OapCard({ crsId, month, year }: { crsId: number; month: number; year: number }) {
  const entryStore = useStore<Record<string, unknown>>('entryStore') ?? {};
  const inspectionStore = useStore<Record<string, unknown>>('inspectionStore') ?? {};
  const meManualStore = useStore<Record<string, unknown>>('meManualStore') ?? {};
  const receiptStore = useStore<unknown[]>('receiptStore') ?? [];
  const master = useCommodityMaster();
  const [open, setOpen] = useState(false);

  const sheet = useMemo(() => {
    const lists = commodityListsFor(master as CommodityRow[] | null, crsId);
    const ids = oapFamily(commodityListsFor(master as CommodityRow[] | null, null).a).map((c) => c.id);
    return oapSheetFor({ entryStore, inspectionStore, meManualStore, receiptStore }, crsId, month, year, ids, lists);
  }, [entryStore, inspectionStore, meManualStore, receiptStore, master, crsId, month, year]);

  const period = oapPeriod(month, year);
  const title = sheet ? sheet.rows.map((r) => r.label).join(' & ') : '';
  const html = sheet ? oapSheetHtml(sheet, title, period) : '';

  const print = async () => {
    if (!sheet) return;
    try {
      await printHtmlDocument(oapPrintDocument([{ html }], `OAP-APS-ANP CRS ${crsId} ${period}`));
    } catch (e) {
      void appAlert(e instanceof Error ? e.message : 'Could not print.');
    }
  };

  const btn = (bg: string, fg = '#fff', bd = 'none'): React.CSSProperties => ({ background: bg, color: fg, border: bd, padding: '6px 14px', borderRadius: 7, fontSize: 12, cursor: 'pointer', fontWeight: 600 });

  return (
    <div className="card mb-4" data-oap-card>
      <style>{OAP_SHEET_CSS + '.oap-card-preview{background:#fff;border:1px solid var(--border);border-radius:10px;padding:22px 26px;overflow-x:auto}'}</style>
      <div className="card-header" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 10 }}>
        <div>
          <div className="card-title">🧓 OAP / APS / ANP Statement</div>
          <div style={{ fontSize: 11, color: 'var(--muted)', marginTop: 2 }} data-oap-summary>
            {sheet
              ? `CRS ${crsId} · ${MONTHS[month]} ${year}: ${sheet.rows.map((r) => `${r.label} O.B ${r.open} · C.B ${r.close}`).join(' | ')}`
              : `No OAP / APS / ANP entry for CRS ${crsId} in ${MONTHS[month]} ${year}.`}
            {' '}· A separate sheet — not one of the statements above, no payment.
          </div>
        </div>
        <div style={{ display: 'flex', gap: 8 }}>
          <button type="button" disabled={!sheet} onClick={() => setOpen((o) => !o)} style={{ ...btn('#fff', '#0369A1', '1px solid #93C5FD'), opacity: sheet ? 1 : 0.5, cursor: sheet ? 'pointer' : 'default' }}>
            {open ? '✕ Close Preview' : '👁 Preview'}
          </button>
          <button type="button" disabled={!sheet} onClick={() => void print()} style={{ ...btn(sheet ? '#0284C7' : '#94A3B8'), cursor: sheet ? 'pointer' : 'default' }}>
            🖨️ Print / PDF
          </button>
        </div>
      </div>
      {open && sheet ? (
        <div className="card-body" style={{ padding: 16 }}>
          <div className="oap-card-preview" dangerouslySetInnerHTML={{ __html: html }} />
        </div>
      ) : null}
    </div>
  );
}
