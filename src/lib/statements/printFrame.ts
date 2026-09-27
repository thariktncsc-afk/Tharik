'use client';

/**
 * Print the statements PDF in ONE print session, without opening a window
 * (office, 2026-09-27).
 *
 * The statements used to print from `window.open()`, which Chrome allows only
 * while the page is still answering a click. The document is built on the
 * server first, so the window opened after an `await` — late enough to lose
 * the click — and came back as "The print window was blocked by the browser".
 *
 * Now the server returns ONE PDF (/api/statements/pdf) with every selected
 * sheet on A4 in its own orientation. It is loaded into a hidden same-origin
 * <iframe> from a blob: URL and ITS window is printed: no pop-up permission is
 * needed, nothing of the application can reach the paper (the PDF is the
 * whole document), and the browser's PDF viewer turns each page to the paper
 * instead of shrinking it — so portrait and landscape sheets go through one
 * print dialog together, each full size.
 *
 * One frame at a time: every print first removes whatever an earlier one left,
 * so nothing old can be printed again.
 */

const FRAME_ID = 'stmt-print-frame';

/** Take away any frame an earlier print left behind, and free its file. */
export function clearPrintFrame(): void {
  const old = document.getElementById(FRAME_ID) as HTMLIFrameElement | null;
  if (!old) return;
  const url = old.getAttribute('data-url');
  old.remove();
  if (url) URL.revokeObjectURL(url);
}

/**
 * Load the PDF into a fresh hidden frame and open the browser's print dialog
 * for it. Resolves once the dialog has been asked for; rejects when this
 * browser will not print a PDF from a frame, so the caller can offer to open
 * the file instead.
 */
export function printPdfBlob(pdf: Blob, opts: { print?: (win: Window) => void } = {}): Promise<void> {
  clearPrintFrame();
  return new Promise<void>((resolve, reject) => {
    const url = URL.createObjectURL(pdf.type === 'application/pdf' ? pdf : new Blob([pdf], { type: 'application/pdf' }));
    const frame = document.createElement('iframe');
    frame.id = FRAME_ID;
    frame.setAttribute('data-url', url);
    frame.setAttribute('aria-hidden', 'true');
    frame.tabIndex = -1;
    // The PDF viewer only loads in a frame that has a size and is not
    // display:none — so it is given one, placed where it is never seen.
    frame.style.cssText = 'position:fixed;right:0;bottom:0;width:1px;height:1px;border:0;opacity:0;pointer-events:none';

    let settled = false;
    const finish = (err?: Error) => {
      if (settled) return;
      settled = true;
      if (err) reject(err);
      else resolve();
    };

    frame.onload = () => {
      const win = frame.contentWindow;
      if (!win) return finish(new Error('The print frame could not be opened.'));
      // The viewer is still starting when `load` fires; a short pause lets
      // it take the print request rather than drop it.
      setTimeout(() => {
        try {
          if (opts.print) opts.print(win);
          else {
            win.focus();
            win.print();
          }
          finish();
        } catch (e) {
          finish(e instanceof Error ? e : new Error(String(e)));
        }
      }, 300);
    };
    // A viewer that never loads must not leave the office waiting.
    setTimeout(() => finish(new Error('The statements PDF did not open for printing.')), 20000);

    frame.src = url;
    document.body.appendChild(frame);
  });
}
