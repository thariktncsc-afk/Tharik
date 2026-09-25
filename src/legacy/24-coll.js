/* COLL statement — allotment, godown receipt, advance load  [+]
   Added after the port; not part of TNCSC_CRS_Demo_19 (1).html, so
   tools/verify-parity.mjs skips this file (see NEW_ENGINE there).

   The ported builder had no allotment to read and no advance load to net off,
   so it printed the monthly receipt in BOTH the Allotment and the "Received
   from godown" columns. Each column now has its own source:

     Opening balance      unchanged — the ported monthly opening
     Allotment            Monthly Entry -> Allotment (meAllotStore)
     Received from godown REGULAR godown receipts for the month, LESS any
                          advance load taken against them
     Total                Opening + Allotment + Received - Shortage + Excess
                          (shortage/excess from the Daily Entry inspection)
     Sales                unchanged
     Closing balance      Total - Sales

   WHICH SHOPS. Only shops the master marks coll, and never CRS 29, which files
   an Indent instead — see collEligible() at the foot of this file.

   TWO KINDS OF ADVANCE, which are easy to confuse:

     Advance RECEIPT  a whole godown receipt typed Advance on the Receipt Entry
                      page (33-receipt-type.js). Never counted here at all.
     Advance LOAD     a per-commodity quantity keyed beside the allotment on
                      Monthly Entry. Subtracts from what this month claims to
                      have received.

   They are different entry points for the same idea, so a shop that uses both
   could double-subtract; the load is therefore clamped to what survives after
   the Advance receipts are already excluded.

   ADVANCE LOAD is stock drawn ahead of the month it belongs to. It is entered
   beside the allotment on Monthly Entry, per commodity, and only ever reduces
   what this month's statement claims to have received — the ported "ADVANCE FOR
   THE MONTH OF <next>" block at the foot of the report is left as the blank
   template it has always been.

   Concatenated last by tools/bundle-engine.mjs. */

// ── RECEIPT REGISTER: Regular vs Advance ────────────────────────────────────
// 33-receipt-type.js went with the rest of the ported engine, so these two
// helpers — which collRow below has always asked for by name — were defined
// NOWHERE in the generated module. `typeof rcpHasRowsInMonth === 'function'`
// was therefore false on every render, COLL fell back to the monthly receipt
// figure, and an Advance receipt counted as a regular one: it reached RECEIVED
// FROM GODOWN, TOTAL and the CLOSING BALANCE, which is exactly what an advance
// must not do (CRS 7, September 2026: PHH BRA 1950 keyed Advance on 24-09 sat
// in the Collector's closing balance). They live here because COLL is their
// only reader; the Receipt Register screen has its own.
//
// A row with no `type` is a Regular receipt — the field was added later, and
// every row keyed before it is an ordinary godown delivery.
function rcpRowsInMonth(crsId, month, year){
  if(typeof receiptStore === 'undefined' || !receiptStore) return [];
  var mo = String(month).length < 2 ? '0' + month : String(month);
  var pre = year + '-' + mo + '-';
  return receiptStore.filter(function(r){
    return r && String(r.crsId) === String(crsId) && String(r.date || '').indexOf(pre) === 0;
  });
}
function rcpHasRowsInMonth(crsId, month, year){
  return rcpRowsInMonth(crsId, month, year).length > 0;
}
function rcpQtyOf(item){
  if(item === null || item === undefined) return 0;
  var raw = (typeof item === 'object') ? item.qty : item;
  var n = parseFloat(raw);
  return isFinite(n) ? n : 0;
}
function rcpQtyByType(crsId, month, year, id, advance){
  var t = 0;
  rcpRowsInMonth(crsId, month, year).forEach(function(r){
    var isAdv = String(r.type || 'regular') === 'advance';
    if(isAdv !== !!advance) return;
    t += rcpQtyOf((r.items || {})[id]);
  });
  return t;
}
function rcpRegularQty(crsId, month, year, id){ return rcpQtyByType(crsId, month, year, id, false); }
function rcpAdvanceQty(crsId, month, year, id){ return rcpQtyByType(crsId, month, year, id, true); }

// {crsId_month_year: {commodityId: qty}}
var meAdvanceStore = {};

function meAdvanceQty(key, id){
  var d = meAdvanceStore[key];
  return d ? (parseFloat(d[id]) || 0) : 0;
}

