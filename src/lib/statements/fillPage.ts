/**
 * Enlarge a statement to fill its page — CRS Police and RBI, the two sheets
 * the office prints above 100% (pageSetup.ts `fillsPage`).
 *
 * The scale is worked out from the statement itself, not copied from the
 * workbook's 145% / 120%. Those percentages were set for the office's own
 * grid; our Police statement is drawn at a different size (680 px across,
 * 10 px type), so 145% of it would either fall short of the page or run off
 * it. What the office wants is the effect — the statement filling the paper —
 * so that is what is computed: as large as it can be while still fitting the
 * printable width AND height.
 *
 * CSS `zoom` rather than `transform: scale()`: zoom changes the size the
 * statement takes up, so the printed page lays it out at its enlarged size and
 * a page break cannot fall through the middle of it. A transform only paints
 * it bigger, over whatever comes next.
 *
 * Self-contained on purpose — no imports, nothing from outside the function —
 * because the print window runs it from its source text
 * (`FILL_SCRIPT`), where there is no bundle to reach into.
 */
export function fillSheets(root: ParentNode): void {
  const boxes = root.querySelectorAll<HTMLElement>('.stmt-fill');
  boxes.forEach((box) => {
    const w = Number(box.getAttribute('data-fill-w'));
    const h = Number(box.getAttribute('data-fill-h'));
    // The statement's own markup opens with its <style> block, which has no
    // size at all — measure the first thing that is actually drawn.
    let content: HTMLElement | null = null;
    for (let i = 0; i < box.children.length; i++) {
      const el = box.children[i] as HTMLElement;
      if (el.tagName !== 'STYLE' && el.tagName !== 'SCRIPT') {
        content = el;
        break;
      }
    }
    if (!w || !h || !content) return;
    // The statement's main table — the one with the most rows — is what a
    // stretch grows. Put back to its own height before anything is measured.
    let table: HTMLTableElement | null = null;
    const tables = content.querySelectorAll('table');
    for (let i = 0; i < tables.length; i++) {
      if (!table || tables[i].rows.length > table.rows.length) table = tables[i];
    }
    if (table) table.style.height = '';
    // Measure at natural size: a zoom left from an earlier pass would be
    // measured as the statement's own size.
    box.style.zoom = '1';
    content.style.width = '';
    // A GROWING sheet (pageSetup.ts growsToPage — CRS Page 2, B6) cannot be
    // enlarged by zooming alone (Page 2 is already as wide as the paper). Lay
    // it out narrower — at the width that, zoomed back out to the page's
    // width, fills the page's height; the zoom makes rows and padding taller
    // with the type, and any height left goes into its rows — and back off
    // while any cell would clip its text at that width.
    if (box.getAttribute('data-fill-grow')) {
      const h0 = content.offsetHeight;
      let g = h0 ? Math.min(1.8, Math.max(1, (h * 0.97) / h0)) : 1;
      for (let i = 0; i < 40 && g > 1; i++) {
        content.style.width = Math.floor(w / g) + 'px';
        let clipped = false;
        const cells = content.querySelectorAll<HTMLElement>('th,td');
        for (let k = 0; k < cells.length && !clipped; k++) if (cells[k].scrollWidth > cells[k].clientWidth + 1) clipped = true;
        // Taller than the page at this size (a heading wrapped): smaller too.
        if (!clipped && content.offsetHeight * g <= h * 0.985) break;
        g = Math.max(1, g * 0.97);
      }
      if (g <= 1) content.style.width = '';
    }
    const cw = content.offsetWidth;
    const ch = content.offsetHeight;
    if (!cw || !ch) return;
    // As big as the page allows in both directions, with a hair to spare so
    // rounding in the printer's driver cannot push a line onto page two.
    const z = Math.max(1, Math.round(Math.min(w / cw, h / ch) * 0.985 * 1000) / 1000);
    // Only ever enlarge: a statement that already fills its page is left be.
    box.style.zoom = String(z);
    // A stretched statement takes whatever height is left on the page into
    // its table's rows — taller lines, same type, same widths. A table set
    // taller than its rows shares the extra between them.
    if (box.getAttribute('data-fill-stretch') && table) {
      const spare = (h * 0.97) / z - ch;
      if (spare > 4) table.style.height = `${table.offsetHeight + spare}px`;
    }
  });
}

/** The same function, as a script the print window can run on its own. */
export const FILL_SCRIPT = `(${fillSheets.toString()})(document);`;
