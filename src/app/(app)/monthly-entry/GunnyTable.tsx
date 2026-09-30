'use client';

/**
 * Gunny Stock Management — port of buildMeGunnyTable / meGunnyRefreshReceipts
 * (15-monthly-extras.js incl. the receiptImported override).
 *
 * Opening auto-carries from last month's closing; Receipt is automatic — the
 * office's imported figure wins, else the Sales Close totals, else the live
 * Monthly-Sales gunny counts. Total = Opening + Receipt; Closing = Total −
 * Issues (red when negative).
 *
 * Office, 2026-09-26:
 *   · POLY and C.BOX take their Issues from the grid's own Empty Polythene
 *     Bag / Empty Card+Box SALES — the deduction the shop keys once. It used
 *     to run the other way (typing Issues here wrote those sales rows), which
 *     is why the sale had nowhere to go but a negative CB on the grid.
 *   · Opening, Receipt, Total, Closing — and the two automatic Issues — are
 *     read-only for shop staff. Only an administrator may correct them, and
 *     /api/state refuses the write regardless of what this screen allows
 *     (src/lib/stockGuard.ts, rule 5).
 *
 * Office, 2026-09-30: the Save also carries POLY / C.BOX Issues into Monthly
 * Sales and the month's last-day Daily Entry (engine/gunnySync.ts), so they
 * are keyed once, here. And, the same day: Receipt is counted from the
 * month's saved sales (engine/gunnyPack.ts — never Sales Close), and Issues
 * are typed by the shop as well as an administrator.
 */
import { useRef, useState } from 'react';
import { appAlert, appConfirm } from '@/components/dialog';
import { saveSuccess } from '@/components/SaveSuccess';
import { crsData } from '@/lib/dataStore';
import { dmy } from '@/lib/dateFormat';
import type { Commodity } from '@/lib/engine/commodities';
import { GUNNY_SYNC_IDS, gunnySyncNote, syncGunnyToSales, type GunnySyncId, type GunnySyncStores } from '@/lib/engine/gunnySync';
import { refreshGunnyFor } from '@/lib/gunnyRefresh';
import type { PackType } from '@/lib/engine/gunnyPack';
import { gunnySaved, monthLabel } from '@/lib/saveSuccess';
import { ME_GUNNY_ITEMS, ME_GUNNY_TO_COMM, gunnyMonthRecords, gunnyRowFor, gunnySaveProblems, type GunnyRec, type MonthCtx, type SalesClose } from './lib';

const pad2 = (n: number) => String(n).padStart(2, '0');
/** YYYY-MM-01 of the month after. */
const nextMonthFirst = (month: number, year: number) => (month === 12 ? `${year + 1}-01-01` : `${year}-${pad2(month + 1)}-01`);
/** Today in the office's own calendar (the browser's), YYYY-MM-DD. */
const todayIso = () => {
  const t = new Date();
  return `${t.getFullYear()}-${pad2(t.getMonth() + 1)}-${pad2(t.getDate())}`;
};

