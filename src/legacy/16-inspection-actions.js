/* Inspection entry overlay and actions
   Verbatim from TNCSC_CRS_Demo_19 (1).html lines 9247-9436.
   These parts are concatenated back into one classic script by
   tools/bundle-engine.mjs - the code hoists across the whole block and
   its declarations must stay global for the markup's inline handlers. */
var INSP_TYPES={
  shortage:{label:'Shortage',ta:'\u0baa\u0bb1\u0bcd\u0bb1\u0bbe\u0b95\u0bcd\u0b95\u0bc1\u0bb1\u0bc8',icon:'\ud83d\udd3b',color:'#DC2626',bg:'#FEF2F2',bd:'#FCA5A5',hdr:'#991B1B',sign:'\u2212',desc:'Stock is less than expected',verb:'Shortage (less)'},
  excess:  {label:'Excess',  ta:'\u0b89\u0baa\u0bb0\u0bbf',            icon:'\ud83d\udd3a',color:'#15803D',bg:'#F0FDF4',bd:'#86EFAC',hdr:'#166534',sign:'+',      desc:'Extra stock found on hand',verb:'Excess (add)'},
  transfer:{label:'Transfer',ta:'\u0b87\u0b9f\u0bae\u0bbe\u0bb1\u0bcd\u0bb1\u0bae\u0bcd',icon:'\ud83d\udd04',color:'#0369A1',bg:'#EFF6FF',bd:'#BAE6FD',hdr:'#1D4ED8',sign:'\u00b1',desc:'Stock moved in (+) or out (\u2212)',verb:'Transfer (in +/out \u2212)'}
};

// ── Overlay helpers (the popup renders reliably, so we keep everything inside it) ──
function inspEnsureOverlay(){
  var ov=document.getElementById('insp-menu-overlay');
  if(!ov){
    ov=document.createElement('div');
    ov.id='insp-menu-overlay';
    ov.style.cssText='position:fixed;inset:0;z-index:9500;background:rgba(13,30,63,.55);display:flex;align-items:center;justify-content:center;padding:20px';
    ov.onclick=function(e){ if(e.target===ov) inspCloseOverlay(); };
    document.body.appendChild(ov);
  }
  return ov;
}
function inspCloseOverlay(){
  var ov=document.getElementById('insp-menu-overlay');
  if(ov) ov.remove();
}

// ─── INSPECTION ENTRY — STEP 1: choose Shortage / Excess / Transfer ───────────
function openInspectionEntry(){
  var crsId = document.getElementById('entry-crs').value;
  var date  = document.getElementById('entry-date').value;
  if(!crsId||!date){alert('Please select a CRS shop and date first.');return;}
  var crs=CRS_LIST.find(function(c){return String(c.id)===crsId;});
  var dObj=new Date(date+'T00:00:00');
  var dLabel=dObj.toLocaleDateString('en-IN',{weekday:'long',day:'numeric',month:'long',year:'numeric'});
  var ov=inspEnsureOverlay();

  var order=['shortage','excess','transfer'];
  var cardsHtml=order.map(function(t){
    var o=INSP_TYPES[t];
    return '<button type="button" onclick="openInspectionAction(\''+t+'\')" '+
      'style="display:flex;align-items:center;gap:14px;width:100%;text-align:left;background:'+o.bg+';border:1.5px solid '+o.bd+';border-radius:12px;padding:15px 18px;cursor:pointer;transition:.15s;margin-bottom:10px" '+
      'onmouseover="this.style.boxShadow=\'0 6px 16px rgba(0,0,0,.10)\'" onmouseout="this.style.boxShadow=\'\'">'+
      '<div style="font-size:26px;line-height:1">'+o.icon+'</div>'+
      '<div style="flex:1">'+
        '<div style="font-weight:800;font-size:15px;color:'+o.color+'">'+o.label+' <span style="font-weight:600;font-size:12px;color:#64748B">'+o.ta+'</span></div>'+
        '<div style="font-size:12px;color:#64748B;margin-top:2px">'+o.desc+'</div>'+
      '</div>'+
      '<div style="font-size:22px;color:'+o.color+';font-weight:700">\u203a</div></button>';
  }).join('');

  ov.innerHTML='<div style="background:#fff;border-radius:16px;width:100%;max-width:440px;box-shadow:0 20px 60px rgba(0,0,0,.3);overflow:hidden" onclick="event.stopPropagation()">'+
    '<div style="background:linear-gradient(135deg,#7C3AED,#9333EA);padding:18px 22px;color:#fff;display:flex;justify-content:space-between;align-items:flex-start;gap:10px">'+
      '<div><div style="font-weight:800;font-size:16px">\ud83d\udd0d Inspection</div>'+
      '<div style="font-size:12px;opacity:.85;margin-top:2px">CRS '+crsId+(crs?' \u2014 '+crs.name:'')+' \u2022 '+dLabel+'</div></div>'+
      '<button type="button" onclick="inspCloseOverlay()" style="background:rgba(255,255,255,.2);border:none;color:#fff;width:28px;height:28px;border-radius:8px;cursor:pointer;font-size:15px;flex-shrink:0">\u2715</button>'+
    '</div>'+
    '<div style="padding:18px 20px">'+
      '<div style="font-size:12px;color:#64748B;margin-bottom:12px">Choose the type of stock adjustment to record for this day:</div>'+
      cardsHtml+
      '<button type="button" onclick="inspCloseOverlay()" style="width:100%;margin-top:4px;background:#F1F5F9;border:none;border-radius:10px;padding:10px;font-size:13px;font-weight:600;color:#475569;cursor:pointer">Cancel</button>'+
    '</div></div>';
}

