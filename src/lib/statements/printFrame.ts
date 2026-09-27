'use client';

/**
 * Print a finished statement document without opening a window
 * (office, 2026-09-27).
 *
 * The statements used to print from `window.open()`. Chrome lets a page open
 * a window only while it is answering a click, and two things broke that:
 * the document is built on the server first, so `window.open` ran after an
 * `await` — late enough, on a slow link, to lose the click; and the portrait
 * half of a mixed print was opened from `afterprint`, which is never a click.
 * Both came back as "The print window was blocked by the browser".
 *
 * A same-origin <iframe> needs no pop-up permission at all: the document is
 * written into it and ITS window is printed. What Chrome prints is that
 * document alone — its own @page rules, its own width — with nothing of the
 * application around it: no sidebar, no header, no scroll container, no
 * offset. That is the whole of the "pushed to the left" fault, removed at
 * the root rather than hidden with CSS.
 *
 * One frame at a time: every print first removes whatever an earlier one
 * left, so nothing old can be printed again.
 */

const FRAME_ID = 'stmt-print-frame';

/** Take away any frame an earlier print left behind. */
export function clearPrintFrame(): void {
  document.getElementById(FRAME_ID)?.remove();
}

/**
 * Write `doc` into a fresh hidden frame and print it. Resolves once the print
 * dialog has closed — printed or cancelled — so a caller can run a second job
 * after the first. Rejects if the frame cannot be printed at all.
 */
export function printInFrame(doc: string, opts: { print?: (win: Window) => void } = {}): Promise<void> {
  clearPrintFrame();
  return new Promise<void>((resolve, reject) => {
    const frame = document.createElement('iframe');
    frame.id = FRAME_ID;
    frame.setAttribute('aria-hidden', 'true');
    frame.tabIndex = -1;
    // Off-screen, but a real size (A4 landscape at 96 dpi) so the document
    // lays out as it would in a window — a zero-sized frame gives the
    // statements a zero-wide viewport to measure against. It never shows.
    frame.style.cssText = 'position:fixed;left:-20000px;top:0;width:1123px;height:794px;border:0;opacity:0;pointer-events:none';

    let settled = false;
    const done = (err?: Error) => {
      if (settled) return;
      settled = true;
      // Left in place a moment: removing a frame while its print job is
      // still spooling can cancel the job in some browsers. The next print
      // removes it in any case.
      setTimeout(() => {
        if (document.getElementById(FRAME_ID) === frame) frame.remove();
      }, 2000);
      if (err) reject(err);
      else resolve();
    };

    frame.onload = async () => {
      const win = frame.contentWindow;
      if (!win) return done(new Error('The print frame could not be opened.'));
      try {
        // Fonts first, then two frames so the statements that are sized to
        // fill their page (fillSheets, run as the document is read) have
        // been laid out at that size before the page is captured.
        // Both waits are bounded: a tab that is not being drawn (in the
        // background, minimised) runs no animation frames at all, and a print
        // must never hang on one.
        const settle = (p: Promise<unknown>, ms: number) => Promise.race([p, new Promise((r) => setTimeout(r, ms))]);
        await settle(win.document.fonts?.ready ?? Promise.resolve(), 3000);
        await settle(new Promise((r) => win.requestAnimationFrame(() => win.requestAnimationFrame(r))), 150);
        win.addEventListener('afterprint', () => done(), { once: true });
        win.focus();
        // Blocks in Chrome until the dialog closes; afterprint resolves it.
        // (`opts.print` stands in for the dialog in tools/verify-print-flow.)
        if (opts.print) {
          opts.print(win);
          return done();
        }
        win.print();
        // Browsers whose print() returns at once, and which fire afterprint
        // only when the dialog closes, are covered by the listener above.
        // Chrome fires afterprint during print(); this is the fallback for
        // any that fire nothing at all.
        setTimeout(() => done(), 60000);
      } catch (e) {
        done(e instanceof Error ? e : new Error(String(e)));
      }
    };

    // srcdoc, not document.write: the frame's load event then fires once the
    // whole document — styles, the fill script — has been read.
    frame.srcdoc = doc;
    document.body.appendChild(frame);
  });
}
