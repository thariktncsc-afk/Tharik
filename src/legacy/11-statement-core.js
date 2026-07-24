/* Statement section registry, data aggregation, print CSS
   Verbatim from TNCSC_CRS_Demo_19 (1).html lines 5371-5921.
   These parts are concatenated back into one classic script by
   tools/bundle-engine.mjs - the code hoists across the whole block and
   its declarations must stay global for the markup's inline handlers. */
var STMT_SECTIONS = [
  {
    id: 'crs_page1',
    label: 'CRS Page 1',
    icon: '📋',
    desc: 'Free commodity monthly report (Rice, AAY, RRA)',
    copies: 1,
    color: '#0369A1',
    availableFor: 'all'
  },
  {
    id: 'receipt',
    label: 'Receipt',
    icon: '🧾',
    desc: 'Godown receipt details for the month',
    copies: 1,
    color: '#0284C7',
    availableFor: 'all'
  },
  {
    id: 'crs_daily_sale',
    label: 'CRS Daily Sales',
    icon: '📅',
    desc: 'Date-wise particulars of sales & remittance',
    copies: 1,
    color: '#0369A1',
    availableFor: 'all'
  },
  {
    id: 'crs_page2',
    label: 'CRS Page 2',
    icon: '📋',
    desc: 'Cost commodity monthly report (Sugar, Wheat, Oil)',
    copies: 2,
    color: '#0369A1',
    availableFor: 'all'
  },
  {
    id: 'gunny',
    label: 'Gunny',
    icon: '🏷️',
    desc: 'Gunny stock statement (bags/sacks)',
    copies: 2,
    color: '#7C3AED',
    availableFor: 'all'
  },
  {
    id: 'free_com',
    label: 'Free Com',
    icon: '🆓',
    desc: 'Free commodity detailed statement (B6 format)',
    copies: 1,
    color: '#16A34A',
    availableFor: 'all'
  },
  {
    id: 'cost_com',
    label: 'Cost Com',
    icon: '💰',
    desc: 'Cost commodity with rates and amounts',
    copies: 1,
    color: '#D97706',
    availableFor: 'all'
  },
  {
    id: 'remittance',
    label: 'Remittance',
    icon: '🏦',
    desc: 'Date-wise remittance to bank (SRCB)',
    copies: 2,
    color: '#DC2626',
    availableFor: 'all'
  },
  {
    id: 'sale_tax',
    label: 'Sale Tax',
    icon: '🧾',
    desc: 'Sale tax statement with commodity rates & totals',
    copies: 1,
    color: '#0369A1',
    availableFor: 'all'
  },
  {
    id: 'coll',
    label: 'COLL',
    icon: '📊',
    desc: 'Collection report (selected shops only)',
    copies: 1,
    color: '#6B7280',
    availableFor: 'admin'
  },
  {
    id: 'crs_police',
    label: 'CRS Police',
    icon: '👮',
    desc: 'Police ration card statement',
    copies: 2,
    color: '#1E40AF',
    availableFor: 'all'
  },
  {
    id: 'b6',
    label: 'B6',
    icon: '📄',
    desc: 'B6 monthly report format',
    copies: 1,
    color: '#7C3AED',
    availableFor: 'all'
  },
  {
    id: 'card_details',
    label: 'Card Details',
    icon: '🪪',
    desc: 'Ration card count & gunny bag details',
    copies: 1,
    color: '#0369A1',
    availableFor: 'all'
  },
  {
    id: 'rbi',
    label: 'RBI',
    icon: '🏛️',
    desc: 'RBI statement - commodity stock summary',
    copies: 1,
    color: '#DC2626',
    availableFor: 'all'
  }
];

var stmtSelectedSections = {};
var stmtCurrentPreview = null;
// [M6] Session log of generated statements. Was declared and then never
// touched, so "which sections did I already run for this shop?" had no answer.
// stmtPreviewSection() now records into it; stmtRecentHistory() reads it back.
var stmtHistory = [];
var STMT_HISTORY_MAX = 50;

function stmtRecordHistory(sectionId, d, sec){
  stmtHistory.unshift({
    at:        new Date().toISOString(),
    sectionId: sectionId,
    label:     sec ? sec.label : sectionId,
    crsId:     d.crsId,
    month:     d.month,
    year:      d.year,
    period:    d.mo + ' ' + d.yr
  });
  if(stmtHistory.length > STMT_HISTORY_MAX) stmtHistory.length = STMT_HISTORY_MAX;
}

