/**
 * The PV download — a PDF file per shop, A4 or Legal (office, 2026-10-06).
 *
 *   node tools/verify-pv-pdf.mjs
 *
 * 1. What /api/pv/pdf accepts (lib/pvPdf.ts): the builder's own sheet for the
 *    shop and paper asked for; anything that could run or fetch is refused.
 * 2. File names.
 * 3. The server renderer (statements/pdfServer.ts pvSheetToPdf) with the
 *    screen's own fit (pvFit.ts): one page on A4 and on Legal, the right
 *    size, filled, nothing cut, Gunny, NOTE and signatures on it — and the
 *    page it draws in reaches no network.
 * 4. The route and the screen: session, a shop user's own shop only, the
 *    check before drawing, Chrome shipped with the function, the buttons.
 */
import { existsSync, readFileSync } from 'node:fs';
import http from 'node:http';
import { register } from 'node:module';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const srcUrl = pathToFileURL(join(root, 'src') + '/').href;
register(
  `data:text/javascript,${encodeURIComponent(
    `export async function resolve(s,c,n){` +
      `if(s.startsWith('@/'))return n(${JSON.stringify(srcUrl)}+s.slice(2)+(/\\.[a-z]+$/.test(s)?'':'.ts'),c);` +
      `if(s.startsWith('.')&&!/\\.[a-z]+$/.test(s)&&c.parentURL&&c.parentURL.endsWith('.ts'))return n(s+'.ts',c);` +
      `return n(s,c);}`,
  )}`,
  import.meta.url,
);
const imp = (p) => import(pathToFileURL(join(root, p)).href);
const S = await imp('src/lib/engine/pvStatement.ts');
const A = await imp('src/lib/engine/commodities.ts');
const F = await imp('src/lib/engine/pvFit.ts');
const D = await imp('src/lib/pvPdf.ts');

let failures = 0;
const check = (label, ok, detail = '') => {
  if (ok) console.log(`  ok    ${label}`);
  else {
    failures++;
    console.log(`  FAIL  ${label}${detail ? `\n        ${detail}` : ''}`);
  }
};

const commMap = {};
for (const c of [...A.DSS_A, ...A.DSS_B]) commMap[c.id] = { name: c.en, unit: c.unit, open: 13312, receipt: 11376.5, total: 24688.5, issues: 10927.22, closing: 13761.28, amount: 0, free: !!c.free };
const gunny = { ss50: { opening: 665, receipt: 1260, total: 1925, issues: 1625, closing: 300 }, poly: { opening: 33, receipt: 95, total: 128, issues: 128, closing: 0 }, cbox: { opening: 86, receipt: 324, total: 390, issues: 390, closing: 0 } };
const sheet = (paper, crsId = 20, extra = {}) =>
  S.buildPVTable({ commMap, periodLabel: '1.07.2026 TO 30.09.2026', crsId, crsName: 'சுப்பிரமணியபுரம்', gunny, gunnyNotes: ['WHEAT CONSIDER AS GUNNY'], staff: { bc: 'Alagarsamy', packer: 'Prakash' }, pvOfficer: 'K. Sivakumar, Assistant', pvDate: '01-10-2026', paper, ...extra });

