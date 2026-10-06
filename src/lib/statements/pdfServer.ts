/**
 * The print document → ONE PDF, every page on its own paper (office,
 * 2026-09-27).
 *
 * Why a PDF at all. A browser sends an HTML print job to a physical printer
 * with ONE layout. The statements mix landscape sheets (CRS Page 2, Receipt,
 * Gunny, Police, RBI…) with portrait ones (Page 1, Remittance, Sale Tax,
 * COLL), so whichever layout the dialog holds, half of them were shrunk onto
 * the wrong-shaped paper — small, pushed to one side, a strip of empty page
 * beside them. Splitting the job by orientation fixed the paper but made two
 * print sessions, which the office would not accept.
 *
 * A PDF carries a page size per page. This renders the SAME print document
 * the statements have always printed from (printDoc.ts, with its per-sheet
 * named pages and `@page :first`) in headless Chrome, so the PDF has each
 * sheet on A4 in its own orientation. When that PDF is printed, the PDF
 * viewer turns each page to match the paper instead of shrinking it: one
 * print session, every sheet full size.
 *
 * Chrome: on Vercel (Linux) the serverless build in @sparticuz/chromium; on
 * a developer's machine the Chrome already installed (or CHROME_PATH). One
 * browser is kept per server process and a fresh page used per request.
 */
import type { Browser } from 'puppeteer-core';

let browserPromise: Promise<Browser> | null = null;

const LOCAL_CHROME = [
  process.env.CHROME_PATH,
  'C:/Program Files/Google/Chrome/Application/chrome.exe',
  'C:/Program Files (x86)/Google/Chrome/Application/chrome.exe',
  '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  '/usr/bin/google-chrome',
  '/usr/bin/chromium',
  '/usr/bin/chromium-browser',
].filter(Boolean) as string[];

async function launch(): Promise<Browser> {
  const puppeteer = (await import('puppeteer-core')).default;
  const serverless = process.platform === 'linux' && (process.env.VERCEL || process.env.AWS_LAMBDA_FUNCTION_NAME);
  if (serverless) {
    const chromium = (await import('@sparticuz/chromium')).default;
    return puppeteer.launch({
      args: chromium.args,
      executablePath: await chromium.executablePath(),
      headless: true,
    });
  }
  const fs = await import('node:fs');
  const executablePath = LOCAL_CHROME.find((p) => fs.existsSync(p));
  if (!executablePath) throw new Error('No Chrome found to build the PDF. Install Chrome or set CHROME_PATH.');
  return puppeteer.launch({ executablePath, headless: true, args: ['--disable-gpu', '--no-first-run'] });
}

async function browser(): Promise<Browser> {
  if (!browserPromise) {
    browserPromise = launch().catch((e) => {
      browserPromise = null;
      throw e;
    });
  }
  const b = await browserPromise;
  if (!b.connected) {
    browserPromise = null;
    return browser();
  }
  return b;
}

/**
 * One PV sheet (pvStatement.ts `buildPVTable` markup) → PDF, on the paper the
 * sheet names (A4 or Legal, landscape), fitted to it by `fitSource` — the
 * very function the screen fits it with (pvFit.ts), so the download is the
 * preview (office, 2026-10-06).
 *
 * The markup comes from the browser, so the page it is drawn in can reach
 * nothing: every request it makes is refused (the caller has already refused
 * markup holding a script, a link or a URL).
 */
export async function pvSheetToPdf(sheet: string, fitSource: string): Promise<Uint8Array> {
  const b = await browser();
  const page = await b.newPage();
  try {
    await page.setRequestInterception(true);
    page.on('request', (r) => {
      if (r.isInterceptResolutionHandled()) return;
      // Only the fonts this function embeds (data: URLs); nothing else, anywhere.
      if (r.url().startsWith('data:')) void r.continue();
      else void r.abort('blockedbyclient');
    });
    await page.setViewport({ width: 1600, height: 1000 });
    const doc = `<!doctype html><html><head><meta charset="utf-8"><style>${await pvFontCss()}html,body{margin:0;background:#fff}</style></head><body>${sheet}</body></html>`;
    await page.setContent(doc, { waitUntil: 'load', timeout: 30000 });
    await page.evaluate(async () => {
      await document.fonts?.ready;
    });
    // Measured in PRINT, as the paper will lay it out; then printed, and the
    // pages counted. One page, always: if a PDF ever came out longer, the
    // sheet is taken down a little and drawn again (office, 2026-10-06).
    await page.emulateMediaType('print');
    for (let attempt = 0, shrink = 1; attempt < 6; attempt++, shrink *= 0.96) {
      const fit = await page.evaluate(`(${fitSource})(document, { shrink: ${shrink} })`);
      if (!fit) throw new Error('The PV sheet could not be laid out.');
      const pdf = await page.pdf({ preferCSSPageSize: true, printBackground: true, displayHeaderFooter: false, timeout: 45000 });
      if (pdfPageCount(pdf) === 1) return pdf;
    }
    throw new Error('The PV would not fit on one page.');
  } finally {
    await page.close().catch(() => undefined);
  }
}

/** How many pages a PDF from Chrome has (its page objects, `/Type /Page`). */
export function pdfPageCount(pdf: Uint8Array): number {
  const text = Buffer.from(pdf).toString('latin1');
  return (text.match(/\/Type\s*\/Page(?![a-zA-Z])/g) ?? []).length;
}

let fontCss: Promise<string> | null = null;
/**
 * Liberation Sans (SIL OFL, shipped with pdf.js) standing in for Arial — the
 * same character widths, so a server without Arial (Vercel's Linux Chrome)
 * measures and prints the PV exactly as an office PC does.
 */
function pvFontCss(): Promise<string> {
  if (!fontCss) {
    fontCss = (async () => {
      const fs = await import('node:fs/promises');
      const path = await import('node:path');
      const dir = path.join(process.cwd(), 'node_modules', 'pdfjs-dist', 'standard_fonts');
      const face = async (file: string, weight: number) => {
        try {
          const b64 = (await fs.readFile(path.join(dir, file))).toString('base64');
          return `@font-face{font-family:Arial;font-weight:${weight};font-style:normal;src:url(data:font/ttf;base64,${b64}) format('truetype')}`;
        } catch {
          return ''; // the machine's own fonts, then
        }
      };
      return (await face('LiberationSans-Regular.ttf', 400)) + (await face('LiberationSans-Bold.ttf', 700)) + (await face('LiberationSans-Bold.ttf', 800));
    })();
  }
  return fontCss;
}

/**
 * Print `doc` (a whole HTML document from buildPrintDocument) to PDF.
 * `preferCSSPageSize` is what lets each sheet keep its own page: the size
 * comes from the document's @page rules, never from a single `format`.
 */
export async function htmlToPdf(doc: string): Promise<Uint8Array> {
  const b = await browser();
  const page = await b.newPage();
  try {
    await page.setContent(doc, { waitUntil: 'load', timeout: 30000 });
    // The statements that fill their page are sized by a script as the
    // document is read; wait for fonts, then let that layout settle.
    await page.evaluate(async () => {
      await document.fonts?.ready;
      await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
    });
    const pdf = await page.pdf({
      preferCSSPageSize: true,
      printBackground: true,
      displayHeaderFooter: false,
      timeout: 45000,
    });
    return pdf;
  } finally {
    await page.close().catch(() => undefined);
  }
}
