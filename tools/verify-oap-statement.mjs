/**
 * The OAP / APS / ANP statement (office, 2026-10-01; src/lib/engine/oapStatement.ts,
 * Reports → 🧓 OAP / APS / ANP).
 *
 *   node tools/verify-oap-statement.mjs
 *
 *   1. a shop is on the statement only when the commodity has an entry there
 *      that month — CRS 19 OAP yes, CRS 1 (nothing) no, CRS 10 APS only on APS;
 *   2. figures are the month as Monthly Sales publishes it (keyed by month or
 *      by day), and a Daily edit shows at once; TOTAL = O.B + RECEIPT (±
 *      shortage), C.B = TOTAL − SALES;
 *   3. the family is read from the Commodity Master — an added APS_FRK joins;
 *   4. the sheet: the office's heading, CRS / month line, one row per
 *      commodity, no blank rows; the print document is one A4-landscape page
 *      per shop;
 *   5. wiring: the Reports tab, printing a document of its own.
 */
import { readFileSync } from 'node:fs';
import { register } from 'node:module';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const srcUrl = pathToFileURL(join(root, 'src') + '/').href;
register(
  `data:text/javascript,${encodeURIComponent(`
const SRC = ${JSON.stringify(srcUrl)};
export async function resolve(spec, ctx, next) {
  let s = spec;
  const rel = (s.startsWith('./') || s.startsWith('../')) && ctx.parentURL && ctx.parentURL.startsWith(SRC);
  if (s.startsWith('@/') || rel) {
    const base = s.startsWith('@/') ? SRC + s.slice(2) : new URL(s, ctx.parentURL).href;
    if (/\\.[a-z]+$/.test(s)) return next(base, ctx);
    for (const ext of ['.ts', '.tsx', '.js']) { try { return await next(base + ext, ctx); } catch {} }
  }
  return next(s, ctx);
}`)}`,
  import.meta.url,
);
const imp = (p) => import(pathToFileURL(join(root, 'src', p)).href);
const O = await imp('lib/engine/oapStatement.ts');
const { commodityListsFor } = await imp('lib/masters.ts');

let failures = 0;
const check = (label, ok, detail = '') => {
  if (ok) console.log(`  ok    ${label}`);
  else { failures++; console.log(`  FAIL  ${label}${detail ? `\n        ${detail}` : ''}`); }
};
const J = JSON.stringify;
const row = (o) => ({ open: 0, receipt: 0, total: 0, sales: 0, close: 0, amount: 0, excess: 0, shortage: 0, transfer: 0, ...o });
const m = (id, order, extra = {}) => ({ id, en: id, ta: id, unit: 'KG', rate: 0, free: true, section: 'a', order, active: true, ...extra });
const master = [m('BRA', 1), m('OAP', 9), m('APS', 10), m('WHEAT', 11), m('OAP_FRK', 28)];
const stores = {
  entryStore: {
    '10_2026-09-01': { a: { OAP: row({ open: 3, total: 3, close: 3 }), APS: row({ open: 10, total: 10, close: 10 }), BRA: row({ open: 50, total: 50, close: 50 }) }, b: {} },
    '10_2026-09-30': { a: { OAP: row({ open: 3, receipt: 2, total: 5, sales: 5, close: 0 }), APS: row({ open: 10, total: 10, close: 10 }) }, b: {} },
  },
  inspectionStore: {},
  meManualStore: { '19_9_2026': { a: { OAP: row({ open: 5, total: 5, close: 5 }), BRA: row({ open: 100, total: 100, sales: 40, close: 60 }) }, b: {} } },
  receiptStore: [],
};
const fam = (crs) => O.oapFamily(commodityListsFor(master, crs).a).map((c) => c.id);
const sheet = (st, crs, ids) => O.oapSheetFor(st, crs, 9, 2026, ids, commodityListsFor(master, crs));

console.log('1. Only shops with an entry for the commodity');
{
  const ids = fam(null);
  check(`family from the Commodity Master: ${ids.join(', ')}`, J(ids) === J(['OAP', 'APS', 'OAP_FRK']));
  const s19 = sheet(stores, 19, ['OAP']);
  check(`CRS 19 OAP (keyed by month): ${J(s19?.rows)}`, J(s19?.rows.map((r) => [r.label, r.open, r.receipt, r.shortage, r.total, r.sales, r.close])) === J([['OAP', 5, 0, 0, 5, 0, 5]]));
  check('CRS 1 (no entry): left out', sheet(stores, 1, ids) === null);
  check('CRS 19 on APS: left out (it has no APS entry)', sheet(stores, 19, ['APS']) === null);
  const s10 = sheet(stores, 10, ['APS']);
  check(`CRS 10 on APS (keyed by day): ${J(s10?.rows.map((r) => [r.label, r.open, r.close]))}`, J(s10?.rows.map((r) => [r.label, r.open, r.receipt, r.total, r.sales, r.close])) === J([['APS', 10, 0, 10, 0, 10]]));
  const s10all = sheet(stores, 10, ids);
  check(`CRS 10 on the whole family: OAP and APS, in master order (${s10all?.rows.map((r) => r.label).join(', ')}); OAP 3 + 2 = 5 − 5 = 0`, J(s10all?.rows.map((r) => r.id)) === J(['OAP', 'APS']) && J(s10all.rows[0]) === J({ id: 'OAP', label: 'OAP', open: 3, receipt: 2, shortage: 0, total: 5, sales: 5, close: 0 }));
  check('BRA and Wheat never appear, whatever the shop holds', ![s19, s10all].some((s) => s.rows.some((r) => !/^(OAP|APS|ANP)/.test(r.id))));
}

