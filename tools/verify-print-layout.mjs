/**
 * What the app prints (office, 2026-09-27).
 *
 *   node tools/verify-print-layout.mjs
 *
 * A screen that calls `window.print()` prints the whole application unless
 * something stops it: `#sidebar` is `height:100vh` and would stand down the
 * left of every sheet, `#main` hides its overflow and `#content` scrolls, so
 * the paper got a squeezed column of statement cut off at whatever was on
 * screen. There was no `@media print` rule in the app at all.
 *
 * This reads the rules rather than a screenshot — and, more usefully, it
 * refuses a NEW screen that prints itself without the print-area mechanism,
 * which is how the fault would come back.
 */
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
let failures = 0;
const check = (label, ok, detail = '') => {
  if (ok) console.log(`  ok    ${label}`);
  else {
    failures++;
    console.log(`  FAIL  ${label}${detail ? `\n        ${detail}` : ''}`);
  }
};

// Comments name the very selectors the rules use, so they are read without them.
const css = readFileSync(join(root, 'src/app/print.css'), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '').replace(/\s+/g, ' ').trim();
const layout = readFileSync(join(root, 'src/app/layout.tsx'), 'utf8');

console.log('\n1. The rules exist, and reach the app');
{
  check('src/app/print.css is loaded by the root layout', /import '\.\/print\.css'/.test(layout));
  check('everything in it is inside @media print — the screen is untouched',
    css.startsWith('@media print {') && css.endsWith('}') && css.indexOf('@media') === css.lastIndexOf('@media'));
}

console.log('\n2. The application\'s furniture stays off the paper');
{
  for (const sel of ['#sidebar', '#topbar', '.no-print']) {
    check(`${sel} is not printed`, new RegExp(`${sel.replace('.', '\\.')}[^{]*\\{[^}]*display: none`).test(css), '');
  }
}

