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
// Every figure is Page 2's own arithmetic (gAmt, the POLICE reduce, sales ×
// rate for the empties), so TOTAL and the reconciliation cannot differ.
// `days` gives each day sheet's sales amount beside what was banked for that
// sales date, for the popup's "why". CRS 29 has its own sheets: null.
// ═══════════════════════════════════════════════════════════════════════════
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
    var a = d.getVal(id, 'amount') || (d.getVal(id, 'sales') * (c.rate || 0));
    if (!a) return;
    if (STMT_TEA_SALT[id]) { manual += a; manualItems.push({ id: id, label: STMT_TEA_SALT[id], amount: r2(a) }); }
    else { pos += a; posItems.push({ id: id, label: c.en || id, amount: r2(a) }); }
  });
  var police = (DSS_B || []).reduce(function(s, c){
    var a = d.getVal(c.id, 'amount'); if (!a && !c.free) a = d.getVal(c.id, 'sales') * (c.rate || 0); return s + (a || 0);
  }, 0);
  var packGrid = d.getVal('EMPTY_BOX', 'sales') * (commOf('EMPTY_BOX').rate || 0) + d.getVal('EMPTY_BAG', 'sales') * (commOf('EMPTY_BAG').rate || 0);
  var moKey = d.crsId + '_' + d.month + '_' + d.year;
  var ex = (typeof meRemitStore !== 'undefined' && meRemitStore[moKey] && meRemitStore[moKey]['extra']) ? meRemitStore[moKey]['extra'] : {};
  var packRemit = (parseFloat(ex.e1nc) || 0) + (parseFloat(ex.e1ce) || 0);
  var pack = packGrid > 0 ? packGrid : packRemit;
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
