/* Monthly Sales Entry grid and roll-up from daily
   Verbatim from TNCSC_CRS_Demo_19 (1).html lines 3115-3692.
   These parts are concatenated back into one classic script by
   tools/bundle-engine.mjs - the code hoists across the whole block and
   its declarations must stay global for the markup's inline handlers. */
var monthlyStore = {};
var ME_MONTH_NAMES = ['','January','February','March','April','May','June',
  'July','August','September','October','November','December'];

(function initMeCRS(){
  var sel = document.getElementById('me-crs');
  if(!sel) return;
  // CRS user: show only their shop. Admin: show all 30.
  var list = (currentUser && currentUser.crsId)
    ? CRS_LIST.filter(function(c){ return c.id === currentUser.crsId; })
    : CRS_LIST;
  list.forEach(function(c){
    var opt = document.createElement('option');
    opt.value = String(c.id);
    opt.textContent = 'CRS ' + c.id + ' — ' + c.name;
    sel.appendChild(opt);
  });
})();

// ═══ DAILY \u2192 MONTHLY ACCUMULATION ════════════════════════════════════════
// Rule: whatever is keyed in Daily Entry rolls up automatically into the
// Monthly figures for that CRS + month. A commodity that has NO daily sheet
// in the month can still be keyed straight into Monthly Entry \u2014 those manual
// values live in meManualStore and are never pushed back down to Daily.
//
//   monthlyStore  = the merged result (what Statements read)
//   meManualStore = values typed directly into Monthly Entry
//   meSourceStore = per commodity, 'daily' (derived) or 'manual' (typed)

var meManualStore = {};   // {crsId_month_year: {a:{commId:{field:val}}, b:{...}}}
var meSourceStore = {};   // {crsId_month_year: {a:{commId:'daily'|'manual'}, b:{...}}}

// Roll every daily sheet of one month into per-commodity monthly figures.
function dailyRollupForMonth(crsId, month, year){
  var pad2 = function(n){ return String(n).padStart(2,'0'); };
  var n    = new Date(year, month, 0).getDate();
  var out  = {a:{}, b:{}};
  var days = 0;

  for(var day = 1; day <= n; day++){
    var ds  = year + '-' + pad2(month) + '-' + pad2(day);
    var ent = entryStore[crsId + '_' + ds] || entryStore[String(crsId) + '_' + ds];
    var ins = (typeof inspectionStore !== 'undefined')
            ? (inspectionStore[crsId + '_' + ds] || inspectionStore[String(crsId) + '_' + ds]) : null;
    if(!ent && !ins) continue;
    if(ent) days++;

    ['a','b'].forEach(function(sec){
      var blk  = (ent && ent[sec]) ? ent[sec] : {};
      var iblk = (ins && ins[sec]) ? ins[sec] : {};
      var ids  = Object.keys(blk).concat(Object.keys(iblk).filter(function(k){ return !(k in blk); }));

      ids.forEach(function(id){
        var r = blk[id]  || {};
        var a = iblk[id] || {};
        var t = out[sec][id] || (out[sec][id] = {
          open:null, receipt:0, sales:0, close:0, amount:0,
          excess:0, shortage:0, transfer:0, days:0
        });
        if(blk[id]){
          // A day sheet writes a row for EVERY commodity, so an all-zero row
          // must not count as "this commodity was keyed in Daily Entry".
          var hasVal = (parseFloat(r.open)    || 0) !== 0 ||
                       (parseFloat(r.receipt) || 0) !== 0 ||
                       (parseFloat(r.sales)   || 0) !== 0 ||
                       (parseFloat(r.close)   || 0) !== 0 ||
                       (parseFloat(r.amount)  || 0) !== 0;
          t.receipt += parseFloat(r.receipt) || 0;
          t.sales   += parseFloat(r.sales)   || 0;
          t.amount  += parseFloat(r.amount)  || 0;
          if(hasVal){
            if(t.open === null) t.open = parseFloat(r.open) || 0; // first real sheet's opening
            t.close = parseFloat(r.close) || 0;                   // last real sheet's closing
            t.days++;
          }
        }
        t.excess   += parseFloat(a.excess)   || 0;
        t.shortage += parseFloat(a.shortage) || 0;
        t.transfer += parseFloat(a.transfer) || 0;
      });
    });
  }

  // Finalise: derive Total, and Closing when no sheet supplied one
  ['a','b'].forEach(function(sec){
    Object.keys(out[sec]).forEach(function(id){
      var t = out[sec][id];
      if(t.open === null) t.open = 0;
      t.total = t.open + t.receipt + inspNet(t);   // [C1]
      // Closing is derived so the month always balances:
      //   Opening + Receipt + Excess - Shortage - Transfer - Sales = Closing
      // (identical to the last day sheet's closing when the daily chain is
      //  intact, since each day's adjustment carries into the next opening)
      t.closeFromSheet = t.close;
      t.close = t.total - t.sales;
      var div = bagDiv(id);   // [S1]
      t.g_open    = t.open    > 0 ? Math.floor(t.open    / div) : 0;
      t.g_receipt = t.receipt > 0 ? Math.floor(t.receipt / div) : 0;
      t.g_total   = t.total   > 0 ? Math.floor(t.total   / div) : 0;
      t.g_sales   = t.sales   > 0 ? Math.floor(t.sales   / div) : 0;
      t.g_close   = t.close   > 0 ? Math.floor(t.close   / div) : 0;
    });
  });

  return {data: out, days: days};
}

