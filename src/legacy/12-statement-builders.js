/* The 15 official statement layouts + print/Excel export
   Verbatim from TNCSC_CRS_Demo_19 (1).html lines 5922-7743.
   These parts are concatenated back into one classic script by
   tools/bundle-engine.mjs - the code hoists across the whole block and
   its declarations must stay global for the markup's inline handlers. */
function buildCrsPage1(d){
  // ── Exact reproduction of the CRS PAGE1 Excel format ─────────────────────
  // Layout: Card/info format (not a commodity table) matching the Excel exactly:
  // Row1:  TAMIL NADU CIVIL SUPPLIES CORPORATION\nMADURAI REGION  (Calibri 20 Bold, centered)
  // Row2:  CRS : MONTHLY PROFORMA ACCOUNT                         (Calibri 22 Bold, centered)
  // Row5:  NAME OF THE CRS :X   |   TOTAL NUMBER OF CARDS : N    (Calibri 18 Bold)
  // Row6:  NAME OF THE B.C: ...                                   (Calibri 18 Bold)
  // Row7:  MONTH : MON'YEAR                                       (Calibri 18 Bold)
  // Row8:  CARD DETIALS  |  ALLOTMENT                             (Calibri 18 Bold, centered)
  // Row9-14: Card type rows (left 14pt Bold) | Allotment (right 18pt Bold)
  // Row16: NOTE:                                                  (Calibri 18 Normal)
  // Row17: Note 1 text                                            (Calibri 20 Normal)
  // Row19: Note 2 text                                            (Calibri 20 Normal)
  // Row25: SIGNATURE OF B.C :  |  SIGNATURE OF AREA SUPERVISOR   (Calibri 12 Bold)
  // Row26: MOBILE NO : phone                                      (Calibri 12 Bold)
  // Row27: T.N.C.S.C MADURAI REGION                              (Calibri 12 Bold)

  var crsNum   = d.crsId;
  var bcName   = d.bcName   || STAFF_NAME_BLANK;   // [M4]
  var bcPhone  = d.bcPhone  || STAFF_PHONE_BLANK;  // [M4]
  var moLabel  = (d.mo || '').toUpperCase() + "'" + d.yr;
  // ── Card details: live from the Monthly Entry → Card Details module ──────
  var totalCards = d.cards.total;
  var cardTypes  = d.cards.list.map(function(c){ return {label:c.label, count:c.count}; });
  if(!cardTypes.length){
    cardTypes = [{label:'RICE CARD',count:0},{label:'SUGAR CARD',count:0},{label:'AAY CARD',count:0}];
  }

  // ── Allotment: live from the Receipt module (falls back to Monthly/Daily
  //    receipt figures when no godown receipt row exists for the month) ──────
  function q(id){ var v = d.receiptQty(id); return v ? (Number.isInteger(v) ? v : +v.toFixed(3)) : 0; }
  var nphh_frk = q('NPHH_FRK'), aay_frk = q('AAY_FRK');
  var sugar    = q('SUGAR'),    aay_sug = q('AAY_SUGAR');
  var wheat    = q('WHEAT'),    toor    = q('TOOR'), palm = q('PALM');
  var phh_bra  = q('PHH_BRA'),  phh_frk = q('PHH_FRK');

  var allotments = [
    '1.NPHH&AAY FRK : ' + nphh_frk + ' & ' + aay_frk,
    '2.SUGAR&AAY       : ' + sugar + ' & ' + aay_sug,
    '3.WHEAT                 : ' + wheat,
    '4.T.D & P.O             : ' + toor + ' & ' + palm,
    '5.PHH BRA&FRK   : ' + phh_bra + ' & ' + phh_frk,
    '6.B.RICE & RRA     : ' + q('BRA') + ' & ' + q('RRA'),
    ''
  ];

  // Helper: table cell styles matching Excel column widths
  var colB = 'width:46%;';
  var colC = 'width:44%;';
  var colD = 'width:10%;';

  // ── CSS matching Excel fonts exactly ─────────────────────────────────────
  var css = [
    '.cp1-wrap{font-family:Calibri,Arial,sans-serif;background:#fff;padding:20px 28px;max-width:800px;margin:0 auto;border:1px solid #ccc}',
    '.cp1-h1{font-size:20pt;font-weight:bold;text-align:center;line-height:1.3;margin-bottom:4px}',
    '.cp1-h2{font-size:22pt;font-weight:bold;text-align:center;margin-bottom:8px}',
    '.cp1-spacer{height:18px}',
    '.cp1-info-row{display:flex;margin-bottom:2px}',
    '.cp1-info-b{font-size:14pt;font-weight:bold;flex:1.1}',
    '.cp1-info-c{font-size:14pt;font-weight:bold;flex:1}',
    '.cp1-sec-hdr{display:flex;border-top:2px solid #000;border-bottom:1px solid #000;margin:8px 0 2px;padding:3px 0}',
    '.cp1-sec-hdr-b{font-size:14pt;font-weight:bold;text-align:center;flex:1.1;border-right:1px solid #ccc}',
    '.cp1-sec-hdr-c{font-size:14pt;font-weight:bold;text-align:center;flex:1}',
    '.cp1-card-row{display:flex;margin-bottom:1px}',
    '.cp1-card-lbl{font-size:10pt;font-weight:bold;flex:1.1;padding:1px 0}',
    '.cp1-card-val{font-size:14pt;font-weight:bold;flex:1;padding:1px 4px}',
    '.cp1-note-hdr{font-size:14pt;font-weight:normal;margin:10px 0 2px}',
    '.cp1-note-txt{font-size:15pt;font-weight:normal;margin-bottom:6px;line-height:1.5}',
    '.cp1-sig-area{display:flex;margin-top:32px;border-top:1px solid #ccc;padding-top:12px}',
    '.cp1-sig-left{flex:1;font-size:9pt;font-weight:bold}',
    '.cp1-sig-right{flex:1;font-size:9pt;font-weight:bold;text-align:center}',
    '.cp1-footer{font-size:9pt;font-weight:bold;margin-top:6px}',
  ].join('\n');

  // ── Build card rows (zip card types + allotments) ─────────────────────────
  var cp1Rows = Math.max(cardTypes.length, allotments.length);
  var cardRowsHtml = '';
  for(var _r = 0; _r < cp1Rows; _r++){
    var ct    = cardTypes[_r];
    var allot = allotments[_r] || '';
    var left  = ct ? (ct.label.padEnd(22,' ').replace(/ /g,'&nbsp;') + ' : ' + ct.count) : '';
    cardRowsHtml += '<div class="cp1-card-row">' +
      '<div class="cp1-card-lbl">' + left + '</div>' +
      '<div class="cp1-card-val">' + allot + '</div>' +
    '</div>';
  }

  return '<style>' + css + '</style>' +
  '<div class="cp1-wrap">' +

    // Row 1: Main title (20pt Bold, centered, with line break)
    '<div class="cp1-h1">TAMIL NADU CIVIL SUPPLIES CORPORATION<br>MADURAI REGION</div>' +

    // Row 2: Sub title (22pt Bold, centered)
    '<div class="cp1-h2">CRS : MONTHLY PROFORMA ACCOUNT</div>' +

    '<div class="cp1-spacer"></div>' +

    // Row 5: CRS name + total cards (18pt Bold)
    '<div class="cp1-info-row">' +
      '<div class="cp1-info-b">NAME OF THE CRS :' + crsNum + '</div>' +
      '<div class="cp1-info-c">TOTAL NUMBER OF CARDS : ' + totalCards + '</div>' +
    '</div>' +

    // Row 6: BC name (18pt Bold)
    '<div class="cp1-info-row">' +
      '<div style="font-family:Calibri,Arial,sans-serif;font-size:14pt;font-weight:bold">NAME OF THE B.C: ' + bcName + '</div>' +
    '</div>' +

    // Row 7: Month (18pt Bold)
    '<div class="cp1-info-row" style="margin-bottom:6px">' +
      '<div style="font-family:Calibri,Arial,sans-serif;font-size:14pt;font-weight:bold">MONTH : ' + moLabel + '</div>' +
    '</div>' +

    // Row 8: Section headers (18pt Bold, centered, with border)
    '<div class="cp1-sec-hdr">' +
      '<div class="cp1-sec-hdr-b">CARD DETIALS</div>' +
      '<div class="cp1-sec-hdr-c">ALLOTMENT</div>' +
    '</div>' +

    // Rows 9-14: Card types + allotments
    cardRowsHtml +

    '<div class="cp1-spacer"></div>' +

    // Row 16: NOTE: (18pt Normal — NOT bold)
    '<div class="cp1-note-hdr">NOTE:</div>' +

    // Row 17: Note 1 (20pt Normal — NOT bold)
    '<div class="cp1-note-txt">1. The quantity of the commodities sold and the amount realised under each variety should be tallied with the quantity made in the statement I and &lsquo;c&rsquo; register</div>' +

    // Row 18: blank
    '<div style="height:8px"></div>' +

    // Row 19: Note 2 (20pt Normal — NOT bold)
    '<div class="cp1-note-txt">2. The total quantity furnished in the statement should be tallied with the receipt shown in statement IV</div>' +

    '<div style="flex:1;min-height:60px"></div>' +

    // Row 25-27: Signatures (12pt Bold)
    '<div class="cp1-sig-area">' +
      '<div class="cp1-sig-left">' +
        'SIGNATURE OF B.C :<br><br>' +
        'MOBILE NO : ' + bcPhone +
      '</div>' +
      '<div class="cp1-sig-right">SIGNATURE OF AREA SUPERVISOR</div>' +
    '</div>' +

    '<div class="cp1-footer">T.N.C.S.C MADURAI REGION</div>' +

  '</div>';
}

