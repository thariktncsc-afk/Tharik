/* CRS 29 — Refugee Camp entry screens  [+]
   Added after the port; not part of TNCSC_CRS_Demo_19 (1).html, so
   tools/verify-parity.mjs skips this file (see NEW_ENGINE there).

   The camp stocks seven commodities, not twenty-one, so Daily Entry, Monthly
   Entry and Receipt show only those plus the two packing lines, its card count
   is a single figure rather than nine, and its rice sales are split between
   free and cost issue.

   HOW THE SHORT LIST IS APPLIED. The ported render, recalculate and save
   routines all reach for DSS_A / DSS_B by name from inside themselves, so
   there is no argument to override. Instead the arrays' CONTENTS are swapped
   for the duration of one call and put back in a `finally` — see
   crs29WithEntryList(). The swap therefore never outlives a single synchronous
   call, which matters because the statement builders read the same arrays: a
   statement for CRS 7 rendered while Daily Entry sits on CRS 29 still sees all
   twenty-one commodities.

   Everything here is keyed on the screen's own CRS selector, so CRS 1-28 and
   CRS 30 run the ported code untouched. */

// Kerosene is not a ported commodity; the camp needs it, so it is defined here
// and only ever appears in the camp's list.
var CRS29_KERO = {id:'KERO', ta:'மண்ணெண்ணெய்', en:'Kerosene', unit:'LTR', rate:15.60, free:false};

// Built once from the ported list so the real commodity objects (rates, units,
// Tamil names) are reused rather than re-declared.
var CRS29_ENTRY_A = (function(){
  var byId = {};
  (typeof DSS_A !== 'undefined' ? DSS_A : []).forEach(function(c){ byId[c.id] = c; });
  var order = ['BRA', 'RRA', 'SUGAR', 'WHEAT', 'TOOR', 'PALM'];
  var list = order.map(function(id){ return byId[id]; }).filter(Boolean);
  list.push(CRS29_KERO);
  // "Keep the existing Poly and C.Box fields as they are."
  ['EMPTY_BAG', 'EMPTY_BOX'].forEach(function(id){ if(byId[id]) list.push(byId[id]); });
  return list;
})();

// The camp has no police ration, so its Section B is empty.
var CRS29_ENTRY_B = [];

// Runs fn with DSS_A/DSS_B holding the camp's list, then restores them. The
// arrays are `const`, so their contents are swapped rather than the bindings.
function crs29WithEntryList(crsId, fn){
  if(!isCrs29(crsId)) return fn();
  var savedA = DSS_A.slice(), savedB = DSS_B.slice();
  function put(arr, items){ arr.length = 0; items.forEach(function(x){ arr.push(x); }); }
  put(DSS_A, CRS29_ENTRY_A);
  put(DSS_B, CRS29_ENTRY_B);
  try { return fn(); }
  finally { put(DSS_A, savedA); put(DSS_B, savedB); }
}

function crs29SelValue(id){
  var el = document.getElementById(id);
  return el ? el.value : '';
}

// ── DAILY ENTRY ─────────────────────────────────────────────────────────────
['onEntryChange', 'recalc', 'saveEntryForm', 'clearEntryForm'].forEach(function(name){
  if(typeof window[name] !== 'function') return;
  var orig = window[name];
  window[name] = function(){
    var self = this, args = arguments;
    return crs29WithEntryList(crs29SelValue('entry-crs'), function(){
      return orig.apply(self, args);
    });
  };
});

// ── MONTHLY ENTRY ───────────────────────────────────────────────────────────
['onMonthlyChange', 'recalcMe', 'saveMonthlyEntry', 'clearMonthlyForm'].forEach(function(name){
  if(typeof window[name] !== 'function') return;
  var orig = window[name];
  window[name] = function(){
    var self = this, args = arguments;
    return crs29WithEntryList(crs29SelValue('me-crs'), function(){
      return orig.apply(self, args);
    });
  };
});

// The monthly roll-up merges the day sheets into the month, so it has to see
// the same list as the screens that wrote them.
if(typeof rebuildMonthlyFromDaily === 'function'){
  var _c29OrigRebuild = rebuildMonthlyFromDaily;
  rebuildMonthlyFromDaily = function(crsId, month, year){
    var self = this, args = arguments;
    return crs29WithEntryList(crsId, function(){ return _c29OrigRebuild.apply(self, args); });
  };
}

