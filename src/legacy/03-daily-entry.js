/* Daily Sales Entry grid, auto-opening, sales close
   Verbatim from TNCSC_CRS_Demo_19 (1).html lines 1888-2746.
   These parts are concatenated back into one classic script by
   tools/bundle-engine.mjs - the code hoists across the whole block and
   its declarations must stay global for the markup's inline handlers. */
var DSS_A = [
  {id:'BRA',       ta:'புழுங்கல் அரிசி',        en:'BRA Rice',             unit:'KG',  rate:0,     free:true},
  {id:'NPHH_FRK',  ta:'NPHH FRK அரிசி',       en:'NPHH FRK Rice',        unit:'KG',  rate:0,     free:true},
  {id:'PHH_FRK',   ta:'PHH FRK அரிசி',        en:'PHH FRK Rice',         unit:'KG',  rate:0,     free:true},
  {id:'PHH_BRA',   ta:'PHH BRA அரிசி',        en:'PHH BRA Rice',         unit:'KG',  rate:0,     free:true},
  {id:'AAY_FRK',   ta:'AAY FRK அரிசி',        en:'AAY FRK Rice',         unit:'KG',  rate:0,     free:true},
  {id:'AAY',       ta:'AAY அரிசி',             en:'AAY Rice',             unit:'KG',  rate:0,     free:true},
  {id:'RRA',       ta:'பச்சை அரிசி (RRA)',        en:'RRA Rice',             unit:'KG',  rate:0,     free:true},
  {id:'NPHH_RRA',  ta:'NPHH FRK RRA அரிசி',   en:'NPHH FRK RRA Rice',    unit:'KG',  rate:0,     free:true},
  {id:'OAP',       ta:'OAP அரிசி',             en:'OAP Rice',             unit:'KG',  rate:0,     free:true},
  {id:'APS',       ta:'APS அரிசி',             en:'APS Rice',             unit:'KG',  rate:0,     free:true},
  {id:'WHEAT',     ta:'கோதுமை',                en:'Wheat',                unit:'KG',  rate:0,     free:true},
  {id:'SUGAR',     ta:'சீனி',                    en:'Sugar',                 unit:'KG',  rate:25.00, free:false},
  {id:'AAY_SUGAR', ta:'AAY சீனி',              en:'Sugar (AAY)',           unit:'KG',  rate:13.50, free:false},
  {id:'TOOR',      ta:'துவரம் பருப்பு',        en:'Toor Dal',             unit:'KG',  rate:30.00, free:false},
  {id:'PALM',      ta:'பாம் ஆயில்',            en:'Palm Oil',             unit:'LTR', rate:25.00, free:false},
  {id:'SALT_CIS',  ta:'உப்பு (CIS)',            en:'Salt (CIS)',            unit:'PKT', rate:12.00, free:false},
  {id:'SALT_RFFS', ta:'உப்பு (RFFS)',           en:'Salt (RFFS)',           unit:'PKT', rate:12.00, free:false},
  {id:'OOTY',      ta:'OOTY',                   en:'OOTY',                 unit:'PKT', rate:25.00, free:false},
  {id:'TAN',       ta:'TAN',                    en:'TAN',                  unit:'PKT', rate:25.00, free:false},
  {id:'EMPTY_BOX', ta:'காலி அட்டை+பெட்டி',    en:'Empty Card+Box',       unit:'NOS', rate:0.60,  free:false},
  {id:'EMPTY_BAG', ta:'காலி பாலித்தீன் பை',    en:'Empty Polythene Bag',  unit:'NOS', rate:2.50,  free:false},
];

// Section B commodities — Police Ration Card
var DSS_B = [
  {id:'PB_BRA',   ta:'புழுங்கல் அரிசி',   en:'BRA Rice (Police)',   unit:'KG',  rate:0,     free:true},
  {id:'PB_SUGAR', ta:'சீனி',            en:'Sugar (Police)',       unit:'KG',  rate:12.50, free:false},
  {id:'PB_WHEAT', ta:'கோதுமை',          en:'Wheat (Police)',       unit:'KG',  rate:0,     free:true},
  {id:'PB_TOOR',  ta:'துவரம் பருப்பு', en:'Toor Dal (Police)',    unit:'KG',  rate:15.00, free:false},
  {id:'PB_PALM',  ta:'பாம் ஆயில்',      en:'Palm Oil (Police)',    unit:'LTR', rate:12.50, free:false},
];

// In-memory store: entryStore['crsId_date'] = {a:{id:vals}, b:{id:vals}}
var entryStore = {};

// Inspection adjustments, declared up front so Daily Entry, Monthly Entry and
// the Statement sections all share one store:
//   inspectionStore['crsId_YYYY-MM-DD'] = {a:{commId:{excess,shortage,transfer}}, b:{...}}
var inspectionStore = {};

// ── INIT CRS DROPDOWN ──────────────────────────────────────────────────────
(function(){
  var sel = document.getElementById('entry-crs');
  if(!sel) return;
  // If CRS user: show only their shop. Admin: show all 30.
  var list = (currentUser && currentUser.crsId)
    ? CRS_LIST.filter(function(c){ return c.id === currentUser.crsId; })
    : CRS_LIST;
  list.forEach(function(c){
    var opt = document.createElement('option');
    opt.value = String(c.id);
    opt.textContent = 'CRS ' + c.id + ' — ' + c.name;
    sel.appendChild(opt);
  });
  var today = new Date().toISOString().split('T')[0];
  var dEl = document.getElementById('entry-date');
  if(dEl){ dEl.value = today; dEl.max = today; }
})();

// ═══ OPENING STOCK AUTO-FILL + KEYBOARD NAV + ENTRY IMPROVEMENTS ════════════

