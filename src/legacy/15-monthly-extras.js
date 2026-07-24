/* Monthly remittance, gunny and card tables
   Verbatim from TNCSC_CRS_Demo_19 (1).html lines 8319-9246.
   These parts are concatenated back into one classic script by
   tools/bundle-engine.mjs - the code hoists across the whole block and
   its declarations must stay global for the markup's inline handlers. */
var meRemitStore = {}; // {crsId_month_year: {day: {remitDate, nonCereal, cereal}}}

function buildMeRemitTable(){
  var tbody  = document.getElementById('me-remit-tbody');
  var section = document.getElementById('me-remit-section');
  var subtitle = document.getElementById('me-remit-subtitle');
  if(!tbody || !section) return;

  var crsId = document.getElementById('me-crs').value;
  var month = parseInt(document.getElementById('me-month').value);
  var year  = parseInt(document.getElementById('me-year').value);
  if(!crsId || !month || !year){ section.style.display='none'; return; }

  var crs = CRS_LIST.find(function(c){ return String(c.id)===crsId; });
  var moName = ME_MONTH_NAMES[month] || '';
  if(subtitle) subtitle.textContent = 'CRS ' + crsId + (crs?' — '+crs.name:'') + ' — ' + moName + ' ' + year;

  var daysInMonth = new Date(year, month, 0).getDate();
  var storeKey    = crsId + '_' + month + '_' + year;
  var saved       = meRemitStore[storeKey] || {};

  var rows = '';
  for(var day=1; day<=daysInMonth; day++){
    var d     = saved[day] || {};
    var dateStr = year+'-'+String(month).padStart(2,'0')+'-'+String(day).padStart(2,'0');
    var dateObj = new Date(dateStr+'T00:00:00');
    var dayName = ['Sun','Mon','Tue','Wed','Thu','Fri','Sat'][dateObj.getDay()];
    var dispDate = String(day).padStart(2,'0') + '/' + String(month).padStart(2,'0') + '/' + year;
    var bg = day%2===0 ? '#F8FAFF' : '#fff';
    var isHoliday = false; // could add holiday check later
    var nonCereal = d.nonCereal!==undefined ? d.nonCereal : '';
    var cereal    = d.cereal!==undefined    ? d.cereal    : '';
    var remDate   = d.remitDate || '';

    rows += '<tr style="background:'+bg+'" data-day="'+day+'">' +
      '<td style="padding:6px 10px;text-align:center;color:var(--muted);font-size:11px;border-bottom:1px solid #EFF6FF">' + day + '</td>' +
      '<td style="padding:6px 12px;font-size:12px;border-bottom:1px solid #EFF6FF;white-space:nowrap">' +
        '<span style="font-weight:600">' + dispDate + '</span>' +
        '<span style="color:var(--muted);font-size:10px;margin-left:6px">'+dayName+'</span>' +
      '</td>' +
      // Remittance Date picker
      '<td style="padding:4px 6px;border-bottom:1px solid #EFF6FF;text-align:center">' +
        '<input type="date" data-day="'+day+'" data-field="remitDate"' +
          ' value="'+remDate+'"' +
          ' onchange="meRemitCalc(this)"' +
          ' onkeydown="meRemitNav(event,this)"' +
          ' style="border:1px solid #BAE6FD;border-radius:6px;padding:4px 7px;font-size:11px;color:#0369A1;background:#F0F9FF;width:130px"/>' +
      '</td>' +
      // Non-Cereal Amount
      '<td style="padding:4px 6px;border-bottom:1px solid #EFF6FF">' +
        '<input type="number" min="0" step="0.01" placeholder="0.00"' +
          ' data-day="'+day+'" data-field="nonCereal"' +
          ' value="'+(nonCereal!==''?parseFloat(nonCereal).toFixed(2):'')+'"' +
          ' onchange="meRemitCalc(this)"' +
          ' onkeydown="meRemitNav(event,this)" oninput="meRemitValidate(this)"' +
          ' onkeydown="meRemitNav(event,this)"' +
          ' style="width:100%;border:1px solid #BAE6FD;border-radius:6px;padding:5px 8px;font-size:12px;text-align:right;font-weight:700;color:#0369A1;background:#F0F9FF"/>' +
      '</td>' +
      // Cereal Account — text input (accepts numbers, letters, and notes)
      '<td style="padding:4px 6px;border-bottom:1px solid #EFF6FF">' +
        '<input type="text" placeholder=""' +
          ' data-day="'+day+'" data-field="cereal"' +
          ' value="'+(cereal||'')+'"' +
          ' onchange="meRemitCalc(this)"' +
          ' onkeydown="meRemitNav(event,this)"' +
          ' style="width:100%;border:1px solid #E2E8F0;border-radius:6px;padding:5px 8px;font-size:12px;color:var(--muted);background:#FAFCFF"/>' +
      '</td>' +
      // Total Amount (auto = nonCereal + cereal)
      '<td style="padding:6px 8px;text-align:right;border-bottom:1px solid #EFF6FF;background:#EFF6FF" id="me-remit-row-total-'+day+'">' +
        '<span style="font-weight:800;color:#0369A1;font-size:12px">' +
          (nonCereal!==''||cereal!=='' ? '\u20b9'+(parseFloat(nonCereal||0)+parseFloat(cereal||0)).toFixed(2) : '\u2014') +
        '</span>' +
      '</td>' +
    '</tr>';
  }
  // ── 3 extra rows after the last day ──────────────────────────────────────
  var storeKey2 = crsId + '_' + month + '_' + year;
  var savedExtra = meRemitStore[storeKey2] ? (meRemitStore[storeKey2]['extra'] || {}) : {};

  // Row E1: Poly & C.Box Amount — with S.No and date picker
  var e1nc    = savedExtra.e1nc    || '';
  var e1ce    = savedExtra.e1ce    || '';
  var e1date  = savedExtra.e1date  || '';
  var e1tot   = (parseFloat(e1nc)||0) + (parseFloat(e1ce)||0);
  var e1sno   = daysInMonth + 1;
  rows += '<tr style="background:#FEF9C3;border-top:2px solid #FDE047" data-day="extra1">' +
    '<td style="padding:6px 10px;text-align:center;font-size:11px;font-weight:700;color:#92400E;border-bottom:1px solid #FEF3C7">' + e1sno + '</td>' +
    '<td style="padding:6px 12px;font-size:11px;font-weight:700;color:#92400E;border-bottom:1px solid #FEF3C7;white-space:nowrap">' +
      '&#128230; Poly &amp; C.Box Amount</td>' +
    '<td style="padding:4px 6px;border-bottom:1px solid #FEF3C7;text-align:center">' +
      '<input type="date" data-day="extra1" data-field="e1date"' +
        ' value="'+e1date+'"' +
        ' onchange="meRemitCalcExtra(this)"' +
        ' style="border:1px solid #FDE047;border-radius:6px;padding:4px 7px;font-size:11px;color:#92400E;background:#FFFBEB;width:130px"/>' +
    '</td>' +
    '<td style="padding:4px 6px;border-bottom:1px solid #FEF3C7">' +
      '<input type="number" min="0" step="0.01" placeholder="0.00"' +
        ' data-day="extra1" data-field="e1nc"' +
        ' value="'+(e1nc!==''?parseFloat(e1nc).toFixed(2):'')+'"' +
        ' onchange="meRemitCalcExtra(this)"' +
        ' onkeydown="meRemitNav(event,this)"' +
        ' style="width:100%;border:1px solid #FDE047;border-radius:6px;padding:5px 8px;font-size:12px;text-align:right;font-weight:700;color:#92400E;background:#FFFBEB"/>' +
    '</td>' +
    '<td style="padding:4px 6px;border-bottom:1px solid #FEF3C7">' +
      '<input type="text" placeholder=""' +
        ' data-day="extra1" data-field="e1ce"' +
        ' value="'+(e1ce||'')+'"' +
        ' onchange="meRemitCalcExtra(this)"' +
        ' onkeydown="meRemitNav(event,this)"' +
        ' style="width:100%;border:1px solid #E2E8F0;border-radius:6px;padding:5px 8px;font-size:12px;color:var(--muted);background:#FFFBEB"/>' +
    '</td>' +
    '<td id="me-remit-row-total-extra1" style="padding:6px 8px;text-align:right;border-bottom:1px solid #FEF3C7;background:#FEF3C7">' +
      '<span style="font-weight:800;color:#92400E;font-size:12px">'+(e1nc!==''||e1ce!=='' ? '₹'+e1tot.toFixed(2) : '—')+'</span>' +
    '</td>' +
  '</tr>';

  // Row E2: Inspection Charges (empty editable row with S.No and date)
  var e2nc    = savedExtra.e2nc    || '';
  var e2ce    = savedExtra.e2ce    || '';
  var e2date  = savedExtra.e2date  || '';
  var e2tot   = (parseFloat(e2nc)||0) + (parseFloat(e2ce)||0);
  var e2sno   = daysInMonth + 2;
  rows += '<tr style="background:#F8FAFF" data-day="extra2">' +
    '<td style="padding:6px 10px;text-align:center;font-size:11px;font-weight:700;color:var(--muted);border-bottom:1px solid #EFF6FF">' + e2sno + '</td>' +
    '<td style="padding:6px 12px;border-bottom:1px solid #EFF6FF">' +
      '<input type="text" placeholder="Label (e.g. Inspection Charges)"' +
        ' data-day="extra2" data-field="e2label"' +
        ' value="'+(savedExtra.e2label||'')+'"' +
        ' onchange="meRemitCalcExtra(this)"' +
        ' style="width:100%;border:1px solid #E2E8F0;border-radius:5px;padding:3px 7px;font-size:11px;color:var(--text)"/>' +
    '</td>' +
    '<td style="padding:4px 6px;border-bottom:1px solid #EFF6FF;text-align:center">' +
      '<input type="date" data-day="extra2" data-field="e2date"' +
        ' value="'+e2date+'"' +
        ' onchange="meRemitCalcExtra(this)"' +
        ' style="border:1px solid #BAE6FD;border-radius:6px;padding:4px 7px;font-size:11px;color:#0369A1;background:#F0F9FF;width:130px"/>' +
    '</td>' +
    '<td style="padding:4px 6px;border-bottom:1px solid #EFF6FF">' +
      '<input type="number" min="0" step="0.01" placeholder="0.00"' +
        ' data-day="extra2" data-field="e2nc"' +
        ' value="'+(e2nc!==''?parseFloat(e2nc).toFixed(2):'')+'"' +
        ' onchange="meRemitCalcExtra(this)"' +
        ' onkeydown="meRemitNav(event,this)"' +
        ' style="width:100%;border:1px solid #BAE6FD;border-radius:6px;padding:5px 8px;font-size:12px;text-align:right;font-weight:700;color:#0369A1;background:#F0F9FF"/>' +
    '</td>' +
    '<td style="padding:4px 6px;border-bottom:1px solid #EFF6FF">' +
      '<input type="text" placeholder=""' +
        ' data-day="extra2" data-field="e2ce"' +
        ' value="'+(e2ce||'')+'"' +
        ' onchange="meRemitCalcExtra(this)"' +
        ' onkeydown="meRemitNav(event,this)"' +
        ' style="width:100%;border:1px solid #E2E8F0;border-radius:6px;padding:5px 8px;font-size:12px;color:var(--muted);background:#FAFCFF"/>' +
    '</td>' +
    '<td id="me-remit-row-total-extra2" style="padding:6px 8px;text-align:right;border-bottom:1px solid #EFF6FF;background:#EFF6FF">' +
      '<span style="font-weight:800;color:#0369A1;font-size:12px">'+(e2nc!==''||e2ce!=='' ? '₹'+e2tot.toFixed(2) : '—')+'</span>' +
    '</td>' +
  '</tr>';

  // Row E3: Another blank editable row with S.No and date
  var e3nc    = savedExtra.e3nc    || '';
  var e3ce    = savedExtra.e3ce    || '';
  var e3date  = savedExtra.e3date  || '';
  var e3tot   = (parseFloat(e3nc)||0) + (parseFloat(e3ce)||0);
  var e3sno   = daysInMonth + 3;
  rows += '<tr style="background:#fff" data-day="extra3">' +
    '<td style="padding:6px 10px;text-align:center;font-size:11px;font-weight:700;color:var(--muted);border-bottom:1px solid #EFF6FF">' + e3sno + '</td>' +
    '<td style="padding:6px 12px;border-bottom:1px solid #EFF6FF">' +
      '<input type="text" placeholder="Label (optional)"' +
        ' data-day="extra3" data-field="e3label"' +
        ' value="'+(savedExtra.e3label||'')+'"' +
        ' onchange="meRemitCalcExtra(this)"' +
        ' style="width:100%;border:1px solid #E2E8F0;border-radius:5px;padding:3px 7px;font-size:11px;color:var(--text)"/>' +
    '</td>' +
    '<td style="padding:4px 6px;border-bottom:1px solid #EFF6FF;text-align:center">' +
      '<input type="date" data-day="extra3" data-field="e3date"' +
        ' value="'+e3date+'"' +
        ' onchange="meRemitCalcExtra(this)"' +
        ' style="border:1px solid #BAE6FD;border-radius:6px;padding:4px 7px;font-size:11px;color:#0369A1;background:#F0F9FF;width:130px"/>' +
    '</td>' +
    '<td style="padding:4px 6px;border-bottom:1px solid #EFF6FF">' +
      '<input type="number" min="0" step="0.01" placeholder="0.00"' +
        ' data-day="extra3" data-field="e3nc"' +
        ' value="'+(e3nc!==''?parseFloat(e3nc).toFixed(2):'')+'"' +
        ' onchange="meRemitCalcExtra(this)"' +
        ' onkeydown="meRemitNav(event,this)"' +
        ' style="width:100%;border:1px solid #BAE6FD;border-radius:6px;padding:5px 8px;font-size:12px;text-align:right;font-weight:700;color:#0369A1;background:#F0F9FF"/>' +
    '</td>' +
    '<td style="padding:4px 6px;border-bottom:1px solid #EFF6FF">' +
      '<input type="text" placeholder=""' +
        ' data-day="extra3" data-field="e3ce"' +
        ' value="'+(e3ce||'')+'"' +
        ' onchange="meRemitCalcExtra(this)"' +
        ' onkeydown="meRemitNav(event,this)"' +
        ' style="width:100%;border:1px solid #E2E8F0;border-radius:6px;padding:5px 8px;font-size:12px;color:var(--muted);background:#FAFCFF"/>' +
    '</td>' +
    '<td id="me-remit-row-total-extra3" style="padding:6px 8px;text-align:right;border-bottom:1px solid #EFF6FF;background:#EFF6FF">' +
      '<span style="font-weight:800;color:#0369A1;font-size:12px">'+(e3nc!==''||e3ce!=='' ? '₹'+e3tot.toFixed(2) : '—')+'</span>' +
    '</td>' +
  '</tr>';

  tbody.innerHTML = rows;
  meRemitUpdateTotals(crsId, month, year);
  section.style.display = 'block';
}

