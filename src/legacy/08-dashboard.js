/* Dashboard KPIs, day bars, closing list
   Verbatim from TNCSC_CRS_Demo_19 (1).html lines 4389-4746.
   These parts are concatenated back into one classic script by
   tools/bundle-engine.mjs - the code hoists across the whole block and
   its declarations must stay global for the markup's inline handlers. */
var receiptStore = [
  {id:1,crsId:9,date:'2026-07-05',receiptNo:'R/2026/001',items:{BRA:{qty:500},NPHH_FRK:{qty:200},SUGAR:{qty:300},TOOR:{qty:100},PALM:{qty:150}},savedAt:'2026-07-05 09:30'},
  {id:2,crsId:9,date:'2026-07-10',receiptNo:'R/2026/002',items:{BRA:{qty:400},WHEAT:{qty:200},AAY_SUGAR:{qty:120}},savedAt:'2026-07-10 10:00'},
];
var rpNextId = 3;

// Selected date on dashboard (default = today)
var dashSelectedDate = new Date();

// ── Clock ─────────────────────────────────────────────────────────────────
function startDashClock(){
  function tick(){
    var now=new Date();
    var el=document.getElementById('dash-clock');
    var ampmEl=document.getElementById('dash-ampm');
    if(!el) return;
    var h=now.getHours();
    var ampm=h>=12?'PM':'AM';
    h=h%12||12; // convert to 12-hr, 0→12
    var mm=String(now.getMinutes()).padStart(2,'0');
    var ss=String(now.getSeconds()).padStart(2,'0');
    el.textContent=h+':'+mm+':'+ss;
    if(ampmEl) ampmEl.textContent=ampm;
  }
  tick(); // fire immediately
  setInterval(tick,1000);
}

// ── Holiday logic ─────────────────────────────────────────────────────────
function isHoliday(dateObj){
  var d=dateObj.getDay(),dt=dateObj.getDate();
  var firstDay=new Date(dateObj.getFullYear(),dateObj.getMonth(),1).getDay();
  var weekNum=Math.ceil((dt+firstDay)/7);
  if(d===5&&(weekNum===1||weekNum===2)) return true;
  if(d===0&&(weekNum===3||weekNum===4)) return true;
  return false;
}
function getHolidayName(dateObj){
  var d=dateObj.getDay(),dt=dateObj.getDate();
  var f=new Date(dateObj.getFullYear(),dateObj.getMonth(),1).getDay();
  var w=Math.ceil((dt+f)/7);
  if(d===5&&w===1) return '1st Friday Holiday';
  if(d===5&&w===2) return '2nd Friday Holiday';
  if(d===0&&w===3) return '3rd Sunday Holiday';
  if(d===0&&w===4) return '4th Sunday Holiday';
  return null;
}

function navTo(pageId){
  var navEl=null;
  document.querySelectorAll('.nav-item').forEach(function(n){
    if(n.getAttribute('onclick')&&n.getAttribute('onclick').indexOf("'"+pageId+"'")>-1) navEl=n;
  });
  showPage(pageId,navEl);
}

// ── Date picker change ────────────────────────────────────────────────────
function onDashDateChange(dateStr){
  if(!dateStr) return;
  var parts=dateStr.split('-');
  dashSelectedDate=new Date(parseInt(parts[0]),parseInt(parts[1])-1,parseInt(parts[2]));
  var labelEl=document.getElementById('dash-selected-date-label');
  var today=new Date();
  var isToday=(dashSelectedDate.toDateString()===today.toDateString());
  if(labelEl) labelEl.textContent=isToday?'Today':dashSelectedDate.toLocaleDateString('en-IN',{day:'numeric',month:'short'});
  refreshDashboard();
}

