/**
 * Fit the PV sheet to its page (office, 2026-10-06).
 *
 * The PV printed small: a fixed 8.5 px table on a Legal page, shrunk again by
 * an A4 printer, with wide margins and blank space round it. This scales the
 * WHOLE sheet to the printable box of the chosen paper (A4 or Legal,
 * landscape, 6 mm margins — pvStatement.ts):
 *
 *   1. the table is laid out NARROWER than the box, at width W / s, then the
 *      sheet is zoomed by s — so it is exactly the box's width, and type,
 *      padding, row height and borders all grow by the same factor;
 *   2. s is the largest that keeps the sheet inside the box's HEIGHT and
 *      leaves every cell wide enough for its text (a figure is never cut);
 *   3. height still left goes into the commodity rows' padding (capped), so
 *      the signatures sit near the foot of the page without blank bands.
 *
 * Plain DOM, no React: it runs after the sheet is rendered, on a change of
 * paper, and again just before printing. The print is the same DOM at the
 * same CSS size (mm are 96 dpi px in print too), so preview = print = PDF.
 */

const PX_PER_MM = 96 / 25.4;
/** Kept spare below the box: a line that would tip onto a second page. */
const SAFETY = 0.975;
/** The most a commodity row's padding may grow, each side (px, before zoom). */
const MAX_XPAD = 6;

export type PvFit = { scale: number; xpad: number; widthMm: number; heightMm: number };

/** Every cell whose text is wider than the cell. */
function clipped(tbl: HTMLElement): boolean {
  for (const td of Array.from(tbl.querySelectorAll('td'))) {
    if (td.scrollWidth > td.clientWidth && td.textContent?.trim()) return true;
  }
  return false;
}

export function fitPvSheet(root: ParentNode | null | undefined): PvFit | null {
  const paper = root?.querySelector<HTMLElement>('.pv-paper');
  const fit = paper?.querySelector<HTMLElement>('.pv-fit');
  const tbl = fit?.querySelector<HTMLElement>('#pv-tbl');
  if (!paper || !fit || !tbl) return null;
  const W = Number(paper.dataset.pw) * PX_PER_MM;
  const H = Number(paper.dataset.ph) * PX_PER_MM * SAFETY;
  if (!(W > 0 && H > 0)) return null;

  // From scratch every time: a change of paper or data must not inherit the last fit.
  (fit.style as CSSStyleDeclaration & { zoom: string }).zoom = '1';
  tbl.style.setProperty('--pv-xpad', '0px');
  tbl.style.width = '';
  // Not laid out (a hidden tab): nothing to measure — leave it for the next call.
  if (!tbl.offsetHeight) return null;

  const at = (s: number) => {
    tbl.style.width = `${W / s}px`;
    const h = tbl.offsetHeight;
    return { h, ok: h * s <= H && !clipped(tbl) };
  };

  // The largest scale that fits: step down from generous, then narrow it in.
  let hi = 3;
  let s = hi;
  let r = at(s);
  while (!r.ok && s > 0.4) {
    hi = s;
    s *= 0.92;
    r = at(s);
  }
  if (!r.ok) {
    // Nothing fits (cannot happen with the office's columns): print at 1.
    s = 1;
    r = at(1);
  } else {
    let lo = s;
    for (let i = 0; i < 7; i++) {
      const mid = (lo + hi) / 2;
      if (at(mid).ok) lo = mid;
      else hi = mid;
    }
    // Paper sets text a hair wider than the screen does: 2 % in hand, so a
    // cell that just fits on screen is not cut on the printed page.
    s = lo * 0.98;
    r = at(s);
  }

  // Height left over → the commodity rows, a little each.
  let xpad = 0;
  const rows = tbl.querySelectorAll('tbody tr').length;
  const spare = H / s - r.h;
  if (rows && spare > 1) {
    xpad = Math.min(MAX_XPAD, spare / rows / 2);
    for (let i = 0; i < 8; i++) {
      tbl.style.setProperty('--pv-xpad', `${xpad}px`);
      if (tbl.offsetHeight * s <= H) break;
      xpad *= 0.8;
    }
    if (tbl.offsetHeight * s > H) {
      xpad = 0;
      tbl.style.setProperty('--pv-xpad', '0px');
    }
  }

  (fit.style as CSSStyleDeclaration & { zoom: string }).zoom = String(s);
  return { scale: s, xpad, widthMm: (tbl.offsetWidth * s) / PX_PER_MM, heightMm: (tbl.offsetHeight * s) / PX_PER_MM };
}