// ── RECEIPT ────────────────────────────────────────────────────────────────
function buildReceipt(d){
  // Exact reproduction of RECEIPT sheet (B1:AL26), landscape A4
  // Row1:  B1:AL1 merged — TAMIL NADU CIVIL SUPPLIES CORPORATION... (Calibri 16 Bold, center)
  // Row2:  C2:O2 — RECEIPT DETAILS FOR THE MONTH OF : MON'YEAR  (14 Bold) | R2:AL2 — CRS N (14 Bold center)
  // Row3:  Commodity headers each spanning 2 cols (bag/kgs), 12pt Bold center
  // Row4:  Sub-headers: bag/kgs/Pkts for each commodity, 11pt Normal center
  // Rows5-11: 7 data entry rows (SL NO in col B, Date/Memo in col C, data in D-AL)
  // Row12: TOTAL row (SUM formulas), 11pt Bold
  // Rows13-15: Second batch (3 rows) + second TOTAL
  // Row18: GUNNY REPORT heading
  // Rows21-25: Gunny stock table

  var moLabel = (d.mo||'').toUpperCase() + "'" + d.yr;
  var crsLabel = 'CRS ' + d.crsId;

  // Commodity definitions matching Excel columns exactly
  // Each entry: {id, label, unit} — unit is bag/kgs or bag/Pkts
  var comms = [
    {id:'BRA',       label:'BRA',          u1:'bag', u2:'kgs'},
    {id:'AAY',       label:'AAY',          u1:'bag', u2:'kgs'},
    {id:'RRA',       label:'RRA',          u1:'bag', u2:'kgs'},
    {id:'SUGAR',     label:'SUGAR',        u1:'bag', u2:'kgs'},
    {id:'AAY_SUGAR', label:'SUGAR (AAY)',  u1:'bag', u2:'kgs'},
    {id:'WHEAT',     label:'WHEAT',        u1:'bag', u2:'kgs'},
    {id:'TOOR',      label:'CYL',          u1:'bag', u2:'kgs'},
    {id:'PALM',      label:'P.OIL',        u1:'bag', u2:'Pkts'},
    {id:'OOTY',      label:'OOTY',         u1:'bag', u2:'Pkts'},
    {id:'TAN',       label:'TAN',          u1:'bag', u2:'Pkts'},
    {id:'PHH_BRA',   label:'PHH BRA',      u1:'bag', u2:'kgs'},   // [C2] was PHH_FRK
    {id:'PHH_FRK',   label:'PHH FRK',      u1:'bag', u2:'kgs'},
    {id:'AAY_FRK',   label:'AAY FRK',      u1:'bag', u2:'kgs'},
    {id:'NPHH_FRK',  label:'NPHH FRK',     u1:'bag', u2:'kgs'},
    {id:'NPHH_RRA',  label:'NPHH FRK RRA', u1:'bag', u2:'kgs'},
    {id:'PJ',        label:'PJ 100',       u1:'',    u2:'PKTS', writeIn:true},   // [M2]
    {id:'SALT_CIS',  label:'SALT(CIS)',     u1:'bag', u2:'Pkts'},
    {id:'SALT_RFFS', label:'SALT(RFFS)',    u1:'bag', u2:'Pkts'},
  ];

  // Compute totals per commodity from receiptStore
  function getQty(commId){
    var total = 0;
    d.receipts.forEach(function(r){
      if(r.items[commId]) total += r.items[commId].qty || 0;
    });
    return total;
  }

  // Build data rows from receipts (max 7 per batch + total, then second batch)
  var batch1 = d.receipts.slice(0,7);
  var batch2 = d.receipts.slice(7,10);

  // CSS - matching Excel landscape receipt format
  var css = [
    '.rcp-wrap{font-family:Calibri,Arial,sans-serif;background:#fff;padding:12px 10px;font-size:11px}',
    '.rcp-h1{font-size:16pt;font-weight:bold;text-align:center;border:1px solid #000;padding:4px;margin-bottom:0}',
    '.rcp-h2{display:flex;border:1px solid #000;border-top:none;margin-bottom:0}',
    '.rcp-h2-left{font-size:11pt;font-weight:bold;padding:3px 8px;flex:1}',
    '.rcp-h2-right{font-size:11pt;font-weight:bold;padding:3px 8px;text-align:center;border-left:1px solid #000;min-width:140px}',
    '.rcp-table{width:100%;border-collapse:collapse;font-size:8px;table-layout:fixed}',
    '.rcp-table th,.rcp-table td{border:1px solid #000;padding:1px 2px;text-align:center;vertical-align:middle;overflow:hidden;white-space:nowrap}',
    '.rcp-table .comm-hdr{font-size:8px;font-weight:bold;background:#f5f5f5}',
    '.rcp-table .sub-hdr{font-size:7px;font-weight:normal;background:#fafafa}',
    '.rcp-table .total-row{font-weight:bold;background:#f0f0f0}',
    '.rcp-table .sl-col{width:22px;font-size:8px}',
    '.rcp-table .date-col{width:80px;font-size:8px;text-align:left;white-space:normal}',
    '.rcp-table .data-col{width:28px}',
    '.rcp-table .pj-col{width:30px}',
    '.rcp-gunny-title{font-size:12pt;font-weight:bold;text-align:center;margin:10px 0 4px;border:1px solid #000;padding:3px}',
    '.rcp-gunny-table{border-collapse:collapse;font-size:9px}',
    '.rcp-gunny-table th,.rcp-gunny-table td{border:1px solid #000;padding:2px 4px;text-align:center;vertical-align:middle}',
    '.rcp-sig{display:flex;justify-content:space-between;margin-top:16px;font-size:10pt;font-weight:bold}',
  ].join('\n');

  // Helper: cell with value or dash
  function dc(v){ return '<td class="data-col">'+(v||'')+'</td>'; }
  function dce(v){ return '<td class="data-col">'+(v?Number(v).toFixed(0):'')+'</td>'; }

  // Build commodity header row (2 levels)
  var commHdrRow1 = comms.map(function(c){
    if(!c.u1) return '<th class="comm-hdr pj-col" colspan="1" rowspan="2">'+c.label+'</th>';
    return '<th class="comm-hdr" colspan="2">'+c.label+'</th>';
  }).join('');

  var commHdrRow2 = comms.map(function(c){
    if(!c.u1) return '';
    return '<th class="sub-hdr">'+c.u1+'</th><th class="sub-hdr">'+c.u2+'</th>';
  }).join('');

  // Build a data row from a receipt or empty
  function buildDataRow(slNo, receipt){
    var cells = comms.map(function(c){
      if(!c.u1){ // single-column write-in (PJ 100) — [M2] left blank for pen entry
        var pj = (!c.writeIn && receipt && receipt.items[c.id]) ? receipt.items[c.id].qty : null;
        return '<td class="pj-col">'+(pj ? Number(pj).toFixed(0) : '')+'</td>';
      }
      var qty = receipt && receipt.items[c.id] ? receipt.items[c.id].qty : 0;
      var bags = qty ? bagsOf(qty, c.id) : '';   // [S1]
      var kgs  = qty ? qty.toFixed(0) : '';
      return '<td class="data-col">'+(bags||'')+'</td><td class="data-col">'+(kgs||'')+'</td>';
    }).join('');
    var dateCell = receipt ? (receipt.date + (receipt.receiptNo?' / '+receipt.receiptNo:'')) : '';
    return '<tr><td class="sl-col">'+(receipt?slNo:'')+'</td><td class="date-col">'+dateCell+'</td>'+cells+'</tr>';
  }

  // Build TOTAL row
  function buildTotalRow(receiptBatch){
    var cells = comms.map(function(c){
      if(!c.u1){   // [M2] write-in column totals nothing — blank, not a phantom 0
        if(c.writeIn) return '<td class="pj-col total-row"></td>';
        var t=receiptBatch.reduce(function(s,r){return s+(r.items[c.id]?r.items[c.id].qty:0);},0);
        return '<td class="pj-col total-row">'+(t?t.toFixed(0):'')+'</td>';
      }
      var total=receiptBatch.reduce(function(s,r){return s+(r.items[c.id]?r.items[c.id].qty:0);},0);
      var bags=bagsOf(total, c.id);   // [S1]
      return '<td class="data-col total-row">'+(bags||0)+'</td><td class="data-col total-row">'+(total?total.toFixed(0):0)+'</td>';
    }).join('');
    return '<tr><td class="sl-col total-row"></td><td class="date-col total-row" style="font-weight:bold;font-size:9px">TOTAL</td>'+cells+'</tr>';
  }

  // Build 7 empty rows for batch if not enough data
  var b1Rows = '';
  for(var i=0;i<7;i++){
    b1Rows += buildDataRow(i+1, batch1[i]||null);
  }
  var b2Rows = '';
  for(var j=0;j<3;j++){
    b2Rows += buildDataRow(j+1, batch2[j]||null);
  }

  // ── Gunny report: live from the Gunny Stock module (meGunnyStore); falls
  //    back to the Monthly Entry gunny sub-columns when nothing was keyed. ──
  function gnum(v){ return (v === 0 || v === '' || v == null) ? '' : String(+(Number(v).toFixed(2))); }
  function gRow(label, g){
    return {label:label,
            ob_wg:'',  ob_e:gnum(g.ob),
            rec_wg:'', rec_e:gnum(g.rec),
            tot_wg:'', tot_e:gnum(g.tot),
            iss_wg:'', iss_e:gnum(g.iss),
            cb_wg:'',  cb_e:(g.cb === 0 ? '0' : gnum(g.cb))};
  }
  var gunnyRows = [
    gRow('50KG SS', d.gunny.ss50),
    gRow('POLY',    d.gunny.poly),
    gRow('C.BOX',   d.gunny.cbox)
  ];

  var gunnyTableRows = gunnyRows.map(function(g){
    return '<tr>'+
      '<td style="font-weight:bold">'+g.label+'</td>'+
      '<td>'+g.ob_wg+'</td><td>'+g.ob_e+'</td>'+
      '<td>'+g.rec_wg+'</td><td>'+g.rec_e+'</td>'+
      '<td>'+g.tot_wg+'</td><td>'+g.tot_e+'</td>'+
      '<td>'+g.iss_wg+'</td><td>'+g.iss_e+'</td>'+
      '<td>'+g.cb_wg+'</td><td>'+g.cb_e+'</td>'+
    '</tr>';
  }).join('');

  return '<style>' + css + '</style>' +
  '<div class="rcp-wrap">' +

    // Row 1: Main title (B1:AL1, Calibri 16 Bold, centered)
    '<div class="rcp-h1">TAMIL NADU CIVIL SUPPLIES CORPORATION - MADURAI REGION</div>' +

    // Row 2: Month + CRS (two sections)
    '<div class="rcp-h2">' +
      '<div class="rcp-h2-left">RECEIPT DETAILS FOR THE MONTH OF : ' + moLabel + '</div>' +
      '<div class="rcp-h2-right">' + crsLabel + '</div>' +
    '</div>' +

    // Main receipt table
    '<div style="overflow-x:auto;margin-top:4px">' +
    '<table class="rcp-table">' +
    '<thead>' +
      // Row 3: Commodity headers (12pt Bold, merged 2 cols each)
      '<tr>' +
        '<th class="sl-col comm-hdr" rowspan="2">SL<br>NO</th>' +
        '<th class="date-col comm-hdr" rowspan="2">DATE OF ISSUE/<br>ISSUE MEMO</th>' +
        commHdrRow1 +
      '</tr>' +
      // Row 4: Sub-headers bag/kgs/Pkts (11pt Normal)
      '<tr>' + commHdrRow2 + '</tr>' +
    '</thead>' +
    '<tbody>' +
      // Rows 5-11: Data entry rows (7 rows for first batch)
      b1Rows +
      // Row 12: TOTAL
      buildTotalRow(batch1) +
      // Rows 13-15: Second batch (3 rows)
      b2Rows +
      // Row 15: Second TOTAL
      buildTotalRow(batch2) +
    '</tbody>' +
    '</table>' +
    '</div>' +

    // Gunny report section
    '<div class="rcp-gunny-title">GUNNY REPORT FOR THE MONTH OF ' + moLabel + '</div>' +
    '<table class="rcp-gunny-table">' +
    '<thead>' +
      '<tr>' +
        '<th rowspan="2">VARITIES</th>' +
        '<th colspan="2">OPENING BALANCE</th>' +
        '<th colspan="2">RECEIPT</th>' +
        '<th colspan="2">TOTAL</th>' +
        '<th colspan="2">ISSUES</th>' +
        '<th colspan="2">CLOSING</th>' +
      '</tr>' +
      '<tr>' +
        '<th style="font-size:7px">GUNNY<br>WITH GRAINS</th><th style="font-size:7px">EMPTY<br>GUNNY</th>' +
        '<th style="font-size:7px">GUNNY<br>WITH GRAINS</th><th style="font-size:7px">EMPTY<br>GUNNY</th>' +
        '<th style="font-size:7px">GUNNY<br>WITH GRAINS</th><th style="font-size:7px">EMPTY<br>GUNNY</th>' +
        '<th style="font-size:7px">GUNNY<br>WITH GRAINS</th><th style="font-size:7px">EMPTY<br>GUNNY</th>' +
        '<th style="font-size:7px">GUNNY<br>WITH GRAINS</th><th style="font-size:7px">EMPTY<br>GUNNY</th>' +
      '</tr>' +
    '</thead>' +
    '<tbody>' + gunnyTableRows + '</tbody>' +
    '</table>' +

    // Signature
    '<div class="rcp-sig">' +
      '<span>BILL CLERK: ' + d.bcName + '</span>' +
      '<span>DATE: __________</span>' +
    '</div>' +
  '</div>';
}

// ── CRS DAILY SALES ────────────────────────────────────────────────────────
function buildCrsDailySale(d){
  var daysInMonth = new Date(d.year, d.month, 0).getDate();
  var mo  = d.mo.toUpperCase() + "'" + d.yr;

  // 17 commodity columns matching PDF exactly
  var COLS = [
    {id:'BRA',       label:'BRA'},
    {id:'AAY',       label:'AAY'},
    {id:'RRA',       label:'RRA'},
    {id:'SUGAR',     label:'SUGAR'},
    {id:'AAY_SUGAR', label:'SUGAR\n(AAY)'},
    {id:'WHEAT',     label:'WHEAT'},
    {id:'TOOR',      label:'CYL'},
    {id:'PALM',      label:'P.OIL'},
    {id:'OOTY',      label:'OOTY'},
    {id:'TAN',       label:'TAN'},
    {id:'SALT_CIS',  label:'SALT\n(CIS)'},
    {id:'SALT_RFFS', label:'SALT\n(RFFS)'},
    {id:'PHH_BRA',   label:'PHH\nBRA'},
    {id:'PHH_FRK',   label:'PHH\nFRK'},
    {id:'AAY_FRK',   label:'AAY\nFRK'},
    {id:'NPHH_FRK',  label:'NPHH\nFRK'},
    {id:'NPHH_RRA',  label:'NPHH\nFRK RRA'},
  ];

  // Plain PDF-style CSS — no colors, just borders
  var css = [
    '.dcs-wrap{font-family:Calibri,Arial,sans-serif;font-size:9px;background:#fff;color:#000}',
    '.dcs-title{text-align:center;font-weight:bold;font-size:13px;margin-bottom:3px;letter-spacing:.03em}',
    '.dcs-sub{text-align:center;font-size:10px;margin-bottom:8px;font-weight:bold}',
    '.dcs-tbl{width:100%;border-collapse:collapse;font-size:8px}',
    '.dcs-tbl th,.dcs-tbl td{border:1px solid #000;padding:2px 3px;text-align:right;vertical-align:middle}',
    '.dcs-tbl th{text-align:center;font-weight:bold;font-size:7.5px;white-space:pre-line;vertical-align:bottom;background:#fff;color:#000}',
    '.dcs-tbl th.bighdr{font-size:9.5px;font-weight:800}',
    '.dcs-tbl td.date-col{text-align:left;white-space:nowrap}',
    '.dcs-tbl .total-row td{font-weight:bold;border-top:2px solid #000}',
    '.dcs-footer{margin-top:10px;font-size:9px;font-weight:bold}',
    '.dcs-footer-line{display:flex;justify-content:space-between;padding:1px 0}',
    '.dcs-footer-total{border-top:1px solid #000;padding-top:4px;margin-top:4px;font-size:10px}',
    '@media print{@page{size:A3 landscape}body{font-size:8px}}',
  ].join('\n');

  // Initialise column totals
  var colTotals = {};
  COLS.forEach(function(c){ colTotals[c.id] = 0; });
  var grandTotalSales = 0;
  var grandTotalRemit = 0;
  var totalExcess     = 0;
  var totalShort      = 0;

  // Helper: format date as d.m.yy
  function fmtRemitDate(iso){
    if(!iso) return '';
    var parts = iso.split('-');
    return parseInt(parts[2],10)+'.'+parseInt(parts[1],10)+'.'+parts[0].slice(2);
  }

  // Build data rows
  var rows = '';
  for(var day=1; day<=daysInMonth; day++){
    var dateStr  = d.year+'-'+String(d.month).padStart(2,'0')+'-'+String(day).padStart(2,'0');
    var eKey     = d.crsId+'_'+dateStr;
    var entry    = entryStore[eKey];
    var dispDate = String(day).padStart(2,'0')+'/'+String(d.month).padStart(2,'0')+'/'+d.year;

    // Remittance: Daily Entry first, Monthly Remittance table as backup
    var rmDay     = (d.remitByDay && d.remitByDay[day]) ? d.remitByDay[day] : null;
    var remitDate = fmtRemitDate(rmDay ? rmDay.remitDate : '');
    var remitAmt  = rmDay ? (rmDay.amount || 0) : 0;
    // Excess: from the Inspection module for this date
    var dayExcess = (d.inspByDay && d.inspByDay[day]) ? d.inspByDay[day].excess : 0;
    var dayShort  = (d.inspByDay && d.inspByDay[day]) ? d.inspByDay[day].shortage : 0;
    totalExcess  += dayExcess;
    totalShort   += dayShort;

    // Commodity sales values
    var cellVals = {};
    COLS.forEach(function(c){ cellVals[c.id] = 0; });
    var dayTotal = 0;

    if(entry){
      COLS.forEach(function(c){
        var eData = entry.a && entry.a[c.id] ? entry.a[c.id] : null;
        if(eData){
          var s = parseFloat(eData.sales||0);
          if(s > 0){ cellVals[c.id] = s; colTotals[c.id] += s; }
        }
      });
      DSS_A.forEach(function(c){ dayTotal += entry.a&&entry.a[c.id] ? (parseFloat(entry.a[c.id].amount)||0):0; });
      DSS_B.forEach(function(c){ dayTotal += entry.b&&entry.b[c.id] ? (parseFloat(entry.b[c.id].amount)||0):0; });
    }

    grandTotalSales += dayTotal;
    if(remitAmt > 0) grandTotalRemit += remitAmt;

    rows += '<tr>' +
      '<td class="date-col">' + dispDate + '</td>' +
      COLS.map(function(c){
        var v = cellVals[c.id];
        return '<td>' + (v > 0 ? (v % 1 === 0 ? v : v.toFixed(3)) : '') + '</td>';
      }).join('') +
      '<td>' + (dayTotal > 0 ? dayTotal.toFixed(2) : '0.00') + '</td>' +
      '<td>' + remitDate + '</td>' +
      '<td>' + (dayExcess ? (+dayExcess.toFixed(3)) : (dayShort ? '-'+(+dayShort.toFixed(3)) : '')) + '</td>' +
      '<td>' + (remitAmt > 0 ? remitAmt.toFixed(2) : '') + '</td>' +
    '</tr>';
  }

  // Extra row (e.g. 01/07/2026 poly gunny from meRemitStore extra)
  var moKey = d.crsId+'_'+d.month+'_'+d.year;
  var extraStore = (typeof meRemitStore!=='undefined' && meRemitStore[moKey] && meRemitStore[moKey]['extra']) ? meRemitStore[moKey]['extra'] : {};
  if(extraStore.e1nc || extraStore.e1date){
    var nMo = d.month===12?1:d.month+1;
    var nYr = d.month===12?d.year+1:d.year;
    var xDate = '01/'+String(nMo).padStart(2,'0')+'/'+nYr;
    var xRemitDate = fmtRemitDate(extraStore.e1date||'');
    var xAmt = parseFloat(extraStore.e1nc||0);
    rows += '<tr>' +
      '<td class="date-col">' + xDate + '</td>' +
      COLS.map(function(){ return '<td></td>'; }).join('') +
      '<td>0.00</td>' +
      '<td>' + xRemitDate + '</td>' +
      '<td style="font-size:7px;text-align:left">' + (extraStore.e1label||'poly gunny & c.box') + '</td>' +
      '<td>' + (xAmt>0?xAmt.toFixed(2):'') + '</td>' +
    '</tr>';
    grandTotalRemit += xAmt;
  }

  // TOTAL row
  rows += '<tr class="total-row">' +
    '<td class="date-col">TOTAL</td>' +
    COLS.map(function(c){
      var v = colTotals[c.id];
      return '<td>' + (v > 0 ? (v % 1 === 0 ? v : v.toFixed(3)) : '0') + '</td>';
    }).join('') +
    '<td>' + grandTotalSales.toFixed(2) + '</td>' +
    '<td></td>' +
    '<td>' + (totalExcess ? (+totalExcess.toFixed(3)) : '0') + '</td>' +
    '<td>' + grandTotalRemit.toFixed(2) + '</td>' +
  '</tr>';

  // Police + c.box totals for footer
  var policeTotal = 0;
  var monthData = (typeof monthlyStore!=='undefined') ? (monthlyStore[moKey]||null) : null;
  if(monthData && monthData.b){
    DSS_B.forEach(function(c){ policeTotal += parseFloat((monthData.b[c.id]||{}).amount||0)||0; });
  }
  var cboxExtra = parseFloat(extraStore.e1nc||0)+parseFloat(extraStore.e2nc||0)+parseFloat(extraStore.e3nc||0);
  var grandFinal = grandTotalSales + policeTotal + cboxExtra;

  return '<style>' + css + '</style>' +
  '<div class="dcs-wrap">' +
    '<div class="dcs-title">TAMIL NADU CIVIL SUPPLIES CORPORATION - MADURAI REGION</div>' +
    '<div class="dcs-sub">CRS - ' + d.crsId + ' DATEWISE PARTICULARS OF SALES FOR THE MONTH OF ' + mo + '</div>' +
    '<div style="overflow-x:auto">' +
    '<table class="dcs-tbl">' +
    '<thead>' +
    // Row 1: group header — "REMITTANCE FOR mo" spanning last 3 cols
    '<tr>' +
      '<th rowspan="2" class="bighdr" style="text-align:left;min-width:78px">DATE</th>' +
      COLS.map(function(c){ return '<th rowspan="2" class="bighdr" style="min-width:26px">' + c.label + '</th>'; }).join('') +
      '<th rowspan="2" class="bighdr" style="min-width:50px">TOTAL\nAMOUNT</th>' +
      '<th colspan="3" style="font-size:9px;font-weight:bold;background:#fff;border-bottom:none">REMITTANCE FOR ' + mo + '</th>' +
    '</tr>' +
    // Row 2: sub-headers for the remittance group
    '<tr>' +
      '<th style="min-width:44px">REMITT\nDATE</th>' +
      '<th style="min-width:32px">EXCESS</th>' +
      '<th style="min-width:50px">AMT PAID\nIN BANK</th>' +
    '</tr>' +
    '</thead>' +
    '<tbody>' + rows + '</tbody>' +
    '</table>' +
    '</div>' +
    // Footer
    '<div class="dcs-footer">' +
      '<div class="dcs-footer-line"><span>TOTAL AMOUNT OF DAILY SALES</span><span>' + grandTotalSales.toFixed(2) + '</span></div>' +
      '<div class="dcs-footer-line"><span>CRS POLICE + JAGGERY</span><span>' + policeTotal.toFixed(2) + '</span></div>' +
      '<div class="dcs-footer-line"><span>C.BOX + P.GUNNY + EXCESS</span><span>' + cboxExtra.toFixed(2) + '</span></div>' +
      '<div class="dcs-footer-line dcs-footer-total"><span>TOTAL</span><span>' + grandFinal.toFixed(2) + '</span></div>' +
    '</div>' +
    '<div style="display:flex;justify-content:space-between;margin-top:16px;font-size:9px;font-weight:bold">' +
      '<span>SIGNATURE OF BC: ' + d.bcName + '</span>' +
      '<span>DATE: __________</span>' +
    '</div>' +
  '</div>';
}

