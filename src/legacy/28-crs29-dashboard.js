/* CRS 29 — dashboard, reports and the police section  [+]
   Added after the port; not part of TNCSC_CRS_Demo_19 (1).html, so
   tools/verify-parity.mjs skips this file (see NEW_ENGINE there).

   Three things the camp needs beyond its entry screens and statements:

     · no police section anywhere — the Section B blocks and their totals are
       taken off Daily Entry and Monthly Entry, and the reports drop the police
       rows;
     · a Closing Stock widget listing only the seven commodities it stocks;
     · every dashboard figure counted from those seven alone.

   The seven are the ration commodities only. The Poly and C.Box lines are kept
   on the entry screens, as asked, but they are counts of packing rather than
   stock, so they are not on the Closing Stock widget and do not feed the
   dashboard's kilo totals.

   HOW IT IS SCOPED. Same contents-swap as 27-crs29-entry.js: DSS_A / DSS_B are
   swapped for the length of one call and restored in a `finally`, so nothing
   another shop reads is ever affected. The dashboard is keyed on the signed-in
   user's shop, the reports on the report screen's own selector. */

// The seven the camp stocks — CRS29_ENTRY_A without the two packing lines.
var CRS29_STOCK = (typeof CRS29_ENTRY_A !== 'undefined')
  ? CRS29_ENTRY_A.filter(function(c){ return c.id !== 'EMPTY_BAG' && c.id !== 'EMPTY_BOX'; })
  : [];
var CRS29_STOCK_IDS = {};
CRS29_STOCK.forEach(function(c){ CRS29_STOCK_IDS[c.id] = 1; });

// Runs fn with the commodity lists cut down to the camp's seven and no police.
function crs29WithStockList(crsId, fn){
  if(!isCrs29(crsId)) return fn();
  var savedA = DSS_A.slice(), savedB = DSS_B.slice();
  function put(arr, items){ arr.length = 0; items.forEach(function(x){ arr.push(x); }); }
  put(DSS_A, CRS29_STOCK);
  put(DSS_B, []);
  try { return fn(); }
  finally { put(DSS_A, savedA); put(DSS_B, savedB); }
}

// The day-bar totals add up whatever the day sheet holds rather than walking a
// commodity list, so for the camp the sheets are presented through a filtered
// view: anything outside `keepIds` is hidden for the length of the call and the
// real records put straight back.
//
// `keepIds` differs by caller on purpose. The dashboard counts the seven
// stocked commodities, because its headline figure is a weight and Poly/C.Box
// are counts of packing. A report has to keep them: they are paid lines
// (₹2.50 and ₹0.60), they were explicitly retained on the camp's entry screen,
// and dropping them would leave the report's money short of the remittance it
// is reconciled against. Neither ever keeps a removed commodity or the police
// side.
function crs29WithStockEntries(crsId, keepIds, fn){
  if(!isCrs29(crsId) || typeof entryStore === 'undefined') return fn();
  var prefix = String(parseInt(crsId, 10)) + '_';
  var touched = [];
  Object.keys(entryStore).forEach(function(k){
    if(k.indexOf(prefix) !== 0) return;
    var e = entryStore[k];
    if(!e) return;
    touched.push({key:k, a:e.a, b:e.b});
    var fa = {};
    Object.keys(e.a || {}).forEach(function(id){ if(keepIds[id]) fa[id] = e.a[id]; });
    e.a = fa;
    e.b = {};
  });
  try { return fn(); }
  finally {
    touched.forEach(function(t){
      if(entryStore[t.key]){ entryStore[t.key].a = t.a; entryStore[t.key].b = t.b; }
    });
  }
}

// Everything the camp keys — the seven plus the two packing lines.
var CRS29_KEPT_IDS = {};
(typeof CRS29_ENTRY_A !== 'undefined' ? CRS29_ENTRY_A : []).forEach(function(c){ CRS29_KEPT_IDS[c.id] = 1; });

// Both together, for anything on the dashboard.
function crs29WithDashboardScope(fn){
  var crsId = (typeof currentUser !== 'undefined' && currentUser) ? currentUser.crsId : null;
  return crs29WithStockList(crsId, function(){
    return crs29WithStockEntries(crsId, CRS29_STOCK_IDS, fn);
  });
}

// ── DASHBOARD ───────────────────────────────────────────────────────────────
// buildClosingList and buildCommodityBreakdown walk the commodity lists;
// buildDashDayBars walks the day sheets. All three are covered by the scope.
['buildDashboard', 'refreshDashboard', 'buildClosingList',
 'buildCommodityBreakdown', 'buildDashDayBars'].forEach(function(name){
  if(typeof window[name] !== 'function') return;
  var orig = window[name];
  window[name] = function(){
    var self = this, args = arguments;
    return crs29WithDashboardScope(function(){ return orig.apply(self, args); });
  };
});

