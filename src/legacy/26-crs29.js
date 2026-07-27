/* CRS 29 — Refugee Camp statement family  [+]
   Added after the port; not part of TNCSC_CRS_Demo_19 (1).html, so
   tools/verify-parity.mjs skips this file (see NEW_ENGINE there).

   The refugee camp files a different set of statements from every other shop,
   reproduced from "CRS 29-REFUGEE CAMP JUNE'26.xlsx". It is selected purely by
   shop number: pick CRS 29 on the Statements screen and its own section list
   and builders take over; pick anything else and nothing here runs, so CRS 1-28
   and CRS 30 keep the ported formats untouched.

   WHAT MAKES IT DIFFERENT
     · eight commodities and no others — B.RICE, R.R.A, SUGAR, WHEAT, T.DHALL,
       CYL, P.OIL, KEROSENE — against the 21 the standard sheets carry. The
       same eight are all the allotment panel offers for this shop;
     · CRS PAGE1 has no card-details column, only an allotment block;
     · CARD DETAILS counts cards as a single total, not by type;
     · three sheets with no standard equivalent: C RICE, SALES REPORT, INDENT;
     · no COLL, Free Com, Cost Com, CRS Police or RBI.

   CYL AND KEROSENE are on these sheets but are not commodities the application
   tracks (DSS_A/DSS_B have neither), so their stock columns render zero. Their
   ALLOTMENT is keyable, under the ids CYL and KERO, because the allotment is
   stored per shop-month rather than against a commodity record. */

var CRS29_ID = 29;
function isCrs29(crsId){ return parseInt(crsId, 10) === CRS29_ID; }

// The camp's whole commodity list — these eight and nothing else, on every
// sheet and in the allotment. `id` is the application commodity behind the
// line; `null` marks one the app does not track, which renders zero.
// `allotId` is the key the month's allotment is stored under, so the two that
// have no commodity record can still be keyed.
var CRS29_ROWS = [
  {label:'B.RICE',   id:'BRA',   allotId:'BRA',   div:50, rate:0,     unit:'KG',  ta:'புழுங்கல் அரிசி'},
  {label:'R.R.A',    id:'RRA',   allotId:'RRA',   div:50, rate:0,     unit:'KG',  ta:'பச்சை அரிசி'},
  {label:'SUGAR',    id:'SUGAR', allotId:'SUGAR', div:50, rate:25.00, unit:'KG',  ta:'சீனி'},
  {label:'WHEAT',    id:'WHEAT', allotId:'WHEAT', div:50, rate:0,     unit:'KG',  ta:'கோதுமை'},
  {label:'T.DHALL',  id:'TOOR',  allotId:'TOOR',  div:50, rate:30.00, unit:'KG',  ta:'துவரம் பருப்பு'},
  {label:'CYL',      id:null,    allotId:'CYL',   div:50, rate:30.00, unit:'NOS', ta:'சிலிண்டர்'},
  {label:'P.OIL',    id:'PALM',  allotId:'PALM',  div:10, rate:25.00, unit:'LTR', ta:'பாம் ஆயில்'},
  // KERO is the camp's own commodity, added by 27-crs29-entry.js so its stock
  // can be keyed; the statements read it like any other.
  {label:'KEROSENE', id:'KERO',  allotId:'KERO',  div:50, rate:15.60, unit:'LTR', ta:'மண்ணெண்ணெய்'},
];

// The allotment panel on Monthly Entry offers the same seven commodities the
// camp's entry screens carry. CYL is on the printed sheets but is not stocked
// or allotted, so it is not asked for. Returns null for every other shop, which
// leaves the standard list in place.
function crs29AllotItems(mo){
  if(!mo || !isCrs29(mo.crsId)) return null;
  return CRS29_ROWS.filter(function(r){ return r.allotId !== 'CYL'; })
    .map(function(r){
      return {sec:'a', c:{id:r.allotId, en:r.label, ta:r.ta, unit:r.unit}};
    });
}