// Merge the daily roll-up with any manual Monthly-only values and publish the
// result into monthlyStore. Call this whenever Daily Entry or Inspection saves.
function rebuildMonthlyFromDaily(crsId, month, year){
  crsId = String(crsId); month = parseInt(month,10); year = parseInt(year,10);
  if(!crsId || !month || !year) return null;

  var key    = crsId + '_' + month + '_' + year;
  var roll   = dailyRollupForMonth(crsId, month, year);
  var manual = meManualStore[key] || {a:{}, b:{}};
  var merged = {a:{}, b:{}};
  var source = {a:{}, b:{}};

  [['a', DSS_A], ['b', DSS_B]].forEach(function(pair){
    var sec = pair[0], comms = pair[1] || [];
    comms.forEach(function(c){
      var d = roll.data[sec][c.id];
      if(d && (d.days > 0 || d.excess || d.shortage || d.transfer)){
        merged[sec][c.id] = {
          open:d.open, receipt:d.receipt, total:d.total, sales:d.sales,
          close:d.close, amount:d.amount,
          excess:d.excess, shortage:d.shortage, transfer:d.transfer,
          g_open:d.g_open, g_receipt:d.g_receipt, g_total:d.g_total,
          g_sales:d.g_sales, g_close:d.g_close
        };
        source[sec][c.id] = 'daily';
      } else {
        var m = (manual[sec] && manual[sec][c.id]) ? manual[sec][c.id] : null;
        if(m){ merged[sec][c.id] = m; source[sec][c.id] = 'manual'; }
      }
    });
  });

  monthlyStore[key] = merged;
  meSourceStore[key] = source;
  return {key:key, days:roll.days, source:source};
}

// Was this commodity derived from Daily Entry (and therefore read-only above)?
function meIsDerived(key, sec, commId){
  var src = meSourceStore[key];
  return !!(src && src[sec] && src[sec][commId] === 'daily');
}

// Rebuild the month that a given date belongs to
function rebuildMonthlyForDate(crsId, dateStr){
  if(!dateStr) return;
  var p = String(dateStr).split('-');
  if(p.length !== 3) return;
  return rebuildMonthlyFromDaily(crsId, parseInt(p[1],10), parseInt(p[0],10));
}

function onMonthlyChange(){
  var crsId = document.getElementById('me-crs').value;
  var month = document.getElementById('me-month').value;
  var year  = document.getElementById('me-year').value;
  var empty = document.getElementById('me-empty');
  var wrap  = document.getElementById('me-form-wrap');
  var stmt  = document.getElementById('me-stmt-wrap');
  if(!crsId||!month||!year){
    if(empty) empty.style.display='block';
    if(wrap)  wrap.style.display='none';
    return;
  }
  if(empty) empty.style.display='none';
  if(wrap)  wrap.style.display='block';
  if(stmt)  stmt.style.display='none';
  var crs = CRS_LIST.find(function(c){ return String(c.id)===crsId; });
  var tEl = document.getElementById('me-title');
  var sEl = document.getElementById('me-sub');
  if(tEl&&crs) tEl.textContent='CRS '+crs.id+' — '+crs.name;
  if(sEl) sEl.textContent=ME_MONTH_NAMES[parseInt(month)]+' '+year+' — Monthly Sales Entry';
  var key=crsId+'_'+month+'_'+year;
  // Pull in anything keyed in Daily Entry for this month before painting
  rebuildMonthlyFromDaily(crsId, month, year);
  renderMeSection('me-tbody-a',DSS_A,'a',key);
  renderMeSection('me-tbody-b',DSS_B,'b',key);
  applyAdjColVisibility(['me-tbody-a','me-tbody-b'], ['me-a-foot','me-b-foot'],
                        inspFlagsForMonth(crsId, parseInt(month,10), parseInt(year,10)));
  // [+] re-apply with record-carried flags too (imported shortage/excess/transfer + C.S)
  applyAdjColVisibility(['me-tbody-a','me-tbody-b'], ['me-a-foot','me-b-foot'], meAdjFlags(key, crsId, parseInt(month,10), parseInt(year,10))); // [+]
  recalcMe();
  var succ=document.getElementById('me-success');
  if(succ) succ.style.display='none';
  // Build monthly remittance table + gunny stock + card details
  setTimeout(function(){
    if(typeof buildMeRemitTable==='function') buildMeRemitTable();
    if(typeof buildMeGunnyTable==='function') buildMeGunnyTable();
    if(typeof buildMeCardTable==='function') buildMeCardTable();
  }, 80);
}

