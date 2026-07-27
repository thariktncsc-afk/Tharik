import APP_MARKUP from '@/markup';

/**
 * Renders the whole application markup in one pass.
 *
 * It is deliberately injected as a single HTML string rather than hand-written
 * JSX: the screens are driven end-to-end by the imperative engine in
 * /public/js, which owns the DOM by id and writes into it with innerHTML. One
 * injection means the browser parses exactly the document the original
 * single-file build produced, so nothing about the layout or behaviour shifts.
 *
 * This is a server component, so the markup ships in the initial HTML response
 * and there is no blank first paint. React never re-renders or diffs this
 * subtree, which leaves the engine free to mutate it.
 *
 * `suppressHydrationWarning` quiets a mismatch that is guaranteed by design:
 * during hydration React compares the `__html` string against the DOM's actual
 * innerHTML, and the two can never be equal — the browser normalises the
 * original markup as it parses it (`<input ... />` serialises back without the
 * slash, `<option selected>` becomes `selected=""`, unbalanced tags get
 * closed). React keeps the server DOM either way ("won't be patched up"), so
 * the warning is pure noise here; it applies to this element only, and real
 * errors elsewhere in the app still surface.
 */
export default function AppShell() {
  return (
    <div id="app-root" suppressHydrationWarning dangerouslySetInnerHTML={{ __html: APP_MARKUP }} />
  );
}
