/* Dashboard Closing Stock card — full commodity table  [+]
   Added after the port; not part of TNCSC_CRS_Demo_19 (1).html, so
   tools/verify-parity.mjs skips this file (see NEW_ENGINE there).

   Replaces the ported buildClosingList() from 08-dashboard.js. This file is
   concatenated after it by tools/bundle-engine.mjs, and in one classic script
   the last function declaration with a given name wins, so every existing call
   site (refreshDashboard, backupRefreshUI) lands here without a single edit to
   the ported code. The card's markup shell in pageDashboard.ts is untouched
   for the same reason — everything below renders into #dash-closing-list.

   What changed against the ported version:
     • The card never says "No entry data yet" — with no entry every commodity
       renders at 0.000, so the table always looks complete.
     • The stock source is the LATEST saved Daily Entry on or before the
       dashboard's selected date, found by scanning entryStore keys directly —
       the ported day-loop only looked inside the current month, so a month
       with no entries yet went blank instead of carrying the last real stock.
     • Proper table: zebra rows, names left / values right, sticky header,
       a section divider before the Police Ration block, amber highlight on
       out-of-stock rows, and a Total / In Stock / Out of Stock summary.
     • The card is widened at runtime (wrapper grid 2fr 1fr → 3fr 2fr) to
       balance against the Current Month Sales card. Done from here, not in
       the ported markup; the ≤900px responsive override still wins on top. */

// ── STOCK SOURCE ────────────────────────────────────────────────────────────
// Latest saved entry for this CRS on or before `uptoStr` (YYYY-MM-DD). ISO
// date strings compare correctly as strings, so this is a plain max-scan.
// The `crsId_` prefix match is exact: scope '1_' cannot match a '10_...' key.
function dashLatestEntryKey(crsId, uptoStr){
  var scope = String(crsId || '1') + '_';
  var latestKey = null, latestDate = '';
  Object.keys(typeof entryStore !== 'undefined' ? entryStore : {}).forEach(function(k){
    if(k.indexOf(scope) !== 0) return;
    var dt = k.slice(scope.length);
    if(dt <= uptoStr && dt > latestDate){ latestDate = dt; latestKey = k; }
  });
  return latestKey;
}

// ── CARD RENDER ─────────────────────────────────────────────────────────────
function buildClosingList(crsId, yr, mo, toDay){
  var listEl  = document.getElementById('dash-closing-list');
  var dateLbl = document.getElementById('dash-closing-date-label');
  if(!listEl) return;

  // Balance the two cards: the ported wrapper is 2fr 1fr. The left card's
  // chart hard-floors at 560px content (+36px padding +2px borders), and a
  // bare 3fr 2fr pushed it below that on ~1200px laptops — clipping today's
  // bar, the chart's whole point. minmax keeps the chart whole and lets only
  // this card give way. Idempotent, and the responsive layer's !important
  // auto-fit still takes over below 900px.
  var card = listEl.parentElement, wrap = card && card.parentElement;
  if(wrap && wrap.style && wrap.style.display === 'grid'){
    wrap.style.gridTemplateColumns = 'minmax(598px,3fr) minmax(0,2fr)';
  }
  // The scroll area is managed inside the card now, so the summary stays pinned.
  listEl.style.maxHeight = 'none';
  listEl.style.overflowY = 'visible';

  var selD = dashSelectedDate || new Date();
  var uptoStr = selD.getFullYear() + '-' + String(selD.getMonth()+1).padStart(2,'0') +
                '-' + String(selD.getDate()).padStart(2,'0');
  var latestKey = dashLatestEntryKey(crsId, uptoStr);
  var entry = latestKey ? entryStore[latestKey] : null;

  if(dateLbl){
    // The null branch must stay date-relative: latestKey === null only means
    // "nothing on or before the selected date" — entries may exist after it,
    // so claiming the store is empty would misread as lost data.
    dateLbl.textContent = latestKey
      ? 'Latest stock — as of ' + latestKey.split('_')[1].split('-').reverse().join('/')
      : 'No entry on or before ' + uptoStr.split('-').reverse().join('/') + ' — values default to 0';
  }

  var secA = (typeof DSS_A !== 'undefined') ? DSS_A : [];
  var secB = (typeof DSS_B !== 'undefined') ? DSS_B : [];

  var total = 0, inStock = 0, outStock = 0;
  var td = 'padding:6px 10px;border-bottom:1px solid #F1F5F9;';

  function rowsFor(comms){
    var html = '';
    comms.forEach(function(c, i){
      var data = entry ? ((entry.a && entry.a[c.id]) || (entry.b && entry.b[c.id])) : null;
      var closing = data ? (parseFloat(data.close) || 0) : 0;
      total++;
      var out = closing <= 0;
      if(out) outStock++; else inStock++;

      var bg  = out ? '#FFFBEB' : (i % 2 === 0 ? '#fff' : '#F8FAFC');
      var col = closing < 0 ? '#DC2626' : (out ? '#B45309' : '#0369A1');

      html += '<tr style="background:' + bg + '">' +
        '<td style="' + td + 'text-align:left">' +
          '<span style="font-weight:600;font-size:11.5px;color:#1E293B">' + c.ta + '</span>' +
          '<span style="font-size:10px;color:var(--muted);margin-left:6px">' + c.en + '</span>' +
        '</td>' +
        '<td style="' + td + 'text-align:right;white-space:nowrap;font-weight:' + (out ? '600' : '800') + ';color:' + col + ';font-size:12px">' +
          closing.toFixed(3) + ' <span style="font-size:9px;font-weight:400;color:var(--muted)">' + c.unit + '</span>' +
        '</td></tr>';
    });
    return html;
  }

  var th = 'position:sticky;top:0;background:#fff;z-index:1;padding:7px 10px;font-size:10px;' +
           'font-weight:700;color:#94A3B8;text-transform:uppercase;letter-spacing:.05em;' +
           'border-bottom:2px solid #E2E8F0;';
  var divider = '<tr><td colspan="2" style="padding:7px 10px 4px;font-size:9.5px;font-weight:800;' +
      'color:#7C3AED;text-transform:uppercase;letter-spacing:.07em;background:#FAF5FF;' +
      'border-bottom:1px solid #EDE9FE">காவலர் — Police Ration</td></tr>';

  var table =
    '<div style="max-height:430px;overflow-y:auto;border:1px solid #F1F5F9;border-radius:10px">' +
      '<table style="width:100%;border-collapse:collapse">' +
        '<thead><tr>' +
          '<th style="' + th + 'text-align:left">Commodity</th>' +
          '<th style="' + th + 'text-align:right">Closing Stock</th>' +
        '</tr></thead>' +
        '<tbody>' + rowsFor(secA) + (secB.length ? divider + rowsFor(secB) : '') + '</tbody>' +
      '</table>' +
    '</div>';

  function tile(label, val, color, bg){
    return '<div style="flex:1;background:' + bg + ';border-radius:9px;padding:7px 10px;text-align:center">' +
      '<div style="font-size:16px;font-weight:900;color:' + color + ';line-height:1.2">' + val + '</div>' +
      '<div style="font-size:9px;font-weight:700;color:var(--muted);text-transform:uppercase;letter-spacing:.04em">' + label + '</div>' +
    '</div>';
  }
  var summary =
    '<div style="display:flex;gap:8px;margin-top:10px">' +
      tile('Total Commodities', total,   '#1E293B', '#F1F5F9') +
      tile('In Stock',          inStock, '#15803D', '#F0FDF4') +
      tile('Out of Stock',      outStock,'#B45309', '#FFFBEB') +
    '</div>';

  listEl.innerHTML = table + summary;
}