// ── SHARED HELPERS ──────────────────────────────────────────────────────────
function c29n(v){
  if(v === '' || v == null) return '';
  var n = Number(v);
  if(isNaN(n)) return '';
  return String(+(n.toFixed(3)));
}
function c29money(v){ return String(+(Number(v||0).toFixed(2))); }
function c29bags(kgs, div){
  var v = parseFloat(kgs) || 0;
  return v > 0 ? Math.floor(v / (div || 50)) : 0;
}
// One commodity's month, or zeros for a line the app does not carry.
function c29row(d, row){
  if(!row.id) return {open:0, receipt:0, total:0, sales:0, close:0, tracked:false};
  var open    = d.getVal(row.id, 'open');
  var receipt = d.getVal(row.id, 'receipt');
  var total   = d.hasVal(row.id, 'total') ? d.getVal(row.id, 'total') : open + receipt;
  var sales   = d.getVal(row.id, 'sales');
  var close   = d.hasVal(row.id, 'close') ? d.getVal(row.id, 'close') : total - sales;
  return {open:open, receipt:receipt, total:total, sales:sales, close:close, tracked:true};
}
function c29head(d, title, sub){
  return '<div class="c29-h1">TAMIL NADU CIVIL SUPPLIES CORPORATION</div>' +
         '<div class="c29-h2">' + title + '</div>' +
         '<div class="c29-info"><span>CRS 29 — REFUGEE CAMP</span>' +
         '<span>' + (sub || (d.mo.toUpperCase() + "'" + d.yr)) + '</span></div>';
}
function c29sign(d){
  return '<div class="c29-sign"><span>SIGNATURE OF B.C : ' + (d.bcName || '') + '</span>' +
         '<span>SIGNATURE OF AREA SUPERVISOR</span></div>';
}
var CRS29_CSS = [
  '.c29-wrap{font-family:Calibri,Arial,sans-serif;color:#000;background:#fff;max-width:900px;margin:0 auto;padding:6px}',
  '.c29-h1{text-align:center;font-weight:bold;font-size:14px}',
  '.c29-h2{text-align:center;font-weight:bold;font-size:12px;margin-bottom:4px}',
  '.c29-info{display:flex;justify-content:space-between;font-size:11px;font-weight:bold;margin:4px 2px 6px}',
  '.c29-tbl{width:100%;border-collapse:collapse;font-size:10px;table-layout:fixed}',
  '.c29-tbl th,.c29-tbl td{border:1px solid #000;padding:3px 4px;text-align:center;overflow:hidden}',
  '.c29-tbl th{font-weight:bold;line-height:1.15}',
  '.c29-tbl td.l{text-align:left}',
  '.c29-tbl tr.sub td{font-weight:bold;background:#F5F5F5}',
  '.c29-sign{display:flex;justify-content:space-between;margin-top:16px;font-size:10px;font-weight:bold}',
  '.c29-note{font-size:11px;margin:8px 2px;line-height:1.5}',
].join('');
function c29page(body){ return '<style>' + CRS29_CSS + '</style><div class="c29-wrap">' + body + '</div>'; }

