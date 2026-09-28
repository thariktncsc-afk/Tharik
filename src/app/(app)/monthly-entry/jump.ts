/**
 * Dashboard → Quick Actions → "Card Details & Allotment" → Monthly Entry,
 * scrolled to that section (office, 2026-09-28). The section is the existing
 * CardAllot on Monthly Entry — there is no second Card Details page.
 *
 * Two signals, because either alone is unreliable:
 *  - the Dashboard leaves a one-time marker in sessionStorage before it
 *    navigates, which Monthly Entry reads on mount — however late the router
 *    gets round to putting `#card-details` in the address bar;
 *  - `#card-details` in the address, for a reload or a link someone keeps.
 * Monthly Entry scrolls once the month's data has loaded and the section is
 * on the page (a shop must be chosen — an administrator is asked to choose
 * one), then clears both, so changing month afterwards does not jump again.
 */
export const CARD_DETAILS_ID = 'card-details';
export const CARD_DETAILS_HREF = `/monthly-entry#${CARD_DETAILS_ID}`;
const MARK = 'crs.jump';

/** The Dashboard, just before it navigates. */
export function requestCardDetailsJump() {
  try {
    sessionStorage.setItem(MARK, CARD_DETAILS_ID);
  } catch {
    /* storage refused: the #card-details in the address still carries it */
  }
}

/** Monthly Entry, on mount: was it sent here for Card Details? */
export function cardDetailsJumpWanted(): boolean {
  let marked = false;
  try {
    marked = sessionStorage.getItem(MARK) === CARD_DETAILS_ID;
  } catch {
    /* ignore */
  }
  return marked || window.location.hash === `#${CARD_DETAILS_ID}`;
}

/** Done: forget the request, and take the fragment off the address. */
export function clearCardDetailsJump() {
  try {
    sessionStorage.removeItem(MARK);
  } catch {
    /* ignore */
  }
  if (window.location.hash === `#${CARD_DETAILS_ID}`) {
    window.history.replaceState(window.history.state, '', window.location.pathname + window.location.search);
  }
}
