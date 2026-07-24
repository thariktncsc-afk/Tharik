/* Sample data loader, DSS preview and Excel export
   Verbatim from TNCSC_CRS_Demo_19 (1).html lines 9437-9828.
   These parts are concatenated back into one classic script by
   tools/bundle-engine.mjs - the code hoists across the whole block and
   its declarations must stay global for the markup's inline handlers. */
function loadSampleData(){
  var sel=document.getElementById('entry-crs');
  if(sel && !sel.value){
    for(var oi=0;oi<sel.options.length;oi++){ if(sel.options[oi].value){ sel.value=sel.options[oi].value; break; } }
  }
  var crsId=sel?sel.value:'';
  if(!crsId){ alert('No CRS shop available to load sample data into.'); return; }

  // Use the current month (today) so all dates are valid
  var today=new Date();
  var year=today.getFullYear(), month=today.getMonth()+1;
  var pad=function(n){ return String(n).padStart(2,'0'); };
  var days=Math.min(today.getDate(), 10);   // seed up to 10 days
  // deterministic pseudo-random in [0,1)
  function rnd(seed){ var x=Math.sin(seed*127.1+11.7)*43758.5453; return x-Math.floor(x); }

  var carry={};   // running closing per commodity → next day's opening
  var count=0;
  for(var day=1; day<=days; day++){
    var ds=year+'-'+pad(month)+'-'+pad(day);
    var snap={a:{},b:{}};
    [['a',DSS_A],['b',DSS_B]].forEach(function(pair){
      var sec=pair[0], list=pair[1];
      list.forEach(function(c,i){
        var k=sec+c.id;
        var open=(carry[k]!==undefined)?carry[k]:Math.round(300+rnd(i+3)*900);
        var receipt=(day%5===1)?Math.round(rnd(day*7+i)*600):0;   // restock ~every 5 days
        var total=open+receipt;
        var sales=Math.round(total*(0.05+rnd(day*13+i)*0.20));
        if(sales>total) sales=total;
        var close=total-sales;
        var amount=c.free?0:+(sales*c.rate).toFixed(2);
        snap[sec][c.id]={open:open, receipt:receipt, sales:sales, close:close, amount:amount};
        carry[k]=close;
      });
    });
    snap.remitDate=ds; snap.remitAmount=0;
    entryStore[crsId+'_'+ds]=snap;
    count++;
  }

  // Sample Inspection data on a couple of days (excess / shortage / transfer)
  if(typeof inspectionStore==='undefined') window.inspectionStore={};
  if(days>=3) inspectionStore[crsId+'_'+year+'-'+pad(month)+'-03']={a:{SUGAR:{excess:5}, TOOR:{shortage:2}}, b:{}};
  if(days>=8) inspectionStore[crsId+'_'+year+'-'+pad(month)+'-08']={a:{PALM:{transfer:10}}, b:{PB_SUGAR:{shortage:1}}};

  // Show the last seeded day in the form and refresh
  var dEl=document.getElementById('entry-date');
  if(dEl){ dEl.value=year+'-'+pad(month)+'-'+pad(days); }
  if(typeof onEntryChange==='function') onEntryChange();

  var crs=CRS_LIST.find(function(c){ return String(c.id)===crsId; });
  alert('\u2705 Sample data loaded: '+count+' day(s) for CRS '+crsId+(crs?' \u2014 '+crs.name:'')+
        ' ('+year+'-'+pad(month)+').\n\nNow try:\n\u2022 \ud83d\udcc4 DSS \u2014 see the '+count+'-day statement\n\u2022 \ud83d\udd0d Inspection \u2014 stock adjustments (days 3 & 8 have sample entries)');
}


// ── Dedicated DSS full-screen viewer (fresh element each time — avoids the duplicated #fullscreen-viewer) ──
function openDSSViewer(titleText, subText, bodyHTML, cssBlock){
  var old=document.getElementById('dss-viewer'); if(old) old.remove();
  var ov=document.createElement('div');
  ov.id='dss-viewer';
  ov.style.cssText='position:fixed;inset:0;z-index:9600;background:#E2E8F0;display:flex;flex-direction:column;overflow:hidden';
  ov.innerHTML='<style>'+cssBlock+'</style>'+
    '<div class="no-print" style="background:#1E40AF;color:#fff;padding:10px 16px;display:flex;justify-content:space-between;align-items:center;flex-shrink:0;gap:10px">'+
      '<div><div style="font-weight:800;font-size:14px">'+titleText+'</div><div style="font-size:11px;opacity:.8">'+subText+'</div></div>'+
      '<div style="display:flex;gap:8px;flex-shrink:0">'+
        '<button type="button" onclick="downloadDSSExcel()" style="background:#16A34A;color:#fff;border:none;padding:7px 16px;border-radius:6px;cursor:pointer;font-weight:700;font-size:12px">\u2b07\ufe0f Excel</button>'+
        '<button type="button" onclick="window.print()" style="background:#fff;color:#1E40AF;border:none;padding:7px 16px;border-radius:6px;cursor:pointer;font-weight:700;font-size:12px">\ud83d\udda8\ufe0f Print / PDF</button>'+
        '<button type="button" onclick="document.getElementById(\'dss-viewer\').remove()" style="background:rgba(255,255,255,.15);color:#fff;border:1px solid rgba(255,255,255,.3);padding:7px 14px;border-radius:6px;cursor:pointer;font-size:12px;font-weight:600">\u2715 Close</button>'+
      '</div>'+
    '</div>'+
    '<div id="dss-scroll" style="flex:1;overflow:auto;padding:22px 16px">'+bodyHTML+'</div>';
  document.body.appendChild(ov);
}