function renderMeSection(tbodyId,comms,sec,key){
  var tbody=document.getElementById(tbodyId);
  if(!tbody) return;
  var saved=monthlyStore[key]?monthlyStore[key][sec]:null;
  tbody.innerHTML='';

  // Bag size divisors per commodity
  // [S1] uses the global BAG_DIV / bagDiv()
  function kgsToGunny(kgs,id){ return kgs>0 ? Math.floor(kgs/bagDiv(id)) : ''; }

  // Which commodities use gunny bags
  var NO_GUNNY = {EMPTY_BOX:1,EMPTY_BAG:1,PB_SUGAR:1,PB_WHEAT:1,PB_TOOR:1,PB_PALM:1};
  function hasGunny(id){ return !NO_GUNNY[id]; }

  comms.forEach(function(c,i){
    var sv  = saved&&saved[c.id] ? saved[c.id] : {};
    var bg  = i%2===0 ? '#fff' : '#FAFCFF';
    var bdr = sec==='a' ? '1px solid #EFF6FF' : '1px solid #FFF7ED';
    var useGunny = hasGunny(c.id);

    // Saved numeric values
    var fv = {};
    ['open','receipt','total','sales','close','amount'].forEach(function(f){
      fv[f] = sv[f]!==undefined && sv[f]!=='' ? parseFloat(sv[f]) : 0;
    });

    // Commodities that came up from Daily Entry are read-only here
    var derived = meIsDerived(key, sec, c.id);

    // ── Kgs input ─────────────────────────────────────────────────────────────
    function minp(field, ro, extraStyle){
      // Opening / Receipt / Sales are locked when the figure was accumulated
      // from Daily Entry — edit the day sheet instead.
      if(derived && (field==='open'||field==='receipt'||field==='sales')) ro = true;
      var v = sv[field]!==undefined && sv[field]!=='' ? Number(sv[field]).toFixed(3) : '';
      var bgRo  = ro ? 'background:#F8FAFC;color:var(--muted);' : '';
      if(derived && (field==='open'||field==='receipt'||field==='sales'))
        bgRo = 'background:#F0F9FF;color:#0369A1;font-weight:700;';
      var bgAmt = '';
      if(field==='amount') bgAmt = (sec==='a'?'background:#EFF6FF;color:#0369A1;':'background:#FFF3E8;color:#C2410C;')+'font-weight:700;';
      if(field==='total')  bgAmt = 'background:#EFF6FF;color:#0284C7;font-weight:700;';
      return '<input type="number" min="0" step="0.001"'+(ro?' readonly':'')+
        (derived?' title="Accumulated from Daily Entry — edit the day sheet to change this"':'')+
        ' placeholder="0.000" value="'+v+'"'+
        ' data-id="'+c.id+'" data-sec="'+sec+'" data-field="'+field+'"'+
        (ro ? '' : ' onchange="onMeFieldChange(this)" oninput="meKgsInput(this)" onkeydown="meEntryNav(event,this)"')+
        ' style="width:100%;border:1px solid #E2E8F0;border-radius:5px;padding:4px 5px;font-size:11px;text-align:right;'+bgRo+bgAmt+(extraStyle||'')+'"/>';
    }

    // ── Gunny input cell ───────────────────────────────────────────────────────
    // Gunny is EDITABLE — auto-filled from saved kgs, can be manually overridden
    function gunnyCell(field, kgsVal, isTot){
      if(!useGunny){
        return '<td style="padding:3px 4px;text-align:center;font-size:10px;color:#D1D5DB;'+
               'border-bottom:'+bdr+';border-right:1px solid #E2E8F0;background:#FAFAFA">\u2014</td>';
      }
      // Calculate gunny from saved kgs value
      var g = kgsToGunny(kgsVal, c.id);
      // [+] The record may carry its own bag count (imported from the office
      // [+] workbook, or hand-typed) that differs from the kgs-derived one —
      // [+] office bags are not exactly 50 kg. The saved count wins, and the
      // [+] cell is flagged manual so recalc does not floor it away again.
      var gSaved = sv['g_'+field];                                                        // [+]
      var gManual = gSaved !== undefined && gSaved !== '' && Number(gSaved) > 0 &&        // [+]
                    Number(gSaved) !== Number(g || 0);                                    // [+]
      if(gManual) g = Number(gSaved);                                                     // [+]
      var bg2  = isTot ? '#DBEAFE' : '#FFFBEB';
      var colr = isTot ? '#0369A1' : '#92400E';
      var bord = isTot ? '#BAE6FD' : '#FDE047';
      return '<td style="padding:2px 3px;border-bottom:'+bdr+';border-right:1px solid #E2E8F0;background:'+bg2+'">'+
        '<input type="number" min="0" step="1"'+
          ' id="me-gunny-'+field+'-'+c.id+'-'+sec+'"'+
          ' data-id="'+c.id+'" data-sec="'+sec+'" data-field="gunny_'+field+'"'+
          ' value="'+g+'"'+
          (gManual ? ' data-manual-edit="1"' : '')+  // [+] keeps updateMeGunny from recomputing it
          ' placeholder=""'+
          ' oninput="meGunnyManualEdit(this)" onkeydown="meEntryNav(event,this)"'+
          ' style="width:42px;border:1px solid '+bord+';border-radius:4px;padding:3px 4px;'+
                 'font-size:11px;font-weight:800;text-align:center;color:'+colr+';background:#fff"/>'+
        '</td>';
    }

    // Rate + Amount cells
    var rateHtml = c.free
      ? '<span style="color:#16A34A;font-weight:600;font-size:10px">Free</span>'
      : '<span style="font-weight:700;font-size:11px;color:#D97706">\u20b9'+c.rate.toFixed(2)+'</span>';
    var amtCell = c.free
      ? '<div style="text-align:center;padding:5px;font-size:11px;color:#16A34A;font-style:italic">\u0bb5\u0bbf\u0bb2\u0bc8\u0baf\u0bbf\u0bb2\u0bcd\u0bb2\u0bbe</div>'
      : minp('amount',true,'');

    // Inspection adjustments for the whole month (key is crsId_month_year)
    var _kp = String(key).split('_');
    var mAdj = inspAdjForMonth(parseInt(_kp[0],10), parseInt(_kp[1],10), parseInt(_kp[2],10), sec, c.id);
    // [+] A record imported from the office workbook carries its own
    // [+] excess/shortage/transfer figures (keyed straight off the sheet
    // [+] columns) with no matching inspection entries — fall back to those.
    if(!mAdj.excess && !mAdj.shortage && !mAdj.transfer){        // [+]
      mAdj = {excess:   parseFloat(sv.excess)   || 0,            // [+]
              shortage: parseFloat(sv.shortage) || 0,            // [+]
              transfer: parseFloat(sv.transfer) || 0};           // [+]
    }                                                            // [+]
    var csVal = parseFloat(sv.cs) || 0; // [+] C.S — cumulative shortage, deducted after Total

    var tr=document.createElement('tr');
    tr.style.background=bg;
    tr.dataset.id=c.id; tr.dataset.sec=sec;
    tr.dataset.rate=String(c.rate); tr.dataset.free=c.free?'1':'0';
    tr.dataset.excess=String(mAdj.excess);
    tr.dataset.shortage=String(mAdj.shortage);
    tr.dataset.transfer=String(mAdj.transfer);
    tr.dataset.cs=String(csVal); // [+]
    tr.dataset.derived=derived?'1':'0';
    tr.innerHTML=[
      '<td style="padding:7px 6px;text-align:center;font-size:11px;color:var(--muted);border-bottom:'+bdr+';border-right:1px solid #E2E8F0">'+(i+1)+'</td>',
      '<td style="padding:7px 10px;border-bottom:'+bdr+';border-right:1px solid #E2E8F0">'+
        '<div style="font-weight:600;font-size:12px">'+c.ta+'</div>'+
        '<div style="font-size:10px;color:var(--muted)">'+c.en+'</div>'+
        (derived
          ? '<div style="display:inline-block;margin-top:3px;background:#DBEAFE;color:#1D4ED8;border:1px solid #BFDBFE;'+
            'font-size:9px;font-weight:700;padding:1px 6px;border-radius:4px">\u2191 from Daily</div>'
          : '')+
      '</td>',
      '<td style="padding:7px 5px;text-align:center;font-size:11px;color:var(--muted);border-bottom:'+bdr+';border-right:1px solid #E2E8F0">'+c.unit+'</td>',
      // Opening
      gunnyCell('open',    fv.open,    false),
      '<td style="padding:3px 4px;border-bottom:'+bdr+';border-right:1px solid #CBD5E1">'+minp('open',false,'')+'</td>',
      // Receipt
      gunnyCell('receipt', fv.receipt, false),
      '<td style="padding:3px 4px;border-bottom:'+bdr+';border-right:1px solid #CBD5E1">'+minp('receipt',false,'font-weight:600;')+'</td>',
      // Inspection adjustments (read-only — keyed in the Inspection screen)
      inspCell(mAdj.excess,  'excess',   bdr),
      inspCell(mAdj.shortage,'shortage', bdr),
      inspCell(mAdj.transfer,'transfer', bdr),
      // Total
      gunnyCell('total',   fv.total,   true),
      '<td style="padding:3px 4px;border-bottom:'+bdr+';background:#EFF6FF;border-right:1px solid #CBD5E1">'+minp('total',true,'')+'</td>',
      // Sales
      gunnyCell('sales',   fv.sales,   false),
      '<td style="padding:3px 4px;border-bottom:'+bdr+';border-right:1px solid #CBD5E1">'+minp('sales',false,'font-weight:700;')+'</td>',
      inspCell(csVal, 'cs', bdr), // [+] C.S — read-only, column hidden when the month has none
      // Closing
      gunnyCell('close',   fv.close,   false),
      '<td style="padding:3px 4px;border-bottom:'+bdr+';border-right:1px solid #CBD5E1">'+minp('close',true,'')+'</td>',
      // Rate
      '<td style="padding:5px 4px;text-align:center;border-bottom:'+bdr+';border-right:1px solid #E2E8F0;background:#FFFBEB">'+rateHtml+'</td>',
      // Amount
      '<td style="padding:3px 4px;border-bottom:'+bdr+'">'+amtCell+'</td>',
    ].join('');
    tbody.appendChild(tr);
  });
}

