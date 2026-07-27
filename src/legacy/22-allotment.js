/* Monthly Entry — Card Details (no Remarks) + Allotment  [+]
   Added after the port; not part of TNCSC_CRS_Demo_19 (1).html, so
   tools/verify-parity.mjs skips this file (see NEW_ENGINE there).

   Monthly Entry becomes the one place card counts and the month's allotment
   are typed. Both then feed the generated statement, so nothing is entered
   twice:
     Card counts  -> CRS PAGE1 (left column) and the CARD DETAILS sheet
                     (both already read meCardStore, so they need no change)
     Allotment    -> CRS PAGE1 (right column) and the COLL Allotment column

   THE TWO ARE DELIBERATELY DIFFERENT. Card counts barely move month to month,
   so they carry forward: opening a month with none seeds last month's figures
   and "No Change" accepts them as they stand. Allotment is re-issued every
   month, so it is never carried — a blank sheet each month is the point, and
   the monthly close will not pass until it is filled in.

   Concatenated last by tools/bundle-engine.mjs, so everything wrapped below
   already exists, and these wrappers sit outside the ones 20/21 installed. */

// {crsId_month_year: {commodityId: qty}}
var meAllotStore = {};
// {crsId_month_year: true} — set by Save / No Change.
var meCardConfirmed = {};

// {crsId_month_year: {cardId: {count}}} — last month's counts, shown as a
// PREVIEW for a month that has none of its own. Deliberately NOT meCardStore:
// the statements read that store directly and cannot tell a carried figure
// from a typed one, so writing on render would make every month someone
// merely looked at report last month's cards as its own. The draft is promoted
// into the real store by the first edit, Save, or No Change — never by
// rendering.
var meCardCarry = {};

// Not allotted: the packet lines (salt, OOTY, TAN), the empty packing
// materials, and the whole police ration. None of them are issued as a monthly
// allotment, so they are not asked for.
var ME_ALLOT_EXCLUDE = {SALT_CIS:1, SALT_RFFS:1, OOTY:1, TAN:1, EMPTY_BOX:1, EMPTY_BAG:1};

// The 15 main ration commodities, each keeping its own unit — exactly the lines
// CRS PAGE1 and COLL's main section print.
//
// CRS 29 (the refugee camp) carries its own short list instead; 26-crs29.js
// defines it, and it is asked for here so the allotment panel offers the same
// commodities the camp's statements print. The lookup is by function so this
// file does not depend on load order.
function meAllotItems(){
  if(typeof crs29AllotItems === 'function'){
    var special = crs29AllotItems(meMoKey && meMoKey());
    if(special) return special;
  }
  var a = (typeof DSS_A !== 'undefined') ? DSS_A : [];
  return a.filter(function(c){ return !ME_ALLOT_EXCLUDE[c.id]; })
          .map(function(c){ return {c: c, sec: 'a'}; });
}

// Ids the allotment actually covers. Used to ignore anything left in the store
// for a commodity that is no longer asked for — a value seeded or backed up
// before this narrowing must not keep driving the statements.
function meAllotIdSet(){
  var s = {};
  meAllotItems().forEach(function(it){ s[it.c.id] = 1; });
  return s;
}

function meMoKey(){
  var crsId = document.getElementById('me-crs').value;
  var month = parseInt(document.getElementById('me-month').value);
  var year  = parseInt(document.getElementById('me-year').value);
  if(!crsId || !month || !year) return null;
  return {key: crsId + '_' + month + '_' + year, crsId: crsId, month: month, year: year};
}

function mePrevMoKey(crsId, month, year){
  var m = month - 1, y = year;
  if(m < 1){ m = 12; y = year - 1; }
  return crsId + '_' + m + '_' + y;
}

function meCardHasCounts(key){
  var d = meCardStore[key];
  if(!d) return false;
  return Object.keys(d).some(function(id){
    var v = d[id] && d[id].count;
    return v !== undefined && v !== '' && parseInt(v) > 0;
  });
}