function meRemitCalc(inp){
  var day   = parseInt(inp.dataset.day);
  var field = inp.dataset.field;
  var crsId = document.getElementById('me-crs').value;
  var month = parseInt(document.getElementById('me-month').value);
  var year  = parseInt(document.getElementById('me-year').value);
  var key   = crsId+'_'+month+'_'+year;
  if(!meRemitStore[key]) meRemitStore[key] = {};
  if(!meRemitStore[key][day]) meRemitStore[key][day] = {};
  // Cereal is text (can contain letters/notes); nonCereal is numeric
  if(field === 'remitDate'){
    meRemitStore[key][day][field] = inp.value;
  } else if(field === 'cereal'){
    meRemitStore[key][day][field] = inp.value; // store as text
  } else {
    meRemitStore[key][day][field] = parseFloat(inp.value)||0;
  }

  // Update row total — only add numeric cereal values
  var d = meRemitStore[key][day];
  var nc = parseFloat(d.nonCereal||0);
  var ce = parseFloat(d.cereal||0) || 0; // NaN if text → 0
  var tot = nc + ce;
  var rowTotEl = document.getElementById('me-remit-row-total-'+day);
  if(rowTotEl) rowTotEl.innerHTML = '<span style="font-weight:800;color:#0369A1;font-size:12px">' +
    (nc>0||ce>0 ? '\u20b9'+tot.toFixed(2) : '\u2014') + '</span>';

  meRemitUpdateTotals(crsId, month, year);
}