// When Kgs changes → auto-update Gunny (unless manually edited)
function updateMeGunny(inp){
  var id    = inp.dataset.id;
  var sec   = inp.dataset.sec;
  var field = inp.dataset.field;  // 'open','receipt','total','sales','close'
  var div = bagDiv(id);   // [S1]
  var val = parseFloat(inp.value) || 0;

  // Find gunny input: first try by id, fallback to row traversal
  var gEl = document.getElementById('me-gunny-' + field + '-' + id + '-' + sec);
  if(!gEl){
    // Fallback: find by data attributes in same row
    var tr = inp.closest('tr');
    if(tr) gEl = tr.querySelector('[data-field="gunny_' + field + '"]');
  }
  if(!gEl) return;
  if(gEl.dataset.manualEdit) return; // user manually overrode
  gEl.value = val > 0 ? String(Math.floor(val / div)) : '';
}

// When Gunny is manually edited — mark as manual so Kgs changes don't override it
function meGunnyManualEdit(inp){
  var v = inp.value.trim();
  if(v === '' || v === '0'){
    // User cleared → remove manual flag, auto-calc will take over next time kgs changes
    delete inp.dataset.manualEdit;
  } else {
    // User typed a number → mark as manually edited
    inp.dataset.manualEdit = '1';
  }
  // Rule 2: gunny-sales edits flow straight into the Gunny-section Receipt
  if(inp.dataset.field === 'gunny_sales' && typeof meGunnyRefreshReceipts === 'function') meGunnyRefreshReceipts();
}