// ── CRS PAGE 1 ──────────────────────────────────────────────────────────────
// No card-details column here: the camp's sheet carries the allotment alone.
function c29CrsPage1(d){
  // One line per commodity the camp carries, from the month's allotment.
  // d.allotQty is filtered to the standard commodity ids, so the two the app
  // has no record for are read from the store directly.
  var raw = (typeof meAllotStore !== 'undefined')
    ? (meAllotStore[d.crsId + '_' + d.month + '_' + d.year] || {}) : {};
  var lines = CRS29_ROWS.map(function(row, i){
    var v = parseFloat(raw[row.allotId]);
    if(isNaN(v)) v = row.id ? d.getVal(row.id, 'receipt') : 0;
    return '<div style="font-size:13px;font-weight:bold;padding:1px 0">' +
      (String(i + 1) + '.' + row.label).padEnd(14, ' ').replace(/ /g, '&nbsp;') +
      ' : ' + c29n(v) + '</div>';
  }).join('');

  return c29page(
    '<div class="c29-h1" style="font-size:17px">TAMIL NADU CIVIL SUPPLIES CORPORATION<br>MADURAI REGION</div>' +
    '<div class="c29-h2" style="font-size:15px">CRS : MONTHLY PROFORMA ACCOUNT</div>' +
    '<div style="height:14px"></div>' +
    '<div style="display:flex;justify-content:space-between;font-size:13px;font-weight:bold">' +
      '<div>NAME OF THE CRS :' + d.crsId + '</div>' +
      '<div>TOTAL NUMBER OF CARDS : ' + d.cards.total + '</div>' +
    '</div>' +
    '<div style="font-size:13px;font-weight:bold">NAME OF THE B.C : ' + (d.bcName || '') + '</div>' +
    '<div style="font-size:13px;font-weight:bold;margin-bottom:8px">MONTH :' + d.mo.toUpperCase() + "'" + d.yr + '</div>' +
    '<div style="border-top:2px solid #000;border-bottom:1px solid #000;text-align:center;font-size:13px;font-weight:bold;padding:3px 0;margin-bottom:4px">ALLOTMENT</div>' +
    lines +
    '<div class="c29-note">NOTE:</div>' +
    '<div class="c29-note">1. The quantity of the commodities sold and the amount realised under each variety should be tallied with the quantity made in the statement I and &lsquo;c&rsquo; register</div>' +
    '<div class="c29-note">2. The total quantity furnished in the statement should be tallied with the closing balance of the stock register</div>' +
    c29sign(d) +
    '<div style="font-size:10px;font-weight:bold;margin-top:6px">MOBILE NO : ' + (d.bcPhone || '') + '</div>' +
    '<div style="font-size:10px;font-weight:bold">T.N.C.S.C MADURAI REGION</div>'
  );
}