function meRemitUpdateTotals(crsId, month, year){
  var key  = crsId+'_'+month+'_'+year;
  var data = meRemitStore[key] || {};
  var totNC=0, totCe=0;
  Object.keys(data).forEach(function(day){
    if(day === 'extra') return; // handle separately
    var d = data[day];
    totNC += parseFloat(d.nonCereal||0)||0;
    totCe += parseFloat(d.cereal||0)||0; // text → 0
  });
  // Add extra rows
  var ex = data['extra'] || {};
  ['e1nc','e2nc','e3nc'].forEach(function(f){ totNC += parseFloat(ex[f]||0)||0; });
  ['e1ce','e2ce','e3ce'].forEach(function(f){ totCe += parseFloat(ex[f]||0)||0; });
  var totAll = totNC + totCe;
  var el = function(id){ return document.getElementById(id); };
  var fmt = function(n){ return '\u20b9'+n.toFixed(2); };
  if(el('me-remit-tot-noncereal')) el('me-remit-tot-noncereal').textContent = fmt(totNC);
  if(el('me-remit-tot-cereal'))    el('me-remit-tot-cereal').textContent    = fmt(totCe);
  if(el('me-remit-tot-total'))     el('me-remit-tot-total').textContent     = fmt(totAll);
}

// Keyboard navigation: Enter moves to next row same column, arrows move between fields
function meRemitNav(e, inp){
  if(e.key !== 'Enter' && e.key !== 'ArrowDown' && e.key !== 'ArrowUp') return;
  e.preventDefault();
  var day    = parseInt(inp.dataset.day);
  var field  = inp.dataset.field;
  var tbody  = document.getElementById('me-remit-tbody');
  if(!tbody) return;
  var nextDay = e.key==='ArrowUp' ? day-1 : day+1;
  if(nextDay < 1) return;
  var nextRow = tbody.querySelector('tr[data-day="'+nextDay+'"]');
  if(!nextRow) return;
  var nextInp = nextRow.querySelector('[data-field="'+field+'"]');
  if(nextInp){ nextInp.focus(); if(nextInp.select) nextInp.select(); }
}

function meRemitValidate(inp){ var v=parseFloat(inp.value); if(!isNaN(v)&&v<0) inp.value=''; }


// ── Extra rows calc (Poly/CBox + 2 blank rows) ────────────────────────────────
function meRemitCalcExtra(inp){
  var crsId = document.getElementById('me-crs').value;
  var month = parseInt(document.getElementById('me-month').value);
  var year  = parseInt(document.getElementById('me-year').value);
  var key   = crsId+'_'+month+'_'+year;
  var day   = inp.dataset.day;   // 'extra1','extra2','extra3'
  var field = inp.dataset.field;
  if(!meRemitStore[key]) meRemitStore[key] = {};
  if(!meRemitStore[key]['extra']) meRemitStore[key]['extra'] = {};
  meRemitStore[key]['extra'][field] = inp.value;

  // Recalc row total
  var rowNum = day.replace('extra','');
  var ex = meRemitStore[key]['extra'];
  var nc  = parseFloat(ex['e'+rowNum+'nc']||0)||0;
  var ce  = parseFloat(ex['e'+rowNum+'ce']||0)||0;
  var tot = nc + ce;
  var totEl = document.getElementById('me-remit-row-total-'+day);
  if(totEl) totEl.innerHTML = '<span style="font-weight:800;font-size:12px;color:#0369A1">' +
    (nc>0||ce>0 ? '₹'+tot.toFixed(2) : '—') + '</span>';

  meRemitUpdateTotals(crsId, month, year);
}


