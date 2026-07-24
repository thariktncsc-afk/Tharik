/* Reports page + PV statement builder
   Verbatim from TNCSC_CRS_Demo_19 (1).html lines 2747-3114.
   These parts are concatenated back into one classic script by
   tools/bundle-engine.mjs - the code hoists across the whole block and
   its declarations must stay global for the markup's inline handlers. */
var _rptType = 'monthly';
var MNAMES = ['','January','February','March','April','May','June','July','August','September','October','November','December'];

function switchReport(type){
  _rptType = type;
  ['daily','monthly','quarterly','yearly'].forEach(function(t){
    var b=document.getElementById('r-'+t);
    if(b) b.className = t===type ? 'btn btn-primary btn-sm' : 'btn btn-outline btn-sm';
  });
  // Show/hide filter controls depending on mode
  var isPV = (type==='quarterly'||type==='yearly');
  var el = function(id){return document.getElementById(id);};
  if(el('rpt-date-wrap'))    el('rpt-date-wrap').style.display    = type==='daily'    ? '' : 'none';
  if(el('rpt-month-wrap'))   el('rpt-month-wrap').style.display   = (type==='daily'||type==='monthly') ? '' : 'none';
  if(el('rpt-quarter-wrap')) el('rpt-quarter-wrap').style.display = type==='quarterly' ? '' : 'none';
  if(el('rpt-year-wrap'))    el('rpt-year-wrap').style.display    = type==='yearly'   ? '' : 'none';
  if(el('rpt-pv-actions'))   el('rpt-pv-actions').style.display   = isPV ? 'flex' : 'none';
  if(el('rpt-kpi-row'))      el('rpt-kpi-row').style.display      = isPV ? 'none' : '';
  generateReport();
}

function initReportPage(){
  var crsEl=document.getElementById('rpt-crs'), moEl=document.getElementById('rpt-month'), dateEl=document.getElementById('rpt-date');
  var qEl=document.getElementById('rpt-quarter-start'), yrEl=document.getElementById('rpt-year-sel');
  if(!crsEl||!moEl) return;
  var isAdmin=currentUser&&currentUser.role==='ADMIN';
  // CRS dropdown
  crsEl.innerHTML='';
  if(isAdmin){
    var a=document.createElement('option'); a.value=''; a.textContent='All CRS Shops'; crsEl.appendChild(a);
    CRS_LIST.forEach(function(c){ var o=document.createElement('option'); o.value=String(c.id); o.textContent='CRS '+c.id+' \u2014 '+c.name; crsEl.appendChild(o); });
    crsEl.disabled=false; crsEl.style.background=''; crsEl.style.color='';
  } else if(currentUser&&currentUser.crsId){
    var crs=CRS_LIST.find(function(c){return c.id===currentUser.crsId;});
    var o2=document.createElement('option'); o2.value=String(currentUser.crsId); o2.textContent='CRS '+currentUser.crsId+(crs?' \u2014 '+crs.name:''); crsEl.appendChild(o2);
    crsEl.disabled=true; crsEl.style.background='#F1F5F9'; crsEl.style.color='#64748B';
  }
  // Month dropdown (last 24 months)
  moEl.innerHTML='';
  var now=new Date();
  for(var back=0;back<24;back++){
    var d=new Date(now.getFullYear(),now.getMonth()-back,1);
    var o3=document.createElement('option'); o3.value=d.getFullYear()+'-'+String(d.getMonth()+1).padStart(2,'0');
    o3.textContent=MNAMES[d.getMonth()+1]+' '+d.getFullYear(); if(back===0) o3.selected=true; moEl.appendChild(o3);
  }
  // Quarter start dropdown (last 8 quarters)
  if(qEl){
    qEl.innerHTML='';
    for(var back2=0;back2<8;back2++){
      var qd=new Date(now.getFullYear(),now.getMonth()-back2*3,1);
      var qv=qd.getFullYear()+'-'+String(qd.getMonth()+1).padStart(2,'0');
      var endMo=new Date(qd.getFullYear(),qd.getMonth()+3,0);
      var label=MNAMES[qd.getMonth()+1]+' '+qd.getFullYear()+' \u2014 '+MNAMES[endMo.getMonth()+1]+' '+endMo.getFullYear();
      var oq=document.createElement('option'); oq.value=qv; oq.textContent=label; if(back2===0) oq.selected=true; qEl.appendChild(oq);
    }
  }
  // Year dropdown (last 4 financial years Apr-Mar)
  if(yrEl){
    yrEl.innerHTML='';
    var curFY = now.getMonth()>=3 ? now.getFullYear() : now.getFullYear()-1;
    for(var fy=curFY;fy>=curFY-3;fy--){
      var oyy=document.createElement('option'); oyy.value=String(fy); oyy.textContent=fy+'-'+String(fy+1).slice(-2)+' (Apr '+fy+' \u2014 Mar '+(fy+1)+')'; if(fy===curFY) oyy.selected=true; yrEl.appendChild(oyy);
    }
  }
  if(dateEl&&!dateEl.value) dateEl.value=now.toISOString().split('T')[0];
  // Init tab UI
  switchReport(_rptType);
}

