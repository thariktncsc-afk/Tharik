/* Opening balance carries across skipped days — Daily Entry  [+]
   Added after the port; not part of TNCSC_CRS_Demo_19 (1).html, so
   tools/verify-parity.mjs skips this file (see NEW_ENGINE there).

   Each day's Closing is meant to become the next day's Opening. The ported
   getAutoOpening() in 03-daily-entry.js only ever looked at the IMMEDIATELY
   preceding calendar day, with one special case for the 1st of a month. So a
   single skipped day broke the chain: open 16 June with no sheet for 15 June
   and every Opening fell back to blank, silently, with no warning that the
   carried figure had been dropped. The shop then either re-keyed the stock by
   hand or — far worse — left it at zero, and the month's Total and Closing
   were wrong from that day on.

   Stock does not move on a day the shop did not trade, so the correct Opening
   after a gap is the closing of the last day that WAS keyed. This walks back
   to that sheet however far away it is, per commodity, rather than giving up
   after one day.

   Two supporting behaviours, because a silent carry across a long gap is its
   own hazard on statutory paperwork:
     - the Daily Entry subtitle now names the date the Opening came from, and
       says how many days had no sheet;
     - a gap of a week or more is called out in amber rather than shown in the
       same neutral badge as an ordinary day-to-day carry.

   Nothing else changes: getAutoOpening() keeps its signature and its
   "return null means let them type it" contract, so renderSection()'s
   read-only/amber handling in 03-daily-entry.js is untouched. */

// A carry crossing more than this is reported as a gap needing a second look.
var OC_GAP_WARN_DAYS = 7;

/* Entry dates held for one shop, newest first.
   Rebuilt when the number of keys in entryStore changes, which is the only
   way a date can appear or disappear — re-saving an existing day replaces a
   key without adding one, and the cache holds dates only, never figures, so
   the values below are always read fresh. */
var OC_CACHE = { crsId: null, count: -1, dates: null };

function ocEntryDatesDesc(crsId) {
  if (typeof entryStore === 'undefined' || !entryStore || !crsId) return [];
  var keys = Object.keys(entryStore);
  if (OC_CACHE.crsId === String(crsId) && OC_CACHE.count === keys.length && OC_CACHE.dates) {
    return OC_CACHE.dates;
  }
  var prefix = String(crsId) + '_';
  var dates = [];
  for (var i = 0; i < keys.length; i++) {
    var k = keys[i];
    if (k.lastIndexOf(prefix, 0) !== 0) continue;      // CRS 2 must not match CRS 23
    var ds = k.slice(prefix.length);
    if (/^\d{4}-\d{2}-\d{2}$/.test(ds)) dates.push(ds);
  }
  dates.sort();                                         // ISO dates sort as text
  dates.reverse();                                      // newest first
  OC_CACHE = { crsId: String(crsId), count: keys.length, dates: dates };
  return dates;
}

/* The most recent sheet BEFORE dateStr that carries a figure for this
   commodity, or null when the shop has never keyed it. */
function ocCarrySource(crsId, dateStr, commId, sec) {
  if (!crsId || !dateStr) return null;
  var dates = ocEntryDatesDesc(crsId);
  for (var i = 0; i < dates.length; i++) {
    var ds = dates[i];
    if (ds >= dateStr) continue;                        // strictly earlier days only
    var rec = entryStore[String(crsId) + '_' + ds];
    if (rec && rec[sec] && rec[sec][commId] !== undefined) {
      return { date: ds, close: parseFloat(rec[sec][commId].close) || 0 };
    }
  }
  return null;
}

/* The most recent sheet before dateStr for the shop as a whole — what the
   subtitle reports, independent of any one commodity. */
function ocLastSheetBefore(crsId, dateStr) {
  var dates = ocEntryDatesDesc(crsId);
  for (var i = 0; i < dates.length; i++) if (dates[i] < dateStr) return dates[i];
  return null;
}

/* Whole days between two ISO dates with no sheet: consecutive days give 0. */
function ocGapDays(fromDs, toDs) {
  var a = new Date(fromDs + 'T00:00:00'), b = new Date(toDs + 'T00:00:00');
  if (isNaN(a.getTime()) || isNaN(b.getTime())) return 0;
  return Math.max(0, Math.round((b - a) / 86400000) - 1);
}

function ocFmtDate(ds) {
  var d = new Date(ds + 'T00:00:00');
  if (isNaN(d.getTime())) return ds;
  return d.toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' });
}

/* Overrides 03-daily-entry.js. Same contract: a number to carry and lock, or
   null to leave the field hand-editable. */
function getAutoOpening(crsId, dateStr, commId, sec) {
  var src = ocCarrySource(crsId, dateStr, commId, sec);
  return src ? src.close : null;
}

/* Subtitle badge. The ported onEntryChange() writes "Opening auto-filled from
   <yesterday>" only when yesterday has a sheet, and "Month start — enter
   opening stock" on every 1st — both now wrong, since the carry reaches past
   yesterday and a 1st usually carries from the previous month. */
function ocPaintCarryBanner() {
  var sEl = document.getElementById('ef-sub');
  var cEl = document.getElementById('entry-crs');
  var dEl = document.getElementById('entry-date');
  if (!sEl || !cEl || !dEl) return;
  var crsId = cEl.value, date = dEl.value;
  if (!crsId || !date) return;

  var d = new Date(date + 'T00:00:00');
  if (isNaN(d.getTime())) return;
  var dStr = d.toLocaleDateString('en-IN', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' });

  function badge(bg, fg, text) {
    return dStr + ' <span style="background:' + bg + ';color:' + fg + ';font-size:10px;' +
      'padding:2px 7px;border-radius:4px;margin-left:6px">' + text + '</span>';
  }

  var from = ocLastSheetBefore(crsId, date);
  if (!from) {
    sEl.innerHTML = badge('rgba(220,252,231,.2)', '#86EFAC', 'No earlier sheet — enter opening stock');
    return;
  }
  var gap = ocGapDays(from, date);
  if (gap === 0) {
    sEl.innerHTML = badge('rgba(255,255,255,.15)', '#fff', 'Opening carried from ' + ocFmtDate(from));
  } else {
    var warn = gap >= OC_GAP_WARN_DAYS;
    sEl.innerHTML = badge(
      warn ? 'rgba(254,243,199,.28)' : 'rgba(255,255,255,.15)',
      warn ? '#FDE047' : '#fff',
      'Opening carried from ' + ocFmtDate(from) +
      ' — ' + gap + (gap === 1 ? ' day' : ' days') + ' with no sheet');
  }
}

/* Repaint after the ported renderer has run. Wrapped rather than redefined:
   onEntryChange() is 60 lines of unrelated layout work and copying it here to
   change two strings would leave two versions to keep in step. */
(function () {
  if (typeof onEntryChange !== 'function') return;
  var inner = onEntryChange;
  onEntryChange = function () {
    var r = inner.apply(this, arguments);
    try { ocPaintCarryBanner(); } catch (e) { /* never block the grid */ }
    return r;
  };
})();
