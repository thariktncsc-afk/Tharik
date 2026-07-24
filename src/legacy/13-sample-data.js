/* Sample-data seeding engine
   Verbatim from TNCSC_CRS_Demo_19 (1).html lines 7744-8227.
   These parts are concatenated back into one classic script by
   tools/bundle-engine.mjs - the code hoists across the whole block and
   its declarations must stay global for the markup's inline handlers. */
function sdBagDiv(id){ return bagDiv(id); }
function sdPad(n){ return String(n).padStart(2,'0'); }
function sdRnd(seed){ var x = Math.sin(seed*127.1 + 11.7) * 43758.5453; return x - Math.floor(x); }
function sd3(v){ return +(Number(v || 0).toFixed(3)); }
function sd2(v){ return +(Number(v || 0).toFixed(2)); }

// Per-commodity monthly allotment profile (kgs / ltr / pkts / nos)
function sdAllotment(id, crsId, seed){
  var BASE = {
    BRA:9000, PHH_BRA:3400, PHH_FRK:3500, NPHH_FRK:5000, NPHH_RRA:900,
    AAY:1400, AAY_FRK:400, RRA:1200, OAP:300, APS:250, WHEAT:1100,
    SUGAR:750, AAY_SUGAR:20, TOOR:500, PALM:500,
    SALT_CIS:220, SALT_RFFS:180, OOTY:120, TAN:90,
    EMPTY_BOX:60, EMPTY_BAG:40,
    PB_BRA:260, PB_SUGAR:36, PB_WHEAT:40, PB_TOOR:18, PB_PALM:18
  };
  var base = BASE[id] !== undefined ? BASE[id] : 200;
  var flex = 0.85 + sdRnd(seed + crsId * 7) * 0.30;      // ±15 % per shop
  return Math.round(base * flex);
}

function sdWorkingDays(year, month){
  var out = [], n = new Date(year, month, 0).getDate();
  for(var day = 1; day <= n; day++){
    var dt = new Date(year, month - 1, day);
    if(typeof isHoliday === 'function' && isHoliday(dt)) continue;
    out.push(day);
  }
  return out;
}