// Update gunny cells when a field changes in monthly entry
// (single implementation above — a duplicate that wrote .textContent on the
// <input> and ignored the manual-edit flag used to shadow it; removed)

function onMeFieldChange(inp){
  var v=parseFloat(inp.value);
  if(isNaN(v)||v<0){inp.value='';v=0;}
  var tr=inp.closest('tr'); if(!tr) return;
  function mget(f){var e=tr.querySelector('[data-field="'+f+'"]');return e?parseFloat(e.value)||0:0;}
  function mset(f,val){var e=tr.querySelector('[data-field="'+f+'"]');if(e)e.value=val.toFixed(3);}
  var open=mget('open'),rec=mget('receipt'),sales=mget('sales');
  var tot=open+rec+inspNet(inspFromRow(tr));
  mset('total',tot);
  var mClose=tot-sales;
  mset('close',mClose);
  var _cs=parseFloat(tr.dataset.cs)||0;                     // [+]
  if(_cs){ mClose=tot-sales-_cs; mset('close',mClose); }    // [+] C.S deducted after Total
  entryPaintClose(inp.closest('tr'), mClose);
  if(tr.dataset.free==='0'){
    var aEl=tr.querySelector('[data-field="amount"]');
    if(aEl) aEl.value=(sales*parseFloat(tr.dataset.rate||0)).toFixed(2);
  }
  recalcMe();
  // Update ALL gunny fields in this row after calculation
  var tr3 = inp.closest('tr');
  if(tr3){
    ['open','receipt','total','sales','close'].forEach(function(f){
      var kgsInp = tr3.querySelector('[data-field="'+f+'"]');
      if(kgsInp) updateMeGunny(kgsInp);
    });
  }
  // Rule 2: Gunny-section Receipt auto-follows Monthly Sales gunny counts
  if(typeof meGunnyRefreshReceipts === 'function') meGunnyRefreshReceipts();
}

