/**
 * Every statement names the shop's staff by the ROLE the users table gives
 * them — B.C for a Bill Clerk, P.K.R for a Packer, both when both, neither
 * when neither — in Preview, Print and Excel alike.
 *
 *   node tools/verify-staff-posts.mjs
 *
 * Drives the real statement engine over all fourteen sections, and the real
 * office-sheet fill for CRS Page 1 (templateAmend.ts → officeSheetFor). The
 * staff are made up — no real names or numbers — and CRS_MASTER is given a
 * WRONG `bc:` for every shop, because the master's `bc:` column is exactly
 * what used to put a Packer on paper as a Bill Clerk (CRS 5, 8, 19, 28, 29).
 *
 * (office, 2026-09-21) — see 43-staff-posts.js.
 */
import { register } from 'node:module';
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
const W = await import(pathToFileURL(join(root, 'src/lib/statements/toWorkbook.ts')).href);

let failures = 0;
const check = (label, ok, detail = '') => {
  if (ok) console.log(`  ok    ${label}`);
  else {
    failures++;
    console.log(`  FAIL  ${label}${detail ? `\n        ${detail}` : ''}`);
  }
};

const SECTIONS = ['crs_page1', 'receipt', 'crs_daily_sale', 'crs_page2', 'gunny', 'free_com', 'cost_com', 'crs_police',
  'remittance', 'coll', 'sale_tax', 'b6', 'card_details', 'rbi'];
const CRS_LIST = Array.from({ length: 30 }, (_, i) => ({ id: i + 1, name: `CRS ${i + 1}` }));

// Made-up people. The master names someone else as `bc:` for every shop.
const BC = { fullName: 'Test Billclerk', phone: '9000000001' };
const PK = { fullName: 'Test Packerman', phone: '9000000002' };
const MASTER_WRONG = 'Master Sheet Name';

function render(users, crsId = 9) {
  const e = createStatementEngine({
    stores: {
      entryStore: {}, inspectionStore: {}, monthlyStore: {}, meManualStore: {}, meSourceStore: {}, meRemitStore: {},
      meGunnyStore: {}, meCardStore: {}, salesCloseStore: {}, receiptStore: [], meAllotStore: {}, meCardConfirmed: {}, meAdvanceStore: {},
    },
    users,
    CRS_LIST,
    CRS_MASTER: CRS_LIST.map((c) => ({ id: c.id, bc: MASTER_WRONG, bcMobile: '9999999999', coll: true, police: true, status: 'Active' })),
    APP_CONFIG: {}, CRS_ACCOUNTS: {}, currentUser: null,
  });
  const d = e.getData(crsId, 9, 2026);
  const out = {};
  for (const s of SECTIONS) out[s] = e.buildSection(s, d);
  return out;
}
const text = (html) => html.replace(/<br\s*\/?>/gi, '\n').replace(/<[^>]*>/g, ' ').replace(/&amp;/g, '&').replace(/[ \t]+/g, ' ');
const u = (p, role, crsId = 9, active = true) => ({ id: role === 'BC' ? 1 : 2, fullName: p.fullName, phone: p.phone, role, crsId, active });

const BC_WORDS = /\bB\.C\b|BILL CLERK|\bBC\b/;
const PK_WORDS = /\bP\.K\.R\b|PACKER|\bPKR\b/;

/** Page 1 as the office's sheet: preview, print and Excel text. */
function page1Everywhere(html) {
  const preview = text(P.buildPreviewSheet(html, 'crs_page1'));
  const doc = P.buildPrintDocument('T', '', [{ id: 'crs_page1', label: 'CRS Page 1', copies: 1, html }]);
  const print = text(doc);
  const x = unzipSync(W.buildStatementsXlsx([{ id: 'crs_page1', label: 'CRS Page 1', html }]));
  const excel = text(strFromU8(x['xl/sharedStrings.xml'] ?? new Uint8Array()) + strFromU8(x['xl/worksheets/sheet1.xml']));
  return { preview, print, excel };
}