function meAdvanceCalc(inp){
  var mo = meMoKey();
  if(!mo) return;
  var id = inp.dataset.advanceId;
  var v  = parseFloat(inp.value);
  if(inp.value !== '' && (isNaN(v) || v < 0)){ inp.value = ''; v = NaN; }
  if(!meAdvanceStore[mo.key]) meAdvanceStore[mo.key] = {};
  if(inp.value === '' || isNaN(v)) delete meAdvanceStore[mo.key][id];
  else meAdvanceStore[mo.key][id] = v;
}

// ── STATEMENT DATA ──────────────────────────────────────────────────────────
// Everything the COLL columns need, in one place so the builder below and any
// later reader agree on the arithmetic.
var _collOrigStmtGetData = stmtGetData;
stmtGetData = function(crsId, month, year){
  var d = _collOrigStmtGetData.apply(this, arguments);
  try{
    var key = crsId + '_' + month + '_' + year;
    d.advance    = meAdvanceStore[key] || {};
    d.advanceQty = function(id){ return meAdvanceQty(key, id); };

    // The month's figures for one commodity.
    //
    //   Total   = Opening + Allotment + Regular Receipt - Shortage + Excess
    //   Closing = Total - Sales
    //
    // Receipt counts REGULAR godown receipts only; Advance receipts are typed
    // on the Receipt Entry page (33-receipt-type.js) and never reach COLL.
    // When the shop keyed no godown receipts at all we fall back to the Daily
    // Entry receipt figure, so shops that only key day sheets still produce a
    // statement -- but once ANY receipt row exists for the month the typed
    // rows are authoritative, otherwise a month whose receipts were all
    // Advance would silently fall back and re-admit them.
    d.collRow = function(id){
      var ob    = d.getVal(id, 'open');
      var allot = d.allotQty ? d.allotQty(id) : 0;

      var received, regular;
      if(typeof rcpHasRowsInMonth === 'function' && rcpHasRowsInMonth(crsId, month, year)){
        received = (typeof d.receiptQty === 'function') ? d.receiptQty(id) : d.getVal(id, 'receipt');
        regular  = rcpRegularQty(crsId, month, year, id);
      } else {
        received = d.getVal(id, 'receipt');
        regular  = received;
      }

      // Advance LOAD (Monthly Entry -> Allotment) is a separate, older lever
      // that also reduces what this month claims to have received; it is
      // clamped to what is left after the Advance receipts are already out, so
      // the two cannot subtract the same stock twice.
      var advance = Math.min(meAdvanceQty(key, id), regular);
      var rec     = regular - advance;

      var shortage = d.getVal(id, 'shortage');
      var excess   = d.getVal(id, 'excess');
      var tot      = ob + allot + rec - shortage + excess;
      var sal      = d.getVal(id, 'sales');

      // The CLOSING BALANCE must not carry an advance either (office,
      // 2026-09-25). The stored monthly close counts BOTH receipt types —
      // receiptRollup totals an Advance receipt like any other, because the
      // grain is physically in the shop — so the advance kept out of RECEIVED
      // above is taken back off here, and only here. Everything else in that
      // figure (C.S, and any other monthly adjustment) is left exactly as the
      // month published it. The advance itself prints in the ADVANCE FOR THE
      // MONTH OF … table at the foot of the sheet.
      var advReceipt = (typeof rcpAdvanceQty === 'function') ? rcpAdvanceQty(crsId, month, year, id) : 0;
      var cb = d.hasVal(id, 'close')
        ? d.getVal(id, 'close') - advReceipt - advance   // stored close: take the advance back off
        : tot - sal;                                     // worked out: `tot` already excludes it
      return {ob:ob, allot:allot, received:received, regular:regular,
              advance:advance, advReceipt:advReceipt, rec:rec, tot:tot,
              shortage:shortage, excess:excess, adjusted:tot, sal:sal, cb:cb};
    };
  }catch(e){}
  return d;
};