// ── Main dashboard build ───────────────────────────────────────────────────
function buildDashboard(){
  // Guard: don't run if no user is logged in yet
  if(!currentUser) return;

  // ── INSTANT: set text content immediately ────────────────────────────
  var now=new Date();

  // Subtitle (name + month) — show instantly
  var subEl=document.getElementById('dash-sub');
  if(subEl){
    var nm=currentUser?currentUser.fullName:'Administrator';
    var mn=now.toLocaleDateString('en-IN',{month:'long',year:'numeric'});
    subEl.textContent='Welcome, '+nm+' · '+mn;
  }

  // Today date label
  var todayEl=document.getElementById('dash-today');
  if(todayEl) todayEl.textContent=now.toLocaleDateString('en-IN',{day:'numeric',month:'short',year:'numeric'});

  // Start clock immediately (only once)
  if(currentUser && !window._clockStarted){ startDashClock(); window._clockStarted=true; }

  // Show admin-only second row of Quick Actions
  var adminRow = document.getElementById('dash-admin-actions');
  if(adminRow) adminRow.style.display = (currentUser && currentUser.role==='ADMIN') ? 'grid' : 'none';

  // Set date picker
  var picker=document.getElementById('dash-date-picker');
  var todayStr=now.toISOString().split('T')[0];
  if(picker){ if(!picker.value) picker.value=todayStr; picker.max=todayStr; }

  // ── INSTANT: CRS Staff Info ───────────────────────────────────────────
  var crsId=currentUser?currentUser.crsId:null;
  var crsInfoDiv=document.getElementById('dash-crs-info');
  if(currentUser&&currentUser.crsId&&crsInfoDiv){
    crsInfoDiv.style.display='block';
    var crsNumEl=document.getElementById('dash-crs-num');
    if(crsNumEl) crsNumEl.textContent='CRS '+currentUser.crsId;
    var staff=getUsersForCRS(currentUser.crsId);
    var bcB=document.getElementById('dash-bc-block');
    var pkB=document.getElementById('dash-packer-block');
    if(staff.bc&&bcB){
      bcB.style.display='block';
      var nb=document.getElementById('dash-bc-name');   if(nb) nb.textContent=staff.bc.fullName;
      var pb=document.getElementById('dash-bc-phone');  if(pb) pb.textContent=staff.bc.phone;
    }
    if(staff.packer&&pkB){
      pkB.style.display='block';
      var np=document.getElementById('dash-packer-name');   if(np) np.textContent=staff.packer.fullName;
      var pp=document.getElementById('dash-packer-phone');  if(pp) pp.textContent=staff.packer.phone;
    }
  } else if(crsInfoDiv){
    crsInfoDiv.style.display='none';
  }

  // ── Holiday ────────────────────────────────────────────────────────────
  var holText=getHolidayName(now);
  var holDiv=document.getElementById('dash-holiday-notice');
  var holEl=document.getElementById('dash-holiday-text');
  if(holDiv&&holEl){
    if(holText){holEl.textContent='Today is a '+holText;holDiv.style.display='flex';}
    else holDiv.style.display='none';
  }
  var dayTypeEl=document.getElementById('dash-day-type');
  if(dayTypeEl){
    dayTypeEl.innerHTML=holText
      ?'<span style="color:#C2410C;font-size:11px;font-weight:700">&#127958; Holiday</span>'
      :'<span style="color:#16A34A;font-size:11px;font-weight:700">&#10003; Working Day</span>';
  }

  // ── KPIs ───────────────────────────────────────────────────────────────
  var yr=now.getFullYear(),mo=now.getMonth()+1,toDay=now.getDate();
  var daysWithEntry=0,daysWithoutEntry=0;
  for(var d2=1;d2<=toDay;d2++){
    var dd=new Date(yr,mo-1,d2);
    if(!isHoliday(dd)){
      var keyStr=(crsId||'1')+'_'+yr+'-'+String(mo).padStart(2,'0')+'-'+String(d2).padStart(2,'0');
      if(entryStore&&entryStore[keyStr]) daysWithEntry++; else daysWithoutEntry++;
    }
  }
  var kpiE=document.getElementById('kpi-entries'); if(kpiE) kpiE.textContent=daysWithEntry;
  var kpiN=document.getElementById('kpi-noentry'); if(kpiN) kpiN.textContent=daysWithoutEntry;

  var myReceipts=receiptStore.filter(function(r){return !crsId||r.crsId===crsId;});
  var rpCount=document.getElementById('kpi-receipts');   if(rpCount) rpCount.textContent=myReceipts.length;
  var rpSub=document.getElementById('kpi-receipt-sub');
  if(rpSub){ var last=myReceipts.slice(-1)[0]; rpSub.textContent=last?'Last: '+last.date+' → View':'Click to view →'; }

  var monLabel=document.getElementById('dash-month-label');
  if(monLabel) monLabel.textContent=now.toLocaleDateString('en-IN',{month:'long',year:'numeric'})+' — daily qty';

  // Set default selected date to today
  if(!dashSelectedDate) dashSelectedDate=now;

  // ── Charts & breakdown (slightly deferred to not block render) ─────────
  setTimeout(function(){ refreshDashboard(); }, 0);
}

