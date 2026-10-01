/**
 * CRS Page 2 and B6 fill their A4 landscape page (office, 2026-10-01;
 * src/lib/statements/fillPage.ts `data-fill-grow`, pageSetup.ts growsToPage).
 *
 *   node tools/verify-page2-fill.mjs
 *
 * Page 2 is printed through the production path — the generated statement
 * engine, buildPrintDocument, htmlToPdf (headless Chrome) — and the PDF is
 * read back:
 *   1. one page, A4 landscape, every printed figure present;
 *   2. it fills the page: the text reaches past 85% of the paper's height
 *      (it stopped at two-thirds) and the table type is ≥ 7 pt (was 5.6);
 *   3. the worst case — every row filled with the widest figures — is still
 *      one page with nothing clipped (the grow backs off);
 *   4. CRS 29's own Page 2 grows too and stays one page;
 *   5. the builders are untouched: Page 2's markup carries no fill, the
 *      print document wraps it (`data-fill-grow`, `data-fill-stretch`).
 * Synthetic data only — no database.
 */
import { existsSync } from 'node:fs';
import { register } from 'node:module';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
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
const check = (label, ok, detail = '') => {
  if (ok) console.log(`  ok    ${label}`);
  else { failures++; console.log(`  FAIL  ${label}${detail ? `\n        ${detail}` : ''}`); }
};
const CHROME = ['C:/Program Files/Google/Chrome/Application/chrome.exe', 'C:/Program Files (x86)/Google/Chrome/Application/chrome.exe', '/usr/bin/google-chrome', '/usr/bin/chromium', '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'].find((p) => existsSync(p));
if (!CHROME && !process.env.CHROME_PATH) {
  console.log('\n  skip  Chrome is not installed here\n');
  process.exit(0);
}
const { createStatementEngine } = await import(pathToFileURL(join(root, 'src/generated/statements-legacy.js')).href);
const D = await import(pathToFileURL(join(root, 'src/lib/statements/printDoc.ts')).href);
const { htmlToPdf } = await import(pathToFileURL(join(root, 'src/lib/statements/pdfServer.ts')).href);
const pdfjs = await import(pathToFileURL(join(root, 'node_modules/pdfjs-dist/legacy/build/pdf.mjs')).href);

const row = (open, receipt, sales, rate = 0) => ({ open, receipt, total: open + receipt, sales, close: open + receipt - sales, amount: sales * rate, excess: 0, shortage: 0, transfer: 0 });
const A_IDS = ['BRA', 'AAY', 'RRA', 'SUGAR', 'AAY_SUGAR', 'WHEAT', 'TOOR', 'PALM', 'OOTY', 'TAN', 'SALT_CIS', 'SALT_RFFS', 'OAP', 'APS', 'PHH_BRA', 'PHH_FRK', 'AAY_FRK', 'NPHH_FRK', 'NPHH_RRA', 'EMPTY_BOX', 'EMPTY_BAG'];
function engineFor(crs, monthly) {
  const key = `${crs}_9_2026`;
  return createStatementEngine({
    stores: {
      entryStore: {}, inspectionStore: {}, monthlyStore: { [key]: monthly }, meManualStore: {}, meSourceStore: {}, meRemitStore: { [key]: { 1: { nonCereal: 73499, remitDate: '2026-09-02' } } },
      meGunnyStore: {}, meCardStore: {}, salesCloseStore: {}, receiptStore: [], meAllotStore: {}, meCardConfirmed: {}, meAdvanceStore: {},
    },
    users: [{ id: 9, fullName: 'Saravanan', role: 'BC', crsId: crs, active: true, phone: '9159541617' }],
    CRS_LIST: Array.from({ length: 30 }, (_, i) => ({ id: i + 1, name: `CRS ${i + 1}` })), CRS_MASTER: [], APP_CONFIG: {}, CRS_ACCOUNTS: {}, currentUser: null,
  });
}
/** The print document laid out in Chrome as the PDF renderer lays it out (print media, the fill script run): cells narrower than their text. */
async function clippedCells(doc) {
  const puppeteer = (await import('puppeteer-core')).default;
  const b = await puppeteer.launch({ executablePath: process.env.CHROME_PATH || CHROME, headless: true });
  try {
    const p = await b.newPage();
    await p.emulateMediaType('print');
    await p.setContent(doc, { waitUntil: 'load' });
    await new Promise((r) => setTimeout(r, 300));
    return await p.evaluate(() => {
      const out = [];
      document.querySelectorAll('.stmt-fill th, .stmt-fill td').forEach((c) => { if (c.scrollWidth > c.clientWidth + 1) out.push(c.textContent.trim()); });
      const box = document.querySelector('.stmt-fill');
      return { clipped: out, zoom: box ? box.style.zoom : null, width: box?.firstElementChild?.nextElementSibling?.style.width ?? null };
    });
  } finally { await b.close(); }
}
async function print(crs, monthly, section = 'crs_page2') {
  const e = engineFor(crs, monthly);
  const html = e.buildSection(section, e.getData(crs, 9, 2026));
  const cells = [...html.matchAll(/<td[^>]*>([\s\S]*?)<\/td>/g)].map((m) => m[1].replace(/<[^>]+>/g, '').trim()).filter(Boolean);
  const printDoc = D.buildPrintDocument(`CRS ${crs}`, e.printCss, [{ id: section, label: section, copies: 1, html }]);
  const pdf = await htmlToPdf(printDoc);
  const doc = await pdfjs.getDocument({ data: new Uint8Array(pdf), verbosity: 0 }).promise;
  const pg = await doc.getPage(1);
  const vp = pg.getViewport({ scale: 1 });
  const items = (await pg.getTextContent()).items.filter((i) => i.str.trim());
  const mm = (pt) => Math.round((pt / 72) * 25.4 * 10) / 10;
  const text = ' ' + items.map((i) => i.str.trim()).join(' ') + ' ';
  const size = (re) => { const it = items.find((i) => re.test(i.str.trim())); return it ? Math.round(Math.hypot(it.transform[0], it.transform[1]) * 10) / 10 : 0; };
  return {
    html, printDoc, pages: doc.numPages, w: mm(vp.width), h: mm(vp.height),
    bottom: mm(Math.max(...items.map((i) => vp.height - i.transform[5]))),
    right: mm(Math.max(...items.map((i) => i.transform[4] + i.width))),
    missing: cells.filter((c) => !text.includes(` ${c} `) && !text.includes(c)),
    tablePt: size(/^B\.RICE$|^B\.RICE/), titlePt: size(/TAMIL NADU/),
  };
}

