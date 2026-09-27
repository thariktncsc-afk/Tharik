/**
 * The PAPER the statements actually print on (office, 2026-09-27).
 *
 *   node tools/verify-print-pdf.mjs
 *
 * Not the markup, and not the preview: this builds the real print document,
 * prints it with headless Chrome, and reads the page sizes back out of the
 * PDF. That is the only way the fault below was visible at all —
 *
 *   The Daily Sales builder carries `@media print{@page{size:A3 landscape}}`
 *   in its own <style>, and an unnamed @page is the DOCUMENT's page. Every
 *   sheet after the first claims its own named page at a page break, but
 *   Chrome takes the FIRST page's size from the document's page and changes
 *   size only at a break — so page one came out **A3 landscape** in an
 *   otherwise A4 job, and a printer set to A4 shrank the whole document to
 *   fit it. That is why the statements printed small and squeezed.
 *
 * The fix is an A4 default (landscape, so nothing is shrunk to fit a narrower
 * default) plus `@page :first` carrying the first statement's own paper.
 *
 * Skipped when Chrome is not on this machine, or when
 * `public/golden-stores.json` is missing (it is gitignored live data).
 */
import { execFileSync } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { register } from 'node:module';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
// `@/…` → src/…, and the template JSON without an explicit import attribute —
// the app's bundler supplies both.
const srcUrl = pathToFileURL(join(root, 'src') + '/').href;
register(
  `data:text/javascript,${encodeURIComponent(
    `export async function resolve(s,c,n){` +
      `if(s.startsWith('@/'))s=${JSON.stringify(srcUrl)}+s.slice(2)+(/\\.[a-z]+$/.test(s)?'':'.ts');` +
      `const r=await n(s,c);return r.url.endsWith('.json')?{...r,importAttributes:{type:'json'}}:r;}`,
  )}`,
  import.meta.url,
);
let failures = 0;
const J = (v) => JSON.stringify(v);
const check = (label, ok, detail = '') => {
  if (ok) console.log(`  ok    ${label}`);
  else {
    failures++;
    console.log(`  FAIL  ${label}${detail ? `\n        ${detail}` : ''}`);
  }
};

const CHROME = [
  'C:/Program Files/Google/Chrome/Application/chrome.exe',
  'C:/Program Files (x86)/Google/Chrome/Application/chrome.exe',
  '/usr/bin/google-chrome',
  '/usr/bin/chromium',
  '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
].find((p) => existsSync(p));
const dump = join(root, 'public', 'golden-stores.json');
if (!CHROME || !existsSync(dump)) {
  console.log(`\n  skip  ${!CHROME ? 'Chrome is not installed here' : 'public/golden-stores.json is missing (run tools/dump-golden-stores.mjs)'}\n`);
  process.exit(0);
}

// ── Build the real print document ────────────────────────────────────────
const { createStatementEngine } = await import(pathToFileURL(join(root, 'src/generated/statements-legacy.js')).href);
const { buildPrintDocument } = await import(pathToFileURL(join(root, 'src/lib/statements/printDoc.ts')).href);
const stores = JSON.parse(readFileSync(dump, 'utf8')).stores;
const shopsTs = readFileSync(join(root, 'src/lib/engine/shops.ts'), 'utf8');
const NAMES = {};
for (const m of shopsTs.matchAll(/^\s*(\d+):\s*'([^']+)',\s*$/gm)) NAMES[Number(m[1])] = m[2];
const engine = createStatementEngine({
  stores: {
    entryStore: stores.entryStore ?? {}, inspectionStore: stores.inspectionStore ?? {}, monthlyStore: stores.monthlyStore ?? {},
    meManualStore: stores.meManualStore ?? {}, meSourceStore: stores.meSourceStore ?? {}, meRemitStore: stores.meRemitStore ?? {},
    meGunnyStore: stores.meGunnyStore ?? {}, meCardStore: stores.meCardStore ?? {}, salesCloseStore: stores.salesCloseStore ?? {},
    receiptStore: stores.receiptStore ?? [], meAllotStore: stores.meAllotStore ?? {}, meCardConfirmed: stores.meCardConfirmed ?? {},
    meAdvanceStore: stores.meAdvanceStore ?? {},
  },
  users: [], CRS_MASTER: stores.__crsMaster ?? [],
  CRS_LIST: Array.from({ length: 30 }, (_, i) => ({ ...((stores.__shops ?? [])[i] ?? {}), id: i + 1, name: NAMES[i + 1] })),
});

