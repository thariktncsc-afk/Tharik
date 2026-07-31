/* Monthly Entry — C.S (cumulative shortage) column  [+]
   Some shops' monthly workbooks carry a C.S column between Amount and
   Closing Balance: stock deducted without a sale, applied AFTER Total
   (Closing = Total - Sales - C.S). It is stored per commodity as `cs` on the
   monthly record and shown in Monthly Entry as a read-only column that stays
   hidden for months (and shops) that have no C.S figures — same pattern as
   the Excess / Shortage / Transfer columns.

   Overrides (classic-script redefinition, this file loads last):
     inspCell             - adds the 'cs' badge theme
     applyAdjColVisibility- drives visibility from the flags object's own keys
                            so the monthly grid can pass a `cs` flag; Daily
                            Entry still passes only excess/shortage/transfer
   Adds:
     meAdjFlags           - inspection flags OR'd with figures carried by the
                            month's saved records (imported workbooks have
                            adjustment columns but no inspection entries) */

function inspCell(val, kind, bdr){
  var THEME = {
    excess:   {bg:'#DCFCE7', fg:'#166534', bd:'#86EFAC', sign:'+'},
    shortage: {bg:'#FEE2E2', fg:'#B91C1C', bd:'#FCA5A5', sign:'−'},
    transfer: {bg:'#FEF3C7', fg:'#92400E', bd:'#FDE047', sign:'→'},
    cs:       {bg:'#F3E8FF', fg:'#7C3AED', bd:'#D8B4FE', sign:'−'}
  };
  var t = THEME[kind];
  var inner = val
    ? '<span style="display:inline-block;background:' + t.bg + ';border:1px solid ' + t.bd +
      ';color:' + t.fg + ';font-size:11px;font-weight:800;padding:3px 7px;border-radius:5px;min-width:38px">' +
      t.sign + (+Number(val).toFixed(3)) + '</span>'
    : '<span style="color:#CBD5E1;font-size:11px">—</span>';
  return '<td data-adjcol="' + kind + '" style="padding:4px 3px;text-align:center;border-bottom:' + bdr + '">' + inner + '</td>';
}

function applyAdjColVisibility(tbodyIds, footIds, flags){
  var KINDS = Object.keys(flags);
  tbodyIds.forEach(function(tbId){
    var tbody = document.getElementById(tbId);
    if(!tbody) return;
    var table = tbody.closest ? tbody.closest('table') : null;
    if(!table) return;
    KINDS.forEach(function(k){
      var show = !!flags[k];
      table.querySelectorAll('[data-adjcol="' + k + '"]').forEach(function(cell){
        cell.style.display = show ? '' : 'none';
      });
    });
  });
  // Footer adjustment cells carry data-adjcol too, so they hide with the
  // column automatically — the label colspan stays fixed.
}

// Adjustment flags for the Monthly grid: a column is shown when either the
// Inspection screen or the month's saved records carry a figure for it.
function meAdjFlags(key, crsId, month, year){
  var f = inspFlagsForMonth(crsId, month, year);
  f.cs = false;
  var rec = monthlyStore[key];
  if(rec){
    ['a','b'].forEach(function(sec){
      var blk = rec[sec] || {};
      Object.keys(blk).forEach(function(id){
        var r = blk[id] || {};
        f.excess   = f.excess   || !!(parseFloat(r.excess)   || 0);
        f.shortage = f.shortage || !!(parseFloat(r.shortage) || 0);
        f.transfer = f.transfer || !!(parseFloat(r.transfer) || 0);
        f.cs       = f.cs       || !!(parseFloat(r.cs)       || 0);
      });
    });
  }
  return f;
}