// ─── INSPECTION ENTRY — STEP 2: available stock + action for the chosen type ──
function openInspectionAction(type){
  var meta=INSP_TYPES[type]; if(!meta) return;
  var crsId=document.getElementById('entry-crs').value;
  var date =document.getElementById('entry-date').value;
  if(!crsId||!date){alert('Please select a CRS shop and date first.');return;}
  var key=crsId+'_'+date, saved=entryStore[key];
  var crs=CRS_LIST.find(function(c){return String(c.id)===crsId;});
  var dObj=new Date(date+'T00:00:00');
  var dLabel=dObj.toLocaleDateString('en-IN',{weekday:'long',day:'numeric',month:'long',year:'numeric'});
  var inspKey=crsId+'_'+date;
  var existInsp=(typeof inspectionStore!=='undefined' && inspectionStore[inspKey]) || {};
  // Police ration card (Section B) has no shortage — exclude it on the shortage screen only
  var listA=DSS_A.map(function(c){return {c:c,sec:'a'};});
  var listB=DSS_B.map(function(c){return {c:c,sec:'b'};});
  var comms=(type==='shortage')?listA:listA.concat(listB);

  var rows=comms.map(function(item,i){
    var c=item.c, sec=item.sec;
    var d=saved&&saved[sec]&&saved[sec][c.id]?saved[sec][c.id]:{};
    var ei=(existInsp[sec]&&existInsp[sec][c.id])||{};
    var open=parseFloat(d.open||0),rec=parseFloat(d.receipt||0);
    var avail=open+rec;
    var ex=parseFloat(ei.excess||0),trf=parseFloat(ei.transfer||0),sh=parseFloat(ei.shortage||0);
    var curVal=(type==='excess')?ex:(type==='transfer'?trf:sh);
    var total=open+rec+inspNet({excess:ex,shortage:sh,transfer:trf});   // [C1][S2]
    var minAttr=(type==='transfer')?'':'min="0" ';
    var amt=c.free?0:(curVal*c.rate);
    var amtHtml=c.free
      ? '<span style="color:#16A34A;font-style:italic;font-size:10px">Free</span>'
      : '\u20b9'+amt.toFixed(2);
    var rateHtml=c.free
      ? '<span style="color:#16A34A;font-size:10px">Free</span>'
      : '\u20b9'+c.rate.toFixed(2);
    return '<tr data-open="'+open+'" data-rec="'+rec+'" data-ex="'+ex+'" data-tr="'+trf+'" data-sh="'+sh+'" data-rate="'+c.rate+'" data-free="'+(c.free?'1':'0')+'">'+
      '<td style="text-align:center;color:#6B7A8F">'+(i+1)+'</td>'+
      '<td><b>'+c.ta+'</b><br><span style="color:#6B7A8F;font-size:10px">'+c.en+'</span></td>'+
      '<td style="text-align:center;color:#6B7A8F">'+c.unit+'</td>'+
      '<td style="text-align:center;font-weight:600">'+rateHtml+'</td>'+
      '<td style="text-align:right;font-weight:700;background:#FEF9C3;color:#92400E">'+avail.toFixed(3)+'</td>'+
      '<td style="background:'+meta.bg+';padding:3px 5px"><input type="number" '+minAttr+'step="0.001" placeholder="0" value="'+(curVal||'')+'" '+
        'data-id="'+c.id+'" data-sec="'+sec+'" data-field="'+type+'" '+
        'style="width:96px;border:1px solid '+meta.bd+';border-radius:5px;padding:5px 7px;font-size:12px;text-align:right;font-weight:700;color:'+meta.color+';background:#fff" '+
        'oninput="inspActionCalc(this)"/></td>'+
      '<td id="ia-amt-'+sec+'-'+c.id+'" style="text-align:right;font-weight:800;color:#92400E;background:#FFFBEB">'+amtHtml+'</td>'+
      '<td id="ia-total-'+sec+'-'+c.id+'" style="text-align:right;font-weight:800;color:#0369A1;background:#EFF6FF">'+total.toFixed(3)+'</td>'+
    '</tr>';
  }).join('');

  var policeNote=(type==='shortage')
    ? '<div style="font-size:11px;color:#C2410C;background:#FFF7ED;border:1px solid #FED7AA;border-radius:8px;padding:8px 12px;margin-bottom:10px"><b>Note:</b> Police ration card (Section B) commodities are excluded &mdash; shortage does not apply to them.</div>'
    : '';

  var note='<div style="display:flex;align-items:flex-start;gap:8px;background:'+meta.bg+';border:1px solid '+meta.bd+';border-radius:10px;padding:10px 14px;margin-bottom:12px;font-size:12px;color:'+meta.color+'">'+
    '<span style="font-size:16px;line-height:1.2">\u2139\ufe0f</span>'+
    '<span><b>Available Stock</b> = Opening + Receipt for the day. Enter the <b>'+meta.verb+'</b> quantity per commodity &mdash; the <b>Value (\u20b9)</b> and <b>New Total</b> update automatically (Value = quantity \u00d7 rate).</span></div>'+policeNote;

  var styleBlock='<style>'+
    '#insp-menu-overlay .ia-table{width:100%;border-collapse:collapse;font-size:12px}'+
    '#insp-menu-overlay .ia-table th{background:#1E40AF;color:#fff;padding:7px 8px;border:1px solid #1D4ED8;text-align:center;font-size:10px;position:sticky;top:0;z-index:1}'+
    '#insp-menu-overlay .ia-table td{border:1px solid #E2E8F0;padding:6px 8px}'+
    '#insp-menu-overlay .ia-table tr:nth-child(even) td{background:#F8FAFC}'+
    '</style>';

  var tbl='<table class="ia-table"><thead><tr>'+
    '<th style="width:30px">#</th><th style="text-align:left">Commodity</th><th style="width:42px">Unit</th>'+
    '<th style="width:70px">Rate</th>'+
    '<th style="background:#92400E;width:110px">Available Stock<br><span style="font-weight:500;font-size:8px">Opening + Receipt</span></th>'+
    '<th style="background:'+meta.hdr+';width:130px">'+meta.label+' ('+meta.sign+')</th>'+
    '<th style="background:#B45309;width:100px">Value (\u20b9)<br><span style="font-weight:500;font-size:8px">qty \u00d7 rate</span></th>'+
    '<th style="background:#0369A1;width:110px">New Total</th></tr></thead>'+
    '<tbody>'+rows+'</tbody></table>';

  var ov=inspEnsureOverlay();
  ov.innerHTML='<div style="background:#fff;border-radius:16px;width:100%;max-width:860px;max-height:92vh;display:flex;flex-direction:column;box-shadow:0 20px 60px rgba(0,0,0,.3);overflow:hidden" onclick="event.stopPropagation()">'+
    '<div style="background:linear-gradient(135deg,'+meta.hdr+','+meta.color+');padding:16px 20px;color:#fff;display:flex;justify-content:space-between;align-items:center;gap:10px;flex-shrink:0">'+
      '<div><div style="font-weight:800;font-size:15px">'+meta.icon+' '+meta.label+' \u2014 '+meta.ta+'</div>'+
      '<div style="font-size:11px;opacity:.85;margin-top:2px">CRS '+crsId+(crs?' \u2014 '+crs.name:'')+' \u2022 '+dLabel+'</div></div>'+
      '<button type="button" onclick="inspCloseOverlay()" style="background:rgba(255,255,255,.2);border:none;color:#fff;width:28px;height:28px;border-radius:8px;cursor:pointer;font-size:15px;flex-shrink:0">\u2715</button>'+
    '</div>'+
    styleBlock+
    '<div style="padding:16px 18px;overflow:auto;flex:1">'+note+tbl+'</div>'+
    '<div style="padding:12px 18px;border-top:1px solid #E2E8F0;display:flex;justify-content:space-between;align-items:center;gap:10px;flex-shrink:0;background:#fff">'+
      '<button type="button" onclick="openInspectionEntry()" style="background:#F1F5F9;border:none;padding:9px 18px;border-radius:8px;font-size:13px;font-weight:600;color:#475569;cursor:pointer">\u2039 Back</button>'+
      '<div style="display:flex;align-items:center;gap:10px"><span id="insp-save-msg" style="font-size:12px;color:#16A34A;font-weight:700"></span>'+
      '<button type="button" onclick="saveInspectionAction(\''+crsId+'\',\''+date+'\')" style="background:#16A34A;color:#fff;border:none;padding:9px 22px;border-radius:8px;font-size:13px;font-weight:700;cursor:pointer">\u2713 Save '+meta.label+'</button></div>'+
    '</div>'+
  '</div>';
}