console.log('1–2. A month like CRS 23 September: one A4 landscape page, filled');
{
  const m = { a: { BRA: row(2316.998, 5494, 5706.998), AAY: row(0, 55, 50), RRA: row(1052.006, 750, 1802.006), SUGAR: row(695.996, 1230, 1253.502, 25), WHEAT: row(542.996, 1023, 1185.998), TOOR: row(401.012, 708, 709.012, 30), PALM: row(401, 308, 709, 25), OOTY: row(665, 0, 65, 25), SALT_CIS: row(125, 0, 125, 10), PHH_BRA: row(417, 1397, 1638), PHH_FRK: row(1000.012, 1400, 999.012), AAY_FRK: row(50, 50, 50), NPHH_FRK: row(1000.994, 2500, 1001), NPHH_RRA: row(0.004, 0, 0) }, b: {} };
  const r = await print(23, m);
  check(`${r.pages} page, ${r.w} × ${r.h} mm`, r.pages === 1 && r.w === 297 && Math.round(r.h) === 210);
  check(`every figure printed (${r.missing.length ? 'missing ' + r.missing.join(', ') : 'none missing'})`, r.missing.length === 0);
  check(`it fills the page: text reaches ${r.bottom} mm of 210 (it stopped near 140), right edge ${r.right} mm`, r.bottom > 0.85 * 210 && r.bottom < 205 && r.right <= 297);
  check(`larger type: table ${r.tablePt} pt (was 5.6), title ${r.titlePt} pt (was 9.7)`, r.tablePt >= 7 && r.titlePt >= 12);
}

console.log('\n3. The worst case: every row, the widest figures');
{
  const big = (rate) => row(123456789.123, 98765432.987, 112233445.566, rate);
  const m = { a: Object.fromEntries(A_IDS.map((id) => [id, big(['SUGAR', 'AAY_SUGAR', 'TOOR', 'PALM', 'OOTY', 'TAN', 'SALT_CIS', 'SALT_RFFS'].includes(id) ? 30 : 0)])), b: { PB_BRA: big(0), PB_SUGAR: big(25) } };
  const r = await print(23, m);
  check(`still ${r.pages} page; text to ${r.bottom} mm, right edge ${r.right} mm`, r.pages === 1 && r.bottom < 205 && r.right <= 297);
  check(`every figure printed (${r.missing.length ? r.missing.slice(0, 5).join(', ') : 'none missing'})`, r.missing.length === 0);
  const dom = await clippedCells(r.printDoc);
  check(`laid out in Chrome after the fill (zoom ${dom.zoom}): no cell narrower than its text (${dom.clipped.length ? dom.clipped.slice(0, 5).join(', ') : 'none'})`, dom.clipped.length === 0 && Number(dom.zoom) >= 1);
}