// Get previous day's date string
function prevDayStr(dateStr){
  var parts = dateStr.split('-');
  var d = new Date(parseInt(parts[0]), parseInt(parts[1])-1, parseInt(parts[2]));
  d.setDate(d.getDate()-1);
  return d.getFullYear()+'-'+String(d.getMonth()+1).padStart(2,'0')+'-'+String(d.getDate()).padStart(2,'0');
}

// Get previous month's last day date string
function prevMonthLastDayStr(dateStr){
  var parts = dateStr.split('-');
  var d = new Date(parseInt(parts[0]), parseInt(parts[1])-1, 1); // first of current month
  d.setDate(d.getDate()-1); // last day of prev month
  return d.getFullYear()+'-'+String(d.getMonth()+1).padStart(2,'0')+'-'+String(d.getDate()).padStart(2,'0');
}

// Check if date is first day of month
function isFirstOfMonth(dateStr){
  return dateStr.split('-')[2] === '01';
}

// Get opening stock for a commodity from previous day's closing
function getAutoOpening(crsId, dateStr, commId, sec){
  // Try previous day first
  var prevDate = prevDayStr(dateStr);
  var prevKey  = crsId + '_' + prevDate;
  var prevData = entryStore[prevKey];
  if(prevData && prevData[sec] && prevData[sec][commId] !== undefined){
    var closing = parseFloat(prevData[sec][commId].close) || 0;
    return closing;
  }
  // If first of month and no prev day, try last day of prev month
  if(isFirstOfMonth(dateStr)){
    var prevMonthDate = prevMonthLastDayStr(dateStr);
    var pmKey  = crsId + '_' + prevMonthDate;
    var pmData = entryStore[pmKey];
    if(pmData && pmData[sec] && pmData[sec][commId] !== undefined){
      return parseFloat(pmData[sec][commId].close) || 0;
    }
    // Try scanning backwards up to 31 days in prev month for last entry
    var d = new Date(prevMonthDate+'T00:00:00');
    for(var i=0; i<31; i++){
      var scanKey = crsId+'_'+d.getFullYear()+'-'+String(d.getMonth()+1).padStart(2,'0')+'-'+String(d.getDate()).padStart(2,'0');
      if(entryStore[scanKey] && entryStore[scanKey][sec] && entryStore[scanKey][sec][commId]!==undefined){
        return parseFloat(entryStore[scanKey][sec][commId].close)||0;
      }
      d.setDate(d.getDate()-1);
      if(d.getMonth() !== new Date(prevMonthDate+'T00:00:00').getMonth()) break;
    }
  }
  return null; // null means: allow manual entry (no previous data)
}

// Editable fields in tab/enter order (skip readonly: total, close, amount)
// ── [S1] BAG DIVISORS — ONE SOURCE OF TRUTH ─────────────────────────────────
// kgs/pkts -> bag, poly or c.box counts. Previously this table was copy-pasted
// into five closures and hardcoded as a bare "/ 50" in nine more places, so a
// rate change had to be made in fourteen spots. Everything now reads BAG_DIV
// through bagDiv(); the receipt page keeps its own packingRules table because
// it also drives the switchable GUNNY/POLY badges.
var BAG_DIV = {PALM:10, SALT_CIS:25, SALT_RFFS:25, OOTY:50, TAN:50, PB_PALM:10};
var BAG_DIV_DEFAULT = 50;
function bagDiv(id){ return BAG_DIV[id] || BAG_DIV_DEFAULT; }
// kgs -> whole bags for commodity `id` (never negative, never fractional)
function bagsOf(kgs, id){
  var v = parseFloat(kgs) || 0;
  return v > 0 ? Math.floor(v / bagDiv(id)) : 0;
}

var EDITABLE_FIELDS = ['open','receipt','sales'];

// Build a flat list of all editable inputs in the entry form in order
function getEditableInputs(){
  var inputs = [];
  ['et-tbody-a','et-tbody-b'].forEach(function(tbId){
    var tbody = document.getElementById(tbId);
    if(!tbody) return;
    tbody.querySelectorAll('tr').forEach(function(tr){
      EDITABLE_FIELDS.forEach(function(field){
        var inp = tr.querySelector('[data-field="'+field+'"]');
        if(inp && !inp.readOnly) inputs.push(inp);
      });
    });
  });
  return inputs;
}

// ── Generic 2D grid navigation for entry tables ────────────────────────────
// Enter / ↓ : same column (data-field), next row — skips rows where that
//             field is missing or read-only, and continues from Section A
//             into Section B (and back up).
// ↑         : same column, previous row.
// → / ←     : next / previous editable input within the row, wrapping to the
//             first input of the next row / last input of the previous row.
// preventDefault is always applied for these keys so number-input spinners
// don't increment values at the grid edges.
function gridNav(e, inp, tbodyIds){
  var KEYS = ['Enter','ArrowDown','ArrowUp','ArrowLeft','ArrowRight'];
  if(KEYS.indexOf(e.key) === -1) return;
  e.preventDefault();

  // Row list across all listed tbodies (Section A then Section B)
  var rows = [];
  tbodyIds.forEach(function(id){
    var tb = document.getElementById(id);
    if(tb) rows = rows.concat(Array.from(tb.querySelectorAll('tr[data-id]')));
  });
  var tr = inp.closest('tr');
  var ri = rows.indexOf(tr);
  if(ri === -1) return;

  function editables(row){ return Array.from(row.querySelectorAll('input:not([readonly])')); }
  var next = null;

  if(e.key === 'Enter' || e.key === 'ArrowDown' || e.key === 'ArrowUp'){
    var dir = (e.key === 'ArrowUp') ? -1 : 1;
    var field = inp.dataset.field;
    for(var r = ri + dir; r >= 0 && r < rows.length; r += dir){
      var cand = rows[r].querySelector('input[data-field="'+field+'"]:not([readonly])');
      if(cand){ next = cand; break; }
    }
  } else if(e.key === 'ArrowRight'){
    var eds = editables(tr), ci = eds.indexOf(inp);
    if(ci < eds.length - 1) next = eds[ci+1];
    else for(var r2 = ri + 1; r2 < rows.length; r2++){
      var e2 = editables(rows[r2]);
      if(e2.length){ next = e2[0]; break; }
    }
  } else if(e.key === 'ArrowLeft'){
    var eds3 = editables(tr), ci3 = eds3.indexOf(inp);
    if(ci3 > 0) next = eds3[ci3-1];
    else for(var r3 = ri - 1; r3 >= 0; r3--){
      var e3 = editables(rows[r3]);
      if(e3.length){ next = e3[e3.length-1]; break; }
    }
  }

  if(next){ next.focus(); next.select && next.select(); }
}