// ── Live recompute of "Value (₹)" and "New Total" as the user types ───────────
function inspActionCalc(input){
  var tr=input.closest('tr'); if(!tr) return;
  var open=parseFloat(tr.dataset.open)||0, rec=parseFloat(tr.dataset.rec)||0;
  var ex=parseFloat(tr.dataset.ex)||0, trf=parseFloat(tr.dataset.tr)||0, sh=parseFloat(tr.dataset.sh)||0;
  var v=parseFloat(input.value)||0, f=input.dataset.field;
  if(f==='excess') ex=v; else if(f==='transfer') trf=v; else if(f==='shortage') sh=v;
  var sec=input.dataset.sec, id=input.dataset.id;
  var total=open+rec+inspNet({excess:ex,shortage:sh,transfer:trf});   // [C1][S2]
  var totEl=document.getElementById('ia-total-'+sec+'-'+id);
  if(totEl) totEl.textContent=total.toFixed(3);
  // Value (₹) = entered quantity × rate (skip free commodities, keep "Free")
  var amtEl=document.getElementById('ia-amt-'+sec+'-'+id);
  if(amtEl && tr.dataset.free!=='1'){
    var rate=parseFloat(tr.dataset.rate)||0;
    amtEl.textContent='\u20b9'+(v*rate).toFixed(2);
  }
}