console.log('\n4. CRS 29\'s own Page 2');
{
  const m = { a: { BRA: row(1200, 3000, 2900), RRA: row(100, 500, 400), SUGAR: row(80, 200, 150, 25), TOOR: row(30, 60, 50, 30), PALM: row(40, 80, 70, 25), WHEAT: row(10, 50, 40) }, b: {} };
  const r = await print(29, m);
  check(`${r.pages} page; text to ${r.bottom} mm (it stopped near 120), table ${r.tablePt} pt; nothing missing (${r.missing.length})`, r.pages === 1 && r.bottom > 0.8 * 210 && r.bottom < 205 && r.missing.length === 0);
}

console.log('\n5. Layout only: the builder is untouched');
{
  const e = engineFor(23, { a: { BRA: row(10, 0, 0) }, b: {} });
  const html = e.buildSection('crs_page2', e.getData(23, 9, 2026));
  check('Page 2\'s own markup carries no fill or zoom', !/stmt-fill|zoom|data-fill/.test(html));
  const doc = D.buildPrintDocument('x', e.printCss, [{ id: 'crs_page2', label: 'CRS Page 2', copies: 2, html }]);
  check('the print document wraps BOTH copies to grow and stretch, and carries the fill script', (doc.match(/data-fill-grow="1"/g) ?? []).length === 2 && /data-fill-stretch="1" data-fill-grow="1"/.test(doc) && /fillSheets|data-fill-grow/.test(doc.slice(doc.lastIndexOf('<script>'))));
  check('the preview sheet is the same wrapper (Preview = Print = PDF)', /data-fill-grow="1"/.test(D.buildPreviewSheet(html, 'crs_page2')));
  check('no other statement grows', !/data-fill-grow="1"/.test(D.buildPrintDocument('x', e.printCss, [{ id: 'remittance', label: 'R', copies: 1, html: '<div>r</div>' }, { id: 'crs_police', label: 'P', copies: 1, html: '<div>p</div>' }])));
}

console.log('\n6. B6 (office, the same day)');
{
  const m = { a: { BRA: row(2316.998, 5494, 5706.998), AAY: row(0, 55, 50), RRA: row(1052.006, 750, 1802.006), SUGAR: row(695.996, 1230, 1253.502, 25), WHEAT: row(542.996, 1023, 1185.998), TOOR: row(401.012, 708, 709.012, 30), PALM: row(401, 308, 709, 25), OOTY: row(665, 0, 65, 25), SALT_CIS: row(125, 0, 125, 10), PHH_BRA: row(417, 1397, 1638), PHH_FRK: row(1000.012, 1400, 999.012), AAY_FRK: row(50, 50, 50), NPHH_FRK: row(1000.994, 2500, 1001), NPHH_RRA: row(0.004, 0, 0) }, b: {} };
  const r = await print(23, m, 'b6');
  check(`${r.pages} page, ${r.w} × ${r.h} mm; every figure printed (${r.missing.length ? r.missing.join(', ') : 'none missing'})`, r.pages === 1 && r.w === 297 && Math.round(r.h) === 210 && r.missing.length === 0);
  check(`it fills the page: text reaches ${r.bottom} mm (it stopped near 156); table ${r.tablePt} pt (was 6), title ${r.titlePt} pt (was 9.7)`, r.bottom > 175 && r.bottom < 205 && r.tablePt >= 7 && r.titlePt >= 11);
  const big = (rate) => row(123456789.123, 98765432.987, 112233445.566, rate);
  const w = await print(23, { a: Object.fromEntries(A_IDS.map((id) => [id, big(0)])), b: {} }, 'b6');
  const dom = await clippedCells(w.printDoc);
  check(`worst case: ${w.pages} page, every figure printed, no cell narrower than its text in Chrome (zoom ${dom.zoom}; ${dom.clipped.length ? dom.clipped.slice(0, 4).join(', ') : 'none clipped'})`, w.pages === 1 && w.missing.length === 0 && dom.clipped.length === 0);
  const e = engineFor(23, m);
  const html = e.buildSection('b6', e.getData(23, 9, 2026));
  check('B6\'s own markup carries no fill; the print document grows and stretches it', !/stmt-fill|data-fill/.test(html) && /data-fill-stretch="1" data-fill-grow="1"/.test(D.buildPrintDocument('x', e.printCss, [{ id: 'b6', label: 'B6', copies: 1, html }])));
}

console.log(failures ? `\n${failures} FAILED` : '\nALL PAGE-2 / B6 FILL CHECKS PASSED');
process.exit(failures ? 1 : 0);