// ── RECEIPT ─────────────────────────────────────────────────────────────────
// rpBuildTable() is what lays out the commodity rows; initReceiptPage() only
// fills the selectors around it.
if(typeof rpBuildTable === 'function'){
  var _c29OrigRpBuild = rpBuildTable;
  rpBuildTable = function(){
    var self = this, args = arguments;
    return crs29WithEntryList(crs29SelValue('rp-crs'), function(){
      return _c29OrigRpBuild.apply(self, args);
    });
  };
  // The ported page builds its rows when the form opens; changing shop has to
  // rebuild them so the camp's short list appears — and the full list returns
  // when another shop is picked.
  (function watchReceiptCrs(){
    var sel = document.getElementById('rp-crs');
    if(!sel) return;
    sel.addEventListener('change', function(){
      var form = document.getElementById('rp-form');
      if(form && form.style.display !== 'none'){ try{ rpBuildTable(); }catch(e){} }
    });
  })();
}

// ── NO GUNNY FOR KEROSENE ───────────────────────────────────────────────────
// Monthly Entry gives every commodity a gunny count beside its kilos unless it
// is on the ported NO_GUNNY list (the packing lines and the police ration).
// Kerosene is issued by the litre out of a barrel — there is no sack to count —
// but the list is a local inside renderMeSection and cannot be extended, so its
// gunny cells are turned into the same ruled dash afterwards.
//
// Dropping the inputs also keeps the figures out of the saved month:
// saveMonthlyEntry reads them with a querySelector that now finds nothing and
// falls back to 0, and the auto-fill in updateMeGunny is already null-guarded.
var CRS29_NO_GUNNY = {KERO: 1};

function crs29StripGunnyCells(){
  ['me-tbody-a', 'me-tbody-b'].forEach(function(tbodyId){
    var tb = document.getElementById(tbodyId);
    if(!tb) return;
    Object.keys(CRS29_NO_GUNNY).forEach(function(id){
      var tr = tb.querySelector('tr[data-id="' + id + '"]');
      if(!tr) return;
      Array.prototype.forEach.call(tr.querySelectorAll('input[data-field^="gunny_"]'), function(inp){
        var td = inp.parentElement;
        if(!td || td.tagName !== 'TD') return;
        td.innerHTML = '—';
        td.style.cssText = 'padding:3px 4px;text-align:center;font-size:10px;color:#D1D5DB;' +
          'border-bottom:1px solid #EFF6FF;border-right:1px solid #E2E8F0;background:#FAFAFA';
      });
    });
  });
}

if(typeof onMonthlyChange === 'function'){
  var _c29OrigMonthlyGunny = onMonthlyChange;
  onMonthlyChange = function(){
    var r = _c29OrigMonthlyGunny.apply(this, arguments);
    try{ crs29StripGunnyCells(); }catch(e){}
    return r;
  };
}

// ── CARD DETAILS ────────────────────────────────────────────────────────────
// One figure for the camp instead of nine categories. buildMeCardTable (in
// 22-allotment.js) reads ME_CARD_TYPES, so the same contents-swap is used.
var CRS29_CARD_TYPES = [{id:'total', label:'TOTAL CARDS'}];

if(typeof buildMeCardTable === 'function'){
  var _c29OrigBuildCards = buildMeCardTable;
  buildMeCardTable = function(){
    var self = this, args = arguments;
    if(!isCrs29(crs29SelValue('me-crs'))) return _c29OrigBuildCards.apply(self, args);
    var saved = ME_CARD_TYPES.slice();
    ME_CARD_TYPES.length = 0;
    CRS29_CARD_TYPES.forEach(function(t){ ME_CARD_TYPES.push(t); });
    try { return _c29OrigBuildCards.apply(self, args); }
    finally { ME_CARD_TYPES.length = 0; saved.forEach(function(t){ ME_CARD_TYPES.push(t); }); }
  };
}

// The statement's card module counts through ME_CARD_TYPES, which does not
// carry the camp's single row, so its total is read back here.
var _c29OrigStmtGetDataCards = stmtGetData;
stmtGetData = function(crsId, month, year){
  var d = _c29OrigStmtGetDataCards.apply(this, arguments);
  try{
    if(isCrs29(crsId)){
      var rec = (typeof meCardStore !== 'undefined')
        ? meCardStore[crsId + '_' + month + '_' + year] : null;
      var total = (rec && rec.total) ? (parseInt(rec.total.count, 10) || 0) : 0;
      d.cards = {total: total, byId: {total: total},
                 list: [{id:'total', label:'TOTAL CARDS', count: total, remarks:''}],
                 hasData: total > 0};
    }
  }catch(e){}
  return d;
};