// ── CRS PAGE 2 · B6 ─────────────────────────────────────────────────────────
// One bags/kgs grid drives both: PAGE2 adds the rate, amount and C.S columns
// and the sales/remittance reconciliation, B6 is the same table without them.
function c29StockGrid(d, withMoney){
  var money = !!withMoney;
  var head =
    '<thead>' +
      '<tr><th rowspan="2" style="width:4%">SL<br>NO</th><th rowspan="2" style="width:13%">COMMODITY</th>' +
        '<th colspan="2">OPENING<br>BALANCE</th><th colspan="2">RECEIPT</th><th colspan="2">TOTAL</th>' +
        '<th colspan="2">SALES</th>' +
        (money ? '<th rowspan="2">RATE</th><th rowspan="2">AMOUNT</th><th rowspan="2">C.S<br>KGS</th>' : '<th rowspan="2">CS<br>KGS</th>') +
        '<th colspan="2">CLOSING<br>BALANCE</th></tr>' +
      '<tr><th>BAGS</th><th>KGS</th><th>BAGS</th><th>KGS</th><th>BAGS</th><th>KGS</th><th>BAGS</th><th>KGS</th><th>BAGS</th><th>KGS</th></tr>' +
    '</thead>';

  var n = 0, body = '';
  var riceTot = {ob:0, obk:0, rc:0, rck:0, to:0, tok:0, sa:0, sak:0, cb:0, cbk:0};
  var amtTotal = 0;

  CRS29_ROWS.forEach(function(row, i){
    var v = c29row(d, row);
    var cells =
      '<td>' + c29n(c29bags(v.open, row.div))    + '</td><td>' + c29n(v.open)    + '</td>' +
      '<td>' + c29n(c29bags(v.receipt, row.div)) + '</td><td>' + c29n(v.receipt) + '</td>' +
      '<td>' + c29n(c29bags(v.total, row.div))   + '</td><td>' + c29n(v.total)   + '</td>' +
      '<td>' + c29n(c29bags(v.sales, row.div))   + '</td><td>' + c29n(v.sales)   + '</td>';
    var amt = row.rate ? v.sales * row.rate : 0;
    amtTotal += amt;
    if(money){
      cells += '<td>' + (row.rate ? c29money(row.rate) : '') + '</td>' +
               '<td>' + (row.rate ? c29money(amt) : '') + '</td><td></td>';
    } else {
      cells += '<td></td>';
    }
    cells += '<td>' + c29n(c29bags(v.close, row.div)) + '</td><td>' + c29n(v.close) + '</td>';
    n++;
    body += '<tr><td>' + n + '</td><td class="l">' + row.label + '</td>' + cells + '</tr>';

    // The sheet totals the two rice lines together, directly under them.
    if(row.id === 'BRA' || row.id === 'RRA'){
      riceTot.ob += c29bags(v.open, row.div);  riceTot.obk += v.open;
      riceTot.rc += c29bags(v.receipt, row.div); riceTot.rck += v.receipt;
      riceTot.to += c29bags(v.total, row.div); riceTot.tok += v.total;
      riceTot.sa += c29bags(v.sales, row.div); riceTot.sak += v.sales;
      riceTot.cb += c29bags(v.close, row.div); riceTot.cbk += v.close;
    }
    if(row.id === 'RRA'){
      body += '<tr class="sub"><td></td><td class="l">RICE TOTAL</td>' +
        '<td>' + c29n(riceTot.ob) + '</td><td>' + c29n(riceTot.obk) + '</td>' +
        '<td>' + c29n(riceTot.rc) + '</td><td>' + c29n(riceTot.rck) + '</td>' +
        '<td>' + c29n(riceTot.to) + '</td><td>' + c29n(riceTot.tok) + '</td>' +
        '<td>' + c29n(riceTot.sa) + '</td><td>' + c29n(riceTot.sak) + '</td>' +
        (money ? '<td></td><td></td><td></td>' : '<td></td>') +
        '<td>' + c29n(riceTot.cb) + '</td><td>' + c29n(riceTot.cbk) + '</td></tr>';
    }
  });

  return {html: '<table class="c29-tbl">' + head + '<tbody>' + body + '</tbody></table>', amount: amtTotal};
}

function c29CrsPage2(d){
  var g = c29StockGrid(d, true);
  var remit = d.remitDayTotal || 0;
  var foot =
    '<table class="c29-tbl" style="margin-top:6px">' +
      '<tr class="sub"><td class="l">Sales Amount</td><td style="width:22%">' + c29money(g.amount) + '</td></tr>' +
      '<tr class="sub"><td class="l">TOTAL</td><td>' + c29money(g.amount) + '</td></tr>' +
      '<tr class="sub"><td class="l">Remittance Amount</td><td>' + c29money(remit) + '</td></tr>' +
      '<tr class="sub"><td class="l">' + (remit - g.amount >= 0 ? 'EXCESS' : 'SHORT') + '</td><td>' +
        c29money(Math.abs(remit - g.amount)) + '</td></tr>' +
    '</table>';
  return c29page(c29head(d, 'Monthly report of Cost &amp; Free commodities') + g.html + foot + c29sign(d));
}

function c29B6(d){
  return c29page(c29head(d, 'B6 — Monthly report') + c29StockGrid(d, false).html +
    '<div class="c29-sign"><span>BILL CLERK SIGNATURE</span><span>AREA SUPERINTENDENT</span></div>');
}

