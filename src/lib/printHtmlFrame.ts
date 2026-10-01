'use client';

/**
 * Print a document of its own from a hidden frame — the page's furniture can
 * never reach the paper, and no pop-up is opened. Used by reports that build
 * their own print document (the OAP / APS / ANP statement); the statements
 * print a server-made PDF the same way (statements/printFrame.ts).
 */
const FRAME_ID = 'html-print-frame';

export function printHtmlDocument(html: string): Promise<void> {
  document.getElementById(FRAME_ID)?.remove();
  return new Promise((resolve, reject) => {
    const frame = document.createElement('iframe');
    frame.id = FRAME_ID;
    frame.setAttribute('aria-hidden', 'true');
    frame.tabIndex = -1;
    frame.style.cssText = 'position:fixed;right:0;bottom:0;width:1px;height:1px;border:0;opacity:0;pointer-events:none';
    frame.onload = () => {
      const win = frame.contentWindow;
      if (!win) return reject(new Error('The print frame could not be opened.'));
      setTimeout(() => {
        try {
          win.focus();
          win.print();
          resolve();
        } catch (e) {
          reject(e instanceof Error ? e : new Error(String(e)));
        }
      }, 150);
    };
    frame.srcdoc = html;
    document.body.appendChild(frame);
  });
}