// ── CRS PAGE 2: Cost commodities ───────────────────────────────────────────
function buildCrsPage2(d){
  // ── Exact reproduction of the official CRS PAGE 2 monthly report ───────────
  // Data pulled from Monthly Entry (monthlyStore) via d.getVal(id,field).
  // Fields available per commodity: open, receipt, total, sales, close, amount.
  // Bag divisors match the Monthly Entry screen.
  // [S1] uses the global BAG_DIV / bagDiv()
  function commOf(id){ return (DSS_A||[]).find(function(x){return x.id===id;}) || {rate:0,free:true}; }
  function rateOf(id){ return commOf(id).rate || 0; }
  function isFree(id){ return !!commOf(id).free; }

  // value getters with fallbacks
  function gOpen(id){ return d.getVal(id,'open'); }
  function gRec(id){ return d.getVal(id,'receipt'); }
  function gTot(id){ var t=d.getVal(id,'total'); return t || (gOpen(id)+gRec(id)); }
  function gSal(id){ return d.getVal(id,'sales'); }
  function gClose(id){ return d.hasVal(id,'close') ? d.getVal(id,'close') : Math.max(0, gTot(id)-gSal(id)); }   // [C3]
  function gAmt(id){ if(isFree(id)) return 0; var a=d.getVal(id,'amount'); return a || (gSal(id)*rateOf(id)); }

  // formatters
  function nk(v){ if(!v) return ''; v=Number(v); return Number.isInteger(v)?String(v):v.toFixed(3); }
  function n2(v){ return v?Number(v).toFixed(2):''; }
  function bags(kgs,id){ return kgs>0?String(Math.floor(kgs/bagDiv(id))):''; }

  // cell helpers (scoped to this table)
  function C(x){ return '<td>'+(x==null||x===''?'':x)+'</td>'; }
  function L(x){ return '<td class="l">'+(x==null?'':x)+'</td>'; }
  function R(x){ return '<td class="r">'+(x==null||x===''?'':x)+'</td>'; }

  // Official row order (SL, on-screen label, monthly-store id)
  var ROWS = [
    {sl:'1',  label:'B.RICE',       id:'BRA',      rice:true},
    {sl:'1A', label:'A.A.Y',        id:'AAY',      rice:true},
    {sl:'2',  label:'R.R.A',        id:'RRA',      rice:true},
    {subtotal:'RICE TOTAL', of:['BRA','AAY','RRA']},
    {sl:'3',  label:'SUGAR',        id:'SUGAR'},
    {sl:'4',  label:'SUGAR(AAY)',   id:'AAY_SUGAR'},
    {sl:'5',  label:'WHEAT',        id:'WHEAT'},
    {sl:'6',  label:'CYL',          id:'TOOR'},
    {sl:'7',  label:'P.OIL',        id:'PALM'},
    {sl:'8',  label:'OOTY',         id:'OOTY'},
    {sl:'9',  label:'TAN',          id:'TAN'},
    {sl:'10', label:'SALT(CIS)',    id:'SALT_CIS'},
    {sl:'11', label:'SALT(RFFS)',   id:'SALT_RFFS'},
    {sl:'12', label:'OAP',          id:'OAP'},
    {sl:'13', label:'APS',          id:'APS'},
    {sl:'14', label:'PHH BRA',      id:'PHH_BRA'},
    {sl:'15', label:'PHH FRK',      id:'PHH_FRK'},
    {sl:'16', label:'AAY FRK',      id:'AAY_FRK'},
    {sl:'17', label:'NPHH FRK',     id:'NPHH_FRK'},
    {sl:'18', label:'NPHH FRK RRA', id:'NPHH_RRA'},
  ];

  var salesAmountMain = 0; // sum of cost-commodity amounts (excludes empties/police)
  var bodyRows = '';

  // Inspection module (excess / shortage / transfer), rolled up for the month
  function iv(id, f){ var v = d.getInsp(id, f); return v ? String(+(v.toFixed(3))) : ''; }
  function ivSum(ids, f){
    var t = 0; ids.forEach(function(id){ t += d.getInsp(id, f); });
    return t ? String(+(t.toFixed(3))) : '';
  }

  ROWS.forEach(function(r){
    if(r.subtotal){
      var ob=0,rec=0,tot=0,sal=0,cb=0, obB=0,recB=0,totB=0,salB=0,cbB=0;
      r.of.forEach(function(id){
        var o=gOpen(id),rc=gRec(id),t=gTot(id),s=gSal(id),c=gClose(id);
        ob+=o; rec+=rc; tot+=t; sal+=s; cb+=c;
        obB+=Math.floor(o/bagDiv(id)); recB+=Math.floor(rc/bagDiv(id));
        totB+=Math.floor(t/bagDiv(id)); salB+=Math.floor(s/bagDiv(id)); cbB+=Math.floor(c/bagDiv(id));
      });
      bodyRows += '<tr class="sub">'+ C('') + L(r.subtotal) +
        C(obB||'')+C(nk(ob)) + C(recB||'')+C(nk(rec)) +
        C(ivSum(r.of,'excess'))+C(ivSum(r.of,'shortage'))+C(ivSum(r.of,'transfer')) +
        C(totB||'')+C(nk(tot)) + C(salB||'')+C(nk(sal)) +
        C('')+R('') + C(cbB||'')+C(nk(cb)) + '</tr>';
      return;
    }
    var ob=gOpen(r.id),rec=gRec(r.id),tot=gTot(r.id),sal=gSal(r.id),cb=gClose(r.id);
    var free=isFree(r.id), rt=rateOf(r.id), amt=gAmt(r.id);
    if(!free) salesAmountMain += amt;
    bodyRows += '<tr>'+ C(r.sl) + L(r.label) +
      C(bags(ob,r.id))+C(nk(ob)) + C(bags(rec,r.id))+C(nk(rec)) +
      C(iv(r.id,'excess'))+C(iv(r.id,'shortage'))+C(iv(r.id,'transfer')) +
      C(bags(tot,r.id))+C(nk(tot)) + C(bags(sal,r.id))+C(nk(sal)) +
      C(free?'':n2(rt)) + R(free?'':n2(amt)) +
      C(bags(cb,r.id))+C(nk(cb)) + '</tr>';
  });

  // ── Special rows (19–22). Empties are counted in NOS, shown in the KGS cols ──
  function nosRow(sl,label,id,rt){
    var ob=gOpen(id),rec=gRec(id),tot=gTot(id),sal=gSal(id);
    var amt = sal*rt;
    return '<tr>'+ C(sl) + L(label) +
      C('')+C(ob?nk(ob):'') + C('')+C(rec?nk(rec):'') +
      C('')+C('')+C('') +
      C('')+C(tot?nk(tot):'') + C('')+C(sal?nk(sal):'') +
      C(n2(rt)) + R(amt?n2(amt):'') + C('')+C('') + '</tr>';
  }
  // 19 PALM JAGGERY'S (no dedicated monthly field — shown blank)
  bodyRows += '<tr>'+ C('19') + L("PALM JAGGERY'S") +
    C('')+C('')+C('')+C('')+C('')+C('')+C('')+C('')+C('')+C('')+C('')+C('')+R('')+C('')+C('') + '</tr>';
  // 20 POLICE (sum of Section-B amounts)
  var policeAmt = (DSS_B||[]).reduce(function(s,c){
    var a=d.getVal(c.id,'amount'); if(!a && !c.free) a=d.getVal(c.id,'sales')*(c.rate||0); return s+(a||0);
  },0);
  bodyRows += '<tr>'+ C('20') + L('POLICE') +
    C('')+C('')+C('')+C('')+C('')+C('')+C('')+C('')+C('')+C('')+C('')+R(policeAmt?n2(policeAmt):'')+C('')+C('') + '</tr>';
  // 21 C.BOX (EMPTY_BOX) and 22 P.GUNNY (EMPTY_BAG)
  var cboxRate = rateOf('EMPTY_BOX'), gunnyRate = rateOf('EMPTY_BAG');
  var cboxAmt  = gSal('EMPTY_BOX')*cboxRate, gunnyAmt = gSal('EMPTY_BAG')*gunnyRate;
  bodyRows += nosRow('21','C.BOX','EMPTY_BOX',cboxRate);
  bodyRows += nosRow('22','P.GUNNY','EMPTY_BAG',gunnyRate);

  // ── Footer totals ─────────────────────────────────────────────────────────
  var grandTotal = salesAmountMain + policeAmt + cboxAmt + gunnyAmt;
  // Remittance total for the month (from meRemitStore), if entered
  var totalRemit = 0;
  try{
    var rk = d.crsId + '_' + d.month + '_' + d.year;
    var rs = (typeof meRemitStore!=='undefined') ? meRemitStore[rk] : null;
    if(rs){ Object.keys(rs).forEach(function(k){ if(k==='extra') return;
      var day=rs[k]||{}; totalRemit += (parseFloat(day.nonCereal)||0)+(parseFloat(day.cereal)||0); }); }
  }catch(e){}
  var excess = totalRemit>0 ? (totalRemit - grandTotal) : 0;
  var remitAmount = totalRemit>0 ? totalRemit : grandTotal;

  var css = [
    '.p2-wrap{font-family:Calibri,Arial,sans-serif;color:#000;background:#fff}',
    '.p2-title{text-align:center;font-weight:bold;font-size:13px;margin-bottom:2px}',
    '.p2-sub{text-align:center;font-size:10px;margin-bottom:2px}',
    '.p2-info{display:flex;justify-content:space-between;font-size:10px;font-weight:bold;margin:6px 2px 4px}',
    '.p2-scroll{overflow-x:auto}',
    '.p2-tbl{width:100%;border-collapse:collapse;font-size:7.5px;table-layout:fixed}',
    '.p2-tbl th,.p2-tbl td{border:1px solid #000;padding:1px 2px;text-align:center;vertical-align:middle;overflow:hidden;white-space:nowrap}',
    '.p2-tbl th{font-weight:bold;background:#fff;line-height:1.15}',
    '.p2-tbl td.l{text-align:left}',
    '.p2-tbl td.r{text-align:right}',
    '.p2-tbl tr.sub td{font-weight:bold;background:#F5F5F5}',
    '.p2-foot{margin-top:8px;margin-left:auto;width:240px;font-size:10px;font-weight:bold}',
    '.p2-foot div{display:flex;justify-content:space-between;border:1px solid #000;border-top:none;padding:2px 8px}',
    '.p2-foot div:first-child{border-top:1px solid #000}',
    '.p2-sig{display:flex;justify-content:space-between;margin-top:16px;font-size:10px;font-weight:bold}',
  ].join('');

  var colgroup = '<colgroup>'+
    '<col style="width:3%"><col style="width:11%">'+   // SL, COMMODITY
    '<col style="width:4%"><col style="width:6.5%">'+  // opening bags,kgs
    '<col style="width:4%"><col style="width:6.5%">'+  // receipt bags,kgs
    '<col style="width:4%"><col style="width:4%"><col style="width:4%">'+ // excess,short,transfer
    '<col style="width:4%"><col style="width:6.5%">'+  // total bags,kgs
    '<col style="width:4%"><col style="width:6.5%">'+  // sales bags,kgs
    '<col style="width:5%"><col style="width:7%">'+    // rate, amount
    '<col style="width:4%"><col style="width:6.5%">'+  // closing bags,kgs
    '</colgroup>';

  var head =
    '<thead>'+
    '<tr>'+
      '<th rowspan="2">SL.<br>NO</th>'+
      '<th rowspan="2">COMMODITY</th>'+
      '<th colspan="2">OPENING<br>BALANCE</th>'+
      '<th colspan="2">RECEIPT</th>'+
      '<th rowspan="2">EXCESS</th>'+
      '<th rowspan="2">SHORT<br>AGE</th>'+
      '<th rowspan="2">TRANS<br>FER</th>'+
      '<th colspan="2">TOTAL</th>'+
      '<th colspan="4">SALES</th>'+
      '<th colspan="2">CLOSING<br>BALANCE</th>'+
    '</tr>'+
    '<tr>'+
      '<th>BAGS</th><th>KGS</th>'+
      '<th>BAGS</th><th>KGS</th>'+
      '<th>BAGS</th><th>KGS</th>'+
      '<th>BAGS</th><th>KGS</th><th>RATE</th><th>AMOUNT</th>'+
      '<th>BAGS</th><th>KGS</th>'+
    '</tr>'+
    '</thead>';

  return '<style>'+css+'</style>'+
    '<div class="p2-wrap">'+
      '<div class="p2-title">TAMIL NADU CIVIL SUPPLIES CORPORATION - MADURAI REGION</div>'+
      '<div class="p2-sub">Monthly report for the month of '+d.mo.toUpperCase()+"'"+d.yr+'</div>'+
      '<div class="p2-info"><span>NAME OF THE B.C : '+d.bcName+'</span><span>CRS NO: '+d.crsId+'</span></div>'+
      '<div class="p2-scroll">'+
        '<table class="p2-tbl">'+colgroup+head+'<tbody>'+bodyRows+'</tbody></table>'+
      '</div>'+
      '<div class="p2-foot">'+
        '<div><span>Sales Amount</span><span>'+n2(salesAmountMain)+'</span></div>'+
        '<div><span>TOTAL</span><span>'+n2(grandTotal)+'</span></div>'+
        '<div><span>EXCESS</span><span>'+(excess?n2(excess):'0.00')+'</span></div>'+
        '<div><span>Remittance Amount</span><span>'+n2(remitAmount)+'</span></div>'+
      '</div>'+
      '<div class="p2-sig"><span>BILL CLERK : '+d.bcName+'</span><span>AREA SUPERVISOR</span></div>'+
    '</div>';
}