// ── INDENT ──────────────────────────────────────────────────────────────────
function c29Indent(d){
  var rows = '', n = 0;
  CRS29_ROWS.forEach(function(row){
    var v = c29row(d, row);
    n++;
    rows += '<tr><td>' + n + '</td><td class="l">' + row.label + '</td>' +
      '<td>' + c29n(v.open) + '</td><td>' + c29n(v.receipt) + '</td><td>' + c29n(v.total) + '</td>' +
      '<td>' + c29n(v.sales) + '</td><td>' + c29n(v.close) + '</td><td></td></tr>';
  });
  return c29page(
    c29head(d, 'INDENT', d.mo.toUpperCase() + "'" + String(d.yr).slice(-2) + ' — IN KG’S') +
    '<table class="c29-tbl"><thead><tr>' +
      '<th style="width:6%">S.NO</th><th style="width:18%">COMMODITY</th><th>OPENING</th><th>RECEIPT</th>' +
      '<th>TOTAL</th><th>ISSUES</th><th>CLOSING</th><th>INDENT FOR</th>' +
    '</tr></thead><tbody>' + rows + '</tbody></table>' + c29sign(d));
}

// ── GUNNY ───────────────────────────────────────────────────────────────────
function c29Gunny(d){
  var rows = [['50KG  SS','ss50'], ['POLY','poly'], ['C. BOX','cbox']].map(function(r){
    var g = d.gunny ? d.gunny[r[1]] : null;
    var ob = g ? (g.ob||0) : 0, rec = g ? (g.rec||0) : 0;
    var tot = g ? (g.tot||0) : 0, iss = g ? (g.iss||0) : 0, cb = g ? (g.cb||0) : 0;
    // The camp's sheet splits every column into grain-filled and empty; the
    // application tracks the empty side, so the filled column stays blank.
    return '<tr><td class="l">' + r[0] + '</td>' +
      '<td></td><td>' + c29n(ob)  + '</td>' +
      '<td></td><td>' + c29n(rec) + '</td>' +
      '<td></td><td>' + c29n(tot) + '</td>' +
      '<td></td><td>' + c29n(iss) + '</td>' +
      '<td></td><td>' + c29n(cb)  + '</td></tr>';
  }).join('');
  return c29page(
    c29head(d, 'GUNNY STOCK STATEMENT') +
    '<table class="c29-tbl"><thead>' +
      '<tr><th rowspan="2" style="width:14%">VARIETY</th><th colspan="2">OPENING BALANCE</th>' +
        '<th colspan="2">RECEIPT</th><th colspan="2">TOTAL</th><th colspan="2">ISSUES</th>' +
        '<th colspan="2">CLOSING BALANCE</th></tr>' +
      '<tr><th>GUNNY WITH GRAIN</th><th>EMPTY GUNNY</th><th>GUNNY WITH GRAIN</th><th>EMPTY GUNNY</th>' +
        '<th>GUNNY WITH GRAIN</th><th>EMPTY GUNNY</th><th>GUNNY WITH GRAIN</th><th>EMPTY GUNNY</th>' +
        '<th>GUNNY WITH GRAIN</th><th>EMPTY GUNNY</th></tr>' +
    '</thead><tbody>' + rows + '</tbody></table>' + c29sign(d));
}

// ── CARD DETAIL ─────────────────────────────────────────────────────────────
// The camp counts cards as one figure, not by type — its sheet leaves every
// card-type row blank and fills only the total — so a single TOTAL CARD line is
// printed. The gunny position keeps the right-hand half of the sheet.
function c29CardDetail(d){
  var gunny = [['50 KG SS','ss50'], ['POLYTHENE','poly'], ['CARDBOARD.BOX','cbox']];
  var rows = '';
  for(var i = 0; i < gunny.length; i++){
    var g = d.gunny ? d.gunny[gunny[i][1]] : null;
    rows += '<tr>' +
      '<td>' + (i === 0 ? '1' : '') + '</td>' +
      '<td class="l">' + (i === 0 ? 'TOTAL CARD' : '') + '</td>' +
      '<td>' + (i === 0 ? c29n(d.cards.total) : '') + '</td>' +
      '<td class="l">' + gunny[i][0] + '</td>' +
      '<td>' + (g ? c29n(g.ob)  : '') + '</td>' +
      '<td>' + (g ? c29n(g.rec) : '') + '</td>' +
      '<td>' + (g ? c29n(g.tot) : '') + '</td>' +
      '<td>' + (g ? c29n(g.iss) : '') + '</td>' +
      '<td>' + (g ? c29n(g.cb)  : '') + '</td>' +
    '</tr>';
  }
  return c29page(
    c29head(d, 'CARD DETAILS') +
    '<table class="c29-tbl"><thead>' +
      '<tr><th colspan="3">CARD DETAILS</th><th colspan="6">GUNNY DETAILS</th></tr>' +
      '<tr><th style="width:5%">S.NO</th><th style="width:20%">CARD DETAILS</th><th>CARD</th>' +
        '<th style="width:16%">VARIETYS</th><th>OPENING</th><th>RECEIPT</th><th>TOTAL</th>' +
        '<th>ISSUES</th><th>CLOSING</th></tr>' +
    '</thead><tbody>' + rows + '</tbody></table>' + c29sign(d));
}

