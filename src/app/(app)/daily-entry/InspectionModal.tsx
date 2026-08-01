'use client';

/**
 * Inspection entry overlay — React port of 16-inspection-actions.js.
 *
 * Step 1 picks the adjustment type (Shortage / Excess / Transfer), step 2
 * shows every commodity with the day's Available Stock (Opening + Receipt),
 * the adjustment input, the live Value (₹ = qty × rate) and the New Total
 * (Opening + Receipt + Excess − Shortage − Transfer). Shortage excludes the
 * police section, transfer accepts negatives (stock moved out), exactly as
 * the engine did. Saving writes inspectionStore and republishes the month,
 * so the Daily/Monthly grids and statements see the adjustments at once.
 */
import { useMemo, useState } from 'react';
import { crsData } from '@/lib/dataStore';
import { entryListsFor, type Commodity, type DayEntry } from '@/lib/engine/commodities';
import { rebuildMonthlyFromDaily, type MonthlyBlock, type SourceBlock } from '@/lib/engine/monthlyRollup';
import { shopName } from '@/lib/engine/shops';

type InspRec = { excess?: number; shortage?: number; transfer?: number };
type InspDay = { a?: Record<string, InspRec>; b?: Record<string, InspRec> };
type InspType = 'shortage' | 'excess' | 'transfer';

const INSP_TYPES: Record<
  InspType,
  { label: string; ta: string; icon: string; color: string; bg: string; bd: string; hdr: string; sign: string; desc: string; verb: string }
> = {
  shortage: { label: 'Shortage', ta: 'பற்றாக்குறை', icon: '🔻', color: '#DC2626', bg: '#FEF2F2', bd: '#FCA5A5', hdr: '#991B1B', sign: '−', desc: 'Stock is less than expected', verb: 'Shortage (less)' },
  excess: { label: 'Excess', ta: 'உபரி', icon: '🔺', color: '#15803D', bg: '#F0FDF4', bd: '#86EFAC', hdr: '#166534', sign: '+', desc: 'Extra stock found on hand', verb: 'Excess (add)' },
  transfer: { label: 'Transfer', ta: 'இடமாற்றம்', icon: '🔄', color: '#0369A1', bg: '#EFF6FF', bd: '#BAE6FD', hdr: '#1D4ED8', sign: '±', desc: 'Stock moved in (+) or out (−)', verb: 'Transfer (in +/out −)' },
};

