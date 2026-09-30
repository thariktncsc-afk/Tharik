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
