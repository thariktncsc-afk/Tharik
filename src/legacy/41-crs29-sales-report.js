// ── CRS 29 · SALES REPORT — the office's own date-wise sheet ─────────────────
// Reproduces "CRS 29-REFUGEE CAMP AUG'26 - SALES REPORT.pdf", the format the
// office files (a Google Sheets export, A4 portrait): three title lines, one
// row per day of the month, and a TOTAL row. No signature block — the sheet
// has none.
//
// Replaces c29SalesReport from 26-crs29.js, the layout generated before the
// official sheet was supplied (QTY / SALE AMOUNT / REMITTED / REMITTANCE DATE).
// The files are one concatenated scope, so this later declaration is the
// function CRS29_BUILDERS.sales_report calls.
//
// GEOMETRY is the PDF's, in points, so Print and PDF land where the original
// does. Column rules sit at 90.4 109.1 157.4 201.5 249.2 295.7 343.4 390.5
// 438.2 486.5 541.4 from the left edge of the page; the title block starts
// 121.9 from the top. Header rows are 32 and 19.9 high, day rows 12.1 to the
// 15th and 12.7 after, as the sheet's own rows are. Calibri at 12.56, 10.99,
// 9.42 and 8.63pt; rules 0.6pt. It prints on its own named page, so the
// A3-landscape @page another builder carries cannot reach it.
//
// WHERE EACH FIGURE COMES FROM — the day sheet in entryStore, read the way
// C RICE reads it (a month keyed by month prints on its projected last day):
//   BRA FREE           B.RICE sales — C RICE's BRA column
//   BRA COST           the day's keyed Cost Rice (40-crs29-rice.js)
//   RRA                R.R.A sales
//   SUGAR · T.DHALL · P.OIL · KEROSENE    SUGAR · TOOR · PALM · KERO sales
//   TOTAL SALE AMOUNT  priced sales × CRS29_ROWS rate — the same figure the
//                      old layout printed
// A quantity of zero is left blank, as on the sheet; the amount always prints.
// The sheet has no receipt, remittance, wheat or cylinder column, so none of
// those appears.
//
// Copied from the sheet as printed rather than tidied: the first title line
// reads "TAMIL CIVIL SUPPLIES" without NADU, and the TOTAL row carries the next
// serial number in SL NO.

var C29S_MONTHS = ['JAN','FEB','MAR','APR','MAY','JUN','JUL','AUG','SEP','OCT','NOV','DEC'];

// Widths of the ten columns, in points: SL NO, DATE OF SALES, BRA FREE,
// BRA COST, RRA, SUGAR, T.DHALL, P.OIL, KEROSENE, TOTAL SALE AMOUNT.
var C29S_WIDTHS = [18.7, 48.3, 44.1, 47.7, 46.5, 47.7, 47.1, 47.7, 48.3, 54.9];

// The priced lines, in column order, after BRA and RRA.
var C29S_PRICED = ['SUGAR', 'TOOR', 'PALM', 'KERO'];

var C29S_CSS = [
  '@page c29-sales{size:A4 portrait;margin:121.9pt 53.6pt 36pt 90.4pt}',
  '.c29s{page:c29-sales;width:451pt;margin:0 auto;background:#fff;color:#000;font-family:Calibri,Carlito,Arial,sans-serif;line-height:1}',
  '.c29s table{width:451pt;border-collapse:collapse;table-layout:fixed}',
  '.c29s td{padding:0 2.2pt .3pt;font-size:8.63pt;line-height:1;white-space:nowrap;overflow:hidden;vertical-align:bottom;text-align:right}',
  '.c29s tr.t td{border:0;text-align:center;font-weight:bold;white-space:pre}',
  '.c29s tr.t1 td{height:16.9pt;font-size:12.56pt;padding-bottom:1.55pt}',
  '.c29s tr.t2 td{height:16.2pt;font-size:12.56pt;padding-bottom:1.45pt}',
  '.c29s tr.t3 td{height:15.5pt;font-size:10.99pt;padding-bottom:1.95pt}',
  '.c29s tr.g td{border:.6pt solid #000}',
  '.c29s tr.h1 td{height:32pt;font-size:9.42pt;font-weight:bold;text-align:center;vertical-align:middle;line-height:11.5pt;white-space:normal}',
  '.c29s tr.h1 td.sn{line-height:10.5pt}',
  '.c29s tr.h2 td{height:19.9pt;font-weight:bold;text-align:center}',
  '.c29s tr.s td{height:12.1pt}',
  '.c29s tr.m td{height:12.7pt}',
  '.c29s td.c{text-align:center}',
  '.c29s td.l{text-align:left;padding-left:2.7pt}',
  '.c29s tr.tot td{font-weight:bold}',
  '.c29s tr.tot td.n{font-weight:normal}',
].join('');