// ─── 1. What the route accepts ───────────────────────────────────────────────
console.log('\n1. What /api/pv/pdf draws');
{
  const a4 = sheet('A4');
  check('the builder\'s A4 sheet for CRS 20, asked as A4 / CRS 20: accepted', D.pvSheetProblem(a4, { crsId: 20, paper: 'A4' }) === null);
  check('the builder\'s Legal sheet, asked as Legal: accepted', D.pvSheetProblem(sheet('Legal'), { crsId: 20, paper: 'Legal' }) === null);
  check('a typed NOTE with <, > and & (escaped by the builder): accepted', D.pvSheetProblem(sheet('A4', 20, { note: 'a <b> & "c" onerror=x' }), { crsId: 20, paper: 'A4' }) === null);
  const refused = [
    ['an A4 sheet asked as Legal', a4, { crsId: 20, paper: 'Legal' }],
    ['CRS 20\'s sheet asked as CRS 23', a4, { crsId: 23, paper: 'A4' }],
    ['CRS 20\'s sheet asked as CRS 2', a4, { crsId: 2, paper: 'A4' }],
    ['not a PV sheet', '<div>hello</div>', { crsId: 20, paper: 'A4' }],
    ['nothing', '', { crsId: 20, paper: 'A4' }],
    ['a <script>', a4.replace('</table>', '</table><script>fetch("x")</script>'), { crsId: 20, paper: 'A4' }],
    ['an <img src>', a4.replace('</table>', '</table><img src="http://169.254.169.254/">'), { crsId: 20, paper: 'A4' }],
    ['an onerror= handler', a4.replace('<table id="pv-tbl">', '<table id="pv-tbl" onerror=alert(1)>'), { crsId: 20, paper: 'A4' }],
    ['a CSS url(…)', a4.replace('<style>', '<style>body{background:url(http://x/y)}'), { crsId: 20, paper: 'A4' }],
    ['an @import', a4.replace('<style>', '<style>@import "http://x/y.css";'), { crsId: 20, paper: 'A4' }],
    ['an <iframe>', a4.replace('</table>', '</table><iframe></iframe>'), { crsId: 20, paper: 'A4' }],
    ['a <link href>', a4.replace('</table>', '</table><link rel=stylesheet href=//x>'), { crsId: 20, paper: 'A4' }],
    ['too large', a4 + ' '.repeat(D.MAX_PV_SHEET_CHARS), { crsId: 20, paper: 'A4' }],
  ];
  for (const [label, html, want] of refused) {
    const p = D.pvSheetProblem(html, want);
    check(`refused — ${label}: "${p}"`, !!p);
  }
}

// ─── 2. File names ───────────────────────────────────────────────────────────
console.log('\n2. File names');
check(`one shop: ${D.pvFileName(7, 'July 2026 to September 2026', 'A4')}`, D.pvFileName(7, 'July 2026 to September 2026', 'A4') === 'PV_CRS-07_July-2026-to-September-2026_A4.pdf');
check(`Legal: ${D.pvFileName(20, 'April 2026 to March 2027', 'Legal')}`, D.pvFileName(20, 'April 2026 to March 2027', 'Legal') === 'PV_CRS-20_April-2026-to-March-2027_Legal.pdf');
check(`all shops: ${D.pvZipName('July 2026 to September 2026', 'Legal')}`, D.pvZipName('July 2026 to September 2026', 'Legal') === 'PV_All-Shops_July-2026-to-September-2026_Legal.zip');

