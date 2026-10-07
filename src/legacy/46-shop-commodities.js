// ════════════════════════════════════════════════════════════════════════════
// A SHOP'S OWN COMMODITY ON ITS STATEMENTS (office, 2026-10-07)
//
// A commodity the Commodity Master gives to ONE shop (scope 'shop', e.g. CRS
// 10's OAP FRK) prints on that shop's statements, on a row of its own — it
// is a commodity of its own, never added into another — where the shop's
// Order puts it: directly after the statement's row for the commodity the
// shop's Order has just before it (OAP FRK, Order 10 → after OAP, Order 9).
// Each statutory form keeps its own row order; the new row takes the
// preceding row's serial with "A" (12 → 12A), the way Page 2 already has
// 1 / 1A, so no other row is renumbered.
//
// A shop without a commodity of its own gets its rows back exactly as they
// were, so every other shop's statements are byte-identical. All Shops
// commodities are not touched here: the forms are the office's.
// ════════════════════════════════════════════════════════════════════════════

/** The shop's own (scope 'shop') main-section commodities, in Order. */
function stmtOwnCommodities(d){
  var m = (typeof STMT_COMMODITY_MASTER !== 'undefined' && STMT_COMMODITY_MASTER) || [];
  var cid = Number(d && d.crsId);
  return m.filter(function(r){
    return r && r.scope === 'shop' && Number(r.shopId) === cid && r.active !== false && r.section === 'a' && !r.crs29Only;
  }).sort(function(a, b){ return (Number(a.order) || 0) - (Number(b.order) || 0); });
}

/** Does this shop have `id` as its own commodity? */
function stmtShopHas(d, id){
  return stmtOwnCommodities(d).some(function(r){ return r.id === id; });
}

/**
 * `rows` with the shop's own commodities put in: each after the row whose
 * commodity comes just before it in the shop's Order. `idOf(row)` reads a
 * row's commodity id (null for a subtotal); `make(c, prev)` builds the new row
 * from the master row `c` and the row it follows. A commodity the form
 * already has a row for, or with nothing before it, is not added.
 */
function stmtWithOwnRows(d, rows, idOf, make){
  var own = stmtOwnCommodities(d);
  if (!own.length) return rows;
  var m = (typeof STMT_COMMODITY_MASTER !== 'undefined' && STMT_COMMODITY_MASTER) || [];
  function orderOf(id){
    for (var i = 0; i < m.length; i++) if (m[i] && m[i].id === id) return Number(m[i].order);
    return NaN;
  }
  var out = rows.slice();
  own.forEach(function(c){
    if (out.some(function(r){ return idOf(r) === c.id; })) return;
    var at = -1, best = -Infinity;
    out.forEach(function(r, i){
      var id = idOf(r);
      if (!id) return;
      var o = orderOf(id);
      if (o < Number(c.order) && o > best){ best = o; at = i; }
    });
    if (at < 0) return;
    out.splice(at + 1, 0, make(c, out[at]));
  });
  return out;
}

/** A serial for the row after `sl`: 12 → "12A", "1A" → "1B". */
function stmtSlAfter(sl){
  var s = String(sl == null ? '' : sl);
  var mm = /^(\d+)([A-Z]?)$/.exec(s);
  if (!mm) return s;
  return mm[1] + (mm[2] ? String.fromCharCode(mm[2].charCodeAt(0) + 1) : 'A');
}

/** The label a form prints for a commodity of the shop's own: its English name, as the forms write theirs. */
function stmtOwnLabel(c){ return String((c && (c.en || c.id)) || '').toUpperCase(); }

// ── Commodities kept in KGS ONLY on the statements (office, 2026-10-07) ────
// OAP FRK prints no bag counts: its bag cells are blank on every form that
// has them (CRS Page 2, Free Com, B6), and it adds no bags to a total
// (stmtBagCounts gives it 0). Its kgs print as ever. The same list is
// src/lib/engine/commodities.ts KGS_ONLY (the PV) — keep the two alike.
var STMT_KGS_ONLY = ['OAP_FRK'];
function stmtKgsOnly(id){ return STMT_KGS_ONLY.indexOf(id) !== -1; }
/** A bag cell: blank for a kgs-only commodity, else the figure as given. */
function stmtBagCell(id, v){ return stmtKgsOnly(id) ? '' : v; }
