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
              Closing carried forward, else 0 — a stored copy of the carry
              (openingAuto) follows last month's Closing (office, 2026-09-30)
     Receipt  an administrator's typed figure if there is one, else the packs
              the month's SALES emptied — each commodity's sales ÷ its pack
              size (bagsOf), into the pack its type says; Wheat / RRA / NPHH
              FRK RRA as the month's latest receipt's Gunny / Poly switch
              says (engine/gunnyPack.ts, office 2026-09-30). Not Sales Close,
              not a stored bag count.
     Issues   as typed, else POLY / C.BOX's month's sales of those bags
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
// engine/gunnyPack.ts PACK_BASE, which is what the screen sums.
var GUNNY_PACK_COMMS = {
  GUNNY: ['BRA','NPHH_FRK','PHH_FRK','AAY_FRK','AAY','OAP','APS','TOOR','PHH_BRA','WHEAT','RRA','NPHH_RRA','PB_BRA','PB_WHEAT','PB_TOOR'],
  POLY:  ['SUGAR','AAY_SUGAR','SALT_CIS','SALT_RFFS','PB_SUGAR'],
  CBOX:  ['PALM','OOTY','TAN','PB_PALM']
};
// The Receipt page's Gunny / Poly switch applies to these (PACK_SWITCHABLE).
var GUNNY_PACK_SWITCHABLE = ['WHEAT','RRA','NPHH_RRA','PB_BRA'];

/** The month's pack type of every commodity — packTypesFor in engine/gunnyPack.ts. */
function gunnyPackTypes(crsId, month, year){
  var out = {};
  Object.keys(GUNNY_PACK_COMMS).forEach(function(t){ GUNNY_PACK_COMMS[t].forEach(function(id){ out[id] = t; }); });
  var prefix = year + '-' + String(month).padStart(2, '0') + '-';
  var rows = ((typeof receiptStore !== 'undefined' && receiptStore) ? receiptStore : [])
    .filter(function(r){ return r && Number(r.crsId) === Number(crsId) && typeof r.date === 'string' && r.date.indexOf(prefix) === 0; })
    .slice().sort(function(a, b){ return a.date === b.date ? (Number(a.id) || 0) - (Number(b.id) || 0) : (a.date < b.date ? -1 : 1); });
  GUNNY_PACK_SWITCHABLE.forEach(function(id){
    var latest;
    rows.forEach(function(r){
      var it = r.items ? r.items[id] : undefined;
      if (it === undefined) return;
      var p = it && typeof it === 'object' ? it.pack : null;
      latest = (p === 'POLY' || p === 'GUNNY') ? p : 'GUNNY';
    });
    if (latest !== undefined) out[id] = latest;
  });
  return out;
}
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

  // Opening: keyed or carried — never recomputed, it is a balance. A stored
  // copy of the carry follows last month's Closing.
  var carriedCopy = !!rec.openingAuto && gunnyHasValue(prev.closing);
  var opening = (gunnyHasValue(rec.opening) && !carriedCopy) ? (parseFloat(rec.opening) || 0)
              : gunnyHasValue(prev.closing) ? (parseFloat(prev.closing) || 0)
              : 0;

  // Receipt: an administrator's typed figure, else the packs the month's sales
  // emptied. The stored `receipt` is a derived copy and is ignored.
  var receipt;
  if(gunnyHasValue(rec.receiptImported)){
    receipt = parseFloat(rec.receiptImported) || 0;
  } else {
    receipt = 0;
    var types = gunnyPackTypes(d.crsId, d.month, d.year);
    Object.keys(types).forEach(function(id){
      if (types[id] === type) receipt += bagsOf(d.getVal(id, 'sales'), id);
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