const CRS = 19, MONTH = 9, YEAR = 2026;
const data = engine.getData(CRS, MONTH, YEAR);
const all = engine.sectionsFor(CRS).map((s) => ({ id: s.id, label: s.label, copies: s.copies ?? 1, html: engine.buildSection(s.id, data) }));

const dir = mkdtempSync(join(tmpdir(), 'printpdf-'));
const pdfjs = await import(pathToFileURL(join(root, 'node_modules/pdfjs-dist/legacy/build/pdf.mjs')).href);
const PT_MM = 25.4 / 72;

/** Print one selection and read every page back: size, and the box its text covers. */
async function pagesOf(sections, name) {
  const html = join(dir, `${name}.html`);
  const pdf = join(dir, `${name}.pdf`);
  writeFileSync(html, buildPrintDocument(`CRS ${CRS}`, engine.printCss, sections));
  execFileSync(CHROME, ['--headless=new', '--disable-gpu', '--no-pdf-header-footer', '--virtual-time-budget=5000',
    `--print-to-pdf=${pdf}`, pathToFileURL(html).href], { stdio: 'ignore' });
  const doc = await pdfjs.getDocument({ data: new Uint8Array(readFileSync(pdf)), verbosity: 0 }).promise;
  const out = [];
  for (let n = 1; n <= doc.numPages; n++) {
    const page = await doc.getPage(n);
    const vp = page.getViewport({ scale: 1 });
    const w = +(vp.width * PT_MM).toFixed(1), h = +(vp.height * PT_MM).toFixed(1);
    const tc = await page.getTextContent();
    let minX = Infinity, maxX = -Infinity, size = Infinity;
    for (const it of tc.items) {
      if (!('str' in it) || !it.str.trim()) continue;
      minX = Math.min(minX, it.transform[4]);
      maxX = Math.max(maxX, it.transform[4] + (it.width ?? 0));
      const s = Math.hypot(it.transform[2], it.transform[3]);
      if (s > 0.1) size = Math.min(size, s);
    }
    const has = maxX > -Infinity;
    out.push({
      w, h,
      orient: w > h ? 'landscape' : 'portrait',
      isA4: (Math.abs(w - 210) < 3 && Math.abs(h - 297) < 3) || (Math.abs(w - 297) < 3 && Math.abs(h - 210) < 3),
      inkMm: has ? +((maxX - minX) * PT_MM).toFixed(1) : 0,
      leftMm: has ? +(minX * PT_MM).toFixed(1) : 0,
      rightEdgeMm: has ? +(maxX * PT_MM).toFixed(1) : 0,
      smallestPt: has ? +size.toFixed(1) : 0,
    });
  }
  await doc.destroy();
  return out;
}

console.log(`\n1. Every sheet on A4 — CRS ${CRS}, all ${all.length} statements`);
const pages = await pagesOf(all, 'whole');
{
  const sheets = all.reduce((n, s) => n + Math.max(1, s.copies), 0);
  check(`one page per sheet: ${sheets} statements, ${pages.length} pages`, pages.length === sheets, `${pages.length} vs ${sheets}`);
  const notA4 = pages.map((p, i) => ({ ...p, n: i + 1 })).filter((p) => !p.isA4);
  check('no page is any size but A4 — one A3 page shrinks the whole job on an A4 printer',
    notA4.length === 0, notA4.map((p) => `page ${p.n}: ${p.w}×${p.h}mm`).join(', '));
  const off = pages.map((p, i) => ({ ...p, n: i + 1 })).filter((p) => p.inkMm && p.rightEdgeMm > p.w + 0.5);
  check('nothing prints past the right-hand edge of its page', off.length === 0, off.map((p) => `page ${p.n}: ${p.rightEdgeMm}mm on ${p.w}mm`).join(', '));
  check('no page is blank', pages.every((p) => p.inkMm > 0), '');
}

