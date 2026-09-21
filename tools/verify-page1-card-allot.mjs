/**
 * CRS Page 1 — Card Details and Allotment are the SAVED figures, for this
 * shop and this month, in every place Page 1 is shown.
 *
 *   node tools/verify-page1-card-allot.mjs
 *
 * Drives the real statement engine (src/generated/statements-legacy.js) and
 * the real office-sheet fill (templateFill.ts + templateAmend.ts) — the path
 * /api/statements/render → preview / Print / Excel takes. Each case builds a
 * fresh engine from its stores, as the server does on every render, so
 * "edit → save → preview" is exactly "new stores → new engine → render".
 *
 * What it guards (office, 2026-09-21):
 *   - every card category on its own line, placed by card id, and TOTAL CARD
 *     DETAILS = the sum of the same saved counts;
 *   - allotment lines 1–8 carry the saved Allotment, all fifteen commodities;
 *   - a month with no allotment saved shows NOTHING after the captions — the
 *     godown receipts it used to fall back to never appear under ALLOTMENT;
 *   - another shop's or another month's figures never appear;
 *   - Print and Excel carry the same figures as the preview.
 */
import { register } from 'node:module';
import { readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { unzipSync, strFromU8 } from 'fflate';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const srcUrl = pathToFileURL(join(root, 'src') + '/').href;
register(
  `data:text/javascript,${encodeURIComponent(`
const SRC_URL = ${JSON.stringify(srcUrl)};
export async function resolve(spec, ctx, next) {
  if (spec.startsWith('@/')) {
    const base = SRC_URL + spec.slice(2);
    if (base.endsWith('.json')) return { url: base, shortCircuit: true, importAttributes: { type: 'json' } };
    return next(base + '.ts', ctx);
  }
  return next(spec, ctx);
}`)}`,
  import.meta.url,
);

const { createStatementEngine } = await import(pathToFileURL(join(root, 'src/generated/statements-legacy.js')).href);
const P = await import(pathToFileURL(join(root, 'src/lib/statements/printDoc.ts')).href);
const F = await import(pathToFileURL(join(root, 'src/lib/statements/templateFill.ts')).href);
const A = await import(pathToFileURL(join(root, 'src/lib/statements/templateAmend.ts')).href);
const W = await import(pathToFileURL(join(root, 'src/lib/statements/toWorkbook.ts')).href);

let failures = 0;
const check = (label, ok, detail = '') => {
  if (ok) console.log(`  ok    ${label}`);
  else {
    failures++;
    console.log(`  FAIL  ${label}${detail ? `\n        ${detail}` : ''}`);
  }
};

const CRS_LIST = Array.from({ length: 30 }, (_, i) => ({ id: i + 1, name: `CRS ${i + 1}` }));
const CRS = 19;
const KEY = `${CRS}_9_2026`;

function engine({ cards = {}, allot = {}, monthly = {} } = {}) {
  return createStatementEngine({
    stores: {
      entryStore: {}, inspectionStore: {}, monthlyStore: monthly, meManualStore: {}, meSourceStore: {},
      meRemitStore: {}, meGunnyStore: {}, meCardStore: cards, salesCloseStore: {}, receiptStore: [],
      meAllotStore: allot, meCardConfirmed: {}, meAdvanceStore: {},
    },
    users: [], CRS_LIST, CRS_MASTER: [], APP_CONFIG: {}, CRS_ACCOUNTS: {}, currentUser: null,
  });
}

const sheet = A.officeSheet('crs_page1');

/** Page 1 for a shop and month: the statement's html and what lands in each office cell. */
function page1(stores, crs = CRS, month = 9, year = 2026) {
  const e = engine(stores);
  const html = e.buildSection('crs_page1', e.getData(crs, month, year));
  const { values } = F.fillSection('crs_page1', sheet, html);
  return { html, values };
}

/** The office cell whose caption starts with `caption` — by caption, as the form reads. */
const refOf = (caption) => {
  const want = caption.replace(/\s+/g, '');
  const hit = Object.entries(sheet.cells).find(([, c]) => c.p && c.p.replace(/\s+/g, '').replace(/:$/, '').startsWith(want));
  if (!hit) throw new Error(`no cell captioned ${caption}`);
  return hit[0];
};
const shown = (values, caption) => String(values[refOf(caption)] ?? '').trim();

const card = (n) => ({ count: n });
const CARDS = { rice: card(500), lof_rice: card(12), sugar: card(40), lof_sugar: card(3), aay: card(25), lof_aay: card(7), oap: card(9), police: card(11), n_card: card(2) };
const CARD_SUM = 500 + 12 + 40 + 3 + 25 + 7 + 9 + 11 + 2;
const ALLOT = { BRA: 2000, AAY: 350, SUGAR: 600, AAY_SUGAR: 30, WHEAT: 100, TOOR: 400, PALM: 400, PHH_BRA: 2000, PHH_FRK: 2000, NPHH_FRK: 2500, AAY_FRK: 600, RRA: 150, NPHH_RRA: 80, OAP: 45, APS: 5 };
// Receipts the old fallback would have printed under ALLOTMENT.
const MONTHLY = { [KEY]: { a: { SUGAR: { receipt: 402 }, AAY_SUGAR: { receipt: 26.5 }, WHEAT: { receipt: 851 }, TOOR: { receipt: 318 }, PALM: { receipt: 314 }, PHH_BRA: { receipt: 2293 } } } };

console.log('\nThe office sheet has a line for every card and every allotment');
{
  for (const c of A.PAGE1_CARD_CAPTIONS) check(`card line: ${c}`, (() => { try { refOf(c); return true; } catch { return false; } })());
  for (const c of A.PAGE1_ALLOT_CAPTIONS) check(`allotment line: ${c}`, (() => { try { refOf(c); return true; } catch { return false; } })());
  check('the office\'s signature rows keep their numbers', sheet.cells.B26?.p?.startsWith('SIGNATURE OF B.C') && sheet.cells.B27?.p?.startsWith('MOBILE NO'));
  check('…and the NOTE block moved down two, intact', sheet.cells.B20?.p === 'NOTE:' && /^1\. The quantity/.test(sheet.cells.B21?.v ?? '') && /^2\. The total/.test(sheet.cells.B22?.v ?? ''));
}

console.log('\n1. Existing card details → preview');
{
  const { values } = page1({ cards: { [KEY]: CARDS }, monthly: MONTHLY });
  const want = { 'RICE CARD': 500, 'SUGAR CARD': 40, 'AAY CARD': 25, 'LOF RICE CARD': 12, 'POLICE CARD': 11, "N' CARD": 2, 'LOF SUGAR CARD': 3, 'OAP CARD': 9, 'LOF AAY CARD': 7 };
  for (const [cap, n] of Object.entries(want)) check(`${cap} ${n}`, shown(values, cap) === String(n), shown(values, cap));
  check(`TOTAL CARD DETAILS ${CARD_SUM} — the sum of the same saved counts`, shown(values, 'TOTAL CARD DETAILS') === String(CARD_SUM), shown(values, 'TOTAL CARD DETAILS'));
  check(`TOTAL NUMBER OF CARDS agrees: ${CARD_SUM}`, shown(values, 'TOTAL NUMBER OF CARDS') === String(CARD_SUM), shown(values, 'TOTAL NUMBER OF CARDS'));
}

console.log('\n2 & 4. Card details edited and saved → the preview shows the new figure');
{
  const before = page1({ cards: { [KEY]: CARDS } }).values;
  const after = page1({ cards: { [KEY]: { ...CARDS, rice: card(520) } } }).values;
  check('RICE CARD 500 before', shown(before, 'RICE CARD') === '500');
  check('RICE CARD 520 after — not 500', shown(after, 'RICE CARD') === '520', shown(after, 'RICE CARD'));
  check(`TOTAL CARD DETAILS moves with it: ${CARD_SUM + 20}`, shown(after, 'TOTAL CARD DETAILS') === String(CARD_SUM + 20), shown(after, 'TOTAL CARD DETAILS'));
  const again = page1({ cards: { [KEY]: { ...CARDS, rice: card(515), lof_aay: card(0) } } }).values;
  check('changed again: RICE 515, LOF AAY 0', shown(again, 'RICE CARD') === '515' && shown(again, 'LOF AAY CARD') === '0');
}

console.log('\n3 & 5. Allotment saved, then changed → the preview follows');
{
  const { values } = page1({ allot: { [KEY]: ALLOT }, monthly: MONTHLY });
  const want = {
    '1.RICE&AAY': '2000 & 350', '2.SUGAR&AAY': '600 & 30', '3.WHEAT': '100', '4.T.D & P.O': '400 & 400',
    '5.PHH BRA&FRK': '2000 & 2000', '6.NPHH&AAY FRK': '2500 & 600', '7.RRA&NPHH RRA': '150 & 80', '8.OAP&APS': '45 & 5',
  };
  for (const [cap, v] of Object.entries(want)) check(`${cap} : ${v}`, shown(values, cap) === v, shown(values, cap));
  const changed = page1({ allot: { [KEY]: { ...ALLOT, SUGAR: 650, WHEAT: 120 } }, monthly: MONTHLY }).values;
  check('SUGAR changed to 650 → 650 & 30', shown(changed, '2.SUGAR&AAY') === '650 & 30', shown(changed, '2.SUGAR&AAY'));
  check('WHEAT changed to 120 → 120', shown(changed, '3.WHEAT') === '120', shown(changed, '3.WHEAT'));
  const partial = page1({ allot: { [KEY]: { SUGAR: 600 } } }).values;
  check('a saved month that did not allot a commodity shows 0 for it', shown(partial, '3.WHEAT') === '0' && shown(partial, '2.SUGAR&AAY') === '600 & 0');
}

console.log('\nNo allotment saved → blank, never the receipts');
{
  const { values, html } = page1({ cards: { [KEY]: CARDS }, monthly: MONTHLY });
  for (const cap of A.PAGE1_ALLOT_CAPTIONS) check(`${cap} is blank`, shown(values, cap) === '', shown(values, cap));
  check('none of the month\'s receipt figures (402, 26.5, 851, 318, 314, 2293) is anywhere on Page 1',
    !/\b(402|26\.5|851|318|314|2293)\b/.test(html), (html.match(/\b(402|26\.5|851|318|314|2293)\b/g) ?? []).join(','));
}

console.log('\n6 & 7. Another shop, another month');
{
  const stores = {
    cards: { [KEY]: CARDS, '7_9_2026': { rice: card(999) }, [`${CRS}_8_2026`]: { rice: card(888) } },
    allot: { [KEY]: ALLOT, '7_9_2026': { WHEAT: 777 }, [`${CRS}_8_2026`]: { WHEAT: 666 } },
  };
  const own = page1(stores).values;
  check('CRS 19 September shows its own: RICE 500, WHEAT 100', shown(own, 'RICE CARD') === '500' && shown(own, '3.WHEAT') === '100');
  const other = page1(stores, 7).values;
  check('CRS 7 shows its own: RICE 999, WHEAT 777', shown(other, 'RICE CARD') === '999' && shown(other, '3.WHEAT') === '777');
  const aug = page1(stores, CRS, 8).values;
  check('CRS 19 August shows August: RICE 888, WHEAT 666', shown(aug, 'RICE CARD') === '888' && shown(aug, '3.WHEAT') === '666');
  const oct = page1(stores, CRS, 10).values;
  check('a month with nothing saved shows 0 cards and blank allotment — nothing borrowed from September',
    shown(oct, 'RICE CARD') === '0' && shown(oct, 'TOTAL CARD DETAILS') === '0' && shown(oct, '3.WHEAT') === '');
}

console.log('\n8. Print and Excel carry the preview\'s figures');
{
  const { html } = page1({ cards: { [KEY]: CARDS }, allot: { [KEY]: ALLOT } });
  const preview = P.buildPreviewSheet(html, 'crs_page1');
  const doc = P.buildPrintDocument('T', '', [{ id: 'crs_page1', label: 'CRS Page 1', copies: 1, html }]);
  check('the printed sheet is the preview\'s sheet', doc.includes(preview.replace(/^<style>[\s\S]*?<\/style>/, '')));
  for (const t of ['LOF AAY CARD', `TOTAL CARD DETAILS : ${CARD_SUM}`, '6.NPHH&amp;AAY FRK', '2500 &amp; 600', '8.OAP&amp;APS', '45 &amp; 5']) {
    check(`…and shows "${t.replace(/&amp;/g, '&')}"`, preview.replace(/\s+/g, ' ').includes(t.replace(/\s+/g, ' ')) || preview.replace(/\s+/g, '').includes(t.replace(/\s+/g, '')));
  }
  const xlsx = W.buildStatementsXlsx([{ id: 'crs_page1', label: 'CRS Page 1', html }]);
  if (xlsx) {
    const files = unzipSync(xlsx instanceof Uint8Array ? xlsx : new Uint8Array(xlsx));
    const shared = strFromU8(files['xl/sharedStrings.xml'] ?? new Uint8Array());
    const sheetXml = strFromU8(files['xl/worksheets/sheet1.xml']);
    const text = (shared + sheetXml).replace(/\s+/g, '');
    for (const t of ['LOFAAYCARD:7', `TOTALCARDDETAILS:${CARD_SUM}`, '6.NPHH&amp;AAYFRK:2500&amp;600', '8.OAP&amp;APS:45&amp;5', 'RICECARD:500']) {
      check(`Excel has "${t.replace(/&amp;/g, '&')}"`, text.includes(t), '');
    }
  } else {
    check('toWorkbook exposes buildWorkbook', false, Object.keys(W).join(', '));
  }
}

console.log(failures ? `\n${failures} FAILED` : '\nPAGE 1 CARD + ALLOTMENT OK');
process.exit(failures ? 1 : 0);