// Keyboard handler for Daily Entry inputs
function entryKeyDown(e, inp){
  gridNav(e, inp, ['et-tbody-a','et-tbody-b']);
}

// Input validation: allow only positive numbers
function entryInputValidate(e, inp){
  // Remove non-numeric except decimal point
  setTimeout(function(){
    var v = parseFloat(inp.value);
    if(isNaN(v)||v<0){ inp.value=''; }
  }, 0);
}

// ── SELECTION CHANGE ───────────────────────────────────────────────────────
function onEntryChange(){
  // Always keep entry-date max = today so user can't pick future dates
  var todayStr = new Date().toISOString().split('T')[0];
  var dEl   = document.getElementById('entry-date');
  if(dEl){
    dEl.max = todayStr;
    // If no date set yet, default to today
    if(!dEl.value) dEl.value = todayStr;
  }
  var crsId = document.getElementById('entry-crs').value;
  var date  = dEl ? dEl.value : '';
  var empty = document.getElementById('entry-empty');
  var wrap  = document.getElementById('entry-form-wrap');
  var badge = document.getElementById('entry-date-badge');

  if(!crsId || !date){
    if(empty) empty.style.display = 'block';
    if(wrap)  wrap.style.display  = 'none';
    if(badge) badge.style.display = 'none';
    return;
  }

  // Date badge
  if(badge) badge.style.display = 'block';
  var d = new Date(date + 'T00:00:00');
  var days = ['Sunday','Monday','Tuesday','Wednesday','Thursday','Friday','Saturday'];
  var mths = ['January','February','March','April','May','June',
              'July','August','September','October','November','December'];
  var lbl = document.getElementById('entry-date-label');
  if(lbl){
    var isFirst3 = isFirstOfMonth(date);
    lbl.innerHTML = days[d.getDay()] + ', ' + d.getDate() + ' ' + mths[d.getMonth()] + ' ' + d.getFullYear() +
      (isFirst3 ? ' <span style="background:#DCFCE7;color:#15803D;font-size:9px;font-weight:700;padding:1px 6px;border-radius:4px;margin-left:4px">MONTH START</span>' : '');
  }

  if(empty) empty.style.display = 'none';
  if(wrap)  wrap.style.display  = 'block';

  // Header
  var crs = CRS_LIST.find(function(c){ return String(c.id)===crsId; });
  var tEl = document.getElementById('ef-title');
  var sEl = document.getElementById('ef-sub');
  if(tEl && crs) tEl.textContent = 'CRS ' + crs.id + ' — ' + crs.name;
  if(sEl){
    var dStr = d.toLocaleDateString('en-IN',{weekday:'long',day:'numeric',month:'long',year:'numeric'});
    var prevD = prevDayStr(date);
    var prevKey2 = crsId+'_'+prevD;
    var hasPrevEntry = !!(entryStore[prevKey2]);
    var isFirst2 = isFirstOfMonth(date);
    if(!isFirst2 && hasPrevEntry){
      sEl.innerHTML = dStr + ' <span style="background:rgba(255,255,255,.15);color:#fff;font-size:10px;padding:2px 7px;border-radius:4px;margin-left:6px">Opening auto-filled from '+prevD+'</span>';
    } else if(isFirst2){
      sEl.innerHTML = dStr + ' <span style="background:rgba(220,252,231,.2);color:#86EFAC;font-size:10px;padding:2px 7px;border-radius:4px;margin-left:6px">Month start — enter opening stock</span>';
    } else {
      sEl.textContent = dStr;
    }
  }

  // Duplicate check
  var key = crsId + '_' + date;
  var dup = document.getElementById('entry-dup-warn');
  if(dup) dup.style.display = entryStore[key] ? 'flex' : 'none';

  // Success hide
  var succ = document.getElementById('entry-success');
  if(succ) succ.style.display = 'none';

  // Render both sections
  renderSection('et-tbody-a', DSS_A, 'a', crsId, date);
  renderSection('et-tbody-b', DSS_B, 'b', crsId, date);
  applyAdjColVisibility(['et-tbody-a','et-tbody-b'], ['et-a-foot','et-b-foot'],
                        inspFlagsForDate(crsId, date));
  entryUpdateInspBanner(crsId, date);
  recalc();

  // Hide success banner
  var succEl2=document.getElementById('entry-success');
  if(succEl2) succEl2.style.display='none';

  // Restore saved remittance details for this date
  var remitKey2 = crsId + '_' + date;
  var savedEntry2 = entryStore[remitKey2];
  var ramtEl = document.getElementById('entry-remit-amount');
  var rdEl   = document.getElementById('entry-remit-date');
  if(ramtEl) ramtEl.value = (savedEntry2 && savedEntry2.remitAmount) ? savedEntry2.remitAmount.toFixed(2) : '';
  if(rdEl)   rdEl.value   = (savedEntry2 && savedEntry2.remitDate)   ? savedEntry2.remitDate : new Date().toISOString().split('T')[0];
  entryShowRemitNote();

  // Auto-focus first editable input
  setTimeout(function(){
    var allInps=getEditableInputs();
    for(var fi=0;fi<allInps.length;fi++){
      if(!allInps[fi].readOnly){allInps[fi].focus();allInps[fi].select();break;}
    }
  }, 80);
  entryUpdateSalesCloseBadge();
}

