'use client';

/**
 * A number box for Card Details & Allotment (office, 2026-09-28).
 *
 * The boxes were plain controlled `type="number"` inputs, and four things
 * went wrong while a clerk typed:
 *  - the shown value was the STORED one reformatted on every keystroke
 *    (`String(parseInt(…))`), so "0" + "1" became "01", was rewritten to "1"
 *    under the caret, and the caret jumped; typing before the 0 gave 10;
 *  - Chrome changes a focused number box on the MOUSE WHEEL, so scrolling
 *    the page with the pointer near the box moved Sugar Card 0 → 1 → 0 on its
 *    own (the recording);
 *  - Enter did nothing;
 *  - the 0 already in a box was not selected, so digits were added to it.
 *
 * Here, while the box has focus it shows exactly what was typed (`draft`) and
 * never rewrites it; every change still goes straight to `onValue`, so the
 * store — and Total Card — follow as before, and the caller's own parsing
 * (setCount / setAllot / setAdvance) is unchanged. On leaving, the box shows
 * the stored value again. Focusing selects the contents, so typing replaces
 * them. The wheel scrolls the page instead of stepping the value. Enter moves
 * to the next box DOWN the same column. ↑ / ↓ and the spinner keep the
 * browser's own stepping, within the box's min and step.
 */
import { useEffect, useRef, useState } from 'react';

type Props = {
  value: string;
  onValue: (raw: string) => void;
  /** Boxes that share a column: Enter moves between them, top to bottom. */
  column: string;
  step: number;
  min?: number;
  placeholder?: string;
  title?: string;
  'aria-label'?: string;
  style?: React.CSSProperties;
};

/** The element that actually scrolls — #content in the app shell, else the page. */
function scroller(el: HTMLElement): Element | null {
  for (let p = el.parentElement; p; p = p.parentElement) {
    const oy = getComputedStyle(p).overflowY;
    if ((oy === 'auto' || oy === 'scroll') && p.scrollHeight > p.clientHeight) return p;
  }
  return document.scrollingElement;
}

export default function NumInput({ value, onValue, column, step, min = 0, ...rest }: Props) {
  const ref = useRef<HTMLInputElement>(null);
  const [draft, setDraft] = useState<string | null>(null);

  // A wheel turn over the focused box scrolls the page; it never changes the
  // figure. Non-passive, so the browser's own stepping can be cancelled.
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const onWheel = (e: WheelEvent) => {
      if (document.activeElement !== el) return;
      e.preventDefault();
      scroller(el)?.scrollBy({ top: e.deltaY, left: e.deltaX });
    };
    el.addEventListener('wheel', onWheel, { passive: false });
    return () => el.removeEventListener('wheel', onWheel);
  }, []);

  return (
    <input
      {...rest}
      ref={ref}
      type="number"
      inputMode={step < 1 ? 'decimal' : 'numeric'}
      enterKeyHint="next"
      min={min}
      step={step}
      data-num-col={column}
      value={draft ?? value}
      onFocus={(e) => {
        setDraft(value);
        e.currentTarget.select();
      }}
      onBlur={() => setDraft(null)}
      onChange={(e) => {
        setDraft(e.target.value);
        onValue(e.target.value);
      }}
      onKeyDown={(e) => {
        if (e.key !== 'Enter') return;
        e.preventDefault();
        const all = Array.from(document.querySelectorAll<HTMLInputElement>(`input[data-num-col="${column}"]`));
        const next = all[all.indexOf(e.currentTarget) + 1];
        if (next) next.focus();
        else e.currentTarget.blur(); // the last row: the figure is kept, and the box shows it tidied
      }}
    />
  );
}
