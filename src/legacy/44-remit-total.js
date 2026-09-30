// ═══════════════════════════════════════════════════════════════════════════
// 44 · The month's REMITTANCE total — one sum, for every sheet that states it
// (office, 2026-09-30).
//
// CRS Page 2's "Remittance Amount" added up the Monthly Remittance table's
// hand-keyed rows only, and when those came to nothing it printed the sheet's
// own TOTAL in their place. A shop keyed by day keeps its deposits on the day
// sheets, so its hand-keyed rows are empty: CRS 8, September 2026, printed
// Remittance Amount 55061.30 (= Sales 54803.00 + C.Box 100.80 + P.Gunny
// 157.50) while its Remittance sheet — the deposits themselves — totals 55095.
//
// Every statement that states the month's remittance reads it here: CRS Page 2
// (Remittance Amount), Cost Com and Sale Tax (EXCESS / NET TOTAL) and CRS 29's
// Page 2 — one figure, so no two sheets can disagree (office, 2026-09-30).
//
// stmtRemitTotal(d) is the Remittance sheet's own TOTAL (buildRemittance in
// 12-statement-builders.js), worked out the same way, day by day:
//   · the Monthly Remittance row's Non-Cereal + Cereal for that sales date;
//   · else, when the date has a Daily Entry deposit, that deposit
//     (d.remitByDay[day].amount — the day sheet's remitAmount, every deposit
//     on the date);
//   · plus the three extra rows (Poly & C.Box, Inspection Charges, the spare).
// buildRemittance itself is untouched; tools/verify-remit-total.mjs holds the
// two equal for every shop.
// ═══════════════════════════════════════════════════════════════════════════
function stmtRemitTotal(d){
  var days = new Date(d.year, d.month, 0).getDate();
  var moKey = d.crsId + '_' + d.month + '_' + d.year;
  var store = (typeof meRemitStore !== 'undefined' && meRemitStore[moKey]) ? meRemitStore[moKey] : {};
  var sum = 0;
  for (var day = 1; day <= days; day++) {
    var rec = store[day] || {};
    var dayRec = (d.remitByDay && d.remitByDay[day]) ? d.remitByDay[day] : null;
    var nc = parseFloat(rec.nonCereal) || 0, ce = parseFloat(rec.cereal) || 0;
    if (dayRec && dayRec.src === 'daily' && !nc && !ce) nc = dayRec.amount || 0;
    sum += nc + ce;
  }
  var ex = store['extra'] || {};
  ['e1', 'e2', 'e3'].forEach(function(e){ sum += (parseFloat(ex[e + 'nc']) || 0) + (parseFloat(ex[e + 'ce']) || 0); });
  return sum;
}

// ═══════════════════════════════════════════════════════════════════════════
// The month's RECONCILIATION — what should have been banked, against what was
// (office, 2026-09-30). One calculation; CRS Page 2 (TOTAL / EXCESS), Cost Com
// and Sale Tax (EXCESS) print it, and /api/statements/reconcile hands it to the
// Statements page and Monthly Remittance for the mismatch popup.
//
//   Expected = POS sales            (every priced commodity on Page 2 but tea / salt)
//            + TEA / SALT           (OOTY, TAN, SALT CIS, SALT RFFS — keyed by hand, not on the POS)
//            + Police               (Section B, as Page 2's POLICE row)
//            + C.Box / Poly         (Empty Card+Box / Empty Polythene Bag sold on the grid;
//                                    when none is keyed there, the Monthly Remittance
//                                    "Poly Gunny & C.Box" row — the office's decision)
//   Remittance = stmtRemitTotal(d)  (the actual deposits)
//   Excess     = Remittance − Expected   (negative = a shortfall; never forced to 0)
//
// Every amount is sales × the saved Commodity Master rate (stmtPriced), the
// same pricing the Daily Sale sheet uses; CRS Page 2's TOTAL is Expected, so
// TOTAL, the Daily Sale footer and the reconciliation cannot differ.
// `days` gives each day sheet's sales amount beside what was banked for that
// sales date, for the popup's "why". CRS 29 has its own sheets: null.
// ═══════════════════════════════════════════════════════════════════════════
// ── Pricing: sales × the SAVED Commodity Master rate (office, 2026-09-30) ──
// The rate is the one the office keeps on the Commodities screen
// (__commodityMaster, handed in as ctx.commodityMaster), so a rate change
// follows on its own; a commodity the master does not price keeps the
// engine's compiled rate. Which commodities are free stays the engine's (as
// in the DSS). Used by the Daily Sale sheet and the reconciliation — NOT by
// the other builders' own RATE / AMOUNT columns, which are unchanged.
// Live, 2026-09-30: all 2,131 stored day-sheet amounts equal sales × this rate.
var STMT_PACK_IDS = { EMPTY_BOX: 1, EMPTY_BAG: 1 };
var __stmtRateMap = null;
function stmtRateOf(id){
  if (!__stmtRateMap) {
    __stmtRateMap = {};
    var m = (typeof STMT_COMMODITY_MASTER !== 'undefined' && STMT_COMMODITY_MASTER) || [];
    var list = Array.isArray(m) ? m : Object.keys(m).map(function(k){ return m[k]; });
    list.forEach(function(row){
      if (!row || !row.id || row.rate === undefined || row.rate === null || row.rate === '') return;
      var v = parseFloat(row.rate);
      if (isFinite(v)) __stmtRateMap[row.id] = v;
    });
  }
  var c = (DSS_A || []).concat(DSS_B || []).find(function(x){ return x.id === id; });
  if (!c || c.free) return 0;
  return Object.prototype.hasOwnProperty.call(__stmtRateMap, id) ? __stmtRateMap[id] : (c.rate || 0);
}
function stmtPriced(id, sales){ return (parseFloat(sales) || 0) * stmtRateOf(id); }
/** Police (Section B) sales for the month, priced. */
function stmtPoliceAmount(d){
  return (DSS_B || []).reduce(function(s, c){ return s + stmtPriced(c.id, d.getVal(c.id, 'sales')); }, 0);
}
/** C.Box / Poly: sold on the grid, else the Monthly Remittance "Poly Gunny & C.Box" row. */
function stmtPackAmount(d){
  var grid = stmtPriced('EMPTY_BOX', d.getVal('EMPTY_BOX', 'sales')) + stmtPriced('EMPTY_BAG', d.getVal('EMPTY_BAG', 'sales'));
  var moKey = d.crsId + '_' + d.month + '_' + d.year;
  var ex = (typeof meRemitStore !== 'undefined' && meRemitStore[moKey] && meRemitStore[moKey]['extra']) ? meRemitStore[moKey]['extra'] : {};
  var remit = (parseFloat(ex.e1nc) || 0) + (parseFloat(ex.e1ce) || 0);
  return { grid: grid, remit: remit, pack: grid > 0 ? grid : remit, source: grid > 0 ? 'grid' : remit > 0 ? 'remittance' : 'none' };
}