// ── INSPECTION ADJUSTMENTS — shared lookup ────────────────────────────────
// The Inspection modal writes into inspectionStore as
//   inspectionStore[crsId_YYYY-MM-DD][sec][commodityId] = {excess, shortage, transfer}
// Daily Entry reads one date; Monthly Entry sums every date in the month.
function inspAdjForDate(crsId, date, sec, commId){
  var out = {excess:0, shortage:0, transfer:0};
  if(typeof inspectionStore === 'undefined' || !date) return out;
  var rec = inspectionStore[crsId + '_' + date] || inspectionStore[String(crsId) + '_' + date];
  if(!rec || !rec[sec] || !rec[sec][commId]) return out;
  var r = rec[sec][commId];
  out.excess   = parseFloat(r.excess)   || 0;
  out.shortage = parseFloat(r.shortage) || 0;
  out.transfer = parseFloat(r.transfer) || 0;
  return out;
}

function inspAdjForMonth(crsId, month, year, sec, commId){
  var out = {excess:0, shortage:0, transfer:0};
  if(typeof inspectionStore === 'undefined') return out;
  var n = new Date(year, month, 0).getDate();
  for(var day = 1; day <= n; day++){
    var ds = year + '-' + String(month).padStart(2,'0') + '-' + String(day).padStart(2,'0');
    var a  = inspAdjForDate(crsId, ds, sec, commId);
    out.excess += a.excess; out.shortage += a.shortage; out.transfer += a.transfer;
  }
  return out;
}

// ── [C1] TRANSFER SIGN — ONE SOURCE OF TRUTH ────────────────────────────────
// The Inspection "Transfer" column used to mean OUT (deducted) in the nine
// Daily/Monthly/Statement formula sites and IN (added) in the four DSS sites,
// so the same day's stock reconciled two different ways. Both now go through
// inspNet(). Flip this one flag to change the convention everywhere.
//   true  -> a positive Transfer moves stock OUT of the shop (deducted)
//   false -> a positive Transfer moves stock IN  to the shop (added)
var TRANSFER_IS_OUTWARD = true;

// Signed stock effect of a Transfer entry, honouring the flag above.
function transferDelta(t){
  var v = parseFloat(t) || 0;
  return TRANSFER_IS_OUTWARD ? -v : v;
}

// Net stock effect of the adjustments: excess adds, shortage removes,
// transfer follows TRANSFER_IS_OUTWARD.
function inspNet(adj){
  adj = adj || {};
  return (parseFloat(adj.excess) || 0)
       - (parseFloat(adj.shortage) || 0)
       + transferDelta(adj.transfer);
}

// Read the adjustments cached on a rendered row
function inspFromRow(tr){
  if(!tr) return {excess:0, shortage:0, transfer:0};
  return {
    excess:   parseFloat(tr.dataset.excess)   || 0,
    shortage: parseFloat(tr.dataset.shortage) || 0,
    transfer: parseFloat(tr.dataset.transfer) || 0
  };
}

// One read-only adjustment cell (badge). Zero renders as a muted dash.
function inspCell(val, kind, bdr){
  var THEME = {
    excess:   {bg:'#DCFCE7', fg:'#166534', bd:'#86EFAC', sign:'+'},
    shortage: {bg:'#FEE2E2', fg:'#B91C1C', bd:'#FCA5A5', sign:'\u2212'},
    transfer: {bg:'#FEF3C7', fg:'#92400E', bd:'#FDE047', sign:'\u2192'}
  };
  var t = THEME[kind];
  var inner = val
    ? '<span style="display:inline-block;background:' + t.bg + ';border:1px solid ' + t.bd +
      ';color:' + t.fg + ';font-size:11px;font-weight:800;padding:3px 7px;border-radius:5px;min-width:38px">' +
      t.sign + (+Number(val).toFixed(3)) + '</span>'
    : '<span style="color:#CBD5E1;font-size:11px">\u2014</span>';
  return '<td data-adjcol="' + kind + '" style="padding:4px 3px;text-align:center;border-bottom:' + bdr + '">' + inner + '</td>';
}

// ── Which adjustment columns actually carry a value? ──────────────────────
// A column is shown only when at least one commodity has a non-zero figure
// for the day (Daily Entry) or the month (Monthly Entry); otherwise the whole
// column — header and cells — is hidden so the grid stays uncluttered.
function inspFlagsFromRecord(rec){
  var f = {excess:false, shortage:false, transfer:false};
  if(!rec) return f;
  ['a','b'].forEach(function(sec){
    var blk = rec[sec] || {};
    Object.keys(blk).forEach(function(id){
      var r = blk[id] || {};
      ['excess','shortage','transfer'].forEach(function(k){
        if((parseFloat(r[k]) || 0) !== 0) f[k] = true;
      });
    });
  });
  return f;
}

function inspFlagsForDate(crsId, date){
  if(typeof inspectionStore === 'undefined' || !date) return {excess:false, shortage:false, transfer:false};
  return inspFlagsFromRecord(inspectionStore[crsId + '_' + date]);
}

function inspFlagsForMonth(crsId, month, year){
  var f = {excess:false, shortage:false, transfer:false};
  if(typeof inspectionStore === 'undefined') return f;
  var n = new Date(year, month, 0).getDate();
  for(var day = 1; day <= n; day++){
    var ds = year + '-' + String(month).padStart(2,'0') + '-' + String(day).padStart(2,'0');
    var g  = inspFlagsFromRecord(inspectionStore[crsId + '_' + ds]);
    f.excess   = f.excess   || g.excess;
    f.shortage = f.shortage || g.shortage;
    f.transfer = f.transfer || g.transfer;
  }
  return f;
}