// ── AGGREGATE DATA FOR A PERIOD ───────────────────────────────────────────
function pvAggregatePeriod(crsIds, months){
  // months = [{year,month},...] list of {year, month(1-12)} to sum over
  var commMap={}, totalSales=0, totalReceipts=0, daysSet=new Set();
  crsIds.forEach(function(cid){
    months.forEach(function(ym){
      var daysInMo=new Date(ym.year,ym.month,0).getDate();
      for(var d=1;d<=daysInMo;d++){
        var dk=cid+'_'+ym.year+'-'+String(ym.month).padStart(2,'0')+'-'+String(d).padStart(2,'0');
        var e=entryStore[dk]; if(!e) continue;
        daysSet.add(dk);
        ['a','b'].forEach(function(sec){
          Object.keys(e[sec]||{}).forEach(function(commId){
            var row=e[sec][commId], qty=parseFloat(row.sales)||0, amt=parseFloat(row.amount)||0;
            totalSales+=amt;
            if(!commMap[commId]){
              var cm=(DSS_A||[]).concat(DSS_B||[]).find(function(x){return x.id===commId;})||{};
              commMap[commId]={name:cm.en||commId, unit:cm.unit||'KG', open:0, receipt:0, total:0, issues:0, closing:0, amount:0, free:!!cm.free, sec:cm.id&&(DSS_B||[]).find(function(x){return x.id===commId;})?'police':'main'};
            }
            commMap[commId].issues+=qty; commMap[commId].amount+=amt;
          });
        });
      }
      // receipts for this month from receiptStore
      (receiptStore||[]).forEach(function(r){
        if(!crsIds.includes(r.crsId)) return;
        var rp=r.date.split('-'); if(parseInt(rp[0])!==ym.year||parseInt(rp[1])!==ym.month) return;
        Object.keys(r.items||{}).forEach(function(k){ totalReceipts+=parseFloat(r.items[k])||0; });
      });
      // Opening and closing from monthlyStore
      crsIds.forEach(function(cid2){
        var moKey=cid2+'_'+ym.month+'_'+ym.year;
        var ms=typeof monthlyStore!=='undefined'?monthlyStore[moKey]:null;
        if(!ms) return;
        ['a','b'].forEach(function(sec){
          Object.keys(ms[sec]||{}).forEach(function(commId){
            if(!commMap[commId]) return;
            var sv=ms[sec][commId]||{};
            // Use the first month's opening as the period opening
            if(!commMap[commId]._openSet){ commMap[commId].open=(parseFloat(sv.open)||0); commMap[commId]._openSet=true; }
            commMap[commId].receipt+=(parseFloat(sv.receipt)||0);
          });
        });
      });
    });
  });
  // Derive total & closing
  Object.keys(commMap).forEach(function(k){
    var r=commMap[k]; r.total=(r.open||0)+(r.receipt||0); r.closing=Math.max(0,r.total-r.issues);
  });
  return {commMap:commMap,totalSales:totalSales,totalReceipts:totalReceipts,days:daysSet.size};
}