// ─── GUNNY STOCK MANAGEMENT ─────────────────────────────────────────────────
// Data-entry only for now (per spec: values are saved here; the official
// TNCSC Statement will map them into position later — no statement is
// generated from this section yet).
//
// Store shape mirrors the suggested DB design (ID / CRS ID / Month / Item
// Name / Opening / Receipt / Total / Issues / Closing / Created At / Updated
// At); "openingAuto" is an extra bookkeeping flag (not a requested column)
// needed to know whether Opening was carried forward or typed by hand.
// {crsId_month_year: {itemId: {opening,receipt,total,issues,closing,
//                               openingAuto,crsId,month,year,itemName,
//                               createdAt,updatedAt}}}
var meGunnyStore = {};

var ME_GUNNY_ITEMS = [
  {id:'ss50',  label:'50 KG SS'},
  {id:'poly',  label:'POLY'},
  {id:'cbox',  label:'C.BOX'},
];

// ── Receipt auto-source (rules 2 & 8) ───────────────────────────────────────
// Gunny Receipt is NOT manually entered. It auto-fills from:
//   1) the Sales Close record for that CRS/month, if one exists
//      (Monthly Sales Gunny → 50 KG SS · Poly → POLY · C.Box → C.BOX), else
//   2) the live "Monthly Entry Sales" gunny counts: Σ of the gunny-sales
//      sub-column over the commodities of each pack type.
var ME_GUNNY_TYPE = { ss50:'GUNNY', poly:'POLY', cbox:'CBOX' };

function meMonthlySalesBags(crsId, month, year, type){
  var map = (typeof SC_PACK_TYPES!=='undefined') ? SC_PACK_TYPES[type] : null;
  if(!map) return 0;
  var bags = 0;
  var moKey = crsId+'_'+month+'_'+year;
  var saved = (typeof monthlyStore!=='undefined') ? monthlyStore[moKey] : null;
  Object.keys(map).forEach(function(cid){
    // Prefer the live DOM cell (user may be mid-edit), fall back to saved store
    var inp = document.querySelector(
      '#me-tbody-a tr[data-id="'+cid+'"] [data-field="gunny_sales"],'+
      '#me-tbody-b tr[data-id="'+cid+'"] [data-field="gunny_sales"]');
    if(inp){
      bags += parseInt(inp.value)||0;
    } else if(saved){
      var sv = (saved.a&&saved.a[cid]) || (saved.b&&saved.b[cid]);
      if(sv){
        if(sv.g_sales) bags += Math.round(sv.g_sales);
        else if(sv.sales) bags += Math.floor(sv.sales / map[cid]);
      }
    }
  });
  return bags;
}

function meGunnyReceiptValue(crsId, month, year, itemId){
  var type = ME_GUNNY_TYPE[itemId];
  if(!type) return {val:0, src:''};
  var sc = (typeof salesCloseStore!=='undefined') ? salesCloseStore[crsId+'_'+month+'_'+year] : null;
  if(sc){
    var v = type==='GUNNY' ? sc.gunny : type==='POLY' ? sc.poly : sc.cbox;
    return {val: v||0, src: 'Auto from Sales Close ('+sc.date.split('-').reverse().join('/')+')'};
  }
  return {val: meMonthlySalesBags(crsId, month, year, type), src: 'Auto from Monthly Entry Sales ('+type.toLowerCase()+' counts)'};
}

function meGunnyFmt(n){
  if(n===''||n===undefined||n===null) return '';
  n = Number(n);
  if(isNaN(n)) return '';
  return Number.isInteger(n) ? String(n) : n.toFixed(2);
}

// Same "Opening Stock Rule" already implemented for commodity stock
// (getAutoOpening), re-applied at month granularity since this section is
// per-month, not per-day:
//   • 1st month a CRS has data for this item → no previous record → return
//     null, so Opening stays manually editable.
//   • Every month after that → Opening = previous month's Closing, and the
//     field is locked (read-only) once carried forward.
function meGunnyPrevKey(crsId, month, year){
  var m = month - 1, y = year;
  if(m < 1){ m = 12; y = year - 1; }
  return crsId + '_' + m + '_' + y;
}
function meGunnyAutoOpening(crsId, month, year, itemId){
  var prev = meGunnyStore[meGunnyPrevKey(crsId, month, year)];
  if(prev && prev[itemId] && prev[itemId].closing !== undefined && prev[itemId].closing !== ''){
    return parseFloat(prev[itemId].closing) || 0;
  }
  return null; // no previous month's data → allow manual entry
}