// Show/hide the three columns across the given tables and fix the footer span.
function applyAdjColVisibility(tbodyIds, footIds, flags){
  var KINDS = ['excess','shortage','transfer'];
  tbodyIds.forEach(function(tbId){
    var tbody = document.getElementById(tbId);
    if(!tbody) return;
    var table = tbody.closest ? tbody.closest('table') : null;
    if(!table) return;
    KINDS.forEach(function(k){
      var show = !!flags[k];
      table.querySelectorAll('[data-adjcol="' + k + '"]').forEach(function(cell){
        cell.style.display = show ? '' : 'none';
      });
    });
  });
  // Footer adjustment cells carry data-adjcol too, so they hide with the
  // column automatically — the label colspan stays fixed.
}

// ── RENDER SECTION ─────────────────────────────────────────────────────────
function renderSection(tbodyId, comms, sec, crsId, date){
  var tbody = document.getElementById(tbodyId);
  if(!tbody) return;
  var key   = crsId + '_' + date;
  var saved = entryStore[key] ? entryStore[key][sec] : null;
  tbody.innerHTML = '';

  comms.forEach(function(c, i){
    var sv    = saved && saved[c.id] ? saved[c.id] : {};
    var bg    = (i%2===0) ? '#fff' : '#FAFCFF';
    var secA  = sec === 'a';
    var bdr   = secA ? '1px solid #EFF6FF' : '1px solid #FFF7ED';
    var rateHtml = c.free
      ? '<span style="color:#16A34A;font-weight:600;font-size:10px">Free</span>'
      : '<span style="font-size:12px;font-weight:600">₹' + c.rate.toFixed(2) + '</span>';

    function inp(field, extraStyle, readOnly, val){
      var v = val !== undefined ? val : (sv[field] !== undefined ? sv[field] : '');
      var ro = readOnly ? ' readonly' : '';
      var bg2 = readOnly ? 'background:#F8FAFC;color:var(--muted);' : '';
      var amt = (field==='amount') ? 'background:#EFF6FF;color:#0369A1;font-weight:700;' : '';
      if(sec==='b' && field==='amount') amt = 'background:#FFF3E8;color:#C2410C;font-weight:700;';
      if(field==='total') amt = 'background:#EFF6FF;color:#0284C7;font-weight:700;';
      return '<input type="number" min="0" step="0.001"' + ro +
        ' placeholder="0.000" value="' + (v!==''?Number(v).toFixed(3):'') + '"' +
        ' data-id="' + c.id + '" data-sec="' + sec + '" data-field="' + field + '"' +
        (readOnly ? '' : ' onchange="onFieldChange(this)" onkeydown="entryKeyDown(event,this)" oninput="entryInputValidate(event,this)"') +
        ' style="width:100%;border:1px solid #E2E8F0;border-radius:6px;padding:5px 7px;font-size:12px;text-align:right;' +
        bg2 + amt + (extraStyle||'') + '"/>';
    }

    var amtCell = c.free
      ? '<div style="text-align:center;padding:6px 4px;font-size:11px;color:#16A34A;font-style:italic">விலையில்லா</div>'
      : inp('amount','',true, c.free ? '' : (sv.amount !== undefined ? sv.amount : ''));

    // Inspection adjustments for this CRS + date + commodity
    var adj = inspAdjForDate(crsId, date, sec, c.id);

    var tr = document.createElement('tr');
    tr.style.background = bg;
    tr.dataset.id  = c.id;
    tr.dataset.sec = sec;
    tr.dataset.rate= c.rate;
    tr.dataset.free= c.free ? '1' : '0';
    tr.dataset.excess   = String(adj.excess);
    tr.dataset.shortage = String(adj.shortage);
    tr.dataset.transfer = String(adj.transfer);
    tr.innerHTML = [
      '<td style="padding:8px;text-align:center;font-size:11px;color:var(--muted);border-bottom:' + bdr + '">' + (i+1) + '</td>',
      '<td style="padding:8px 12px;border-bottom:' + bdr + '">',
        '<div style="font-weight:600;font-size:12px">' + c.ta + '</div>',
        '<div style="font-size:10px;color:var(--muted)">' + c.en + '</div>',
      '</td>',
      '<td style="padding:8px;text-align:center;font-size:11px;color:var(--muted);border-bottom:' + bdr + '">' + c.unit + '</td>',
      '<td style="padding:8px;text-align:center;border-bottom:' + bdr + '">' + rateHtml + '</td>',
      (function(){
        // Auto-fill opening from prev day's closing
        var autoOpen = getAutoOpening(crsId, date, c.id, sec);
        var openReadonly = (autoOpen !== null && !sv.open); // readonly if auto-filled and not manually overridden
        if(autoOpen !== null && sv.open === undefined){
          sv.open = autoOpen; // set it in saved values for rendering
        }
        var openStyle = openReadonly ? 'background:#FEF3C7;color:#92400E;font-weight:700;' : '';
        return '<td style="padding:4px 5px;border-bottom:' + bdr + '">' + inp('open', openStyle, openReadonly) + '</td>';
      })() +
      '<td style="padding:4px 5px;border-bottom:' + bdr + '">' + inp('receipt') + '</td>',
      inspCell(adj.excess,  'excess',   bdr),
      inspCell(adj.shortage,'shortage', bdr),
      inspCell(adj.transfer,'transfer', bdr),
      '<td style="padding:4px 5px;border-bottom:' + bdr + ';background:#EFF6FF">' + inp('total','background:#EFF6FF;color:#0284C7;font-weight:700;',true) + '</td>',
      '<td style="padding:4px 5px;border-bottom:' + bdr + '">' + inp('sales','font-weight:700;') + '</td>',
      '<td style="padding:4px 5px;border-bottom:' + bdr + '">' + inp('close','',true) + '</td>',
      '<td style="padding:4px 5px;border-bottom:' + bdr + '">' + amtCell + '</td>',
    ].join('');
    tbody.appendChild(tr);
  });
}