// ── Lazy-load the Excel writer (xlsx-js-style — supports cell borders/fonts/merges) ──
function ensureXLSX(cb){
  if(window.XLSX){ cb(); return; }
  var s=document.createElement('script');
  s.src='https://cdn.jsdelivr.net/npm/xlsx-js-style@1.2.0/dist/xlsx.bundle.js';
  s.onload=function(){ cb(); };
  s.onerror=function(){ alert('Could not load the Excel library. An internet connection is needed the first time you export. Please check your connection and try again.'); };
  document.head.appendChild(s);
}

// ── Download the DSS as an .xlsx matching DSS_Format.xlsx (one sheet per day) ──
function downloadDSSExcel(){
  var crsId=document.getElementById('entry-crs').value;
  var date =document.getElementById('entry-date').value;
  if(!crsId){alert('Please select a CRS shop first.');return;}
  var refDate=date?new Date(date+'T00:00:00'):new Date();
  var year=refDate.getFullYear(), month=refDate.getMonth()+1;
  var daysInMonth=new Date(year,month,0).getDate();
  var moLabel=refDate.toLocaleDateString('en-IN',{month:'long',year:'numeric'});
  var crs=CRS_LIST.find(function(c){return String(c.id)===crsId;});
  var pad=function(n){ return String(n).padStart(2,'0'); };

  // Collect the days that have entries
  var dayList=[];
  for(var day=1; day<=daysInMonth; day++){
    var ds=year+'-'+pad(month)+'-'+pad(day);
    if(entryStore[crsId+'_'+ds]) dayList.push({day:day, ds:ds});
  }
  if(!dayList.length){ alert('No daily entries found for CRS '+crsId+' in '+moLabel+'.'); return; }

  ensureXLSX(function(){
    var XLSX=window.XLSX;
    var XL={
      BRA:'\u0baa\u0bc1\u0bb4\u0bc1\u0b99\u0bcd\u0b95\u0bb2\u0bcd \u0b85\u0bb0\u0bbf\u0b9a\u0bbf', NPHH_FRK:'NPHH FRK \u0b85\u0bb0\u0bbf\u0b9a\u0bbf',
      PHH_FRK:'PHH FRK \u0b85\u0bb0\u0bbf\u0b9a\u0bbf', PHH_BRA:'PHH BRA \u0b85\u0bb0\u0bbf\u0b9a\u0bbf',
      AAY_FRK:'AAY FRK \u0b85\u0bb0\u0bbf\u0b9a\u0bbf', AAY:'AAY \u0b85\u0bb0\u0bbf\u0b9a\u0bbf',
      RRA:'\u0baa\u0b9a\u0bcd\u0b9a\u0bb0\u0bbf\u0b9a\u0bbf', NPHH_RRA:'NPHH FRK RRA\u0b85\u0bb0\u0bbf\u0b9a\u0bbf',
      OAP:'OAP \u0b85\u0bb0\u0bbf\u0b9a\u0bbf', APS:'APS \u0b85\u0bb0\u0bbf\u0b9a\u0bbf', WHEAT:'\u0b95\u0bc7\u0bbe\u0ba4\u0bc1\u0bae\u0bc8',
      SUGAR:'\u0b9a\u0bc0\u0ba9\u0bbf', AAY_SUGAR:'AAY \u0b9a\u0bc0\u0ba9\u0bbf', TOOR:'\u0ba4\u0bc1.\u0baa\u0bb0\u0bc1\u0baa\u0bcd\u0baa\u0bc1',
      PALM:'\u0baa\u0bbe.\u0b86\u0baf\u0bbf\u0bb2\u0bcd', SALT_CIS:'\u0b89\u0baa\u0bcd\u0baa\u0bc1 (CIS)', SALT_RFFS:'\u0b89\u0baa\u0bcd\u0baa\u0bc1 (RFFS)',
      OOTY:'\u0b9f\u0bc0(OOTY)', TAN:'\u0b9f\u0bc0(TAN)', EMPTY_BOX:'\u0b95\u0bbe\u0bb2\u0bbf \u0b85\u0b9f\u0bcd\u0b9f\u0bc8\u0baa\u0bcd\u0baa\u0bc6\u0b9f\u0bcd\u0b9f\u0bbf',
      EMPTY_BAG:'\u0b95\u0bbe\u0bb2\u0bbf \u0baa\u0bbe\u0bb2\u0bbf\u0ba4\u0bc0\u0ba9\u0bcd \u0baa\u0bc8',
      PB_BRA:'\u0baa\u0bc1\u0bb4\u0bc1\u0b99\u0bcd\u0b95\u0bb2\u0bcd \u0b85\u0bb0\u0bbf\u0b9a\u0bbf', PB_SUGAR:'\u0b9a\u0bc0\u0ba9\u0bbf', PB_WHEAT:'\u0b95\u0bc7\u0bbe\u0ba4\u0bc1\u0bae\u0bc8',
      PB_TOOR:'\u0ba4\u0bc1.\u0baa\u0bb0\u0bc1\u0baa\u0bcd\u0baa\u0bc1', PB_PALM:'\u0baa\u0bbe.\u0b86\u0baf\u0bbf\u0bb2\u0bcd'
    };
    var NIL='\u0bb5\u0bbf\u0bb2\u0bc8\u0baf\u0bbf\u0bb2\u0bcd\u0bb2\u0bbe', RUPEE='\u0bb0\u0bc2\u0baa\u0bbe\u0baf\u0bcd', KG='(\u0b95\u0bbf\u0bb2\u0bcb\u0bb5\u0bbf\u0bb2\u0bcd)';
    function lbl(c){ return XL[c.id]||c.ta; }

    // ── style helpers ──
    var BLK={rgb:'FF000000'};
    var med={style:'medium',color:BLK}, thin={style:'thin',color:BLK};
    function bd(t,b,l,r){ return {top:t,bottom:b,left:l,right:r}; }
    var allThin=bd(thin,thin,thin,thin), allMed=bd(med,med,med,med);
    function P(ws,addr,v,s){ var t=(typeof v==='number')?'n':'s'; var cell={t:t,v:v}; if(s)cell.s=s; ws[addr]=cell; }
    var A1=XLSX.utils.encode_cell;

    function buildDaySheet(ds){
      var saved=entryStore[crsId+'_'+ds]||{a:{},b:{}};
      var insp=(typeof inspectionStore!=='undefined' && inspectionStore[crsId+'_'+ds])||{};
      var dObj=new Date(ds+'T00:00:00');
      var dlbl=dObj.toLocaleDateString('en-IN',{weekday:'short',day:'2-digit',month:'short',year:'numeric'});
      var ws={};

      // Title & subtitle
      P(ws,'C3','\u0ba4\u0bae\u0bbf\u0bb4\u0bcd\u0ba8\u0bbe\u0b9f\u0bc1 \u0ba8\u0bc1\u0b95\u0bb0\u0bcd\u0baa\u0bca\u0bb0\u0bc1\u0bb3\u0bcd \u0bb5\u0bbe\u0ba3\u0bbf\u0baa\u0b95\u0bcd\u0b95\u0bb4\u0b95\u0bae\u0bcd, \u0bae\u0ba4\u0bc1\u0bb0\u0bc8 \u0bae\u0ba3\u0bcd\u0b9f\u0bb2\u0bae\u0bcd',
        {font:{sz:16,bold:true},alignment:{horizontal:'center',vertical:'center'}});
      P(ws,'D5','\u0ba4\u0bbf\u0ba9\u0b9a\u0bb0\u0bbf \u0b87\u0bb0\u0bc1\u0baa\u0bcd\u0baa\u0bc1 \u0b85\u0bb1\u0bbf\u0b95\u0bcd\u0b95\u0bc8 / \u0bb5\u0bbf\u0bb1\u0bcd\u0baa\u0ba9\u0bc8 \u0b85\u0bb1\u0bbf\u0b95\u0bcd\u0b95\u0bc8',
        {font:{sz:13,bold:true},alignment:{horizontal:'center',vertical:'center'},border:allMed});
      // Shop no / date row
      P(ws,'C7','\u0ba8\u0bbf\u0baf\u0bbe\u0baf\u0bb5\u0bbf\u0bb2\u0bc8\u0b95\u0bcd\u0b95\u0b9f\u0bc8 \u0b8e\u0ba3\u0bcd:',{font:{sz:12}});
      P(ws,'E7','CRS-'+crsId+(crs?' '+crs.name:''),{font:{sz:13,bold:true}});
      P(ws,'H7','\u0ba8\u0bbe\u0bb3\u0bcd: '+dlbl,{font:{sz:12,bold:true}});

      // Header row 9 + unit row 10
      var hdrs=['\u0bb5.\u0b8e\u0ba3\u0bcd.','\u0baa\u0bca\u0bb0\u0bc1\u0b9f\u0bcd\u0b95\u0bb3\u0bcd','\u0b86\u0bb0\u0bae\u0bcd\u0baa \u0b87\u0bb0\u0bc1\u0baa\u0bcd\u0baa\u0bc1','\u0bb5\u0bb0\u0bb5\u0bc1','\u0bae\u0bca\u0ba4\u0bcd\u0ba4\u0bae\u0bcd','\u0bb5\u0bbf\u0bb1\u0bcd\u0baa\u0ba9\u0bc8','\u0b87\u0bb1\u0bc1\u0ba4\u0bbf \u0b87\u0bb0\u0bc1\u0baa\u0bcd\u0baa\u0bc1','\u0bb5\u0bbf\u0bb1\u0bcd\u0baa\u0ba9\u0bc8 \u0bb5\u0bbf\u0bb2\u0bc8','\u0bae\u0bca\u0ba4\u0bcd\u0ba4 \u0bb5\u0bbf\u0bb1\u0bcd\u0baa\u0ba9\u0bc8\u0ba4\u0bcd\u0ba4\u0bca\u0b95\u0bc8'];
      var hStyle={font:{sz:10,bold:true},alignment:{horizontal:'center',vertical:'center',wrapText:true},border:allMed};
      for(var k=0;k<9;k++){ P(ws,A1({r:8,c:1+k}),hdrs[k],hStyle); }
      var units=['','',KG,KG,KG,KG,KG,'\u0bb0\u0bc2 \u0baa\u0bc8.','\u0bb0\u0bc2 \u0baa\u0bc8.'];
      for(var u=0;u<9;u++){ P(ws,A1({r:9,c:1+u}),units[u],hStyle); }

      function num(v){ return v?Math.round(v*1000)/1000:''; }
      var numS={font:{sz:11},alignment:{horizontal:'right'},border:allThin,numFmt:'0.000'};
      var moneyS={font:{sz:11},alignment:{horizontal:'right'},border:allThin,numFmt:'0.00'};
      var nameS={font:{sz:11},alignment:{horizontal:'left'},border:allThin};
      var ctrS={font:{sz:11},alignment:{horizontal:'center'},border:allThin};
      var freeS={font:{sz:10,color:{rgb:'FF16A34A'}},alignment:{horizontal:'right'},border:allThin};

      // Section rows writer
      function writeSection(comms, sec, startRow, spareTo){
        var tot=0, r=startRow;
        var sum={open:0, rec:0, total:0, sales:0, closing:0};
        comms.forEach(function(c,i){
          var d=(saved[sec]&&saved[sec][c.id])?saved[sec][c.id]:{};
          var ei=(insp[sec]&&insp[sec][c.id])||{};
          var open=parseFloat(d.open||0), rec=parseFloat(d.receipt||0);
          var ex=parseFloat(ei.excess||0), trf=parseFloat(ei.transfer||0), sh=parseFloat(ei.shortage||0);
          var total=open+rec+inspNet({excess:ex,shortage:sh,transfer:trf});   // [C1][S2]
          var sales=parseFloat(d.sales||0), closing=total-sales;   // [S2]
          var amt=c.free?0:sales*c.rate; tot+=amt;
          sum.open+=open; sum.rec+=rec; sum.total+=total; sum.sales+=sales; sum.closing+=closing;
          P(ws,'B'+r,i+1,ctrS);
          P(ws,'C'+r,lbl(c),nameS);
          P(ws,'D'+r,num(open),numS); P(ws,'E'+r,num(rec),numS); P(ws,'F'+r,num(total),numS);
          P(ws,'G'+r,num(sales),numS); P(ws,'H'+r,num(closing),numS);
          P(ws,'I'+r,c.free?NIL:Math.round(c.rate*100)/100,c.free?freeS:moneyS);
          P(ws,'J'+r,c.free?'':(sales?Math.round(amt*100)/100:''),moneyS);
          r++;
        });
        for(var s2=comms.length+1;s2<=spareTo;s2++){
          P(ws,'B'+r,s2,ctrS);
          ['C','D','E','F','G','H','I','J'].forEach(function(col){ P(ws,col+r,'',col==='C'?nameS:(col==='I'||col==='J'?moneyS:numS)); });
          r++;
        }
        return {total:tot, nextRow:r, sum:sum};
      }

      // Section A: rows 11..(11+21-1)=31, spare to row 34 (24), total on row 35
      var A=writeSection(DSS_A,'a',11,24);
      var totS={font:{sz:12,bold:true},border:allThin};
      var totCtr={font:{sz:12,bold:true},alignment:{horizontal:'center'},border:allThin};
      var totMoney={font:{sz:12,bold:true},alignment:{horizontal:'right'},border:allThin,numFmt:'0.00'};
      P(ws,'B35',25,totCtr); P(ws,'C35','\u0bae\u0bca\u0ba4\u0bcd\u0ba4\u0bae\u0bcd',totS);
      var totNumS={font:{sz:12,bold:true},alignment:{horizontal:'right'},border:allThin,numFmt:'0.000'};
      [['D',A.sum.open],['E',A.sum.rec],['F',A.sum.total],['G',A.sum.sales],['H',A.sum.closing]]
        .forEach(function(p){ P(ws,p[0]+'35',num(p[1]),totNumS); });
      P(ws,'I35',RUPEE,{font:{sz:12,bold:true},alignment:{horizontal:'center'},border:allThin});
      P(ws,'J35',Math.round(A.total*100)/100,totMoney);

      // Police header row 36
      P(ws,'C36','\u0b95\u0bbe\u0bb5\u0bb2\u0bb0\u0bcd \u0b85\u0b9f\u0bcd\u0b9f\u0bc8',{font:{sz:12,bold:true},border:allThin});
      ['B','D','E','F','G','H','I','J'].forEach(function(col){ P(ws,col+'36','',allThinCell(col)); });
      function allThinCell(col){ return {border:allThin}; }

      // Police section rows 37..41, spare to 42 (6), total row 43
      var B=writeSection(DSS_B,'b',37,6);
      P(ws,'B43',7,totCtr); P(ws,'C43','\u0bae\u0bca\u0ba4\u0bcd\u0ba4\u0bae\u0bcd',totS);
      [['D',B.sum.open],['E',B.sum.rec],['F',B.sum.total],['G',B.sum.sales],['H',B.sum.closing]]
        .forEach(function(p){ P(ws,p[0]+'43',num(p[1]),totNumS); });
      P(ws,'I43',RUPEE,{font:{sz:12,bold:true},alignment:{horizontal:'center'},border:allThin});
      P(ws,'J43',Math.round(B.total*100)/100,totMoney);

      // Account line row 45, footer rows 47/48
      // [C4] amount remitted = main section + police ration card, not main alone
      var dssRemitTotal = Math.round((A.total + B.total) * 100) / 100;
      P(ws,'D45',APP_CONFIG.accountLabel+' = '+cerealAccountNo(crsId)+' = ',{font:{sz:14,bold:true},alignment:{horizontal:'center'}});   // [M3]
      P(ws,'G45',dssRemitTotal,{font:{sz:12,bold:true},alignment:{horizontal:'center'},numFmt:'0.00',border:bd(undefined,{style:'double',color:BLK},undefined,undefined)});   // [C4]
      P(ws,'C47',APP_CONFIG.submitToOffice,{font:{sz:12}});   // [M3]
      P(ws,'C48',APP_CONFIG.regionName,{font:{sz:12}});   // [M3]
      P(ws,'H48','\u0baa\u0b9f\u0bcd\u0b9f\u0bbf\u0baf\u0bb2\u0bcd \u0b8e\u0bb4\u0bc1\u0ba4\u0bcd\u0ba4\u0bb0\u0bcd \u0b95\u0bc8\u0baf\u0bca\u0baa\u0bcd\u0baa\u0bae\u0bcd',{font:{sz:13}});

      ws['!ref']='A1:J48';
      ws['!merges']=[
        {s:{r:2,c:2},e:{r:2,c:9}},   // C3:J3 title
        {s:{r:4,c:3},e:{r:4,c:7}},   // D5:H5 subtitle
        {s:{r:44,c:3},e:{r:44,c:5}}  // D45:F45 account text
      ];
      ws['!cols']=[{wch:3},{wch:5},{wch:24},{wch:12},{wch:9},{wch:9},{wch:9},{wch:12},{wch:12},{wch:16}];
      // taller data rows
      ws['!rows']=[]; for(var rr=10;rr<=42;rr++){ ws['!rows'][rr]={hpt:20}; }
      return ws;
    }

    var wb=XLSX.utils.book_new();
    dayList.forEach(function(o){
      var ws=buildDaySheet(o.ds);
      var name=pad(o.day)+'-'+pad(month)+'-'+year;
      XLSX.utils.book_append_sheet(wb, ws, name.substring(0,31));
    });
    var fname='DSS_CRS'+crsId+'_'+year+'-'+pad(month)+'.xlsx';
    XLSX.writeFile(wb, fname);
  });
}