function buildMeGunnyTable(){
  var tbody    = document.getElementById('me-gunny-tbody');
  var section  = document.getElementById('me-gunny-section');
  var subtitle = document.getElementById('me-gunny-subtitle');
  if(!tbody || !section) return;

  var crsId = document.getElementById('me-crs').value;
  var month = parseInt(document.getElementById('me-month').value);
  var year  = parseInt(document.getElementById('me-year').value);
  if(!crsId || !month || !year){ section.style.display='none'; return; }

  var crs    = CRS_LIST.find(function(c){ return String(c.id)===crsId; });
  var moName = ME_MONTH_NAMES[month] || '';
  if(subtitle) subtitle.textContent = 'CRS '+crsId+(crs?' — '+crs.name:'')+' — '+moName+' '+year;

  var key = crsId+'_'+month+'_'+year;
  if(!meGunnyStore[key]) meGunnyStore[key] = {};
  var saved = meGunnyStore[key];

  var rows = '';
  ME_GUNNY_ITEMS.forEach(function(item, i){
    if(!saved[item.id]) saved[item.id] = {};
    var sv  = saved[item.id];
    var bg  = i%2===0 ? '#fff' : '#FAF5FF';

    // Opening: auto-carry from previous month's Closing, else manual entry.
    // Whether a value is "auto" is decided ONCE, the first time this item is
    // rendered for this month, and then persisted on sv.openingAuto — not
    // re-derived from truthiness of sv.opening on every render. (Re-deriving
    // it that way would spuriously unlock the field on a later revisit
    // whenever the carried-forward value itself is a non-zero number, since
    // there'd be no way to distinguish "auto-filled" from "user typed this".)
    var autoOpen = meGunnyAutoOpening(crsId, month, year, item.id);
    if(sv.opening === undefined){
      if(autoOpen !== null){ sv.opening = autoOpen; sv.openingAuto = true; }
      else{ sv.openingAuto = false; }
    }
    var openReadonly = !!sv.openingAuto;
    // Receipt (rules 2 & 8): NOT manually entered — auto from the Sales Close
    // record if one exists, else from the live Monthly Entry gunny-sales sums.
    var rc = meGunnyReceiptValue(crsId, month, year, item.id);
    sv.receipt = rc.val; sv.receiptAuto = true; sv.receiptSrc = rc.src;
    var openingNum = parseFloat(sv.opening)||0;
    var receiptNum = parseFloat(sv.receipt)||0;
    var issuesNum  = parseFloat(sv.issues)||0;
    var totalNum   = openingNum + receiptNum;
    // Closing = Total − Issues (true value, may go NEGATIVE if Issues exceed
    // Total — shown in red so the deficit is visible instead of hidden as 0)
    var closingNum = totalNum - issuesNum;
    sv.total = totalNum; sv.closing = closingNum;
    sv.crsId = crsId; sv.month = month; sv.year = year; sv.itemName = item.label;
    if(!sv.createdAt) sv.createdAt = new Date().toISOString();

    var openBorder = openReadonly ? '#FDE68A' : '#DDD6FE';
    var openBg     = openReadonly ? 'background:#FEF3C7;color:#92400E;font-weight:700;' : 'background:#fff;color:var(--text);';
    if(openingNum < 0) openBg += 'color:#DC2626;font-weight:800;'; // carried deficit

    rows += '<tr style="background:'+bg+'" data-gunny-id="'+item.id+'">'+
      '<td style="padding:8px;text-align:center;font-size:11px;color:var(--muted);border-bottom:1px solid #EDE9FE">'+(i+1)+'</td>'+
      '<td style="padding:8px 12px;font-weight:600;font-size:12px;border-bottom:1px solid #EDE9FE">'+item.label+'</td>'+
      // Opening
      '<td style="padding:4px 5px;border-bottom:1px solid #EDE9FE">'+
        '<input type="number" min="0" step="0.01" placeholder="0"'+
        (openReadonly?' readonly':'')+
        ' data-gunny-id="'+item.id+'" data-gunny-field="opening"'+
        ' value="'+meGunnyFmt(sv.opening)+'"'+
        (openReadonly?'':' onchange="meGunnyCalc(this)" onkeydown="meGunnyNav(event,this)" oninput="meGunnyValidate(this)"')+
        ' style="width:100%;border:1px solid '+openBorder+';border-radius:6px;padding:5px 7px;font-size:12px;text-align:right;'+openBg+'"/>'+
      '</td>'+
      // Receipt — AUTO (read-only): from Sales Close totals or Monthly Sales counts
      '<td style="padding:4px 5px;border-bottom:1px solid #EDE9FE" id="me-gunny-receipt-cell-'+item.id+'">'+
        '<input type="text" readonly tabindex="-1" value="'+meGunnyFmt(sv.receipt)+'"'+
        ' title="'+rc.src+'"'+
        ' style="width:100%;border:1px solid #BBF7D0;border-radius:6px;padding:5px 7px;font-size:12px;text-align:right;color:#15803D;font-weight:700;background:#F0FDF4"/>'+
      '</td>'+
      // Total (read-only, auto)
      '<td style="padding:4px 5px;border-bottom:1px solid #EDE9FE" id="me-gunny-total-cell-'+item.id+'">'+
        '<input type="text" readonly tabindex="-1" value="'+meGunnyFmt(totalNum)+'"'+
        ' style="width:100%;border:1px solid #DDD6FE;border-radius:6px;padding:5px 7px;font-size:12px;text-align:right;font-weight:700;background:#EDE9FE;color:#6D28D9"/>'+
      '</td>'+
      // Issues
      '<td style="padding:4px 5px;border-bottom:1px solid #EDE9FE">'+
        '<input type="number" min="0" step="0.01" placeholder="0"'+
        ' data-gunny-id="'+item.id+'" data-gunny-field="issues"'+
        ' value="'+meGunnyFmt(sv.issues)+'"'+
        ' onchange="meGunnyCalc(this)" onkeydown="meGunnyNav(event,this)" oninput="meGunnyValidate(this)"'+
        ' style="width:100%;border:1px solid #FCA5A5;border-radius:6px;padding:5px 7px;font-size:12px;text-align:right;color:#DC2626;font-weight:600;background:#FEF2F2"/>'+
      '</td>'+
      // Closing (read-only, auto — RED when negative: Issues exceed Total)
      '<td style="padding:4px 5px;border-bottom:1px solid #EDE9FE" id="me-gunny-closing-cell-'+item.id+'">'+
        '<input type="text" readonly tabindex="-1" value="'+meGunnyFmt(closingNum)+'"'+
        (closingNum<0?' title="Deficit: Issues exceed Total"':'')+
        ' style="width:100%;border:1px solid '+(closingNum<0?'#FCA5A5':'#E2E8F0')+';border-radius:6px;padding:5px 7px;font-size:12px;text-align:right;font-weight:'+(closingNum<0?'800':'700')+';background:'+(closingNum<0?'#FEF2F2':'#F8FAFC')+';color:'+(closingNum<0?'#DC2626':'var(--muted)')+'"/>'+
      '</td>'+
    '</tr>';
  });

  tbody.innerHTML = rows;
  meGunnyUpdateFooter(crsId, month, year);
  section.style.display = 'block';

  // Keep Monthly Entry consistent on re-render (e.g. switching months and
  // back): re-push Issues → Monthly Sales, but ONLY for items where Issues
  // was explicitly entered — never wipes a hand-typed monthly value otherwise.
  ME_GUNNY_ITEMS.forEach(function(item){
    var r = saved[item.id];
    if(r && r.issues !== undefined && r.issues !== ''){
      meGunnySyncIssuesToMonthly(item.id, r.issues);
    }
  });
}