// ── The generator ─────────────────────────────────────────────────────────
function sdSeedAllModules(crsId, month, year){
  crsId = parseInt(crsId, 10); month = parseInt(month, 10); year = parseInt(year, 10);
  var key         = crsId + '_' + month + '_' + year;
  var daysInMonth = new Date(year, month, 0).getDate();
  var workDays    = sdWorkingDays(year, month);
  var comms       = [].concat(DSS_A || [], DSS_B || []);
  var secOf       = {}; (DSS_A||[]).forEach(function(c){ secOf[c.id]='a'; });
                        (DSS_B||[]).forEach(function(c){ secOf[c.id]='b'; });

  // ── MODULE: Card Details ────────────────────────────────────────────────
  var CARD_MIX = {rice:640, lof_rice:6, sugar:12, lof_sugar:2, aay:14,
                  lof_aay:2, oap:9, police:4, n_card:2};
  meCardStore[key] = {};
  (typeof ME_CARD_TYPES !== 'undefined' ? ME_CARD_TYPES : []).forEach(function(ct, i){
    var b = CARD_MIX[ct.id] !== undefined ? CARD_MIX[ct.id] : 3;
    meCardStore[key][ct.id] = {
      count: Math.max(0, Math.round(b * (0.9 + sdRnd(i + crsId * 3) * 0.2))),
      remarks: ''
    };
  });

  // ── MODULE: Receipt (godown receipts, 3 per month) ──────────────────────
  var rcDays = [
    workDays[1] || 2,
    workDays[Math.floor(workDays.length * 0.4)] || 12,
    workDays[Math.floor(workDays.length * 0.75)] || 22
  ];
  var monthPrefix = year + '-' + sdPad(month);
  if(typeof receiptStore !== 'undefined'){
    for(var ri = receiptStore.length - 1; ri >= 0; ri--){
      var rr = receiptStore[ri];
      if(parseInt(rr.crsId,10) === crsId && String(rr.date||'').indexOf(monthPrefix) === 0) receiptStore.splice(ri, 1);
    }
  }
  var allot = {};                       // id -> total monthly allotment
  var rcSplit = [0.5, 0.3, 0.2];
  var receiptsMade = [];
  rcDays.forEach(function(day, idx){
    var items = {};
    comms.forEach(function(c, ci){
      if(secOf[c.id] === 'b') return;              // police stock comes in once
      if(allot[c.id] === undefined) allot[c.id] = sdAllotment(c.id, crsId, ci);
      var q = Math.round(allot[c.id] * rcSplit[idx]);
      if(q > 0) items[c.id] = {qty: q};
    });
    if(idx === 0){
      (DSS_B || []).forEach(function(c, ci){
        allot[c.id] = sdAllotment(c.id, crsId, 100 + ci);
        items[c.id] = {qty: allot[c.id]};
      });
    }
    var rec = {
      id: (typeof rpNextId !== 'undefined' ? rpNextId++ : Date.now() + idx),
      crsId: crsId,
      date: year + '-' + sdPad(month) + '-' + sdPad(day),
      receiptNo: 'R/' + year + '/' + sdPad(crsId) + sdPad(idx + 1),
      items: items,
      savedAt: year + '-' + sdPad(month) + '-' + sdPad(day) + ' 09:' + sdPad(10 + idx * 7)
    };
    receiptStore.push(rec);
    receiptsMade.push(rec);
  });

  // ── Inspection plan (applied to the daily ledger below) ────────────────
  var _wd = workDays;
  var inspPlan = [
    {day: _wd[2]  || 3,  sec:'a', id:'SUGAR',    field:'excess',   val: 5},
    {day: _wd[2]  || 3,  sec:'a', id:'TOOR',     field:'shortage', val: 2},
    {day: _wd[7]  || 8,  sec:'a', id:'PALM',     field:'transfer', val: 10},
    {day: _wd[7]  || 8,  sec:'b', id:'PB_SUGAR', field:'shortage', val: 1},
    {day: _wd[13] || 15, sec:'a', id:'BRA',      field:'transfer', val: 50},
    {day: _wd[13] || 15, sec:'a', id:'WHEAT',    field:'excess',   val: 8}
  ];
  var inspByDayComm = {};
  inspPlan.forEach(function(p){
    var k = p.day + '|' + p.id;
    if(!inspByDayComm[k]) inspByDayComm[k] = {excess:0, shortage:0, transfer:0};
    inspByDayComm[k][p.field] += p.val;
  });

  // ── MODULE: Daily Entry (the ledger everything else is derived from) ────
  var opening = {};                     // running opening per commodity
  comms.forEach(function(c, ci){
    if(allot[c.id] === undefined) allot[c.id] = sdAllotment(c.id, crsId, ci);
    opening[c.id] = Math.round(allot[c.id] * (0.10 + sdRnd(ci + crsId) * 0.10));
  });

  var monthOpen  = {}, monthReceipt = {}, monthSales = {}, monthAmount = {};
  comms.forEach(function(c){
    monthOpen[c.id]    = opening[c.id];
    monthReceipt[c.id] = 0; monthSales[c.id] = 0; monthAmount[c.id] = 0;
  });

  var perDayAmount = {};                // day -> total sale value (for remittance)
  var lastClose    = {};

  for(var day = 1; day <= daysInMonth; day++){
    var ds      = year + '-' + sdPad(month) + '-' + sdPad(day);
    var working = workDays.indexOf(day) !== -1;
    var rcIdx   = rcDays.indexOf(day);
    if(!working && rcIdx === -1){ continue; }         // shop closed, nothing to key

    var snap = {a:{}, b:{}}, dayAmt = 0;
    comms.forEach(function(c, ci){
      var sec  = secOf[c.id] || 'a';
      var open = opening[c.id];
      var rcv  = 0;
      if(rcIdx !== -1){
        var r = receiptsMade[rcIdx];
        if(r.items[c.id]) rcv = r.items[c.id].qty;
      }
      var _adj  = inspByDayComm[day + '|' + c.id] || {excess:0, shortage:0, transfer:0};
      var total = open + rcv + inspNet(_adj);   // [C1]
      // spread the month's allotment evenly over the working days (±20 %)
      var target = working ? (allot[c.id] / Math.max(1, workDays.length)) : 0;
      var sales  = Math.round(target * (0.8 + sdRnd(day * 13 + ci) * 0.4));
      if(sales > total) sales = total;
      if(sales < 0) sales = 0;
      var close  = total - sales;
      var amount = c.free ? 0 : sd2(sales * (c.rate || 0));
      snap[sec][c.id] = {open: sd3(open), receipt: sd3(rcv), total: sd3(total),
                         sales: sd3(sales), close: sd3(close), amount: amount,
                         excess: _adj.excess, shortage: _adj.shortage, transfer: _adj.transfer};
      dayAmt += amount;
      monthReceipt[c.id] += rcv;
      monthSales[c.id]   += sales;
      monthAmount[c.id]  += amount;
      lastClose[c.id]     = close;
      opening[c.id]       = close;
    });

    // Remittance is keyed on the day sheet (banked the next working day)
    var _wi = workDays.indexOf(day);
    var _nx = (_wi !== -1 && workDays[_wi + 1]) ? workDays[_wi + 1] : day;
    snap.remitDate   = working && dayAmt ? (year + '-' + sdPad(month) + '-' + sdPad(_nx)) : '';
    snap.remitAmount = working ? sd2(dayAmt) : 0;
    entryStore[crsId + '_' + ds] = snap;
    perDayAmount[day] = sd2(dayAmt);
  }

  // ── MODULE: Inspection (excess / shortage / transfer on three days) ─────
  if(typeof inspectionStore === 'undefined') window.inspectionStore = {};
  inspPlan.forEach(function(p){
    var k = crsId + '_' + year + '-' + sdPad(month) + '-' + sdPad(p.day);
    if(!inspectionStore[k]) inspectionStore[k] = {a:{}, b:{}};
    if(!inspectionStore[k][p.sec]) inspectionStore[k][p.sec] = {};
    if(!inspectionStore[k][p.sec][p.id]) inspectionStore[k][p.sec][p.id] = {};
    inspectionStore[k][p.sec][p.id][p.field] = p.val;
  });

  // ── MODULE: Monthly Entry (roll-up of the daily ledger) ─────────────────
  var msnap = {a:{}, b:{}};
  comms.forEach(function(c){
    var sec   = secOf[c.id] || 'a';
    var open  = monthOpen[c.id];
    var rcv   = monthReceipt[c.id];
    var total = open + rcv;
    var sales = monthSales[c.id];
    var close = lastClose[c.id] !== undefined ? lastClose[c.id] : (total - sales);
    var div   = sdBagDiv(c.id);
    var bag   = function(v){ return v > 0 ? Math.floor(v / div) : 0; };
    msnap[sec][c.id] = {
      open: sd3(open), receipt: sd3(rcv), total: sd3(total),
      sales: sd3(sales), close: sd3(close), amount: sd2(monthAmount[c.id]),
      g_open: bag(open), g_receipt: bag(rcv), g_total: bag(total),
      g_sales: bag(sales), g_close: bag(close)
    };
  });
  // Publish through the accumulation engine so Daily -> Monthly stays the
  // single source of truth (the daily sheets above already carry the figures).
  monthlyStore[key] = msnap;
  try{ if(typeof rebuildMonthlyFromDaily === 'function') rebuildMonthlyFromDaily(crsId, month, year); }catch(e){}

  // ── MODULE: Gunny Stock ─────────────────────────────────────────────────
  var GRAIN = ['BRA','PHH_BRA','PHH_FRK','AAY_FRK','AAY','RRA','NPHH_FRK','NPHH_RRA','OAP','APS','WHEAT'];
  var ssOB = 0, ssRec = 0, ssIss = 0;
  GRAIN.forEach(function(id){
    var m = msnap.a[id] || {};
    ssOB  += m.g_open    || 0;
    ssRec += m.g_receipt || 0;
    ssIss += m.g_sales   || 0;
  });
  function gRec(itemId, name, ob, rc, iss){
    var total = ob + rc, closing = total - iss;
    return {opening: ob, receipt: rc, total: total, issues: iss, closing: closing,
            openingAuto: false, crsId: crsId, month: month, year: year, itemName: name,
            createdAt: new Date().toISOString(), updatedAt: new Date().toISOString()};
  }
  var polyM = msnap.a['EMPTY_BAG'] || {}, boxM = msnap.a['EMPTY_BOX'] || {};
  meGunnyStore[key] = {
    ss50: gRec('ss50', '50 KG SS', ssOB, ssRec, ssIss),
    poly: gRec('poly', 'POLY',  Math.round(polyM.open || 0), Math.round(polyM.receipt || 0), Math.round(polyM.sales || 0)),
    cbox: gRec('cbox', 'C.BOX', Math.round(boxM.open  || 0), Math.round(boxM.receipt  || 0), Math.round(boxM.sales  || 0))
  };

  // ── MODULE: Sales Close ─────────────────────────────────────────────────
  var lastWork = workDays[workDays.length - 1] || daysInMonth;
  salesCloseStore[key] = {
    date: year + '-' + sdPad(month) + '-' + sdPad(lastWork),
    gunny: ssRec, poly: Math.round(polyM.sales || 0), cbox: Math.round(boxM.sales || 0),
    updatedAt: new Date().toISOString()
  };

  // ── MODULE: Remittance (each day's takings banked the next working day) ─
  meRemitStore[key] = {};
  var polyAmt = sd2((msnap.a['EMPTY_BAG'] || {}).amount || 0);
  var boxAmt  = sd2((msnap.a['EMPTY_BOX'] || {}).amount || 0);
  workDays.forEach(function(day, i){
    var amt = perDayAmount[day] || 0;
    if(!amt) return;
    var nextWork = workDays[i + 1] || day;
    meRemitStore[key][day] = {
      remitDate: year + '-' + sdPad(month) + '-' + sdPad(nextWork),
      nonCereal: sd2(amt),
      cereal: 0
    };
  });
  var nMo = month === 12 ? 1 : month + 1, nYr = month === 12 ? year + 1 : year;
  meRemitStore[key]['extra'] = {
    e1label: 'POLY GUNNY & C.BOX',
    e1date : nYr + '-' + sdPad(nMo) + '-01',
    e1nc   : sd2(polyAmt + boxAmt),
    e1ce   : '',
    e2label: 'INSPEC.CHARGES',
    e2date : nYr + '-' + sdPad(nMo) + '-01',
    e2nc   : 120,
    e2ce   : '',
    e3label: '', e3date: '', e3nc: '', e3ce: ''
  };

  return {
    crsId: crsId, month: month, year: year,
    days: Object.keys(perDayAmount).length,
    receipts: receiptsMade.length,
    workDays: workDays.length,
    cards: Object.keys(meCardStore[key]).length,
    inspections: inspPlan.length
  };
}

