'use client';

/**
 * A date box that shows DD-MM-YYYY on every device (office, 2026-09-29).
 *
 * `<input type="date">` draws its text in the BROWSER's language, not the
 * page's: Chrome on a phone set to US English shows 09/29/2026, and no
 * attribute or CSS changes that. So the box the clerk sees is our own text,
 * `29-09-2026`, and the browser's own calendar is still what opens:
 *
 *   phone / tablet   the native date input lies invisibly over the box, so a
 *                    tap opens the phone's own date picker, exactly as before;
 *   mouse            the date can be typed (digits; the dashes come by
 *                    themselves) and the 📅 button opens the calendar
 *                    (`showPicker`).
 *
 * The value in and out is ISO `YYYY-MM-DD`, unchanged — callers, stores and
 * every calculation see exactly what the native input gave them. `min` /
 * `max` hold for typing as for the calendar.
 */
import { useEffect, useRef, useState, type CSSProperties } from 'react';
import { dmy, maskDmy, parseDmy } from '@/lib/dateFormat';

type Props = {
  /** ISO `YYYY-MM-DD`, or '' for none. */
  value: string;
  onChange: (iso: string) => void;
  min?: string;
  max?: string;
  /** Style of the visible box, as it was on the native input. */
  style?: CSSProperties;
  className?: string;
  'aria-label'?: string;
  title?: string;
  disabled?: boolean;
};

export default function DateField({ value, onChange, min, max, style, className, title, disabled, ...rest }: Props) {
  const [draft, setDraft] = useState<string | null>(null);
  const [coarse, setCoarse] = useState(false);
  const native = useRef<HTMLInputElement>(null);

  // A finger opens the phone's calendar; a mouse may type. Decided after mount.
  useEffect(() => {
    const mq = window.matchMedia?.('(pointer: coarse)');
    if (!mq) return;
    const set = () => setCoarse(mq.matches);
    set();
    mq.addEventListener?.('change', set);
    return () => mq.removeEventListener?.('change', set);
  }, []);

  const inRange = (iso: string) => (!min || iso >= min) && (!max || iso <= max);
  const typedIso = draft !== null && draft.length === 10 ? parseDmy(draft) : null;
  const invalid = draft !== null && draft !== '' && (draft.length < 10 ? false : !typedIso || !inRange(typedIso));

  const type = (raw: string) => {
    const next = maskDmy(raw);
    setDraft(next);
    if (next === '') {
      if (value !== '') onChange('');
      return;
    }
    const iso = next.length === 10 ? parseDmy(next) : null;
    if (iso && inRange(iso) && iso !== value) onChange(iso);
  };

  const openPicker = () => {
    const el = native.current;
    if (!el || disabled) return;
    try {
      el.showPicker();
    } catch {
      el.focus();
      el.click();
    }
  };

  const width = style?.width;
  const block = width === undefined || width === '100%';
  const rangeNote = min && max ? `between ${dmy(min)} and ${dmy(max)}` : max ? `not after ${dmy(max)}` : min ? `not before ${dmy(min)}` : '';

  return (
    <span className="date-field" style={{ position: 'relative', display: block ? 'block' : 'inline-block', width: block ? '100%' : width, verticalAlign: 'middle' }}>
      <input
        type="text"
        inputMode="numeric"
        autoComplete="off"
        placeholder="DD-MM-YYYY"
        maxLength={10}
        className={className}
        disabled={disabled}
        readOnly={coarse}
        aria-label={rest['aria-label']}
        aria-invalid={invalid || undefined}
        title={invalid ? `Enter a real date, DD-MM-YYYY${rangeNote ? `, ${rangeNote}` : ''}` : title}
        value={draft ?? dmy(value)}
        onFocus={(e) => {
          if (coarse) return;
          setDraft(dmy(value));
          e.currentTarget.select();
        }}
        onChange={(e) => type(e.target.value)}
        onBlur={() => setDraft(null)}
        onKeyDown={(e) => {
          if (e.key === 'Enter') e.currentTarget.blur();
          if (e.key === 'ArrowDown' && e.altKey) openPicker();
        }}
        size={10}
        style={{
          ...style,
          width: width === 'auto' ? 'auto' : '100%',
          boxSizing: 'border-box',
          paddingRight: 28,
          fontVariantNumeric: 'tabular-nums',
          ...(invalid ? { borderColor: '#DC2626', boxShadow: '0 0 0 2px rgba(220,38,38,.15)' } : null),
        }}
      />
      <button
        type="button"
        className="date-field-btn"
        tabIndex={-1}
        aria-label="Choose date"
        title="Choose date"
        disabled={disabled}
        onMouseDown={(e) => e.preventDefault()}
        onClick={openPicker}
        style={{ color: style?.color ?? 'inherit' }}
      >
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
          <rect x="3" y="4.5" width="18" height="16.5" rx="2.5" />
          <path d="M3 9.5h18M8 2.5v4M16 2.5v4" />
        </svg>
      </button>
      {/* The browser's own date input: the calendar, and on a touch screen the
          thing the tap lands on. Invisible, never the thing that is read. */}
      <input
        ref={native}
        type="date"
        tabIndex={-1}
        aria-hidden="true"
        className={coarse ? 'date-field-native is-touch' : 'date-field-native'}
        value={value}
        min={min}
        max={max}
        disabled={disabled}
        onChange={(e) => {
          const iso = e.target.value;
          if (iso === '' ? value !== '' : inRange(iso) && iso !== value) onChange(iso);
        }}
      />
    </span>
  );
}