// ── GUNNY STOCK ────────────────────────────────────────────────────────────
function buildGunny(d){
  // ── Exact reproduction of the CRS GUNNY STOCK STATEMENT ───────────────────
  // Five column-groups (Opening / Receipt / Total / Issues / Closing), each
  // split into "GUNNY WITH GRAINS" and "EMPTY GUNNY".
  //   • 50KG SS  -> WITH GRAINS  (sum of gunny bags across grain commodities)
  //   • POLY     -> EMPTY        (empty polythene bags = EMPTY_BAG)
  //   • C. BOX   -> EMPTY        (empty card/box = EMPTY_BOX)
  // Data comes from Monthly Entry (open / receipt / sales, in Kgs; bags = /50).

  // Values come straight from the Gunny Stock module (Monthly Entry → Gunny
  // Stock). When that table is empty they are derived from the Monthly Entry
  // gunny sub-columns instead — both paths are resolved in stmtGetData().
  var g50 = d.gunny.ss50, gPoly = d.gunny.poly, gBox = d.gunny.cbox;
  var ssOB=g50.ob,  ssRec=g50.rec,  ssTot=g50.tot,  ssIss=g50.iss,  ssCB=g50.cb;
  var polyOB=gPoly.ob, polyRec=gPoly.rec, polyTot=gPoly.tot, polyIss=gPoly.iss, polyCB=gPoly.cb;
  var cbxOB=gBox.ob,   cbxRec=gBox.rec,   cbxTot=gBox.tot,   cbxIss=gBox.iss,   cbxCB=gBox.cb;

  function C(x){ return '<td>'+(x==null||x===''?'':x)+'</td>'; }
  function L(x){ return '<td class="l">'+(x==null?'':x)+'</td>'; }
  function num(v, showZero){
    if(v===0 || v==null || v==='') return showZero ? '0' : '';
    return String(v);
  }
  // type: 'grain' fills the WITH-GRAINS sub-col; 'empty' fills the EMPTY sub-col.
  function cells(type, vals){
    var out='';
    vals.forEach(function(v,idx){
      var txt = num(v, idx===4); // closing balance shows 0 explicitly
      out += (type==='grain') ? (C(txt)+C('')) : (C('')+C(txt));
    });
    return out;
  }

  var css = [
    '.gy-wrap{font-family:Calibri,Arial,sans-serif;color:#000;background:#fff}',
    '.gy-title{text-align:center;font-weight:bold;font-size:13px;margin-bottom:2px}',
    '.gy-sub{text-align:center;font-size:11px;margin-bottom:2px}',
    '.gy-scroll{overflow-x:auto;margin-top:6px}',
    '.gy-tbl{width:100%;border-collapse:collapse;font-size:9px;table-layout:fixed}',
    '.gy-tbl th,.gy-tbl td{border:1px solid #000;padding:3px 3px;text-align:center;vertical-align:middle;overflow:hidden;white-space:nowrap}',
    '.gy-tbl th{font-weight:bold;background:#fff;line-height:1.2}',
    '.gy-tbl td.l{text-align:left;font-weight:bold}',
    '.gy-sig{display:flex;justify-content:space-between;margin-top:18px;font-size:10px;font-weight:bold}',
  ].join('');

  var colgroup = '<colgroup>'+
    '<col style="width:16%">'+
    '<col style="width:8.4%"><col style="width:8.4%">'+
    '<col style="width:8.4%"><col style="width:8.4%">'+
    '<col style="width:8.4%"><col style="width:8.4%">'+
    '<col style="width:8.4%"><col style="width:8.4%">'+
    '<col style="width:8.4%"><col style="width:8.4%">'+
    '</colgroup>';

  var subPair = '<th>GUNNY<br>WITH GRAINS</th><th>EMPTY<br>GUNNY</th>';
  var head =
    '<thead>'+
    '<tr>'+
      '<th rowspan="2">VARIETY</th>'+
      '<th colspan="2">OPENING<br>BALANCE</th>'+
      '<th colspan="2">RECEIPT</th>'+
      '<th colspan="2">TOTAL</th>'+
      '<th colspan="2">ISSUES</th>'+
      '<th colspan="2">CLOSING<br>BALANCE</th>'+
    '</tr>'+
    '<tr>'+ subPair+subPair+subPair+subPair+subPair +'</tr>'+
    '</thead>';

  var body =
    '<tr>'+L('50KG SS')+cells('grain',[ssOB,ssRec,ssTot,ssIss,ssCB])+'</tr>'+
    '<tr>'+L('POLY')+cells('empty',[polyOB,polyRec,polyTot,polyIss,polyCB])+'</tr>'+
    '<tr>'+L('C. BOX')+cells('empty',[cbxOB,cbxRec,cbxTot,cbxIss,cbxCB])+'</tr>'+
    '<tr>'+L('')+
      C('')+C('')+C('')+C('')+C('')+C('')+C('')+C('')+C('')+C('')+'</tr>';

  return '<style>'+css+'</style>'+
    '<div class="gy-wrap">'+
      '<div class="gy-title">TAMIL NADU CIVIL SUPPLIES CORPORATION - MADURAI REGION</div>'+
      '<div class="gy-sub">CRS '+d.crsId+'</div>'+
      '<div class="gy-sub">GUNNY STOCK STATEMENT FOR THE MONTH OF '+d.mo.toUpperCase()+"'"+d.yr+'</div>'+
      '<div class="gy-scroll">'+
        '<table class="gy-tbl">'+colgroup+head+'<tbody>'+body+'</tbody></table>'+
      '</div>'+
      '<div class="gy-sig"><span>BILL CLERK : '+d.bcName+'</span><span>AREA SUPERVISOR</span></div>'+
    '</div>';
}

// ── FREE COMMODITY (B6 format) ─────────────────────────────────────────────
function buildFreeCom(d){
  // ── Exact reproduction of the FREE COM Excel format ───────────────────────
  // Columns: SL, COMMODITY, OPENING(bags,kgs), RECEIPT(bags,kgs),
  //          TRANSFER(bags,kgs), TOTAL(bags,kgs), SALES(bags,kgs,rate,amount),
  //          CLOSING(bags,kgs). Free commodities only; RICE TOTAL + WHEAT TOTAL.
  function bags(kgs, id){ return String(bagsOf(kgs, id)); }   // [S1]
  function nk(v){ v=Number(v)||0; return Number.isInteger(v)?String(v):v.toFixed(3); }

  function C(x){ return '<td>'+(x==null?'':x)+'</td>'; }
  function L(x){ return '<td class="l">'+(x==null?'':x)+'</td>'; }
  function R(x){ return '<td class="r">'+(x==null?'':x)+'</td>'; }

  // Rice-group free commodities (official order), then WHEAT separately.
  var RICE = [
    {sl:1,  label:'B.RICE',       id:'BRA'},
    {sl:2,  label:'A.A.Y',        id:'AAY'},
    {sl:3,  label:'R.R.A',        id:'RRA'},
    {sl:4,  label:'PHH BRA',      id:'PHH_BRA'},
    {sl:5,  label:'PHH FRK',      id:'PHH_FRK'},
    {sl:6,  label:'AAY FRK',      id:'AAY_FRK'},
    {sl:7,  label:'NPHH FRK',     id:'NPHH_FRK'},
    {sl:8,  label:'NPHH FRK RRA', id:'NPHH_RRA'},
    {sl:9,  label:'OAP',          id:'OAP'},
    {sl:10, label:'APS',          id:'APS'},
  ];
  var WHEATROW = {sl:11, label:'WHEAT', id:'WHEAT'};

  function vals(id){
    var ob=d.getVal(id,'open'), rec=d.getVal(id,'receipt');
    var tot=d.getVal(id,'total')||(ob+rec);
    var sal=d.getVal(id,'sales');
    var cb=d.hasVal(id,'close')?d.getVal(id,'close'):Math.max(0,tot-sal);   // [C3]
    // gunny (bag) counts: use the value entered in Monthly Entry; else kgs/50
    function gb(which,kg){ return d.hasVal(id,'g_'+which) ? Math.round(d.getVal(id,'g_'+which)) : bagsOf(kg,id); }   // [C3][S1]
    var tr=d.getInsp(id,'transfer');
    return {ob:ob,rec:rec,tot:tot,sal:sal,cb:cb,tr:tr,
            gob:gb('open',ob),grec:gb('receipt',rec),gtot:gb('total',tot),gsal:gb('sales',sal),gcb:gb('close',cb),
            gtr:bagsOf(tr,id)};   // [S1]
  }
  // commodity row (free -> rate '-', amount blank, transfer 0)
  function comRow(r){
    var v=vals(r.id);
    return '<tr>'+ C(r.sl) + L(r.label) +
      C(v.gob)+C(nk(v.ob)) +      // opening
      C(v.grec)+C(nk(v.rec)) +    // receipt
      C(v.gtr)+C(nk(v.tr)) +     // transfer (Inspection module)
      C(v.gtot)+C(nk(v.tot)) +   // total
      C(v.gsal)+C(nk(v.sal)) +   // sales bags/kgs
      C('-')+R('') +             // rate / amount (free)
      C(v.gcb)+C(nk(v.cb)) +     // closing
    '</tr>';
  }
  // subtotal row (bold)
  function subRow(label, ids){
    var t={ob:0,rec:0,tot:0,sal:0,cb:0,tr:0}, b={ob:0,rec:0,tot:0,sal:0,cb:0,tr:0};
    ids.forEach(function(id){
      var v=vals(id);
      t.ob+=v.ob; t.rec+=v.rec; t.tot+=v.tot; t.sal+=v.sal; t.cb+=v.cb; t.tr+=v.tr;
      b.ob+=v.gob; b.rec+=v.grec; b.tot+=v.gtot; b.sal+=v.gsal; b.cb+=v.gcb; b.tr+=v.gtr;
    });
    return '<tr class="sub">'+ C('') + L(label) +
      C(b.ob)+C(nk(t.ob)) +
      C(b.rec)+C(nk(t.rec)) +
      C(b.tr)+C(nk(t.tr)) +
      C(b.tot)+C(nk(t.tot)) +
      C(b.sal)+C(nk(t.sal)) +
      C('')+R('') +
      C(b.cb)+C(nk(t.cb)) +
    '</tr>';
  }

  var body='';
  RICE.forEach(function(r){ body+=comRow(r); });
  body += subRow('RICE TOTAL', RICE.map(function(r){return r.id;}));
  body += comRow(WHEATROW);
  body += subRow('WHEAT TOTAL', [WHEATROW.id]);

  var css = [
    '.fc-wrap{font-family:Calibri,Arial,sans-serif;color:#000;background:#fff}',
    '.fc-title{text-align:center;font-weight:bold;font-size:13px;margin-bottom:2px}',
    '.fc-sub{text-align:center;font-size:10px;margin-bottom:2px}',
    '.fc-info{display:flex;justify-content:space-between;font-size:10px;font-weight:bold;margin:6px 2px 4px}',
    '.fc-scroll{overflow-x:auto}',
    '.fc-tbl{width:100%;border-collapse:collapse;font-size:8px;table-layout:fixed}',
    '.fc-tbl th,.fc-tbl td{border:1px solid #000;padding:2px 2px;text-align:center;vertical-align:middle;overflow:hidden;white-space:nowrap}',
    '.fc-tbl th{font-weight:bold;background:#fff;line-height:1.15}',
    '.fc-tbl td.l{text-align:left}',
    '.fc-tbl td.r{text-align:right}',
    '.fc-tbl tr.sub td{font-weight:bold;background:#F5F5F5}',
    '.fc-sig{display:flex;justify-content:space-between;margin-top:16px;font-size:10px;font-weight:bold}',
  ].join('');

  var colgroup = '<colgroup>'+
    '<col style="width:4%"><col style="width:13%">'+   // SL, COMMODITY
    '<col style="width:5%"><col style="width:7%">'+    // opening
    '<col style="width:5%"><col style="width:7%">'+    // receipt
    '<col style="width:5%"><col style="width:7%">'+    // transfer
    '<col style="width:5%"><col style="width:7%">'+    // total
    '<col style="width:5%"><col style="width:7%"><col style="width:5%"><col style="width:6%">'+ // sales bags,kgs,rate,amount
    '<col style="width:5%"><col style="width:7%">'+    // closing
    '</colgroup>';

  var head =
    '<thead>'+
    '<tr>'+
      '<th rowspan="2">SL.<br>NO</th>'+
      '<th rowspan="2">COMMODITY</th>'+
      '<th colspan="2">OPENING<br>BALANCE</th>'+
      '<th colspan="2">RECEIPT</th>'+
      '<th colspan="2">TRANSFER</th>'+
      '<th colspan="2">TOTAL</th>'+
      '<th colspan="4">SALES</th>'+
      '<th colspan="2">CLOSING<br>BALANCE</th>'+
    '</tr>'+
    '<tr>'+
      '<th>BAGS</th><th>KGS</th>'+
      '<th>BAGS</th><th>KGS</th>'+
      '<th>BAGS</th><th>KGS</th>'+
      '<th>BAGS</th><th>KGS</th>'+
      '<th>BAGS</th><th>KGS</th><th>RATE</th><th>AMOUNT</th>'+
      '<th>BAGS</th><th>KGS</th>'+
    '</tr>'+
    '</thead>';

  return '<style>'+css+'</style>'+
    '<div class="fc-wrap">'+
      '<div class="fc-title">TAMIL NADU CIVIL SUPPLIES CORPORATION - MADURAI REGION</div>'+
      '<div class="fc-sub">Monthly report for the month of '+d.mo.toUpperCase()+"'"+d.yr+'</div>'+
      '<div class="fc-info"><span>NAME OF THE B.C : '+d.bcName+'</span><span>CRS NO: '+d.crsId+'</span></div>'+
      '<div class="fc-scroll">'+
        '<table class="fc-tbl">'+colgroup+head+'<tbody>'+body+'</tbody></table>'+
      '</div>'+
      '<div class="fc-sig"><span>BILL CLERK : '+d.bcName+'</span><span>AREA SUPERVISOR</span></div>'+
    '</div>';
}

