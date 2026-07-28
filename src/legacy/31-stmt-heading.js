/* Statement Generation subtitle — driven by the selection  [+]
   Added after the port; not part of TNCSC_CRS_Demo_19 (1).html, so
   tools/verify-parity.mjs skips this file (see NEW_ENGINE there).

   The ported markup hard-coded the subtitle as "CRS 9 June 2026 format",
   which was a sample left in the source: it stayed on CRS 9 / June 2026 no
   matter which shop or period the user picked, so every shop except 9 saw a
   heading that contradicted the statement below it.

   The line now carries id="stmt-page-sub" (see the redesign block in
   src/markup/pageStatement.ts) and is rewritten here from the three selects
   that already drive the page: #stmt-crs, #stmt-month and #stmt-year.

   WHERE THIS HOOKS IN. Every path that changes what the page is about already
   goes through one of three functions, so wrapping those covers all of them:
     initStmtPage()      — opening the page (also the CRS-user auto-select,
                           which lands via stmtInitCRSDropdown)
     stmtOnCRSChange()   — picking a different shop
     stmtOnPeriodChange()— picking a different month or year
   Each wrapper calls the previous definition first, so the chain already
   installed by 26-crs29.js (which wraps stmtOnCRSChange to re-render the
   section cards) is preserved rather than replaced. */

function stmtHeadingText() {
  var base = 'Generate official TNCSC monthly statements';
  var crsEl = document.getElementById('stmt-crs');
  var moEl = document.getElementById('stmt-month');
  var yrEl = document.getElementById('stmt-year');
  if (!crsEl || !crsEl.value) return base;

  var id = parseInt(crsEl.value, 10);
  if (!id) return base;

  // CRS_LIST is the same record the dropdown was built from, so the name here
  // always matches the option the user is looking at.
  var shop = (typeof CRS_LIST !== 'undefined')
    ? CRS_LIST.find(function (c) { return c.id === id; })
    : null;

  var out = base + ' — CRS ' + id;
  if (shop && shop.name) out += ' — ' + shop.name;

  // Month/year are optional trailers: if either select is missing or unset the
  // heading still names the shop rather than falling back to a wrong period.
  var mo = moEl && moEl.value ? parseInt(moEl.value, 10) : 0;
  var yr = yrEl && yrEl.value ? yrEl.value : '';
  var moName = (typeof STMT_MONTHS !== 'undefined' && mo) ? STMT_MONTHS[mo] : '';
  if (moName && yr) out += ' · ' + moName + ' ' + yr + ' format';

  return out;
}

function stmtUpdateHeading() {
  var el = document.getElementById('stmt-page-sub');
  if (el) el.textContent = stmtHeadingText();
}

var _hdrOrigInitStmtPage = (typeof initStmtPage === 'function') ? initStmtPage : null;
if (_hdrOrigInitStmtPage) {
  initStmtPage = function () {
    var r = _hdrOrigInitStmtPage.apply(this, arguments);
    try { stmtUpdateHeading(); } catch (e) {}
    return r;
  };
}

var _hdrOrigOnCRSChange = (typeof stmtOnCRSChange === 'function') ? stmtOnCRSChange : null;
if (_hdrOrigOnCRSChange) {
  stmtOnCRSChange = function () {
    var r = _hdrOrigOnCRSChange.apply(this, arguments);
    try { stmtUpdateHeading(); } catch (e) {}
    return r;
  };
}

var _hdrOrigOnPeriodChange = (typeof stmtOnPeriodChange === 'function') ? stmtOnPeriodChange : null;
if (_hdrOrigOnPeriodChange) {
  stmtOnPeriodChange = function () {
    var r = _hdrOrigOnPeriodChange.apply(this, arguments);
    try { stmtUpdateHeading(); } catch (e) {}
    return r;
  };
}