// ─── DSS PREVIEW — exact TNCSC daily statement format (matches DSS_Format.xlsx) ──
function openDSSPreview(){
  var crsId=document.getElementById('entry-crs').value;
  var date =document.getElementById('entry-date').value;
  if(!crsId){alert('Please select a CRS shop first.');return;}
  var refDate=date?new Date(date+'T00:00:00'):new Date();
  var year=refDate.getFullYear(),month=refDate.getMonth()+1;
  var daysInMonth=new Date(year,month,0).getDate();
  var moLabel=refDate.toLocaleDateString('en-IN',{month:'long',year:'numeric'});
  var crs=CRS_LIST.find(function(c){return String(c.id)===crsId;});

  // Exact commodity labels from DSS_Format.xlsx (fallback to app label)
  var XL={
    BRA:'\u0baa\u0bc1\u0bb4\u0bc1\u0b99\u0bcd\u0b95\u0bb2\u0bcd \u0b85\u0bb0\u0bbf\u0b9a\u0bbf', NPHH_FRK:'NPHH FRK \u0b85\u0bb0\u0bbf\u0b9a\u0bbf',
    PHH_FRK:'PHH FRK \u0b85\u0bb0\u0bbf\u0b9a\u0bbf', PHH_BRA:'PHH BRA \u0b85\u0bb0\u0bbf\u0b9a\u0bbf',
    AAY_FRK:'AAY FRK \u0b85\u0bb0\u0bbf\u0b9a\u0bbf', AAY:'AAY \u0b85\u0bb0\u0bbf\u0b9a\u0bbf',
    RRA:'\u0baa\u0b9a\u0bcd\u0b9a\u0bb0\u0bbf\u0b9a\u0bbf', NPHH_RRA:'NPHH FRK RRA\u0b85\u0bb0\u0bbf\u0b9a\u0bbf',
    OAP:'OAP \u0b85\u0bb0\u0bbf\u0b9a\u0bbf', APS:'APS \u0b85\u0bb0\u0bbf\u0b9a\u0bbf', WHEAT:'\u0b95\u0bc7\u0bbe\u0ba4\u0bc1\u0bae\u0bc8',
    SUGAR:'\u0b9a\u0bc0\u0ba9\u0bbf', AAY_SUGAR:'AAY \u0b9a\u0bc0\u0ba9\u0bbf', TOOR:'\u0ba4\u0bc1.\u0baa\u0bb0\u0bc1\u0baa\u0bcd\u0baa\u0bc1',
    PALM:'\u0baa\u0bbe.\u0b86\u0baf\u0bbf\u0bb2\u0bcd', SALT_CIS:'\u0b89\u0baa\u0bcd\u0baa\u0bc1 (CIS)', SALT_RFFS:'\u0b89\u0baa\u0bcd\u0baa\u0bc1 (RFFS)',
    OOTY:'\u0b9f\u0bc0(OOTY)', TAN:'\u0b9f\u0bc0(TAN)', EMPTY_BOX:'\u0b95\u0bbe\u0bb2\u0bbf \u0b85\u0b9f\u0bcd\u0b9f\u0bc8\u0baa\u0bcd\u0baa\u0bc6\u0b9f\u0bcd\u0b9f\u0bbf',
    EMPTY_BAG:'\u0b95\u0bbe\u0bb2\u0bbf \u0baa\u0bbe\u0bb2\u0bbf\u0ba4\u0bc0\u0ba9\u0bcd \u0baa\u0bc8',
    PB_BRA:'\u0baa\u0bc1\u0bb4\u0bc1\u0b99\u0bcd\u0b95\u0bb2\u0bcd \u0b85\u0bb0\u0bbf\u0b9a\u0bbf', PB_SUGAR:'\u0b9a\u0bc0\u0ba9\u0bbf', PB_WHEAT:'\u0b95\u0bc7\u0bbe\u0ba4\u0bc1\u0bae\u0bc8',
    PB_TOOR:'\u0ba4\u0bc1.\u0baa\u0bb0\u0bc1\u0baa\u0bcd\u0baa\u0bc1', PB_PALM:'\u0baa\u0bbe.\u0b86\u0baf\u0bbf\u0bb2\u0bcd'
  };
  function lbl(c){ return XL[c.id]||c.ta; }
  function f3(n){ return n?Number(n).toFixed(3):''; }
  function ft3(n){ return Number(n||0).toFixed(3); }   // totals row: never blank
  var NIL='\u0bb5\u0bbf\u0bb2\u0bc8\u0baf\u0bbf\u0bb2\u0bcd\u0bb2\u0bbe';
  var RUPEE='\u0bb0\u0bc2\u0baa\u0bbe\u0baf\u0bcd';
  var KG='(\u0b95\u0bbf\u0bb2\u0bcb\u0bb5\u0bbf\u0bb2\u0bcd)';

  function sectionRows(comms, sec, saved, insp, spareTo){
    var body='', tot=0;
    var sum={open:0, rec:0, total:0, sales:0, closing:0};
    comms.forEach(function(c,i){
      var d=(saved[sec]&&saved[sec][c.id])?saved[sec][c.id]:{};
      var ei=(insp[sec]&&insp[sec][c.id])||{};
      var open=parseFloat(d.open||0), rec=parseFloat(d.receipt||0);
      var ex=parseFloat(ei.excess||0), trf=parseFloat(ei.transfer||0), sh=parseFloat(ei.shortage||0);
      var total=open+rec+inspNet({excess:ex,shortage:sh,transfer:trf});   // [C1][S2]
      var sales=parseFloat(d.sales||0), closing=total-sales;   // [S2]
      var amt=c.free?0:sales*c.rate; tot+=amt;
      sum.open+=open; sum.rec+=rec; sum.total+=total; sum.sales+=sales; sum.closing+=closing;
      body+='<tr>'+
        '<td>'+(i+1)+'</td>'+
        '<td class="nm">'+lbl(c)+'</td>'+
        '<td>'+f3(open)+'</td>'+
        '<td>'+f3(rec)+'</td>'+
        '<td>'+f3(total)+'</td>'+
        '<td>'+f3(sales)+'</td>'+
        '<td>'+f3(closing)+'</td>'+
        '<td class="rt">'+(c.free?NIL:Number(c.rate).toFixed(2))+'</td>'+
        '<td class="rt">'+(c.free?'':(sales?amt.toFixed(2):''))+'</td>'+
      '</tr>';
    });
    for(var s=comms.length+1;s<=spareTo;s++){
      body+='<tr><td>'+s+'</td><td class="nm"></td><td></td><td></td><td></td><td></td><td></td><td></td><td></td></tr>';
    }
    return {body:body, total:tot, sum:sum};
  }

  var pages=[];
  for(var day=1;day<=daysInMonth;day++){
    var ds=year+'-'+String(month).padStart(2,'0')+'-'+String(day).padStart(2,'0');
    var saved=entryStore[crsId+'_'+ds];
    if(!saved) continue;
    var insp=(typeof inspectionStore!=='undefined' && inspectionStore[crsId+'_'+ds])||{};
    var dObj=new Date(ds+'T00:00:00');
    var dlbl=dObj.toLocaleDateString('en-IN',{weekday:'short',day:'2-digit',month:'short',year:'numeric'});

    var A=sectionRows(DSS_A,'a',saved,insp,24);
    var totalRowA='<tr class="tot"><td>25</td><td class="nm">\u0bae\u0bca\u0ba4\u0bcd\u0ba4\u0bae\u0bcd</td>'+
      '<td>'+ft3(A.sum.open)+'</td><td>'+ft3(A.sum.rec)+'</td><td>'+ft3(A.sum.total)+'</td>'+
      '<td>'+ft3(A.sum.sales)+'</td><td>'+ft3(A.sum.closing)+'</td>'+
      '<td class="rt">'+RUPEE+'</td><td class="rt">'+A.total.toFixed(2)+'</td></tr>';
    var policeHdr='<tr class="sec"><td></td><td class="nm">\u0b95\u0bbe\u0bb5\u0bb2\u0bb0\u0bcd \u0b85\u0b9f\u0bcd\u0b9f\u0bc8</td><td></td><td></td><td></td><td></td><td></td><td></td><td></td></tr>';
    var B=sectionRows(DSS_B,'b',saved,insp,6);
    var totalRowB='<tr class="tot"><td>7</td><td class="nm">\u0bae\u0bca\u0ba4\u0bcd\u0ba4\u0bae\u0bcd</td>'+
      '<td>'+ft3(B.sum.open)+'</td><td>'+ft3(B.sum.rec)+'</td><td>'+ft3(B.sum.total)+'</td>'+
      '<td>'+ft3(B.sum.sales)+'</td><td>'+ft3(B.sum.closing)+'</td>'+
      '<td class="rt">'+RUPEE+'</td><td class="rt">'+B.total.toFixed(2)+'</td></tr>';

    // [C4] amount remitted = main section + police ration card, not main alone
    var dssRemitTotal = Math.round((A.total + B.total) * 100) / 100;

    pages.push('<div class="dss-page">'+
      '<div class="dss-title">\u0ba4\u0bae\u0bbf\u0bb4\u0bcd\u0ba8\u0bbe\u0b9f\u0bc1 \u0ba8\u0bc1\u0b95\u0bb0\u0bcd\u0baa\u0bca\u0bb0\u0bc1\u0bb3\u0bcd \u0bb5\u0bbe\u0ba3\u0bbf\u0baa\u0b95\u0bcd\u0b95\u0bb4\u0b95\u0bae\u0bcd, \u0bae\u0ba4\u0bc1\u0bb0\u0bc8 \u0bae\u0ba3\u0bcd\u0b9f\u0bb2\u0bae\u0bcd</div>'+
      '<div class="dss-sub">\u0ba4\u0bbf\u0ba9\u0b9a\u0bb0\u0bbf \u0b87\u0bb0\u0bc1\u0baa\u0bcd\u0baa\u0bc1 \u0b85\u0bb1\u0bbf\u0b95\u0bcd\u0b95\u0bc8 / \u0bb5\u0bbf\u0bb1\u0bcd\u0baa\u0ba9\u0bc8 \u0b85\u0bb1\u0bbf\u0b95\u0bcd\u0b95\u0bc8</div>'+
      '<div class="dss-meta"><span>\u0ba8\u0bbf\u0baf\u0bbe\u0baf\u0bb5\u0bbf\u0bb2\u0bc8\u0b95\u0bcd\u0b95\u0b9f\u0bc8 \u0b8e\u0ba3\u0bcd: <b>CRS-'+crsId+'</b>'+(crs?' '+crs.name:'')+'</span>'+
        '<span>\u0ba8\u0bbe\u0bb3\u0bcd: <b>'+dlbl+'</b></span></div>'+
      '<table class="dss-tbl">'+
        '<colgroup><col style="width:36px"><col style="width:210px"><col><col><col><col><col><col style="width:80px"><col style="width:104px"></colgroup>'+
        '<thead>'+
          '<tr><th>\u0bb5.\u0b8e\u0ba3\u0bcd.</th><th>\u0baa\u0bca\u0bb0\u0bc1\u0b9f\u0bcd\u0b95\u0bb3\u0bcd</th><th>\u0b86\u0bb0\u0bae\u0bcd\u0baa \u0b87\u0bb0\u0bc1\u0baa\u0bcd\u0baa\u0bc1</th><th>\u0bb5\u0bb0\u0bb5\u0bc1</th><th>\u0bae\u0bca\u0ba4\u0bcd\u0ba4\u0bae\u0bcd</th><th>\u0bb5\u0bbf\u0bb1\u0bcd\u0baa\u0ba9\u0bc8</th><th>\u0b87\u0bb1\u0bc1\u0ba4\u0bbf \u0b87\u0bb0\u0bc1\u0baa\u0bcd\u0baa\u0bc1</th><th>\u0bb5\u0bbf\u0bb1\u0bcd\u0baa\u0ba9\u0bc8 \u0bb5\u0bbf\u0bb2\u0bc8</th><th>\u0bae\u0bca\u0ba4\u0bcd\u0ba4 \u0bb5\u0bbf\u0bb1\u0bcd\u0baa\u0ba9\u0bc8\u0ba4\u0bcd\u0ba4\u0bca\u0b95\u0bc8</th></tr>'+
          '<tr class="u"><th></th><th></th><th>'+KG+'</th><th>'+KG+'</th><th>'+KG+'</th><th>'+KG+'</th><th>'+KG+'</th><th>\u0bb0\u0bc2 \u0baa\u0bc8.</th><th>\u0bb0\u0bc2 \u0baa\u0bc8.</th></tr>'+
        '</thead>'+
        '<tbody>'+A.body+totalRowA+policeHdr+B.body+totalRowB+'</tbody>'+
      '</table>'+
      '<div class="dss-acc">'+APP_CONFIG.accountLabel+' = '+cerealAccountNo(crsId)+' = <span class="dss-acc-val">'+dssRemitTotal.toFixed(2)+'</span></div>'+   // [M3][C4]
      '<div class="dss-foot"><div>'+APP_CONFIG.submitToOffice+'<br>'+APP_CONFIG.regionName+'</div>'+   // [M3]
        '<div class="sign">\u0baa\u0b9f\u0bcd\u0b9f\u0bbf\u0baf\u0bb2\u0bcd \u0b8e\u0bb4\u0bc1\u0ba4\u0bcd\u0ba4\u0bb0\u0bcd \u0b95\u0bc8\u0baf\u0bca\u0baa\u0bcd\u0baa\u0bae\u0bcd</div></div>'+
    '</div>');
  }
  if(!pages.length){alert('No daily entries found for CRS '+crsId+' in '+moLabel+'.');return;}

  var css='.dss-page{background:#fff;width:840px;max-width:100%;padding:26px 32px;margin:0 auto 22px;box-shadow:0 2px 12px rgba(0,0,0,.15);color:#000;font-family:\'Latha\',\'Nirmala UI\',\'Arial Unicode MS\',Arial,sans-serif}'+
    '.dss-title{text-align:center;font-size:19px;font-weight:700;margin-bottom:10px}'+
    '.dss-sub{text-align:center;font-size:14px;font-weight:600;border:2px solid #000;padding:5px 8px;margin:0 auto 12px;max-width:460px}'+
    '.dss-meta{display:flex;justify-content:space-between;font-size:13px;margin:0 2px 8px}'+
    '.dss-tbl{width:100%;border-collapse:collapse;font-size:11px;border:2px solid #000;table-layout:fixed}'+
    '.dss-tbl th,.dss-tbl td{border:1px solid #000;padding:3px 4px;text-align:center;height:19px;overflow:hidden}'+
    '.dss-tbl thead th{font-weight:700;font-size:10px;vertical-align:middle}'+
    '.dss-tbl thead tr:first-child th{border-top:2px solid #000;border-bottom:2px solid #000}'+
    '.dss-tbl td.nm{text-align:left;padding-left:7px;white-space:nowrap}'+
    '.dss-tbl td.rt{text-align:right;padding-right:7px}'+
    '.dss-tbl tr.tot td{font-weight:800}'+
    '.dss-tbl tr.sec td.nm{font-weight:700;text-align:left}'+
    '.dss-acc{text-align:center;font-size:15px;font-weight:700;margin:14px 0 4px}'+
    '.dss-acc-val{border-bottom:3px double #000;padding:0 24px;display:inline-block;min-width:120px}'+
    '.dss-foot{display:flex;justify-content:space-between;align-items:flex-end;font-size:12px;margin-top:26px}'+
    '.dss-foot .sign{font-size:13px}'+
    '@media print{'+
      'body *{visibility:hidden!important}'+
      '#dss-viewer,#dss-viewer *{visibility:visible!important}'+
      '#dss-viewer{position:absolute!important;inset:0!important;background:#fff!important;overflow:visible!important;height:auto!important}'+
      '#dss-viewer .no-print{display:none!important}'+
      '#dss-scroll{overflow:visible!important;padding:0!important}'+
      '.dss-page{box-shadow:none!important;margin:0 auto!important;width:100%!important;page-break-after:always}'+
      '.dss-page:last-child{page-break-after:auto}'+
    '}';

  openDSSViewer('DSS \u2014 CRS '+crsId+(crs?' \u2014 '+crs.name:'')+' \u2014 '+moLabel,
    pages.length+' day(s) with entries \u2014 use Print / PDF',
    pages.join(''), css);
}


// ═══ [S4] BACKUP / RESTORE ═══════════════════════════════════════════════════
// One JSON file holds every module's data. No localStorage: it is unavailable
// in the sandboxed preview and fails quietly there, which is worse than not
// having it. The operator keeps the file.