// ── Save the current inspection screen's values into inspectionStore ───────────
function saveInspectionAction(crsId,date){
  var ov=document.getElementById('insp-menu-overlay'); if(!ov) return;
  var inputs=ov.querySelectorAll('input[data-id]');
  var inspKey=crsId+'_'+date;
  if(typeof inspectionStore==='undefined') window.inspectionStore={};
  if(!inspectionStore[inspKey]) inspectionStore[inspKey]={a:{},b:{}};
  inputs.forEach(function(inp){
    var id=inp.dataset.id, sec=inp.dataset.sec, field=inp.dataset.field;
    var val=parseFloat(inp.value)||0;
    if(!inspectionStore[inspKey][sec]) inspectionStore[inspKey][sec]={};
    if(!inspectionStore[inspKey][sec][id]) inspectionStore[inspKey][sec][id]={};
    inspectionStore[inspKey][sec][id][field]=val;
  });
  var msg=document.getElementById('insp-save-msg');
  if(msg) msg.textContent='\u2713 Saved!';
  setTimeout(function(){ inspRefreshEntryScreens(crsId, date); }, 60);
}

// ─── DSS PREVIEW ──────────────────────────────────────────────────────────────
// ── Load Sample Data for testing (fills Daily Entries + some Inspection data) ──