function recalcMe(){
  var amtA=0,salesA=0,amtB=0,salesB=0;
  var fmt=function(n){return '₹'+n.toLocaleString('en-IN',{minimumFractionDigits:2,maximumFractionDigits:2});};
  // Column sums for the footer rows (kgs and gunny/bag counts)
  var SUM={a:{open:0,rec:0,ex:0,sh:0,tr:0,total:0,close:0,gopen:0,grec:0,gtotal:0,gsales:0,gclose:0},
           b:{open:0,rec:0,ex:0,sh:0,tr:0,total:0,close:0,gopen:0,grec:0,gtotal:0,gsales:0,gclose:0}};
  SUM.a.cs=0; SUM.b.cs=0; // [+]
  function proc(comms,tbId,s){
    comms.forEach(function(c){
      var tr=document.querySelector('#'+tbId+' tr[data-id="'+c.id+'"]');
      if(!tr) return;
      function mget(f){var e=tr.querySelector('[data-field="'+f+'"]');return e?parseFloat(e.value)||0:0;}
      function mset(f,val){var e=tr.querySelector('[data-field="'+f+'"]');if(e)e.value=val.toFixed(3);}
      var open=mget('open'),rec=mget('receipt'),sales=mget('sales');
      var adj=inspFromRow(tr);
      var tot=open+rec+inspNet(adj);
      var rcv=tot-sales;
      mset('total',tot); mset('close',rcv);
      var csv=parseFloat(tr.dataset.cs)||0;                   // [+]
      if(csv){ rcv=tot-sales-csv; mset('close',rcv); }        // [+] C.S deducted after Total
      entryPaintClose(tr, rcv);
      // keep the Gunny sub-columns in step with the recomputed Kgs
      ['total','close'].forEach(function(f){
        var ki=tr.querySelector('[data-field="'+f+'"]');
        if(ki && typeof updateMeGunny==='function') updateMeGunny(ki);
      });

      var acc=SUM[s];
      acc.open+=open; acc.rec+=rec; acc.total+=tot; acc.close+=rcv;
      acc.ex+=adj.excess; acc.sh+=adj.shortage; acc.tr+=adj.transfer;
      acc.cs+=csv; // [+]
      ['open','receipt','total','sales','close'].forEach(function(f){
        var ge=tr.querySelector('[data-field="gunny_'+f+'"]');
        var gv=ge?(parseFloat(ge.value)||0):0;
        var kk={open:'gopen',receipt:'grec',total:'gtotal',sales:'gsales',close:'gclose'}[f];
        acc[kk]+=gv;
      });
      if(!c.free){
        var amt=sales*c.rate;
        var aEl=tr.querySelector('[data-field="amount"]');
        if(aEl) aEl.value=amt.toFixed(2);
        if(s==='a') amtA+=amt; else amtB+=amt;
      }
      if(s==='a') salesA+=sales; else salesB+=sales;
    });
  }
  proc(DSS_A,'me-tbody-a','a');
  proc(DSS_B,'me-tbody-b','b');
  var grand=amtA+amtB;
  function el(id){return document.getElementById(id);}
  ['a','b'].forEach(function(k){
    var acc=SUM[k];
    ['open','rec','ex','sh','tr','total','close'].forEach(function(f){
      var e=el('me-'+k+'-'+f); if(e) e.textContent=acc[f].toFixed(3);
    });
    var eCs=el('me-'+k+'-cs'); if(eCs) eCs.textContent=(acc.cs||0).toFixed(3); // [+]
    ['gopen','grec','gtotal','gsales','gclose'].forEach(function(f){
      var e=el('me-'+k+'-'+f); if(e) e.textContent=String(Math.round(acc[f]));
    });
  });
  if(el('me-a-sales')) el('me-a-sales').textContent=salesA.toFixed(3);
  if(el('me-a-amt'))   el('me-a-amt').textContent=fmt(amtA);
  if(el('me-b-sales')) el('me-b-sales').textContent=salesB.toFixed(3);
  if(el('me-b-amt'))   el('me-b-amt').textContent=fmt(amtB);
  if(el('me-sum-a'))   el('me-sum-a').textContent=fmt(amtA);
  if(el('me-sum-b'))   el('me-sum-b').textContent=fmt(amtB);
  if(el('me-sum-grand')) el('me-sum-grand').textContent=fmt(grand);
  if(el('me-grand-total')) el('me-grand-total').textContent=fmt(grand);
}

