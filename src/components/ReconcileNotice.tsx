'use client';

/**
 * The month's reconciliation, where people decide from it (office, 2026-09-30):
 * the Statements page and Monthly Remittance.
 *
 * Asks /api/statements/reconcile — the statement engine's own calculation, so
 * this is the Excess the paper prints — whenever the shop / month changes and
 * whenever a save of the figures it depends on lands (the SAVED copies, not
 * what is being typed). When the Excess is negative it opens the
 * "Reconciliation Mismatch" popup once per shop-month-figure and keeps a red
 * line with "View details"; once the saved data reconciles, the line turns
 * green and no popup opens.
 */
import { useEffect, useRef, useState } from 'react';
import { appAlert } from '@/components/dialog';
import { useSavedStore } from '@/lib/dataStore';
import { inr, type Reconcile } from '@/lib/statements/reconcile';

type Answer = Reconcile & { reasons: string[]; message: string };

/** Popups already shown this page session, by shop-month and figure. */
const shown = new Set<string>();

export default function ReconcileNotice({ crsId, month, year }: { crsId: number | null; month: number; year: number }) {
  const [r, setR] = useState<Answer | null>(null);
  const ask = useRef(0);
  // A landed save of any of these moves the reconciliation.
  const deps = [useSavedStore('meRemitStore'), useSavedStore('entryStore'), useSavedStore('monthlyStore'), useSavedStore('inspectionStore'), useSavedStore('meManualStore')];

  useEffect(() => {
    if (!crsId) {
      setR(null);
      return;
    }
    const n = ++ask.current;
    const t = setTimeout(() => {
      fetch(`/api/statements/reconcile?crsId=${crsId}&month=${month}&year=${year}`)
        .then((res) => (res.ok ? res.json() : null))
        .then((body) => {
          if (n !== ask.current) return; // a later shop / month / save asked since
          const next = (body?.reconcile ?? null) as Answer | null;
          setR(next);
          if (next && next.excess < 0) {
            const key = `${crsId}:${month}:${year}:${next.excess}:${next.remit}:${next.expected}`;
            if (!shown.has(key)) {
              shown.add(key);
              void appAlert({ title: 'Reconciliation Mismatch', tone: 'warning', icon: '⚠️', message: next.message });
            }
          }
        })
        .catch(() => undefined); // never in the way of the page
    }, 250);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [crsId, month, year, ...deps]);

  if (!r || (r.expected === 0 && r.remit === 0)) return null;
  const short = r.excess < 0;
  return (
    <div className={`reconcile-note ${short ? 'is-short' : 'is-ok'}`} role={short ? 'alert' : 'status'} data-excess={r.excess}>
      {short ? (
        <>
          <span>
            ⚠ <b>Reconciliation mismatch</b> — remittance {inr(r.remit)} against the expected {inr(r.expected)}: difference <b>{inr(r.excess)}</b>.
          </span>
          <button type="button" className="reconcile-btn" onClick={() => void appAlert({ title: 'Reconciliation Mismatch', tone: 'warning', icon: '⚠️', message: r.message })}>
            View details
          </button>
        </>
      ) : (
        <span>
          ✓ <b>Reconciled</b> — remittance {inr(r.remit)} − expected {inr(r.expected)} (POS {inr(r.pos)} + TEA/SALT {inr(r.manual)} + Police {inr(r.police)} + C.Box/Poly {inr(r.pack)}) = Excess <b>{inr(r.excess)}</b>.
        </span>
      )}
    </div>
  );
}