console.log('\n2. A Daily edit shows at once; shortage');
{
  const st = JSON.parse(J(stores));
  st.entryStore['10_2026-09-30'].a.APS = row({ open: 10, total: 10, sales: 4, close: 6 });
  check(`CRS 10 APS after a Daily sale of 4: ${J(sheet(st, 10, ['APS'])?.rows[0])}`, sheet(st, 10, ['APS'])?.rows[0].sales === 4 && sheet(st, 10, ['APS'])?.rows[0].close === 6);
  st.inspectionStore['10_2026-09-30'] = { a: { APS: { shortage: 1 } }, b: {} };
  st.entryStore['10_2026-09-30'].a.APS = row({ open: 10, shortage: 1, total: 9, sales: 4, close: 5 });
  const r = sheet(st, 10, ['APS'])?.rows[0];
  check(`with a shortage of 1: O.B ${r?.open} + RECEIPT ${r?.receipt} − SHORTAGE ${r?.shortage} = TOTAL ${r?.total}; − SALES ${r?.sales} = C.B ${r?.close} (Monthly Sales' own)`, r && r.shortage === 1 && r.total === 9 && r.close === 5);
}

console.log('\n3. A family commodity added on the Commodity Master joins');
{
  const m2 = [...master, m('APS_FRK', 29)];
  const ids = O.oapFamily(commodityListsFor(m2, null).a).map((c) => c.id);
  const st = JSON.parse(J(stores)); st.meManualStore['14_9_2026'] = { a: { APS_FRK: row({ open: 2, total: 2, close: 2 }) }, b: {} };
  const s14 = O.oapSheetFor(st, 14, 9, 2026, ids, commodityListsFor(m2, 14));
  check(`APS_FRK in the family (${ids.join(', ')}) and on CRS 14's sheet as "${s14?.rows[0]?.label}"`, ids.includes('APS_FRK') && s14?.rows[0]?.label === 'APS FRK');
}

console.log('\n4. The sheet and the print document');
{
  const s19 = sheet(stores, 19, ['OAP']);
  const html = O.oapSheetHtml(s19, 'OAP', O.oapPeriod(9, 2026));
  check('heading, title, CRS and month', html.includes('TAMIL NADU CIVIL SUPPLIES CORPORATION - MADURAI REGION') && html.includes('<h2>OAP</h2>') && html.includes('<span>CRS 19</span><span>SEP\'26</span>'));
  check('columns COMMODITY · O.B · RECEIPT · SHORTAGE · TOTAL · SALES · C.B', /COMMODITY<\/th><th>O\.B<\/th><th>RECEIPT<\/th><th>SHORTAGE<\/th><th>TOTAL<\/th><th>SALES<\/th><th>C\.B/.test(html));
  check('one row per commodity, no blank rows', (html.match(/<tr>/g) ?? []).length === 2 && !/<td><\/td>/.test(html));
  const s10 = sheet(stores, 10, ['OAP', 'APS']);
  const doc = O.oapPrintDocument([{ html }, { html: O.oapSheetHtml(s10, 'OAP & APS', "SEP'26") }], 'T');
  check('print document: A4 landscape, one page per shop, the last without a trailing break', /@page\{size:A4 landscape/.test(doc) && (doc.match(/<section class="oap-page">/g) ?? []).length === 2 && /\.oap-page:last-child\{break-after:auto/.test(doc));
  check('AUG\'26 as the reference prints it', O.oapPeriod(8, 2026) === "AUG'26");
}

console.log('\n5. Wiring');
{
  const page = readFileSync(join(root, 'src/app/(app)/reports/page.tsx'), 'utf8');
  const comp = readFileSync(join(root, 'src/app/(app)/reports/OapStatement.tsx'), 'utf8');
  check('Reports has the 🧓 OAP / APS / ANP tab, which renders the statement alone', /tabBtn\('oap'/.test(page) && /type === 'oap' \? <OapStatement/.test(page) && /\{type !== 'oap' \? \(/.test(page));
  check('it prints a document of its own (hidden frame), never the app', /printHtmlDocument\(oapPrintDocument\(/.test(comp) && !/window\.print\(\)/.test(comp));
  check('an administrator picks the shops; a shop user has their own only', /isAdmin \? picked : userCrs \? \[userCrs\] : \[\]/.test(comp));
}

console.log(failures ? `\n${failures} FAILED` : '\nALL OAP-STATEMENT CHECKS PASSED');
process.exit(failures ? 1 : 0);
