'use client';

/**
 * Card Details & Allotment — port of 22-allotment.js.
 *
 * Card counts carry forward: a month with none of its own previews last
 * month's figures as a DRAFT (never written by rendering); the first edit,
 * Save or No Change adopts them. Allotment is re-issued every month and is
 * never carried. Advance Load (24-coll.js) is typed beside the allotment and
 * only ever reduces what the COLL statement reports as received.
 *
 * EACH SECTION IS SAVED SEPARATELY, FOR ITS MONTH. Save Card Details and Save
 * Allotment each set that month's marker (meCardConfirmed / meAllotConfirmed,
 * keyed crsId_month_year), and editing a figure clears it again. A month-close
 * asks for both markers, because a carried-forward count on screen looks
 * exactly like a saved one and is not one (monthly-entry/lib.ts). Nothing here
 * ever writes another month: last month's card details and allotment are read
 * for the draft and left alone.
 */
import { useMemo, useState } from 'react';
import { appConfirm } from '@/components/dialog';
import { saveSuccess } from '@/components/SaveSuccess';
import { allotmentSaved, cardDetailsSaved } from '@/lib/saveSuccess';
import { crsData } from '@/lib/dataStore';
import { useAllotItems } from '@/lib/masters';
import {
  ME_CARD_TYPES,
  ME_MONTH_NAMES,
  allotHasValues,
  applySectionFlag,
  cardDraft,
  mePrevKey,
  monthlyHasCounts,
  sectionSaved,
  type CardRec,
  type MonthCtx,
} from './lib';

type Status = { msg: string; tone: 'ok' | 'warn' | 'info' } | null;