// ── Inspection banner on the Daily Entry page ─────────────────────────────
function entryUpdateInspBanner(crsId, date){
  var box = document.getElementById('entry-insp-banner');
  var sum = document.getElementById('entry-insp-summary');
  if(!box || !sum) return;

  var rec = (typeof inspectionStore !== 'undefined')
          ? (inspectionStore[crsId + '_' + date] || inspectionStore[String(crsId) + '_' + date])
          : null;
  if(!rec){ box.style.display = 'none'; return; }

  var LOOKUP = {};
  (DSS_A || []).forEach(function(c){ LOOKUP['a' + c.id] = c.en || c.id; });
  (DSS_B || []).forEach(function(c){ LOOKUP['b' + c.id] = c.en || c.id; });

  var COLOR = {excess:'#166534', shortage:'#B91C1C', transfer:'#92400E'};
  var SIGN  = {excess:'+', shortage:'\u2212', transfer:'\u2192'};
  var parts = [];
  ['a','b'].forEach(function(sec){
    var blk = rec[sec] || {};
    Object.keys(blk).forEach(function(id){
      var r = blk[id] || {};
      ['excess','shortage','transfer'].forEach(function(f){
        var v = parseFloat(r[f]) || 0;
        if(!v) return;
        parts.push('<span style="display:inline-block;margin-right:10px"><strong style="color:' + COLOR[f] +
                   '">' + SIGN[f] + (+v.toFixed(3)) + '</strong> ' + (LOOKUP[sec + id] || id) +
                   ' <span style="opacity:.7">(' + f + ')</span></span>');
      });
    });
  });

  if(!parts.length){ box.style.display = 'none'; return; }
  sum.innerHTML = parts.join('');
  box.style.display = 'flex';
}

// ── FIELD CHANGE HANDLER ───────────────────────────────────────────────────
// Paint the Closing input cell red when negative (deficit visible in both
// Daily Entry and Monthly Entry), revert to neutral when zero or positive.
// Works for both inp() (Daily) and minp() (Monthly) rendered inputs since
// they both set data-field="close" and are readonly.
function entryPaintClose(tr, val){
  if(!tr) return;
  var el = tr.querySelector('[data-field="close"]');
  if(!el) return;
  var neg = val < 0;
  el.style.color       = neg ? '#DC2626' : '';
  el.style.background  = neg ? '#FEF2F2' : '';
  el.style.borderColor = neg ? '#FCA5A5' : '';
  el.style.fontWeight  = neg ? '800'     : '';
  el.title             = neg ? 'Deficit: Sales exceed Opening+Receipt' : '';
}

function onFieldChange(inp){
  var v = parseFloat(inp.value);
  if(isNaN(v)||v<0){ inp.value=''; v=0; }
  var tr = inp.closest('tr');
  if(!tr) return;

  function g(f){ var e=tr.querySelector('[data-field="'+f+'"]'); return e?parseFloat(e.value)||0:0; }
  function s(f,val){ var e=tr.querySelector('[data-field="'+f+'"]'); if(e) e.value=val.toFixed(3); }
  function sa(val){ var e=tr.querySelector('[data-field="amount"]'); if(e) e.value=val.toFixed(2); }

  var open=g('open'), rec=g('receipt'), sales=g('sales');
  // Total = Opening + Receipt + Excess - Shortage - Transfer  (Inspection module)
  var total = open + rec + inspNet(inspFromRow(tr));
  s('total', total);
  var closeVal = total - sales;
  s('close', closeVal);
  entryPaintClose(tr, closeVal);

  var isFree = tr.dataset.free==='1';
  if(!isFree){
    sa(sales * parseFloat(tr.dataset.rate||0));
  }
  recalc();
}