// ── BUILDER ─────────────────────────────────────────────────────────────────
// Reassigns the ported buildColl. Same layout and column set as the port, with
// each column now drawing on its own source; the ported original is frozen by
// parity, so this cannot drift away from a moving target.
buildColl = function(d){
  if(!collEligible(d.crsId)){
    return '<div style="padding:20px;font-size:12px;color:#B45309">' +
      collIneligibleReason(d.crsId) + '</div>';
  }
  function nz(v){ if(v===''||v==null) return ''; return String(+(Number(v).toFixed(3))); }
  function C(x){ return '<td>'+(x==null?'':x)+'</td>'; }
  function L(x){ return '<td class="l">'+(x==null?'':x)+'</td>'; }

  var vals = (typeof d.collRow === 'function')
    ? d.collRow
    : function(id){                                  // defensive: pre-wrapper data
        var ob=d.getVal(id,'open'), rec=d.getVal(id,'receipt');
        var tot=d.getVal(id,'total')||(ob+rec), sal=d.getVal(id,'sales');
        return {ob:ob, allot:0, rec:rec, tot:tot, sal:sal,
                cb:d.hasVal(id,'close')?d.getVal(id,'close'):Math.max(0,tot-sal)};
      };

  function dataRow(label,id,bold){
    var v=vals(id);
    return '<tr'+(bold?' class="sub"':'')+'>'+L(label)+
      C(nz(v.ob))+C(nz(v.allot))+C(nz(v.rec))+C(nz(v.tot))+C(nz(v.sal))+C(nz(v.cb))+'</tr>';
  }
  function subRow(label, ids){
    var t={ob:0,allot:0,rec:0,tot:0,sal:0,cb:0};
    ids.forEach(function(id){
      var v=vals(id);
      t.ob+=v.ob; t.allot+=v.allot; t.rec+=v.rec; t.tot+=v.tot; t.sal+=v.sal; t.cb+=v.cb;
    });
    return '<tr class="sub">'+L(label)+
      C(nz(t.ob))+C(nz(t.allot))+C(nz(t.rec))+C(nz(t.tot))+C(nz(t.sal))+C(nz(t.cb))+'</tr>';
  }
  function sectionLabel(text){ return '<tr class="sec"><td class="l" colspan="7">'+text+'</td></tr>'; }

  var MAIN_TOP=[['BRA','BRA'],['RRA','RRA']];
  var MAIN_REST=[
    ['AAY','AAY'],['O.A.P','OAP'],['A.P.S','APS'],['SUGAR','SUGAR'],['SUGAR AAY','AAY_SUGAR'],
    ['WHEAT','WHEAT'],['T.DHALL','TOOR'],['P.OIL','PALM'],['PHH BRA','PHH_BRA'],['PHH FRK','PHH_FRK'],
    ['AAY FRK','AAY_FRK'],['NPHH FRK','NPHH_FRK'],['NPHH FRK RRA','NPHH_RRA'],
  ];
  var POLICE=[['BRA','PB_BRA'],['SUGAR','PB_SUGAR'],['WHEAT','PB_WHEAT'],['T.DHALL','PB_TOOR'],['P.OIL','PB_PALM']];

  var body='';
  MAIN_TOP.forEach(function(r){ body+=dataRow(r[0],r[1]); });
  body+=subRow('TOTAL', MAIN_TOP.map(function(r){return r[1];}));
  MAIN_REST.forEach(function(r){ body+=dataRow(r[0],r[1]); });
  // A shop with no police ration on the master has no police section to print.
  if(!d.master || d.hasPolice){
    body+=sectionLabel('POLICE');
    POLICE.forEach(function(r){ body+=dataRow(r[0],r[1]); });
  }

  // ADVANCE FOR THE MONTH OF <next> — its own small table under the report,
  // COMMODITY and ONE quantity column, as the office's Coll sheet has it
  // (CRS 19 AUG'26.xlsx, rows 34–46; asked for 2026-09-21). It used to be a
  // section of the main table, which gave it six empty columns — Opening,
  // Allotment, Received, Total, Sales, Closing — none of which an advance has.
  // Rows and their order are the office's, PHH FRK twice included. Still no
  // figure source: the quantity cells print blank, as the block always has.
  var nextMo=STMT_MONTHS_SHORT[(d.month%12)+1] || '';
  var nextYr=d.month===12 ? d.yr+1 : d.yr;
  // The office's rows, in the office's order, each now printing the advance
  // receipt actually keyed for that commodity this month (office, 2026-09-25).
  // The sheet's second "PHH FRK" (row 42) is PHH BRA — confirmed 2026-09-25;
  // the pair then reads as it does in the report above, and a PHH BRA advance
  // has somewhere to print.
  var ADV=[['NPHH FRK','NPHH_FRK'],['PHH FRK','PHH_FRK'],['BRA','BRA'],['RRA','RRA'],
           ['SUGAR','SUGAR'],['AAY SUGAR','AAY_SUGAR'],['PHH BRA','PHH_BRA'],['AAY FRK','AAY_FRK'],
           ['WHEAT','WHEAT'],['T.DHALL','TOOR'],['P.OIL','PALM']];
  function advQty(id){
    return (typeof rcpAdvanceQty === 'function') ? rcpAdvanceQty(d.crsId, d.month, d.yr, id) : 0;
  }
  // A commodity taken in advance that the office's sheet has no row for (AAY,
  // the police lines…) gets one added under them. It has been kept out of the
  // closing balance, so leaving it off the sheet altogether would lose it.
  var advSeen={};
  ADV.forEach(function(r){ advSeen[r[1]]=1; });
  var advLabels={};
  MAIN_TOP.concat(MAIN_REST).forEach(function(r){ advLabels[r[1]]=r[0]; });
  POLICE.forEach(function(r){ advLabels[r[1]]='POLICE '+r[0]; });
  var advExtra=[];
  Object.keys(advLabels).forEach(function(id){
    if(!advSeen[id] && advQty(id) > 0) advExtra.push([advLabels[id], id]);
  });

  var advTbl='<div class="cl-adv-title">ADVANCE FOR THE MONTH OF '+nextMo.toUpperCase()+"'"+nextYr+'</div>'+
    '<table class="cl-tbl cl-adv"><colgroup><col style="width:62%"><col style="width:38%"></colgroup><tbody>'+
    ADV.concat(advExtra).map(function(r){
      var q = advQty(r[1]);
      // Nothing taken in advance leaves the cell blank, as the ruled form has it.
      return '<tr>'+L(r[0])+'<td class="r">'+(q ? nz(q) : '')+'</td></tr>';
    }).join('')+
    '</tbody></table>';

  var crs=(typeof CRS_LIST!=='undefined')?CRS_LIST.find(function(c){return String(c.id)===String(d.crsId);}):null;
  var crsCode=(d.master&&d.master.code) ? d.master.code : ((crs&&crs.code)?crs.code:'');

  // Note the advance actually netted off, so a reader can tell why the received
  // column is short of what the day sheets add up to.
  var advTotal = 0;
  MAIN_TOP.concat(MAIN_REST, POLICE).forEach(function(r){
    var v = vals(r[1]); advTotal += (v.advance || 0);
  });
  var advNote = advTotal > 0
    ? '<div style="font-size:9px;margin:3px 2px">Received from godown is net of an advance load of ' +
      nz(advTotal) + '.</div>'
    : '';

  var css=[
    '.cl-wrap{font-family:Calibri,Arial,sans-serif;color:#000;background:#fff;max-width:820px;margin:0 auto}',
    '.cl-title{text-align:center;font-weight:bold;font-size:13px;margin-bottom:2px}',
    // The shop's code alone, centred under the title and a size up from the
    // old 11px — "CRS 19" beside it was dropped at the office's request
    // (2026-09-21).
    '.cl-info{text-align:center;font-size:13px;font-weight:bold;margin:4px 2px}',
    '.cl-tbl{width:100%;border-collapse:collapse;font-size:10px;table-layout:fixed;margin-top:4px}',
    '.cl-tbl th,.cl-tbl td{border:1px solid #000;padding:3px 5px;text-align:center;white-space:nowrap;overflow:hidden}',
    // The column headings are shaded and bold (office, 2026-09-21). Colour,
    // case and spacing are stated here because the app's own `th` rule
    // (globals.css: muted grey, uppercase, letter-spaced) otherwise reaches
    // them in the preview and makes the bold read as light. print-color-adjust
    // so the shade is printed, not dropped as a "background graphic".
    '.cl-tbl th{font-weight:bold;color:#000;background:#D9D9D9;line-height:1.15;font-size:11px;letter-spacing:normal;text-transform:none;-webkit-print-color-adjust:exact;print-color-adjust:exact}',
    '.cl-tbl td.l{text-align:left}',
    '.cl-tbl tr.sub td{font-weight:bold;background:#F5F5F5}',
    '.cl-tbl tr.sec td{font-weight:bold;background:#EDEDED;text-align:left}',
    // The advance table is the width of COMMODITY + one figure column, as on
    // the office's sheet, not the width of the report above it.
    '.cl-adv-title{font-size:11px;font-weight:bold;margin:14px 2px 0}',
    '.cl-tbl.cl-adv{width:36%}',
    '.cl-tbl td.r{text-align:right}',
  ].join('');
  var cg='<colgroup><col style="width:22%"><col style="width:13%"><col style="width:11%"><col style="width:16%"><col style="width:12%"><col style="width:12%"><col style="width:14%"></colgroup>';
  var head='<thead><tr>'+
    '<th>COMMODITY</th><th>OPENING<br>BALANCE</th><th>ALLOTMENT</th><th>RECEIVED FROM<br>GODOWN</th>'+
    '<th>TOTAL</th><th>SALES</th><th>CLOSING<br>BALANCE</th></tr></thead>';

  return '<style>'+css+'</style>'+
    '<div class="cl-wrap">'+
      '<div class="cl-title">MONTHLY SALES REPORT FOR THE MONTH OF '+d.mo.toUpperCase()+"'"+d.yr+'</div>'+
      // A shop with no code on the master keeps "CRS n", or nothing on the
      // sheet would say whose it is.
      '<div class="cl-info">'+(crsCode || ('CRS '+d.crsId))+'</div>'+
      '<table class="cl-tbl">'+cg+head+'<tbody>'+body+'</tbody></table>'+
      advNote+
      advTbl+
      // No signature line on COLL: the staff name and AREA SUPERVISOR under
      // the tables were taken off at the office's request (2026-09-21) —
      // the report ends with its Advance table. Other sheets keep theirs.
    '</div>';
};

