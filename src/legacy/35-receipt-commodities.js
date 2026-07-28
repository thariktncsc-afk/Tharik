/* Empty Card+Box and Empty Polythene Bag are not godown receipts  [+]
   Added after the port; not part of TNCSC_CRS_Demo_19 (1).html, so
   tools/verify-parity.mjs skips this file (see NEW_ENGINE there).

   The Receipt entry table renders DSS_A.concat(DSS_B) — the same commodity
   list Daily and Monthly Entry use — so it inherited rows 20 and 21,
   EMPTY_BOX and EMPTY_BAG. Those two are empties the shop returns, not stock
   received from the godown, so they have no place on a receipt.

   RECEIPT ONLY. The list itself is untouched: both commodities still appear on
   Daily Entry and Monthly Entry, where they are sold and counted. Only the
   rows this one table renders are dropped, which is why this filters the
   rendered table rather than the shared DSS_A/DSS_B arrays.

   The serial column is renumbered afterwards, since the ported builder writes
   (i+1) from its position in the full list and would otherwise leave the
   numbering running 1..19 then jumping. Nothing downstream reads those two
   ids from a receipt: saveReceipt() collects '#rp-tbody input[data-id]', so
   removing the rows removes the inputs with them. */

var RECEIPT_EXCLUDED_COMMODITIES = ['EMPTY_BOX', 'EMPTY_BAG'];

function rcpStripNonGodownRows() {
  var tbody = document.getElementById('rp-tbody');
  if (!tbody) return;

  RECEIPT_EXCLUDED_COMMODITIES.forEach(function (id) {
    var inp = tbody.querySelector('input[data-id="' + id + '"]');
    var row = inp ? inp.closest('tr') : null;
    if (row) row.remove();
  });

  // Renumber the serial cell — it is the first cell of each row.
  Array.prototype.forEach.call(tbody.rows, function (row, i) {
    if (row.cells.length) row.cells[0].textContent = String(i + 1);
  });
}

var _rcpOrigBuildTable = (typeof rpBuildTable === 'function') ? rpBuildTable : null;
if (_rcpOrigBuildTable) {
  rpBuildTable = function () {
    var r = _rcpOrigBuildTable.apply(this, arguments);
    try { rcpStripNonGodownRows(); } catch (e) {}
    return r;
  };
}