function refreshDashboard(){
  var now=new Date();
  var yr=now.getFullYear(),mo=now.getMonth()+1,toDay=now.getDate();
  var crsId=currentUser?currentUser.crsId:null;

  buildDashDayBars(yr,mo,toDay,crsId);
  buildCommodityBreakdown(crsId);
  buildClosingList(crsId,yr,mo,toDay);
}

function buildDashDayBars(yr,mo,toDay,crsId){
  var bDiv=document.getElementById('dash-day-bars');
  var lDiv=document.getElementById('dash-day-labels');
  if(!bDiv||!lDiv) return;
  var dayData=[];
  for(var d2=1;d2<=toDay;d2++){
    var dd=new Date(yr,mo-1,d2);
    var holiday=isHoliday(dd);
    var keyStr=(crsId||'1')+'_'+yr+'-'+String(mo).padStart(2,'0')+'-'+String(d2).padStart(2,'0');
    var entry=entryStore&&entryStore[keyStr];
    var totalSales=0;
    if(entry){
      Object.keys(entry.a||{}).forEach(function(k){totalSales+=entry.a[k].sales||0;});
      Object.keys(entry.b||{}).forEach(function(k){totalSales+=entry.b[k].sales||0;});
    }
    // Is this the selected date?
    var isSelected=dashSelectedDate&&
      dashSelectedDate.getDate()===d2&&
      dashSelectedDate.getMonth()===mo-1&&
      dashSelectedDate.getFullYear()===yr;
    dayData.push({day:d2,holiday:holiday,sales:totalSales,hasEntry:!!entry,selected:isSelected});
  }
  var maxS=Math.max.apply(null,dayData.map(function(d){return d.sales;}).concat([1]));
  var bw=Math.max(12,Math.floor(555/Math.max(dayData.length,1))-3);
  bDiv.innerHTML=dayData.map(function(d){
    var h=d.holiday?6:(d.sales?Math.max(8,Math.round(d.sales/maxS*96)):6);
    var bg=d.holiday?'#F1F5F9':(d.hasEntry?'linear-gradient(180deg,#0EA5E9,#0369A1)':'#FEE2E2');
    var tip='Day '+d.day+(d.holiday?': Holiday':(': '+d.sales.toFixed(1)+' kg'));
    var outline=d.selected?'outline:2px solid #D97706;outline-offset:2px;':'';
    return '<div onclick="selectDashDay('+d.day+','+String(new Date().getFullYear())+','+String(new Date().getMonth()+1)+')"'+
      ' style="display:flex;flex-direction:column;align-items:center;flex:0 0 '+bw+'px;cursor:pointer" title="'+tip+'">'+
      '<div style="height:'+h+'px;width:'+bw+'px;background:'+bg+';border-radius:3px 3px 0 0;'+outline+
        (d.holiday?'border:1px dashed #CBD5E1;':'')+';transition:.15s"></div></div>';
  }).join('');
  lDiv.innerHTML=dayData.map(function(d){
    var col=d.holiday?'#CBD5E1':(d.hasEntry?'#0369A1':'#EF4444');
    var fw=d.selected?'900':'600';
    var under=d.selected?'text-decoration:underline;text-underline-offset:2px;':'';
    return '<div onclick="selectDashDay('+d.day+','+String(new Date().getFullYear())+','+String(new Date().getMonth()+1)+')"'+
      ' style="flex:0 0 '+bw+'px;text-align:center;font-size:8px;color:'+col+';font-weight:'+fw+';cursor:pointer;'+under+'">'+d.day+'</div>';
  }).join('');
}