console.log('\n2. The first statement gets its own paper');
{
  // CRS PAGE 1 is portrait and stands first; it is the page a named page
  // cannot reach, and the one that came out A3.
  check('page 1 is portrait, as CRS PAGE 1 is filed', pages[0].orient === 'portrait', JSON.stringify(pages[0]));
  check('…and the statements after it keep their own orientation',
    pages[1].orient === 'landscape' && pages.some((p) => p.orient === 'portrait'), '');

  // Printing a landscape statement FIRST must give page 1 landscape.
  const wideFirst = [all.find((s) => s.id === 'crs_page2'), all.find((s) => s.id === 'coll')].filter(Boolean);
  const wide = await pagesOf(wideFirst, 'wide-first');
  check('a job that starts with a landscape statement gets a landscape page 1', wide[0].orient === 'landscape', JSON.stringify(wide[0]));
  check('…and its portrait statement still prints portrait', wide[wide.length - 1].orient === 'portrait', JSON.stringify(wide[wide.length - 1]));

  // One statement on its own.
  const alone = await pagesOf([all.find((s) => s.id === 'sale_tax')], 'alone');
  check('one statement on its own: a single A4 portrait page', alone.length === 1 && alone[0].orient === 'portrait' && alone[0].isA4, JSON.stringify(alone));
}

console.log('\n2b. A physical printer gets one orientation per job');
{
  // Save-as-PDF gives each page its own paper; a printer's dialog holds ONE
  // layout for the job and Chrome takes it from the document only when every
  // page agrees. So Print Selected sends a mixed selection as two jobs
  // (statements/page.tsx openPrintJobs), split exactly as orientationOf splits
  // them here. Each must be all one orientation, and together they must be
  // the whole selection.
  const { orientationOf } = await import(pathToFileURL(join(root, 'src/lib/statements/printDoc.ts')).href);
  const landscapeJob = all.filter((s) => orientationOf(s.html, s.id) === 'landscape');
  const portraitJob = all.filter((s) => orientationOf(s.html, s.id) !== 'landscape');
  check('the selection splits into a landscape job and a portrait job', landscapeJob.length > 0 && portraitJob.length > 0, `${landscapeJob.length} / ${portraitJob.length}`);
  const L = await pagesOf(landscapeJob, 'job-landscape');
  const P = await pagesOf(portraitJob, 'job-portrait');
  check('the landscape job is A4 landscape on every page', L.length > 0 && L.every((p) => p.isA4 && p.orient === 'landscape'), J(L.map((p) => p.orient)));
  check('the portrait job is A4 portrait on every page', P.length > 0 && P.every((p) => p.isA4 && p.orient === 'portrait'), J(P.map((p) => p.orient)));
  check('the two jobs together are every sheet of the selection, once', L.length + P.length === pages.length, `${L.length} + ${P.length} vs ${pages.length}`);
  check('neither job is shrunk: same smallest type as the one-document print',
    Math.min(...L.map((p) => p.smallestPt)) === Math.min(...pages.filter((p) => p.orient === 'landscape').map((p) => p.smallestPt)), '');
}

console.log('\n3. Nothing is shrunk to fit');
{
  // A wide statement covers most of its page. If Chrome had shrunk the
  // document — which is what a mixed-size job makes it do — these would be a
  // fraction of the paper and the type unreadably small.
  const wide = pages.filter((p) => p.orient === 'landscape' && p.inkMm > 0);
  const thin = wide.filter((p) => p.inkMm / p.w < 0.6);
  check(`every landscape sheet covers most of its width (${wide.length} sheets, narrowest ${Math.min(...wide.map((p) => Math.round((p.inkMm / p.w) * 100)))}%)`,
    thin.length === 0, thin.map((p) => `${p.inkMm}mm of ${p.w}mm`).join(', '));
  const tiny = pages.filter((p) => p.smallestPt && p.smallestPt < 3.5);
  check('no statement is printed at unreadable type (nothing under 3.5pt)', tiny.length === 0,
    tiny.map((p) => `${p.smallestPt}pt`).join(', '));
  // The office's own smallest sheet is the Receipt at ~5pt; a document-wide
  // shrink took it to 3.6pt when the default page was portrait.
  const receiptPage = pages[1];
  check(`the Receipt keeps the office's own size (${receiptPage.smallestPt}pt, not the 3.6pt a shrunk job gave)`,
    receiptPage.smallestPt >= 4.5, JSON.stringify(receiptPage));
}

console.log(failures ? `\n${failures} FAILED\n` : '\nall passed\n');
process.exit(failures ? 1 : 0);