// ── AUTO-REFRESH HOOKS ──────────────────────────────────────────────────────
// Both wrapped here rather than edited in place, so the ported files stay
// byte-identical. This file is last in the bundle, so the originals exist.

function dashDateStr(d){
  return d.getFullYear() + '-' + String(d.getMonth()+1).padStart(2,'0') +
         '-' + String(d.getDate()).padStart(2,'0');
}

// A saved Daily Entry repaints the stock card immediately (rule: the card
// always reflects the latest saved records, not the last visit). If the saved
// day is NEWER than the dashboard's selected date, the selection advances to
// it first — otherwise the stock scan is capped at the stale date and the
// entry that was just saved stays invisible (the memory-only design keeps
// tabs open across midnight, so dashSelectedDate routinely lags real time).
var _stockOrigSaveEntryForm = saveEntryForm;
saveEntryForm = function(){
  var r = _stockOrigSaveEntryForm.apply(this, arguments);
  try{
    var dEl = document.getElementById('entry-date');
    var saved = dEl && dEl.value;
    if(saved && (!dashSelectedDate || saved > dashDateStr(dashSelectedDate))){
      var p = saved.split('-');
      dashSelectedDate = new Date(parseInt(p[0]), parseInt(p[1])-1, parseInt(p[2]));
      var picker = document.getElementById('dash-date-picker');
      if(picker) picker.value = saved;
    }
    if(typeof refreshDashboard === 'function' && currentUser) refreshDashboard();
  }catch(e){}
  return r;
};

// Each login starts the dashboard at the REAL today. Without this the picker
// and dashSelectedDate survive from the previous user or the day the tab was
// opened (buildDashboard only fills an empty picker, doLogout resets neither),
// silently capping the next user's "Latest stock" at someone else's date.
var _stockOrigEnterApp = enterApp;
enterApp = function(){
  try{
    dashSelectedDate = new Date();
    var todayStr = dashDateStr(dashSelectedDate);
    var picker = document.getElementById('dash-date-picker');
    if(picker){ picker.value = todayStr; picker.max = todayStr; }
    var lbl = document.getElementById('dash-selected-date-label');
    if(lbl) lbl.textContent = 'Today';
  }catch(e){}
  return _stockOrigEnterApp.apply(this, arguments);
};

// Opening the Dashboard page rebuilds it, so it never shows a stale card
// after entries were edited on other screens (inspection, backup restore...).
var _stockOrigShowPage = showPage;
showPage = function(id, el){
  var r = _stockOrigShowPage(id, el);
  try{
    if(id === 'dashboard' && typeof refreshDashboard === 'function' &&
       typeof currentUser !== 'undefined' && currentUser){
      refreshDashboard();
    }
  }catch(e){}
  return r;
};