// Most recent entries, newest first; optionally filtered to one shop.
function stmtRecentHistory(crsId, limit){
  var out = stmtHistory;
  if(crsId != null) out = out.filter(function(h){ return String(h.crsId) === String(crsId); });
  return out.slice(0, limit || 10);
}

// Month names
var STMT_MONTHS = ['','January','February','March','April','May','June',
  'July','August','September','October','November','December'];
var STMT_MONTHS_SHORT = ['','Jan','Feb','Mar','Apr','May','Jun',
  'Jul','Aug','Sep','Oct','Nov','Dec'];

// ── Init statement CRS dropdown ────────────────────────────────────────────
;

function stmtInitCRSDropdown(){
  var sel = document.getElementById('stmt-crs');
  if(!sel) return;

  // Always rebuild fresh — respects whoever is currently logged in
  var isCrsUser = currentUser && currentUser.crsId && currentUser.role !== 'ADMIN';
  var list = isCrsUser
    ? CRS_LIST.filter(function(c){ return c.id === currentUser.crsId; })
    : CRS_LIST;

  // Rebuild dropdown
  sel.innerHTML = '<option value="">Select CRS Shop...</option>';
  list.forEach(function(c){
    var o = document.createElement('option');
    o.value = String(c.id);
    o.textContent = 'CRS ' + c.id + ' \u2014 ' + c.name;
    sel.appendChild(o);
  });

  // Auto-select and trigger for CRS users
  if(isCrsUser){
    sel.value = String(currentUser.crsId);
    stmtOnCRSChange();
  }
}

function stmtOnCRSChange(){
  stmtRenderSections();
  stmtUpdateExportBar();
  if(typeof stmtRenderModuleStatus === 'function') stmtRenderModuleStatus();
  document.getElementById('stmt-preview-panel').style.display = 'none';
}

// ── Render section tiles ───────────────────────────────────────────────────
function stmtRenderSections(){
  var grid = document.getElementById('stmt-sections-grid');
  if(!grid) return;
  var isAdmin = !currentUser || currentUser.role === 'ADMIN';

  var sectionsToShow = STMT_SECTIONS.filter(function(s){
    return s.availableFor === 'all' || (s.availableFor === 'admin' && isAdmin);
  });

  grid.innerHTML = sectionsToShow.map(function(s){
    var isSelected = !!stmtSelectedSections[s.id];
    var selStyle = isSelected
      ? 'border-color:'+s.color+';background:'+s.color+'18;'
      : 'border-color:var(--border);background:#fff;';
    var checkStyle = isSelected
      ? 'background:'+s.color+';border-color:'+s.color+';color:#fff;'
      : 'background:#fff;border-color:#CBD5E1;color:transparent;';
    return '<div style="border:2px solid;border-radius:12px;padding:14px;cursor:pointer;transition:.15s;position:relative;'+selStyle+'"' +
      ' onclick="stmtToggleSection(\''+s.id+'\')">' +
      '<div style="position:absolute;top:10px;right:10px;width:20px;height:20px;border:2px solid;border-radius:4px;display:flex;align-items:center;justify-content:center;font-size:11px;font-weight:800;transition:.15s;'+checkStyle+'">✓</div>' +
      '<div style="font-size:24px;margin-bottom:6px">'+s.icon+'</div>' +
      '<div style="font-weight:800;font-size:13px;color:'+s.color+';margin-bottom:3px">'+s.label+'</div>' +
      '<div style="font-size:10px;color:var(--muted);line-height:1.4;margin-bottom:6px">'+s.desc+'</div>' +
      (s.copies > 1 ? '<div style="font-size:10px;color:#D97706;font-weight:700">\u2716'+s.copies+' copies</div>' : '') +
      '<button onclick="event.stopPropagation();stmtPreviewSection(\''+s.id+'\')" style="margin-top:8px;width:100%;background:'+s.color+';color:#fff;border:none;padding:5px;border-radius:6px;font-size:11px;font-weight:700;cursor:pointer">👁 Preview</button>' +
      '</div>';
  }).join('');
}

function stmtToggleSection(id){
  if(stmtSelectedSections[id]) delete stmtSelectedSections[id];
  else stmtSelectedSections[id] = true;
  stmtRenderSections();
  stmtUpdateExportBar();
}

