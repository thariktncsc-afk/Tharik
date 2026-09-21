'use client';

/**
 * A statement shown as Excel's Ctrl+P shows it: the whole page, in proportion,
 * fitted to the space there is.
 *
 * The page itself is A4 — 210 mm across, 297 mm down — which is wider than the
 * panel it sits in. Rendered at its own size it was cut off at the right, and
 * its full height left a tall empty band below the figures. Neither is a fault
 * in the statement: it is a page being shown bigger than the window.
 *
 * So the page is SCALED to the width available, exactly as a print preview
 * does, and the space it occupies shrinks with it. Nothing about the statement
 * changes — same paper, same proportions, same margins, same figures — it is
 * simply shown whole.
 */
import { useEffect, useRef, useState } from 'react';
import { fillSheets } from '@/lib/statements/fillPage';

/** A4 at 96 dpi, which is what the sheet is laid out in. */
const PAGE = { portrait: { w: 794, h: 1123 }, landscape: { w: 1123, h: 794 } };
/** The grey surround, which is not room for the page. */
const PAD = 10;

export default function SheetPreview({ html, orientation }: { html: string; orientation: 'portrait' | 'landscape' }) {
  const box = useRef<HTMLDivElement>(null);
  const page = useRef<HTMLDivElement>(null);
  const [scale, setScale] = useState(1);
  const [height, setHeight] = useState(PAGE[orientation].h);

  useEffect(() => {
    const el = box.current;
    if (!el) return;
    const fit = () => {
      // The statements the office enlarges are sized to fill their page first,
      // so the height measured below is the height they will print at.
      if (page.current) fillSheets(page.current);
      // The panel's own padding is not room for the page.
      const available = el.clientWidth - PAD * 2;
      if (available <= 0) return;
      // Never enlarge: a page that already fits is shown at its own size, the
      // way a print preview does.
      const next = Math.min(1, available / PAGE[orientation].w);
      setScale(next);
      // The sheet is as tall as its content, not as tall as the paper, so a
      // short statement leaves no empty band below it. Measure the SHEET, not
      // the first child — the markup opens with a <style> block, which has no
      // height at all and made the panel 100 px tall.
      const drawn = page.current?.querySelector<HTMLElement>('.stmt-sheet,.tpl-sheet') ?? null;
      const contentPx = drawn?.scrollHeight || PAGE[orientation].h;
      setHeight(Math.min(PAGE[orientation].h, Math.max(contentPx, 120)) * next);
    };
    fit();
    const ro = new ResizeObserver(fit);
    ro.observe(el);
    // The statement's own markup loads its fonts and styles with it, so the
    // height is worth taking again once it has settled.
    const t = setTimeout(fit, 250);
    return () => {
      ro.disconnect();
      clearTimeout(t);
    };
  }, [html, orientation]);

  return (
    <div ref={box} style={{ background: '#E2E8F0', padding: PAD, overflow: 'hidden' }}>
      <div style={{ height, overflow: 'hidden' }}>
        <div
          ref={page}
          style={{
            width: PAGE[orientation].w,
            transform: `scale(${scale})`,
            transformOrigin: 'top left',
            background: '#fff',
            boxShadow: '0 2px 10px rgba(13,30,63,.18)',
          }}
          dangerouslySetInnerHTML={{ __html: html }}
        />
      </div>
    </div>
  );
}