// Two decimals, as every figure on the sheet has. Rounded first so a float
// like 17652.499999 still prints 17652.50, and a rounded-away figure is 0.00.
function c29s2(v){
  var r = Math.round((Number(v) || 0) * 100) / 100;
  return (Math.abs(r) < 0.005 ? 0 : r).toFixed(2);
}
function c29sQty(v){ return Math.abs(Number(v) || 0) < 0.005 ? '' : c29s2(v); }
function c29sTd(v, cls){ return '<td' + (cls ? ' class="' + cls + '"' : '') + '>' + v + '</td>'; }

function c29SalesReport(d){
  var days = c29DayRows(d);
  var tot = {free:0, cost:0, rra:0, amount:0};
  C29S_PRICED.forEach(function(id){ tot[id] = 0; });

  var body = days.map(function(x, i){
    var e = x.entry;
    var keyed = c29KeyedRice(e);
    var free = c29DaySales(e, 'BRA');
    var cost = keyed ? keyed.cost : c29DaySales(e, 'PHH_BRA') + c29DaySales(e, 'OAP');
    var rra  = c29DaySales(e, 'RRA');
    var amount = 0;
    CRS29_ROWS.forEach(function(row){ if(row.id && row.rate) amount += c29DaySales(e, row.id) * row.rate; });
    tot.free += free; tot.cost += cost; tot.rra += rra; tot.amount += amount;

    var cells = c29sTd(i + 1) + c29sTd(x.date.split('-').reverse().join('/'), 'l') +
      c29sTd(c29sQty(free), 'c') + c29sTd(c29sQty(cost), 'c') + c29sTd(c29sQty(rra), 'c');
    C29S_PRICED.forEach(function(id){
      var s = c29DaySales(e, id);
      tot[id] += s;
      cells += c29sTd(c29sQty(s));
    });
    return '<tr class="g ' + (i < 15 ? 's' : 'm') + '">' + cells + c29sTd(c29s2(amount)) + '</tr>';
  }).join('');

  var total = '<tr class="g m tot">' + c29sTd(days.length + 1, 'n') + c29sTd('TOTAL', 'c') +
    c29sTd(c29s2(tot.free), 'c') + c29sTd(c29s2(tot.cost), 'c') + c29sTd(c29s2(tot.rra), 'c') +
    C29S_PRICED.map(function(id){ return c29sTd(c29s2(tot[id])); }).join('') +
    c29sTd(c29s2(tot.amount)) + '</tr>';

  var period = C29S_MONTHS[Number(d.month) - 1] + "'" + String(d.year).slice(-2);
  var head =
    '<tr class="t t1"><td colspan="10">TAMIL CIVIL SUPPLIES CORPORATION - MADURAI REGION</td></tr>' +
    '<tr class="t t2"><td colspan="10">CRS-29   REFUGEE CAMP AANAIYUR</td></tr>' +
    '<tr class="t t3"><td colspan="10">SALES REPORT - DATE WISE - ' + period + '</td></tr>' +
    '<tr class="g h1"><td class="sn">SL<br><br>NO</td><td>DATE OF<br>SALES</td><td colspan="2">BRA</td>' +
      '<td>RRA</td><td>SUGAR</td><td>T.DHALL</td><td>P.OIL</td><td>KEROSENE</td><td>TOTAL SALE<br>AMOUNT</td></tr>' +
    '<tr class="g h2"><td></td><td></td><td>FREE</td><td>COST</td><td></td><td></td><td></td><td></td><td></td><td></td></tr>';

  var cols = C29S_WIDTHS.map(function(w){ return '<col style="width:' + w + 'pt">'; }).join('');
  return '<style>' + C29S_CSS + '</style><div class="c29s"><table><colgroup>' + cols + '</colgroup>' +
    head + body + total + '</table></div>';
}

// The Statements card still described the layout this replaces.
CRS29_SECTIONS.forEach(function(s){
  if(s.id === 'sales_report') s.desc = 'Date-wise sales quantity & sale amount';
});
