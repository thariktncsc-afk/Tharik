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
 */
export default function AppShell() {
  return <div id="app-root" dangerouslySetInnerHTML={{ __html: APP_MARKUP }} />;
}
