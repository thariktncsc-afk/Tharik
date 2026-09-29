/**
 * Card Details and Allotment from photos (office, 2026-09-29).
 *
 *   node tools/verify-photo-extract.mjs
 *
 * No database, no network, no model call. The transcriptions below are what
 * the reader returns for the office's own photos — the two CRS 30 POS card
 * screens (they overlap: rows 3 and 4 are on both) and the September 2026 FPS
 * Allocation Report — typed out from the photos. Checked:
 *   1. card labels, Tamil and English, map to our card types; the two pages
 *      combine into ONE set (no doubled rows), total 777 = the POS's own total;
 *   2. the report's row is picked by the shop's FPS code and its columns map
 *      as the office settled (Rice → BRA, PHH Rice → PHH BRA, police left
 *      out); a POS allotment screen maps by commodity name;
 *   3. what is refused: wrong month, a shop the report has no row for,
 *      photos that disagree, labels we do not know;
 *   4. the draft keeps the clerk's own corrections;
 *   5. the server's request and its reading of the answer (mocked fetch);
 *   6. the figures, once saved, are what CRS Page 1 prints;
 *   7. the wiring: nothing from a photo is written before Save.
 */
import { readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { register } from 'node:module';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const srcUrl = pathToFileURL(join(root, 'src') + '/').href;
register(
  `data:text/javascript,${encodeURIComponent(`
const SRC_URL = ${JSON.stringify(srcUrl)};
export async function resolve(spec, ctx, next) {
  if (spec.startsWith('@/')) {
    const base = SRC_URL + spec.slice(2);
    if (base.endsWith('.json')) return { url: base, shortCircuit: true, importAttributes: { type: 'json' } };
    return next(/\\.[a-z]+$/.test(base) ? base : base + '.ts', ctx);
  }
  return next(spec, ctx);
}`)}`,
  import.meta.url,
);
const imp = (p) => import(pathToFileURL(join(root, p)).href);
const X = await imp('src/lib/engine/photoExtract.ts');
const O = await imp('src/lib/ocr/server.ts');
const { DSS_A } = await imp('src/lib/engine/commodities.ts');
const { createStatementEngine } = await imp('src/generated/statements-legacy.js');
const F = await imp('src/lib/statements/templateFill.ts');
const A = await imp('src/lib/statements/templateAmend.ts');

let failures = 0;
const check = (label, ok, detail = '') => {
  if (ok) console.log(`  ok    ${label}`);
  else {
    failures++;
    console.log(`  FAIL  ${label}${detail ? `\n        ${detail}` : ''}`);
  }
};
const J = JSON.stringify;
const ZWNJ = '‌';

// ── The office's photos, as transcribed ─────────────────────────────────────
// CRS 30 POS, page showing rows 1–4 (AAY, LOF rice, no-commodity, police).
const POS_PAGE_1 = { rows: [
  { rowNo: 1, label: 'AAY அட்டை', count: 27 },
  { rowNo: 2, label: 'LOF அரிசி அட்டை', count: 4 },
  { rowNo: 3, label: 'பண்டகமில்லா அட்டை', count: 1 },
  { rowNo: 4, label: `காவலர்${ZWNJ} அட்டை`, count: 4 },
], totalShown: 777 };
// The same screen scrolled: rows 3–6 (3 and 4 again).
const POS_PAGE_2 = { rows: [
  { rowNo: 3, label: 'பண்டகமில்லா அட்டை', count: 1 },
  { rowNo: 4, label: 'காவலர் அட்டை', count: 4 },
  { rowNo: 5, label: 'அரிசி அட்டை', count: 728 },
  { rowNo: 6, label: 'சர்க்கரை அட்டை', count: 13 },
], totalShown: 777 };

const HEAD = ['Rice (kg)', 'AAY Rice (kg)', 'Sugar (kg)', 'Wheat (kg)', 'Toor Dhall (kg)', 'PalmOil (Pkt)', 'Police Rice (kg)', 'Police Sugar (kg)', 'Police Wheat (kg)', 'Police Toor Dhall (kg)', 'Police PalmOil (Pkt)', 'OAP Rice (kg)', 'AAY Sugar (kg)', 'PHH Rice (kg)'];
const reportRow = (fpsCode, fpsName, vals) => ({ fpsCode, fpsName, cells: HEAD.map((column, i) => ({ column, value: vals[i] })) });
const REPORT_ROWS = [
  reportRow('22EA001PN', 'TNCSC CRS 5', [5817.535, 629, 944.876, 895.261, 587.194, 523.3, 18, 2, 2, 4, 1, 0, 26.964, 2689]),
  reportRow('22EA002PN', 'Tncsc Crs 9', [4724.947, 410, 699.5, 674.149, 469.794, 475.2, 12, 1.5, 1.5, 3, 1, 0, 20.5, 3300]),
  reportRow('22EA003PN', 'Tncsc Crs 10', [6623.026, 1619, 1028.5, 947.338, 703.792, 704.7, 143.5, 16, 16, 32, 9, 5, 64.5, 4637]),
  reportRow('22EA004PN', 'TNCSC 11', [12443.252, 620, 1657.354, 1660.648, 1097.804, 1098, 18, 2, 2, 4, 1, 0, 30.5, 5315]),
  reportRow('22EA005PN', 'TNCSC CRS 7', [10032.188, 560, 1560.5, 1091.058, 890.99, 891, 0, 0, 0, 0, 0, 0, 23.5, 3300]),
  reportRow('22EA006PN', 'TNCSC CRS 6', [6728.096, 255, 905, 998.498, 575.093, 574.2, 0, 0, 0, 0, 0, 0, 14, 2419]),
  reportRow('22EA007PN', 'Tncsc Crs 8', [5420.639, 175, 772.5, 721.219, 548.093, 549, 0, 0, 0, 0, 0, 0, 8, 3530]),
  reportRow('22EA008PN', 'Tncsc Crs 12', [6468.228, 230, 922, 886.559, 620.093, 620.1, 0, 0, 0, 0, 0, 0, 10, 3589]),
  reportRow('22EA009PN', 'Tncsc Crs 30', [6237.83, 840, 936, 875.615, 635.392, 635.4, 45, 5, 5, 10, 3, 0, 35.5, 3863]),
];
const REPORT = { layout: 'fps_report', month: 'SEP', year: 2026, rows: REPORT_ROWS };
const SEP = { month: 9, year: 2026 };
const ALLOT_EXCLUDE = new Set(['SALT_CIS', 'SALT_RFFS', 'OOTY', 'TAN', 'EMPTY_BOX', 'EMPTY_BAG']);
const ITEMS = DSS_A.filter((c) => !ALLOT_EXCLUDE.has(c.id)); // useAllotItems for an ordinary shop

console.log('1. Card Details from the CRS 30 POS photos');
{
  const one = X.combineCards([X.mapCardPhoto(POS_PAGE_1)]);
  check(`one page: ${J(one.values)}`, J(one.values) === J({ aay: 27, lof_rice: 4, n_card: 1, police: 4 }));
  check(`…adds to ${one.sum}, the POS says 777: flagged, and nothing is set to 0`, one.totalMismatch && one.zeroFilled.length === 0);
  const both = X.combineCards([X.mapCardPhoto(POS_PAGE_1), X.mapCardPhoto(POS_PAGE_2)]);
  const want = { aay: 27, lof_rice: 4, n_card: 1, police: 4, rice: 728, sugar: 13 };
  check(`both pages: ${J(both.values)}`, J(Object.fromEntries(Object.entries(both.values).sort())) === J(Object.fromEntries(Object.entries(want).sort())));
  check(`rows 3 and 4 are on both pages and count once: sum ${both.sum} = POS total ${both.totalShown}`, both.sum === 777 && both.totalShown === 777 && !both.totalMismatch);
  check(`the total is accounted for, so the kinds not on the POS are 0: ${both.zeroFilled.join(', ')}`, J(both.zeroFilled) === J(['lof_sugar', 'lof_aay', 'oap']));
  const draft = X.photoDraft(both.values, both.zeroFilled, new Set());
  const total = Object.values(draft).reduce((t, v) => t + v, 0);
  check(`the fields: ${J(draft)} → TOTAL CARD ${total}`, total === 777 && draft.oap === 0 && draft.rice === 728);
  const rev = X.combineCards([X.mapCardPhoto(POS_PAGE_2), X.mapCardPhoto(POS_PAGE_1)]);
  check('the order the photos are added in does not matter', J(rev.values) === J(Object.fromEntries(Object.keys(both.values).sort((a, b) => Object.keys(rev.values).indexOf(a) - Object.keys(rev.values).indexOf(b)).map((k) => [k, both.values[k]]))) && rev.sum === 777);
  const again = X.combineCards([X.mapCardPhoto(POS_PAGE_1), X.mapCardPhoto(POS_PAGE_2), X.mapCardPhoto(POS_PAGE_2)]);
  check('the same page twice still counts once', again.sum === 777 && !again.conflicts.length);
  // Labels: Tamil as the POS prints them, English as our own form does.
  const labels = {
    'அரிசி அட்டை': 'rice', 'LOF அரிசி அட்டை': 'lof_rice', 'சர்க்கரை அட்டை': 'sugar', 'LOF சர்க்கரை அட்டை': 'lof_sugar',
    'AAY அட்டை': 'aay', 'LOF AAY அட்டை': 'lof_aay', 'காவலர் அட்டை': 'police', [`காவலர்${ZWNJ} அட்டை`]: 'police', 'பண்டகமில்லா அட்டை': 'n_card',
    'RICE CARD': 'rice', 'LOF RICE CARD': 'lof_rice', 'SUGAR CARD': 'sugar', 'LOF SUGAR': 'lof_sugar', 'AAY CARD': 'aay', 'LOF AAY CARD': 'lof_aay',
    OAP: 'oap', POLICE: 'police', '"N" CARD': 'n_card', 'Police Card': 'police', 'அந்தியோதயா அட்டை': 'aay',
  };
  const wrong = Object.entries(labels).filter(([l, id]) => X.cardIdFor(l) !== id).map(([l, id]) => `${l} → ${X.cardIdFor(l)} (want ${id})`);
  check(`${Object.keys(labels).length} card labels, Tamil and English, map to the right card type`, !wrong.length, wrong.join('; '));
  const other = X.mapCardPhoto({ rows: [{ label: 'மொத்த பயனாளிகள்', count: 2158 }, { label: 'மொத்த அட்டைகள்', count: 777 }, { label: 'கைபேசி எண்', count: 7 }], totalShown: null });
  check(`"மொத்த அட்டைகள்" is the total (777); "மொத்த பயனாளிகள்" (beneficiaries) is not — it is listed as not recognised`, other.totalShown === 777 && other.unknown.some((u) => u.count === 2158) && !Object.keys(other.values).length, J(other));
}

console.log('\n2. Allotment from the FPS Allocation Report and from a POS screen');
{
  const crs8 = X.mapAllotPhoto(REPORT, { crsId: 8, code: '22EA007PN' }, SEP, ITEMS);
  const want8 = { BRA: 5420.639, AAY: 175, SUGAR: 772.5, WHEAT: 721.219, TOOR: 548.093, PALM: 549, OAP: 0, AAY_SUGAR: 8, PHH_BRA: 3530 };
  check(`CRS 8's row (22EA007PN): ${J(crs8.values)}`, J(crs8.values) === J(want8), J(crs8));
  check(`…police columns left out (${crs8.skipped.length}), nothing unrecognised, from "${crs8.source}"`, crs8.skipped.length === 5 && !crs8.unknown.length && crs8.source === '22EA007PN · Tncsc Crs 8');
  const crs30 = X.mapAllotPhoto(REPORT, { crsId: 30, code: '22EA009PN' }, SEP, ITEMS);
  check(`CRS 30's row: BRA 6237.83, PHH BRA 3863, AAY SUGAR 35.5 — its police 45 kg not taken`, crs30.values.BRA === 6237.83 && crs30.values.PHH_BRA === 3863 && crs30.values.AAY_SUGAR === 35.5 && !Object.values(crs30.values).includes(45));
  const crs7 = X.mapAllotPhoto(REPORT, { crsId: 7, code: '22EA005PN' }, SEP, ITEMS);
  check('CRS 7 gets the report\'s exact 10032.188 (the figure set-allotment wrote)', crs7.values.BRA === 10032.188);
  // The report split over two photos, with a row on both.
  const top = { ...REPORT, rows: REPORT_ROWS.slice(0, 5) };
  const bottom = { ...REPORT, rows: REPORT_ROWS.slice(4) };
  const split = X.combineAllot([top, bottom].map((t) => X.mapAllotPhoto(t, { crsId: 8, code: '22EA007PN' }, SEP, ITEMS)));
  check(`report in two photos: CRS 8 found on the second (${J(split.values) === J(want8) ? 'same figures' : J(split.values)}); the first says only that it has no row for CRS 8`, J(split.values) === J(want8) && split.problems.length === 1 && /No row for CRS 8 \(22EA007PN\)/.test(split.problems[0]));
  const split7 = X.combineAllot([top, bottom].map((t) => X.mapAllotPhoto(t, { crsId: 7, code: '22EA005PN' }, SEP, ITEMS)));
  check('CRS 7 is on both photos: one figure each, no conflict, no doubling', split7.values.BRA === 10032.188 && !split7.conflicts.length && !split7.problems.length);
  // A POS allotment screen for one shop — the office's example.
  const pos = { layout: 'pos_screen', month: null, year: null, rows: [{ fpsCode: null, fpsName: null, cells: [
    { column: 'BRA', value: 2000 }, { column: 'சீனி', value: 500 }, { column: 'Wheat', value: 1000 }, { column: 'துவரம் பருப்பு', value: 300 }, { column: 'பாம் ஆயில்', value: 250 },
  ] }] };
  const p = X.mapAllotPhoto(pos, { crsId: 19, code: '22CA005PN' }, SEP, ITEMS);
  check(`POS screen: BRA 2000, Sugar 500, Wheat 1000, Toor Dal 300, Palm Oil 250 → ${J(p.values)}`, J(p.values) === J({ BRA: 2000, SUGAR: 500, WHEAT: 1000, TOOR: 300, PALM: 250 }));
  const names = {
    'Rice (kg)': 'BRA', 'BRA Rice': 'BRA', 'புழுங்கல் அரிசி': 'BRA', 'AAY Rice (kg)': 'AAY', 'AAY அரிசி': 'AAY', 'PHH Rice (kg)': 'PHH_BRA', 'PHH BRA Rice': 'PHH_BRA',
    'PHH FRK Rice': 'PHH_FRK', 'NPHH FRK Rice': 'NPHH_FRK', 'NPHH FRK RRA அரிசி': 'NPHH_RRA', 'AAY FRK Rice': 'AAY_FRK', 'பச்சை அரிசி (RRA)': 'RRA',
    'OAP Rice (kg)': 'OAP', 'APS அரிசி': 'APS', 'Sugar (kg)': 'SUGAR', 'சீனி': 'SUGAR', 'AAY Sugar (kg)': 'AAY_SUGAR', 'Sugar (AAY)': 'AAY_SUGAR', 'AAY சீனி': 'AAY_SUGAR',
    'Wheat (kg)': 'WHEAT', 'கோதுமை': 'WHEAT', 'Toor Dhall (kg)': 'TOOR', 'Toor Dal': 'TOOR', 'துவரம் பருப்பு': 'TOOR', 'PalmOil (Pkt)': 'PALM', 'Palm Oil': 'PALM', 'பாம் ஆயில்': 'PALM',
    'Police Rice (kg)': null, 'Police PalmOil (Pkt)': null,
  };
  const wrong = Object.entries(names).filter(([l, id]) => X.allotIdFor(l) !== id).map(([l, id]) => `${l} → ${X.allotIdFor(l)} (want ${id})`);
  check(`${Object.keys(names).length} commodity headings, report / English / Tamil, map to the right field (police to none)`, !wrong.length, wrong.join('; '));
}

console.log('\n3. Refused rather than guessed');
{
  const aug = X.mapAllotPhoto({ ...REPORT, month: 'AUG' }, { crsId: 8, code: '22EA007PN' }, SEP, ITEMS);
  check(`an August report on September: "${aug.problem}"`, !Object.keys(aug.values).length && /August 2026 — the month open here is September 2026/.test(aug.problem));
  const nineteen = X.mapAllotPhoto(REPORT, { crsId: 19, code: '22CA005PN' }, SEP, ITEMS);
  check(`CRS 19 is not in this report: "${nineteen.problem}"`, !Object.keys(nineteen.values).length && /No row for CRS 19 \(22CA005PN\)/.test(nineteen.problem));
  const byNameOnly = X.mapAllotPhoto({ ...REPORT, rows: REPORT_ROWS.map((r) => ({ ...r, fpsCode: null })) }, { crsId: 12, code: '22EA008PN' }, SEP, ITEMS);
  check('codes unreadable: the row is found by its name "Crs 12"', byNameOnly.values.BRA === 6468.228);
  const noCrs12 = X.mapAllotPhoto({ ...REPORT, rows: REPORT_ROWS.map((r) => ({ ...r, fpsCode: null })) }, { crsId: 1, code: '22EA010PN' }, SEP, ITEMS);
  check('…and "TNCSC 11" is not taken for CRS 1', !!noCrs12.problem);
  const clash = X.combineCards([X.mapCardPhoto(POS_PAGE_2), X.mapCardPhoto({ rows: [{ label: 'அரிசி அட்டை', count: 723 }], totalShown: 777 })]);
  check(`two photos disagree on RICE (728 / 723): left for the clerk, no zeros filled`, !('rice' in clash.values) && clash.conflicts.includes('rice') && !clash.zeroFilled.length);
  const unknown = X.mapAllotPhoto({ layout: 'pos_screen', rows: [{ cells: [{ column: 'Kerosene (Ltr)', value: 40 }, { column: 'Salt (CIS)', value: 20 }] }] }, { crsId: 19 }, SEP, ITEMS);
  check(`labels with no Allotment field are listed, not entered: ${unknown.unknown.map((u) => u.label).join(', ')}`, !Object.keys(unknown.values).length && unknown.unknown.length === 2);
  const negative = X.mapCardPhoto({ rows: [{ label: 'அரிசி அட்டை', count: -5 }, { label: 'AAY அட்டை', count: 2.5 }] });
  check('a negative or fractional card count is not a count', !Object.keys(negative.values).length);
}

console.log('\n4. The draft keeps the clerk\'s corrections');
{
  const both = X.combineCards([X.mapCardPhoto(POS_PAGE_1), X.mapCardPhoto(POS_PAGE_2)]);
  const d = X.photoDraft(both.values, both.zeroFilled, new Set(['rice', 'oap']));
  check(`RICE and OAP typed by hand: the draft leaves them alone (${J(d)})`, !('rice' in d) && !('oap' in d) && d.sugar === 13);
}

console.log('\n5. The server: request and answer (no network)');
{
  const req = O.buildOcrRequest('cards', { mediaType: 'image/jpeg', data: 'AAAA' });
  check(`request: model ${req.model}, one forced tool (${req.tool_choice.name}), the photo then the instruction`, req.model === O.OCR_DEFAULT_MODEL && req.tools.length === 1 && req.tool_choice.type === 'tool' && req.messages[0].content[0].type === 'image' && req.messages[0].content[0].source.data === 'AAAA' && /Never add up, correct, round or guess/.test(req.system));
  check('the allotment request asks for every row and the police columns too', /EVERY shop row/.test(O.buildOcrRequest('allot', { mediaType: 'image/png', data: 'A' }).messages[0].content[1].text));
  const answer = { content: [{ type: 'tool_use', name: 'record_card_details', input: { rows: [{ label: ' அரிசி அட்டை ', count: 728 }, { label: '', count: 3 }, { label: 'x', count: 'n/a' }], totalShown: 777 } }] };
  check(`answer read into the transcription shape: ${J(O.parseOcrResponse('cards', answer))}`, J(O.parseOcrResponse('cards', answer)) === J({ rows: [{ label: 'அரிசி அட்டை', count: 728, rowNo: null }], totalShown: 777 }));
  check('an answer without the tool call is no answer', O.parseOcrResponse('cards', { content: [{ type: 'text', text: 'hi' }] }) === null);
  const mock = (status, body) => async (url, init) => { mock.last = { url, init }; return new Response(JSON.stringify(body), { status }); };
  const noKey = await O.readPhoto('cards', { mediaType: 'image/jpeg', data: 'A' }, { key: '' }, mock(200, answer));
  check(`no key: ${noKey.status} "${noKey.error}"`, !noKey.ok && noKey.status === 503 && /not set up/.test(noKey.error));
  const f = mock(200, answer);
  const ok = await O.readPhoto('cards', { mediaType: 'image/jpeg', data: 'A' }, { key: 'k', model: 'm-test' }, f);
  const sent = JSON.parse(mock.last.init.body);
  check(`reads through the API: POST ${mock.last.url}, key in x-api-key, model override m-test`, ok.ok && mock.last.url === 'https://api.anthropic.com/v1/messages' && mock.last.init.headers['x-api-key'] === 'k' && sent.model === 'm-test');
  check('refused key / busy / unreadable photo each say so', !(await O.readPhoto('cards', { mediaType: 'image/jpeg', data: 'A' }, { key: 'k' }, mock(401, {}))).ok
    && /busy/.test((await O.readPhoto('cards', { mediaType: 'image/jpeg', data: 'A' }, { key: 'k' }, mock(529, {}))).error)
    && /could not be read/.test((await O.readPhoto('cards', { mediaType: 'image/jpeg', data: 'A' }, { key: 'k' }, mock(400, {}))).error));
  const route = readFileSync(join(root, 'src/app/api/ocr/route.ts'), 'utf8');
  check('the route answers only a signed-in session, and checks kind, type and size', /if \(!session\) return NextResponse\.json\(\{ error: 'Not signed in\.' \}, \{ status: 401 \}\)/.test(route) && /OCR_KINDS\.includes/.test(route) && /OCR_MAX_BASE64/.test(route));
  check('the key is server-only (never NEXT_PUBLIC_)', !/NEXT_PUBLIC_ANTHROPIC/.test(readFileSync(join(root, 'src/lib/ocr/server.ts'), 'utf8') + readFileSync(join(root, 'src/lib/ocr/client.ts'), 'utf8')));
}

console.log('\n6. Saved, they are what CRS Page 1 prints');
{
  const both = X.combineCards([X.mapCardPhoto(POS_PAGE_1), X.mapCardPhoto(POS_PAGE_2)]);
  const draft = X.photoDraft(both.values, both.zeroFilled, new Set());
  const cards = Object.fromEntries(Object.entries(draft).map(([id, v]) => [id, { count: v }]));
  const allot = X.mapAllotPhoto(REPORT, { crsId: 30, code: '22EA009PN' }, SEP, ITEMS).values;
  const e = createStatementEngine({
    stores: {
      entryStore: {}, inspectionStore: {}, monthlyStore: {}, meManualStore: {}, meSourceStore: {}, meRemitStore: {}, meGunnyStore: {},
      meCardStore: { '30_9_2026': cards }, salesCloseStore: {}, receiptStore: [], meAllotStore: { '30_9_2026': allot }, meCardConfirmed: {}, meAdvanceStore: {},
    },
    users: [], CRS_LIST: Array.from({ length: 30 }, (_, i) => ({ id: i + 1, name: `CRS ${i + 1}` })), CRS_MASTER: [], APP_CONFIG: {}, CRS_ACCOUNTS: {}, currentUser: null,
  });
  const sheet = A.officeSheet('crs_page1');
  const { values } = F.fillSection('crs_page1', sheet, e.buildSection('crs_page1', e.getData(30, 9, 2026)));
  const cell = (cap) => {
    const want = cap.replace(/\s+/g, '');
    const hit = Object.entries(sheet.cells).find(([, c]) => c.p && c.p.replace(/\s+/g, '').replace(/:$/, '').startsWith(want));
    return String(values[hit?.[0]] ?? '').trim();
  };
  const got = { rice: cell('RICE CARD'), aay: cell('AAY CARD'), police: cell('POLICE'), total: cell('TOTAL CARD DETAILS'), bra: cell('1.RICE&AAY'), sugar: cell('2.SUGAR&AAY'), wheat: cell('3.WHEAT'), toor: cell('4.T.D & P.O') };
  check(`Page 1: RICE CARD ${got.rice}, AAY CARD ${got.aay}, POLICE ${got.police}, TOTAL CARD DETAILS ${got.total}`, got.rice === '728' && got.aay === '27' && got.police === '4' && got.total === '777', J(got));
  check(`Page 1 allotment: 1.RICE&AAY ${got.bra} · 2.SUGAR&AAY ${got.sugar} · 3.WHEAT ${got.wheat} · 4.T.D & P.O ${got.toor}`, /6237\.83/.test(got.bra) && /840/.test(got.bra) && /936/.test(got.sugar) && /35\.5/.test(got.sugar) && /875\.615/.test(got.wheat) && /635\.392/.test(got.toor) && /635\.4/.test(got.toor), J(got));
}

console.log('\n7. Wiring: nothing from a photo is written before Save');
{
  const ca = readFileSync(join(root, 'src/app/(app)/monthly-entry/CardAllot.tsx'), 'utf8').replace(/\r\n/g, '\n');
  const box = readFileSync(join(root, 'src/app/(app)/monthly-entry/PhotoBox.tsx'), 'utf8');
  const writes = [...ca.matchAll(/writeDraft\(/g)].length;
  check('the draft is written in exactly two places: Save Card Details and Save Allotment', writes === 2 && /const writeDraft = </.test(ca) && /const saveCards = async \(\) => \{\n\s+commitCarry\(\);\n\s+writeDraft\('meCardStore'/.test(ca) && /const saveAllot = async \(\) => \{\n\s+writeDraft\('meAllotStore'/.test(ca));
  check('the photo box itself writes nothing (no crsData)', !/crsData/.test(box));
  check('the two boxes are separate kinds (a card photo cannot fill Allotment)', /<PhotoBox kind="cards"[^>]*onRead=\{onCardsRead\}/.test(ca) && /<PhotoBox kind="allot"[^>]*onRead=\{onAllotRead\}/.test(ca) && /combineCards\(cur\.cards\.map\(mapCardPhoto\)\)/.test(ca) && /cur\.allot\.map\(\(t\) => mapAllotPhoto\(/.test(ca));
  check('typing into a field takes it out of the draft', /const setCount = \(id: string, val: string\) => \{\n\s+settle\('cards', \[id\]\);/.test(ca) && /const setAllot = \(id: string, val: string\) => \{\n\s+settle\('allot', \[id\]\);/.test(ca));
  check('the Saves still wait for the database before the tick', /if \(await crsData\.saveConfirmed\(\)\) saveSuccess\(cardDetailsSaved\(/.test(ca) && /if \(await crsData\.saveConfirmed\(\)\) saveSuccess\(allotmentSaved\(/.test(ca));
  check('a draft on screen never reads as saved', /const cardsBadge = cardsSaved && !hasDraftCards;/.test(ca) && /const allotBadge = allotSaved && !hasDraftAllot;/.test(ca));
}

console.log(failures ? `\n${failures} check(s) FAILED` : '\nAll photo-extract checks passed.');
process.exitCode = failures ? 1 : 0;