// ── Wipe every module's data for one CRS + month ──────────────────────────
function sdClearAllModules(crsId, month, year){
  crsId = parseInt(crsId, 10); month = parseInt(month, 10); year = parseInt(year, 10);
  var key = crsId + '_' + month + '_' + year;
  var prefix = year + '-' + sdPad(month);
  var n = new Date(year, month, 0).getDate();
  for(var day = 1; day <= n; day++){
    var ds = crsId + '_' + prefix + '-' + sdPad(day);
    delete entryStore[ds];
    if(typeof inspectionStore !== 'undefined') delete inspectionStore[ds];
  }
  delete monthlyStore[key];
  if(typeof meManualStore!=='undefined') delete meManualStore[key];
  if(typeof meSourceStore!=='undefined') delete meSourceStore[key];
  delete meRemitStore[key];
  delete meGunnyStore[key];
  delete meCardStore[key];
  if(typeof salesCloseStore !== 'undefined') delete salesCloseStore[key];
  if(typeof receiptStore !== 'undefined'){
    for(var i = receiptStore.length - 1; i >= 0; i--){
      var r = receiptStore[i];
      if(parseInt(r.crsId,10) === crsId && String(r.date||'').indexOf(prefix) === 0) receiptStore.splice(i, 1);
    }
  }
}