// ── RECALCULATE TOTALS ─────────────────────────────────────────────────────
function recalc(){
  var amtA=0, salesA=0, amtB=0, salesB=0;
  var fmt=function(n){ return '₹'+n.toLocaleString('en-IN',{minimumFractionDigits:2,maximumFractionDigits:2}); };
  // Column sums for the footer rows — every numeric column, not just Amount
  var SUM={a:{open:0,rec:0,ex:0,sh:0,tr:0,total:0,close:0},
           b:{open:0,rec:0,ex:0,sh:0,tr:0,total:0,close:0}};

  function processSection(comms, tbodyId, isSec){
    comms.forEach(function(c){
      var tr = document.querySelector('#'+tbodyId+' tr[data-id="'+c.id+'"]');
      if(!tr) return;
      function g(f){ var e=tr.querySelector('[data-field="'+f+'"]'); return e?parseFloat(e.value)||0:0; }
      function s(f,val){ var e=tr.querySelector('[data-field="'+f+'"]'); if(e) e.value=val.toFixed(3); }

      var open=g('open'), rec=g('receipt'), sales=g('sales');
      var adj=inspFromRow(tr);
      var total=open+rec+inspNet(adj);
      s('total', total);
      var closeVal=total-sales;
      s('close', closeVal);
      entryPaintClose(tr, closeVal);

      var acc=SUM[isSec];
      acc.open+=open; acc.rec+=rec; acc.total+=total; acc.close+=closeVal;
      acc.ex+=adj.excess; acc.sh+=adj.shortage; acc.tr+=adj.transfer;

      if(!c.free){
        var amt = sales*c.rate;
        var aEl = tr.querySelector('[data-field="amount"]');
        if(aEl) aEl.value = amt.toFixed(2);
        if(isSec==='a') amtA+=amt; else amtB+=amt;
      }
      if(isSec==='a') salesA+=sales; else salesB+=sales;
    });
  }
  processSection(DSS_A,'et-tbody-a','a');
  processSection(DSS_B,'et-tbody-b','b');

  var grand=amtA+amtB;
  function el(id){ return document.getElementById(id); }
  // Footer column totals
  ['a','b'].forEach(function(k){
    var acc=SUM[k];
    var map={open:'open', rec:'rec', ex:'ex', sh:'sh', tr:'tr', total:'total', close:'close'};
    Object.keys(map).forEach(function(f){
      var e=el('et-'+k+'-'+map[f]);
      if(e) e.textContent=acc[f].toFixed(3);
    });
  });
  if(el('et-a-sales')) el('et-a-sales').textContent=salesA.toFixed(3);
  if(el('et-a-amt'))   el('et-a-amt').textContent=fmt(amtA);
  if(el('et-b-sales')) el('et-b-sales').textContent=salesB.toFixed(3);
  if(el('et-b-amt'))   el('et-b-amt').textContent=fmt(amtB);
  if(el('ef-sum-a'))     el('ef-sum-a').textContent=fmt(amtA);
  if(el('ef-sum-b'))     el('ef-sum-b').textContent=fmt(amtB);
  if(el('ef-sum-grand')) el('ef-sum-grand').textContent=fmt(grand);
  if(el('ef-grand-hdr')) el('ef-grand-hdr').textContent=fmt(grand);
  // Update remittance diff indicator live
  if(typeof entryUpdateRemitDiff==='function') entryUpdateRemitDiff();
}

// ── SAVE ───────────────────────────────────────────────────────────────────
function saveEntryForm(){
  var crsId = document.getElementById('entry-crs').value;
  var date  = document.getElementById('entry-date').value;
  if(!crsId||!date) return;

  var key = crsId+'_'+date;

  // [S5] A sheet already saved for this CRS + date is about to be replaced.
  // Re-opening a day to read it, then hitting Save out of habit, used to wipe
  // the keyed figures with whatever the (possibly auto-filled) grid held.
  var prior = entryStore[key];
  if(prior){
    var crsPrior = CRS_LIST.find(function(c){ return String(c.id)===crsId; });
    var dPrior   = new Date(date+'T00:00:00');
    var when     = dPrior.toLocaleDateString('en-IN',{day:'numeric',month:'short',year:'numeric'});
    var ok = confirm(
      'A day sheet is already saved for CRS ' + crsId +
      (crsPrior ? ' \u2014 ' + crsPrior.name : '') + ' on ' + when + '.\n\n' +
      'Saving now replaces it with what is currently on screen. This cannot be undone.\n\n' +
      'Replace the saved sheet?');
    if(!ok) return;
  }

  var snap = {a:{},b:{}};

  function collectSection(comms, tbodyId, sec){
    comms.forEach(function(c){
      var tr=document.querySelector('#'+tbodyId+' tr[data-id="'+c.id+'"]');
      if(!tr) return;
      function g(f){ var e=tr.querySelector('[data-field="'+f+'"]'); return e?parseFloat(e.value)||0:0; }
      var adj=inspFromRow(tr);
      snap[sec][c.id]={open:g('open'),receipt:g('receipt'),total:g('total'),sales:g('sales'),
                       close:g('close'),amount:g('amount'),
                       excess:adj.excess,shortage:adj.shortage,transfer:adj.transfer};
    });
  }
  collectSection(DSS_A,'et-tbody-a','a');
  collectSection(DSS_B,'et-tbody-b','b');
  var ramtEl2 = document.getElementById('entry-remit-amount');
  var rdEl2   = document.getElementById('entry-remit-date');
  snap.remitAmount = ramtEl2 ? (parseFloat(ramtEl2.value)||0) : 0;
  snap.remitDate   = rdEl2 ? rdEl2.value : '';
  entryStore[key]=snap;

  // Roll the day up into the Monthly figures straight away
  rebuildMonthlyForDate(crsId, date);
  try{
    var meCrs=document.getElementById('me-crs');
    var p=date.split('-');
    if(meCrs && String(meCrs.value)===String(crsId) &&
       parseInt(document.getElementById('me-month').value,10)===parseInt(p[1],10) &&
       parseInt(document.getElementById('me-year').value,10)===parseInt(p[0],10)){
      onMonthlyChange();
    }
  }catch(e){}

  var crs=CRS_LIST.find(function(c){ return String(c.id)===crsId; });
  var d=new Date(date+'T00:00:00');
  var sfl=document.getElementById('entry-saved-for');
  if(sfl&&crs) sfl.textContent='CRS '+crs.id+' — '+crs.name+
    ' ('+d.toLocaleDateString('en-IN',{day:'numeric',month:'short',year:'numeric'})+')';
  var succ=document.getElementById('entry-success');
  if(succ){succ.style.display='flex';setTimeout(function(){succ.style.display='none';},5000);}
  var dup=document.getElementById('entry-dup-warn');
  if(dup) dup.style.display='none';
}

// ── CLEAR ──────────────────────────────────────────────────────────────────
function clearEntryForm(){
  document.querySelectorAll('#et-tbody-a input:not([readonly]),#et-tbody-b input:not([readonly])').forEach(function(i){i.value='';});
  document.querySelectorAll('#et-tbody-a input[readonly],#et-tbody-b input[readonly]').forEach(function(i){i.value='';});
  recalc();
}