// Click on a day bar → select that date
function selectDashDay(day,yr,mo){
  var d=new Date(yr,mo-1,day);
  dashSelectedDate=d;
  var picker=document.getElementById('dash-date-picker');
  var dateStr=yr+'-'+String(mo).padStart(2,'0')+'-'+String(day).padStart(2,'0');
  if(picker) picker.value=dateStr;
  var labelEl=document.getElementById('dash-selected-date-label');
  var today=new Date();
  var isToday=d.toDateString()===today.toDateString();
  if(labelEl) labelEl.textContent=isToday?'Today':d.toLocaleDateString('en-IN',{day:'numeric',month:'short'});
  refreshDashboard();
}

// ── Commodity breakdown for selected date ──────────────────────────────────
function buildCommodityBreakdown(crsId){
  var el=document.getElementById('dash-commodity-breakdown');
  var lblEl=document.getElementById('dash-breakdown-label');
  var totalAmtEl=document.getElementById('dash-sale-total');
  var totalQtyEl=document.getElementById('dash-sale-qty');
  var dateLblEl=document.getElementById('dash-sale-date-lbl');
  if(!el) return;

  var selDate=dashSelectedDate||new Date();
  var yr=selDate.getFullYear(),mo=selDate.getMonth()+1,d=selDate.getDate();
  var dateStr=yr+'-'+String(mo).padStart(2,'0')+'-'+String(d).padStart(2,'0');
  var today=new Date();
  var isToday=selDate.toDateString()===today.toDateString();
  var displayDate=isToday?'Today':selDate.toLocaleDateString('en-IN',{weekday:'short',day:'numeric',month:'short'});

  if(lblEl) lblEl.textContent=displayDate+' — Commodity Breakdown';
  if(dateLblEl) dateLblEl.textContent=displayDate;

  var key=(crsId||'1')+'_'+dateStr;
  var entry=entryStore&&entryStore[key];

  if(!entry){
    el.innerHTML='<div style="color:var(--muted);font-size:12px;text-align:center;padding:14px">'+(isHoliday(selDate)?'&#127958; Holiday — no entry':'No entry for '+displayDate)+'</div>';
    if(totalAmtEl) totalAmtEl.textContent='\u20b90.00';
    if(totalQtyEl) totalQtyEl.textContent='0 kg total';
    return;
  }

  var allComms=(typeof DSS_A!=='undefined'?DSS_A:[]).concat(typeof DSS_B!=='undefined'?DSS_B:[]);
  var grandAmt=0,grandQty=0;
  var rows='';

  allComms.forEach(function(c){
    var data=(entry.a&&entry.a[c.id])||(entry.b&&entry.b[c.id]);
    if(!data) return;
    var sales=parseFloat(data.sales)||0;
    if(sales<=0) return;
    grandQty+=sales;
    var amt=c.free?0:(sales*c.rate);
    grandAmt+=amt;

    var rateStr=c.free
      ?'<span style="color:#16A34A;font-weight:700">Free = \u0bb5\u0bbf\u0bb2\u0bc8\u0baf\u0bbf\u0bb2\u0bcd\u0bb2\u0bbe</span>'
      :'<span style="color:#374151">\u20b9'+c.rate.toFixed(2)+' &times; '+sales.toFixed(3)+'</span> = <strong style="color:#0369A1">\u20b9'+amt.toLocaleString('en-IN',{minimumFractionDigits:2})+'</strong>';

    rows+='<div style="display:flex;justify-content:space-between;align-items:center;padding:7px 0;border-bottom:1px solid #F0F9FF;gap:8px">'+
      '<div style="min-width:0">'+
        '<span style="font-weight:600;font-size:12px">'+c.ta+'</span>'+
        '<span style="color:var(--muted);font-size:11px;margin-left:6px">'+c.en+'</span>'+
      '</div>'+
      '<div style="text-align:right;flex-shrink:0;font-size:12px">'+
        '<span style="font-weight:700;color:#0369A1">'+sales.toFixed(3)+' '+c.unit+'</span>'+
        '<span style="color:var(--muted);margin:0 4px">&times;</span>'+
        rateStr+
      '</div>'+
    '</div>';
  });

  if(!rows){
    el.innerHTML='<div style="color:var(--muted);font-size:12px;text-align:center;padding:14px">No sales data for '+displayDate+'</div>';
  } else {
    el.innerHTML=rows;
  }

  var fmt=function(n){return '\u20b9'+n.toLocaleString('en-IN',{minimumFractionDigits:2,maximumFractionDigits:2});};
  if(totalAmtEl) totalAmtEl.textContent=fmt(grandAmt);
  if(totalQtyEl) totalQtyEl.textContent=grandQty.toFixed(3)+' kg total';
}