// ── Statement page buttons ────────────────────────────────────────────────
function stmtSampleParams(){
  var crsEl = document.getElementById('stmt-crs');
  var crsId = crsEl ? parseInt(crsEl.value, 10) : NaN;
  if(!crsId){ alert('Please select a CRS shop first.'); return null; }
  return {
    crsId: crsId,
    month: parseInt(document.getElementById('stmt-month').value, 10),
    year : parseInt(document.getElementById('stmt-year').value, 10)
  };
}

function stmtLoadSampleData(){
  var p = stmtSampleParams(); if(!p) return;
  var r = sdSeedAllModules(p.crsId, p.month, p.year);
  stmtAfterSampleChange(p);
  alert('\u2705 Sample data loaded into every module\n\n' +
        'CRS ' + p.crsId + ' \u00b7 ' + (STMT_MONTHS[p.month] || '') + ' ' + p.year + '\n\n' +
        '\u2022 Daily Entry \u2014 ' + r.days + ' day sheets (' + r.workDays + ' working days)\n' +
        '\u2022 Receipt \u2014 ' + r.receipts + ' godown receipts\n' +
        '\u2022 Monthly Entry \u2014 all commodities rolled up\n' +
        '\u2022 Gunny Stock \u2014 50 KG SS / POLY / C.BOX\n' +
        '\u2022 Card Details \u2014 ' + r.cards + ' card types\n' +
        '\u2022 Remittance \u2014 day-wise + extra rows\n' +
        '\u2022 Inspection \u2014 ' + r.inspections + ' adjustments\n\n' +
        'Open any section preview \u2014 they all read live data now.');
}