function commonChecks(name, out) {
  const all = Object.values(out).map(text).join('\n');
  check(`${name}: the master sheet's bc: name appears nowhere`, !all.includes(MASTER_WRONG) && !all.includes('9999999999'));
  return all;
}

console.log('\n1. Only a Bill Clerk');
{
  const out = render([u(BC, 'BC')]);
  const all = commonChecks('only BC', out);
  check('the Bill Clerk is named on every sheet that names staff', ['crs_page1', 'receipt', 'crs_daily_sale', 'crs_page2', 'gunny', 'free_com', 'cost_com', 'crs_police', 'coll', 'card_details'].every((s) => text(out[s]).includes(BC.fullName)),
    ['crs_page1', 'receipt', 'crs_daily_sale', 'crs_page2', 'gunny', 'free_com', 'cost_com', 'crs_police', 'coll', 'card_details'].filter((s) => !text(out[s]).includes(BC.fullName)).join(','));
  check('…under B.C / BILL CLERK / BC', /NAME OF THE B\.C: Test Billclerk/.test(text(out.crs_page1)) && /BILL CLERK : Test Billclerk/.test(text(out.crs_page2)) && /SIGNATURE OF BC/.test(text(out.remittance)));
  check('no P.K.R / PACKER / PKR anywhere', !PK_WORDS.test(all), (all.match(PK_WORDS) ?? [])[0]);
  check('the Bill Clerk\'s phone', text(out.crs_page2).includes(`MOBILE NO : ${BC.phone}`) && text(out.crs_page1).includes(`MOBILE NO : ${BC.phone}`));
  const p1 = page1Everywhere(out.crs_page1);
  for (const [where, t] of Object.entries(p1)) {
    check(`Page 1 ${where}: NAME OF THE B.C / SIGNATURE OF B.C / the BC's mobile, no P.K.R`,
      /NAME OF THE B\.C:\s*Test Billclerk/.test(t) && /SIGNATURE OF B\.C :/.test(t) && t.includes(BC.phone) && !/P\.K\.R/.test(t), t.match(/(NAME|SIGNATURE) OF THE?[^\n]{0,40}/g)?.join(' | '));
  }
}

console.log('\n2. Only a Packer (the CRS 5 / 8 / 19 / 28 / 29 case)');
{
  const out = render([u(PK, 'Packer')]);
  const all = commonChecks('only PKR', out);
  check('the Packer is named — as P.K.R / PACKER / PKR', /NAME OF THE P\.K\.R: Test Packerman/.test(text(out.crs_page1)) && /PACKER : Test Packerman/.test(text(out.crs_page2)) && /SIGNATURE OF PKR: Test Packerman/.test(text(out.crs_daily_sale)) && /SIGNATURE OF PKR/.test(text(out.remittance)));
  check('never as a Bill Clerk: no B.C / BILL CLERK / BC anywhere', !BC_WORDS.test(all), (all.match(new RegExp(`.{0,30}(${BC_WORDS.source}).{0,30}`)) ?? [])[0]);
  check('the Packer\'s phone', text(out.crs_page2).includes(`MOBILE NO : ${PK.phone}`) && text(out.b6).includes(`CONTACT NO : ${PK.phone}`));
  const p1 = page1Everywhere(out.crs_page1);
  for (const [where, t] of Object.entries(p1)) {
    check(`Page 1 ${where}: NAME OF THE P.K.R / SIGNATURE OF P.K.R / the Packer's mobile, no B.C`,
      /NAME OF THE P\.K\.R:\s*Test Packerman/.test(t) && /SIGNATURE OF P\.K\.R :/.test(t) && t.includes(PK.phone) && !/\bB\.C\b/.test(t), t.match(/(NAME|SIGNATURE) OF THE?[^\n]{0,40}/g)?.join(' | '));
  }
}

