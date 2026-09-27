/**
 * Print one area of a screen, and nothing else (office, 2026-09-27).
 *
 * A screen that calls `window.print()` prints the whole application: the navy
 * sidebar down the left of every sheet, the statement squeezed into what is
 * left and cut off at wherever the page happened to be scrolled. The rules
 * live in `src/app/print.css`; this puts the body in the state they wait for,
 * and takes it out again when the dialog closes — whether the person printed
 * or cancelled.
 *
 * The area itself is marked `className="print-area"` by the screen.
 */
export const PRINT_AREA_CLASS = 'print-area';
const BODY_CLASS = 'printing-area';

export function printArea(): void {
  if (typeof document === 'undefined') return;
  const body = document.body;
  body.classList.add(BODY_CLASS);
  // `afterprint` covers Print and Cancel alike; the timer is there for the
  // browsers that never fire it, so the screen cannot be left blanked.
  let done = false;
  const restore = () => {
    if (done) return;
    done = true;
    body.classList.remove(BODY_CLASS);
    window.removeEventListener('afterprint', restore);
  };
  window.addEventListener('afterprint', restore);
  setTimeout(restore, 60000);
  try {
    window.print();
  } finally {
    // Chrome blocks on the dialog and fires afterprint on close; Safari
    // returns at once. Either way `restore` runs exactly once.
    setTimeout(restore, 1000);
  }
}