function meGunnyCalc(inp){
  var itemId = inp.dataset.gunnyId;
  var field  = inp.dataset.gunnyField; // 'opening' | 'receipt' | 'issues'
  var crsId  = document.getElementById('me-crs').value;
  var month  = parseInt(document.getElementById('me-month').value);
  var year   = parseInt(document.getElementById('me-year').value);
  if(!crsId || !month || !year) return;
  var key = crsId+'_'+month+'_'+year;
  if(!meGunnyStore[key]) meGunnyStore[key] = {};
  if(!meGunnyStore[key][itemId]) meGunnyStore[key][itemId] = {};
  var rec = meGunnyStore[key][itemId];

  var v = parseFloat(inp.value);
  if(isNaN(v) || v < 0){ v = ''; inp.value = ''; }
  rec[field] = v;

  // Total = Opening + Receipt · Closing = Total − Issues (true value — may go
  // negative when Issues exceed Total; shown in red as a visible deficit)
  var opening = parseFloat(rec.opening)||0;
  var receipt = parseFloat(rec.receipt)||0;
  var issues  = parseFloat(rec.issues)||0;
  var total   = opening + receipt;
  var closing = total - issues;
  rec.total = total; rec.closing = closing;
  rec.crsId = crsId; rec.month = month; rec.year = year;
  var itemDef = ME_GUNNY_ITEMS.find(function(it){ return it.id===itemId; });
  rec.itemName = itemDef ? itemDef.label : itemId;
  rec.updatedAt = new Date().toISOString();
  if(!rec.createdAt) rec.createdAt = rec.updatedAt;

  var totCell = document.getElementById('me-gunny-total-cell-'+itemId);
  if(totCell){ var ti=totCell.querySelector('input'); if(ti) ti.value = meGunnyFmt(total); }
  meGunnyPaintClosing(itemId, closing);

  meGunnyUpdateFooter(crsId, month, year);

  // Rule 9 — Monthly Entry integration: Issues entered here flow into the
  // Monthly Entry Sales of the matching commodity (single entry, no retyping):
  //   POLY Issues  → Empty Polythene Bag (EMPTY_BAG) Sales
  //   C.BOX Issues → Empty Card+Box     (EMPTY_BOX) Sales
  // Amount updates automatically via the standard pipeline (sales × rate).
  if(field === 'issues') meGunnySyncIssuesToMonthly(itemId, rec.issues);
}

// Gunny item → Monthly Entry commodity mapping for the Issues→Sales sync.
// (50 KG SS has no single Monthly Entry commodity — its gunny counts live in
// the per-commodity GUNNY sub-columns — so only POLY and C.BOX are mapped.)
var ME_GUNNY_TO_COMM = { poly:'EMPTY_BAG', cbox:'EMPTY_BOX' };

function meGunnySyncIssuesToMonthly(itemId, issues){
  var commId = ME_GUNNY_TO_COMM[itemId];
  if(!commId) return;
  var tr = document.querySelector('#me-tbody-a tr[data-id="'+commId+'"]');
  if(!tr) return;
  var salesInp = tr.querySelector('[data-field="sales"]');
  if(!salesInp) return;
  var n = parseFloat(issues);
  salesInp.value = (isNaN(n) || issues==='' || issues===undefined) ? '' : n.toFixed(3);
  // Reuse the standard change pipeline: recomputes Total/Closing/Amount for
  // the row, refreshes gunny sub-cells, and updates the section totals.
  if(typeof onMeFieldChange === 'function') onMeFieldChange(salesInp);
}

function meGunnyUpdateFooter(crsId, month, year){
  var key  = crsId+'_'+month+'_'+year;
  var data = meGunnyStore[key] || {};
  var totOpen=0, totRec=0, totTotal=0, totIssues=0, totClose=0;
  ME_GUNNY_ITEMS.forEach(function(item){
    var r = data[item.id] || {};
    totOpen   += parseFloat(r.opening)||0;
    totRec    += parseFloat(r.receipt)||0;
    totTotal  += parseFloat(r.total)||0;
    totIssues += parseFloat(r.issues)||0;
    totClose  += parseFloat(r.closing)||0;
  });
  var el = function(id){ return document.getElementById(id); };
  if(el('me-gunny-tot-opening')) el('me-gunny-tot-opening').textContent = meGunnyFmt(totOpen)||'0';
  if(el('me-gunny-tot-receipt')) el('me-gunny-tot-receipt').textContent = meGunnyFmt(totRec)||'0';
  if(el('me-gunny-tot-total'))   el('me-gunny-tot-total').textContent   = meGunnyFmt(totTotal)||'0';
  if(el('me-gunny-tot-issues'))  el('me-gunny-tot-issues').textContent  = meGunnyFmt(totIssues)||'0';
  if(el('me-gunny-tot-closing')){
    el('me-gunny-tot-closing').textContent = meGunnyFmt(totClose)||'0';
    el('me-gunny-tot-closing').style.color = totClose < 0 ? '#FCA5A5' : '#FDE68A';
  }
}

// Live refresh of the auto Receipt values (called when Monthly Entry gunny
// sales change, or when Sales Close is marked). Updates the store record,
// the Receipt/Total/Closing cells, and the footer totals.
function meGunnyRefreshReceipts(){
  var section = document.getElementById('me-gunny-section');
  var tbody   = document.getElementById('me-gunny-tbody');
  if(!section || !tbody || section.style.display==='none' || !tbody.children.length) return;
  var crsEl = document.getElementById('me-crs'), moEl = document.getElementById('me-month'), yrEl = document.getElementById('me-year');
  if(!crsEl || !crsEl.value || !moEl.value || !yrEl.value) return;
  var crsId = crsEl.value, month = parseInt(moEl.value), year = parseInt(yrEl.value);
  var key = crsId+'_'+month+'_'+year;
  if(!meGunnyStore[key]) meGunnyStore[key] = {};

  ME_GUNNY_ITEMS.forEach(function(item){
    if(!meGunnyStore[key][item.id]) meGunnyStore[key][item.id] = {};
    var rec = meGunnyStore[key][item.id];
    var rc = meGunnyReceiptValue(crsId, month, year, item.id);
    rec.receipt = rc.val; rec.receiptAuto = true; rec.receiptSrc = rc.src;
    var opening = parseFloat(rec.opening)||0;
    var issues  = parseFloat(rec.issues)||0;
    rec.total   = opening + rc.val;
    rec.closing = rec.total - issues;
    rec.updatedAt = new Date().toISOString();

    var rCell = document.getElementById('me-gunny-receipt-cell-'+item.id);
    if(rCell){ var ri=rCell.querySelector('input'); if(ri){ ri.value = meGunnyFmt(rc.val); ri.title = rc.src; } }
    var tCell = document.getElementById('me-gunny-total-cell-'+item.id);
    if(tCell){ var ti=tCell.querySelector('input'); if(ti) ti.value = meGunnyFmt(rec.total); }
    meGunnyPaintClosing(item.id, rec.closing);
  });
  meGunnyUpdateFooter(crsId, month, year);
}

// Paint the Closing cell: normal grey, or red "deficit" styling when negative
function meGunnyPaintClosing(itemId, closing){
  var cell = document.getElementById('me-gunny-closing-cell-'+itemId);
  if(!cell) return;
  var inp = cell.querySelector('input');
  if(!inp) return;
  inp.value = meGunnyFmt(closing);
  var neg = closing < 0;
  inp.style.color        = neg ? '#DC2626' : 'var(--muted)';
  inp.style.background   = neg ? '#FEF2F2' : '#F8FAFC';
  inp.style.borderColor  = neg ? '#FCA5A5' : '#E2E8F0';
  inp.style.fontWeight   = neg ? '800' : '700';
  inp.title              = neg ? 'Deficit: Issues exceed Total' : '';
}