function saveMonthlyEntry(){
  var crsId=document.getElementById('me-crs').value;
  var month=document.getElementById('me-month').value;
  var year=document.getElementById('me-year').value;
  if(!crsId||!month||!year) return;
  var key=crsId+'_'+month+'_'+year;

  // Only commodities WITHOUT daily sheets are editable here; those are stored
  // as manual monthly values. Daily-derived rows are left to the roll-up so a
  // save never overwrites what the day sheets say.
  if(!meManualStore[key]) meManualStore[key]={a:{},b:{}};
  var manual=meManualStore[key];
  manual.a=manual.a||{}; manual.b=manual.b||{};

  function collect(comms,tbId,s){
    comms.forEach(function(c){
      var tr=document.querySelector('#'+tbId+' tr[data-id="'+c.id+'"]');
      if(!tr) return;
      if(tr.dataset.derived==='1') return;          // accumulated — skip
      function mget(f){var e=tr.querySelector('[data-field="'+f+'"]');return e?parseFloat(e.value)||0:0;}
      var mAdj=inspFromRow(tr);
      var rec={open:mget('open'),receipt:mget('receipt'),total:mget('total'),
               sales:mget('sales'),close:mget('close'),amount:mget('amount'),
               excess:mAdj.excess,shortage:mAdj.shortage,transfer:mAdj.transfer,
               g_open:mget('gunny_open'),g_receipt:mget('gunny_receipt'),g_total:mget('gunny_total'),
               g_sales:mget('gunny_sales'),g_close:mget('gunny_close')};
      var empty=!rec.open&&!rec.receipt&&!rec.sales&&!rec.close&&!rec.amount;
      rec.cs=parseFloat(tr.dataset.cs)||0;   // [+] preserve imported C.S across saves
      if(rec.cs) empty=false;                // [+]
      if(empty) delete manual[s][c.id]; else manual[s][c.id]=rec;
    });
  }
  collect(DSS_A,'me-tbody-a','a');
  collect(DSS_B,'me-tbody-b','b');

  // Republish monthlyStore = daily roll-up + these manual values
  rebuildMonthlyFromDaily(crsId, month, year);
  // Remittance data is already live in meRemitStore (updated on input change)
  // Gunny stock data is already live in meGunnyStore (updated on input change)
  // Card data is already live in meCardStore (updated on input change)
  // All four stores are persisted in memory as a single logical transaction
  var succ=document.getElementById('me-success');
  if(succ){succ.style.display='flex';setTimeout(function(){succ.style.display='none';},4000);}
}

function clearMonthlyForm(){
  document.querySelectorAll('#me-tbody-a input:not([readonly]),#me-tbody-b input:not([readonly])').forEach(function(i){i.value='';});
  document.querySelectorAll('#me-tbody-a input[readonly],#me-tbody-b input[readonly]').forEach(function(i){i.value='';});
  recalcMe();
}

