/* Regular vs Advance godown receipts  [+]
   Added after the port; not part of TNCSC_CRS_Demo_19 (1).html, so
   tools/verify-parity.mjs skips this file (see NEW_ENGINE there).

   A godown receipt is now typed. The Receipt Entry form carries a Regular /
   Advance choice above the commodity table, so the type is picked BEFORE the
   quantities are keyed, and the choice is written onto the stored row.

   Both types may be entered on the same date, and either may be entered more
   than once a day: each save appends its own row to receiptStore, which was
   already the shape of that store, so nothing about multiplicity needed
   changing — only the type had to start being recorded.

   LEGACY ROWS. Receipts saved before this file existed (including the two
   seeded ones) carry no `type`. They are read as Regular rather than being
   migrated, so a shop's existing history keeps counting toward COLL exactly as
   it did; treating unknown as Advance would silently drop stock out of every
   statement that already balanced.

   WHY IT MATTERS: the COLL statement counts Regular receipts only — see
   24-coll.js, which reads rcpRegularQty() rather than the raw month total. */

var RECEIPT_TYPES = [
  { id: 'regular', label: 'Regular', desc: 'Counts toward COLL', color: '#0369A1' },
  { id: 'advance', label: 'Advance', desc: 'Excluded from COLL', color: '#B45309' },
];

/* Unknown/absent type reads as Regular — see LEGACY ROWS above. */
function rcpTypeOf(r) {
  return (r && r.type === 'advance') ? 'advance' : 'regular';
}

function rcpSelectedType() {
  var el = document.querySelector('input[name="rcp-type"]:checked');
  return el ? el.value : 'regular';
}

/* Month total for one commodity, counting Regular receipts only. */
function rcpRegularQty(crsId, month, year, id) {
  var prefix = year + '-' + String(month).padStart(2, '0');
  var store = (typeof receiptStore !== 'undefined') ? receiptStore : [];
  var total = 0;
  store.forEach(function (r) {
    if (parseInt(r.crsId, 10) !== parseInt(crsId, 10)) return;
    if (String(r.date || '').indexOf(prefix) !== 0) return;
    if (rcpTypeOf(r) !== 'regular') return;
    var it = (r.items || {})[id];
    if (it) total += parseFloat(it.qty) || 0;
  });
  return total;
}

/* True when the shop has ANY godown receipt row this month. Distinguishes "no
   receipts were keyed" (fall back to the Daily Entry figure) from "receipts
   were keyed and they were all Advance" (a genuine Regular total of zero). */
function rcpHasRowsInMonth(crsId, month, year) {
  var prefix = year + '-' + String(month).padStart(2, '0');
  var store = (typeof receiptStore !== 'undefined') ? receiptStore : [];
  return store.some(function (r) {
    return parseInt(r.crsId, 10) === parseInt(crsId, 10) &&
      String(r.date || '').indexOf(prefix) === 0;
  });
}

// ── Type selector on the entry form ─────────────────────────────────────────
// Built in JS and inserted above the commodity table so src/markup/pageReceipt.ts
// (ported, held to byte parity) needs no redesign block.
function rcpEnsureTypeRow() {
  if (document.getElementById('rcp-type-row')) return;
  var tbody = document.getElementById('rp-tbody');
  if (!tbody) return;
  var table = tbody.closest('table');
  var anchor = table ? table.parentElement : null;
  if (!anchor || !anchor.parentNode) return;

  var row = document.createElement('div');
  row.id = 'rcp-type-row';
  row.style.cssText =
    'margin:4px 0 14px;padding:12px 14px;border:1px solid var(--border);' +
    'border-radius:10px;background:var(--bg)';

  row.innerHTML =
    '<div style="font-size:11px;font-weight:800;color:var(--text);text-transform:uppercase;' +
      'letter-spacing:.05em;margin-bottom:9px">Receipt Type <span style="color:#DC2626">*</span></div>' +
    '<div style="display:flex;gap:10px;flex-wrap:wrap">' +
      RECEIPT_TYPES.map(function (t, i) {
        return '<label style="flex:1 1 190px;display:flex;align-items:flex-start;gap:9px;' +
          'border:2px solid var(--border);border-radius:9px;padding:10px 12px;cursor:pointer;' +
          'background:#fff" data-rcp-type="' + t.id + '">' +
          '<input type="radio" name="rcp-type" value="' + t.id + '"' + (i === 0 ? ' checked' : '') +
            ' style="width:auto;margin-top:2px;cursor:pointer"/>' +
          '<span>' +
            '<span style="display:block;font-size:13px;font-weight:800;color:' + t.color + '">' +
              t.label + '</span>' +
            '<span style="display:block;font-size:10px;color:var(--muted);margin-top:1px">' +
              t.desc + '</span>' +
          '</span>' +
        '</label>';
      }).join('') +
    '</div>';

  anchor.parentNode.insertBefore(row, anchor);
  row.addEventListener('change', rcpPaintTypeRow);
  rcpPaintTypeRow();
}

/* Outline the chosen card, so the active type is readable at a glance rather
   than only from the radio dot. */
function rcpPaintTypeRow() {
  var sel = rcpSelectedType();
  RECEIPT_TYPES.forEach(function (t) {
    var el = document.querySelector('#rcp-type-row [data-rcp-type="' + t.id + '"]');
    if (!el) return;
    var on = t.id === sel;
    el.style.borderColor = on ? t.color : 'var(--border)';
    el.style.background = on ? t.color + '12' : '#fff';
  });
}

function rcpResetTypeRow() {
  var first = document.querySelector('#rcp-type-row input[name="rcp-type"]');
  if (first) first.checked = true;
  rcpPaintTypeRow();
}

var _rcpOrigOpenForm = (typeof openReceiptForm === 'function') ? openReceiptForm : null;
if (_rcpOrigOpenForm) {
  openReceiptForm = function () {
    var r = _rcpOrigOpenForm.apply(this, arguments);
    // After the original, which builds the commodity table this row anchors to.
    try { rcpEnsureTypeRow(); rcpResetTypeRow(); } catch (e) {}
    return r;
  };
}

var _rcpOrigInitPage = (typeof initReceiptPage === 'function') ? initReceiptPage : null;
if (_rcpOrigInitPage) {
  initReceiptPage = function () {
    var r = _rcpOrigInitPage.apply(this, arguments);
    try { rcpEnsureTypeRow(); } catch (e) {}
    return r;
  };
}

/* The ported saveReceipt pushes the row itself, so the type is stamped onto
   the row it appended rather than by reimplementing the save. */
var _rcpOrigSave = (typeof saveReceipt === 'function') ? saveReceipt : null;
if (_rcpOrigSave) {
  saveReceipt = function () {
    var before = (typeof receiptStore !== 'undefined') ? receiptStore.length : 0;
    var type = rcpSelectedType();
    var r = _rcpOrigSave.apply(this, arguments);
    try {
      if (typeof receiptStore !== 'undefined' && receiptStore.length > before) {
        receiptStore[receiptStore.length - 1].type = type;
        if (typeof renderReceiptLog === 'function') renderReceiptLog();
      }
    } catch (e) {}
    return r;
  };
}