export default function CardAllot({
  ctx,
  cards,
  allot,
  advance,
  confirmed,
  allotConfirmed,
  subtitle,
}: {
  ctx: MonthCtx;
  cards: Record<string, Record<string, CardRec>>;
  allot: Record<string, Record<string, number>>;
  advance: Record<string, Record<string, number>>;
  confirmed: Record<string, boolean>;
  allotConfirmed: Record<string, boolean>;
  subtitle: string;
}) {
  const [status, setStatus] = useState<Status>(null);
  const cardsSaved = sectionSaved(confirmed, ctx.key);
  const allotSaved = sectionSaved(allotConfirmed, ctx.key);

  /**
   * Each section is saved for ITS month, and editing a figure puts it back to
   * unsaved — the month-close asks whether this month was reviewed and saved,
   * so a change made after the save has to be saved again before it counts.
   * Only the flag for this `crsId_month_year` is touched; last month's saved
   * card details and allotment are never written by anything here.
   */
  const markSaved = (store: 'meCardConfirmed' | 'meAllotConfirmed', saved: boolean) => {
    crsData.update<Record<string, boolean>>(store, (d) => applySectionFlag(d, ctx.key, saved));
  };

  const own = cards[ctx.key];
  const prev = cards[mePrevKey(ctx.crsId, ctx.month, ctx.year)];
  const { shown, carried } = useMemo(() => cardDraft(cards, ctx.crsId, ctx.month, ctx.year), [cards, ctx.crsId, ctx.month, ctx.year]);

  const monthAllot = allot[ctx.key] ?? {};
  const monthAdv = advance[ctx.key] ?? {};
  const items = useAllotItems(ctx.crsId);
  const moName = ME_MONTH_NAMES[ctx.month] ?? '';
  const prevName = ME_MONTH_NAMES[ctx.month === 1 ? 12 : ctx.month - 1] ?? 'last month';

  const cardTotal = Object.values(shown).reduce((t, d) => t + (parseInt(String(d.count)) || 0), 0);
  const allotCount = items.filter((c) => (Number(monthAllot[c.id]) || 0) > 0).length;

  const defaultStatus: Status = carried
    ? { msg: `Showing ${prevName}’s counts — not saved for ${moName} yet. Press No Change to keep them, or edit and Save.`, tone: 'warn' }
    : cardsSaved
      ? { msg: `✓ Card details saved for ${moName} ${ctx.year}.`, tone: 'ok' }
      : monthlyHasCounts(own)
        ? { msg: 'Not saved yet — press Save to store these counts.', tone: 'warn' }
        : { msg: 'Enter the card counts, then press Save.', tone: 'warn' };
  const shownStatus = status ?? defaultStatus;

  /** Adopt a carried draft as this month's figures (first edit / Save / No Change). */
  const commitCarry = () => {
    if (!carried) return;
    crsData.update<Record<string, Record<string, CardRec>>>('meCardStore', (d) => {
      if (!d[ctx.key] || !Object.keys(d[ctx.key]).length) d[ctx.key] = { ...shown };
    });
  };

  const setCount = (id: string, val: string) => {
    commitCarry();
    markSaved('meCardConfirmed', false);
    crsData.update<Record<string, Record<string, CardRec>>>('meCardStore', (d) => {
      const m = { ...(d[ctx.key] ?? {}) };
      m[id] = { count: val === '' ? '' : parseInt(val) || 0 };
      d[ctx.key] = m;
    });
    setStatus(null);
  };

  const setAllot = (id: string, val: string) => {
    markSaved('meAllotConfirmed', false);
    crsData.update<Record<string, Record<string, number>>>('meAllotStore', (d) => {
      const m = { ...(d[ctx.key] ?? {}) };
      const v = parseFloat(val);
      if (val === '' || isNaN(v) || v < 0) delete m[id];
      else m[id] = v;
      d[ctx.key] = m;
    });
  };

  const setAdvance = (id: string, val: string) => {
    crsData.update<Record<string, Record<string, number>>>('meAdvanceStore', (d) => {
      const m = { ...(d[ctx.key] ?? {}) };
      const v = parseFloat(val);
      if (val === '' || isNaN(v) || v < 0) delete m[id];
      else m[id] = v;
      d[ctx.key] = m;
    });
  };

  const noChange = async () => {
    if (!prev || !Object.keys(prev).length) {
      setStatus({ msg: `Nothing to carry forward — ${prevName} has no card details. Enter the counts and press Save.`, tone: 'warn' });
      return;
    }
    if (monthlyHasCounts(own)) {
      const ok = await appConfirm({
        title: 'Replace card details',
        tone: 'warning',
        confirmLabel: 'Replace',
        message: `Replace the card details already entered for ${moName} ${ctx.year} with ${prevName}’s?\n\nThis cannot be undone.`,
      });
      if (!ok) {
        setStatus({ msg: `No Change cancelled — ${moName} ${ctx.year}’s own counts are unchanged.`, tone: 'info' });
        return;
      }
    }
    // Re-read the source month AFTER the dialog — it may have been corrected
    // (or reloaded on a save conflict) while the confirm sat open.
    const freshPrev = crsData.get<Record<string, Record<string, CardRec>>>('meCardStore')?.[mePrevKey(ctx.crsId, ctx.month, ctx.year)] ?? prev;
    crsData.update<Record<string, Record<string, CardRec>>>('meCardStore', (d) => {
      const m: Record<string, CardRec> = {};
      for (const [id, rec] of Object.entries(freshPrev)) m[id] = { count: parseInt(String(rec.count)) || 0 };
      d[ctx.key] = m;
    });
    markSaved('meCardConfirmed', true);
    if (await crsData.saveConfirmed()) saveSuccess(cardDetailsSaved(ctx.crsId, ctx.month, ctx.year));
    setStatus({ msg: `✓ Copied ${prevName}’s card details into ${moName} ${ctx.year} and saved them.`, tone: 'ok' });
  };

  /**
   * Card Details and Allotment are saved SEPARATELY, each for this month.
   * Carried-forward counts are not saved counts: pressing Save here is what
   * makes them this month's, which is exactly what the month-close asks about.
   */
  const saveCards = async () => {
    commitCarry();
    const cur = crsData.get<Record<string, Record<string, CardRec>>>('meCardStore')?.[ctx.key];
    if (!monthlyHasCounts(cur)) {
      setStatus({ msg: '⚠ Enter at least one card count before saving the Card Details.', tone: 'warn' });
      return;
    }
    markSaved('meCardConfirmed', true);
    const total = Object.values(cur!).reduce((t, d) => t + (parseInt(String(d.count)) || 0), 0);
    setStatus({ msg: `✓ Card Details saved for ${moName} ${ctx.year} — ${total} cards.`, tone: 'ok' });
    if (await crsData.saveConfirmed()) saveSuccess(cardDetailsSaved(ctx.crsId, ctx.month, ctx.year));
  };

  const saveAllot = async () => {
    const cur = crsData.get<Record<string, Record<string, number>>>('meAllotStore')?.[ctx.key];
    if (!allotHasValues(cur, items)) {
      setStatus({ msg: '⚠ Enter at least one allotment quantity before saving the Allotment.', tone: 'warn' });
      return;
    }
    markSaved('meAllotConfirmed', true);
    const n = Object.entries(cur!).filter(([id, v]) => items.some((c) => c.id === id) && (Number(v) || 0) > 0).length;
    setStatus({ msg: `✓ Allotment saved for ${moName} ${ctx.year} — ${n} ${n === 1 ? 'commodity' : 'commodities'}.`, tone: 'ok' });
    if (await crsData.saveConfirmed()) saveSuccess(allotmentSaved(ctx.crsId, ctx.month, ctx.year));
  };

  const th = { padding: '9px 10px', textAlign: 'center' as const, fontSize: 10, fontWeight: 700, color: '#0F766E', borderBottom: '2px solid #99F6E4' };
  const toneColor = { ok: '#15803D', warn: '#B45309', info: '#0F766E' };

  return (
    <div style={{ width: '100%', marginTop: 20 }}>
      <div style={{ background: 'linear-gradient(135deg,#0F766E,#14B8A6)', borderRadius: '10px 10px 0 0', padding: '10px 16px', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <div>
          <div style={{ color: '#fff', fontWeight: 800, fontSize: 13 }}>🧺 Card Details &amp; Allotment</div>
          <div style={{ color: 'rgba(255,255,255,.7)', fontSize: 10, marginTop: 1 }}>{subtitle}</div>
        </div>
        <div style={{ color: 'rgba(255,255,255,.6)', fontSize: 10 }}>card count carries forward · allotment is entered each month</div>
      </div>
      <div style={{ border: '1px solid #CCFBF1', borderTop: 'none', borderRadius: '0 0 10px 10px', padding: 14, display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16, alignItems: 'start' }}>
        {/* Card counts */}
        <div style={{ border: '1px solid #CCFBF1', borderRadius: 9, overflowX: 'auto' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12, minWidth: 260 }}>
            <thead>
              <tr style={{ background: '#F0FDFA' }}>
                <th style={{ ...th, width: 48 }}>S.NO</th>
                <th style={{ ...th, textAlign: 'left', padding: '9px 14px' }}>CARD DETAILS</th>
                <th style={{ ...th, width: 120 }}>CARD COUNT</th>
              </tr>
            </thead>
            <tbody>
              {ME_CARD_TYPES.map((ct, i) => {
                const d = shown[ct.id] ?? {};
                const count = d.count !== undefined && d.count !== '' ? String(parseInt(String(d.count))) : '';
                return (
                  <tr key={ct.id} style={{ background: i % 2 === 0 ? '#fff' : '#F0FDFA' }}>
                    <td style={{ padding: '7px 10px', textAlign: 'center', fontSize: 11, color: 'var(--muted)', borderBottom: '1px solid #CCFBF1' }}>{i + 1}</td>
                    <td style={{ padding: '7px 14px', fontSize: 12, fontWeight: 600, borderBottom: '1px solid #CCFBF1' }}>{ct.label}</td>
                    <td style={{ padding: '4px 8px', textAlign: 'center', borderBottom: '1px solid #CCFBF1' }}>
                      <input
                        type="number"
                        min={0}
                        step={1}
                        placeholder="0"
                        value={count}
                        onChange={(e) => setCount(ct.id, e.target.value)}
                        style={{ width: 90, border: '2px solid #99F6E4', borderRadius: 7, padding: '5px 10px', fontSize: 13, fontWeight: 800, textAlign: 'center', color: '#0F766E', background: '#F0FDFA' }}
                      />
                    </td>
                  </tr>
                );
              })}
            </tbody>
            <tfoot>
              <tr style={{ background: '#0F766E' }}>
                <td colSpan={2} style={{ padding: '9px 14px', fontWeight: 800, color: '#fff', fontSize: 12, textAlign: 'right', letterSpacing: '.03em' }}>TOTAL CARD</td>
                <td style={{ padding: '9px 10px', fontWeight: 900, fontSize: 15, color: '#CCFBF1', textAlign: 'center' }}>{cardTotal}</td>
              </tr>
            </tfoot>
          </table>
        </div>

        {/* Allotment + advance load */}
        <div style={{ border: '1px solid #CCFBF1', borderRadius: 9, overflowX: 'auto' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12, minWidth: 380 }}>
            <thead>
              <tr style={{ background: '#F0FDFA' }}>
                <th style={{ ...th, width: 48 }}>S.NO</th>
                <th style={{ ...th, textAlign: 'left', padding: '9px 14px' }}>ALLOTMENT</th>
                <th style={{ ...th, width: 150 }}>QUANTITY</th>
                <th style={{ ...th, width: 140, color: '#B45309', borderBottom: '2px solid #FDE68A' }}>ADVANCE LOAD</th>
              </tr>
            </thead>
            <tbody>
              {items.map((c, i) => {
                const val = monthAllot[c.id];
                const aval = monthAdv[c.id];
                return (
                  <tr key={c.id} style={{ background: (i + 1) % 2 === 0 ? '#F0FDFA' : '#fff' }}>
                    <td style={{ padding: '6px 10px', textAlign: 'center', fontSize: 11, color: 'var(--muted)', borderBottom: '1px solid #CCFBF1' }}>{i + 1}</td>
                    <td style={{ padding: '6px 12px', borderBottom: '1px solid #CCFBF1' }}>
                      <div style={{ fontSize: 11.5, fontWeight: 600 }}>{c.en}</div>
                      <div style={{ fontSize: 9.5, color: 'var(--muted)' }}>{c.ta}</div>
                    </td>
                    <td style={{ padding: '4px 8px', textAlign: 'center', borderBottom: '1px solid #CCFBF1', whiteSpace: 'nowrap' }}>
                      <input
                        type="number"
                        min={0}
                        step={0.001}
                        placeholder="0.000"
                        value={val === undefined ? '' : String(val)}
                        onChange={(e) => setAllot(c.id, e.target.value)}
                        style={{ width: 96, border: '2px solid #99F6E4', borderRadius: 7, padding: '5px 8px', fontSize: 12.5, fontWeight: 800, textAlign: 'right', color: '#0F766E', background: '#F0FDFA' }}
                      />
                      <span style={{ fontSize: 9.5, fontWeight: 700, color: 'var(--muted)', marginLeft: 6 }}>{c.unit}</span>
                    </td>
                    <td style={{ padding: '4px 8px', textAlign: 'center', borderBottom: '1px solid #CCFBF1', whiteSpace: 'nowrap' }}>
                      <input
                        type="number"
                        min={0}
                        step={0.001}
                        placeholder="0.000"
                        value={aval === undefined ? '' : String(aval)}
                        onChange={(e) => setAdvance(c.id, e.target.value)}
                        title="Stock drawn ahead of its month. Deducted from Received from godown on the COLL statement."
                        style={{ width: 92, border: '2px solid #FDE68A', borderRadius: 7, padding: '5px 8px', fontSize: 12.5, fontWeight: 800, textAlign: 'right', color: '#B45309', background: '#FFFBEB' }}
                      />
                    </td>
                  </tr>
                );
              })}
            </tbody>
            <tfoot>
              <tr style={{ background: '#0F766E' }}>
                <td colSpan={2} style={{ padding: '9px 14px', fontWeight: 800, color: '#fff', fontSize: 12, textAlign: 'right', letterSpacing: '.03em' }}>COMMODITIES ENTERED</td>
                <td style={{ padding: '9px 10px', fontWeight: 900, fontSize: 15, color: '#CCFBF1', textAlign: 'center' }}>{allotCount}</td>
                <td />
              </tr>
            </tfoot>
          </table>
        </div>
      </div>

      {/* Where each section stands for THIS month — what the month-close
          reads. Said plainly, because a carried-forward figure on screen
          looks exactly like a saved one. */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap', marginTop: 12 }}>
        <span style={{ fontSize: 11, fontWeight: 700, color: cardsSaved ? '#15803D' : '#B45309', background: cardsSaved ? '#DCFCE7' : '#FFFBEB', border: `1px solid ${cardsSaved ? '#86EFAC' : '#FDE68A'}`, borderRadius: 7, padding: '4px 10px' }}>
          {cardsSaved ? '✅' : '❌'} Card Details — {cardsSaved ? 'Saved' : 'Not Saved'} for {moName} {ctx.year}
        </span>
        <span style={{ fontSize: 11, fontWeight: 700, color: allotSaved ? '#15803D' : '#B45309', background: allotSaved ? '#DCFCE7' : '#FFFBEB', border: `1px solid ${allotSaved ? '#86EFAC' : '#FDE68A'}`, borderRadius: 7, padding: '4px 10px' }}>
          {allotSaved ? '✅' : '❌'} Allotment — {allotSaved ? 'Saved' : 'Not Saved'} for {moName} {ctx.year}
        </span>
      </div>

      <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap', marginTop: 10 }}>
        {shownStatus ? <span style={{ fontSize: 11, fontWeight: 600, color: toneColor[shownStatus.tone] }}>{shownStatus.msg}</span> : null}
        <button type="button" onClick={() => void noChange()} title="Copy last month's card counts into this month and save them" style={{ marginLeft: 'auto', background: '#fff', border: '1px solid #99F6E4', color: '#0F766E', padding: '9px 18px', borderRadius: 8, fontWeight: 700, fontSize: 13, cursor: 'pointer' }}>
          ↶ No Change
        </button>
        <button type="button" onClick={() => void saveCards()} title="Save the card counts for this month" style={{ background: 'linear-gradient(135deg,#0F766E,#14B8A6)', color: '#fff', border: 'none', padding: '9px 18px', borderRadius: 8, fontWeight: 700, fontSize: 13, cursor: 'pointer', boxShadow: '0 2px 10px rgba(20,184,166,.3)' }}>
          💾 Save Card Details
        </button>
        <button type="button" onClick={() => void saveAllot()} title="Save the allotment quantities for this month" style={{ background: 'linear-gradient(135deg,#0F766E,#14B8A6)', color: '#fff', border: 'none', padding: '9px 18px', borderRadius: 8, fontWeight: 700, fontSize: 13, cursor: 'pointer', boxShadow: '0 2px 10px rgba(20,184,166,.3)' }}>
          💾 Save Allotment
        </button>
      </div>
    </div>
  );
}
