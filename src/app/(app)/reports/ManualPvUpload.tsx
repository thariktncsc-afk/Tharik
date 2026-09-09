'use client';

/**
 * Manual 3-Month PV — one upload slot per month of the chosen quarter.
 *
 * A slot knows which month it is for, so the file is checked against that slot
 * the moment it is chosen: the wrong month, or another shop's statement, is
 * refused there and then rather than surfacing as a wrong total three steps
 * later. Generate stays disabled until all three slots hold a validated file.
 *
 * The consolidation itself is consolidateMonths() in pvExcel.ts — opening and
 * closing are balances and are not summed.
 */
import { useMemo, useState } from 'react';
import { monthName, type PvPeriod } from '@/lib/engine/pvPeriod';
import { readMonthlyStatement, StatementReadError, type PvMonthData } from '@/lib/engine/pvExcel';

type SlotState = { file: File; data: PvMonthData } | { error: string } | null;

const isLoaded = (s: SlotState): s is { file: File; data: PvMonthData } => !!s && 'data' in s;

export default function ManualPvUpload({
  period,
  crsId,
  crsName,
  onGenerate,
}: {
  period: PvPeriod;
  crsId: number;
  crsName: string;
  onGenerate: (months: PvMonthData[]) => void;
}) {
  const [slots, setSlots] = useState<Record<string, SlotState>>({});
  const [busy, setBusy] = useState<string | null>(null);

  const slotKey = (m: { year: number; month: number }) => `${m.year}-${m.month}`;
  // A new period means the old files no longer belong to these slots.
  const periodId = period.months.map(slotKey).join('|');
  const [seenPeriod, setSeenPeriod] = useState(periodId);
  if (seenPeriod !== periodId) {
    setSeenPeriod(periodId);
    setSlots({});
  }

  const ready = period.months.filter((m) => isLoaded(slots[slotKey(m)])).length;
  const allReady = ready === period.months.length;

  const loaded = useMemo(
    () => period.months.map((m) => slots[slotKey(m)]).filter(isLoaded).map((s) => s.data),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [slots, periodId],
  );

  const accept = async (m: { year: number; month: number }, file: File | undefined) => {
    if (!file) return;
    const k = slotKey(m);
    setBusy(k);
    try {
      const data = await readMonthlyStatement(file);
      // The slot is the contract: this file must be THIS month, THIS shop.
      if (data.crsId !== crsId) {
        throw new StatementReadError(`CRS Shop Mismatch — this statement belongs to CRS ${data.crsId}${data.crsName ? ` (${data.crsName})` : ''}, not CRS ${crsId}.`);
      }
      if (data.month !== m.month || data.year !== m.year) {
        throw new StatementReadError(`Wrong Statement Month — this file contains ${monthName(data.month)} ${data.year}. Please upload the ${monthName(m.month)} ${m.year} monthly statement.`);
      }
      if (!data.rows.length) throw new StatementReadError('No commodity rows were found in this statement.');
      setSlots((p) => ({ ...p, [k]: { file, data } }));
    } catch (e) {
      setSlots((p) => ({ ...p, [k]: { error: e instanceof Error ? e.message : String(e) } }));
    } finally {
      setBusy(null);
    }
  };

  const card: React.CSSProperties = {
    border: '1px solid var(--border)', borderRadius: 12, background: '#fff',
    padding: 14, display: 'flex', flexDirection: 'column', gap: 8, minHeight: 150,
  };

  return (
    <div className="card mb-4">
      <div className="card-header">
        <div className="card-title">📊 Manual 3-Month PV Generator</div>
        <div style={{ fontSize: 11, color: 'var(--muted)', marginTop: 2 }}>
          Upload the three monthly Excel statements for {period.label} · CRS {crsId} — {crsName}
        </div>
      </div>
      <div className="card-body">
        {/* auto-fit rather than three fixed columns, so the slots stack on a
            phone without a separate breakpoint. */}
        <div style={{ display: 'grid', gap: 14, gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))' }}>
          {period.months.map((m) => {
            const k = slotKey(m);
            const s = slots[k];
            const ok = isLoaded(s);
            const err = s && 'error' in s ? s.error : '';
            return (
              <div key={k} style={{ ...card, borderColor: ok ? '#86EFAC' : err ? '#FCA5A5' : 'var(--border)', background: ok ? '#F0FDF4' : err ? '#FEF2F2' : '#fff' }}>
                <div style={{ fontWeight: 800, fontSize: 13, color: ok ? '#15803D' : err ? '#B91C1C' : 'var(--text)', textTransform: 'uppercase', letterSpacing: '.03em' }}>
                  📄 {monthName(m.month)} {m.year}
                </div>

                {ok ? (
                  <>
                    <div style={{ fontSize: 12, color: '#15803D', fontWeight: 700, wordBreak: 'break-all' }}>✅ {s.file.name}</div>
                    <div style={{ fontSize: 11, color: 'var(--muted)' }}>{s.data.rows.length} commodities read</div>
                    <div style={{ display: 'flex', gap: 8, marginTop: 'auto', flexWrap: 'wrap' }}>
                      <label style={{ flex: 1, minWidth: 90 }}>
                        <span style={{ display: 'block', textAlign: 'center', background: '#fff', border: '1px solid var(--border)', borderRadius: 7, padding: '6px 0', fontSize: 12, fontWeight: 700, cursor: 'pointer' }}>Replace</span>
                        <input type="file" accept=".xlsx,.xls" style={{ display: 'none' }} onChange={(e) => void accept(m, e.target.files?.[0])} />
                      </label>
                      <button
                        type="button"
                        onClick={() => setSlots((p) => ({ ...p, [k]: null }))}
                        style={{ flex: 1, minWidth: 90, background: '#FEE2E2', color: '#B91C1C', border: '1px solid #FCA5A5', borderRadius: 7, padding: '6px 0', fontSize: 12, fontWeight: 700, cursor: 'pointer' }}
                      >
                        Remove
                      </button>
                    </div>
                  </>
                ) : (
                  <>
                    {err ? (
                      <div style={{ fontSize: 11, color: '#B91C1C', lineHeight: 1.5 }}>{err}</div>
                    ) : (
                      <div style={{ fontSize: 11, color: 'var(--muted)' }}>Upload Excel<br />.xlsx / .xls</div>
                    )}
                    <label style={{ marginTop: 'auto' }}>
                      <span style={{ display: 'block', textAlign: 'center', background: busy === k ? '#94A3B8' : 'var(--navy, #0369A1)', color: '#fff', borderRadius: 7, padding: '8px 0', fontSize: 12, fontWeight: 700, cursor: busy === k ? 'default' : 'pointer' }}>
                        {busy === k ? 'Reading…' : err ? 'Choose another file' : 'Browse'}
                      </span>
                      <input type="file" accept=".xlsx,.xls" disabled={busy === k} style={{ display: 'none' }} onChange={(e) => void accept(m, e.target.files?.[0])} />
                    </label>
                  </>
                )}
              </div>
            );
          })}
        </div>

        <div style={{ display: 'flex', alignItems: 'center', gap: 14, marginTop: 16, flexWrap: 'wrap' }}>
          <div style={{ fontSize: 13, fontWeight: 700, color: allReady ? '#15803D' : 'var(--muted)' }}>
            {ready} / {period.months.length} Monthly Statements {allReady ? 'Ready' : 'Uploaded'}
          </div>
          <button
            type="button"
            disabled={!allReady}
            onClick={() => onGenerate(loaded)}
            style={{
              marginLeft: 'auto',
              background: allReady ? 'linear-gradient(135deg,#0284C7,#0EA5E9)' : '#94A3B8',
              color: '#fff', border: 'none', padding: '10px 22px', borderRadius: 9,
              fontWeight: 700, fontSize: 13, cursor: allReady ? 'pointer' : 'not-allowed',
            }}
          >
            Generate 3-Month PV
          </button>
        </div>
      </div>
    </div>
  );
}
