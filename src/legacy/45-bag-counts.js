// ════════════════════════════════════════════════════════════════════════════
// 45-bag-counts.js — a commodity's BAG counts on a statement are the ones
// Monthly Sales shows (office, 2026-09-30).
//
// CRS 19 September: Palm Oil's Opening bags were saved as 53 on Monthly Sales
// (stored, published, shown again after navigating away) while CRS Page 2
// printed 52 — Page 2's bags() divided the kgs every time (525 ÷ 10) and never
// read a saved count; Wheat 40 / Toor Dal 11 / AAY Sugar 1 printed 39 / 10 / 0
// the same way. Free Com, Cost Com and B6 did read the stored Opening /
// Receipt / Sales counts but took Total and Closing from stored copies
// (kgs Total ÷ pack), not the grid's Opening + Receipt and Total − Sales.
//
// stmtBagCounts(d, id) is Monthly Entry's rowFor(), bag for bag:
//   Opening / Receipt / Sales — a count typed on a FROM-DAILY row
//     (meManualStore[key].dailyBags, a typed 0 included); else a stored count
//     above 0 that differs from kgs ÷ pack size (the office's own figure);
//     else kgs ÷ pack size (bagsOf);
//   Total   = Opening + Receipt
//   Closing = Total − Sales − C.S bags
// The OPENING carries from last month's Closing bags (office, 2026-10-01;
// src/lib/engine/bagChain.ts): the server works it out with the rule Monthly
// Sales uses and hands it in as STMT_BAG_OPENING; where it says nothing (the
// shop's first month, a row that carries nothing, no server) the rule above.
// Every statement that prints a commodity's bags reads it, so the sheet and
// the screen cannot disagree. The kgs are untouched.
// ════════════════════════════════════════════════════════════════════════════

function stmtBagCounts(d, id){
  // A kgs-only commodity (46-shop-commodities.js) has no bags: 0, so it adds none to a total.
  if (typeof stmtKgsOnly === 'function' && stmtKgsOnly(id)) return { open: 0, receipt: 0, total: 0, sales: 0, close: 0 };
  var sec = (typeof DSS_B !== 'undefined' && (DSS_B || []).some(function(c){ return c.id === id; })) ? 'b' : 'a';
  var manual = (typeof meManualStore !== 'undefined' && meManualStore && d && d.key) ? (meManualStore[d.key] || {}) : {};
  var typed = (manual.dailyBags && manual.dailyBags[sec] && manual.dailyBags[sec][id]) || {};
  function one(f){
    var t = typed['g_' + f];
    if (typeof t === 'number' && isFinite(t)) return t;
    var auto = bagsOf(d.getVal(id, f), id);
    var stored = Math.round(parseFloat(d.getVal(id, 'g_' + f)) || 0);
    return stored > 0 && stored !== auto ? stored : auto;
  }
  var carried = (typeof STMT_BAG_OPENING === 'function' && STMT_BAG_OPENING && d && d.key) ? STMT_BAG_OPENING(d.key, sec, id) : null;
  var open = (typeof carried === 'number' && isFinite(carried)) ? carried : one('open'), receipt = one('receipt'), sales = one('sales');
  var cs = Math.round(parseFloat(d.getVal(id, 'g_cs')) || 0);
  var total = open + receipt;
  return { open: open, receipt: receipt, total: total, sales: sales, close: total - sales - cs };
}