function stmtClearSampleData(){
  var p = stmtSampleParams(); if(!p) return;
  if(!confirm('Clear ALL module data for CRS ' + p.crsId + ' \u2014 ' +
              (STMT_MONTHS[p.month] || '') + ' ' + p.year + '?')) return;
  sdClearAllModules(p.crsId, p.month, p.year);
  stmtAfterSampleChange(p);
}

function stmtAfterSampleChange(p){
  stmtRenderModuleStatus();
  stmtRenderSections();
  // keep the Monthly Entry screen in sync if it is showing the same month
  try{
    var meCrs = document.getElementById('me-crs');
    if(meCrs && parseInt(meCrs.value,10) === p.crsId &&
       parseInt(document.getElementById('me-month').value,10) === p.month &&
       parseInt(document.getElementById('me-year').value,10)  === p.year &&
       typeof onMonthlyChange === 'function'){ onMonthlyChange(); }
  }catch(e){}
  // refresh an open preview
  if(stmtCurrentPreview && stmtCurrentPreview.sectionId){
    stmtPreviewSection(stmtCurrentPreview.sectionId);
  }
}

// ── Monthly Entry page: seed every module for the month on screen ─────────
function meLoadSampleData(){
  var crsEl = document.getElementById('me-crs');
  var moEl  = document.getElementById('me-month');
  var yrEl  = document.getElementById('me-year');
  if(!crsEl || !crsEl.value){ alert('Please select a CRS shop first.'); return; }

  var crsId = parseInt(crsEl.value, 10);
  var month = parseInt(moEl.value, 10);
  var year  = parseInt(yrEl.value, 10);

  var r = sdSeedAllModules(crsId, month, year);

  // Repaint the Monthly Entry screen (commodity tables, remittance, gunny, cards)
  if(typeof onMonthlyChange === 'function') onMonthlyChange();

  // Keep the Statement page in step if it is pointed at the same period
  try{
    var sCrs = document.getElementById('stmt-crs');
    if(sCrs && parseInt(sCrs.value,10) === crsId &&
       parseInt(document.getElementById('stmt-month').value,10) === month &&
       parseInt(document.getElementById('stmt-year').value,10)  === year){
      if(typeof stmtRenderModuleStatus === 'function') stmtRenderModuleStatus();
      if(typeof stmtRenderSections     === 'function') stmtRenderSections();
    }
  }catch(e){}

  var crs = CRS_LIST.find(function(c){ return c.id === crsId; });
  alert('\u2705 Sample data loaded into every module\n\n' +
        'CRS ' + crsId + (crs ? ' \u2014 ' + crs.name : '') + ' \u00b7 ' +
        (ME_MONTH_NAMES[month] || '') + ' ' + year + '\n\n' +
        '\u2022 Daily Entry \u2014 ' + r.days + ' day sheets (' + r.workDays + ' working days)\n' +
        '\u2022 Receipt \u2014 ' + r.receipts + ' godown receipts\n' +
        '\u2022 Monthly Entry \u2014 all commodities rolled up\n' +
        '\u2022 Gunny Stock \u00b7 Card Details \u00b7 Remittance \u2014 filled\n' +
        '\u2022 Inspection \u2014 ' + r.inspections + ' adjustments\n\n' +
        'Open Statements \u2192 any section to see it rendered from this data.');
}