// ── WHICH SHOPS FILE COLL ───────────────────────────────────────────────────
// The master list is the authority (CRS_MASTER.coll): 5, 7, 8, 9, 10, 11, 12,
// 19, 29, 30. CRS 29 is carved out on top of that — it is the Refugee Camp
// shop and files an Indent instead, so it never produces a COLL statement even
// though the master marks it. That leaves 5, 7, 8, 9, 10, 11, 12, 19 and 30.
var COLL_EXCLUDED = [29];

function collEligible(crsId){
  var id = parseInt(crsId, 10);
  if(!id) return false;
  if(COLL_EXCLUDED.indexOf(id) !== -1) return false;
  if(typeof CRS_MASTER === 'undefined') return false;
  var m = CRS_MASTER.find(function(r){ return r.id === id; });
  return !!(m && m.coll);
}

function collIneligibleReason(crsId){
  var id = parseInt(crsId, 10);
  if(COLL_EXCLUDED.indexOf(id) !== -1){
    return 'CRS ' + id + ' is an Indent shop and does not file a COLL statement.';
  }
  return 'CRS ' + (id || '—') + ' is not marked for COLL in the CRS Master.';
}

/* The card grid filters on STMT_SECTIONS[].availableFor, so eligibility is
   expressed by rewriting that field for the selected shop rather than by
   reaching into the grid afterwards — stmtSelectAll() reads the same field and
   therefore stays in step for free. 'none' matches neither branch of the
   filter, which is what hides the card.

   COLL is visible to the shop's own staff as well as to an admin: it is a
   return the shop itself files, and the port's blanket admin-only rule pre-dated
   the master list that now says which shops file it at all. */