// Reject negative values while typing (mirrors entryInputValidate / meRemitValidate)
function meGunnyValidate(inp){
  setTimeout(function(){
    var v = parseFloat(inp.value);
    if(!isNaN(v) && v < 0){ inp.value=''; }
  }, 0);
}

// Keyboard nav: Enter → next editable field (row-major: Opening→Receipt→
// Issues, then next row). ArrowDown/ArrowUp → same field, next/prev row.
function meGunnyNav(e, inp){
  // Editable column order: opening → issues (Receipt/Total/Closing are auto)
  var FIELDS = ['opening','issues'];
  var KEYS = ['Enter','ArrowDown','ArrowUp','ArrowLeft','ArrowRight','Tab'];
  if(KEYS.indexOf(e.key) === -1) return;

  var tbody = document.getElementById('me-gunny-tbody');
  if(!tbody) return;
  var rows   = Array.from(tbody.querySelectorAll('tr[data-gunny-id]'));
  var field  = inp.dataset.gunnyField;
  var itemId = inp.dataset.gunnyId;
  var ri     = rows.findIndex(function(r){ return r.dataset.gunnyId === itemId; });
  var fi     = FIELDS.indexOf(field);
  if(ri === -1 || fi === -1) return;

  var nextRi = ri, nextFi = fi;

  // Arrows/Enter must never fall through to the browser default (in a
  // number input, ArrowUp/Down would increment/decrement the value at the
  // grid edges). Tab keeps its native fallback at the very end of the grid.
  if(e.key !== 'Tab') e.preventDefault();

  if(e.key === 'Enter' || e.key === 'ArrowDown'){
    nextRi = ri + 1;                          // same column, next row
  } else if(e.key === 'ArrowUp'){
    nextRi = ri - 1;                          // same column, prev row
  } else if(e.key === 'ArrowRight' || (e.key === 'Tab' && !e.shiftKey)){
    if(fi < FIELDS.length - 1){
      nextFi = fi + 1;                        // next column, same row
    } else {
      nextFi = 0; nextRi = ri + 1;           // wrap to first column of next row
    }
  } else if(e.key === 'ArrowLeft' || (e.key === 'Tab' && e.shiftKey)){
    if(fi > 0){
      nextFi = fi - 1;                        // prev column, same row
    } else {
      nextFi = FIELDS.length - 1; nextRi = ri - 1; // wrap to last column of prev row
    }
  }

  // Bounds check
  if(nextRi < 0 || nextRi >= rows.length) return;
  var nextRow = rows[nextRi];
  var next = nextRow ? nextRow.querySelector('[data-gunny-field="'+FIELDS[nextFi]+'"]') : null;
  if(!next || next.readOnly) return;

  e.preventDefault();
  next.focus(); next.select();
}


// ─── CARD DETAILS ─────────────────────────────────────────────────────────────
 // {crsId_month_year: {rowId: {count, remarks}}}

// Card type definitions (from the PDF image)











// ─── CARD DETAILS ──────────────────────────────────────────────────────────────
var meCardStore = {}; // {crsId_month_year: {cardId: {count, remarks}}}

var ME_CARD_TYPES = [
  {id:'rice',      label:'RICE CARD'},
  {id:'lof_rice',  label:'LOF RICE CARD'},
  {id:'sugar',     label:'SUGAR CARD'},
  {id:'lof_sugar', label:'LOF SUGAR'},
  {id:'aay',       label:'AAY CARD'},
  {id:'lof_aay',   label:'LOF AAY CARD'},
  {id:'oap',       label:'OAP'},
  {id:'police',    label:'POLICE'},
  {id:'n_card',    label:'"N" CARD'},
];

function buildMeCardTable(){
  var tbody   = document.getElementById('me-card-tbody');
  var section = document.getElementById('me-card-section');
  var subtitle = document.getElementById('me-card-subtitle');
  if(!tbody || !section) return;

  var crsId = document.getElementById('me-crs').value;
  var month = parseInt(document.getElementById('me-month').value);
  var year  = parseInt(document.getElementById('me-year').value);
  if(!crsId || !month || !year){ section.style.display='none'; return; }

  var crs    = CRS_LIST.find(function(c){ return String(c.id)===crsId; });
  var moName = ME_MONTH_NAMES[month] || '';
  if(subtitle) subtitle.textContent = 'CRS '+crsId+(crs?' \u2014 '+crs.name:'')+' \u2014 '+moName+' '+year;

  var key   = crsId+'_'+month+'_'+year;
  var saved = meCardStore[key] || {};

  var rows = '';
  ME_CARD_TYPES.forEach(function(ct, i){
    var d       = saved[ct.id] || {};
    var count   = (d.count !== undefined && d.count !== '') ? parseInt(d.count) : '';
    var remarks = d.remarks || '';
    var bg      = i%2===0 ? '#fff' : '#F0FDFA';

    rows +=
      '<tr style="background:'+bg+'" data-card-id="'+ct.id+'">'+
        '<td style="padding:7px 10px;text-align:center;font-size:11px;color:var(--muted);border-bottom:1px solid #CCFBF1">'+(i+1)+'</td>'+
        '<td style="padding:7px 14px;font-size:12px;font-weight:600;color:var(--text);border-bottom:1px solid #CCFBF1">'+ct.label+'</td>'+
        '<td style="padding:4px 8px;text-align:center;border-bottom:1px solid #CCFBF1">'+
          '<input type="number" min="0" step="1" placeholder="0"'+
          ' data-card-id="'+ct.id+'" data-card-field="count"'+
          ' value="'+(count!==''?count:'')+'"'+
          ' onchange="meCardCalc(this)" onkeydown="meCardNav(event,this)"'+
          ' style="width:90px;border:2px solid #99F6E4;border-radius:7px;padding:5px 10px;'+
                 'font-size:13px;font-weight:800;text-align:center;color:#0F766E;background:#F0FDFA"/>'+
        '</td>'+
        '<td style="padding:4px 8px;border-bottom:1px solid #CCFBF1">'+
          '<input type="text" placeholder="Remarks (optional)"'+
          ' data-card-id="'+ct.id+'" data-card-field="remarks"'+
          ' value="'+remarks+'"'+
          ' onchange="meCardCalc(this)" onkeydown="meCardNav(event,this)"'+
          ' style="width:100%;border:1px solid #E2E8F0;border-radius:6px;padding:5px 8px;font-size:11px"/>'+
        '</td>'+
      '</tr>';
  });

  tbody.innerHTML = rows;
  meCardUpdateTotal(crsId, month, year);
  section.style.display = 'block';
}

