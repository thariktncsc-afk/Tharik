'use client';

/**
 * Full-year holiday calendar modal — React port of renderHolidayCal()
 * in src/legacy/10-holidays.js. Same colour rules: 1st/2nd Fridays amber,
 * 3rd/4th Sundays purple, government holidays red (outlined), today ringed.
 */
import { useState } from 'react';
import {
  MONTH_NAMES_FULL,
  govtHolidayName,
  isWeeklyHoliday,
  weeklyHolidayName,
  type GovtHolidayMap,
} from '@/lib/engine/holidays';

export default function HolidayCalendar({
  holidays,
  onClose,
}: {
  holidays: GovtHolidayMap | undefined;
  onClose: () => void;
}) {
  const years = Object.keys(holidays ?? {}).sort();
  const thisYear = String(new Date().getFullYear());
  const [year, setYear] = useState(years.includes(thisYear) ? thisYear : (years[0] ?? thisYear));
  const yr = Number(year);
  const govtList = holidays?.[year] ?? [];
  const today = new Date();

  return (
    <div
      style={{
        position: 'fixed',
        inset: 0,
        background: 'rgba(0,0,0,.6)',
        zIndex: 9999,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        padding: 16,
      }}
      onClick={(e) => e.target === e.currentTarget && onClose()}
    >
      <div style={{ background: '#F8FAFC', borderRadius: 16, width: 980, maxWidth: '96vw', maxHeight: '92vh', overflowY: 'auto', boxShadow: '0 20px 60px rgba(0,0,0,.4)' }}>
        <div style={{ background: '#0369A1', padding: '14px 20px', display: 'flex', alignItems: 'center', justifyContent: 'space-between', position: 'sticky', top: 0, zIndex: 2 }}>
          <div style={{ color: '#fff', fontWeight: 800, fontSize: 15 }}>🗓 Holiday Calendar</div>
          <div style={{ display: 'flex', gap: 10, alignItems: 'center' }}>
            <select
              value={year}
              onChange={(e) => setYear(e.target.value)}
              style={{ borderRadius: 8, border: 'none', padding: '6px 10px', fontSize: 13, fontWeight: 700 }}
            >
              {(years.length ? years : [thisYear]).map((y) => (
                <option key={y} value={y}>
                  {y}
                </option>
              ))}
            </select>
            <button
              onClick={onClose}
              style={{ background: 'rgba(255,255,255,.15)', color: '#fff', border: 'none', borderRadius: 8, padding: '6px 12px', fontSize: 13, fontWeight: 700, cursor: 'pointer' }}
            >
              ✕ Close
            </button>
          </div>
        </div>

        <div style={{ padding: 16 }}>
          <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap', marginBottom: 12, fontSize: 11 }}>
            <span><span style={{ display: 'inline-block', width: 12, height: 12, background: '#FED7AA', borderRadius: 3, marginRight: 4 }} />1st &amp; 2nd Friday</span>
            <span><span style={{ display: 'inline-block', width: 12, height: 12, background: '#E9D5FF', borderRadius: 3, marginRight: 4 }} />3rd &amp; 4th Sunday</span>
            <span><span style={{ display: 'inline-block', width: 12, height: 12, background: '#FEE2E2', outline: '1px solid #EF4444', borderRadius: 3, marginRight: 4 }} />Govt Holiday</span>
            <span><span style={{ display: 'inline-block', width: 12, height: 12, background: '#DBEAFE', borderRadius: '50%', marginRight: 4 }} />Today</span>
          </div>

          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill,minmax(215px,1fr))', gap: 12 }}>
            {MONTH_NAMES_FULL.map((mName, mo) => {
              const firstDay = new Date(yr, mo, 1).getDay();
              const daysInMonth = new Date(yr, mo + 1, 0).getDate();
              const cells: React.ReactNode[] = [];
              for (let e = 0; e < firstDay; e++) cells.push(<div key={`e${e}`} />);
              for (let d = 1; d <= daysInMonth; d++) {
                const date = new Date(yr, mo, d);
                const dow = date.getDay();
                const weekly = weeklyHolidayName(date);
                const govt = govtHolidayName(date, holidays);
                const isFri = weekly?.includes('Friday') ?? false;
                const isSun = weekly?.includes('Sunday') ?? false;
                const isHol = isWeeklyHoliday(date) || !!govt;

                let bg = 'transparent';
                let color = '#1A2332';
                let fw = 400;
                let radius = 4;
                let title = '';
                if (isFri) { bg = '#FED7AA'; color = '#C2410C'; fw = 700; title = weekly!; }
                else if (isSun) { bg = '#E9D5FF'; color = '#7C3AED'; fw = 700; title = weekly!; }
                else if (govt) { bg = '#FEE2E2'; color = '#B91C1C'; fw = 700; title = govt; }
                else if (dow === 0) color = '#9333EA';
                else if (dow === 6) color = '#0369A1';

                const isToday = today.getDate() === d && today.getMonth() === mo && today.getFullYear() === yr;
                if (isToday && !isHol) { bg = '#DBEAFE'; color = '#1D4ED8'; fw = 800; radius = 9; title = 'Today'; }
                else if (isToday && isHol) { fw = 900; radius = 9; }

                cells.push(
                  <div key={d} title={title} style={{ textAlign: 'center', padding: 2 }}>
                    <div
                      style={{
                        width: 18,
                        height: 18,
                        borderRadius: radius,
                        margin: '0 auto',
                        background: bg,
                        color,
                        fontSize: 9,
                        fontWeight: fw,
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'center',
                        outline: govt && !isFri && !isSun ? '1px solid #EF4444' : undefined,
                      }}
                    >
                      {d}
                    </div>
                  </div>,
                );
              }
              return (
                <div key={mName} style={{ background: '#fff', border: '1px solid var(--border)', borderRadius: 10, overflow: 'hidden' }}>
                  <div style={{ background: '#0369A1', color: '#fff', padding: '6px 10px', fontSize: 12, fontWeight: 800, textAlign: 'center' }}>
                    {mName} {yr}
                  </div>
                  <div style={{ display: 'grid', gridTemplateColumns: 'repeat(7,1fr)', gap: 1, padding: 4 }}>
                    {['Su', 'Mo', 'Tu', 'We', 'Th', 'Fr', 'Sa'].map((d, i) => (
                      <div key={d} style={{ textAlign: 'center', fontSize: 8, fontWeight: 700, color: i === 0 ? '#9333EA' : i === 6 ? '#0369A1' : '#6B7A8F', padding: '2px 0' }}>
                        {d}
                      </div>
                    ))}
                    {cells}
                  </div>
                </div>
              );
            })}
          </div>

          <div style={{ marginTop: 14 }}>
            <div style={{ fontSize: 11, fontWeight: 800, color: '#B91C1C', textTransform: 'uppercase', letterSpacing: '.05em', marginBottom: 6 }}>
              Government Holidays {year}
            </div>
            <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
              {govtList.length ? (
                govtList.map((h, i) => (
                  <span
                    key={`${h.d}-${i}`}
                    style={{ display: 'inline-flex', alignItems: 'center', background: '#FEE2E2', color: '#B91C1C', fontSize: 10, fontWeight: 600, padding: '3px 8px', borderRadius: 5, border: '1px solid #FECACA' }}
                  >
                    {new Date(h.d + 'T00:00:00').toLocaleDateString('en-IN', { day: 'numeric', month: 'short' })} — {h.name}
                  </span>
                ))
              ) : (
                <span style={{ color: 'var(--muted)', fontSize: 12 }}>No holidays defined for this year</span>
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