function generateMonthlyStatement(){
  var crsId=document.getElementById('me-crs').value;
  var month=parseInt(document.getElementById('me-month').value);
  var year=document.getElementById('me-year').value;
  if(!crsId){alert('Please select a CRS shop first.');return;}
  var crs=CRS_LIST.find(function(c){return String(c.id)===crsId;});
  var key=crsId+'_'+month+'_'+year;
  var saved=monthlyStore[key]||{a:{},b:{}};
  var fmt=function(n){return n?'₹'+parseFloat(n).toLocaleString('en-IN',{minimumFractionDigits:2}):'—';};
  var fq=function(n){return n?parseFloat(n).toFixed(3):'—';};

  function buildStmtTbl(comms,data,title,color){
    var rows=comms.map(function(c,i){
      var sv=data&&data[c.id]?data[c.id]:{};
      var amtTd=c.free
        ? '<td style="text-align:center;color:#16A34A;font-style:italic;font-size:11px">விலையில்லா</td>'
        : '<td style="text-align:right;font-weight:700;color:'+color+'">'+fmt(sv.amount)+'</td>';
      return '<tr style="background:'+(i%2?'#FAFCFF':'#fff')+'">'+
        '<td style="padding:7px 8px;text-align:center;font-size:11px;color:#888;border-bottom:1px solid #F1F5F9">'+(i+1)+'</td>'+
        '<td style="padding:7px 12px;border-bottom:1px solid #F1F5F9"><div style="font-weight:600;font-size:12px">'+c.ta+'</div><div style="font-size:10px;color:#888">'+c.en+'</div></td>'+
        '<td style="padding:7px 8px;text-align:center;font-size:11px;border-bottom:1px solid #F1F5F9">'+c.unit+'</td>'+
        '<td style="padding:7px 8px;text-align:right;font-size:11px;border-bottom:1px solid #F1F5F9">'+fq(sv.open)+'</td>'+
        '<td style="padding:7px 8px;text-align:right;font-weight:600;border-bottom:1px solid #F1F5F9">'+fq(sv.receipt)+'</td>'+
        '<td style="padding:7px 8px;text-align:right;font-weight:700;background:#EFF6FF;color:#0284C7;border-bottom:1px solid #F1F5F9">'+fq(sv.total)+'</td>'+
        '<td style="padding:7px 8px;text-align:right;font-weight:700;border-bottom:1px solid #F1F5F9">'+fq(sv.sales)+'</td>'+
        '<td style="padding:7px 8px;text-align:right;border-bottom:1px solid #F1F5F9">'+fq(sv.close)+'</td>'+
        amtTd+'</tr>';
    }).join('');
    var thStyle='padding:8px;font-size:10px;color:#888;border-bottom:1px solid #ddd;';
    return '<div style="margin-bottom:14px">'+
      '<div style="background:'+color+';color:#fff;padding:8px 14px;font-weight:800;font-size:12px;border-radius:6px 6px 0 0">'+title+'</div>'+
      '<div style="overflow-x:auto"><table style="width:100%;border-collapse:collapse;min-width:680px">'+
      '<thead><tr style="background:#F8FAFC">'+
        '<th style="'+thStyle+';text-align:center">#</th>'+
        '<th style="'+thStyle+';text-align:left;padding:8px 12px">Commodity</th>'+
        '<th style="'+thStyle+';text-align:center">Unit</th>'+
        '<th style="'+thStyle+';text-align:center">Opening</th>'+
        '<th style="'+thStyle+';text-align:center">Receipt</th>'+
        '<th style="'+thStyle+';text-align:center;color:#0284C7;background:#EFF6FF">Total</th>'+
        '<th style="'+thStyle+';text-align:center">Sales</th>'+
        '<th style="'+thStyle+';text-align:center">Closing</th>'+
        '<th style="'+thStyle+';text-align:center">Amount (₹)</th>'+
      '</tr></thead><tbody>'+rows+'</tbody></table></div></div>';
  }

  var stmtHtml=
    '<div style="text-align:center;margin-bottom:14px;padding:14px;background:linear-gradient(135deg,#0369A1,#0EA5E9);border-radius:10px">'+
      '<div style="color:#fff;font-size:15px;font-weight:800">Tamil Nadu Civil Supplies Corporation</div>'+
      '<div style="color:rgba(255,255,255,.8);font-size:12px;margin-top:2px">Monthly Statement — Civil Ration Shop</div>'+
      '<div style="color:#fff;font-weight:700;font-size:13px;margin-top:5px">'+(crs?'CRS '+crs.id+' — '+crs.name:'')+' | '+ME_MONTH_NAMES[month]+' '+year+'</div>'+
    '</div>'+
    (crs ? buildUserSignatureBlock(crs.id) : '')+
    buildStmtTbl(DSS_A,saved.a,'SECTION A — நியாய வகுப்பு / Main Ration','#0369A1')+
    buildStmtTbl(DSS_B,saved.b,'SECTION B — காவலர் அட்டை / Police Ration','#C2410C');

  var wrap=document.getElementById('me-stmt-wrap');
  var cont=document.getElementById('me-stmt-content');
  var lbl=document.getElementById('me-stmt-label');
  if(cont) cont.innerHTML=stmtHtml;
  if(lbl&&crs) lbl.textContent='CRS '+crs.id+' — '+crs.name+' · '+ME_MONTH_NAMES[month]+' '+year;
  if(wrap){wrap.style.display='block';wrap.scrollIntoView({behavior:'smooth',block:'start'});}
}


// ═══ USER MANAGEMENT ══════════════════════════════════════════════════════
// In-memory user store. DB-ready structure:
// Each user: { id, fullName, username, phone, email, role, crsId, password, active, createdAt }
// One CRS can have multiple users; each user has role BC or Packer.

