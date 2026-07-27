/* COLL statement — allotment, godown receipt, advance load  [+]
   Added after the port; not part of TNCSC_CRS_Demo_19 (1).html, so
   tools/verify-parity.mjs skips this file (see NEW_ENGINE there).

   The ported builder had no allotment to read and no advance load to net off,
   so it printed the monthly receipt in BOTH the Allotment and the "Received
   from godown" columns. Each column now has its own source:

     Opening balance      unchanged — the ported monthly opening
     Allotment            Monthly Entry -> Allotment (meAllotStore)
     Received from godown the Daily Entry receipt for the month, LESS any
                          advance load taken against it
     Total                Opening + Received
     then                 - Shortage  + Excess     (Daily Entry inspection)
     Sales                unchanged
     Closing balance      Total - shortage + excess - sales

   Worked example from the spec: opening 100, actually received 300 of which
   100 was an advance load, so the statement shows 200 received and a total of
   300; sales of 300 leave a closing of 0.

   ADVANCE LOAD is stock drawn ahead of the month it belongs to. It is entered
   beside the allotment on Monthly Entry, per commodity, and only ever reduces
   what this month's statement claims to have received — the ported "ADVANCE FOR
   THE MONTH OF <next>" block at the foot of the report is left as the blank
   template it has always been.

   Concatenated last by tools/bundle-engine.mjs. */

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

    // The month's figures for one commodity, with the advance netted off the
    // receipt and the inspection adjustments applied after the total.
    d.collRow = function(id){
      var ob       = d.getVal(id, 'open');
      var received = d.getVal(id, 'receipt');          // Daily Entry receipts
      var advance  = Math.min(meAdvanceQty(key, id), received);
      var rec      = received - advance;               // what the statement claims
      var tot      = ob + rec;
      var shortage = d.getVal(id, 'shortage');
      var excess   = d.getVal(id, 'excess');
      var adjusted = tot - shortage + excess;
      var sal      = d.getVal(id, 'sales');
      var cb       = d.hasVal(id, 'close') ? d.getVal(id, 'close') : adjusted - sal;
      return {ob:ob, allot:d.allotQty ? d.allotQty(id) : 0, received:received,
              advance:advance, rec:rec, tot:tot, shortage:shortage, excess:excess,
              adjusted:adjusted, sal:sal, cb:cb};
    };
  }catch(e){}
  return d;
};

// ── BUILDER ─────────────────────────────────────────────────────────────────
// Reassigns the ported buildColl. Same layout and column set as the port, with
// each column now drawing on its own source; the ported original is frozen by
// parity, so this cannot drift away from a moving target.
buildColl = function(d){
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

  var nextMo=STMT_MONTHS[(d.month%12)+1] || '';
  var nextYr=d.month===12 ? d.yr+1 : d.yr;
  var ADV=['BRA','PHH FRK','SUGAR','AAY SUGAR','AAY FRK','WHEAT','T.DHALL','P.OIL'];
  body+=sectionLabel("ADVANCE FOR THE MONTH OF "+nextMo.toUpperCase()+"'"+nextYr);
  ADV.forEach(function(l){ body+='<tr>'+L(l)+C('')+C('')+C('')+C('')+C('')+C('')+'</tr>'; });

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
    '.cl-info{display:flex;font-size:11px;font-weight:bold;margin:4px 2px}',
    '.cl-info span{margin-right:28px}',
    '.cl-tbl{width:100%;border-collapse:collapse;font-size:10px;table-layout:fixed;margin-top:4px}',
    '.cl-tbl th,.cl-tbl td{border:1px solid #000;padding:3px 5px;text-align:center;white-space:nowrap;overflow:hidden}',
    '.cl-tbl th{font-weight:bold;background:#fff;line-height:1.15}',
    '.cl-tbl td.l{text-align:left}',
    '.cl-tbl tr.sub td{font-weight:bold;background:#F5F5F5}',
    '.cl-tbl tr.sec td{font-weight:bold;background:#EDEDED;text-align:left}',
    '.cl-sig{display:flex;justify-content:space-between;margin-top:16px;font-size:10px;font-weight:bold}',
  ].join('');
  var cg='<colgroup><col style="width:22%"><col style="width:13%"><col style="width:11%"><col style="width:16%"><col style="width:12%"><col style="width:12%"><col style="width:14%"></colgroup>';
  var head='<thead><tr>'+
    '<th>COMMODITY</th><th>Opening<br>Balance</th><th>Allotment</th><th>Received from<br>godown</th>'+
    '<th>Total</th><th>Sales</th><th>Closing<br>Balance</th></tr></thead>';

  return '<style>'+css+'</style>'+
    '<div class="cl-wrap">'+
      '<div class="cl-title">MONTHLY SALES REPORT FOR THE MONTH OF '+d.mo.toUpperCase()+"'"+d.yr+'</div>'+
      '<div class="cl-info"><span>CRS '+d.crsId+'</span>'+(crsCode?'<span>'+crsCode+'</span>':'')+'</div>'+
      '<table class="cl-tbl">'+cg+head+'<tbody>'+body+'</tbody></table>'+
      advNote+
      '<div class="cl-sig"><span>BILL CLERK : '+d.bcName+'</span><span>AREA SUPERVISOR</span></div>'+
    '</div>';
};

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