// ── BUILD PV STATEMENT HTML ───────────────────────────────────────────────
function buildPVTable(commMap, periodLabel, crsLabel, crsId, pvOfficer, billClerk){
  var fmtN = function(v){ if(v===undefined||v===null||v===0) return '0'; var n=Number(v); return Number.isInteger(n)?String(n):n.toFixed(3); };
  var fmtB = function(kgs,div){ if(!kgs) return '0'; return String(Math.floor(kgs/(div||50))); };

  // PV statement has separate sections: main, gunny, police
  var mainComms=[], policeComms=[], gunnyComms=['ss50','poly','cbox'];
  (DSS_A||[]).forEach(function(c){ if(commMap[c.id]) mainComms.push(c.id); });
  (DSS_B||[]).forEach(function(c){ if(commMap[c.id]) policeComms.push(c.id); });

  // Cell helpers for the PV table
  function C(v,cls,span){
    return '<td'+(cls?' class="'+cls+'"':'')+' style="border:1px solid #000;padding:2px 4px;text-align:center;font-size:8.5px;white-space:nowrap"'+(span?' colspan="'+span+'"':'')+'>'+(v===undefined||v===null?'':v)+'</td>';
  }
  function L(v){ return '<td style="border:1px solid #000;padding:2px 6px;font-size:8.5px;font-weight:600">'+v+'</td>'; }
  function dataRow(sl, label, unit, bags_ob, kgs_ob, bags_rec, kgs_rec, kgs_transfer, bags_tot, kgs_tot, bags_iss, kgs_iss, bags_bal, kgs_bal){
    return '<tr>'+
      C(sl)+L(label)+C(unit)+C('')+ // SL,Commodity,Unit,StackNo
      C('')+C('')+                   // period from/to
      C(bags_ob||'0')+C(kgs_ob||'0')+C('')+C('')+ // col7=opening bags,kgs  col8=physical bags,kgs (blank)
      C('')+C('')+                   // col9 shortage (blank)
      C(bags_rec||'0')+C(kgs_rec||'0')+ // receipt
      C(kgs_transfer||'')+           // transfer (kgs only)
      C(bags_tot||'0')+C(kgs_tot||'0')+ // total
      C(bags_iss||'0')+C(kgs_iss||'0')+ // issues
      C('')+C('')+                   // shortage during year (blank)
      C('')+C('')+C('')+C('')+C('')+ // qty expunged cols (blank)
      C(bags_bal||'0')+C(kgs_bal||'0')+ // balance per stack card
      C('')+C('')+                   // shortage (blank)
      C('')+C('')+C('')+C('')+C('')+C('')+ // physical verification (blank × 6)
    '</tr>';
  }
  function sectionLabel(text){
    return '<tr><td colspan="39" style="border:1px solid #000;padding:3px 8px;font-weight:700;font-size:9px;background:#F5F5F5">'+text+'</td></tr>';
  }

  var rows='';
  var sl=1;
  mainComms.forEach(function(cid){
    var r=commMap[cid], cm=(DSS_A||[]).find(function(x){return x.id===cid;})||{};
    var div=cm.id==='PALM'?10:cm.id==='SALT_CIS'||cm.id==='SALT_RFFS'?25:50;
    rows+=dataRow(sl++, (cm.en||cid), (cm.unit||'KG'), fmtB(r.open,div), fmtN(r.open), fmtB(r.receipt,div), fmtN(r.receipt), '', fmtB(r.total,div), fmtN(r.total), fmtB(r.issues,div), fmtN(r.issues), fmtB(r.closing,div), fmtN(r.closing));
  });
  // Gunny section
  var gs=typeof meGunnyStore!=='undefined' ? (meGunnyStore[crsId+'_'+window._pvMonth+'_'+window._pvYear]||{}) : {};
  rows+=sectionLabel('Gunny');
  rows+=dataRow(sl++,'50 kg SS GUNNY','NOS', gs.ss50?fmtN(gs.ss50.open):'0','', gs.ss50?fmtN(gs.ss50.receipt):'0','','', gs.ss50?fmtN(gs.ss50.total):'0','', gs.ss50?fmtN(gs.ss50.issues):'0','', gs.ss50?fmtN(gs.ss50.closing):'0','');
  rows+=dataRow(sl++,'POLYTHENE','NOS', gs.poly?fmtN(gs.poly.open):'0','', gs.poly?fmtN(gs.poly.receipt):'0','','', gs.poly?fmtN(gs.poly.total):'0','', gs.poly?fmtN(gs.poly.issues):'0','', gs.poly?fmtN(gs.poly.closing):'0','');
  rows+=dataRow(sl++,'C.BOX','NOS', gs.cbox?fmtN(gs.cbox.open):'0','', gs.cbox?fmtN(gs.cbox.receipt):'0','','', gs.cbox?fmtN(gs.cbox.total):'0','', gs.cbox?fmtN(gs.cbox.issues):'0','', gs.cbox?fmtN(gs.cbox.closing):'0','');
  // Police section
  if(policeComms.length){
    rows+=sectionLabel('Police');
    policeComms.forEach(function(cid){
      var r=commMap[cid], cm=(DSS_B||[]).find(function(x){return x.id===cid;})||{};
      rows+=dataRow(sl++,(cm.en||cid),(cm.unit||'KG'), '0',fmtN(r.open), '0',fmtN(r.receipt),'', '0',fmtN(r.total), '0',fmtN(r.issues), '0',fmtN(r.closing));
    });
  }

  var crs=CRS_LIST.find(function(c){return String(c.id)===String(crsId);})||{};
  var bcName = billClerk || (currentUser&&currentUser.fullName) || '';

  // Multi-row header matching the PDF exactly
  var hdr='<thead>'+
    '<tr><td colspan="39" style="border:1px solid #000;text-align:center;font-weight:800;font-size:11px;padding:5px">TAMIL NADU CIVIL SUPPLIES CORPORATION MADURAI REGION</td></tr>'+
    '<tr>'+
      '<td colspan="20" style="border:1px solid #000;padding:4px 8px;font-size:9px"><b>NAME OF THE CRS :</b> '+crsId+(crs.name?' \u2014 '+crs.name:'')+'</td>'+
      '<td colspan="19" style="border:1px solid #000;padding:4px 8px;font-size:9px"><b>NAME AND DESIGNATION OF THE P.V.OFFICER :</b> '+(pvOfficer||'____________')+'</td>'+
    '</tr>'+
    '<tr>'+
      '<td colspan="20" style="border:1px solid #000;padding:4px 8px;font-size:9px"><b>NAME OF THE BILL CLERK :</b> '+bcName+'</td>'+
      '<td colspan="19" style="border:1px solid #000;padding:4px 8px;font-size:9px"><b>DATE OF P.V. :</b> ____________</td>'+
    '</tr>'+
    '<tr><td colspan="39" style="border:1px solid #000;text-align:center;font-weight:700;font-size:10px;padding:4px">PHYSICAL VERIFICATION REPORT OF COMMODITIES AS ON '+periodLabel+'</td></tr>'+
    // Column header row 1
    '<tr style="background:#F5F5F5">'+
      '<td rowspan="4" style="border:1px solid #000;text-align:center;font-size:8px;font-weight:700;padding:2px">Sl.<br>No.</td>'+
      '<td rowspan="4" style="border:1px solid #000;text-align:center;font-size:8px;font-weight:700;padding:2px">Commodity</td>'+
      '<td rowspan="4" style="border:1px solid #000;text-align:center;font-size:8px;font-weight:700;padding:2px">Unit</td>'+
      '<td rowspan="4" style="border:1px solid #000;text-align:center;font-size:8px;font-weight:700;padding:2px">Stack<br>No.</td>'+
      '<td colspan="2" style="border:1px solid #000;text-align:center;font-size:8px;font-weight:700;padding:2px">Period</td>'+
      '<td colspan="6" style="border:1px solid #000;text-align:center;font-size:8px;font-weight:700;padding:2px">As on Start Date</td>'+
      '<td colspan="2" style="border:1px solid #000;text-align:center;font-size:8px;font-weight:700;padding:2px">Receipt</td>'+
      '<td colspan="1" style="border:1px solid #000;text-align:center;font-size:8px;font-weight:700;padding:2px">TRANSFER</td>'+
      '<td colspan="2" style="border:1px solid #000;text-align:center;font-size:8px;font-weight:700;padding:2px">TOTAL</td>'+
      '<td colspan="4" style="border:1px solid #000;text-align:center;font-size:8px;font-weight:700;padding:2px">Issues [Excl. Shortage]</td>'+
      '<td colspan="5" style="border:1px solid #000;text-align:center;font-size:8px;font-weight:700;padding:2px">Qty Expunged</td>'+
      '<td colspan="2" style="border:1px solid #000;text-align:center;font-size:8px;font-weight:700;padding:2px">Balance per Stack Card</td>'+
      '<td colspan="2" style="border:1px solid #000;text-align:center;font-size:8px;font-weight:700;padding:2px">Shortage</td>'+
      '<td colspan="6" style="border:1px solid #000;text-align:center;font-size:8px;font-weight:700;padding:2px">Physical Verification (End Date)</td>'+
    '</tr>'+
    '<tr style="background:#F5F5F5">'+
      '<td rowspan="3" style="border:1px solid #000;text-align:center;font-size:7px;padding:2px">From</td>'+
      '<td rowspan="3" style="border:1px solid #000;text-align:center;font-size:7px;padding:2px">To</td>'+
      '<td colspan="2" style="border:1px solid #000;text-align:center;font-size:7px;padding:2px">Stack card</td>'+
      '<td colspan="2" style="border:1px solid #000;text-align:center;font-size:7px;padding:2px">Physical</td>'+
      '<td colspan="2" style="border:1px solid #000;text-align:center;font-size:7px;padding:2px">Shortage</td>'+
      '<td colspan="2" style="border:1px solid #000;text-align:center;font-size:7px;padding:2px"></td>'+
      '<td style="border:1px solid #000;text-align:center;font-size:7px;padding:2px">KGS</td>'+
      '<td colspan="2" style="border:1px solid #000;text-align:center;font-size:7px;padding:2px"></td>'+
      '<td colspan="2" style="border:1px solid #000;text-align:center;font-size:7px;padding:2px"></td>'+
      '<td colspan="2" style="border:1px solid #000;text-align:center;font-size:7px;padding:2px"></td>'+
      '<td style="border:1px solid #000;text-align:center;font-size:7px;padding:2px">RM ref</td>'+
      '<td style="border:1px solid #000;text-align:center;font-size:7px;padding:2px">Date</td>'+
      '<td style="border:1px solid #000;text-align:center;font-size:7px;padding:2px">Issue</td>'+
      '<td style="border:1px solid #000;text-align:center;font-size:7px;padding:2px">Date</td>'+
      '<td style="border:1px solid #000;text-align:center;font-size:7px;padding:2px">Qty</td>'+
      '<td colspan="2" style="border:1px solid #000;text-align:center;font-size:7px;padding:2px"></td>'+
      '<td colspan="2" style="border:1px solid #000;text-align:center;font-size:7px;padding:2px"></td>'+
      '<td colspan="2" style="border:1px solid #000;text-align:center;font-size:7px;padding:2px">By Counting</td>'+
      '<td colspan="2" style="border:1px solid #000;text-align:center;font-size:7px;padding:2px">By 100%</td>'+
      '<td colspan="2" style="border:1px solid #000;text-align:center;font-size:7px;padding:2px"></td>'+
    '</tr>'+
    '<tr style="background:#F5F5F5">'+
      '<td colspan="2" style="border:1px solid #000;text-align:center;font-size:7px;padding:2px">Bags&nbsp;&nbsp;Kgs</td>'+
      '<td colspan="2" style="border:1px solid #000;text-align:center;font-size:7px;padding:2px">Bags&nbsp;&nbsp;Kgs</td>'+
      '<td colspan="2" style="border:1px solid #000;text-align:center;font-size:7px;padding:2px">Bags&nbsp;&nbsp;Kgs</td>'+
      '<td colspan="2" style="border:1px solid #000;text-align:center;font-size:7px;padding:2px">Bags&nbsp;&nbsp;Kgs</td>'+
      '<td style="border:1px solid #000;text-align:center;font-size:7px;padding:2px"></td>'+
      '<td colspan="2" style="border:1px solid #000;text-align:center;font-size:7px;padding:2px">Bags&nbsp;&nbsp;Kgs</td>'+
      '<td colspan="2" style="border:1px solid #000;text-align:center;font-size:7px;padding:2px">Bags&nbsp;&nbsp;Kgs</td>'+
      '<td colspan="2" style="border:1px solid #000;text-align:center;font-size:7px;padding:2px">Bags&nbsp;&nbsp;Kgs</td>'+
      '<td colspan="5" style="border:1px solid #000;text-align:center;font-size:7px;padding:2px"></td>'+
      '<td colspan="2" style="border:1px solid #000;text-align:center;font-size:7px;padding:2px">Bags&nbsp;&nbsp;Kgs</td>'+
      '<td colspan="2" style="border:1px solid #000;text-align:center;font-size:7px;padding:2px">Bags&nbsp;&nbsp;Kgs</td>'+
      '<td colspan="2" style="border:1px solid #000;text-align:center;font-size:7px;padding:2px">Bags&nbsp;&nbsp;Kgs</td>'+
      '<td colspan="2" style="border:1px solid #000;text-align:center;font-size:7px;padding:2px">Bags&nbsp;&nbsp;Kgs</td>'+
      '<td colspan="2" style="border:1px solid #000;text-align:center;font-size:7px;padding:2px">Excess&nbsp;&nbsp;Short</td>'+
    '</tr>'+
    '<tr style="background:#F5F5F5">'+
      Array.from({length:35},function(_,i){return '<td style="border:1px solid #000;text-align:center;font-size:7px;padding:1px">'+[7,8,9,10,11,12,13,14,15,16,17,18][i] || (i+4)+'</td>';}).join('')+
      // col numbers per PDF
    '</tr>'+
    '</thead>';

  var footer='<tfoot>'+
    '<tr><td colspan="39" style="border:1px solid #000;padding:6px 10px;font-size:9px;font-weight:600">NOTE:</td></tr>'+
    '<tr><td colspan="20" style="border:1px solid #000;padding:6px 10px;font-size:9px">'+
      '1. Certified that the details were verified with connected records and found correct.<br>'+
      '2. Certified that the result of the physical verification have been recorded in the stock ledger, stack register and stack card.'+
    '</td>'+
    '<td colspan="19" style="border:1px solid #000;padding:6px 10px;font-size:9px;text-align:center">'+
      '<br><br><b>SIGNATURE OF THE PHYSICAL VERIFICATION OFFICER</b></td></tr>'+
    '<tr><td colspan="20" style="border:1px solid #000;padding:16px 10px 6px;font-size:9px;text-align:center"><b>SIGNATURE OF BILL CLERK WITH SEAL</b></td>'+
    '<td colspan="19" style="border:1px solid #000;padding:6px 10px;font-size:9px"></td></tr>'+
    '</tfoot>';

  return '<div id="pv-print-area">'+
    '<style>@media print{body *{visibility:hidden}#pv-print-area,#pv-print-area *{visibility:visible}#pv-print-area{position:fixed;top:0;left:0;width:100%;z-index:9999;padding:8px}}</style>'+
    '<div style="overflow-x:auto">'+
    '<table id="pv-tbl" style="border-collapse:collapse;font-family:Arial,sans-serif;width:100%;min-width:1400px">'+
    hdr+'<tbody>'+rows+'</tbody>'+footer+'</table></div></div>';
}

