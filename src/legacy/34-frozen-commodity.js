/* Frozen Commodity column on phones — Daily Entry & Monthly Entry  [+]
   Added after the port; not part of TNCSC_CRS_Demo_19 (1).html, so
   tools/verify-parity.mjs skips this file (see NEW_ENGINE there).

   These two grids are 13 and 18 columns wide. On a phone the commodity name
   scrolls off as soon as you reach the entry fields, so you are typing into an
   unlabelled row. The commodity cell is now pinned to the left edge while the
   rest of the row scrolls under it.

   WHY THIS IS TAGGED IN JS RATHER THAN SELECTED IN CSS. `position:sticky` has
   to go on the cells themselves, and nth-child cannot find them:

     - Monthly Entry has no <thead>; its two header <tr>s are direct children
       of <table>, so the browser wraps them in an implicit tbody separate from
       #me-tbody-a.
     - Its first header row uses colspan=2 groups (Opening, Receipt, Total,
       Sales, Closing) and rowspan=2 cells (#, Commodity, Unit, ...), so the
       second header row's first cell is grid column 3, not 0.
     - Both grids' <tfoot> opens with a colspan (3 on Monthly, 4 on Daily), so
       footer cell N is not grid column N either.

   So the cell holding a given COLUMN is found by walking the real table grid —
   the standard occupancy-matrix walk below, which is what the browser itself
   does — and tagged with a class. Getting this wrong in a data-entry grid
   means someone types Sales into Opening, so it is resolved structurally
   rather than by counting cells.

   Desktop is untouched: the class is inert until the <=900px media query in
   responsive.css picks it up. */

var FRZ_COMMODITY_COL = 1;   // grid column of the commodity name in both grids
var FRZ_TBODIES = ['et-tbody-a', 'et-tbody-b', 'me-tbody-a', 'me-tbody-b'];

/* Walks the table's real grid, honouring colspan AND rowspan, and tags the
   cell occupying FRZ_COMMODITY_COL in every row — header, body and footer. A
   cell that merely SPANS the column (the footer's "Section A Total") is tagged
   too, so the pinned strip has no gaps. */
function frzTagTable(table) {
  if (!table) return;
  var occupied = {};   // rowIndex -> {gridCol: true}
  var rows = table.rows;

  for (var r = 0; r < rows.length; r++) {
    var col = 0;
    var cells = rows[r].cells;
    for (var c = 0; c < cells.length; c++) {
      var cell = cells[c];
      // Skip grid columns already claimed by a rowspan from an earlier row.
      while (occupied[r] && occupied[r][col]) col++;

      var cs = cell.colSpan || 1;
      var rs = cell.rowSpan || 1;
      for (var rr = r; rr < r + rs; rr++) {
        if (!occupied[rr]) occupied[rr] = {};
        for (var cc = col; cc < col + cs; cc++) occupied[rr][cc] = true;
      }

      var covers = col <= FRZ_COMMODITY_COL && (col + cs) > FRZ_COMMODITY_COL;
      cell.classList.toggle('frz-comm', covers);
      col += cs;
    }
  }
  table.classList.add('frz-table');
}

function frzApply() {
  FRZ_TBODIES.forEach(function (id) {
    var tb = document.getElementById(id);
    if (tb) frzTagTable(tb.closest('table'));
  });
}

/* The bodies are re-rendered whenever the shop, date or month changes, which
   drops the tags with the old rows. Observing the tbodies re-tags on every
   render without having to find and wrap each renderer. */
function frzObserve() {
  if (typeof MutationObserver === 'undefined') return;
  FRZ_TBODIES.forEach(function (id) {
    var tb = document.getElementById(id);
    if (!tb || tb.dataset.frzObserved) return;
    tb.dataset.frzObserved = '1';
    new MutationObserver(function () {
      var t = tb.closest('table');
      if (t) frzTagTable(t);
    }).observe(tb, { childList: true });
  });
}

function frzInit() {
  frzApply();
  frzObserve();
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', frzInit);
} else {
  frzInit();
}
// The grids are painted by React after the engine runs, so a first pass on
// load can land before they exist; re-run once the app shell has rendered.
setTimeout(frzInit, 0);
setTimeout(frzInit, 400);