console.log('\n3. Nothing clips the sheet');
{
  check('html, body, #main and #content all print with their overflow visible',
    /html, body, #main, #content \{[^}]*overflow: visible/.test(css), '');
  check('…and with no height holding them to one screen', /html, body, #main, #content \{[^}]*height: auto/.test(css));
  check('an inner scroller shows its whole width', /\[style\*='overflow'\][^{]*\{[^}]*overflow: visible/.test(css));
  check('a fixed or sticky element is made static — a fixed one prints page 1 and no more',
    /position:fixed'\]/.test(css) && /position:sticky'\]/.test(css) && /position: static/.test(css));
}

console.log('\n4. One area, the whole paper');
{
  check('everything but the print area is hidden while it prints', /body\.printing-area \* \{ visibility: hidden/.test(css));
  check('the area itself is visible', /body\.printing-area \.print-area, body\.printing-area \.print-area \* \{ visibility: visible/.test(css));
  check('the area is ABSOLUTE, not fixed', /body\.printing-area \.print-area \{[^}]*position: absolute/.test(css) && !/\.print-area \{[^}]*position: fixed/.test(css));
  check('…at the top-left, the width of the page', /body\.printing-area \.print-area \{[^}]*left: 0[^}]*top: 0[^}]*width: 100%/.test(css));
  check('its ancestors hold no position or overflow that would clip it',
    /body\.printing-area #main, body\.printing-area #content, body\.printing-area \.card \{[^}]*position: static[^}]*overflow: visible/.test(css));
  check('a wide-screen table is brought back to the width of the paper',
    /body\.printing-area \.print-area table[^{]*\{[^}]*min-width: 0[^}]*max-width: 100%/.test(css));
}

console.log('\n5. No screen prints the whole application');
{
  // Every `window.print()` in the app must either print an area (printArea)
  // or print a document of its own (the statements' print window).
  const files = [];
  const walk = (dir) => {
    for (const name of readdirSync(dir)) {
      const p = join(dir, name);
      if (statSync(p).isDirectory()) walk(p);
      else if (/\.tsx?$/.test(p)) files.push(p);
    }
  };
  walk(join(root, 'src/app'));
  walk(join(root, 'src/components'));
  const offenders = [];
  for (const f of files) {
    const src = readFileSync(f, 'utf8');
    if (!/window\.print\(\)/.test(src)) continue;
    const viaArea = /printArea|PRINT_AREA_CLASS/.test(src);
    const ownWindow = /window\.open\(/.test(src);
    if (!viaArea && !ownWindow) offenders.push(relative(root, f).replace(/\\/g, '/'));
  }
  check('every screen that prints, prints one area or a document of its own', offenders.length === 0, offenders.join(', '));

  const monthly = readFileSync(join(root, 'src/app/(app)/monthly-entry/page.tsx'), 'utf8');
  check('Monthly Entry\'s statement preview prints through the area', /onClick=\{printArea\}/.test(monthly));
  check('…and the statement itself is the area', /card-body \$\{PRINT_AREA_CLASS\}/.test(monthly));

  const helper = readFileSync(join(root, 'src/lib/printArea.ts'), 'utf8');
  check('the body class is taken off again after printing, and after cancelling',
    /afterprint/.test(helper) && /classList\.remove/.test(helper));
}

console.log('\n6. One print session, no pop-up window');
{
  // window.open is allowed only while the page is answering a click, and the
  // statements are built on the server first — so a window opened after that
  // await was blocked. And an HTML print reaches a physical printer with ONE
  // layout, so mixed portrait/landscape selections were shrunk or split into
  // two sessions. Now: ONE PDF from the server (every sheet on its own paper),
  // printed from a hidden frame on the page (lib/statements/printFrame.ts).
  const page = readFileSync(join(root, 'src/app/(app)/statements/page.tsx'), 'utf8');
  check('Print asks the server for ONE PDF of the whole selection', /statementsPdf\(\{[^}]*sectionIds: ids/.test(page));
  check('…and prints it through the frame', /printPdfBlob\(blob\)/.test(page));
  check('…after clearing any frame an earlier print left', /clearPrintFrame\(\)/.test(page));
  check('no second print job: nothing splits the selection by orientation',
    !/printJobs|landscapeDoc|portraitDoc|Print portrait statements/.test(page));
  // The one window.open left is the fallback for a browser that will not
  // print a PDF from a frame — and it runs only after the office clicks
  // "Open PDF", so it is always answering a click.
  const opens = page.match(/window\.open\(/g) ?? [];
  check('the only window it opens is the fallback, behind the office\'s click on "Open PDF"',
    opens.length === 1 && /if \(open\) window\.open\(URL\.createObjectURL\(blob\)/.test(page), String(opens.length));
  const frame = readFileSync(join(root, 'src/lib/statements/printFrame.ts'), 'utf8');
  check('the frame loads the PDF from a blob: URL and prints ITS window', /URL\.createObjectURL/.test(frame) && /win\.print\(\)/.test(frame));
  check('only one frame can exist: each print removes the last, and frees its file',
    /clearPrintFrame\(\);\s*return new Promise/.test(frame) && /URL\.revokeObjectURL\(url\)/.test(frame));
  check('a viewer that never loads cannot leave the office waiting', /setTimeout\(\(\) => finish\(new Error/.test(frame));

  const route = readFileSync(join(root, 'src/app/api/statements/pdf/route.ts'), 'utf8');
  check('the PDF route runs the same gate as the preview (buildStatements)', /buildStatements\(session, body\)/.test(route));
  // Comments mention authorise() by name; the code must not call it any more.
  const render = readFileSync(join(root, 'src/app/api/statements/render/route.ts'), 'utf8')
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/\/\/.*$/gm, '');
  check('…and so does the preview route — one gate, not two copies', /buildStatements\(session, body\)/.test(render) && !/authorise\(/.test(render));
  const engineSrc = readFileSync(join(root, 'src/lib/statements/pdfServer.ts'), 'utf8');
  check('each page keeps its own paper: the size comes from the document, not one format',
    /preferCSSPageSize: true/.test(engineSrc) && !/format:/.test(engineSrc));
}

console.log('\n7. Exactly the statements ticked now');
{
  const src = readFileSync(join(root, 'src/lib/statements/selection.ts'), 'utf8');
  // Evaluate the helper itself rather than a copy of its logic.
  const fn = new Function(`${src.replace(/export /g, '').replace(/: readonly string\[\]|: Readonly<Record<string, boolean>>|: string\[\]/g, '')}; return selectedInOrder;`)();
  const offered = ['crs_page1', 'receipt', 'crs_page2', 'gunny', 'remittance', 'card_details', 'rbi'];
  const J = (v) => JSON.stringify(v);
  check('one ticked → that one', J(fn(offered, { rbi: true })) === J(['rbi']));
  check('three ticked → those three, in the listed order, not click order',
    J(fn(offered, { rbi: true, card_details: true, gunny: true })) === J(['gunny', 'card_details', 'rbi']));
  check('select all → every offered statement, once', J(fn(offered, Object.fromEntries(offered.map((id) => [id, true])))) === J(offered));
  check('five ticked, two unticked → the remaining three',
    J(fn(offered, { crs_page2: true, gunny: false, remittance: true, rbi: true, card_details: false })) === J(['crs_page2', 'remittance', 'rbi']));
  check('a tick for a statement no longer offered is not sent', J(fn(offered, { rbi: true, gone_section: true })) === J(['rbi']));
  check('nothing ticked → nothing', J(fn(offered, {})) === '[]');
  const page = readFileSync(join(root, 'src/app/(app)/statements/page.tsx'), 'utf8');
  check('the Statements page builds its selection with it', /selectedInOrder\(sections\.map\(\(s\) => s\.id\), selected\)/.test(page));
}

console.log(failures ? `\n${failures} FAILED\n` : '\nall passed\n');
process.exit(failures ? 1 : 0);
