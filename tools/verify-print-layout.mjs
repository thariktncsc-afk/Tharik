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

console.log(failures ? `\n${failures} FAILED\n` : '\nall passed\n');
process.exit(failures ? 1 : 0);