function meAllotHasValues(key){
  var d = meAllotStore[key];
  if(!d) return false;
  var ids = meAllotIdSet();
  return Object.keys(d).some(function(id){ return ids[id] && (parseFloat(d[id]) || 0) > 0; });
}

// ── STATUS LINE ─────────────────────────────────────────────────────────────
function meCardStatus(msg, tone){
  var el = document.getElementById('me-card-status');
  if(!el) return;
  if(!msg){ el.style.display = 'none'; return; }
  var colors = {ok: '#15803D', warn: '#B45309', info: '#0F766E'};
  el.textContent = msg;
  el.style.color = colors[tone || 'info'];
  el.style.display = 'inline';
}

// ── CARD DETAILS ────────────────────────────────────────────────────────────
// Replaces the ported builder: the Remarks column is gone, and a month with no
// counts of its own is seeded from the previous month so the sheet opens ready
// to accept or edit rather than empty.
function buildMeCardTable(){
  var tbody   = document.getElementById('me-card-tbody');
  var section = document.getElementById('me-card-section');
  var subtitle = document.getElementById('me-card-subtitle');
  if(!tbody || !section) return;

  var mo = meMoKey();
  if(!mo){ section.style.display = 'none'; return; }

  var crs    = CRS_LIST.find(function(c){ return String(c.id) === mo.crsId; });
  var moName = ME_MONTH_NAMES[mo.month] || '';
  if(subtitle) subtitle.textContent = 'CRS ' + mo.crsId + (crs ? ' — ' + crs.name : '') + ' — ' + moName + ' ' + mo.year;

  // Show last month's counts for a month that has none of its own (rule 9),
  // as a draft only — see meCardCarry. Re-derived on every render, so
  // correcting the source month is reflected the next time this one is opened.
  var carried = false;
  var saved = meCardStore[mo.key];
  if(!saved || !Object.keys(saved).length){
    var prev = meCardStore[mePrevMoKey(mo.crsId, mo.month, mo.year)];
    if(prev && Object.keys(prev).length){
      var draft = {};
      Object.keys(prev).forEach(function(id){
        draft[id] = {count: parseInt(prev[id].count) || 0};
      });
      meCardCarry[mo.key] = draft;
      saved = draft;
      carried = true;
    }
  } else {
    delete meCardCarry[mo.key];
  }
  saved = saved || {};

  var rows = '';
  ME_CARD_TYPES.forEach(function(ct, i){
    var d     = saved[ct.id] || {};
    var count = (d.count !== undefined && d.count !== '') ? parseInt(d.count) : '';
    var bg    = i % 2 === 0 ? '#fff' : '#F0FDFA';

    rows +=
      '<tr style="background:' + bg + '" data-card-id="' + ct.id + '">' +
        '<td style="padding:7px 10px;text-align:center;font-size:11px;color:var(--muted);border-bottom:1px solid #CCFBF1">' + (i+1) + '</td>' +
        '<td style="padding:7px 14px;font-size:12px;font-weight:600;color:var(--text);border-bottom:1px solid #CCFBF1">' + ct.label + '</td>' +
        '<td style="padding:4px 8px;text-align:center;border-bottom:1px solid #CCFBF1">' +
          '<input type="number" min="0" step="1" placeholder="0"' +
          ' data-card-id="' + ct.id + '" data-card-field="count"' +
          ' value="' + (count !== '' ? count : '') + '"' +
          ' onchange="meCardCalc(this)" onkeydown="meCardNav(event,this)"' +
          ' style="width:90px;border:2px solid #99F6E4;border-radius:7px;padding:5px 10px;' +
                 'font-size:13px;font-weight:800;text-align:center;color:#0F766E;background:#F0FDFA"/>' +
        '</td>' +
      '</tr>';
  });

  tbody.innerHTML = rows;
  // The ported total sums meCardStore, which a draft is deliberately not in.
  if(carried){
    var draftTotal = 0;
    Object.keys(saved).forEach(function(id){ draftTotal += parseInt(saved[id].count) || 0; });
    var totEl = document.getElementById('me-card-total');
    if(totEl) totEl.textContent = draftTotal;
  } else {
    meCardUpdateTotal(mo.crsId, mo.month, mo.year);
  }
  buildMeAllotTable();
  section.style.display = 'block';

  var prevName = ME_MONTH_NAMES[mo.month === 1 ? 12 : mo.month - 1] || 'last month';
  if(carried){
    meCardStatus('Showing ' + prevName + '’s counts — not saved for ' + moName + ' yet. Press No Change to keep them, or edit and Save.', 'warn');
  } else if(meCardConfirmed[mo.key]){
    meCardStatus('✓ Card details saved for ' + moName + ' ' + mo.year + '.', 'ok');
  } else if(meCardHasCounts(mo.key)){
    meCardStatus('Not saved yet — press Save to store these counts.', 'warn');
  } else {
    meCardStatus('Enter the card counts, then press Save.', 'warn');
  }
}

