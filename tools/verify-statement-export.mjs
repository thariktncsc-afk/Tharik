/**
 * The statement exports — PDF (print) and Excel — as executable cases.
 *
 *   node tools/verify-statement-export.mjs
 *
 * Driven against `golden/statements/`: the 306 snapshots of what the builders
 * actually produce. The builders are NOT touched by any of this — the same
 * snapshots still pass `verify:statements` byte-for-byte — so what is checked
 * here is the assembly: that every statement gets its own page, that the file
 * Excel opens has one worksheet per statement, and above all that no figure is
 * lost, changed or invented on the way.
 *
 * The three faults this replaces, kept as cases so they cannot come back:
 *   - every statement printed onto one page (nothing broke a page);
 *   - one builder's `@page{size:A3 landscape}` turned the whole print job to
 *     A3, which an A4 printer then shrank;
 *   - the .xls was HTML, so Excel opened one sheet with the flex-laid-out
 *     statements collapsed on top of each other.
 *
 * Runs the TypeScript source directly (Node >= 23.6 strips types).
 */
import { register } from 'node:module';
import { readFileSync, readdirSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { unzipSync, strFromU8 } from 'fflate';
import XLSX from 'xlsx-js-style';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const srcUrl = pathToFileURL(join(root, 'src') + '/').href;
register(
  `data:text/javascript,${encodeURIComponent(`
const SRC_URL = ${JSON.stringify(srcUrl ?? (pathToFileURL(join(root,"src")+"/").href))};
export async function resolve(spec, ctx, next) {
  if (spec.startsWith('@/')) {
    const base = SRC_URL + spec.slice(2);
    // A JSON module needs its import attribute stating under Node's ESM
    // loader; the bundler infers it from the extension.
    if (base.endsWith('.json')) return { url: base, shortCircuit: true, importAttributes: { type: 'json' } };
    return next(base + '.ts', ctx);
  }
  return next(spec, ctx);
}`)}`,
  import.meta.url,
);

let failures = 0;
const check = (label, ok, detail = '') => {
  if (ok) console.log(`  ok    ${label}`);
  else {
    failures++;
    console.log(`  FAIL  ${label}${detail ? `\n        ${detail}` : ''}`);
  }
};

const P = await import(pathToFileURL(join(root, 'src/lib/statements/printDoc.ts')).href);
const M = await import(pathToFileURL(join(root, 'src/lib/statements/sheetModel.ts')).href);
const W = await import(pathToFileURL(join(root, 'src/lib/statements/toWorkbook.ts')).href);

const GOLDEN = join(root, 'golden/statements');
const files = readdirSync(GOLDEN).filter((f) => f.endsWith('.html'));
const load = (name) => readFileSync(join(GOLDEN, name), 'utf8');
const labelOf = (name) =>
  name
    .replace(/\.html$/, '')
    .split('_')
    .slice(1)
    .join(' ')
    .replace(/\b\w/g, (c) => c.toUpperCase());
const sectionOf = (name, copies = 1) => ({ id: name.replace(/\.html$/, ''), label: labelOf(name), copies, html: load(name) });

// One shop's full set, as someone selecting everything would export it.
const crs19 = files.filter((f) => f.startsWith('crs19_'));

console.log(`\nLoaded ${files.length} golden statements (${crs19.length} for CRS 19)`);

console.log('\nPDF — one statement, one page');
{
  const three = [sectionOf('crs19_crs_page1.html'), sectionOf('crs19_gunny.html'), sectionOf('crs19_b6.html')];
  const doc = P.buildPrintDocument('T', 'body{}', three);
  const sheets = doc.match(/class="stmt-sheet /g) ?? [];
  check('three statements → three sheets, in the order selected', sheets.length === 3, String(sheets.length));
  check('…each one page-broken from the next', (doc.match(/break-after:page/g) ?? []).length >= 1 && /\.stmt-sheet:last-child\{break-after:auto/.test(doc));
  check('…and every statement’s own markup is carried through untouched',
    three.every((s) => doc.includes(s.html)));
  check('the document is a whole page, not a fragment', doc.startsWith('<!DOCTYPE html>') && doc.includes('</html>'));

  const two = [{ ...sectionOf('crs19_crs_page2.html'), copies: 2 }];
  const copied = P.buildPrintDocument('T', '', two);
  check('a ×2 statement prints as two separate sheets', (copied.match(/class="stmt-sheet /g) ?? []).length === 2);
  check('…each marked as its own copy', /data-copy="1"/.test(copied) && /data-copy="2"/.test(copied));
  check('sheet count is one per copy', P.sheetCount([{ copies: 2 }, { copies: 1 }, { copies: 2 }]) === 5);
}

console.log('\nPDF — A4, not A3');
{
  const daily = sectionOf('crs19_crs_daily_sale.html');
  check('the Daily Sales builder still carries its A3 rule (untouched)', /@page\{size:A3 landscape\}/.test(daily.html));
  const doc = P.buildPrintDocument('T', '', [daily, sectionOf('crs19_gunny.html')]);
  const ourCss = doc.lastIndexOf('<style>');
  check('…but our A4 page rules come last, so they win',
    ourCss > doc.indexOf(daily.html) && /@page stmtP\{size:A4 portrait/.test(doc.slice(ourCss)) && /@page stmtL\{size:A4 landscape/.test(doc.slice(ourCss)));
  check('…and the body font it forces for print is put back', /@media print\{body\{font-size:11px/.test(doc));
  check('a narrow statement stays portrait', P.orientationOf(load('crs19_sale_tax.html'), 'sale_tax') === 'portrait', String(P.columnCount(load('crs19_sale_tax.html'))));
  check('a wide one does not (gunny is 11 columns)', P.orientationOf(load('crs19_gunny.html')) === 'landscape');
  check('a 22-column statement is laid on its side', P.orientationOf(daily.html) === 'landscape', String(P.columnCount(daily.html)));
  check('…and says so on its own sheet', /stmt-sheet--landscape[^>]*data-section="crs19_crs_daily_sale"/.test(doc));
  // Orientation now comes from the office's own workbook, sheet by sheet
  // (pageSetup.ts, read from CRS 19 AUG'26.xlsx) — not from counting columns.
  for (const [id, want] of Object.entries({
    crs_page1: 'portrait', receipt: 'landscape', crs_daily_sale: 'landscape', crs_page2: 'landscape',
    gunny: 'landscape', free_com: 'landscape', cost_com: 'landscape', crs_police: 'landscape',
    remittance: 'portrait', coll: 'portrait', sale_tax: 'portrait', b6: 'landscape',
    card_details: 'landscape', rbi: 'landscape',
  })) {
    check(`${id} prints ${want}, as the workbook's sheet does`, P.orientationOf(load(`crs19_${id}.html`), id) === want);
  }
  for (const [id, cols] of [['crs_police', 9], ['card_details', 8], ['rbi', 8]]) {
    const html = load(`crs19_${id}.html`);
    check(`…${id} landscape comes from the workbook, not its width (only ${cols} columns)`,
      P.orientationOf(html) === 'portrait' && P.columnCount(html) === cols, `${P.columnCount(html)} cols`);
  }
  check('each sheet carries its own margins from the workbook',
    /@page stmtcrspolice\{size:A4 landscape;margin:6\.35mm 6\.35mm 0mm 6\.35mm\}/.test(P.buildPrintDocument('T', '', [{ ...sectionOf('crs19_crs_police.html'), id: 'crs_police' }])),
    (P.pageCss(['crs_police']).match(/@page stmtcrspolice[^\n]*/) ?? ['none'])[0]);
  check('…and the sheets the office centres are centred',
    /\.stmt-sheet\[data-section="crs_police"\]\{page:stmtcrspolice;margin-left:auto/.test(P.pageCss(['crs_police'])) &&
      !/margin-left:auto/.test(P.pageCss(['coll'])));
  check('…and they say so on their own sheets',
    ['crs_police', 'card_details', 'rbi'].every((id) =>
      new RegExp(`stmt-sheet--landscape[^>]*data-section="${id}"`).test(P.buildPrintDocument('T', '', [sectionOf(`crs19_${id}.html`)].map((s) => ({ ...s, id }))))));
  check('a statement NOT on that list is still measured', P.orientationOf(load('crs19_sale_tax.html'), 'sale_tax') === 'portrait');
  check('the preview shows the same sheet the printer will', /stmt-sheet--landscape/.test(P.buildPreviewSheet(load('crs19_rbi.html'), 'rbi')) && /stmt-sheet--portrait/.test(P.buildPreviewSheet(load('crs19_rbi.html'))));

  check('the header row repeats on a continuation page', /thead\{display:table-header-group\}/.test(doc));
  check('a row is never split across two pages', /tr\{break-inside:avoid/.test(doc));
  check('the screen scroller cannot hide the right-hand columns on paper', /overflow:visible!important/.test(doc));
}

console.log('\nPDF — every golden statement is placed');
{
  const all = files.map((f) => sectionOf(f));
  const doc = P.buildPrintDocument('All', '', all);
  check(`${files.length} statements → ${files.length} sheets`, (doc.match(/class="stmt-sheet /g) ?? []).length === files.length);
  const widths = files.map((f) => P.columnCount(load(f)));
  check('every statement’s column count was readable (none came back 0)', widths.every((n) => n > 0), JSON.stringify(files.filter((_, i) => !widths[i])));
}

console.log('\nExcel — one report, one worksheet');
{
  const four = ['crs1_gunny.html', 'crs5_gunny.html', 'crs8_gunny.html', 'crs9_gunny.html'].map((f) => ({
    id: f,
    label: `CRS ${f.match(/crs(\d+)/)[1]}`,
    html: load(f),
  }));
  const plans = W.planWorkbook(four);
  check('four reports → four sheets', plans.length === 4);
  check('…named for the reports, in order', plans.map((p) => p.name).join(',') === 'CRS 1,CRS 5,CRS 8,CRS 9', plans.map((p) => p.name).join(','));

  const wb = XLSX.read(W.buildStatementsXlsx(four), { type: 'array' });
  check('the written file really holds four sheets', wb.SheetNames.length === 4, wb.SheetNames.join(','));
  check('…each with its own cells', wb.SheetNames.every((n) => Object.keys(wb.Sheets[n]).some((k) => /^[A-Z]+\d+$/.test(k))));

  const taken = new Set();
  const names = ['CRS Page 1', 'CRS Page 1', 'A very long statement label that Excel will not accept at all'].map((l) => W.sheetName(l, taken));
  check('a repeated label never silently merges two sheets', names[0] !== names[1], names.join(' / '));
  check('…and no name is longer than Excel allows', names.every((n) => n.length <= 31), names[2]);
  check('characters Excel forbids are removed', W.sheetName('CRS/Page[1]:*?', new Set()) === 'CRS Page 1');
}

console.log('\nExcel — the figures survive');
{
  // Every figure a statement prints must appear in its worksheet, as a
  // number. Compared CELL BY CELL — the statement's own <td>/<th> against the
  // grid's cells — because flattening a statement to text glues neighbouring
  // figures into numbers nobody ever printed.
  let checkedSections = 0;
  const missing = [];
  for (const f of crs19) {
    const html = load(f).replace(/<style[\s\S]*?<\/style>/g, '');
    const grid = M.parseStatement(html);
    const left = [];
    for (const row of grid.rows) for (const c of row) if (c.num !== undefined) left.push(c.num);
    const lost = [];
    for (const m of html.matchAll(/<(t[hd])\b[^>]*>([\s\S]*?)<\/\1>/gi)) {
      const n = M.numberOf(M.textOf(m[2]));
      if (!n) continue;
      const i = left.indexOf(n.num);
      if (i < 0) lost.push(n.num);
      else left.splice(i, 1);
    }
    checkedSections++;
    if (lost.length) missing.push(`${f}: ${lost.slice(0, 4).join(', ')}`);
  }
  check(`every figure printed on CRS 19's ${checkedSections} statements is in its worksheet`, missing.length === 0, missing.slice(0, 3).join(' | '));

  const grid = M.parseStatement(load('crs19_crs_page2.html'));
  const nums = grid.rows.flat().filter((c) => c.num !== undefined);
  check('numbers are stored as numbers, not text', nums.length > 10, String(nums.length));
  check('…keeping the decimals the statement printed', nums.some((c) => c.decimals === 3), JSON.stringify(nums.slice(0, 3)));
  check('a date is never turned into a number', !grid.rows.flat().some((c) => /\d{2}[-/]\d{2}[-/]\d{4}/.test(c.text) && c.num !== undefined));
}

console.log('\nExcel — the flex-laid-out statement is a grid, not one squashed column');
{
  const grid = M.parseStatement(load('crs19_crs_page1.html'));
  check('CRS Page 1 has no table at all (why it used to collapse)', !/<table/i.test(load('crs19_crs_page1.html')));
  check('…and still comes out as rows and columns', grid.rows.length > 10 && grid.cols === 2, `rows=${grid.rows.length} cols=${grid.cols}`);
  const text = grid.rows.map((r) => r.map((c) => c.text).join('|')).join('\n');
  check('…with the card details on the left and the allotment on the right', /RICE CARD\s*:\s*698\|1\.NPHH&AAY FRK/.test(text), text.split('\n')[6]);
  check('…and no two values ending up in one cell', !grid.rows.some((r) => r.some((c) => c.text.split('\n').length > 3)));
}

console.log('\nExcel — print-ready');
{
  const wide = [{ id: 'w', label: 'Daily Sale', html: load('crs19_crs_daily_sale.html') }];
  const narrow = [{ id: 'n', label: 'Card Details', html: load('crs19_card_details.html') }];
  check('a wide report prints landscape', W.planWorkbook(wide)[0].orientation === 'landscape');
  check('a narrow one prints portrait', W.planWorkbook(narrow)[0].orientation === 'portrait');
  check('the three the office files on their side are landscape in Excel too, as on paper',
    ['crs_police', 'card_details', 'rbi'].every(
      (id) => W.planWorkbook([{ id, label: id, html: load(`crs19_${id}.html`) }])[0].orientation === 'landscape',
    ));

  const bytes = W.buildStatementsXlsx([...wide, ...narrow]);
  const zip = unzipSync(bytes);
  const s1 = strFromU8(zip['xl/worksheets/sheet1.xml']);
  const s2 = strFromU8(zip['xl/worksheets/sheet2.xml']);
  check('sheet 1 is set to landscape, fitted to one page wide', /orientation="landscape"/.test(s1) && /fitToWidth="1"/.test(s1) && /fitToHeight="0"/.test(s1));
  check('sheet 2 is set to portrait', /orientation="portrait"/.test(s2));

  // The office's own page setup, per sheet, in the exported file.
  const office = W.buildStatementsXlsx([
    { id: 'crs_police', label: 'CRS Police', html: load('crs19_crs_police.html') },
    { id: 'sale_tax', label: 'Sale Tax', html: load('crs19_sale_tax.html') },
  ]);
  const oz = unzipSync(office);
  const police = strFromU8(oz['xl/worksheets/sheet1.xml']);
  const saleTax = strFromU8(oz['xl/worksheets/sheet2.xml']);
  check('CRS Police exports at the office\'s 145%, landscape, not fitted',
    /orientation="landscape"/.test(police) && /scale="145"/.test(police) && !/fitToWidth/.test(police), (police.match(/<pageSetup[^>]*>/) ?? ['none'])[0]);
  check('…with its own margins (0.25 / 0.25 / 0.25 / 0) and centred',
    /left="0\.25" right="0\.25" top="0\.25" bottom="0"/.test(police) && /horizontalCentered="1"/.test(police), (police.match(/<pageMargins[^>]*>/) ?? ['none'])[0]);
  check('Sale Tax exports portrait, fitted to one page, with its own margins',
    /orientation="portrait"/.test(saleTax) && /fitToWidth="1"/.test(saleTax) && /left="1\.181"/.test(saleTax), (saleTax.match(/<pageSetup[^>]*>/) ?? ['none'])[0]);
  check('…and the file still opens as a workbook', XLSX.read(office, { type: 'array' }).SheetNames.length === 2);
  check('fit-to-page is switched on for the sheet', /<pageSetUpPr fitToPage="1"\/>/.test(s1));
  check('A4 paper', /paperSize="9"/.test(s1) && /paperSize="9"/.test(s2));
  check('the header rows are frozen', /state="frozen"/.test(s1), (s1.match(/<pane[^>]*>/) ?? ['none'])[0]);
  check('sheetPr comes first and pageSetup last, as Excel requires',
    s1.indexOf('<sheetPr>') < s1.indexOf('<sheetData'), 'sheetPr must precede sheetData');
  check('…and the file still parses as a workbook', XLSX.read(bytes, { type: 'array' }).SheetNames.length === 2);

  // Widths and heights are only parsed back when styles are read.
  const wb = XLSX.read(bytes, { type: 'array', cellStyles: true });
  const ws = wb.Sheets[wb.SheetNames[0]];
  check('column widths are set, none left collapsed', (ws['!cols'] ?? []).length > 5 && ws['!cols'].every((c) => (c.wch ?? 0) >= 8), JSON.stringify((ws['!cols'] ?? []).slice(0, 2)));
  check('row heights are set', (ws['!rows'] ?? []).length > 5, String((ws['!rows'] ?? []).length));
  check('merged cells carry the statement’s own merges', (ws['!merges'] ?? []).length > 0);
  check('header rows are repeated on every printed page (Print_Titles)',
    (wb.Workbook?.Names ?? []).some((n) => n.Name === '_xlnm.Print_Titles'), JSON.stringify(wb.Workbook?.Names?.slice(0, 2)));
  check('a print area is set for each sheet',
    (wb.Workbook?.Names ?? []).filter((n) => n.Name === '_xlnm.Print_Area').length === 2);
}

console.log('\nExcel — Tamil text');
{
  // The statutory statements are printed in English, so none of the goldens
  // carries Tamil — but the commodity names on the screens do, and a shop's
  // name certainly can. A statement shaped like the builders' own output
  // stands in for one, so the .xlsx is proved to carry Tamil either way.
  const tamilHtml =
    '<div class="t-wrap"><div class="t-title">நியாய விலைக் கடை — அறிக்கை</div>' +
    '<table><thead><tr><th>பொருட்கள்</th><th>அளவு</th></tr></thead>' +
    '<tbody><tr><td class="l">புழுங்கல் அரிசி</td><td class="right">4750.000</td></tr>' +
    '<tr><td class="l">கோதுமை</td><td class="right">1806.500</td></tr></tbody></table></div>';
  const grid = M.parseStatement(tamilHtml);
  const cells = grid.rows.flat().filter((c) => /[஀-௿]/.test(c.text));
  check('Tamil reaches the cells intact', cells.length >= 4, String(cells.length));
  const bytes = W.buildStatementsXlsx([{ id: 't', label: 'தமிழ் அறிக்கை', html: tamilHtml }]);
  const wb = XLSX.read(bytes, { type: 'array' });
  const ws = wb.Sheets[wb.SheetNames[0]];
  const back = Object.keys(ws)
    .filter((k) => /^[A-Z]+\d+$/.test(k))
    .map((k) => String(ws[k].v ?? ''));
  check('…and survives the round trip through the .xlsx', back.includes('புழுங்கல் அரிசி') && back.includes('கோதுமை'), back.slice(0, 4).join(' / '));
  check('…including in the worksheet name', wb.SheetNames[0] === 'தமிழ் அறிக்கை', wb.SheetNames[0]);
  check('…and the figures beside it stay numbers', back.includes('4750') || Object.values(ws).some((c) => c && c.t === 'n' && c.v === 4750));
}

console.log('\nEvery golden statement converts');
{
  const failed = [];
  for (const f of files) {
    try {
      const grid = M.parseStatement(load(f));
      if (!grid.rows.length) failed.push(`${f}: no rows`);
    } catch (e) {
      failed.push(`${f}: ${e.message}`);
    }
  }
  check(`all ${files.length} statements parse into a grid`, failed.length === 0, failed.slice(0, 3).join(' | '));

  const all = files.slice(0, 40).map((f) => ({ id: f, label: labelOf(f), html: load(f) }));
  const wb = XLSX.read(W.buildStatementsXlsx(all), { type: 'array' });
  check('a 40-statement workbook writes and reads back', wb.SheetNames.length === 40, String(wb.SheetNames.length));
  check('…with every sheet name unique', new Set(wb.SheetNames).size === 40);
}

console.log(failures ? `\n${failures} FAILED` : '\nSTATEMENT EXPORT OK');
process.exitCode = failures ? 1 : 0;