console.log('\n3. Both a Bill Clerk and a Packer');
{
  const out = render([u(PK, 'Packer'), u(BC, 'BC')]);
  commonChecks('both', out);
  const p2 = text(out.crs_page2);
  check('Page 2: each name beside its own mobile, BC first',
    /NAME OF THE B\.C : Test Billclerk\s+CRS NO: 9\s+MOBILE NO : 9000000001\s+NAME OF THE P\.K\.R : Test Packerman\s+MOBILE NO : 9000000002/.test(p2), p2.slice(0, 260));
  check('signatures: BILL CLERK then PACKER', /BILL CLERK : Test Billclerk\s*\n\s*PACKER : Test Packerman/.test(p2));
  check('B6: both names, and each CONTACT NO says whose it is', /CONTACT NO \(B\.C\) : 9000000001/.test(text(out.b6)) && /CONTACT NO \(P\.K\.R\) : 9000000002/.test(text(out.b6)) && text(out.b6).includes('Test Packerman'));
  check('Remittance and Sale Tax: SIGNATURE OF BC and SIGNATURE OF PKR', /SIGNATURE OF BC\s*\n\s*SIGNATURE OF PKR/.test(text(out.remittance)) && /SIGNATURE OF BC\s*\n\s*SIGNATURE OF PKR/.test(text(out.sale_tax)));
  const p1 = page1Everywhere(out.crs_page1);
  for (const [where, t] of Object.entries(p1)) {
    const ok = /NAME OF THE B\.C:\s*Test Billclerk[\s\S]*NAME OF THE P\.K\.R:\s*Test Packerman[\s\S]*SIGNATURE OF B\.C :[\s\S]*MOBILE NO :\s*9000000001[\s\S]*SIGNATURE OF P\.K\.R :[\s\S]*MOBILE NO :\s*9000000002/.test(t);
    check(`Page 1 ${where}: both names, then each signature with its own mobile`, ok, t.match(/(NAME OF THE (B\.C|P\.K\.R)|SIGNATURE OF (B\.C|P\.K\.R)|MOBILE NO)[^\n]{0,30}/g)?.join(' | '));
  }
}

console.log('\n4. No staff assigned');
{
  const out = render([]);
  const all = commonChecks('none', out);
  check('no B.C / P.K.R / BILL CLERK / PACKER label at all', !BC_WORDS.test(all) && !PK_WORDS.test(all), (all.match(new RegExp(`.{0,30}(${BC_WORDS.source}|${PK_WORDS.source}).{0,30}`)) ?? [])[0]);
  check('and no empty "NAME OF THE …" line', !/NAME OF THE (?!CRS)/.test(all));
  const p1 = page1Everywhere(out.crs_page1);
  for (const [where, t] of Object.entries(p1)) check(`Page 1 ${where}: no staff caption`, !/NAME OF THE (B\.C|P\.K\.R)|SIGNATURE OF (B\.C|P\.K\.R)|MOBILE NO/.test(t));
}

console.log('\n5. Someone moved from Bill Clerk to Packer');
{
  const before = text(render([u(BC, 'BC')]).crs_page2);
  const after = text(render([{ ...u(BC, 'Packer') }]).crs_page2);
  check('before: NAME OF THE B.C : Test Billclerk', before.includes('NAME OF THE B.C : Test Billclerk'));
  check('after:  NAME OF THE P.K.R : Test Billclerk — the next render, no other change', after.includes('NAME OF THE P.K.R : Test Billclerk') && !BC_WORDS.test(after));
  const inactive = text(render([u(BC, 'BC', 9, false), u(PK, 'Packer')]).crs_page2);
  check('an INACTIVE Bill Clerk is not printed', !inactive.includes('Test Billclerk') && inactive.includes('NAME OF THE P.K.R : Test Packerman'));
  const other = text(render([u(BC, 'BC', 7), u(PK, 'Packer', 9)], 9).crs_page2);
  check('another shop\'s Bill Clerk is never borrowed', !other.includes('Test Billclerk') && other.includes('Test Packerman'));
}

console.log(failures ? `\n${failures} FAILED` : '\nSTAFF POSTS OK');
process.exit(failures ? 1 : 0);