// ── ALLOTMENT ───────────────────────────────────────────────────────────────
function buildMeAllotTable(){
  var tbody = document.getElementById('me-allot-tbody');
  if(!tbody) return;
  var mo = meMoKey();
  if(!mo){ tbody.innerHTML = ''; return; }

  var saved = meAllotStore[mo.key] || {};
  // Advance load lives in 24-coll.js; it only ever reduces what the COLL
  // statement reports as received from the godown, so it is typed here beside
  // the allotment rather than on a screen of its own.
  var adv = (typeof meAdvanceStore !== 'undefined' && meAdvanceStore[mo.key]) ? meAdvanceStore[mo.key] : {};
  var rows = '', n = 0;

  meAllotItems().forEach(function(it){
    var c = it.c;
    n++;
    var v  = saved[c.id];
    var val = (v === undefined || v === '' || v === null) ? '' : v;
    var av  = adv[c.id];
    var aval = (av === undefined || av === '' || av === null) ? '' : av;
    var bg = n % 2 === 0 ? '#F0FDFA' : '#fff';

    rows +=
      '<tr style="background:' + bg + '" data-allot-id="' + c.id + '">' +
        '<td style="padding:6px 10px;text-align:center;font-size:11px;color:var(--muted);border-bottom:1px solid #CCFBF1">' + n + '</td>' +
        '<td style="padding:6px 12px;border-bottom:1px solid #CCFBF1">' +
          '<div style="font-size:11.5px;font-weight:600;color:var(--text)">' + c.en + '</div>' +
          '<div style="font-size:9.5px;color:var(--muted)">' + c.ta + '</div>' +
        '</td>' +
        '<td style="padding:4px 8px;text-align:center;border-bottom:1px solid #CCFBF1;white-space:nowrap">' +
          '<input type="number" min="0" step="0.001" placeholder="0.000"' +
          ' data-allot-id="' + c.id + '" value="' + val + '"' +
          ' onchange="meAllotCalc(this)" oninput="meAllotCalc(this)" onkeydown="meAllotNav(event,this)"' +
          ' style="width:96px;border:2px solid #99F6E4;border-radius:7px;padding:5px 8px;' +
                 'font-size:12.5px;font-weight:800;text-align:right;color:#0F766E;background:#F0FDFA"/>' +
          '<span style="font-size:9.5px;font-weight:700;color:var(--muted);margin-left:6px">' + c.unit + '</span>' +
        '</td>' +
        '<td style="padding:4px 8px;text-align:center;border-bottom:1px solid #CCFBF1;white-space:nowrap">' +
          '<input type="number" min="0" step="0.001" placeholder="0.000"' +
          ' data-advance-id="' + c.id + '" value="' + aval + '"' +
          ' title="Stock drawn ahead of its month. Deducted from Received from godown on the COLL statement."' +
          ' onchange="meAdvanceCalc(this)" oninput="meAdvanceCalc(this)"' +
          ' style="width:92px;border:2px solid #FDE68A;border-radius:7px;padding:5px 8px;' +
                 'font-size:12.5px;font-weight:800;text-align:right;color:#B45309;background:#FFFBEB"/>' +
        '</td>' +
      '</tr>';
  });

  tbody.innerHTML = rows;
  meAllotUpdateTotal();
}

