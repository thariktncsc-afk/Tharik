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
 *
 * Save-only (office, 2026-09-30): typing changes a DRAFT held here, never the
 * store, so nothing reaches the database until Save — which is what the
 * office expects the button to do (the store's 5-second autosave used to send
 * each keystroke, leaving Save nothing to send). Total and Closing follow the
 * draft on the same render; the button turns amber with "Unsaved changes"
 * until Save lands, and leaving the page with a draft asks first. Drafts are
 * kept per shop-month, so another shop or month never shows them. An
 * administrator may type the Receipt (receiptTyped); clearing it goes back
 * to Monthly Sales.
 */
import { useEffect, useRef, useState } from 'react';
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
  // The person's unsaved edits, per shop-month and item: only the fields they
  // type (Opening, Receipt, Issues). Everything shown is worked out from the
  // stored month with these laid over it.
  type Draft = Record<string, Partial<Pick<GunnyRec, 'opening' | 'openingAuto' | 'issues' | 'receiptTyped'>>>;
  const [drafts, setDrafts] = useState<Record<string, Draft>>({});
  const draft = drafts[ctx.key] ?? {};
  const dirty = Object.keys(draft).length > 0;
  const withDraft = (stored: Record<string, GunnyRec>, d: Draft): Record<string, GunnyRec> => {
    const out: Record<string, GunnyRec> = { ...stored };
    for (const [id, patch] of Object.entries(d)) out[id] = { ...(stored[id] ?? {}), ...patch };
    return out;
  };
  const month = withDraft(gunny[ctx.key] ?? {}, draft);
  const prevKey = `${ctx.crsId}_${ctx.month === 1 ? 12 : ctx.month - 1}_${ctx.month === 1 ? ctx.year - 1 : ctx.year}`;
  const prevMonth = gunny[prevKey] ?? {};

  // Leaving the page (reload, close, typed address) with unsaved Gunny edits asks first.
  const anyDirty = Object.values(drafts).some((d) => Object.keys(d).length > 0);
  useEffect(() => {
    if (!anyDirty) return;
    const warn = (e: BeforeUnloadEvent) => {
      e.preventDefault();
      e.returnValue = '';
    };
    window.addEventListener('beforeunload', warn);
    return () => window.removeEventListener('beforeunload', warn);
  }, [anyDirty]);

  // The row's arithmetic lives in lib.ts (gunnyRowFor), shared with the
  // 3-month PV so the two can never show different September Gunny figures.
  // Opening auto-carries from last month's closing and locks once carried
  // (15-monthly-extras).
  const rowFor = (id: string) => gunnyRowFor(id, month, prevMonth, salesClose, gridGunnySales, packSales, packTypes);

  // Typing changes the draft only. A value typed back to what is stored drops
  // out of the draft, so the button is amber only while something differs.
  const write = (id: string, patch: Draft[string]) => {
    const key = ctx.key;
    setDrafts((all) => {
      const stored = (crsData.get<Record<string, Record<string, GunnyRec>>>('meGunnyStore') ?? {})[key]?.[id] ?? {};
      const cur = { ...(all[key]?.[id] ?? {}), ...patch };
      for (const f of Object.keys(cur) as (keyof typeof cur)[]) {
        const was = stored[f];
        if (String(cur[f] ?? '') === String(was ?? '') && !(f === 'openingAuto')) delete cur[f];
      }
      if (cur.opening === undefined) delete cur.openingAuto;
      const d = { ...(all[key] ?? {}) };
      if (Object.keys(cur).length) d[id] = cur;
      else delete d[id];
      return { ...all, [key]: d };
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
    // What is saved: the month as the database holds it, with this person's
    // edits laid over it — read now, so a figure someone else saved meanwhile
    // is kept and only the fields typed here change.
    const saveKey = ctx.key;
    const edits = drafts[saveKey] ?? {};
    const own = withDraft(d0[saveKey] ?? {}, edits);
    const { errors, deficits } = gunnySaveProblems(own, d0[prevKey] ?? {}, salesClose, gridGunnySales, packSales, packTypes);
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
        const r = gunnyRowFor(item.id, own, d0[prevKey] ?? {}, salesClose, gridGunnySales, packSales, packTypes);
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
        const merged = withDraft(d[saveKey] ?? {}, edits);
        for (const item of ME_GUNNY_ITEMS) {
          if (!edits[item.id]) continue;
          merged[item.id] = { itemName: item.label, crsId: String(ctx.crsId), month: ctx.month, year: ctx.year, ...merged[item.id] };
          // A cleared typed Receipt goes back to Monthly Sales: drop the field.
          if (merged[item.id].receiptTyped === '') delete merged[item.id].receiptTyped;
        }
        d[saveKey] = gunnyMonthRecords(merged, d[prevKey] ?? {}, ctx, salesClose, gridGunnySales, soldNow, undefined, packTypes);
      });
      // Next month opens at this Closing: the months after it re-carry (lib.ts refreshGunnyMonths).
      refreshGunnyFor(ctx.crsId, [nextMonthFirst(ctx.month, ctx.year)]);
      if (await crsData.saveConfirmed()) {
        // Landed: the draft that was sent is now the stored month. Edits typed
        // while it was on its way stay in the draft (they were not sent).
        setDrafts((all) => {
          const cur = { ...(all[saveKey] ?? {}) };
          for (const [id, sent] of Object.entries(edits)) {
            const now = cur[id];
            if (now && JSON.stringify(now) === JSON.stringify(sent)) delete cur[id];
          }
          return { ...all, [saveKey]: cur };
        });
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
            {rows.map(({ item, openingVal, openingAuto, rc, rcAuto, issues, issuesAuto, total, closing }, i) => (
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
                    // Monthly Sales' figure (the sum of the bag counts the grid
                    // above shows, by pack) unless an administrator types one
                    // (office, 2026-09-30); clearing it goes back to Monthly
                    // Sales. Shop staff: read-only (stockGuard rule 5 too).
                    type={isAdmin ? 'number' : 'text'}
                    min={0}
                    step={1}
                    readOnly={!isAdmin}
                    tabIndex={isAdmin ? undefined : -1}
                    data-gunny-receipt={item.id}
                    value={isAdmin && draft[item.id]?.receiptTyped !== undefined ? String(draft[item.id]?.receiptTyped) : rc.imported || rc.val ? String(rc.val) : ''}
                    placeholder={isAdmin ? String(rcAuto) : undefined}
                    onChange={isAdmin ? (e) => write(item.id, { receiptTyped: e.target.value === '' ? '' : Number(e.target.value) }) : undefined}
                    title={rc.src + (isAdmin && !rc.imported ? ' — type to set it' : '')}
                    style={{ width: '100%', border: `1px solid ${rc.imported ? '#FDBA74' : '#BBF7D0'}`, borderRadius: 6, padding: '5px 7px', fontSize: 12, textAlign: 'right', color: rc.imported ? '#C2410C' : '#15803D', fontWeight: 700, background: rc.imported ? '#FFF7ED' : '#F0FDF4' }}
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
        <span>ⓘ Receipt is Monthly Sales&apos; own bag counts, added up: sacks ÷50, poly ÷50 (salt ÷25), boxes ÷10 (palm oil) / ÷50 (tea); Wheat, RRA, NPHH FRK RRA as the Receipt page&apos;s Gunny / Poly switch says. {isAdmin ? <>An administrator may type one (shown <b style={{ color: '#C2410C' }}>orange</b>); clearing it goes back to Monthly Sales</> : null}</span>
        <span>ⓘ Issues are typed; left blank, POLY and C.BOX show this month&apos;s Empty Polythene Bag / Empty Card+Box sales — Save carries them into Monthly Sales and the month&apos;s last-day Daily Entry</span>
        <span>
          ⓘ Total = Opening + Receipt &nbsp;|&nbsp; Closing = Total − Issues (turns <b style={{ color: '#DC2626' }}>red</b> if Issues exceed Total)
          {isAdmin ? null : <> &nbsp;|&nbsp; these figures are the office&apos;s — an administrator can correct them</>}
        </span>
      </div>
      <div className="gunny-save-bar">
        <button
          type="button"
          className={`gunny-save-btn${dirty ? ' is-dirty' : ''}`}
          onClick={save}
          disabled={saving}
          aria-busy={saving}
          data-dirty={dirty ? 'true' : 'false'}
          title={dirty ? 'You have unsaved Gunny changes — press Save to keep them' : undefined}
        >
          {saving ? '⏳ Saving…' : dirty ? '💾 Save Gunny Stock — unsaved changes' : '💾 Save Gunny Stock'}
        </button>
        {dirty && !saving ? (
          <span className="gunny-save-status gunny-unsaved" role="status" style={{ color: '#B45309' }}>
            ● Unsaved changes — not in the database until you press Save.
          </span>
        ) : null}
        {!dirty && shown ? (
          <span className="gunny-save-status" role="status" style={{ color: shown.tone === 'ok' ? '#15803D' : '#B45309' }}>
            {shown.msg}
          </span>
        ) : null}
      </div>
    </div>
  );
}
