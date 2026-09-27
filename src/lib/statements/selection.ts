/**
 * Which statements a print, a PDF or an Excel export is for (office,
 * 2026-09-27): exactly the ones ticked NOW, each once, in the order the
 * statements are listed.
 *
 *   `offered` — the sections this shop and month offer, in their listed order
 *   `ticked`  — the checkbox state, id → ticked
 *
 * Never click order, and never an id the shop no longer offers: a tick left
 * from another month, or from a section that has since become unavailable,
 * would otherwise be sent to the server and refused (or, worse, printed).
 * An id can only appear once because `offered` lists it once.
 */
export function selectedInOrder(offered: readonly string[], ticked: Readonly<Record<string, boolean>>): string[] {
  return offered.filter((id) => ticked[id] === true);
}