// ── SALE TAX ────────────────────────────────────────────────────────────────
function c29SaleTax(d){
  var rows = '', n = 0, total = 0;
  var moKey = d.crsId + '_' + d.month + '_' + d.year;
  function line(label, qty, rate){
    n++;
    var amt = (parseFloat(qty) || 0) * (rate || 0);
    total += amt;
    rows += '<tr><td>' + n + '</td><td class="l">' + label + '</td>' +
      '<td>' + c29n(qty) + '</td><td>' + (rate ? c29money(rate) : '0') + '</td>' +
      '<td>' + (rate ? c29money(amt) : '') + '</td></tr>';
  }
  // The camp's eight commodities, in the order its sheet prints them.
  CRS29_ROWS.forEach(function(row){
    line(row.label === 'B.RICE' ? 'B.R.A' : row.label,
         row.id ? d.getVal(row.id, 'sales') : 0,
         row.rate);
  });

  var police = '';
  if(d.hasPolice){
    var pn = 0, ptot = 0;
    [['B.R.A','PB_BRA',0], ['WHEAT','PB_WHEAT',0], ['SUGAR','PB_SUGAR',12.50],
     ['CYL',null,15.00], ['P.OIL','PB_PALM',12.50]].forEach(function(r){
      pn++;
      var q = r[1] ? d.getVal(r[1],'sales') : 0;
      var a = q * r[2]; ptot += a;
      police += '<tr><td>' + pn + '</td><td class="l">' + r[0] + '</td><td>' + c29n(q) +
        '</td><td>' + c29money(r[2]) + '</td><td>' + c29money(a) + '</td></tr>';
    });
    police =
      '<tr class="sub"><td colspan="5" class="l">POLICE</td></tr>' + police +
      '<tr class="sub"><td colspan="4" class="l">TOTAL</td><td>' + c29money(ptot) + '</td></tr>';
  }

  return c29page(
    c29head(d, 'SALE TAX STATEMENT') +
    '<table class="c29-tbl"><thead><tr>' +
      '<th style="width:6%">S.NO</th><th style="width:26%">COMMODITY</th><th>QTY</th><th>RATE</th><th>TOTAL AMOUNT</th>' +
    '</tr></thead><tbody>' + rows +
      '<tr class="sub"><td colspan="4" class="l">TOTAL</td><td>' + c29money(total) + '</td></tr>' +
      police +
      '<tr class="sub"><td colspan="4" class="l">GRAND TOTAL</td><td>' + c29money(total) + '</td></tr>' +
    '</tbody></table>' +
    '<div class="c29-note">Date wise Sales statement enclosed.</div>' + c29sign(d));
}

// ── C RICE · SALES REPORT ───────────────────────────────────────────────────
// Both are day-by-day sheets over the whole month: C RICE splits the day's rice
// between free and cost, SALES REPORT carries the day's money.
function c29DayRows(d){
  var days = [];
  var inMonth = new Date(d.year, d.month, 0).getDate();
  for(var day = 1; day <= inMonth; day++){
    var ds = d.year + '-' + String(d.month).padStart(2,'0') + '-' + String(day).padStart(2,'0');
    var e = (typeof entryStore !== 'undefined')
      ? (entryStore[d.crsId + '_' + ds] || entryStore[String(d.crsId) + '_' + ds] || null) : null;
    days.push({day:day, date:ds, entry:e});
  }
  return days;
}
function c29DaySales(rec, id){
  if(!rec) return 0;
  var s = (rec.a && rec.a[id]) || (rec.b && rec.b[id]);
  return s ? (parseFloat(s.sales) || 0) : 0;
}