var STMT_TEA_SALT = { OOTY: 'OOTY (tea)', TAN: 'TAN (tea)', SALT_CIS: 'Salt (CIS)', SALT_RFFS: 'Salt (RFFS)' };
var STMT_PAGE2_IDS = ['BRA','AAY','RRA','SUGAR','AAY_SUGAR','WHEAT','TOOR','PALM','OOTY','TAN','SALT_CIS','SALT_RFFS','OAP','APS','PHH_BRA','PHH_FRK','AAY_FRK','NPHH_FRK','NPHH_RRA'];
function stmtReconcile(d){
  if (typeof isCrs29 === 'function' && isCrs29(d.crsId)) return null;
  var r2 = function(x){ return Math.round((Number(x) || 0) * 100) / 100; };
  var commOf = function(id){ return (DSS_A || []).find(function(x){ return x.id === id; }) || { rate: 0, free: true }; };
  var pos = 0, manual = 0, posItems = [], manualItems = [];
  STMT_PAGE2_IDS.forEach(function(id){
    var c = commOf(id);
    if (c.free) return;
    var a = stmtPriced(id, d.getVal(id, 'sales'));
    if (!a) return;
    if (STMT_TEA_SALT[id]) { manual += a; manualItems.push({ id: id, label: STMT_TEA_SALT[id], amount: r2(a) }); }
    else { pos += a; posItems.push({ id: id, label: c.en || id, amount: r2(a) }); }
  });
  var police = stmtPoliceAmount(d);
  var pk = stmtPackAmount(d);
  var moKey = d.crsId + '_' + d.month + '_' + d.year;
  var packGrid = pk.grid, packRemit = pk.remit, pack = pk.pack;
  var expected = pos + manual + police + pack;
  var remit = stmtRemitTotal(d);
  // Day by day: a sheet's own sales amount beside what was banked for that sales date.
  var days = [], hand = (typeof meRemitStore !== 'undefined' && meRemitStore[moKey]) ? meRemitStore[moKey] : {};
  var nDays = new Date(d.year, d.month, 0).getDate();
  for (var day = 1; day <= nDays; day++) {
    var iso = d.year + '-' + String(d.month).padStart(2, '0') + '-' + String(day).padStart(2, '0');
    var sh = (typeof entryStore !== 'undefined') ? entryStore[d.crsId + '_' + iso] : null;
    if (!sh || sh.__projection) continue;
    var sold = 0;
    ['a', 'b'].forEach(function(sec){ Object.keys(sh[sec] || {}).forEach(function(id){ sold += Number((sh[sec][id] || {}).amount) || 0; }); });
    var rec = hand[day] || {}, dayRec = d.remitByDay ? d.remitByDay[day] : null;
    var nc = parseFloat(rec.nonCereal) || 0, ce = parseFloat(rec.cereal) || 0;
    if (dayRec && dayRec.src === 'daily' && !nc && !ce) nc = dayRec.amount || 0;
    days.push({ date: iso, sales: r2(sold), remit: r2(nc + ce) });
  }
  return {
    crsId: d.crsId, month: d.month, year: d.year,
    pos: r2(pos), manual: r2(manual), police: r2(police), pack: r2(pack),
    packSource: packGrid > 0 ? 'grid' : packRemit > 0 ? 'remittance' : 'none',
    packGrid: r2(packGrid), packRemit: r2(packRemit),
    posItems: posItems, manualItems: manualItems,
    expected: r2(expected), expectedRaw: expected,
    remit: r2(remit), excess: r2(remit - expected),
    days: days
  };
}
