/* Gunny Stock on the statements — resolved the way the SCREEN resolves it.

   THE BUG THIS FIXES. Gunny Stock Management (Monthly Entry) worked out
   Opening, Receipt, Total and Closing every time it rendered, but only WROTE
   them to meGunnyStore when somebody edited a row. stmtGetData read that
   stored record and used it whenever any field in it was non-zero, so the
   statements printed whatever the figures happened to be the last time a row
   was touched. CRS 19, September 2026: the screen showed Receipt 205 / Total
   496 for 50 KG SS and 14 and 57 for POLY and C. BOX, while the statement
   printed Receipt 10 / Total 301 and nothing at all for the other two —
   because the stored row had been written on 11 September and POLY and C. BOX
   had never been touched, so they fell back to a different derivation again
   (the EMPTY_BAG / EMPTY_BOX monthly rows, which are not where those bags
   come from).

   THE RULE, which is now the only one. Per item, exactly as GunnyTable.tsx
   displays it:

     Opening  this month's own figure if it has one, else last month's
              Closing carried forward, else 0
     Receipt  the office's imported figure if there is one, else the month's
              Sales Close totals for that pack type, else the bag counts on
              the month's own sales rows
     Issues   as keyed, else 0
     Total    Opening + Receipt
     Closing  Total − Issues

   So the statement cannot drift from the screen again: nothing is read from
   the stored `receipt`, `total` or `closing`, which are derived copies, and
   the two places now share one rule rather than each having their own.

   WHAT IS NOT CHANGED. The keyed figures — Opening, Issues, and an imported
   Receipt — are still the office's, and still win. This only decides what to
   show where nothing was keyed.

   Both the Gunny statement and the gunny report at the foot of the Receipt
   statement read d.gunny, so both are corrected together.

   Concatenated after 11-statement-core.js, so stmtGetData already exists.
*/

// The commodities whose sales bags make up each pack type's receipt —
// monthly-entry/lib.ts SC_PACK_TYPES, which is what the screen sums.
var GUNNY_PACK_COMMS = {
  GUNNY: ['BRA','NPHH_FRK','PHH_FRK','AAY_FRK','AAY','OAP','APS','TOOR','PHH_BRA','WHEAT','RRA','NPHH_RRA','PB_BRA','PB_WHEAT','PB_TOOR'],
  POLY:  ['SUGAR','AAY_SUGAR','SALT_CIS','SALT_RFFS','PB_SUGAR'],
  CBOX:  ['PALM','OOTY','TAN','PB_PALM']
};
var GUNNY_ITEM_TYPE = { ss50: 'GUNNY', poly: 'POLY', cbox: 'CBOX' };

function gunnyHasValue(v){
  return v !== undefined && v !== null && v !== '';
}

/** The previous month's key for a shop — where a carried Opening comes from. */
function gunnyPrevKey(crsId, month, year){
  return crsId + '_' + (month === 1 ? 12 : month - 1) + '_' + (month === 1 ? year - 1 : year);
}

/**
 * One item, resolved. `d` carries the month's own figures (getVal/hasVal), so
 * the bag counts are the same ones the monthly grid shows.
 */
function gunnyLiveItem(d, itemId){
  var type = GUNNY_ITEM_TYPE[itemId] || 'GUNNY';
  var store = (typeof meGunnyStore !== 'undefined' && meGunnyStore) ? meGunnyStore : {};
  var rec  = (store[d.key] || {})[itemId] || {};
  var prev = (store[gunnyPrevKey(d.crsId, d.month, d.year)] || {})[itemId] || {};

  // Opening: keyed or carried — never recomputed, it is a balance.
  var opening = gunnyHasValue(rec.opening) ? (parseFloat(rec.opening) || 0)
              : gunnyHasValue(prev.closing) ? (parseFloat(prev.closing) || 0)
              : 0;

  // Receipt: the office's imported figure, else Sales Close, else the month's
  // own sales bags. The stored `receipt` is a derived copy and is ignored.
  var receipt;
  if(gunnyHasValue(rec.receiptImported)){
    receipt = parseFloat(rec.receiptImported) || 0;
  } else if(d.salesClose && (d.salesClose.gunny !== undefined || d.salesClose.poly !== undefined || d.salesClose.cbox !== undefined)){
    var sc = d.salesClose;
    receipt = (type === 'GUNNY' ? sc.gunny : type === 'POLY' ? sc.poly : sc.cbox) || 0;
  } else {
    receipt = 0;
    (GUNNY_PACK_COMMS[type] || []).forEach(function(id){
      // [S1] the same bag count the grid shows: the office's own figure where
      // it keyed one, else the kgs divided by the pack size.
      receipt += d.hasVal(id, 'g_sales') ? Math.round(d.getVal(id, 'g_sales')) : bagsOf(d.getVal(id, 'sales'), id);
    });
  }

  // Issues: a keyed figure (an administrator's correction) wins; otherwise
  // POLY and C.BOX take the month's own SALES of those bags, which is where
  // the shop keys them and the one place they are counted (office,
  // 2026-09-26 — same rule as gunnyRowFor on the Gunny Stock screen). 50 KG SS
  // has no commodity row of its own and stays keyed.
  var GUNNY_SALES_COMM = {POLY: 'EMPTY_BAG', CBOX: 'EMPTY_BOX'};
  var salesComm = GUNNY_SALES_COMM[type];
  var issues = gunnyHasValue(rec.issues) ? (parseFloat(rec.issues) || 0)
             : salesComm ? (parseFloat(d.getVal(salesComm, 'sales')) || 0)
             : 0;
  return { ob: opening, rec: receipt, tot: opening + receipt, iss: issues, cb: opening + receipt - issues, src: 'gunny' };
}

var _gunnyOrigStmtGetData = stmtGetData;
stmtGetData = function(crsId, month, year){
  var d = _gunnyOrigStmtGetData.apply(this, arguments);
  try{
    d.gunny = {
      ss50: gunnyLiveItem(d, 'ss50'),
      poly: gunnyLiveItem(d, 'poly'),
      cbox: gunnyLiveItem(d, 'cbox')
    };
  }catch(e){
    // Leave the earlier resolution in place rather than lose the statement.
  }
  return d;
};