// ── Closing stock for ALL commodities ─────────────────────────────────────
function buildClosingList(crsId,yr,mo,toDay){
  var listEl=document.getElementById('dash-closing-list');
  var dateLbl=document.getElementById('dash-closing-date-label');
  if(!listEl) return;

  // Find latest entry up to selected date (or today)
  var selD=dashSelectedDate||new Date();
  var selDay=Math.min(selD.getDate(),toDay);
  // Only use entry on or before selected date in same month/year
  var sameMonth=(selD.getFullYear()===yr&&selD.getMonth()+1===mo);
  var limitDay=sameMonth?selDay:toDay;

  var latestKey=null;
  for(var d2=limitDay;d2>=1;d2--){
    var k=(crsId||'1')+'_'+yr+'-'+String(mo).padStart(2,'0')+'-'+String(d2).padStart(2,'0');
    if(entryStore&&entryStore[k]){latestKey=k;break;}
  }

  if(!latestKey){
    listEl.innerHTML='<div style="color:var(--muted);font-size:12px;text-align:center;padding:16px">No entry data yet</div>';
    if(dateLbl) dateLbl.textContent='';
    return;
  }

  var entry=entryStore[latestKey];
  var dateLabel=latestKey.split('_')[1];
  if(dateLbl) dateLbl.textContent='As of '+dateLabel;

  var allComms=(typeof DSS_A!=='undefined'?DSS_A:[]).concat(typeof DSS_B!=='undefined'?DSS_B:[]);
  var rows='';

  allComms.forEach(function(c,i){
    var data=(entry.a&&entry.a[c.id])||(entry.b&&entry.b[c.id]);
    var closing=data?parseFloat(data.close)||0:0;
    var bg=i%2===0?'#fff':'#FAFCFF';
    var closingColor=closing>0?'#0369A1':'#9CA3AF';
    var closingWeight=closing>0?'800':'400';
    // Show ALL commodities (even zero closing)
    rows+='<div style="display:flex;justify-content:space-between;align-items:center;padding:6px 0;border-bottom:1px solid #F0F9FF;background:'+bg+'">'+
      '<div style="min-width:0">'+
        '<div style="font-weight:600;font-size:11px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis">'+c.ta+'</div>'+
        '<div style="font-size:9px;color:var(--muted)">'+c.en+'</div>'+
      '</div>'+
      '<div style="text-align:right;flex-shrink:0;font-size:12px;font-weight:'+closingWeight+';color:'+closingColor+'">'+
        closing.toFixed(3)+' <span style="font-size:9px;font-weight:400;color:var(--muted)">'+c.unit+'</span>'+
      '</div>'+
    '</div>';
  });

  listEl.innerHTML=rows||'<div style="color:var(--muted);font-size:12px;text-align:center;padding:12px">No commodity data</div>';
}

// ── RECEIPT PAGE ──────────────────────────────────────────────────────────