export default function GunnyTable({
  ctx,
  gunny,
  salesClose,
  gridGunnySales,
  packSales,
  lists,
  packTypes,
  isAdmin,
  subtitle,
}: {
  ctx: MonthCtx;
  gunny: Record<string, Record<string, GunnyRec>>;
  salesClose: SalesClose | undefined;
  gridGunnySales: Record<string, number>;
  /** The month's sales per commodity — EMPTY_BAG / EMPTY_BOX become POLY / C.BOX Issues. */
  packSales: Record<string, number>;
  /** The shop's commodity lists — the rates the synced sales are priced at. */
  lists: { a: Commodity[]; b: Commodity[] };
  /** The month's pack types — the Receipt page's saved Gunny / Poly switch (engine/gunnyPack.ts). */
  packTypes: Record<string, PackType>;
  isAdmin: boolean;
  subtitle: string;
}) {
  const month = gunny[ctx.key] ?? {};
  const prevKey = `${ctx.crsId}_${ctx.month === 1 ? 12 : ctx.month - 1}_${ctx.month === 1 ? ctx.year - 1 : ctx.year}`;
  const prevMonth = gunny[prevKey] ?? {};

  // The row's arithmetic lives in lib.ts (gunnyRowFor), shared with the
  // 3-month PV so the two can never show different September Gunny figures.
  // Opening auto-carries from last month's closing and locks once carried
  // (15-monthly-extras).
  const rowFor = (id: string) => gunnyRowFor(id, month, prevMonth, salesClose, gridGunnySales, packSales, packTypes);

  const write = (id: string, patch: Partial<GunnyRec>) => {
    crsData.update<Record<string, Record<string, GunnyRec>>>('meGunnyStore', (d) => {
      const m = { ...(d[ctx.key] ?? {}) };
      const label = ME_GUNNY_ITEMS.find((i) => i.id === id)?.label ?? id;
      const cur = { ...(m[id] ?? {}) };
      const r = rowFor(id);
      m[id] = {
        itemName: cur.itemName ?? label,
        crsId: String(ctx.crsId),
        month: ctx.month,
        year: ctx.year,
        ...cur,
        // A carried Opening is stored as the carry, never a stale copy.
        ...(r.openingAuto ? { opening: r.openingVal !== '' ? Number(r.openingVal) : undefined, openingAuto: true } : {}),
        ...patch,
        updatedAt: new Date().toISOString(),
      };
      // keep the derived fields stored, as the legacy table did — the rule's own figures
      const after = m[id];
      const r2 = gunnyRowFor(id, m, prevMonth, salesClose, gridGunnySales, packSales, packTypes);
      after.receipt = r2.rc.val;
      after.total = r2.total;
      after.closing = r2.closing;
      d[ctx.key] = m;
    });
  };

  // No TOTAL summary under the table (office, 2026-09-26): 50 KG SS sacks,
  // polythene bags and card boxes are three different things and adding them
  // into one figure states a quantity of nothing. Each row keeps its own
  // Total — Opening + Receipt — which is what the office does use.
  const rows = ME_GUNNY_ITEMS.map((item) => ({ item, ...rowFor(item.id) }));

  // ── Save (office, 2026-09-29) ─────────────────────────────────────────────
  // Stores the month's rows exactly as the month-close does (gunnyMonthRecords,
  // lib.ts — one function for both), then waits for the database before the
  // tick. The permissions are the inputs' own, above, and stockGuard rule 5's
  // on the server; the button adds none and removes none. The status names the
  // shop and month it was for, so it never shows against another one.
  const [status, setStatus] = useState<{ key: string; msg: string; tone: 'ok' | 'warn' } | null>(null);
  const [saving, setSaving] = useState(false);
  const busy = useRef(false);
  const shown = status?.key === ctx.key ? status : null;
  const save = async () => {
    if (busy.current) return; // a second tap while the first is being sent
    const d0 = crsData.get<Record<string, Record<string, GunnyRec>>>('meGunnyStore') ?? {};
    const { errors, deficits } = gunnySaveProblems(d0[ctx.key] ?? {}, d0[prevKey] ?? {}, salesClose, gridGunnySales, packSales, packTypes);
    if (errors.length) {
      setStatus({ key: ctx.key, msg: `⚠ Not saved — ${errors.join(' ')}`, tone: 'warn' });
      return;
    }
    busy.current = true;
    setSaving(true);
    try {
      if (deficits.length) {
        const ok = await appConfirm({
          title: 'Closing below zero',
          tone: 'warning',
          confirmLabel: 'Save anyway',
          message: `${deficits.join('\n')}\n\nSave the Gunny Stock for ${monthLabel(ctx.month, ctx.year)} with a negative Closing?`,
        });
        if (!ok) {
          setStatus({ key: ctx.key, msg: 'Not saved — correct the Issues, then press Save.', tone: 'warn' });
          return;
        }
      }
      // POLY / C.BOX Issues → Monthly Sales and the last-day Daily Entry
      // (engine/gunnySync.ts), worked out first: if they cannot be placed,
      // nothing at all is sent.
      const want: Partial<Record<GunnySyncId, number>> = {};
      for (const item of ME_GUNNY_ITEMS) {
        const cid = ME_GUNNY_TO_COMM[item.id] as GunnySyncId | undefined;
        const r = rowFor(item.id);
        if (cid && (GUNNY_SYNC_IDS as readonly string[]).includes(cid) && r.issues !== '') want[cid] = Number(r.issues) || 0;
      }
      const stores: GunnySyncStores = {
        entryStore: crsData.get('entryStore') ?? {},
        inspectionStore: crsData.get('inspectionStore') ?? {},
        receiptStore: crsData.get('receiptStore') ?? [],
        meManualStore: crsData.get('meManualStore') ?? {},
        monthlyStore: crsData.get('monthlyStore') ?? {},
        meSourceStore: crsData.get('meSourceStore') ?? {},
      };
      const sync = syncGunnyToSales(stores, ctx.crsId, ctx.month, ctx.year, want, lists, todayIso());
      if (!sync.ok) {
        const why = sync.problems.join(' ');
        setStatus({ key: ctx.key, msg: `⚠ Not saved — ${why}`, tone: 'warn' });
        void appAlert({ title: 'Gunny Stock not saved', message: why });
        return;
      }
      if (sync.edited.meManualStore) crsData.markEdited('meManualStore', sync.edited.meManualStore);
      if (sync.edited.entryStore) crsData.markEdited('entryStore', sync.edited.entryStore);
      for (const [store, value] of Object.entries(sync.patch)) crsData.set(store as never, value as never);
      // The gunny rows then store against the sales as they now stand.
      const soldNow = { ...packSales, ...sync.monthly };
      crsData.markEdited('meGunnyStore', ctx.key);
      crsData.update<Record<string, Record<string, GunnyRec>>>('meGunnyStore', (d) => {
        d[ctx.key] = gunnyMonthRecords(d[ctx.key] ?? {}, d[prevKey] ?? {}, ctx, salesClose, gridGunnySales, soldNow, undefined, packTypes);
      });
      // Next month opens at this Closing: the months after it re-carry (lib.ts refreshGunnyMonths).
      refreshGunnyFor(ctx.crsId, [nextMonthFirst(ctx.month, ctx.year)]);
      if (await crsData.saveConfirmed()) {
        saveSuccess(gunnySaved(ctx.crsId, ctx.month, ctx.year));
        const note = gunnySyncNote(sync, dmy);
        setStatus({ key: ctx.key, msg: `✓ Saved for ${monthLabel(ctx.month, ctx.year)}.${note ? ` ${note}` : ''}`, tone: 'ok' });
      } else {
        const why = crsData.lastError || 'The server did not confirm the save.';
        setStatus({ key: ctx.key, msg: `⚠ Not saved — ${why}`, tone: 'warn' });
        void appAlert({ title: 'Gunny Stock not saved', message: why });
      }
    } finally {
      busy.current = false;
      setSaving(false);
    }
  };

  const th = { padding: '9px 10px', textAlign: 'center' as const, fontSize: 10, fontWeight: 700, color: '#6D28D9', borderBottom: '2px solid #DDD6FE' };

  return (
    <div style={{ width: '100%', marginTop: 20 }}>
      <div style={{ background: 'linear-gradient(135deg,#6D28D9,#8B5CF6)', borderRadius: '10px 10px 0 0', padding: '10px 16px', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <div>
          <div style={{ color: '#fff', fontWeight: 800, fontSize: 13 }}>📦 Gunny Stock Management</div>
          <div style={{ color: 'rgba(255,255,255,.7)', fontSize: 10, marginTop: 1 }}>{subtitle}</div>
        </div>
        <div style={{ color: 'rgba(255,255,255,.6)', fontSize: 10 }}>Gunny bags / sacks — opening, receipt, issues &amp; closing</div>
      </div>
      <div style={{ overflowX: 'auto', border: '1px solid #EDE9FE', borderTop: 'none', borderRadius: '0 0 10px 10px' }}>
        <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12, minWidth: 560 }}>
          <thead>
            <tr style={{ background: '#F5F3FF' }}>
              <th style={{ ...th, width: 55 }}>S.No</th>
              <th style={{ ...th, textAlign: 'left', padding: '9px 14px' }}>Item</th>
              <th style={th}>Opening</th>
              <th style={th}>Receipt</th>
              <th style={{ ...th, background: '#EDE9FE' }}>Total</th>
              <th style={th}>Issues</th>
              <th style={th}>Closing</th>
            </tr>
          </thead>
          <tbody>
            {rows.map(({ item, openingVal, openingAuto, rc, issues, issuesAuto, total, closing }, i) => (
              <tr key={item.id} style={{ background: i % 2 === 0 ? '#fff' : '#FAF5FF' }}>
                <td style={{ padding: 8, textAlign: 'center', fontSize: 11, color: 'var(--muted)', borderBottom: '1px solid #EDE9FE' }}>{i + 1}</td>
                <td style={{ padding: '8px 12px', fontWeight: 600, fontSize: 12, borderBottom: '1px solid #EDE9FE' }}>{item.label}</td>
                <td style={{ padding: '4px 5px', borderBottom: '1px solid #EDE9FE' }}>
                  <input
                    type="number"
                    min={0}
                    step={0.01}
                    placeholder="0"
                    // Carried from last month, and never keyed by shop staff
                    // (office, 2026-09-26) — the server refuses it too
                    // (stockGuard rule 5). An administrator may always correct
                    // it, carried or not: that is how a wrong opening is put
                    // right, and the months after it re-carry from the result.
                    readOnly={!isAdmin}
                    tabIndex={!isAdmin ? -1 : undefined}
                    value={openingVal}
                    onChange={(e) => write(item.id, { opening: e.target.value === '' ? '' : Number(e.target.value), openingAuto: false })}
                    title={openingAuto ? "Carried forward from last month's closing" : !isAdmin ? 'Opening is set by the office — an administrator can correct it' : undefined}
                    style={{ width: '100%', border: `1px solid ${openingAuto ? '#FDE68A' : '#DDD6FE'}`, borderRadius: 6, padding: '5px 7px', fontSize: 12, textAlign: 'right', ...(openingAuto ? { background: '#FEF3C7', color: '#92400E', fontWeight: 700 } : !isAdmin ? { background: '#F8FAFC', color: 'var(--muted)', fontWeight: 700 } : {}) }}
                  />
                </td>
                <td style={{ padding: '4px 5px', borderBottom: '1px solid #EDE9FE' }}>
                  <input
                    // Monthly Sales is the only source (office, 2026-09-30):
                    // the sum of the bag counts the grid above shows, by pack.
                    // Never typed — by anyone — so it cannot disagree with it.
                    type="text"
                    readOnly
                    tabIndex={-1}
                    data-gunny-receipt={item.id}
                    value={rc.val ? String(rc.val) : ''}
                    title={rc.src}
                    style={{ width: '100%', border: '1px solid #BBF7D0', borderRadius: 6, padding: '5px 7px', fontSize: 12, textAlign: 'right', color: '#15803D', fontWeight: 700, background: '#F0FDF4' }}
                  />
                </td>
                <td style={{ padding: '4px 5px', borderBottom: '1px solid #EDE9FE' }}>
                  <input type="text" readOnly tabIndex={-1} value={String(total)} style={{ width: '100%', border: '1px solid #DDD6FE', borderRadius: 6, padding: '5px 7px', fontSize: 12, textAlign: 'right', fontWeight: 700, background: '#EDE9FE', color: '#6D28D9' }} />
                </td>
                <td style={{ padding: '4px 5px', borderBottom: '1px solid #EDE9FE' }}>
                  <input
                    type="number"
                    min={0}
                    step={0.01}
                    placeholder="0"
                    // Typed by the shop and by an administrator (office,
                    // 2026-09-30). Left blank, POLY and C.BOX show the month's
                    // sales of those bags; a typed figure is never replaced.
                    value={issues === '' ? '' : String(issues)}
                    onChange={(e) => write(item.id, { issues: e.target.value === '' ? '' : Number(e.target.value) })}
                    title={issuesAuto ? 'From this month’s sales of these bags on the grid above — type to set the Issues' : undefined}
                    style={{ width: '100%', border: `1px solid ${issuesAuto ? '#FDE68A' : '#FCA5A5'}`, borderRadius: 6, padding: '5px 7px', fontSize: 12, textAlign: 'right', color: issuesAuto ? '#92400E' : '#DC2626', fontWeight: issuesAuto ? 700 : 600, background: issuesAuto ? '#FEF3C7' : '#FEF2F2' }}
                  />
                </td>
                <td style={{ padding: '4px 5px', borderBottom: '1px solid #EDE9FE' }}>
                  <input
                    type="text"
                    readOnly
                    tabIndex={-1}
                    value={String(closing)}
                    title={closing < 0 ? 'Deficit: Issues exceed Total' : undefined}
                    style={{ width: '100%', border: `1px solid ${closing < 0 ? '#FCA5A5' : '#E2E8F0'}`, borderRadius: 6, padding: '5px 7px', fontSize: 12, textAlign: 'right', fontWeight: closing < 0 ? 800 : 700, background: closing < 0 ? '#FEF2F2' : '#F8FAFC', color: closing < 0 ? '#DC2626' : 'var(--muted)' }}
                  />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <div style={{ marginTop: 8, fontSize: 10, color: 'var(--muted)', display: 'flex', gap: 16, flexWrap: 'wrap' }}>
        <span>ⓘ Opening auto-fills from last month&apos;s Closing and locks once carried forward</span>
        <span>ⓘ Receipt is Monthly Sales&apos; own bag counts, added up: sacks ÷50, poly ÷50 (salt ÷25), boxes ÷10 (palm oil) / ÷50 (tea); Wheat, RRA, NPHH FRK RRA as the Receipt page&apos;s Gunny / Poly switch says. It is never typed</span>
        <span>ⓘ Issues are typed; left blank, POLY and C.BOX show this month&apos;s Empty Polythene Bag / Empty Card+Box sales — Save carries them into Monthly Sales and the month&apos;s last-day Daily Entry</span>
        <span>
          ⓘ Total = Opening + Receipt &nbsp;|&nbsp; Closing = Total − Issues (turns <b style={{ color: '#DC2626' }}>red</b> if Issues exceed Total)
          {isAdmin ? null : <> &nbsp;|&nbsp; these figures are the office&apos;s — an administrator can correct them</>}
        </span>
      </div>
      <div className="gunny-save-bar">
        <button type="button" className="gunny-save-btn" onClick={save} disabled={saving} aria-busy={saving}>
          {saving ? '⏳ Saving…' : '💾 Save Gunny Stock'}
        </button>
        {shown ? (
          <span className="gunny-save-status" role="status" style={{ color: shown.tone === 'ok' ? '#15803D' : '#B45309' }}>
            {shown.msg}
          </span>
        ) : null}
      </div>
    </div>
  );
}