// ── COST COMMODITY ─────────────────────────────────────────────────────────
function buildCostCom(d){
  // ── Exact reproduction of the COST COM Excel format ───────────────────────
  function commOf(id){ return (DSS_A||[]).find(function(x){return x.id===id;})||{rate:0}; }
  function rateOf(id){ return commOf(id).rate||0; }
  function gb(id,which,kg){ return d.hasVal(id,'g_'+which) ? Math.round(d.getVal(id,'g_'+which)) : bagsOf(kg,id); }   // [C3][S1]
  function nz(x){ if(x===''||x==null) return ''; var n=Number(x)||0; return String(+(n.toFixed(3))); }
  function amt2(x){ if(x===''||x==null) return ''; return String(+(Number(x).toFixed(2))); }
  function C(x){ return '<td>'+(x==null?'':x)+'</td>'; }
  function L(x){ return '<td class="l">'+(x==null?'':x)+'</td>'; }
  function R(x){ return '<td class="r">'+(x==null?'':x)+'</td>'; }
  function v(id){
    var ob=d.getVal(id,'open'),rec=d.getVal(id,'receipt');
    var tot=d.getVal(id,'total')||(ob+rec), sal=d.getVal(id,'sales');
    var cb=d.hasVal(id,'close')?d.getVal(id,'close'):Math.max(0,tot-sal);   // [C3]
    var rt=rateOf(id), am=d.getVal(id,'amount')||sal*rt;
    return {ob:ob,rec:rec,tot:tot,sal:sal,cb:cb,rt:rt,am:am,
            gob:gb(id,'open',ob),grec:gb(id,'receipt',rec),gtot:gb(id,'total',tot),
            gsal:gb(id,'sales',sal),gcb:gb(id,'close',cb)};
  }

  var COST=[
    {sl:1,label:'AAY SUGAR', id:'AAY_SUGAR'},
    {sl:2,label:'SUGAR',     id:'SUGAR'},
    {sl:3,label:'CYL',       id:'TOOR'},
    {sl:4,label:'P.OIL',     id:'PALM'},
    {sl:5,label:'OOTY',      id:'OOTY'},
    {sl:6,label:'TAN',       id:'TAN'},
    {sl:7,label:'SALT(CIS)', id:'SALT_CIS'},
    {sl:8,label:'SALT(RFFS)',id:'SALT_RFFS'},
  ];

  var mainAmt=0, body='';
  COST.forEach(function(r){
    var x=v(r.id); mainAmt+=x.am;
    body+='<tr>'+C(r.sl)+L(r.label)+
      C(x.gob)+C(nz(x.ob))+ C(x.grec)+C(nz(x.rec))+
      C(nz(d.getInsp(r.id,'transfer')))+          // transfer (Inspection module)
      C(x.gtot)+C(nz(x.tot))+
      C(x.gsal)+C(nz(x.sal))+ C(amt2(x.rt))+R(amt2(x.am))+
      C(x.gcb)+C(nz(x.cb))+'</tr>';
  });

  // amount-only row (label + amount in AMOUNT column)
  function amtRow(sl,label,amount,bold,rateDash){
    return '<tr'+(bold?' class="sub"':'')+'>'+C(sl)+L(label)+
      C('')+C('')+C('')+C('')+C('')+C('')+C('')+C('')+C('')+
      C(rateDash?'-':'')+R(amount===''?'':amt2(amount))+C('')+C('')+'</tr>';
  }
  // empty-goods row (counts shown in BAGS columns, kgs blank)
  function emptyRow(sl,label,id){
    var ob=d.getVal(id,'open'),rec=d.getVal(id,'receipt');
    var tot=d.getVal(id,'total')||(ob+rec), sal=d.getVal(id,'sales');
    var cb=d.hasVal(id,'close')?d.getVal(id,'close'):Math.max(0,tot-sal);   // [C3]
    var rt=rateOf(id), am=d.getVal(id,'amount')||sal*rt;
    return '<tr>'+C(sl)+L(label)+
      C(ob||'0')+C('')+ C(rec||'')+C('')+ C('')+ C(tot||'')+C('')+
      C(sal||'')+C('')+ C(amt2(rt))+R(am?amt2(am):'')+ C(cb||'0')+C('')+'</tr>';
  }

  var jaggery=0;
  var police=(DSS_B||[]).reduce(function(s,c){
    var a=d.getVal(c.id,'amount'); if(!a && !c.free) a=d.getVal(c.id,'sales')*(c.rate||0); return s+(a||0);
  },0);
  body+=amtRow('',"PALM JAGGERY'S",jaggery);
  body+=amtRow(9,'POLICE',police);
  var grand=mainAmt+jaggery+police;
  body+=amtRow('','GRAND TOTAL',grand,true);

  // [C3] a keyed-in amount of 0 is a real figure, not a missing one
  var cboxAmt=d.hasVal('EMPTY_BOX','amount')?d.getVal('EMPTY_BOX','amount'):d.getVal('EMPTY_BOX','sales')*rateOf('EMPTY_BOX');
  var polyAmt=d.hasVal('EMPTY_BAG','amount')?d.getVal('EMPTY_BAG','amount'):d.getVal('EMPTY_BAG','sales')*rateOf('EMPTY_BAG');
  body+=emptyRow(10,'C.BOX','EMPTY_BOX');
  body+=emptyRow(11,'POLY','EMPTY_BAG');

  // Remittance-derived figures (Inspection charges, Excess, Net total)
  var moKey=d.crsId+'_'+d.month+'_'+d.year;
  var rs=(typeof meRemitStore!=='undefined')?meRemitStore[moKey]:null;
  var ex=(rs&&rs['extra'])?rs['extra']:{};
  var inspec=(parseFloat(ex.e2nc)||0)+(parseFloat(ex.e2ce)||0);
  var totalRemit=0;
  try{ if(rs){ Object.keys(rs).forEach(function(k){ if(k==='extra')return;
        var day=rs[k]||{}; totalRemit+=(parseFloat(day.nonCereal)||0)+(parseFloat(day.cereal)||0); });
      ['e1','e2','e3'].forEach(function(e){ totalRemit+=(parseFloat(ex[e+'nc'])||0)+(parseFloat(ex[e+'ce'])||0); });
  } }catch(e){}
  var subtotal=grand+cboxAmt+polyAmt+inspec;
  var excess=totalRemit>0?(totalRemit-subtotal):0;
  var netTotal=totalRemit>0?totalRemit:subtotal;
  body+=amtRow(12,'INSPEC. CHARGES',inspec?inspec:0);
  body+=amtRow(13,'EXCESS',excess?excess:0);
  body+=amtRow(14,'NET TOTAL',netTotal,true,true);

  var css=[
    '.co-wrap{font-family:Calibri,Arial,sans-serif;color:#000;background:#fff}',
    '.co-title{text-align:center;font-weight:bold;font-size:13px;margin-bottom:2px}',
    '.co-sub{text-align:center;font-size:10px;margin-bottom:2px}',
    '.co-info{display:flex;justify-content:space-between;font-size:10px;font-weight:bold;margin:6px 2px 4px}',
    '.co-scroll{overflow-x:auto}',
    '.co-tbl{width:100%;border-collapse:collapse;font-size:8px;table-layout:fixed}',
    '.co-tbl th,.co-tbl td{border:1px solid #000;padding:2px 2px;text-align:center;vertical-align:middle;overflow:hidden;white-space:nowrap}',
    '.co-tbl th{font-weight:bold;background:#fff;line-height:1.15}',
    '.co-tbl td.l{text-align:left}',
    '.co-tbl td.r{text-align:right}',
    '.co-tbl tr.sub td{font-weight:bold;background:#F5F5F5}',
    '.co-sig{display:flex;justify-content:space-between;margin-top:16px;font-size:10px;font-weight:bold}',
  ].join('');

  var colgroup='<colgroup>'+
    '<col style="width:4%"><col style="width:12%">'+
    '<col style="width:5%"><col style="width:7%">'+
    '<col style="width:5%"><col style="width:7%">'+
    '<col style="width:6%">'+
    '<col style="width:5%"><col style="width:7%">'+
    '<col style="width:5%"><col style="width:7%"><col style="width:5%"><col style="width:6%">'+
    '<col style="width:5%"><col style="width:7%">'+
    '</colgroup>';

  var head='<thead>'+
    '<tr>'+
      '<th rowspan="2">SL.<br>NO</th><th rowspan="2">COMMODITY</th>'+
      '<th colspan="2">OPENING<br>BALANCE</th>'+
      '<th colspan="2">RECEIPT</th>'+
      '<th>TRANSFER</th>'+
      '<th colspan="2">TOTAL</th>'+
      '<th colspan="4">SALES</th>'+
      '<th colspan="2">CLOSING<br>BALANCE</th>'+
    '</tr>'+
    '<tr>'+
      '<th>BAGS</th><th>KGS</th><th>BAGS</th><th>KGS</th>'+
      '<th>KGS</th>'+
      '<th>BAGS</th><th>KGS</th>'+
      '<th>BAGS</th><th>KGS</th><th>RATE</th><th>AMOUNT</th>'+
      '<th>BAGS</th><th>KGS</th>'+
    '</tr>'+
    '</thead>';

  return '<style>'+css+'</style>'+
    '<div class="co-wrap">'+
      '<div class="co-title">TAMIL NADU CIVIL SUPPLIES CORPORATION - MADURAI REGION</div>'+
      '<div class="co-sub">Monthly report for the month of '+d.mo.toUpperCase()+"'"+d.yr+'</div>'+
      '<div class="co-info"><span>NAME OF THE B.C : '+d.bcName+'</span><span>CRS NO: '+d.crsId+'</span></div>'+
      '<div class="co-scroll"><table class="co-tbl">'+colgroup+head+'<tbody>'+body+'</tbody></table></div>'+
      '<div class="co-sig"><span>BILL CLERK : '+d.bcName+'</span><span>AREA SUPERVISOR</span></div>'+
    '</div>';
}

// ── REMITTANCE ─────────────────────────────────────────────────────────────
function buildRemittance(d){
  // ── Exact reproduction of the REMITTANCE (SRCB) Excel format ──────────────
  // Data from the Monthly Remittance table (meRemitStore): per-day non-cereal,
  // cereal and remittance date, plus the extra rows (poly gunny & c.box, etc.).
  var daysInMonth=new Date(d.year,d.month,0).getDate();
  var moKey=d.crsId+'_'+d.month+'_'+d.year;
  var store=(typeof meRemitStore!=='undefined'&&meRemitStore[moKey])?meRemitStore[moKey]:{};

  function fmtDate(s){ if(!s) return ''; var p=String(s).split('-'); return p.length===3?(p[2]+'/'+p[1]+'/'+p[0]):s; }
  function amt2(x){ if(x===''||x==null||isNaN(x)) return ''; return String(+(Number(x).toFixed(2))); }
  function C(x){ return '<td>'+(x==null?'':x)+'</td>'; }
  function L(x){ return '<td class="l">'+(x==null?'':x)+'</td>'; }
  function R(x){ return '<td class="r">'+(x==null?'':x)+'</td>'; }

  var grand=0, body='';
  for(var day=1; day<=daysInMonth; day++){
    var rec=store[day]||{};
    // Daily Entry is the primary source for the day's banking; the Monthly
    // Remittance table supplies the cereal / non-cereal split when keyed.
    var dayRec=(d.remitByDay && d.remitByDay[day]) ? d.remitByDay[day] : null;
    var nc=parseFloat(rec.nonCereal)||0, ce=parseFloat(rec.cereal)||0;
    if(dayRec && dayRec.src==='daily' && !nc && !ce) nc=dayRec.amount||0;
    var tot=nc+ce;
    grand+=tot;
    var rDate=rec.remitDate || (dayRec?dayRec.remitDate:'');
    var dateSales=String(day).padStart(2,'0')+'/'+String(d.month).padStart(2,'0')+'/'+d.year;
    body+='<tr>'+C(day)+C(dateSales)+C(fmtDate(rDate))+
      R(nc?amt2(nc):'')+R(ce?amt2(ce):'')+R(tot?amt2(tot):'')+'</tr>';
  }

  // ── Extra rows (poly gunny & c.box, inspection charges, custom) ───────────
  var ex=store['extra']||{};
  var sno=daysInMonth;
  function extraRow(labelDefault, e, always){
    var nc=parseFloat(ex[e+'nc'])||0, ce=parseFloat(ex[e+'ce'])||0, tot=nc+ce;
    var label=ex[e+'label']||labelDefault;
    if(!always && !label && !nc && !ce) return '';
    sno++; grand+=tot;
    return '<tr>'+C(sno)+C(fmtDate(ex[e+'date']))+C('')+L(label)+C('')+R(tot?amt2(tot):'')+'</tr>';
  }
  body+=extraRow('POLY GUNNY & C.BOX','e1',true);
  body+=extraRow('INSPEC.CHARGES','e2',true);
  body+=extraRow('','e3',false);

  body+='<tr class="sub">'+C('')+L('TOTAL')+C('')+C('')+C('')+R(amt2(grand))+'</tr>';

  var css=[
    '.rm-wrap{font-family:Calibri,Arial,sans-serif;color:#000;background:#fff}',
    '.rm-title{text-align:center;font-weight:bold;font-size:13px;margin-bottom:2px}',
    '.rm-sub{text-align:center;font-size:11px;font-weight:bold;margin-bottom:6px}',
    '.rm-tbl{width:100%;border-collapse:collapse;font-size:10px;table-layout:fixed}',
    '.rm-tbl th,.rm-tbl td{border:1px solid #000;padding:3px 5px;text-align:center;vertical-align:middle;white-space:nowrap;overflow:hidden}',
    '.rm-tbl th{font-weight:bold;background:#fff;line-height:1.2}',
    '.rm-tbl td.l{text-align:left}',
    '.rm-tbl td.r{text-align:right}',
    '.rm-tbl tr.sub td{font-weight:bold;background:#F5F5F5}',
    '.rm-sig{display:flex;justify-content:flex-end;margin-top:26px;font-size:11px;font-weight:bold}',
  ].join('');

  var colgroup='<colgroup>'+
    '<col style="width:8%"><col style="width:20%"><col style="width:21%">'+
    '<col style="width:17%"><col style="width:16%"><col style="width:18%">'+
    '</colgroup>';

  var head='<thead><tr>'+
    '<th>SL<br>NO</th><th>DATE OF SALES</th><th>DATE OF<br>REMITTANCE</th>'+
    '<th>NON-CEREAL<br>ACCOUNT</th><th>CEREAL<br>ACCOUNT</th><th>TOTAL<br>AMOUNT</th>'+
    '</tr></thead>';

  return '<style>'+css+'</style>'+
    '<div class="rm-wrap">'+
      '<div class="rm-title">TAMIL NADU CIVIL SUPPLIES CORPORATION - MADURAI REGION</div>'+
      '<div class="rm-sub">SRCB - CRS '+d.crsId+'</div>'+
      '<table class="rm-tbl">'+colgroup+head+'<tbody>'+body+'</tbody></table>'+
      '<div class="rm-sig"><span>SIGNATURE OF BC</span></div>'+
    '</div>';
}