// ── Module status strip ───────────────────────────────────────────────────
function stmtRenderModuleStatus(){
  var el = document.getElementById('stmt-module-status');
  if(!el) return;
  var crsEl = document.getElementById('stmt-crs');
  var crsId = crsEl ? parseInt(crsEl.value, 10) : NaN;
  if(!crsId){
    el.innerHTML = '<span style="font-size:11px;color:var(--muted)">Select a CRS shop to see which modules hold data.</span>';
    return;
  }
  var month = parseInt(document.getElementById('stmt-month').value, 10);
  var year  = parseInt(document.getElementById('stmt-year').value, 10);
  var a     = stmtGetData(crsId, month, year).avail;

  var items = [
    {label:'Daily Entry',   ok:a.daily,      note:a.dailyDays + ' days'},
    {label:'Monthly Entry', ok:a.monthly,    note:'commodities'},
    {label:'Receipt',       ok:a.receipt,    note:'godown'},
    {label:'Gunny Stock',   ok:a.gunny,      note:'bags'},
    {label:'Card Details',  ok:a.cards,      note:'cards'},
    {label:'Remittance',    ok:a.remittance, note:'bank'},
    {label:'Inspection',    ok:a.inspection, note:'adjustments'}
  ];
  el.innerHTML = items.map(function(it){
    var bg = it.ok ? '#DCFCE7' : '#F1F5F9';
    var bd = it.ok ? '#86EFAC' : '#E2E8F0';
    var fg = it.ok ? '#166534' : '#94A3B8';
    return '<span style="display:inline-flex;align-items:center;gap:5px;background:' + bg +
           ';border:1px solid ' + bd + ';color:' + fg +
           ';font-size:11px;font-weight:600;padding:4px 9px;border-radius:6px">' +
           (it.ok ? '\u25cf' : '\u25cb') + ' ' + it.label +
           (it.ok ? ' <span style="opacity:.7;font-weight:500">\u00b7 ' + it.note + '</span>' : '') +
           '</span>';
  }).join('');
}

function stmtOnPeriodChange(){
  stmtRenderModuleStatus();
  stmtRenderSections();
  var panel = document.getElementById('stmt-preview-panel');
  if(panel) panel.style.display = 'none';
}

// [M1] Dead duplicate removed — a later, live definition of this function supersedes it.  (initStmtPage — identical live copy defined further down)



// ── Full-Screen Viewer (replaces popup windows — works inside iframes) ────────
function openFSV(title, sub, contentHtml, cssExtra){
  var overlay  = document.getElementById('fullscreen-viewer');
  var titleEl  = document.getElementById('fsv-title');
  var subEl    = document.getElementById('fsv-sub');
  var contentEl= document.getElementById('fsv-content');
  if(!overlay) return;
  if(titleEl)   titleEl.textContent  = title;
  if(subEl)     subEl.textContent    = sub;
  if(contentEl) contentEl.innerHTML  = (cssExtra?'<style>'+cssExtra+'</style>':'')+contentHtml;
  overlay.style.display = 'flex';
  overlay.scrollTop = 0;
  document.body.style.overflow = 'hidden'; // prevent background scroll
}
function closeFSV(){
  var overlay = document.getElementById('fullscreen-viewer');
  if(overlay) overlay.style.display = 'none';
  document.body.style.overflow = '';
}
function fsvPrint(){
  var content = document.getElementById('fsv-content');
  var toolbar  = document.getElementById('fsv-toolbar');
  if(!content) return;
  // Temporarily hide toolbar, print, restore
  toolbar.style.display = 'none';
  window.print();
  toolbar.style.display = '';
}

// ═══ INSPECTION ENTRY + DSS PREVIEW ══════════════════════════════════════════

// ── Inspection Entry ──────────────────────────────────────────────────────────


// ── DSS Preview — Day-by-day PDF ──────────────────────────────────────────────



// [M1] Dead duplicate removed — a later, live definition of this function supersedes it.  (openInspectionEntry — live copy defined further down)

// [M1] Dead duplicate removed — a later, live definition of this function supersedes it.  (openDSSPreview  — live copy defined further down)


// [M1] Dead duplicate removed — a later, live definition of this function supersedes it.  (inspCalcRow (only reachable from the removed openInspectionEntry))


// After an Inspection save, repaint whichever entry grids are on screen.