function meCardCalc(inp){
  var cardId = inp.dataset.cardId;
  var field  = inp.dataset.cardField;
  var crsId  = document.getElementById('me-crs').value;
  var month  = parseInt(document.getElementById('me-month').value);
  var year   = parseInt(document.getElementById('me-year').value);
  var key    = crsId+'_'+month+'_'+year;
  if(!meCardStore[key]) meCardStore[key] = {};
  if(!meCardStore[key][cardId]) meCardStore[key][cardId] = {};

  if(field === 'count'){
    var v = parseInt(inp.value);
    // Reject negatives and non-integers
    if(isNaN(v) || v < 0){ inp.value = ''; v = 0; }
    meCardStore[key][cardId][field] = v;
  } else {
    meCardStore[key][cardId][field] = inp.value;
  }
  meCardUpdateTotal(crsId, month, year);
}

function meCardUpdateTotal(crsId, month, year){
  var key   = crsId+'_'+month+'_'+year;
  var data  = meCardStore[key] || {};
  var total = 0;
  Object.keys(data).forEach(function(id){
    total += parseInt(data[id].count||0)||0;
  });
  var el = document.getElementById('me-card-total');
  if(el) el.textContent = total;
}

// Keyboard nav: Enter/↓ = next row same column, ↑ = previous row
function meCardNav(e, inp){
  if(e.key !== 'Enter' && e.key !== 'ArrowDown' && e.key !== 'ArrowUp') return;
  e.preventDefault();
  var cardId = inp.dataset.cardId;
  var field  = inp.dataset.cardField;
  var tbody  = document.getElementById('me-card-tbody');
  if(!tbody) return;
  var rows   = Array.from(tbody.querySelectorAll('tr[data-card-id]'));
  var curIdx = rows.findIndex(function(r){ return r.dataset.cardId === cardId; });
  var nextIdx = e.key==='ArrowUp' ? curIdx-1 : curIdx+1;
  if(nextIdx < 0 || nextIdx >= rows.length) return;
  var nextInp = rows[nextIdx].querySelector('[data-card-field="'+field+'"]');
  if(nextInp){ nextInp.focus(); if(nextInp.select) nextInp.select(); }
}


// ── Monthly Entry keyboard navigation ─────────────────────────────────────────
// Enter/↓ → next row same column | ↑ → previous row same column | Tab → next field
function meEntryNav(e, inp){
  // Full 2D navigation (Enter/↓ = down same column, ↑ = up, ←/→ = across the
  // row incl. GUNNY sub-columns, continuing across Section A → Section B).
  gridNav(e, inp, ['me-tbody-a','me-tbody-b']);
}


// ── Live Gunny update as user types in any KGS field ─────────────────────────
function meKgsInput(inp){
  var id    = inp.dataset.id;
  var sec   = inp.dataset.sec;
  var field = inp.dataset.field;   // 'open', 'receipt', 'sales'
  var val   = parseFloat(inp.value) || 0;
  var div   = bagDiv(id);   // [S1]
  var gunny = val > 0 ? String(Math.floor(val / div)) : '';

  // Update THIS field's gunny
  var gEl = document.getElementById('me-gunny-' + field + '-' + id + '-' + sec);
  if(!gEl){
    var tr = inp.closest('tr');
    if(tr) gEl = tr.querySelector('[data-field="gunny_' + field + '"]');
  }
  if(gEl && !gEl.dataset.manualEdit) gEl.value = gunny;

  // Also update Total gunny (open + receipt)
  var tr2 = inp.closest('tr');
  if(tr2){
    var openInp = tr2.querySelector('[data-field="open"]');
    var recInp  = tr2.querySelector('[data-field="receipt"]');
    var totInp  = tr2.querySelector('[data-field="total"]');
    var cloInp  = tr2.querySelector('[data-field="close"]');
    var salesInp= tr2.querySelector('[data-field="sales"]');
    var openV  = parseFloat(openInp  ? openInp.value  : 0) || 0;
    var recV   = parseFloat(recInp   ? recInp.value   : 0) || 0;
    var salesV = parseFloat(salesInp ? salesInp.value : 0) || 0;
    var tot    = openV + recV;
    var clo    = tot - salesV;

    // Update total KGS display (readonly)
    if(totInp) totInp.value = tot.toFixed(3);
    if(cloInp){ cloInp.value = clo.toFixed(3); entryPaintClose(tr2, clo); }

    // Update total gunny
    var totG = document.getElementById('me-gunny-total-' + id + '-' + sec);
    if(!totG) totG = tr2.querySelector('[data-field="gunny_total"]');
    if(totG && !totG.dataset.manualEdit) totG.value = tot > 0 ? String(Math.floor(tot/div)) : '';

    // Update close gunny
    var cloG = document.getElementById('me-gunny-close-' + id + '-' + sec);
    if(!cloG) cloG = tr2.querySelector('[data-field="gunny_close"]');
    if(cloG && !cloG.dataset.manualEdit) cloG.value = clo > 0 ? String(Math.floor(clo/div)) : '';

    // Update sales gunny if sales changed
    if(field === 'sales'){
      var salG = document.getElementById('me-gunny-sales-' + id + '-' + sec);
      if(!salG) salG = tr2.querySelector('[data-field="gunny_sales"]');
      if(salG && !salG.dataset.manualEdit) salG.value = salesV > 0 ? String(Math.floor(salesV/div)) : '';
    }
  }
}

// ── DATE ──────────────────────────────────────────────
var curDateEl=document.getElementById('cur-date');
if(curDateEl) curDateEl.textContent=new Date().toLocaleDateString('en-IN',{day:'2-digit',month:'short',year:'numeric'});

// ── INIT ──────────────────────────────────────────────
buildCrsTable();
// Dashboard built via showPage on first navigation


// ── generateStatement (legacy compat) ─────────────────────────────────────
function generateStatement(){
  var crs = document.getElementById('stmt-crs').value;
  if(!crs){ alert('Please select a CRS shop.'); return; }
  stmtPreviewSection('crs_page2');
}

// ── Init statements page ───────────────────────────────────────────────────
function initStmtPage(){
  stmtInitCRSDropdown();
  stmtRenderSections();
  if(typeof stmtRenderModuleStatus === 'function') stmtRenderModuleStatus();
}


// ═══ INSPECTION ENTRY + DSS PREVIEW ══════════════════════════════════════════

// ── Inspection Entry ──────────────────────────────────────────────────────────


// ── DSS Preview — Day-by-day PDF ──────────────────────────────────────────────



// ─── INSPECTION ENTRY ─────────────────────────────────────────────────────────
// Metadata for the three inspection action types