function meAllotCalc(inp){
  var mo = meMoKey();
  if(!mo) return;
  var id = inp.dataset.allotId;
  var v  = parseFloat(inp.value);
  if(inp.value !== '' && (isNaN(v) || v < 0)){ inp.value = ''; v = NaN; }
  if(!meAllotStore[mo.key]) meAllotStore[mo.key] = {};
  if(inp.value === '' || isNaN(v)) delete meAllotStore[mo.key][id];
  else meAllotStore[mo.key][id] = v;
  meAllotUpdateTotal();
}

function meAllotUpdateTotal(){
  var mo = meMoKey();
  var el = document.getElementById('me-allot-total');
  if(!el) return;
  var d = (mo && meAllotStore[mo.key]) ? meAllotStore[mo.key] : {};
  var ids = meAllotIdSet();
  el.textContent = Object.keys(d).filter(function(id){
    return ids[id] && (parseFloat(d[id]) || 0) > 0;
  }).length;
}

function meAllotNav(e, inp){
  if(e.key !== 'Enter' && e.key !== 'ArrowDown' && e.key !== 'ArrowUp') return;
  e.preventDefault();
  var rows = Array.from(document.querySelectorAll('#me-allot-tbody tr[data-allot-id]'));
  var cur  = rows.findIndex(function(r){ return r.dataset.allotId === inp.dataset.allotId; });
  var next = rows[e.key === 'ArrowUp' ? cur - 1 : cur + 1];
  if(!next) return;
  var el = next.querySelector('input');
  if(el){ el.focus(); if(el.select) el.select(); }
}

// ── ACTIONS ─────────────────────────────────────────────────────────────────
// Turns a carried draft into this month's real figures. Called by the first
// edit, by Save and by No Change — the three things that mean "these are mine".
function meCardCommitCarry(key){
  if(meCardCarry[key] && (!meCardStore[key] || !Object.keys(meCardStore[key]).length)){
    meCardStore[key] = meCardCarry[key];
  }
  delete meCardCarry[key];
}

// Editing any count adopts the draft first, so the row being typed does not
// become the month's only figure.
var _allotOrigMeCardCalc = meCardCalc;
meCardCalc = function(inp){
  var mo = meMoKey();
  if(mo) meCardCommitCarry(mo.key);
  return _allotOrigMeCardCalc.apply(this, arguments);
};

// "No Change": take the previous month's counts as this month's, untouched.
function meCardNoChange(){
  var mo = meMoKey();
  if(!mo){ alert('Select a CRS shop, month and year first.'); return false; }

  var prevKey = mePrevMoKey(mo.crsId, mo.month, mo.year);
  var prev    = meCardStore[prevKey];
  var prevName = (ME_MONTH_NAMES[mo.month === 1 ? 12 : mo.month - 1] || 'the previous month');
  if(!prev || !Object.keys(prev).length){
    meCardStatus('Nothing to carry forward — ' + prevName + ' has no card details. Enter the counts and press Save.', 'warn');
    return false;
  }

  // This month already has figures of its own, and they are about to be
  // replaced by last month's. Nothing here is undoable, so ask first.
  if(meCardHasCounts(mo.key)){
    var moLabel = (ME_MONTH_NAMES[mo.month] || '') + ' ' + mo.year;
    if(!confirm('Replace the card details already entered for ' + moLabel +
                ' with ' + prevName + '’s?\n\nThis cannot be undone.')){
      meCardStatus('No Change cancelled — ' + moLabel + '’s own counts are unchanged.', 'info');
      return false;
    }
  }

  delete meCardCarry[mo.key];
  meCardStore[mo.key] = {};
  Object.keys(prev).forEach(function(id){
    meCardStore[mo.key][id] = {count: parseInt(prev[id].count) || 0};
  });
  meCardConfirmed[mo.key] = true;
  buildMeCardTable();
  meCardStatus('✓ Copied ' + prevName + '’s card details into ' + (ME_MONTH_NAMES[mo.month] || '') + ' ' + mo.year + '.', 'ok');
  return true;
}