// ── FREE / COST RICE ────────────────────────────────────────────────────────
// The camp reports its BRA sales split between free issue and cost issue. The
// two always add up to the day's BRA sales, so only one has to be typed and
// the other follows; typing in either box recalculates the other.
// {crsId_date: {free:Number, cost:Number}}
var crs29RiceSplit = {};

function crs29SplitKey(){
  var crsId = crs29SelValue('entry-crs'), date = crs29SelValue('entry-date');
  return (crsId && date) ? crsId + '_' + date : null;
}
function crs29BraSales(){
  var inp = document.querySelector('#et-tbody-a tr[data-id="BRA"] [data-field="sales"]');
  return inp ? (parseFloat(inp.value) || 0) : 0;
}

// `edited` is the box the operator typed in; the other one takes the remainder.
// Which box was typed is remembered, so when the BRA sales figure later changes
// the SAME half is held and the other re-derived — otherwise reopening a sheet
// would silently reassign the split.
function crs29RiceCalc(edited){
  var key = crs29SplitKey();
  if(!key) return;
  var fEl = document.getElementById('c29-free-rice');
  var cEl = document.getElementById('c29-cost-rice');
  if(!fEl || !cEl) return;

  var total = crs29BraSales();
  var typed = parseFloat(edited === 'cost' ? cEl.value : fEl.value);
  if(isNaN(typed) || typed < 0) typed = 0;
  if(typed > total) typed = total;                    // neither half can exceed the day's sales
  var other = Math.max(0, total - typed);

  if(edited === 'cost'){ cEl.value = typed.toFixed(3); fEl.value = other.toFixed(3); }
  else                 { fEl.value = typed.toFixed(3); cEl.value = other.toFixed(3); }

  crs29RiceSplit[key] = {free: parseFloat(fEl.value) || 0,
                         cost: parseFloat(cEl.value) || 0,
                         typed: edited};
  crs29RicePaint();
}

function crs29RicePaint(){
  var box = document.getElementById('c29-rice-total');
  if(!box) return;
  var total = crs29BraSales();
  var fEl = document.getElementById('c29-free-rice');
  var cEl = document.getElementById('c29-cost-rice');
  var sum = (parseFloat(fEl && fEl.value) || 0) + (parseFloat(cEl && cEl.value) || 0);
  var ok = Math.abs(sum - total) < 0.001;
  box.innerHTML = 'BRA sales <strong>' + total.toFixed(3) + ' KG</strong> · split ' +
    '<strong style="color:' + (ok ? '#15803D' : '#DC2626') + '">' + sum.toFixed(3) + ' KG</strong>' +
    (ok ? '' : ' — the two must add up to the day’s BRA sales');
}

// Built from script rather than markup: it belongs to one shop, so the ported
// Daily Entry page is left alone.
function crs29EnsureRicePanel(){
  var host = document.getElementById('et-tbody-a');
  if(!host) return null;
  var card = host.closest('.card') || host.closest('div[style*="border-radius"]') || host.parentElement;
  var panel = document.getElementById('c29-rice-panel');
  if(!panel){
    panel = document.createElement('div');
    panel.id = 'c29-rice-panel';
    panel.style.cssText = 'display:none;margin:14px 0;border:1px solid #FDE68A;border-radius:10px;overflow:hidden';
    panel.innerHTML =
      '<div style="background:linear-gradient(135deg,#B45309,#F59E0B);padding:9px 14px">' +
        '<div style="color:#fff;font-weight:800;font-size:12px">🍚 BRA Rice — Free / Cost split</div>' +
        '<div style="color:rgba(255,255,255,.75);font-size:10px;margin-top:1px">' +
          'Enter either one; the other is worked out so the two always total the day’s BRA sales.</div>' +
      '</div>' +
      '<div style="padding:12px 14px;background:#FFFBEB">' +
        '<div style="display:grid;grid-template-columns:1fr 1fr;gap:14px">' +
          '<div><label style="display:block;font-size:11px;font-weight:700;margin-bottom:5px">Free Rice (KG)</label>' +
            '<input type="number" min="0" step="0.001" placeholder="0.000" id="c29-free-rice"' +
            ' oninput="crs29RiceCalc(\'free\')"' +
            ' style="width:100%;border:2px solid #FDE68A;border-radius:8px;padding:8px 11px;font-size:13px;' +
                   'font-weight:800;text-align:right;color:#15803D;background:#fff"/></div>' +
          '<div><label style="display:block;font-size:11px;font-weight:700;margin-bottom:5px">Cost Rice (KG)</label>' +
            '<input type="number" min="0" step="0.001" placeholder="0.000" id="c29-cost-rice"' +
            ' oninput="crs29RiceCalc(\'cost\')"' +
            ' style="width:100%;border:2px solid #FDE68A;border-radius:8px;padding:8px 11px;font-size:13px;' +
                   'font-weight:800;text-align:right;color:#B45309;background:#fff"/></div>' +
        '</div>' +
        '<div id="c29-rice-total" style="margin-top:9px;font-size:11px;color:var(--muted)"></div>' +
      '</div>';
    // Directly under the commodity grid, above the totals and actions.
    var grid = host.closest('table');
    var anchor = grid ? (grid.closest('div') || grid).parentElement : card;
    (anchor || card).appendChild(panel);
  }
  return panel;
}