// ── SALE TAX ───────────────────────────────────────────────────────────────
function buildSaleTax(d){
  // ── Exact reproduction of the SALE TAX Excel format ───────────────────────
  function commOf(id){ return (DSS_A||[]).concat(DSS_B||[]).find(function(x){return x.id===id;})||{rate:0,free:true}; }
  function money(v){ return String(+(Number(v||0).toFixed(2))); }
  function qty(v){ return String(+(Number(v||0).toFixed(3))); }
  function C(x){ return '<td>'+(x==null?'':x)+'</td>'; }
  function L(x){ return '<td class="l">'+(x==null?'':x)+'</td>'; }
  function R(x){ return '<td class="r">'+(x==null?'':x)+'</td>'; }

  var MAIN=[
    {sl:1,label:'B.R.A',id:'BRA'},{sl:2,label:'AAY',id:'AAY'},{sl:3,label:'OAP',id:'OAP'},
    {sl:4,label:'APS',id:'APS'},{sl:5,label:'R.R.A',id:'RRA'},{sl:6,label:'PHH BRA',id:'PHH_BRA'},
    {sl:7,label:'PHH FRK',id:'PHH_FRK'},{sl:8,label:'AAY FRK',id:'AAY_FRK'},{sl:9,label:'NPHH FRK',id:'NPHH_FRK'},
    {sl:10,label:'NPHH FRK RRA',id:'NPHH_RRA'},{sl:11,label:'WHEAT',id:'WHEAT'},{sl:12,label:'SUGAR',id:'SUGAR'},
    {sl:13,label:'SUGAR(AAY)',id:'AAY_SUGAR'},{sl:14,label:'CYL',id:'TOOR'},{sl:15,label:'P.OIL',id:'PALM'},
    {sl:16,label:'OOTY',id:'OOTY'},{sl:17,label:'TAN',id:'TAN'},{sl:18,label:'SALT(CIS)',id:'SALT_CIS'},
    {sl:19,label:'SALT(RFFS)',id:'SALT_RFFS'},{sl:20,label:'POLY BAG',id:'EMPTY_BAG'},{sl:21,label:'CARDBOARD BOX',id:'EMPTY_BOX'},
  ];
  var POL=[
    {sl:1,label:'B.R.A',id:'PB_BRA'},{sl:2,label:'WHEAT',id:'PB_WHEAT'},{sl:3,label:'SUGAR',id:'PB_SUGAR'},
    {sl:4,label:'CYL',id:'PB_TOOR'},{sl:5,label:'P.OIL',id:'PB_PALM'},
  ];

  var mainTotal=0, mainBody='';
  MAIN.forEach(function(r){
    var c=commOf(r.id), sales=d.getVal(r.id,'sales');
    var amt=c.free?0:sales*(c.rate||0); if(!c.free) mainTotal+=amt;
    mainBody+='<tr>'+C(r.sl)+L(r.label)+R(qty(sales))+R(money(c.rate))+R(c.free?'':money(amt))+'</tr>';
  });
  // PALM JAGGERY'S row (no monthly source)
  mainBody+='<tr>'+C(22)+L("PALM JAGGERY'S")+R('0')+R('')+R('')+'</tr>';
  mainBody+='<tr class="sub">'+C('')+L('TOTAL')+C('')+C('')+R(money(mainTotal))+'</tr>';

  var polTotal=0, polBody='';
  POL.forEach(function(r){
    var c=commOf(r.id), sales=d.getVal(r.id,'sales');
    var amt=c.free?0:sales*(c.rate||0); if(!c.free) polTotal+=amt;
    polBody+='<tr>'+C(r.sl)+L(r.label)+R(qty(sales))+R(money(c.rate))+R(money(amt))+'</tr>';
  });
  polBody+='<tr class="sub">'+C('')+L('TOTAL')+C('')+C('')+R(money(polTotal))+'</tr>';

  // Excess & grand total from the Monthly Remittance table
  var moKey=d.crsId+'_'+d.month+'_'+d.year;
  var rs=(typeof meRemitStore!=='undefined')?meRemitStore[moKey]:null;
  var totalRemit=0;
  try{ if(rs){ Object.keys(rs).forEach(function(k){ if(k==='extra')return; var day=rs[k]||{}; totalRemit+=(parseFloat(day.nonCereal)||0)+(parseFloat(day.cereal)||0); });
    if(rs.extra){ ['e1','e2','e3'].forEach(function(e){ totalRemit+=(parseFloat(rs.extra[e+'nc'])||0)+(parseFloat(rs.extra[e+'ce'])||0); }); } } }catch(e){}
  var excess=totalRemit>0?(totalRemit-(mainTotal+polTotal)):0;
  var grand=totalRemit>0?totalRemit:(mainTotal+polTotal);

  var css=[
    '.st-wrap{font-family:Calibri,Arial,sans-serif;color:#000;background:#fff;max-width:520px;margin:0 auto}',
    '.st-title{text-align:center;font-weight:bold;font-size:13px}',
    '.st-sub{text-align:center;font-size:11px;font-weight:bold;margin:2px 0}',
    '.st-sec{font-weight:bold;font-size:11px;margin:8px 0 2px}',
    '.st-tbl{width:100%;border-collapse:collapse;font-size:10px;table-layout:fixed}',
    '.st-tbl th,.st-tbl td{border:1px solid #000;padding:2px 5px;text-align:center;white-space:nowrap;overflow:hidden}',
    '.st-tbl th{font-weight:bold;background:#fff}',
    '.st-tbl td.l{text-align:left}.st-tbl td.r{text-align:right}',
    '.st-tbl tr.sub td{font-weight:bold;background:#F5F5F5}',
    '.st-foot{width:100%;border-collapse:collapse;font-size:10px;table-layout:fixed;margin-top:-1px}',
    '.st-foot td{border:1px solid #000;padding:2px 5px;font-weight:bold}',
    '.st-foot td.r{text-align:right}',
    '.st-note{margin-top:10px;font-size:10px;font-style:italic}',
    '.st-sig{text-align:right;margin-top:14px;font-size:10px;font-weight:bold}',
  ].join('');
  var cg='<colgroup><col style="width:12%"><col style="width:40%"><col style="width:16%"><col style="width:14%"><col style="width:18%"></colgroup>';
  var head='<thead><tr><th>S.NO</th><th>COMMODITY</th><th>QTY</th><th>RATE</th><th>TOTAL AMOUNT</th></tr></thead>';

  return '<style>'+css+'</style>'+
    '<div class="st-wrap">'+
      '<div class="st-title">TAMIL NADU CIVIL SUPPLIES CORPORATION</div>'+
      '<div class="st-sub">MADURAI REGION</div>'+
      '<div class="st-sub">SALE TAX STATEMENT &nbsp; MONTH OF: '+d.mo.toUpperCase()+"'"+d.yr+'</div>'+
      '<div class="st-sub" style="text-align:left">CRS NO: '+d.crsId+'</div>'+
      '<table class="st-tbl">'+cg+head+'<tbody>'+mainBody+'</tbody></table>'+
      '<div class="st-sec">POLICE</div>'+
      '<table class="st-tbl">'+cg+head+'<tbody>'+polBody+'</tbody></table>'+
      '<table class="st-foot">'+cg+'<tbody>'+
        '<tr><td></td><td></td><td></td><td class="r">EXCESS</td><td class="r">'+money(excess)+'</td></tr>'+
        '<tr><td></td><td></td><td></td><td class="r">GRAND TOTAL</td><td class="r">'+money(grand)+'</td></tr>'+
      '</tbody></table>'+
      '<div class="st-note">Date wise Sales details enclosed</div>'+
      '<div class="st-sig">SIGNATURE OF BC</div>'+
    '</div>';
}

// ── COLL (Admin only) ──────────────────────────────────────────────────────
function buildColl(d){
  // ── Reproduction of the COLL "Monthly Sales Report" Excel format ──────────
  // Monthly Entry provides open / receipt / total / sales / close per commodity.
  // The report's Allotment and Received-from-godown are both mapped to the
  // monthly "receipt" (Monthly Entry keeps a single receipt figure).
  function nz(v){ if(v===''||v==null) return ''; return String(+(Number(v).toFixed(3))); }
  function C(x){ return '<td>'+(x==null?'':x)+'</td>'; }
  function L(x){ return '<td class="l">'+(x==null?'':x)+'</td>'; }

  function vals(id){
    var ob=d.getVal(id,'open'), rec=d.getVal(id,'receipt');
    var tot=d.getVal(id,'total')||(ob+rec), sal=d.getVal(id,'sales');
    var cb=d.hasVal(id,'close')?d.getVal(id,'close'):Math.max(0,tot-sal);   // [C3]
    return {ob:ob,allot:rec,rec:rec,tot:tot,sal:sal,cb:cb};
  }
  function dataRow(label,id,bold){
    var v=vals(id);
    return '<tr'+(bold?' class="sub"':'')+'>'+L(label)+
      C(nz(v.ob))+C(nz(v.allot))+C(nz(v.rec))+C(nz(v.tot))+C(nz(v.sal))+C(nz(v.cb))+'</tr>';
  }
  function subRow(label, ids){
    var t={ob:0,allot:0,rec:0,tot:0,sal:0,cb:0};
    ids.forEach(function(id){ var v=vals(id); t.ob+=v.ob;t.allot+=v.allot;t.rec+=v.rec;t.tot+=v.tot;t.sal+=v.sal;t.cb+=v.cb; });
    return '<tr class="sub">'+L(label)+
      C(nz(t.ob))+C(nz(t.allot))+C(nz(t.rec))+C(nz(t.tot))+C(nz(t.sal))+C(nz(t.cb))+'</tr>';
  }
  function sectionLabel(text){ return '<tr class="sec"><td class="l" colspan="7">'+text+'</td></tr>'; }

  var MAIN_TOP=[['BRA','BRA'],['RRA','RRA']];
  var MAIN_REST=[
    ['AAY','AAY'],['O.A.P','OAP'],['A.P.S','APS'],['SUGAR','SUGAR'],['SUGAR AAY','AAY_SUGAR'],
    ['WHEAT','WHEAT'],['T.DHALL','TOOR'],['P.OIL','PALM'],['PHH BRA','PHH_BRA'],['PHH FRK','PHH_FRK'],
    ['AAY FRK','AAY_FRK'],['NPHH FRK','NPHH_FRK'],['NPHH FRK RRA','NPHH_RRA'],
  ];
  var POLICE=[['BRA','PB_BRA'],['SUGAR','PB_SUGAR'],['WHEAT','PB_WHEAT'],['T.DHALL','PB_TOOR'],['P.OIL','PB_PALM']];

  var body='';
  MAIN_TOP.forEach(function(r){ body+=dataRow(r[0],r[1]); });
  body+=subRow('TOTAL', MAIN_TOP.map(function(r){return r[1];}));
  MAIN_REST.forEach(function(r){ body+=dataRow(r[0],r[1]); });
  body+=sectionLabel('POLICE');
  POLICE.forEach(function(r){ body+=dataRow(r[0],r[1]); });

  // ADVANCE for next month (no Monthly-Entry source — shown as a blank template)
  var nextMo=STMT_MONTHS[(d.month%12)+1] || '';
  var nextYr=d.month===12 ? d.yr+1 : d.yr;
  var ADV=['BRA','PHH FRK','SUGAR','AAY SUGAR','AAY FRK','WHEAT','T.DHALL','P.OIL'];
  body+=sectionLabel("ADVANCE FOR THE MONTH OF "+nextMo.toUpperCase()+"'"+nextYr);
  ADV.forEach(function(l){ body+='<tr>'+L(l)+C('')+C('')+C('')+C('')+C('')+C('')+'</tr>'; });

  var crs=(typeof CRS_LIST!=='undefined')?CRS_LIST.find(function(c){return String(c.id)===String(d.crsId);}):null;
  var crsCode=(crs&&crs.code)?crs.code:'';

  var css=[
    '.cl-wrap{font-family:Calibri,Arial,sans-serif;color:#000;background:#fff;max-width:820px;margin:0 auto}',
    '.cl-title{text-align:center;font-weight:bold;font-size:13px;margin-bottom:2px}',
    '.cl-info{display:flex;font-size:11px;font-weight:bold;margin:4px 2px}',
    '.cl-info span{margin-right:28px}',
    '.cl-tbl{width:100%;border-collapse:collapse;font-size:10px;table-layout:fixed;margin-top:4px}',
    '.cl-tbl th,.cl-tbl td{border:1px solid #000;padding:3px 5px;text-align:center;white-space:nowrap;overflow:hidden}',
    '.cl-tbl th{font-weight:bold;background:#fff;line-height:1.15}',
    '.cl-tbl td.l{text-align:left}',
    '.cl-tbl tr.sub td{font-weight:bold;background:#F5F5F5}',
    '.cl-tbl tr.sec td{font-weight:bold;background:#EDEDED;text-align:left}',
    '.cl-sig{display:flex;justify-content:space-between;margin-top:16px;font-size:10px;font-weight:bold}',
  ].join('');
  var cg='<colgroup><col style="width:22%"><col style="width:13%"><col style="width:11%"><col style="width:16%"><col style="width:12%"><col style="width:12%"><col style="width:14%"></colgroup>';
  var head='<thead><tr>'+
    '<th>COMMODITY</th><th>Opening<br>Balance</th><th>Allotment</th><th>Received from<br>godown</th>'+
    '<th>Total</th><th>Sales</th><th>Closing<br>Balance</th></tr></thead>';

  return '<style>'+css+'</style>'+
    '<div class="cl-wrap">'+
      '<div class="cl-title">MONTHLY SALES REPORT FOR THE MONTH OF '+d.mo.toUpperCase()+"'"+d.yr+'</div>'+
      '<div class="cl-info"><span>CRS '+d.crsId+'</span>'+(crsCode?'<span>'+crsCode+'</span>':'')+'</div>'+
      '<table class="cl-tbl">'+cg+head+'<tbody>'+body+'</tbody></table>'+
      '<div class="cl-sig"><span>BILL CLERK : '+d.bcName+'</span><span>AREA SUPERVISOR</span></div>'+
    '</div>';
}