// ═══ SALES CLOSE WORKFLOW (rules 5–8) ═══════════════════════════════════════
// One record per CRS per month: {date, gunny, poly, cbox}. Re-marking another
// day replaces the previous flag automatically (rule 6). The three aggregates
// are the month's "Monthly Sales Gunny / Poly / C.Box" (rule 7): computed
// from ALL saved Daily Entries of the month up to & incl. the marked last
// sales day — bags per commodity = floor(total sales kgs ÷ divisor) using the
// same packing types as the Receipt page. They then auto-fill the Gunny
// section's Receipt (rule 8). Stored once, referenced everywhere (rule 12).
var salesCloseStore = {}; // {crsId_month_year: {date:'YYYY-MM-DD', gunny, poly, cbox, updatedAt}}

// Pack-type map (mirrors the Receipt page packingRules; switchables default GUNNY)
var SC_PACK_TYPES = {
  GUNNY: {BRA:50,NPHH_FRK:50,PHH_FRK:50,AAY_FRK:50,AAY:50,OAP:50,APS:50,TOOR:50,PHH_BRA:50,
          WHEAT:50,RRA:50,NPHH_RRA:50,PB_BRA:50,PB_WHEAT:50,PB_TOOR:50},
  POLY:  {SUGAR:50,AAY_SUGAR:50,SALT_CIS:25,SALT_RFFS:25,PB_SUGAR:50},
  CBOX:  {PALM:10,OOTY:50,TAN:50,PB_PALM:10}
};

// Aggregate the month's daily sales (kgs) per commodity up to `uptoDate`,
// then convert to bags per pack type.
function computeSalesCloseAggregates(crsId, uptoDate){
  var p = uptoDate.split('-'); var y = p[0], m = p[1], lastDay = parseInt(p[2]);
  var kgsById = {};
  for(var day = 1; day <= lastDay; day++){
    var key = crsId + '_' + y + '-' + m + '-' + String(day).padStart(2,'0');
    var e = entryStore[key];
    if(!e) continue;
    ['a','b'].forEach(function(sec){
      Object.keys(e[sec]||{}).forEach(function(cid){
        kgsById[cid] = (kgsById[cid]||0) + (parseFloat(e[sec][cid].sales)||0);
      });
    });
  }
  function sumType(map){
    var bags = 0;
    Object.keys(map).forEach(function(cid){
      var kgs = kgsById[cid]||0;
      if(kgs > 0) bags += Math.floor(kgs / map[cid]);
    });
    return bags;
  }
  return {
    gunny: sumType(SC_PACK_TYPES.GUNNY),
    poly:  sumType(SC_PACK_TYPES.POLY),
    cbox:  sumType(SC_PACK_TYPES.CBOX)
  };
}

// "Sales Close" button handler (rules 5–6): saves the entry, marks the date
// as the month's last sales day, computes the aggregates, and syncs the
// Gunny Receipt if the Monthly Entry page is showing the same CRS/month.
function markSalesClose(){
  var crsId = document.getElementById('entry-crs').value;
  var date  = document.getElementById('entry-date').value;
  if(!crsId || !date){ alert('Select a CRS shop and date first.'); return; }

  saveEntryForm(); // the marked day's entry must be saved

  var p = date.split('-');
  var scKey = crsId + '_' + parseInt(p[1]) + '_' + parseInt(p[0]);
  var prev = salesCloseStore[scKey];
  var agg = computeSalesCloseAggregates(crsId, date);
  salesCloseStore[scKey] = {date: date, gunny: agg.gunny, poly: agg.poly, cbox: agg.cbox,
                            updatedAt: new Date().toISOString()};

  entryUpdateSalesCloseBadge();
  // Live-sync the Gunny section if Monthly Entry currently shows this CRS/month
  if(typeof meGunnyRefreshReceipts === 'function') meGunnyRefreshReceipts();

  var dd = p[2]+'/'+p[1]+'/'+p[0];
  alert('Sales Close marked for '+dd+
    (prev && prev.date!==date ? '\n(previous mark on '+prev.date.split('-').reverse().join('/')+' was replaced)' : '')+
    '\n\nMonth totals up to this date:'+
    '\n  Sales Gunny = '+agg.gunny+'  \u2192 50 KG SS Receipt'+
    '\n  Sales Poly  = '+agg.poly +'  \u2192 POLY Receipt'+
    '\n  Sales C.Box = '+agg.cbox+'  \u2192 C.BOX Receipt');
}

// Badge on the Daily Entry page showing the month's marked last sales day
function entryUpdateSalesCloseBadge(){
  var el = document.getElementById('entry-salesclose-badge');
  if(!el) return;
  var crsId = document.getElementById('entry-crs').value;
  var date  = document.getElementById('entry-date').value;
  if(!crsId || !date){ el.style.display='none'; return; }
  var p = date.split('-');
  var rec = salesCloseStore[crsId + '_' + parseInt(p[1]) + '_' + parseInt(p[0])];
  if(rec){
    var isThis = rec.date === date;
    el.textContent = (isThis ? '\uD83D\uDD12 THIS DAY is the Sales Close (last sales day)' :
                               '\uD83D\uDD12 Sales Close: ' + rec.date.split('-').reverse().join('/'));
    el.style.display = 'inline-block';
    el.style.background = isThis ? '#DCFCE7' : '#FEF3C7';
    el.style.borderColor = isThis ? '#86EFAC' : '#FDE047';
    el.style.color = isThis ? '#15803D' : '#92400E';
  } else {
    el.style.display = 'none';
  }
}


// ── STATEMENT PREVIEW ─────────────────────────────────




// ── CHARTS ────────────────────────────────────────────
// [M5] buildChart() removed — it looked up #bar-chart / #bar-labels, which
// are not in this document, so it hit its own guard and returned on every
// one of its three calls. Its data was a hardcoded six-month placeholder.

// ── REPORT TABS ───────────────────────────────────────
// ── REPORTS ────────────────────────────────────────────────────────────────