function collSyncAvailability(){
  if(typeof STMT_SECTIONS === 'undefined') return;
  var sec = STMT_SECTIONS.find(function(s){ return s.id === 'coll'; });
  if(!sec) return;
  var el = document.getElementById('stmt-crs');
  var crsId = el && el.value ? el.value : (currentUser && currentUser.crsId);
  var ok = collEligible(crsId);
  sec.availableFor = ok ? 'all' : 'none';
  // A card that has just become ineligible must not stay ticked from the shop
  // that was selected a moment ago, or it would still ride along on an export.
  if(!ok && typeof stmtSelectedSections !== 'undefined') delete stmtSelectedSections.coll;
}

var _collOrigRenderSections = (typeof stmtRenderSections === 'function') ? stmtRenderSections : null;
if(_collOrigRenderSections){
  stmtRenderSections = function(){
    try{ collSyncAvailability(); }catch(e){}
    return _collOrigRenderSections.apply(this, arguments);
  };
}

// ── PERSISTENCE ─────────────────────────────────────────────────────────────
if(typeof BACKUP_STORES !== 'undefined'){
  BACKUP_STORES.push({key:'meAdvanceStore', kind:'object', label:'Advance Load'});
}
if(typeof sdClearAllModules === 'function'){
  var _collOrigClearAll = sdClearAllModules;
  sdClearAllModules = function(crsId, month, year){
    var r = _collOrigClearAll.apply(this, arguments);
    try{ delete meAdvanceStore[parseInt(crsId,10)+'_'+parseInt(month,10)+'_'+parseInt(year,10)]; }catch(e){}
    return r;
  };
}