function c29CRice(d){
  var tot = {rba:0, bra:0, sum:0, cost:0, all:0};
  var rows = c29DayRows(d).map(function(x, i){
    var rba  = c29DaySales(x.entry, 'RRA');
    var bra  = c29DaySales(x.entry, 'BRA');
    var free = rba + bra;
    var cost = c29DaySales(x.entry, 'PHH_BRA') + c29DaySales(x.entry, 'OAP');
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

function c29SalesReport(d){
  var grand = 0, qty = 0;
  var rows = c29DayRows(d).map(function(x, i){
    var dayQty = 0, dayAmt = 0;
    CRS29_ROWS.forEach(function(row){
      if(!row.id) return;
      var s = c29DaySales(x.entry, row.id);
      dayQty += s;
      if(row.rate) dayAmt += s * row.rate;
    });
    qty += dayQty; grand += dayAmt;
    var r = d.remitByDay ? d.remitByDay[x.day] : null;
    return '<tr><td>' + (i+1) + '</td><td>' + x.date.split('-').reverse().join('/') + '</td>' +
      '<td>' + c29n(dayQty) + '</td><td>' + (dayAmt ? c29money(dayAmt) : '') + '</td>' +
      '<td>' + (r ? c29money(r.amount) : '') + '</td>' +
      '<td>' + (r && r.remitDate ? r.remitDate.split('-').reverse().join('/') : '') + '</td></tr>';
  }).join('');
  return c29page(
    c29head(d, 'SALES REPORT') +
    '<table class="c29-tbl"><thead><tr>' +
      '<th style="width:5%">SL NO</th><th style="width:14%">DATE</th><th>QTY (KG’S)</th>' +
      '<th>SALE AMOUNT</th><th>REMITTED</th><th>REMITTANCE DATE</th>' +
    '</tr></thead><tbody>' + rows +
      '<tr class="sub"><td></td><td>TOTAL</td><td>' + c29n(qty) + '</td><td>' + c29money(grand) +
      '</td><td>' + c29money(d.remitDayTotal || 0) + '</td><td></td></tr>' +
    '</tbody></table>' + c29sign(d));
}

// ── SECTIONS ────────────────────────────────────────────────────────────────
// The camp's own list. Kept in the same shape as STMT_SECTIONS so the ported
// card renderer, the select-all helpers and the export bar all work unchanged.
var CRS29_SECTIONS = [
  {id:'crs_page1',     label:'CRS Page 1',    desc:'Monthly proforma account — allotment',        icon:'📋', color:'#0369A1', copies:1, availableFor:'all'},
  {id:'receipt',       label:'Receipt',       desc:'Godown receipt details for the month',        icon:'🧾', color:'#0EA5E9', copies:1, availableFor:'all'},
  {id:'crs_daily_sale',label:'CRS Daily Sale',desc:'Date-wise particulars of sales & remittance', icon:'📅', color:'#0284C7', copies:1, availableFor:'all'},
  {id:'crs_page2',     label:'CRS Page 2',    desc:'Cost & free commodities with rates',          icon:'📋', color:'#0369A1', copies:2, availableFor:'all'},
  {id:'gunny',         label:'Gunny',         desc:'Gunny stock statement (bags/sacks)',          icon:'🏷️', color:'#7C3AED', copies:2, availableFor:'all'},
  {id:'remittance',    label:'Remittance',    desc:'Date-wise remittance to bank (SRCB)',         icon:'🏦', color:'#DC2626', copies:2, availableFor:'all'},
  {id:'sale_tax',      label:'Sale Tax',      desc:'Sale tax statement with rates & totals',      icon:'📄', color:'#1D4ED8', copies:1, availableFor:'all'},
  {id:'b6',            label:'B6',            desc:'B6 monthly report format',                    icon:'📄', color:'#7C3AED', copies:1, availableFor:'all'},
  {id:'card_details',  label:'Card Details',  desc:'Card count & gunny details',                  icon:'🧺', color:'#0F766E', copies:1, availableFor:'all'},
  {id:'c_rice',        label:'C Rice',        desc:'Day-wise rice sales (free & cost)',           icon:'🍚', color:'#B45309', copies:1, availableFor:'all'},
  {id:'sales_report',  label:'Sales Report',  desc:'Day-wise quantity, amount & remittance',      icon:'📈', color:'#15803D', copies:1, availableFor:'all'},
  {id:'indent',        label:'Indent',        desc:'Opening / receipt / issues / indent',         icon:'📝', color:'#0F766E', copies:1, availableFor:'all'},
];

var CRS29_BUILDERS = {
  crs_page1:    c29CrsPage1,
  crs_page2:    c29CrsPage2,
  b6:           c29B6,
  gunny:        c29Gunny,
  card_details: c29CardDetail,
  sale_tax:     c29SaleTax,
  c_rice:       c29CRice,
  sales_report: c29SalesReport,
  indent:       c29Indent,
};

// ── ROUTING ─────────────────────────────────────────────────────────────────
// Selected purely by shop number, so no template has to be chosen by hand.
var STMT_SECTIONS_STANDARD = STMT_SECTIONS.slice();

function crs29SelectedCrs(){
  var el = document.getElementById('stmt-crs');
  return el ? parseInt(el.value, 10) : NaN;
}

// STMT_SECTIONS is read by name all over the ported statement screen, so the
// array object is kept and its contents swapped for whichever list applies.
function crs29ApplySectionList(){
  var want = isCrs29(crs29SelectedCrs()) ? CRS29_SECTIONS : STMT_SECTIONS_STANDARD;
  if(STMT_SECTIONS.length === want.length && STMT_SECTIONS[0] === want[0]) return;
  STMT_SECTIONS.length = 0;
  want.forEach(function(s){ STMT_SECTIONS.push(s); });
  // Drop any tick belonging to a section the new list does not have.
  if(typeof stmtSelectedSections !== 'undefined'){
    Object.keys(stmtSelectedSections).forEach(function(id){
      if(!want.some(function(s){ return s.id === id; })) delete stmtSelectedSections[id];
    });
  }
}

var _c29OrigRenderSections = stmtRenderSections;
stmtRenderSections = function(){
  try{ crs29ApplySectionList(); }catch(e){}
  return _c29OrigRenderSections.apply(this, arguments);
};

var _c29OrigBuildSectionHTML = buildSectionHTML;
buildSectionHTML = function(sectionId, d){
  if(d && isCrs29(d.crsId)){
    var fn = CRS29_BUILDERS[sectionId];
    if(fn) return fn(d);
    // Receipt, Daily Sale and Remittance keep the ported layouts, which the
    // camp's workbook matches; anything the camp does not file is refused
    // rather than silently rendered in the wrong format.
    if(!CRS29_SECTIONS.some(function(s){ return s.id === sectionId; })){
      return '<div style="padding:20px;font-size:12px;color:#B45309">' +
        'CRS 29 (Refugee Camp) does not file this statement.</div>';
    }
  }
  return _c29OrigBuildSectionHTML.apply(this, arguments);
};

// Changing the shop re-renders the cards, which swaps the list.
var _c29OrigOnCRSChange = (typeof stmtOnCRSChange === 'function') ? stmtOnCRSChange : null;
if(_c29OrigOnCRSChange){
  stmtOnCRSChange = function(){
    var r = _c29OrigOnCRSChange.apply(this, arguments);
    try{ stmtRenderSections(); }catch(e){}
    return r;
  };
}
