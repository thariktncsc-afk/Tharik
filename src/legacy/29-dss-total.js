/* DSS statement — quantity columns left blank on the total rows  [+]
   Added after the port; not part of TNCSC_CRS_Demo_19 (1).html, so
   tools/verify-parity.mjs skips this file (see NEW_ENGINE there).

   The official DSS form totals money only. The ported builders fill the whole
   total row — opening, receipt, total, sales and closing as well as the amount
   — on both the main section (row 25) and the police section (row 7), in the
   on-screen sheet and in the Excel export. Those five cells are left blank so
   the generated report matches the printed form; the ₹ symbol and the section
   amount stay.

   This is not a CRS 29 rule: it applies to every shop.

   Both builders are ported, so neither is edited. The preview is corrected on
   the rendered DOM, and the workbook on its way to XLSX.writeFile — the write
   is the only seam, since the cell-writing helper is a local inside the export
   and cannot be reached from here. Both find the total rows by their Tamil
   label rather than by a fixed address, so a change of layout cannot silently
   blank the wrong cells. */

var DSS_TOTAL_LABEL = 'மொத்தம்';

// ── ON-SCREEN SHEET ─────────────────────────────────────────────────────────
// A total row is `<tr class="tot">`: cell 0 is the serial, cell 1 the label,
// the last two carry ₹ and the amount (class "rt"). Everything between is a
// quantity total and is emptied.
function dssBlankTotalQuantities(root){
  if(!root) return;
  Array.prototype.forEach.call(root.querySelectorAll('tr.tot'), function(tr){
    Array.prototype.forEach.call(tr.children, function(td, i){
      if(i < 2) return;                                   // serial + label
      if(/\brt\b/.test(td.className || '')) return;        // ₹ and the amount
      td.textContent = '';
    });
  });
}

if(typeof openDSSPreview === 'function'){
  var _dssOrigPreview = openDSSPreview;
  openDSSPreview = function(){
    var r = _dssOrigPreview.apply(this, arguments);
    try{ dssBlankTotalQuantities(document.getElementById('dss-viewer')); }catch(e){}
    return r;
  };
}

// ── EXCEL EXPORT ────────────────────────────────────────────────────────────
// Clears the quantity cells of every total row on one worksheet. The row is
// found by the label in column C, and the cells cleared are the five between
// it and the ₹ column (D..H).
function dssBlankSheetTotals(ws){
  if(!ws) return;
  Object.keys(ws).forEach(function(addr){
    if(addr[0] === '!') return;
    if(addr.charAt(0) !== 'C') return;
    var cell = ws[addr];
    if(!cell || String(cell.v).trim() !== DSS_TOTAL_LABEL) return;
    var row = addr.slice(1);
    ['D', 'E', 'F', 'G', 'H'].forEach(function(col){
      var target = ws[col + row];
      if(target) target.v = '';
      if(target) target.t = 's';
    });
  });
}

// The workbook is built and written inside ensureXLSX's callback, which is
// asynchronous the first time the library loads, so the patch is installed
// around the callback rather than around the export call.
if(typeof downloadDSSExcel === 'function' && typeof ensureXLSX === 'function'){
  var _dssOrigExcel = downloadDSSExcel;
  downloadDSSExcel = function(){
    var self = this, args = arguments;
    var origEnsure = ensureXLSX;
    ensureXLSX = function(cb){
      return origEnsure(function(){
        var XL = window.XLSX;
        if(!XL || typeof XL.writeFile !== 'function') return cb();
        var origWrite = XL.writeFile;
        XL.writeFile = function(wb){
          try{
            (wb && wb.SheetNames ? wb.SheetNames : []).forEach(function(n){
              dssBlankSheetTotals(wb.Sheets[n]);
            });
          }catch(e){}
          return origWrite.apply(this, arguments);
        };
        try { return cb(); }
        finally { XL.writeFile = origWrite; }
      });
    };
    try { return _dssOrigExcel.apply(self, args); }
    finally { ensureXLSX = origEnsure; }
  };
}
