/**
 * Did the browser KEEP the sign-in?
 *
 * The session cookie (`crs_session`) is HttpOnly, so the page cannot see it.
 * A browser that refuses it — cookies blocked for the site, an extension, a
 * page opened over plain http while the cookie is Secure — still gets the
 * server's "yes", sends the next request without a cookie, and the route
 * guard puts it straight back on the login screen: "Connecting…", then the
 * same form, no message (office, 2026-09-28 — an administrator pressed Sign
 * In 19 times in 33 seconds; the server accepted every one).
 *
 * So the sign-in answer also sets this marker: the same path, SameSite,
 * Secure and lifetime as the session, carrying nothing but "1", and readable
 * by the page. A browser that refused the session refused the marker with it.
 * No marker → the page asks the server once (GET /api/session) before saying
 * anything, so a browser that keeps the session but hides the marker is never
 * refused; still no session → the person is told what to do.
 *
 * Shared by the route (server) and authClient (browser), so it imports
 * nothing — session.ts uses node:crypto, which the browser cannot load.
 */
export const SIGNED_IN_MARKER = 'crs_signed_in';

/** Is the marker in this `document.cookie` string? */
export function hasSignedInMarker(cookieString: string): boolean {
  return cookieString.split(';').some((c) => c.trim().startsWith(`${SIGNED_IN_MARKER}=`));
}

/** What the person is told when the server said yes and the browser kept nothing. Plain words, no internals. */
export const SIGN_IN_NOT_KEPT =
  'Your username and password are correct, but this browser did not keep the sign-in, so the app cannot open. ' +
  'In Chrome, tap the icon at the left of the address bar → Cookies and site data → allow this site ' +
  '(or turn off any cookie-blocking extension), then press Sign In again.';