// ─── 3. The server renderer ──────────────────────────────────────────────────
console.log('\n3. The PDF the server makes');
{
  const chrome = [process.env.CHROME_PATH, 'C:/Program Files/Google/Chrome/Application/chrome.exe', '/usr/bin/google-chrome', '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'].find((p) => p && existsSync(p));
  if (!chrome) console.log('  skip  no Chrome on this machine');
  else {
    const R = await imp('src/lib/statements/pdfServer.ts');
    const pdfjs = await imp('node_modules/pdfjs-dist/legacy/build/pdf.mjs');
    const PT = 25.4 / 72;
    for (const [paper, W, H] of [['A4', 297, 210], ['Legal', 355.6, 215.9]]) {
      const t0 = Date.now();
      const pdf = await R.pvSheetToPdf(sheet(paper, 20, { note: 'Stack 4 re-counted.' }), F.fitPvSheet.toString());
      const ms = Date.now() - t0;
      const d = await pdfjs.getDocument({ data: new Uint8Array(pdf), verbosity: 0 }).promise;
      const pg = await d.getPage(1);
      const vp = pg.getViewport({ scale: 1 });
      const it = (await pg.getTextContent()).items.filter((i) => i.str?.trim());
      const text = it.map((i) => i.str).join(' ');
      const x0 = Math.min(...it.map((i) => i.transform[4])) * PT, x1 = Math.max(...it.map((i) => i.transform[4] + i.width)) * PT;
      const y = (re) => { const i = it.find((x) => re.test(x.str)); return i ? (vp.height - i.transform[5]) * PT : null; };
      const size = (re) => { const i = it.find((x) => re.test(x.str)); return i ? Math.abs(i.transform[3]) : 0; };
      check(`${paper}: ${d.numPages} page, ${(vp.width * PT).toFixed(1)} × ${(vp.height * PT).toFixed(1)} mm, ${(pdf.length / 1024).toFixed(0)} KB in ${ms} ms`, d.numPages === 1 && Math.abs(vp.width * PT - W) < 0.6 && Math.abs(vp.height * PT - H) < 0.6);
      check(`${paper}: filled — text ${x0.toFixed(1)} → ${x1.toFixed(1)} mm across, signatures at ${y(/SIGNATURE OF BILL CLERK/)?.toFixed(1)} of ${H} mm`, x0 < 10 && W - x1 < 10 && y(/SIGNATURE OF BILL CLERK/) > H - 32);
      check(`${paper}: type — title ${size(/^TAMIL NADU/).toFixed(1)} pt, BRA Rice ${size(/^BRA Rice$/).toFixed(1)} pt (fitted like the screen)`, size(/^TAMIL NADU/) >= 10 && size(/^BRA Rice$/) >= (paper === 'A4' ? 6.2 : 7));
      check(`${paper}: Gunny, the notes (numbered), staff, officer and both signatures on it`,
        /50 kg SS GUNNY/.test(text) && /POLYTHENE/.test(text) && /C\.BOX/.test(text) && /1\. WHEAT CONSIDER AS GUNNY/.test(text) && /2\. Stack 4 re-counted\./.test(text) &&
        /Alagarsamy/.test(text) && /Prakash/.test(text) && /K\. Sivakumar/.test(text) && /SIGNATURE OF THE PHYSICAL VERIFICATION OFFICER/.test(text));
      await d.destroy();
    }
    // The drawing page reaches no network, even for markup the route would have refused.
    let hits = 0;
    const srv = http.createServer((q, r) => { hits++; r.end('x'); });
    await new Promise((r) => srv.listen(4797, r));
    const bad = sheet('A4').replace('<style>', '<style>body{background:url(http://127.0.0.1:4797/bg.png)}').replace('</table>', '</table><img src="http://127.0.0.1:4797/i.png"><link rel="stylesheet" href="http://127.0.0.1:4797/s.css">');
    await R.pvSheetToPdf(bad, F.fitPvSheet.toString());
    srv.close();
    check(`the drawing page made ${hits} network request${hits === 1 ? '' : 's'} (all blocked)`, hits === 0);
  }
}

// ─── 4. Route and screen ─────────────────────────────────────────────────────
console.log('\n4. Route and screen');
{
  const route = readFileSync(join(root, 'src/app/api/pv/pdf/route.ts'), 'utf8');
  const page = readFileSync(join(root, 'src/app/(app)/reports/page.tsx'), 'utf8');
  const cfg = readFileSync(join(root, 'next.config.mjs'), 'utf8');
  check('signed in only (401), a shop user their own shop only (403)', /Not signed in\.' \}, \{ status: 401/.test(route) && /session\.role !== 'ADMIN' && Number\(session\.crsId\) !== crsId[\s\S]{0,160}status: 403/.test(route));
  check('the sheet is checked before it is drawn, and drawn with the screen\'s fit', route.indexOf('pvSheetProblem(') < route.indexOf('pvSheetToPdf(') && /fitPvSheet\.toString\(\)/.test(route));
  check('each download is an activity-log row (Reports · exported)', /module: 'Reports',\s*action: 'exported'/.test(route));
  check('Chrome is shipped with /api/pv/pdf on Vercel; 60 s allowed', /'\/api\/pv\/pdf': \['\.\/node_modules\/@sparticuz\/chromium\/bin\/\*\*'\]/.test(cfg) && /maxDuration = 60/.test(route));
  check('Reports: 📥 Download PDF for the PV on screen; 📥 Download All Shops for an administrator (Automatic)',
    /data-pv-download="one"/.test(page) && /isAdmin && pvSource === 'auto' \? \([\s\S]{0,80}data-pv-download="all"/.test(page));
  check('All Shops: one request per shop, the same sheet builder as the screen, zipped in the browser', /autoPvHtml\(id, '', pvPaper\)/.test(page) && /return autoPvHtml\(crsId, pvNote, pvPaper\)/.test(page) && /zipSync\(files\)/.test(page));
}

console.log(failures ? `\n${failures} FAILED\n` : '\nall passed\n');
process.exit(failures ? 1 : 0);