// "Save": confirm whatever is on screen as this month's figures. They become
// next month's carried-forward defaults by virtue of being this month's.
function meCardSave(){
  var mo = meMoKey();
  if(!mo){ alert('Select a CRS shop, month and year first.'); return false; }

  // Saving an untouched carried month adopts what is on screen.
  meCardCommitCarry(mo.key);

  if(!meCardHasCounts(mo.key)){
    meCardStatus('⚠ Enter at least one card count before saving.', 'warn');
    var first = document.querySelector('#me-card-tbody input[data-card-field="count"]');
    if(first) first.focus();
    return false;
  }

  meCardConfirmed[mo.key] = true;
  var moName = ME_MONTH_NAMES[mo.month] || '';
  var total  = 0;
  var d = meCardStore[mo.key] || {};
  Object.keys(d).forEach(function(id){ total += parseInt(d[id].count) || 0; });

  var allotN = meAllotHasValues(mo.key)
    ? Object.keys(meAllotStore[mo.key]).filter(function(i){ return (parseFloat(meAllotStore[mo.key][i])||0) > 0; }).length
    : 0;
  meCardStatus('✓ Saved for ' + moName + ' ' + mo.year + ' — ' + total + ' cards' +
    (allotN ? ', ' + allotN + ' commodities allotted.' : '. Allotment is still empty.'),
    allotN ? 'ok' : 'warn');
  return true;
}

// ── MONTHLY CLOSE GATE ──────────────────────────────────────────────────────
// What the close needs, in the order it is worth telling someone about.
function meMonthlyClosingBlocker(crsId, month, year){
  var key = crsId + '_' + month + '_' + year;
  if(!meCardHasCounts(key))      return 'Card Details have not been entered.';
  if(!meCardConfirmed[key])      return 'Card Details have not been saved — press Save (or No Change) on Monthly Entry.';
  if(!meAllotHasValues(key))     return 'Allotment has not been entered for this month.';
  return null;
}

// "மாத விற்பனை நிறைவு" also has to see the month's card details and allotment.
// It runs from Daily Entry, so the message names the screen to go to.
var _allotOrigMarkSalesClose = markSalesClose;
markSalesClose = function(){
  var crsEl = document.getElementById('entry-crs');
  var dtEl  = document.getElementById('entry-date');
  if(crsEl && dtEl && crsEl.value && dtEl.value){
    var p = dtEl.value.split('-');
    var why = meMonthlyClosingBlocker(crsEl.value, parseInt(p[1], 10), parseInt(p[0], 10));
    if(why){
      alert('Monthly close is not ready.\n\n' + why +
            '\n\nOpen Monthly Entry → Card Details & Allotment for CRS ' + crsEl.value +
            ', ' + (ME_MONTH_NAMES[parseInt(p[1],10)] || '') + ' ' + p[0] + ' and complete it first.');
      return false;
    }
  }
  return _allotOrigMarkSalesClose.apply(this, arguments);
};

// ── STATEMENT INTEGRATION ───────────────────────────────────────────────────
// The month's allotment rides along on the statement data object. `receiptQty`
// is replaced rather than added to because CRS PAGE1's allotment block is its
// only caller in the whole engine — so this redirects exactly that block, with
// no copy of the builder, and falls back to the ported receipt figures for any
// month where no allotment was entered.
var _allotOrigStmtGetData = stmtGetData;
stmtGetData = function(crsId, month, year){
  var d = _allotOrigStmtGetData.apply(this, arguments);
  try{
    var key = crsId + '_' + month + '_' + year;
    // Only the commodities the allotment covers — a leftover value for one it
    // no longer asks for must not reach the statement.
    var raw = meAllotStore[key] || {};
    var ids = meAllotIdSet();
    var allot = {};
    Object.keys(raw).forEach(function(id){ if(ids[id]) allot[id] = raw[id]; });
    var has = meAllotHasValues(key);
    d.allot        = allot;
    d.allotHasData = has;
    d.allotQty     = function(id){ return parseFloat(allot[id]) || 0; };
    d.receiptQtyRaw = d.receiptQty;
    d.receiptQty = function(id){
      if(has) return parseFloat(allot[id]) || 0;
      return d.receiptQtyRaw(id);
    };
  }catch(e){}
  return d;
};