// Show it for the camp, hide it everywhere else, and reload the day's split.
function crs29RiceSync(){
  var panel = crs29EnsureRicePanel();
  if(!panel) return;
  if(!isCrs29(crs29SelValue('entry-crs'))){ panel.style.display = 'none'; return; }
  panel.style.display = 'block';

  var key = crs29SplitKey();
  var saved = key ? crs29RiceSplit[key] : null;
  var fEl = document.getElementById('c29-free-rice');
  var cEl = document.getElementById('c29-cost-rice');
  if(!fEl || !cEl) return;

  if(saved){
    fEl.value = Number(saved.free || 0).toFixed(3);
    cEl.value = Number(saved.cost || 0).toFixed(3);
  } else {
    // Nothing split yet: the whole day's BRA sale is free issue.
    var total = crs29BraSales();
    fEl.value = total ? total.toFixed(3) : '';
    cEl.value = total ? '0.000' : '';
  }
  crs29RicePaint();
}

// Re-derives the half the operator did not type after the BRA sales figure
// changes. Driven by the remembered box rather than by whatever is on screen.
function crs29RiceReapply(){
  var key = crs29SplitKey();
  if(!key) return;
  var saved = crs29RiceSplit[key];
  var fEl = document.getElementById('c29-free-rice');
  var cEl = document.getElementById('c29-cost-rice');
  if(!fEl || !cEl) return;
  if(!saved){ crs29RiceSync(); return; }
  var held = saved.typed === 'cost' ? 'cost' : 'free';
  if(held === 'cost') cEl.value = Number(saved.cost || 0).toFixed(3);
  else                fEl.value = Number(saved.free || 0).toFixed(3);
  crs29RiceCalc(held);
}

// The panel follows the sheet: opening another day reloads its split, and
// editing the BRA sales figure re-derives the half the operator did not type.
['onEntryChange', 'recalc'].forEach(function(name){
  var orig = window[name];
  if(typeof orig !== 'function') return;
  window[name] = function(){
    var r = orig.apply(this, arguments);
    try{
      if(name === 'onEntryChange') crs29RiceSync();
      else if(isCrs29(crs29SelValue('entry-crs'))){
        var cEl = document.getElementById('c29-cost-rice');
        var fEl = document.getElementById('c29-free-rice');
        // Not while a split box has focus — that is crs29RiceCalc's own job.
        if(fEl && cEl && document.activeElement !== fEl && document.activeElement !== cEl){
          crs29RiceReapply();
        }
      }
    }catch(e){}
    return r;
  };
});

// The split travels with the day sheet.
if(typeof saveEntryForm === 'function'){
  var _c29OrigSaveEntry = saveEntryForm;
  saveEntryForm = function(){
    var r = _c29OrigSaveEntry.apply(this, arguments);
    try{
      var key = crs29SplitKey();
      if(key && isCrs29(crs29SelValue('entry-crs')) && entryStore[key] && crs29RiceSplit[key]){
        entryStore[key].riceSplit = {free: crs29RiceSplit[key].free, cost: crs29RiceSplit[key].cost};
      }
    }catch(e){}
    return r;
  };
}

if(typeof BACKUP_STORES !== 'undefined'){
  BACKUP_STORES.push({key:'crs29RiceSplit', kind:'object', label:'CRS 29 rice split'});
}