// ── REPORTS ─────────────────────────────────────────────────────────────────
// Only when one shop is selected and it is the camp; a combined report across
// shops still needs every commodity.
function crs29ReportCrs(){
  var el = document.getElementById('rpt-crs');
  return (el && el.value) ? parseInt(el.value, 10) : NaN;
}
// A report over EVERY shop still covers the camp, and KERO is not a ported
// commodity, so the ported name/unit lookup would fall back to the raw id in
// KG — the same litres then read differently depending on which report you
// opened. Lending the record to the list for the length of the call fixes the
// label without narrowing anything.
function crs29WithKeroKnown(crsId, fn){
  if(!isNaN(crsId) || typeof CRS29_KERO === 'undefined') return fn();
  if(DSS_A.indexOf(CRS29_KERO) !== -1) return fn();
  DSS_A.push(CRS29_KERO);
  try { return fn(); }
  finally { var i = DSS_A.indexOf(CRS29_KERO); if(i !== -1) DSS_A.splice(i, 1); }
}

['generateReport', 'printPVStatement'].forEach(function(name){
  if(typeof window[name] !== 'function') return;
  var orig = window[name];
  window[name] = function(){
    var self = this, args = arguments;
    var crsId = crs29ReportCrs();
    return crs29WithKeroKnown(crsId, function(){
      return crs29WithStockList(crsId, function(){
        // Keeps Poly and C.Box: they are paid lines the remittance includes.
        return crs29WithStockEntries(crsId, CRS29_KEPT_IDS, function(){
          return orig.apply(self, args);
        });
      });
    });
  };
});

// ── OTHER PRINTED OUTPUT ────────────────────────────────────────────────────
// Two more buttons build a sheet straight from DSS_A / DSS_B, on the very
// screens whose police block is hidden: "Generate Monthly Statement" on Monthly
// Entry, and the DSS preview / Excel export on Daily Entry. Without these the
// camp's own screens would still print the full 21 commodities and a police
// table.
function crs29WithSheetScope(selectorId, fn){
  var crsId = crs29SelValue(selectorId);
  return crs29WithEntryList(crsId, function(){
    return crs29WithStockEntries(crsId, CRS29_KEPT_IDS, fn);
  });
}

// Emptying DSS_B removes the police COMMODITIES but not the heading the ported
// builders print above them unconditionally, so the leftover banner (and, on
// the DSS sheet, its padded blank rows and zero total) is taken off the
// rendered output afterwards.
function crs29StripPoliceHeading(root){
  if(!root) return;
  // Monthly statement: buildStmtTbl wraps each section in a div whose first
  // child is the coloured title bar.
  Array.prototype.forEach.call(root.querySelectorAll('div'), function(el){
    if(el.children.length) return;
    if(!/Police Ration|காவலர்/.test(el.textContent || '')) return;
    var wrap = el.parentElement;
    if(wrap && wrap !== root) wrap.remove(); else el.remove();
  });
  // DSS sheet: a section row, the rows padded after it, and the section total.
  Array.prototype.forEach.call(root.querySelectorAll('tr'), function(tr){
    if(!/காவலர்/.test(tr.textContent || '')) return;
    var el = tr.nextElementSibling;
    tr.remove();
    while(el){
      var next = el.nextElementSibling;
      var isTotal = /\btot\b/.test(el.className || '');
      el.remove();
      if(isTotal) break;
      el = next;
    }
  });
}

if(typeof generateMonthlyStatement === 'function'){
  var _c29OrigMonthlyStmt = generateMonthlyStatement;
  generateMonthlyStatement = function(){
    var self = this, args = arguments;
    var camp = isCrs29(crs29SelValue('me-crs'));
    var r = crs29WithSheetScope('me-crs', function(){ return _c29OrigMonthlyStmt.apply(self, args); });
    if(camp) try{ crs29StripPoliceHeading(document.getElementById('me-stmt-content')); }catch(e){}
    return r;
  };
}

if(typeof openDSSPreview === 'function'){
  var _c29OrigDssPreview = openDSSPreview;
  openDSSPreview = function(){
    var self = this, args = arguments;
    var camp = isCrs29(crs29SelValue('entry-crs'));
    var r = crs29WithSheetScope('entry-crs', function(){ return _c29OrigDssPreview.apply(self, args); });
    if(camp){
      try{
        crs29StripPoliceHeading(document.getElementById('dss-viewer') ||
                                document.getElementById('dss-content'));
      }catch(e){}
    }
    return r;
  };
}