function stmtSelectAll(){
  var isAdmin = !currentUser || currentUser.role === 'ADMIN';
  STMT_SECTIONS.forEach(function(s){
    if(s.availableFor === 'all' || isAdmin) stmtSelectedSections[s.id] = true;
  });
  stmtRenderSections();
  stmtUpdateExportBar();
}

function stmtClearAll(){
  stmtSelectedSections = {};
  stmtRenderSections();
  stmtUpdateExportBar();
}

function stmtUpdateExportBar(){
  var bar = document.getElementById('stmt-export-bar');
  var cnt = document.getElementById('stmt-selected-count');
  var lbl = document.getElementById('stmt-export-crs-label');
  var crsId = document.getElementById('stmt-crs').value;
  var crs = crsId ? CRS_LIST.find(function(c){ return String(c.id)===crsId; }) : null;
  var count = Object.keys(stmtSelectedSections).length;
  if(bar) bar.style.display = count > 0 ? 'flex' : 'none';
  if(cnt) cnt.textContent = count;
  if(lbl) lbl.textContent = crs ? crs.id + ' \u2014 ' + crs.name : '\u2014';
}

function stmtClosePreview(){
  document.getElementById('stmt-preview-panel').style.display = 'none';
  stmtCurrentPreview = null;
}

// ── Get data for a CRS + month ─────────────────────────────────────────────
function stmtGetData(crsId, month, year){
  crsId = parseInt(crsId, 10);
  month = parseInt(month, 10);
  year  = parseInt(year, 10);

  var key  = crsId + '_' + month + '_' + year;
  var pad2 = function(n){ return String(n).padStart(2,'0'); };
  var daysInMonth = new Date(year, month, 0).getDate();

  // ═══ MODULE 1 — MONTHLY ENTRY (monthlyStore) ══════════════════════════════
  // Refresh the accumulation first so a statement never reads a stale month.
  try{ if(typeof rebuildMonthlyFromDaily === 'function') rebuildMonthlyFromDaily(crsId, month, year); }catch(e){}
  var monthly = (typeof monthlyStore !== 'undefined' && monthlyStore[key])
              ? monthlyStore[key] : {a:{}, b:{}};

  // ═══ MODULE 2 — DAILY ENTRY (entryStore) → month roll-up ══════════════════
  // Roll every daily sheet of the month into one per-commodity record so that
  // shops which only key Daily Entry still produce complete statements.
  var daily = {};      // id -> {open, receipt, sales, close, amount}
  var dailyDays = [];  // [{day, date, entry}] — used by the date-wise sections
  var dailyFound = 0;
  for(var _d = 1; _d <= daysInMonth; _d++){
    var _ds  = year + '-' + pad2(month) + '-' + pad2(_d);
    var _ent = null;
    if(typeof entryStore !== 'undefined'){
      _ent = entryStore[crsId + '_' + _ds] || entryStore[String(crsId) + '_' + _ds] || null;
    }
    dailyDays.push({day:_d, date:_ds, entry:_ent});
    if(!_ent) continue;
    dailyFound++;
    ['a','b'].forEach(function(sec){
      var blk = _ent[sec] || {};
      Object.keys(blk).forEach(function(id){
        var r = blk[id] || {};
        var t = daily[id] || (daily[id] = {open:null, receipt:0, sales:0, close:0, amount:0});
        if(t.open === null) t.open = parseFloat(r.open) || 0;   // first sheet's opening
        t.receipt += parseFloat(r.receipt) || 0;
        t.sales   += parseFloat(r.sales)   || 0;
        t.amount  += parseFloat(r.amount)  || 0;
        t.close    = parseFloat(r.close)   || 0;                // last sheet's closing
      });
    });
  }
  Object.keys(daily).forEach(function(id){ if(daily[id].open === null) daily[id].open = 0; });

  // ═══ MODULE 3 — INSPECTION (inspectionStore) ══════════════════════════════
  var insp      = {};   // id  -> {excess, shortage, transfer}
  var inspByDay = {};   // day -> {excess, shortage, transfer}
  if(typeof inspectionStore !== 'undefined'){
    for(var _i = 1; _i <= daysInMonth; _i++){
      var _is = year + '-' + pad2(month) + '-' + pad2(_i);
      var rec = inspectionStore[crsId + '_' + _is] || inspectionStore[String(crsId) + '_' + _is];
      if(!rec) continue;
      var dayTot = {excess:0, shortage:0, transfer:0};
      ['a','b'].forEach(function(sec){
        var blk = rec[sec] || {};
        Object.keys(blk).forEach(function(id){
          var r = blk[id] || {};
          var t = insp[id] || (insp[id] = {excess:0, shortage:0, transfer:0});
          t.excess       += parseFloat(r.excess)   || 0;
          t.shortage     += parseFloat(r.shortage) || 0;
          t.transfer     += parseFloat(r.transfer) || 0;
          dayTot.excess   += parseFloat(r.excess)   || 0;
          dayTot.shortage += parseFloat(r.shortage) || 0;
          dayTot.transfer += parseFloat(r.transfer) || 0;
        });
      });
      inspByDay[_i] = dayTot;
    }
  }
  function getInsp(id, field){ return (insp[id] && insp[id][field]) ? insp[id][field] : 0; }

  // ═══ VALUE RESOLVER ═══════════════════════════════════════════════════════
  // Statement sections read MONTHLY figures only. Daily Entry reaches them
  // indirectly: saving a day sheet rolls up into monthlyStore automatically
  // (see rebuildMonthlyFromDaily). Daily data itself is used only by the DSS
  // and by the two date-wise statement sections (Daily Sales, Remittance).
  function getVal(id, field){
    var m = (monthly.a && monthly.a[id]) || (monthly.b && monthly.b[id]) || null;
    if(!m) return 0;
    var v = parseFloat(m[field]);
    return isNaN(v) ? 0 : v;
  }

  // [C3] True only when the shop actually keyed this field. Callers used to
  // write `getVal(id,'close') || computeIt()`, which silently discarded a
  // genuine keyed-in 0 (a legitimately empty closing balance) and printed a
  // derived figure in its place. Guard the fallback with hasVal() instead.
  function hasVal(id, field){
    var m = (monthly.a && monthly.a[id]) || (monthly.b && monthly.b[id]) || null;
    if(!m) return false;
    var raw = m[field];
    if(raw === undefined || raw === null || raw === '') return false;
    return !isNaN(parseFloat(raw));
  }

  // ═══ MODULE 4 — RECEIPT (receiptStore) ════════════════════════════════════
  var prefix   = year + '-' + pad2(month);
  var receipts = (typeof receiptStore !== 'undefined' ? receiptStore : []).filter(function(r){
    return parseInt(r.crsId,10) === crsId && String(r.date||'').indexOf(prefix) === 0;
  }).sort(function(a,b){ return String(a.date).localeCompare(String(b.date)); });

  var receiptTotals = {};
  receipts.forEach(function(r){
    Object.keys(r.items || {}).forEach(function(id){
      receiptTotals[id] = (receiptTotals[id] || 0) + (parseFloat(r.items[id].qty) || 0);
    });
  });
  // Fall back to the monthly/daily receipt figures when no godown receipt rows exist
  function receiptQty(id){
    if(receiptTotals[id]) return receiptTotals[id];
    return getVal(id, 'receipt');
  }

  // ═══ MODULE 5 — GUNNY STOCK (meGunnyStore) ════════════════════════════════
  var gunnyRaw = (typeof meGunnyStore !== 'undefined' && meGunnyStore[key]) ? meGunnyStore[key] : {};
  var GUNNY_GRAIN_COMMS = ['BRA','PHH_BRA','PHH_FRK','AAY_FRK','AAY','RRA','NPHH_FRK','NPHH_RRA','OAP','APS','WHEAT'];
  function bagsFromMonthly(id, field){
    // [C3] respect a keyed-in gunny count of 0; [S1] shared divisor
    if(hasVal(id, 'g_' + field)) return Math.round(getVal(id, 'g_' + field));
    return bagsOf(getVal(id, field), id);
  }
  function gunnyItem(itemId, fallback){
    var r = gunnyRaw[itemId] || {};
    var has = ['opening','receipt','issues','closing','total'].some(function(f){
      return r[f] !== undefined && r[f] !== '' && r[f] !== null && parseFloat(r[f]) !== 0;
    });
    if(has){
      var ob  = parseFloat(r.opening) || 0;
      var rc  = parseFloat(r.receipt) || 0;
      var iss = parseFloat(r.issues)  || 0;
      var tot = (r.total   !== undefined && r.total   !== '') ? (parseFloat(r.total)   || 0) : ob + rc;
      var cb  = (r.closing !== undefined && r.closing !== '') ? (parseFloat(r.closing) || 0) : tot - iss;
      return {ob:ob, rec:rc, tot:tot, iss:iss, cb:cb, src:'gunny'};
    }
    return fallback();
  }
  var gunny = {
    ss50: gunnyItem('ss50', function(){
      var ob = 0, rc = 0, iss = 0;
      GUNNY_GRAIN_COMMS.forEach(function(id){
        ob  += bagsFromMonthly(id, 'open');
        rc  += bagsFromMonthly(id, 'receipt');
        iss += bagsFromMonthly(id, 'sales');
      });
      return {ob:ob, rec:rc, tot:ob+rc, iss:iss, cb:ob+rc-iss, src:'monthly'};   // [S2]
    }),
    poly: gunnyItem('poly', function(){
      var ob = getVal('EMPTY_BAG','open'), rc = getVal('EMPTY_BAG','receipt'), iss = getVal('EMPTY_BAG','sales');
      return {ob:ob, rec:rc, tot:ob+rc, iss:iss, cb:ob+rc-iss, src:'monthly'};   // [S2]
    }),
    cbox: gunnyItem('cbox', function(){
      var ob = getVal('EMPTY_BOX','open'), rc = getVal('EMPTY_BOX','receipt'), iss = getVal('EMPTY_BOX','sales');
      return {ob:ob, rec:rc, tot:ob+rc, iss:iss, cb:ob+rc-iss, src:'monthly'};   // [S2]
    })
  };

  // ═══ MODULE 6 — CARD DETAILS (meCardStore) ════════════════════════════════
  var cardRaw   = (typeof meCardStore !== 'undefined' && meCardStore[key]) ? meCardStore[key] : {};
  var cardTypes = (typeof ME_CARD_TYPES !== 'undefined') ? ME_CARD_TYPES : [];
  var cards = {list:[], byId:{}, total:0, hasData:false};
  cardTypes.forEach(function(ct){
    var c   = cardRaw[ct.id] || {};
    var cnt = (c.count !== undefined && c.count !== '') ? (parseInt(c.count,10) || 0) : 0;
    if(cnt) cards.hasData = true;
    cards.total += cnt;
    cards.byId[ct.id] = cnt;
    cards.list.push({id:ct.id, label:ct.label, count:cnt, remarks:c.remarks || ''});
  });

  // ═══ MODULE 7 — REMITTANCE (meRemitStore) ═════════════════════════════════
  var remitRaw = (typeof meRemitStore !== 'undefined' && meRemitStore[key]) ? meRemitStore[key] : {};
  var remit = {days:{}, extra:(remitRaw['extra'] || {}), totalNC:0, totalCE:0, total:0, hasData:false};
  Object.keys(remitRaw).forEach(function(k){
    if(k === 'extra') return;
    var r  = remitRaw[k] || {};
    var nc = parseFloat(r.nonCereal) || 0;
    var ce = parseFloat(r.cereal)    || 0;
    remit.days[parseInt(k,10)] = {remitDate:r.remitDate || '', nonCereal:nc, cereal:ce, total:nc+ce};
    remit.totalNC += nc; remit.totalCE += ce;
    if(nc || ce || r.remitDate) remit.hasData = true;
  });
  ['e1','e2','e3'].forEach(function(e){
    var nc = parseFloat(remit.extra[e+'nc']) || 0;
    var ce = parseFloat(remit.extra[e+'ce']) || 0;
    remit.totalNC += nc; remit.totalCE += ce;
    if(nc || ce) remit.hasData = true;
  });
  remit.total = remit.totalNC + remit.totalCE;

  // ── Day-wise remittance for the statement: the Daily Entry remittance
  //    fields win; the Monthly Remittance table fills in any day they miss.
  var remitByDay = {};
  for(var _rd = 1; _rd <= daysInMonth; _rd++){
    var _rds = year + '-' + pad2(month) + '-' + pad2(_rd);
    var _ent = entryStore[crsId + '_' + _rds] || entryStore[String(crsId) + '_' + _rds];
    var _row = remit.days[_rd] || null;
    var fromDaily = !!(_ent && (parseFloat(_ent.remitAmount) || _ent.remitDate));
    if(fromDaily){
      remitByDay[_rd] = {
        remitDate: _ent.remitDate || (_row ? _row.remitDate : ''),
        amount:    parseFloat(_ent.remitAmount) || (_row ? _row.total : 0),
        src:       'daily'
      };
    } else if(_row && (_row.total || _row.remitDate)){
      remitByDay[_rd] = {remitDate:_row.remitDate, amount:_row.total, src:'monthly'};
    }
  }
  var remitDayTotal = 0;
  Object.keys(remitByDay).forEach(function(k){ remitDayTotal += remitByDay[k].amount || 0; });

  // ═══ MODULE 8 — SALES CLOSE (salesCloseStore) ═════════════════════════════
  var salesClose = (typeof salesCloseStore !== 'undefined' && salesCloseStore[key]) ? salesCloseStore[key] : null;

  // ═══ MODULE 9 — USERS (userStore via getUsersForCRS) ══════════════════════
  var staff = (typeof getUsersForCRS === 'function') ? getUsersForCRS(crsId) : {bc:null, packer:null};
  var crs   = CRS_LIST.find(function(c){ return c.id === crsId; });

  // ── Data-availability flags (used by the preview banner) ──────────────────
  var avail = {
    monthly:    Object.keys(monthly.a || {}).length > 0 || Object.keys(monthly.b || {}).length > 0,
    daily:      dailyFound > 0,
    dailyDays:  dailyFound,
    receipt:    receipts.length > 0,
    inspection: Object.keys(insp).length > 0,
    gunny:      Object.keys(gunnyRaw).length > 0,
    cards:      cards.hasData,
    remittance: remit.hasData
  };

  return {
    crsId: crsId, crs: crs, month: month, year: year,
    mo: (STMT_MONTHS[month] || ''), yr: year,
    key: key, daysInMonth: daysInMonth,

    monthly: monthly,
    daily: daily, dailyDays: dailyDays,
    insp: insp, inspByDay: inspByDay, getInsp: getInsp,
    receipts: receipts, receiptTotals: receiptTotals, receiptQty: receiptQty,
    remitByDay: remitByDay, remitDayTotal: remitDayTotal,
    gunny: gunny,
    cards: cards,
    remit: remit,
    salesClose: salesClose,

    staff: staff,
    allComms: (DSS_A || []).concat(DSS_B || []),
    getVal: getVal,
    hasVal: hasVal,
    avail: avail,

    // [M4] ruled blanks, not another shop's Bill Clerk
    bcName:      staff.bc     ? staff.bc.fullName     : STAFF_NAME_BLANK,
    bcPhone:     staff.bc     ? staff.bc.phone        : STAFF_PHONE_BLANK,
    packerName:  staff.packer ? staff.packer.fullName : STAFF_NAME_BLANK,
    packerPhone: staff.packer ? staff.packer.phone    : STAFF_PHONE_BLANK
  };
}