// ── CRS POLICE ─────────────────────────────────────────────────────────────
function buildCrsPolice(d){
  // ── Exact reproduction of the CRS POLICE Excel format ─────────────────────
  function commOf(id){ return (DSS_B||[]).find(function(x){return x.id===id;})||{rate:0,free:true}; }
  function nz(v){ if(v===''||v==null) return ''; return String(+(Number(v).toFixed(3))); }
  function money(v){ return String(+(Number(v||0).toFixed(2))); }
  function C(x){ return '<td>'+(x==null?'':x)+'</td>'; }
  function L(x){ return '<td class="l">'+(x==null?'':x)+'</td>'; }
  function R(x){ return '<td class="r">'+(x==null?'':x)+'</td>'; }

  var POL=[
    {sl:1,label:'B.R.A',   id:'PB_BRA'},
    {sl:2,label:'SUGAR',   id:'PB_SUGAR'},
    {sl:3,label:'WHEAT',   id:'PB_WHEAT'},
    {sl:4,label:'T.DHALL', id:'PB_TOOR'},
    {sl:5,label:'P.OIL',   id:'PB_PALM'},
  ];

  var gtotal=0, body='';
  POL.forEach(function(r){
    var c=commOf(r.id);
    var ob=d.getVal(r.id,'open'),rec=d.getVal(r.id,'receipt');
    var tot=d.getVal(r.id,'total')||(ob+rec), sal=d.getVal(r.id,'sales');
    var cb=d.hasVal(r.id,'close')?d.getVal(r.id,'close'):Math.max(0,tot-sal);   // [C3]
    var amt=c.free?0:sal*(c.rate||0); gtotal+=amt;
    body+='<tr>'+C(r.sl)+L(r.label)+
      R(nz(ob))+R(nz(rec))+R(nz(tot))+R(nz(sal))+
      R(c.free?'':money(c.rate))+R(c.free?'':(amt?money(amt):''))+R(nz(cb))+'</tr>';
  });
  body+='<tr class="sub">'+C('')+C('')+C('')+C('')+C('')+C('')+R('G.TOTAL')+R(money(gtotal))+C('')+'</tr>';

  var css=[
    '.cp-wrap{font-family:Calibri,Arial,sans-serif;color:#000;background:#fff;max-width:680px;margin:0 auto}',
    '.cp-title{text-align:center;font-weight:bold;font-size:13px}',
    '.cp-sub{text-align:center;font-size:11px;font-weight:bold;margin:2px 0}',
    '.cp-tbl{width:100%;border-collapse:collapse;font-size:10px;table-layout:fixed;margin-top:6px}',
    '.cp-tbl th,.cp-tbl td{border:1px solid #000;padding:3px 5px;text-align:center;white-space:nowrap;overflow:hidden}',
    '.cp-tbl th{font-weight:bold;background:#fff}',
    '.cp-tbl td.l{text-align:left}.cp-tbl td.r{text-align:right}',
    '.cp-tbl tr.sub td{font-weight:bold;background:#F5F5F5}',
    '.cp-sig{display:flex;justify-content:space-between;margin-top:20px;font-size:10px;font-weight:bold}',
  ].join('');
  var cg='<colgroup><col style="width:8%"><col style="width:20%"><col style="width:11%"><col style="width:11%"><col style="width:11%"><col style="width:11%"><col style="width:9%"><col style="width:11%"><col style="width:8%"></colgroup>';
  var head='<thead><tr><th>SI NO</th><th>COMMODITY</th><th>O.B</th><th>RECEIPT</th><th>TOTAL</th><th>SALES</th><th>RATE</th><th>AMOUNT</th><th>C.B</th></tr></thead>';

  return '<style>'+css+'</style>'+
    '<div class="cp-wrap">'+
      '<div class="cp-title">TAMIL NADU CIVIL SUPPLIES CORPORATION - MADURAI REGION</div>'+
      '<div class="cp-sub">POLICE RECEIPT FOR THE MONTH OF '+d.mo.toUpperCase()+"'"+d.yr+'</div>'+
      '<div class="cp-sub">CRS.'+d.crsId+'</div>'+
      '<table class="cp-tbl">'+cg+head+'<tbody>'+body+'</tbody></table>'+
      '<div class="cp-sig"><span>BILL CLERK : '+d.bcName+'</span><span>AREA SUPERVISOR</span></div>'+
    '</div>';
}

// ── B6 ─────────────────────────────────────────────────────────────────────
function buildB6(d){
  // ── Exact reproduction of the B6 Excel format (quantities, no rate/amount) ─
  function gb(id,which,kg){ return d.hasVal(id,'g_'+which) ? Math.round(d.getVal(id,'g_'+which)) : bagsOf(kg,id); }   // [C3][S1]
  function nz(v){ if(v===''||v==null) return ''; var n=Number(v)||0; return String(+(n.toFixed(3))); }
  function C(x){ return '<td>'+(x==null?'':x)+'</td>'; }
  function L(x){ return '<td class="l">'+(x==null?'':x)+'</td>'; }
  function vals(id){
    var ob=d.getVal(id,'open'),rec=d.getVal(id,'receipt');
    var tot=d.getVal(id,'total')||(ob+rec), sal=d.getVal(id,'sales');
    var cb=d.hasVal(id,'close')?d.getVal(id,'close'):Math.max(0,tot-sal);   // [C3]
    return {ob:ob,rec:rec,tot:tot,sal:sal,cb:cb,
            gob:gb(id,'open',ob),grec:gb(id,'receipt',rec),gtot:gb(id,'total',tot),
            gsal:gb(id,'sales',sal),gcb:gb(id,'close',cb)};
  }
  // commodity row: has id -> data; excess 0, shortage blank, transfer 0
  function comRow(sl,label,id){
    var v=vals(id);
    return '<tr>'+C(sl)+L(label)+
      C(v.gob)+C(nz(v.ob))+ C(v.grec)+C(nz(v.rec))+
      C(nz(d.getInsp(id,'excess')))+C(nz(d.getInsp(id,'shortage')))+C(nz(d.getInsp(id,'transfer')))+
      C(v.gtot)+C(nz(v.tot))+ C(v.gsal)+C(nz(v.sal))+ C(v.gcb)+C(nz(v.cb))+'</tr>';
  }
  function blankRow(sl,label){
    return '<tr>'+C(sl)+L(label)+C('')+C('')+C('')+C('')+C('')+C('')+C('')+C('')+C('')+C('')+C('')+C('')+C('')+'</tr>';
  }
  function subRow(label, ids){
    var t={ob:0,rec:0,tot:0,sal:0,cb:0,ex:0,sh:0,tr:0}, b={ob:0,rec:0,tot:0,sal:0,cb:0};
    ids.forEach(function(id){ if(!id) return; var v=vals(id);
      t.ob+=v.ob;t.rec+=v.rec;t.tot+=v.tot;t.sal+=v.sal;t.cb+=v.cb;
      t.ex+=d.getInsp(id,'excess'); t.sh+=d.getInsp(id,'shortage'); t.tr+=d.getInsp(id,'transfer');
      b.ob+=v.gob;b.rec+=v.grec;b.tot+=v.gtot;b.sal+=v.gsal;b.cb+=v.gcb; });
    return '<tr class="sub">'+C('')+L(label)+
      C(b.ob)+C(nz(t.ob))+ C(b.rec)+C(nz(t.rec))+
      C(nz(t.ex))+C(nz(t.sh))+C(nz(t.tr))+
      C(b.tot)+C(nz(t.tot))+ C(b.sal)+C(nz(t.sal))+ C(b.cb)+C(nz(t.cb))+'</tr>';
  }

  var body='';
  // RICE group
  body+=comRow(1,'B.RICE','BRA')+comRow(2,'PHH BRA','PHH_BRA')+comRow(3,'PHH FRK','PHH_FRK')+comRow(4,'NPHH FRK','NPHH_FRK');
  body+=subRow('RICE TOTAL',['BRA','PHH_BRA','PHH_FRK','NPHH_FRK']);
  // AAY group
  body+=comRow(5,'A.A.Y','AAY')+comRow(6,'AAY FRK','AAY_FRK');
  body+=subRow('AAY TOTAL',['AAY','AAY_FRK']);
  // RRA group
  body+=comRow(7,'R.R.A','RRA')+blankRow(8,'PHH RRA')+comRow(9,'NPHH FRK RRA','NPHH_RRA');
  body+=subRow('RRA TOTAL',['RRA','NPHH_RRA']);
  // remaining commodities
  body+=comRow(10,'OAP','OAP')+blankRow(11,'OAP FRK')+comRow(12,'APS','APS')+blankRow(13,'APS FRK');
  body+=comRow(14,'SUGAR','SUGAR')+comRow(15,'SUGAR AAY','AAY_SUGAR')+comRow(16,'WHEAT','WHEAT');
  body+=comRow(17,'CYL','TOOR')+comRow(18,'P.OIL','PALM')+comRow(19,'OOTY','OOTY')+comRow(20,'TAN','TAN');
  body+=comRow(21,'ARASU SALT (CIS)','SALT_CIS')+comRow(22,'ARASU SALT (RFFS)','SALT_RFFS');
  body+=blankRow(23,'PONGAL GIFT')+blankRow(24,'PONGAL SUGAR')+blankRow(25,'PONGAL RRA')+blankRow(26,'PONGAL DHOTHI')+blankRow(27,'PONGAL SAREE');

  var css=[
    '.b6-wrap{font-family:Calibri,Arial,sans-serif;color:#000;background:#fff}',
    '.b6-title{text-align:center;font-weight:bold;font-size:13px;margin-bottom:2px}',
    '.b6-sub{text-align:center;font-size:10px;margin-bottom:2px}',
    '.b6-info{display:flex;justify-content:space-between;font-size:10px;font-weight:bold;margin:6px 2px 4px}',
    '.b6-scroll{overflow-x:auto}',
    '.b6-tbl{width:100%;border-collapse:collapse;font-size:8px;table-layout:fixed}',
    '.b6-tbl th,.b6-tbl td{border:1px solid #000;padding:2px 2px;text-align:center;white-space:nowrap;overflow:hidden}',
    '.b6-tbl th{font-weight:bold;background:#fff;line-height:1.15}',
    '.b6-tbl td.l{text-align:left}',
    '.b6-tbl tr.sub td{font-weight:bold;background:#F5F5F5}',
    '.b6-sig{display:flex;justify-content:space-between;margin-top:16px;font-size:10px;font-weight:bold}',
  ].join('');
  var cg='<colgroup>'+
    '<col style="width:4%"><col style="width:15%">'+
    '<col style="width:5%"><col style="width:7%">'+
    '<col style="width:5%"><col style="width:7%">'+
    '<col style="width:5%"><col style="width:5%"><col style="width:5%">'+
    '<col style="width:5%"><col style="width:7%">'+
    '<col style="width:5%"><col style="width:7%">'+
    '<col style="width:5%"><col style="width:7%">'+
    '</colgroup>';
  var head='<thead>'+
    '<tr>'+
      '<th rowspan="2">SL.<br>NO</th><th rowspan="2">COMMODITY</th>'+
      '<th colspan="2">OPENING<br>BALANCE</th><th colspan="2">RECEIPT</th>'+
      '<th>EXCESS</th><th>SHORT<br>AGE</th><th>TRANS<br>FER</th>'+
      '<th colspan="2">TOTAL</th><th colspan="2">SALES</th><th colspan="2">CLOSING<br>BALANCE</th>'+
    '</tr>'+
    '<tr>'+
      '<th>BAGS</th><th>KGS</th><th>BAGS</th><th>KGS</th>'+
      '<th>KGS</th><th>KGS</th><th>KGS</th>'+
      '<th>BAGS</th><th>KGS</th><th>BAGS</th><th>KGS</th><th>BAGS</th><th>KGS</th>'+
    '</tr>'+
    '</thead>';

  return '<style>'+css+'</style>'+
    '<div class="b6-wrap">'+
      '<div class="b6-title">TAMIL NADU CIVIL SUPPLIES CORPORATION - MADURAI REGION</div>'+
      '<div class="b6-sub">Monthly report for the month of '+d.mo.toUpperCase()+"'"+d.yr+'</div>'+
      '<div class="b6-info"><span>NAME OF THE B.C : '+d.bcName+'</span><span>CRS '+d.crsId+'</span><span>CONTACT NO : '+d.bcPhone+'</span></div>'+
      '<div class="b6-scroll"><table class="b6-tbl">'+cg+head+'<tbody>'+body+'</tbody></table></div>'+
      '<div class="b6-sig"><span>BILL CLERK SIGNATURE</span><span>AREA SUPERINTENDENT</span></div>'+
    '</div>';
}