// The Excel export builds its sheets inside ensureXLSX's callback, which is
// asynchronous the first time the library loads — a plain wrapper would restore
// the lists before the sheet is built. The scope is put around the callback
// instead.
if(typeof downloadDSSExcel === 'function' && typeof ensureXLSX === 'function'){
  var _c29OrigDssExcel = downloadDSSExcel;
  downloadDSSExcel = function(){
    var self = this, args = arguments;
    if(!isCrs29(crs29SelValue('entry-crs'))) return _c29OrigDssExcel.apply(self, args);
    var origEnsure = ensureXLSX;
    ensureXLSX = function(cb){
      return origEnsure(function(){
        return crs29WithSheetScope('entry-crs', cb);
      });
    };
    try { return _c29OrigDssExcel.apply(self, args); }
    finally { ensureXLSX = origEnsure; }
  };
}

// ── POLICE SECTION ──────────────────────────────────────────────────────────
// The Section B blocks carry no id of their own, so each is found from its
// tbody: the nearest ancestor that also holds the "SECTION B" badge is the
// block to hide. The summary tile beside the Section A / Grand Total figures is
// found the same way, by its label.
// Matched on the badge SPAN whose text is exactly "SECTION B", not on any
// text containing it: the table's own footer cell reads "Section B Total", so
// a loose test stops at the <table> and leaves the police banner above it
// on screen.
function crs29SectionBlock(tbodyId){
  var tb = document.getElementById(tbodyId);
  if(!tb) return null;
  var el = tb.parentElement;
  while(el && el !== document.body){
    var hasBadge = Array.prototype.some.call(el.querySelectorAll('span'), function(s){
      return (s.textContent || '').trim() === 'SECTION B';
    });
    if(hasBadge && el.querySelector('#' + tbodyId)) return el;
    el = el.parentElement;
  }
  return null;
}

function crs29SummaryTile(pageId){
  var page = document.getElementById(pageId);
  if(!page) return null;
  var found = null;
  Array.prototype.forEach.call(page.querySelectorAll('div'), function(el){
    if(found) return;
    if(el.children.length === 0 && (el.textContent || '').trim() === 'Section B'){
      found = el.parentElement;
    }
  });
  return found;
}

// Hides or restores the police block on one screen. The original display value
// is remembered so restoring never invents one.
function crs29ToggleBlock(el, show){
  if(!el) return;
  if(show){
    if(el.dataset.c29Hidden === '1'){
      el.style.display = el.dataset.c29Display || '';
      delete el.dataset.c29Hidden;
      delete el.dataset.c29Display;
    }
  } else if(el.dataset.c29Hidden !== '1'){
    el.dataset.c29Display = el.style.display || '';
    el.dataset.c29Hidden = '1';
    el.style.display = 'none';
  }
}

// The 1px rule in front of the tile goes with it, or the summary row shows two
// dividers with nothing between them.
function crs29SummarySep(tile){
  if(!tile) return null;
  var sib = tile.previousElementSibling;
  return (sib && /width:\s*1px/.test(sib.getAttribute('style') || '')) ? sib : null;
}

function crs29ApplyPoliceVisibility(){
  var showEntry   = !isCrs29(crs29SelValue('entry-crs'));
  var showMonthly = !isCrs29(crs29SelValue('me-crs'));
  crs29ToggleBlock(crs29SectionBlock('et-tbody-b'), showEntry);
  var entryTile = crs29SummaryTile('page-entry');
  crs29ToggleBlock(entryTile, showEntry);
  crs29ToggleBlock(crs29SummarySep(entryTile), showEntry);
  crs29ToggleBlock(crs29SectionBlock('me-tbody-b'), showMonthly);
  var monthlyTile = crs29SummaryTile('page-monthly');
  crs29ToggleBlock(monthlyTile, showMonthly);
  crs29ToggleBlock(crs29SummarySep(monthlyTile), showMonthly);
}

['onEntryChange', 'onMonthlyChange'].forEach(function(name){
  if(typeof window[name] !== 'function') return;
  var orig = window[name];
  window[name] = function(){
    var r = orig.apply(this, arguments);
    try{ crs29ApplyPoliceVisibility(); }catch(e){}
    return r;
  };
});

// Monthly Entry paints its tables from a timeout, so re-apply after it lands.
if(typeof buildMeCardTable === 'function'){
  var _c29dashOrigCards = buildMeCardTable;
  buildMeCardTable = function(){
    var r = _c29dashOrigCards.apply(this, arguments);
    try{ crs29ApplyPoliceVisibility(); }catch(e){}
    return r;
  };
}

(function initCrs29Dashboard(){
  try{ crs29ApplyPoliceVisibility(); }catch(e){}
})();