// ── CSS for print ──────────────────────────────────────────────────────────
var STMT_PRINT_CSS = [
  'body{font-family:Arial,sans-serif;font-size:11px;margin:0;padding:0}',
  '.stmt-page{width:210mm;min-height:148mm;padding:8mm;box-sizing:border-box;page-break-after:always}',
  '.stmt-title{text-align:center;font-weight:bold;font-size:13px;margin-bottom:2px}',
  '.stmt-sub{text-align:center;font-size:11px;margin-bottom:8px}',
  'table{width:100%;border-collapse:collapse;font-size:10px}',
  'th,td{border:1px solid #333;padding:3px 5px}',
  'th{background:#f0f0f0;font-weight:bold;text-align:center}',
  '.right{text-align:right}.center{text-align:center}',
  '.bold{font-weight:bold}.sig{margin-top:20px;display:flex;justify-content:space-between}',
  '@media print{.stmt-page{page-break-after:always}}'
].join('\n');

// ── SECTION BUILDERS ───────────────────────────────────────────────────────

// Helper: table header
function th(text, extra){ return '<th '+(extra||'')+'>'+text+'</th>'; }
function td(text, extra){ return '<td '+(extra||'')+'>'+(text!==undefined&&text!==null?text:'-')+'</td>'; }
function tdR(text){ return '<td class="right">'+(text||0)+'</td>'; }
function tdC(text){ return '<td class="center">'+(text||'-')+'</td>'; }

// ── CRS PAGE 1: Free commodities (Rice section) ────────────────────────────