// ── CARD DETAILS ───────────────────────────────────────────────────────────
function buildCardDetails(d){
  // ── Reproduction of the CARD DETAIL Excel format ──────────────────────────
  // Left: card counts (meCardStore).  Right: gunny details + police table.
  function commOf(id){ return (DSS_B||[]).find(function(x){return x.id===id;})||{rate:0,free:true}; }
  function nz(v){ if(v===''||v==null) return ''; return String(+(Number(v).toFixed(3))); }
  function money(v){ return String(+(Number(v||0).toFixed(2))); }
  var moKey=d.crsId+'_'+d.month+'_'+d.year;

  // ── Card counts ───────────────────────────────────────────────────────────
  var cardStore=(typeof meCardStore!=='undefined'&&meCardStore[moKey])?meCardStore[moKey]:{};
  var types=(typeof ME_CARD_TYPES!=='undefined')?ME_CARD_TYPES:[];
  var totalCard=0, cardRows='';
  types.forEach(function(ct,i){
    var cd=cardStore[ct.id]||{}; var cnt=(cd.count!==undefined&&cd.count!=='')?parseInt(cd.count):0;
    if(cnt) totalCard+=cnt;
    cardRows+='<tr><td>'+(i+1)+'</td><td class="l">'+ct.label+'</td><td>'+(cnt||0)+'</td></tr>';
  });
  cardRows+='<tr class="sub"><td></td><td class="l">TOTAL CARD</td><td>'+totalCard+'</td></tr>';

  // ── Gunny details (same basis as the Gunny statement) ─────────────────────
  function gline(label,ob,rec,tot,iss,cb){
    return '<tr><td class="l">'+label+'</td><td>'+ob+'</td><td>'+rec+'</td><td>'+tot+'</td><td>'+iss+'</td><td>'+cb+'</td></tr>';
  }
  function gcell(v){ return (v===0||v===''||v==null) ? '' : String(+(Number(v).toFixed(2))); }
  function grow(label,g){
    return gline(label, gcell(g.ob), gcell(g.rec), gcell(g.tot), gcell(g.iss), (g.cb===0?'0':gcell(g.cb)));
  }
  var gunnyRows =
    grow('50 KG SS',      d.gunny.ss50)+
    grow('POLYTHENE',     d.gunny.poly)+
    grow('CARDBOARD.BOX', d.gunny.cbox);

  // ── Police table ──────────────────────────────────────────────────────────
  var POL=[['B.R.A','PB_BRA'],['SUGAR','PB_SUGAR'],['WHEAT','PB_WHEAT'],['T.DHALL','PB_TOOR'],['P.OIL','PB_PALM']];
  var gtot=0, polRows='';
  POL.forEach(function(r){
    var c=commOf(r[1]);
    var ob=d.getVal(r[1],'open'),rec=d.getVal(r[1],'receipt');
    var tot=d.getVal(r[1],'total')||(ob+rec),sal=d.getVal(r[1],'sales');
    var cb=d.hasVal(r[1],'close')?d.getVal(r[1],'close'):Math.max(0,tot-sal);   // [C3]
    var amt=c.free?0:sal*(c.rate||0); gtot+=amt;
    polRows+='<tr><td class="l">'+r[0]+'</td><td>'+nz(ob)+'</td><td>'+nz(rec)+'</td><td>'+nz(tot)+'</td><td>'+nz(sal)+'</td>'+
      '<td>'+(c.free?'':money(c.rate))+'</td><td>'+(c.free?'':(amt?money(amt):''))+'</td><td>'+nz(cb)+'</td></tr>';
  });
  polRows+='<tr class="sub"><td class="l"></td><td></td><td></td><td></td><td class="r">G.TOTAL</td><td></td><td>'+money(gtot)+'</td><td></td></tr>';

  var css=[
    '.cd-wrap{font-family:Calibri,Arial,sans-serif;color:#000;background:#fff}',
    '.cd-title{text-align:center;font-weight:bold;font-size:13px}',
    '.cd-info{display:flex;justify-content:space-between;font-size:11px;font-weight:bold;margin:4px 2px 8px}',
    '.cd-cols{display:flex;gap:22px;align-items:flex-start}',
    '.cd-col{flex:1}',
    '.cd-h{font-weight:bold;font-size:11px;margin:6px 0 3px}',
    '.cd-tbl{width:100%;border-collapse:collapse;font-size:9.5px;table-layout:fixed}',
    '.cd-tbl th,.cd-tbl td{border:1px solid #000;padding:2px 4px;text-align:center;white-space:nowrap;overflow:hidden}',
    '.cd-tbl th{font-weight:bold;background:#fff;line-height:1.15}',
    '.cd-tbl td.l{text-align:left}.cd-tbl td.r{text-align:right}',
    '.cd-tbl tr.sub td{font-weight:bold;background:#F5F5F5}',
    '.cd-sig{margin-top:16px;font-size:10px;font-weight:bold}',
  ].join('');

  var cardTbl='<div class="cd-h">CARD DETAILS</div>'+
    '<table class="cd-tbl"><colgroup><col style="width:16%"><col style="width:60%"><col style="width:24%"></colgroup>'+
    '<thead><tr><th>S.NO</th><th>CARD DETAILS</th><th>CARD</th></tr></thead><tbody>'+cardRows+'</tbody></table>';
  var gunnyTbl='<div class="cd-h">GUNNY DETAILS</div>'+
    '<table class="cd-tbl"><colgroup><col style="width:28%"><col style="width:14%"><col style="width:15%"><col style="width:14%"><col style="width:15%"><col style="width:14%"></colgroup>'+
    '<thead><tr><th>VARIETYS</th><th>OPENING</th><th>RECEIPT</th><th>TOTAL</th><th>ISSUSES</th><th>CLOSING</th></tr></thead><tbody>'+gunnyRows+'</tbody></table>';
  var polTbl='<div class="cd-h">POLICE</div>'+
    '<table class="cd-tbl"><colgroup><col style="width:20%"><col style="width:11%"><col style="width:12%"><col style="width:11%"><col style="width:11%"><col style="width:11%"><col style="width:13%"><col style="width:11%"></colgroup>'+
    '<thead><tr><th>COMMODITY</th><th>O.B</th><th>RECEIPT</th><th>TOTAL</th><th>SALES</th><th>RATE</th><th>AMOUNT</th><th>C.B</th></tr></thead><tbody>'+polRows+'</tbody></table>';

  return '<style>'+css+'</style>'+
    '<div class="cd-wrap">'+
      '<div class="cd-title">TAMILNADU CIVIL SUPPLIES CORPORATION - MADURAI</div>'+
      '<div class="cd-info"><span>CRS .'+d.crsId+'</span><span>'+d.mo.toUpperCase()+"'"+d.yr+'</span></div>'+
      '<div class="cd-cols">'+
        '<div class="cd-col">'+cardTbl+'</div>'+
        '<div class="cd-col">'+gunnyTbl+polTbl+'</div>'+
      '</div>'+
      '<div class="cd-sig">BILL CLERK : '+d.bcName+'</div>'+
    '</div>';
}

// ── RBI ────────────────────────────────────────────────────────────────────
function buildRBI(d){
  // ── Exact reproduction of the RBI STATEMENT Excel format (KGS only) ───────
  function nz(v){ if(v===''||v==null) return ''; var n=Number(v)||0; return String(+(n.toFixed(3))); }
  function C(x){ return '<td>'+(x==null?'':x)+'</td>'; }
  function L(x){ return '<td class="l">'+(x==null?'':x)+'</td>'; }

  var RICE=[
    ['BRA','BRA'],['RRA','RRA'],['AAY','AAY'],['PHH BRA','PHH_BRA'],['PHH FRK','PHH_FRK'],
    ['AAY FRK','AAY_FRK'],['NPHH FRK','NPHH_FRK'],['NPHH FRK RRA','NPHH_RRA'],['APS','APS'],['OAP','OAP'],
  ];
  var OTHER=[
    ['SUGAR','SUGAR'],['WHEAT','WHEAT'],['TD/CYL','TOOR'],['U.DHALL',null],['P.OIL','PALM'],
    ['OOTY','OOTY'],['TAN','TAN'],['SALT(CIS)','SALT_CIS'],['SALT(RFFS)','SALT_RFFS'],
  ];

  function vals(id){
    if(!id) return {ob:0,rec:0,tot:0,sal:0,cb:0,none:true};
    var ob=d.getVal(id,'open'),rec=d.getVal(id,'receipt');
    var tot=d.getVal(id,'total')||(ob+rec), sal=d.getVal(id,'sales');
    var cb=d.hasVal(id,'close')?d.getVal(id,'close'):Math.max(0,tot-sal);   // [C3]
    return {ob:ob,rec:rec,tot:tot,sal:sal,cb:cb};
  }
  var sl=0, body='', rt={ob:0,rec:0,tot:0,sal:0,cb:0,tr:0};
  RICE.forEach(function(r){
    sl++; var v=vals(r[1]);
    rt.ob+=v.ob; rt.rec+=v.rec; rt.tot+=v.tot; rt.sal+=v.sal; rt.cb+=v.cb;
    rt.tr+=(r[1]?d.getInsp(r[1],'transfer'):0);
    body+='<tr>'+C(sl)+L(r[0])+C(nz(v.ob))+C(nz(v.rec))+C(nz(r[1]?d.getInsp(r[1],'transfer'):0))+C(nz(v.tot))+C(nz(v.sal))+C(nz(v.cb))+'</tr>';
  });
  body+='<tr class="sub">'+C('')+L('TOTAL RICE')+C(nz(rt.ob))+C(nz(rt.rec))+C(nz(rt.tr))+C(nz(rt.tot))+C(nz(rt.sal))+C(nz(rt.cb))+'</tr>';
  OTHER.forEach(function(r){
    sl++; var v=vals(r[1]);
    body+='<tr>'+C(sl)+L(r[0])+C(v.none?'':nz(v.ob))+C(v.none?'':nz(v.rec))+C(v.none?'':nz(d.getInsp(r[1],'transfer')))+C(v.none?'':nz(v.tot))+C(v.none?'':nz(v.sal))+C(v.none?'':nz(v.cb))+'</tr>';
  });

  var css=[
    '.rb-wrap{font-family:Calibri,Arial,sans-serif;color:#000;background:#fff;max-width:640px;margin:0 auto}',
    '.rb-title{text-align:center;font-weight:bold;font-size:13px}',
    '.rb-info{display:flex;justify-content:space-between;font-size:11px;font-weight:bold;margin:6px 2px 4px}',
    '.rb-tbl{width:100%;border-collapse:collapse;font-size:10px;table-layout:fixed}',
    '.rb-tbl th,.rb-tbl td{border:1px solid #000;padding:3px 5px;text-align:center;white-space:nowrap;overflow:hidden}',
    '.rb-tbl th{font-weight:bold;background:#fff}',
    '.rb-tbl td.l{text-align:left}',
    '.rb-tbl tr.sub td{font-weight:bold;background:#F5F5F5}',
    '.rb-sig{display:flex;justify-content:space-between;margin-top:18px;font-size:10px;font-weight:bold}',
  ].join('');
  var cg='<colgroup><col style="width:8%"><col style="width:24%"><col style="width:12%"><col style="width:12%"><col style="width:11%"><col style="width:12%"><col style="width:11%"><col style="width:12%"></colgroup>';
  var head='<thead><tr><th>SL.NO</th><th>COMMODITY</th><th>OB</th><th>RECEIPT</th><th>TRANSFER</th><th>TOTAL</th><th>ISSUES</th><th>CB</th></tr></thead>';

  return '<style>'+css+'</style>'+
    '<div class="rb-wrap">'+
      '<div class="rb-title">RBI STATEMENT</div>'+
      '<div class="rb-info"><span>NAME OF THE CRS : '+d.crsId+'</span><span>'+d.mo.toUpperCase()+"'"+String(d.yr).slice(-2)+'</span></div>'+
      '<table class="rb-tbl">'+cg+head+'<tbody>'+body+'</tbody></table>'+
      '<div class="rb-sig"><span>BILL CLERK</span><span>AREA SUPERINTENDENT</span></div>'+
    '</div>';
}

// ── Section builder dispatcher ─────────────────────────────────────────────
function buildSectionHTML(sectionId, d){
  switch(sectionId){
    case 'crs_page1':    return buildCrsPage1(d);
    case 'receipt':      return buildReceipt(d);
    case 'crs_daily_sale': return buildCrsDailySale(d);
    case 'crs_page2':    return buildCrsPage2(d);
    case 'gunny':        return buildGunny(d);
    case 'free_com':     return buildFreeCom(d);
    case 'cost_com':     return buildCostCom(d);
    case 'remittance':   return buildRemittance(d);
    case 'sale_tax':     return buildSaleTax(d);
    case 'coll':         return buildColl(d);
    case 'crs_police':   return buildCrsPolice(d);
    case 'b6':           return buildB6(d);
    case 'card_details': return buildCardDetails(d);
    case 'rbi':          return buildRBI(d);
    default: return '<div>Section not implemented</div>';
  }
}

// ── Preview a section ──────────────────────────────────────────────────────
function stmtPreviewSection(sectionId){
  var crsId  = parseInt(document.getElementById('stmt-crs').value);
  var month  = parseInt(document.getElementById('stmt-month').value);
  var year   = parseInt(document.getElementById('stmt-year').value);

  if(!crsId){ alert('Please select a CRS shop first.'); return; }

  var sec = STMT_SECTIONS.find(function(s){ return s.id===sectionId; });
  var d   = stmtGetData(crsId, month, year);
  var html = buildSectionHTML(sectionId, d);

  var panel   = document.getElementById('stmt-preview-panel');
  var content = document.getElementById('stmt-preview-content');
  var title   = document.getElementById('stmt-preview-title');
  var sub     = document.getElementById('stmt-preview-sub');

  if(title) title.textContent = sec ? sec.label : sectionId;
  if(sub)   sub.textContent   = 'CRS '+crsId+' \u2014 '+d.mo+' '+d.yr+(sec&&sec.copies>1?' \u2014 \xd7'+sec.copies+' copies':'');

  if(content){
    content.innerHTML = '<style>'+STMT_PRINT_CSS+'</style>' + html;
  }
  if(panel){
    panel.style.display='block';
    // guarded: scrollIntoView is missing in some embedded/preview engines, and
    // a throw here used to abandon the rest of the function
    try{ panel.scrollIntoView({behavior:'smooth',block:'start'}); }catch(e){}
  }
  stmtCurrentPreview = { sectionId, d, sec, html };
  stmtRecordHistory(sectionId, d, sec);   // [M6]
}

function stmtPrintSection(){
  if(!stmtCurrentPreview) return;
  var sec = stmtCurrentPreview.sec;
  var printWin = window.open('','_blank','width=900,height=700');
  var copies = sec ? sec.copies : 1;
  var html = '';
  for(var i=0; i<copies; i++) html += stmtCurrentPreview.html;
  printWin.document.write('<html><head><title>'+
    (sec?sec.label:'Statement')+' - CRS '+stmtCurrentPreview.d.crsId+' '+stmtCurrentPreview.d.mo+' '+stmtCurrentPreview.d.yr+
    '</title><style>'+STMT_PRINT_CSS+'</style></head><body>'+html+'</body></html>'
  );
  printWin.document.close();
  printWin.focus();
  setTimeout(function(){ printWin.print(); }, 500);
}

// ── Print selected sections ────────────────────────────────────────────────
function stmtPrint(){
  var crsId = parseInt(document.getElementById('stmt-crs').value);
  var month = parseInt(document.getElementById('stmt-month').value);
  var year  = parseInt(document.getElementById('stmt-year').value);
  if(!crsId){ alert('Please select a CRS shop.'); return; }
  var selected = Object.keys(stmtSelectedSections);
  if(!selected.length){ alert('Please select at least one section.'); return; }
  var d = stmtGetData(crsId, month, year);
  var html = '';
  selected.forEach(function(id){
    var sec = STMT_SECTIONS.find(function(s){ return s.id===id; });
    var copies = sec ? sec.copies : 1;
    var secHtml = buildSectionHTML(id, d);
    for(var i=0; i<copies; i++) html += secHtml;
  });
  var printWin = window.open('','_blank','width=900,height=700');
  printWin.document.write('<html><head><title>TNCSC Statements - CRS '+crsId+' '+STMT_MONTHS[month]+' '+year+'</title>'+
    '<style>'+STMT_PRINT_CSS+'</style></head><body>'+html+'</body></html>');
  printWin.document.close();
  printWin.focus();
  setTimeout(function(){ printWin.print(); }, 600);
}

// ── PDF download (print-to-PDF via browser) ────────────────────────────────
function stmtPDFDownload(){ stmtPrint(); }

// ── Excel download ─────────────────────────────────────────────────────────
function stmtExcelDownload(){
  var crsId = parseInt(document.getElementById('stmt-crs').value);
  var month = parseInt(document.getElementById('stmt-month').value);
  var year  = parseInt(document.getElementById('stmt-year').value);
  if(!crsId){ alert('Please select a CRS shop.'); return; }
  var d = stmtGetData(crsId, month, year);
  var selected = Object.keys(stmtSelectedSections);
  if(!selected.length){ alert('Please select at least one section.'); return; }

  // Build HTML table export (opens in Excel)
  var html = '<html><head><meta charset="UTF-8"/></head><body>';
  selected.forEach(function(id){
    var sec = STMT_SECTIONS.find(function(s){ return s.id===id; });
    html += '<h2>'+(sec?sec.label:id)+'</h2>';
    html += buildSectionHTML(id, d);
    html += '<br><br>';
  });
  html += '</body></html>';

  var blob = new Blob([html], {type:'application/vnd.ms-excel'});
  var url  = URL.createObjectURL(blob);
  var a    = document.createElement('a');
  a.href   = url;
  a.download = 'TNCSC_CRS'+crsId+'_'+STMT_MONTHS[month]+'_'+year+'_Statements.xls';
  a.click();
  URL.revokeObjectURL(url);
}

// [M1] Dead duplicate removed — a later, live definition of this function supersedes it.  (generateStatement — identical live copy defined further down)

// ═══ SAMPLE DATA ENGINE — SEEDS EVERY MODULE ══════════════════════════════
// Fills, for one CRS + month, every store the Statement sections read from:
//   entryStore (Daily Entry) · inspectionStore (Inspection) · receiptStore
//   (Receipt) · monthlyStore (Monthly Entry) · meRemitStore (Remittance) ·
//   meGunnyStore (Gunny Stock) · meCardStore (Card Details) · salesCloseStore
// Every figure is derived from the same daily ledger, so the sections tally
// with each other exactly the way real keyed-in data would.

// [S1] the sample-data engine uses the global bagDiv()