// The COLL statement is built in 24-coll.js, which gives each of its columns
// its own source (allotment here, the Daily Entry receipt net of any advance
// load, then the inspection adjustments). It reads d.allotQty, set above.

// ── PERSISTENCE ─────────────────────────────────────────────────────────────
// Join the backup registry so a month's allotment travels with everything else.
if(typeof BACKUP_STORES !== 'undefined'){
  BACKUP_STORES.push({key:'meAllotStore',    kind:'object', label:'Allotment'});
  BACKUP_STORES.push({key:'meCardConfirmed', kind:'object', label:'Card Details saved-flag'});
}

// The demo seeder fills every other module, so it fills these too — otherwise
// a seeded month could not be closed. Wrapped at sdSeedAllModules rather than
// at meLoadSampleData because BOTH sample-data buttons (Monthly Entry and
// Statements) come through here, and only one of them goes via meLoadSampleData.
if(typeof sdSeedAllModules === 'function'){
  var _allotOrigSeedAll = sdSeedAllModules;
  sdSeedAllModules = function(crsId, month, year){
    var r = _allotOrigSeedAll.apply(this, arguments);
    try{
      var key = parseInt(crsId, 10) + '_' + parseInt(month, 10) + '_' + parseInt(year, 10);
      meAllotStore[key] = {};
      meAllotItems().forEach(function(it){
        var recv = (typeof monthlyStore !== 'undefined' && monthlyStore[key])
          ? ((monthlyStore[key][it.sec] || {})[it.c.id] || {}).receipt
          : 0;
        var v = parseFloat(recv) || 0;
        if(v > 0) meAllotStore[key][it.c.id] = v;
      });
      meCardConfirmed[key] = true;
      delete meCardCarry[key];
      if(document.getElementById('me-card-tbody')) buildMeCardTable();
    }catch(e){}
    return r;
  };
}

// Clearing a month has to clear these too. Without it a wiped month keeps a
// live allotment — which is what decides whether the statement reads allotment
// at all — and a stale "saved" flag that would let the monthly close pass.
if(typeof sdClearAllModules === 'function'){
  var _allotOrigClearAll = sdClearAllModules;
  sdClearAllModules = function(crsId, month, year){
    var r = _allotOrigClearAll.apply(this, arguments);
    try{
      var key = parseInt(crsId, 10) + '_' + parseInt(month, 10) + '_' + parseInt(year, 10);
      delete meAllotStore[key];
      delete meCardConfirmed[key];
      delete meCardCarry[key];
      if(document.getElementById('me-card-tbody')) buildMeCardTable();
    }catch(e){}
    return r;
  };
}

// A backup written before this feature has no allotment in it. The ported
// importer skips keys a file does not carry, which for every other store means
// "unchanged" — but here it would leave the previous session's allotment
// standing over freshly restored card data. Restoring is meant to reproduce the
// file, so clear them instead.
if(typeof applyBackup === 'function'){
  var _allotOrigApplyBackup = applyBackup;
  applyBackup = function(payload, sourceName){
    var before = JSON.stringify(meAllotStore) + '|' + JSON.stringify(meCardConfirmed);
    var r = _allotOrigApplyBackup.apply(this, arguments);
    try{
      var data = (payload && payload.data) || {};
      var unchanged = (JSON.stringify(meAllotStore) + '|' + JSON.stringify(meCardConfirmed)) === before;
      // Only when the importer actually ran and the file predates these stores.
      if(unchanged && data.meCardStore !== undefined && data.meAllotStore === undefined){
        meAllotStore = {};
        meCardConfirmed = {};
        meCardCarry = {};
        if(document.getElementById('me-card-tbody')) buildMeCardTable();
      }
    }catch(e){}
    return r;
  };
}