export default function InspectionModal({ crsId, date, onClose }: { crsId: number; date: string; onClose: () => void }) {
  const [step, setStep] = useState<'menu' | InspType>('menu');
  const [values, setValues] = useState<Record<string, string>>({});
  const [savedMsg, setSavedMsg] = useState('');

  const key = `${crsId}_${date}`;
  const sheet = (crsData.get<Record<string, DayEntry>>('entryStore') ?? {})[key];
  const insp = (crsData.get<Record<string, InspDay>>('inspectionStore') ?? {})[key] ?? {};
  const lists = entryListsFor(crsId);

  const dLabel = new Date(date + 'T00:00:00').toLocaleDateString('en-IN', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' });
  const sub = `CRS ${crsId} — ${shopName(crsId)} • ${dLabel}`;

  const comms: { c: Commodity; sec: 'a' | 'b' }[] = useMemo(() => {
    const a = lists.a.map((c) => ({ c, sec: 'a' as const }));
    const b = lists.b.map((c) => ({ c, sec: 'b' as const }));
    // Police ration (Section B) has no shortage — excluded on that screen only.
    return step === 'shortage' ? a : [...a, ...b];
  }, [lists, step]);

  const existing = (sec: 'a' | 'b', id: string): Required<InspRec> => {
    const r = insp[sec]?.[id] ?? {};
    return { excess: Number(r.excess) || 0, shortage: Number(r.shortage) || 0, transfer: Number(r.transfer) || 0 };
  };

  const openStep = (t: InspType) => {
    const next: Record<string, string> = {};
    for (const { c, sec } of [...lists.a.map((c) => ({ c, sec: 'a' as const })), ...lists.b.map((c) => ({ c, sec: 'b' as const }))]) {
      const cur = existing(sec, c.id)[t];
      next[`${sec}:${c.id}`] = cur ? String(cur) : '';
    }
    setValues(next);
    setSavedMsg('');
    setStep(t);
  };

  const save = () => {
    if (step === 'menu') return;
    const t = step;
    crsData.update<Record<string, InspDay>>('inspectionStore', (d) => {
      const rec: InspDay = { a: { ...(d[key]?.a ?? {}) }, b: { ...(d[key]?.b ?? {}) } };
      for (const { c, sec } of comms) {
        const val = parseFloat(values[`${sec}:${c.id}`] ?? '') || 0;
        rec[sec]![c.id] = { ...(rec[sec]![c.id] ?? {}), [t]: val };
      }
      d[key] = rec;
    });
    // Republish the month so the grids and statements see the adjustments.
    const [y, m] = date.split('-').map(Number);
    const entryStore = crsData.get<Record<string, DayEntry>>('entryStore') ?? {};
    const inspectionStore = crsData.get<Record<string, InspDay>>('inspectionStore') ?? {};
    const manual = (crsData.get<Record<string, Partial<MonthlyBlock>>>('meManualStore') ?? {})[`${crsId}_${m}_${y}`];
    const next = rebuildMonthlyFromDaily(crsId, m, y, entryStore, inspectionStore as never, manual);
    crsData.update<Record<string, MonthlyBlock>>('monthlyStore', (d) => {
      d[`${crsId}_${m}_${y}`] = next.merged;
    });
    crsData.update<Record<string, SourceBlock>>('meSourceStore', (d) => {
      d[`${crsId}_${m}_${y}`] = next.source;
    });
    void crsData.save();
    setSavedMsg('✓ Saved!');
    setTimeout(() => setSavedMsg(''), 3000);
  };

  const overlay: React.CSSProperties = {
    position: 'fixed',
    inset: 0,
    zIndex: 9500,
    background: 'rgba(13,30,63,.55)',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    padding: 20,
  };

  if (step === 'menu') {
    return (
      <div style={overlay} onClick={(e) => e.target === e.currentTarget && onClose()}>
        <div style={{ background: '#fff', borderRadius: 16, width: '100%', maxWidth: 440, boxShadow: '0 20px 60px rgba(0,0,0,.3)', overflow: 'hidden' }}>
          <div style={{ background: 'linear-gradient(135deg,#7C3AED,#9333EA)', padding: '18px 22px', color: '#fff', display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 10 }}>
            <div>
              <div style={{ fontWeight: 800, fontSize: 16 }}>🔍 Inspection</div>
              <div style={{ fontSize: 12, opacity: 0.85, marginTop: 2 }}>{sub}</div>
            </div>
            <button type="button" onClick={onClose} style={{ background: 'rgba(255,255,255,.2)', border: 'none', color: '#fff', width: 28, height: 28, borderRadius: 8, cursor: 'pointer', fontSize: 15, flexShrink: 0 }}>
              ✕
            </button>
          </div>
          <div style={{ padding: '18px 20px' }}>
            <div style={{ fontSize: 12, color: '#64748B', marginBottom: 12 }}>Choose the type of stock adjustment to record for this day:</div>
            {(['shortage', 'excess', 'transfer'] as InspType[]).map((t) => {
              const o = INSP_TYPES[t];
              return (
                <button
                  key={t}
                  type="button"
                  onClick={() => openStep(t)}
                  style={{ display: 'flex', alignItems: 'center', gap: 14, width: '100%', textAlign: 'left', background: o.bg, border: `1.5px solid ${o.bd}`, borderRadius: 12, padding: '15px 18px', cursor: 'pointer', transition: '.15s', marginBottom: 10 }}
                >
                  <div style={{ fontSize: 26, lineHeight: 1 }}>{o.icon}</div>
                  <div style={{ flex: 1 }}>
                    <div style={{ fontWeight: 800, fontSize: 15, color: o.color }}>
                      {o.label} <span style={{ fontWeight: 600, fontSize: 12, color: '#64748B' }}>{o.ta}</span>
                    </div>
                    <div style={{ fontSize: 12, color: '#64748B', marginTop: 2 }}>{o.desc}</div>
                  </div>
                  <div style={{ fontSize: 22, color: o.color, fontWeight: 700 }}>›</div>
                </button>
              );
            })}
            <button type="button" onClick={onClose} style={{ width: '100%', marginTop: 4, background: '#F1F5F9', border: 'none', borderRadius: 10, padding: 10, fontSize: 13, fontWeight: 600, color: '#475569', cursor: 'pointer' }}>
              Cancel
            </button>
          </div>
        </div>
      </div>
    );
  }

  const meta = INSP_TYPES[step];
  const thS: React.CSSProperties = { background: '#1E40AF', color: '#fff', padding: '7px 8px', border: '1px solid #1D4ED8', textAlign: 'center', fontSize: 10, position: 'sticky', top: 0, zIndex: 1 };
  const tdS: React.CSSProperties = { border: '1px solid #E2E8F0', padding: '6px 8px' };

  return (
    <div style={overlay} onClick={(e) => e.target === e.currentTarget && onClose()}>
      <div style={{ background: '#fff', borderRadius: 16, width: '100%', maxWidth: 860, maxHeight: '92vh', display: 'flex', flexDirection: 'column', boxShadow: '0 20px 60px rgba(0,0,0,.3)', overflow: 'hidden' }}>
        <div style={{ background: `linear-gradient(135deg,${meta.hdr},${meta.color})`, padding: '16px 20px', color: '#fff', display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 10, flexShrink: 0 }}>
          <div>
            <div style={{ fontWeight: 800, fontSize: 15 }}>
              {meta.icon} {meta.label} — {meta.ta}
            </div>
            <div style={{ fontSize: 11, opacity: 0.85, marginTop: 2 }}>{sub}</div>
          </div>
          <button type="button" onClick={onClose} style={{ background: 'rgba(255,255,255,.2)', border: 'none', color: '#fff', width: 28, height: 28, borderRadius: 8, cursor: 'pointer', fontSize: 15, flexShrink: 0 }}>
            ✕
          </button>
        </div>

        <div style={{ padding: '16px 18px', overflow: 'auto', flex: 1 }}>
          <div style={{ display: 'flex', alignItems: 'flex-start', gap: 8, background: meta.bg, border: `1px solid ${meta.bd}`, borderRadius: 10, padding: '10px 14px', marginBottom: 12, fontSize: 12, color: meta.color }}>
            <span style={{ fontSize: 16, lineHeight: 1.2 }}>ℹ️</span>
            <span>
              <b>Available Stock</b> = Opening + Receipt for the day. Enter the <b>{meta.verb}</b> quantity per commodity — the <b>Value (₹)</b> and <b>New Total</b> update automatically (Value = quantity × rate).
            </span>
          </div>
          {step === 'shortage' ? (
            <div style={{ fontSize: 11, color: '#C2410C', background: '#FFF7ED', border: '1px solid #FED7AA', borderRadius: 8, padding: '8px 12px', marginBottom: 10 }}>
              <b>Note:</b> Police ration card (Section B) commodities are excluded — shortage does not apply to them.
            </div>
          ) : null}

          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12 }}>
            <thead>
              <tr>
                <th style={{ ...thS, width: 30 }}>#</th>
                <th style={{ ...thS, textAlign: 'left' }}>Commodity</th>
                <th style={{ ...thS, width: 42 }}>Unit</th>
                <th style={{ ...thS, width: 70 }}>Rate</th>
                <th style={{ ...thS, background: '#92400E', width: 110 }}>
                  Available Stock<br />
                  <span style={{ fontWeight: 500, fontSize: 8 }}>Opening + Receipt</span>
                </th>
                <th style={{ ...thS, background: meta.hdr, width: 130 }}>
                  {meta.label} ({meta.sign})
                </th>
                <th style={{ ...thS, background: '#B45309', width: 100 }}>
                  Value (₹)<br />
                  <span style={{ fontWeight: 500, fontSize: 8 }}>qty × rate</span>
                </th>
                <th style={{ ...thS, background: '#0369A1', width: 110 }}>New Total</th>
              </tr>
            </thead>
            <tbody>
              {comms.map(({ c, sec }, i) => {
                const d = sheet?.[sec]?.[c.id] ?? {};
                const open = Number(d.open) || 0;
                const rec = Number(d.receipt) || 0;
                const avail = open + rec;
                const ei = existing(sec, c.id);
                const v = parseFloat(values[`${sec}:${c.id}`] ?? '') || 0;
                const adj = { ...ei, [step]: v };
                const total = open + rec + adj.excess - adj.shortage - adj.transfer;
                const amt = c.free ? 0 : v * c.rate;
                const rowBg = i % 2 === 1 ? '#F8FAFC' : '#fff';
                return (
                  <tr key={`${sec}:${c.id}`}>
                    <td style={{ ...tdS, textAlign: 'center', color: '#6B7A8F', background: rowBg }}>{i + 1}</td>
                    <td style={{ ...tdS, background: rowBg }}>
                      <b>{c.ta}</b>
                      <br />
                      <span style={{ color: '#6B7A8F', fontSize: 10 }}>{c.en}</span>
                    </td>
                    <td style={{ ...tdS, textAlign: 'center', color: '#6B7A8F', background: rowBg }}>{c.unit}</td>
                    <td style={{ ...tdS, textAlign: 'center', fontWeight: 600, background: rowBg }}>
                      {c.free ? <span style={{ color: '#16A34A', fontSize: 10 }}>Free</span> : `₹${c.rate.toFixed(2)}`}
                    </td>
                    <td style={{ ...tdS, textAlign: 'right', fontWeight: 700, background: '#FEF9C3', color: '#92400E' }}>{avail.toFixed(3)}</td>
                    <td style={{ ...tdS, background: meta.bg, padding: '3px 5px' }}>
                      <input
                        type="number"
                        min={step === 'transfer' ? undefined : 0}
                        step={0.001}
                        placeholder="0"
                        value={values[`${sec}:${c.id}`] ?? ''}
                        onChange={(e) => setValues((p) => ({ ...p, [`${sec}:${c.id}`]: e.target.value }))}
                        style={{ width: 96, border: `1px solid ${meta.bd}`, borderRadius: 5, padding: '5px 7px', fontSize: 12, textAlign: 'right', fontWeight: 700, color: meta.color, background: '#fff' }}
                      />
                    </td>
                    <td style={{ ...tdS, textAlign: 'right', fontWeight: 800, color: '#92400E', background: '#FFFBEB' }}>
                      {c.free ? <span style={{ color: '#16A34A', fontStyle: 'italic', fontSize: 10 }}>Free</span> : `₹${amt.toFixed(2)}`}
                    </td>
                    <td style={{ ...tdS, textAlign: 'right', fontWeight: 800, color: '#0369A1', background: '#EFF6FF' }}>{total.toFixed(3)}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>

        <div style={{ padding: '12px 18px', borderTop: '1px solid #E2E8F0', display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 10, flexShrink: 0, background: '#fff' }}>
          <button type="button" onClick={() => setStep('menu')} style={{ background: '#F1F5F9', border: 'none', padding: '9px 18px', borderRadius: 8, fontSize: 13, fontWeight: 600, color: '#475569', cursor: 'pointer' }}>
            ‹ Back
          </button>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <span style={{ fontSize: 12, color: '#16A34A', fontWeight: 700 }}>{savedMsg}</span>
            <button type="button" onClick={save} style={{ background: '#16A34A', color: '#fff', border: 'none', padding: '9px 22px', borderRadius: 8, fontSize: 13, fontWeight: 700, cursor: 'pointer' }}>
              ✓ Save {meta.label}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
