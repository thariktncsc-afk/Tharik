// ── CRS 29 · C RICE — the day's keyed Free Rice and Cost Rice ────────────────
// Daily Entry for CRS 29 asks for two figures the commodity grid cannot give:
// the kilos of rice issued free and the kilos sold at cost. They are saved on
// the day sheet as `freeRice` and `costRice` (src/lib/engine/crs29Rice.ts) —
// for a month keyed by month, on the last-day sheet its month-close writes.
//
// This sheet is where the camp's format has room for them: FREE RICE (KG'S)
// TOTAL takes Free Rice, COST RICE BRA takes Cost Rice, and TOTAL RICE is the
// two together. RBA and BRA stay the day's R.R.A and B.RICE sales, as before,
// and the TOTAL row sums the days — that is the month's figure.
//
// Replaces c29CRice from 26-crs29.js. The files are one concatenated scope, so
// this later declaration is the function CRS29_BUILDERS.c_rice calls. A day
// whose sheet carries neither figure — every day with no sheet, and every
// sheet saved before the fields existed — prints exactly what 26-crs29.js
// printed, and the golden snapshots hold that byte for byte.
function c29KeyedRice(rec){
  if(!rec) return null;
  var f = rec.freeRice, c = rec.costRice;
  if(typeof f !== 'number' || typeof c !== 'number' || !isFinite(f) || !isFinite(c) || f < 0 || c < 0) return null;
  return {free:f, cost:c};
}

function c29CRice(d){
  var tot = {rba:0, bra:0, sum:0, cost:0, all:0};
  var rows = c29DayRows(d).map(function(x, i){
    var rba   = c29DaySales(x.entry, 'RRA');
    var bra   = c29DaySales(x.entry, 'BRA');
    var keyed = c29KeyedRice(x.entry);
    var free  = keyed ? keyed.free : rba + bra;
    var cost  = keyed ? keyed.cost : c29DaySales(x.entry, 'PHH_BRA') + c29DaySales(x.entry, 'OAP');
    tot.rba += rba; tot.bra += bra; tot.sum += free; tot.cost += cost; tot.all += free + cost;
    return '<tr><td>' + (i+1) + '</td><td>' + x.date.split('-').reverse().join('/') + '</td>' +
      '<td>' + c29n(rba) + '</td><td>' + c29n(bra) + '</td><td>' + c29n(free) + '</td>' +
      '<td>' + c29n(cost) + '</td><td>' + c29n(free + cost) + '</td><td></td><td></td></tr>';
  }).join('');
  return c29page(
    c29head(d, 'RICE SALES REPORT') +
    '<table class="c29-tbl"><thead>' +
      '<tr><th rowspan="2" style="width:5%">SL NO</th><th rowspan="2" style="width:12%">DATE OF SALES</th>' +
        '<th colspan="3">FREE RICE (KG’S)</th><th rowspan="2">COST RICE BRA</th>' +
        '<th rowspan="2">TOTAL RICE</th><th rowspan="2">SALES PER KG’S</th><th rowspan="2">TOTAL SALE AMOUNT</th></tr>' +
      '<tr><th>RBA</th><th>BRA</th><th>TOTAL</th></tr>' +
    '</thead><tbody>' + rows +
      '<tr class="sub"><td></td><td>TOTAL</td><td>' + c29n(tot.rba) + '</td><td>' + c29n(tot.bra) +
      '</td><td>' + c29n(tot.sum) + '</td><td>' + c29n(tot.cost) + '</td><td>' + c29n(tot.all) +
      '</td><td>0</td><td>0</td></tr>' +
    '</tbody></table>' + c29sign(d));
}