function generateReport(){
  var crsEl=document.getElementById('rpt-crs'), moEl=document.getElementById('rpt-month');
  var titleEl=document.getElementById('rpt-result-title'), bodyEl=document.getElementById('rpt-result-body');
  if(!crsEl||!moEl||!bodyEl) return;
  var selectedCrs=crsEl.value, moVal=moEl.value;
  var crsIds=selectedCrs?[parseInt(selectedCrs)]:CRS_LIST.map(function(c){return c.id;});

  var fmtAmt=function(n){return '\u20B9'+Number(n).toLocaleString('en-IN',{minimumFractionDigits:2,maximumFractionDigits:2});};

  // ── QUARTERLY / YEARLY → PV STATEMENT ─────────────────────────────────
  if(_rptType==='quarterly'||_rptType==='yearly'){
    if(!selectedCrs){ bodyEl.innerHTML='<div style="text-align:center;padding:24px;color:var(--muted)">Please select a specific CRS shop to generate a PV Statement.</div>'; return; }
    var months=[];
    var periodLabel='';
    if(_rptType==='quarterly'){
      var qEl=document.getElementById('rpt-quarter-start'); if(!qEl||!qEl.value) return;
      var qp=qEl.value.split('-'); var qYear=parseInt(qp[0]),qMo=parseInt(qp[1]);
      for(var i=0;i<3;i++){ var mo2=qMo+i; var yr2=qYear; if(mo2>12){mo2-=12;yr2++;} months.push({year:yr2,month:mo2}); }
      var start=months[0], end=months[2];
      var endDate=new Date(end.year,end.month,0);
      periodLabel='1.'+String(start.month).padStart(2,'0')+'.'+start.year+' TO '+endDate.getDate()+'.'+String(end.month).padStart(2,'0')+'.'+end.year;
    } else {
      var yrEl=document.getElementById('rpt-year-sel'); if(!yrEl||!yrEl.value) return;
      var fy=parseInt(yrEl.value);
      for(var mo3=4;mo3<=12;mo3++) months.push({year:fy,month:mo3});
      for(var mo4=1;mo4<=3;mo4++) months.push({year:fy+1,month:mo4});
      periodLabel='1.04.'+fy+' TO 31.03.'+(fy+1);
    }
    window._pvMonth=months[0].month; window._pvYear=months[0].year;
    var agg=pvAggregatePeriod(crsIds,months);
    if(titleEl) titleEl.textContent='PV Statement \u2014 '+periodLabel+' \u00B7 CRS '+selectedCrs;
    bodyEl.innerHTML=buildPVTable(agg.commMap,periodLabel,selectedCrs&&('CRS '+selectedCrs),selectedCrs,'',null);
    return;
  }

  // ── DAILY / MONTHLY → commodity sales summary ──────────────────────────
  var moYear=0,moNum=0;
  if(moVal){ var mp=moVal.split('-'); moYear=parseInt(mp[0]); moNum=parseInt(mp[1]); }
  var totalSales=0,totalReceipts=0,daysSet=new Set(),commMap={};
  var daysInMo=moYear?new Date(moYear,moNum,0).getDate():0;
  crsIds.forEach(function(cid){
    for(var d=1;d<=daysInMo;d++){
      var dk=cid+'_'+moYear+'-'+String(moNum).padStart(2,'0')+'-'+String(d).padStart(2,'0');
      var e=entryStore[dk]; if(!e) continue; daysSet.add(dk);
      ['a','b'].forEach(function(sec){ Object.keys(e[sec]||{}).forEach(function(commId){
        var row=e[sec][commId],qty=parseFloat(row.sales)||0,amt=parseFloat(row.amount)||0; totalSales+=amt;
        if(!commMap[commId]){ var cm=(DSS_A||[]).concat(DSS_B||[]).find(function(x){return x.id===commId;})||{};
          commMap[commId]={name:cm.en||commId,unit:cm.unit||'KG',qty:0,amount:0,free:!!cm.free}; }
        commMap[commId].qty+=qty; commMap[commId].amount+=amt;
      }); });
    }
    (receiptStore||[]).forEach(function(r){
      if(r.crsId!==cid) return;
      if(moYear){ var rp=r.date.split('-'); if(parseInt(rp[0])!==moYear||parseInt(rp[1])!==moNum) return; }
      Object.keys(r.items||{}).forEach(function(k){ totalReceipts+=parseFloat(r.items[k])||0; });
    });
  });
  var kS=document.getElementById('rpt-kpi-sales'),kR=document.getElementById('rpt-kpi-receipts'),kD=document.getElementById('rpt-kpi-days');
  if(kS) kS.textContent=fmtAmt(totalSales); if(kR) kR.textContent=fmtAmt(totalReceipts); if(kD) kD.textContent=daysSet.size;
  var crsLabel=selectedCrs?'CRS '+selectedCrs:'All CRS Shops';
  var moLabel=moYear?MNAMES[moNum]+' '+moYear:'';
  if(titleEl) titleEl.textContent='Sales by Commodity \u2014 '+moLabel+' \u00B7 '+crsLabel;
  var rows=Object.keys(commMap).map(function(k){return Object.assign({id:k},commMap[k]);});
  rows.sort(function(a,b){return b.amount-a.amount;});
  var maxAmt=rows.length?Math.max.apply(null,rows.map(function(r){return r.amount;})):1;
  if(!rows.length){ bodyEl.innerHTML='<div style="text-align:center;padding:32px;color:var(--muted)">No entry data found for the selected period.</div>'; return; }
  var html='<div class="table-wrap"><table><thead><tr><th>Commodity</th><th>Unit</th><th>Total Qty</th><th>Total Amount</th><th>% of Sales</th></tr></thead><tbody>';
  rows.forEach(function(r){
    var pct=totalSales>0?Math.round(r.amount/totalSales*100):0;
    var col=r.free?'var(--navy)':(r.amount>10000?'var(--gold)':'#10B981');
    var bw=maxAmt>0?Math.round(r.amount/maxAmt*100):0;
    html+='<tr><td><strong>'+r.name+'</strong></td><td>'+r.unit+'</td><td>'+r.qty.toLocaleString('en-IN',{maximumFractionDigits:3})+'</td><td style="font-weight:700;color:'+(r.free?'var(--muted)':'var(--red)')+'">'+
      (r.free?'Free':fmtAmt(r.amount))+'</td><td><div style="display:flex;align-items:center;gap:6px"><div style="height:6px;width:'+bw+'%;background:'+col+';border-radius:3px;min-width:2px;max-width:140px"></div><span style="font-size:11px;color:var(--muted)">'+pct+'%</span></div></td></tr>';
  });
  html+='</tbody></table></div><div style="margin-top:12px;padding:10px 14px;background:#F8FAFC;border-radius:10px;display:flex;gap:24px;font-size:12px;flex-wrap:wrap"><span><strong>Total Paid Sales:</strong> '+fmtAmt(totalSales)+'</span><span><strong>Entries:</strong> '+daysSet.size+' days</span><span style="color:var(--muted)">Free commodities shown at qty only</span></div>';
  bodyEl.innerHTML=html;
}

function printPVStatement(){
  var el=document.getElementById('pv-print-area');
  if(!el){ alert('Generate a PV Statement first.'); return; }
  window.print();
}

// ── SETTINGS ─────────────────────────────────────────
function saveSettings(){
  document.getElementById('settings-saved').style.display='flex';
  setTimeout(()=>document.getElementById('settings-saved').style.display='none',3000);
}


// ═══ MONTHLY ENTRY ═════════════════════════════════════════════════

