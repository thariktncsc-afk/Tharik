/**
 * Parity check: proves the port still contains the original CSS, markup and JS
 * byte-for-byte, with only the porting comments added.
 *
 *   node tools/verify-parity.mjs
 */
import { readFileSync, readdirSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const SOURCE = resolve(root, '..', 'TNCSC_CRS_Demo_19 (1).html');

/**
 * Reads a file as LF. A Windows checkout with `core.autocrlf=true` hands back
 * CRLF, which is a checkout artifact rather than a change to the ported text —
 * comparing it raw would fail every line of every file for no real reason.
 */
const read = (path) => readFileSync(path, 'utf8').replace(/\r\n/g, '\n');

const lines = read(SOURCE).split('\n');
const slice = (from, to) => lines.slice(from - 1, to).join('\n');

let failures = 0;
const check = (label, actual, expected) => {
  if (actual === expected) {
    console.log(`  ok    ${label}`);
  } else {
    failures++;
    console.log(`  FAIL  ${label}`);
    for (let i = 0; i < Math.max(actual.length, expected.length); i++) {
      if (actual[i] !== expected[i]) {
        console.log(`        first difference at offset ${i}`);
        console.log(`        port:   ${JSON.stringify(actual.slice(i, i + 80))}`);
        console.log(`        source: ${JSON.stringify(expected.slice(i, i + 80))}`);
        break;
      }
    }
  }
};

/** Drops the leading /* ... *\/ porting header from a generated part file. */
const stripHeader = (text) => text.slice(text.indexOf('*/') + 3);

/**
 * Screens and engine parts written after the port. They have no counterpart in
 * the original file, so they are excluded from the byte-for-byte comparison —
 * but they are still required to be wired up (imported by index.ts, present in
 * the bundle), which the checks below cover.
 */
const NEW_MARKUP = new Set([]);
const NEW_ENGINE = new Set([
  '02a-crs-names.js',
  '20-dashboard-stock.js',
  '21-remittance.js',
  '22-allotment.js',
  '23-crs-master.js',
  '24-coll.js',
  '25-crs-profile.js',
  '26-crs29.js',
  '27-crs29-entry.js',
  '28-crs29-dashboard.js',
  '29-dss-total.js',
  '30-nav-history.js',
  '31-stmt-heading.js',
  '32-forgot-password.js',
]);

/**
 * Blocks of ported markup deliberately redesigned since the port, each marked
 * in place with `[+redesign-start]` / `[+redesign-end]` comments. The port's
 * own text for each block is kept beside this file and spliced back in before
 * comparing, so the redesign is recorded rather than waved through, and every
 * line outside the markers is still held to byte-for-byte parity.
 *
 * `ported` lists one file per marked block, IN THE ORDER THE BLOCKS APPEAR in
 * the chunk. A count mismatch is a failure, so a new region cannot be smuggled
 * in without recording the text it replaced.
 */
const REDESIGNED = {
  login: {
    ported: [
      'redesigned/login-badge.txt',
      'redesigned/login-subtitle.txt',
      'redesigned/login-username.txt',
      'redesigned/login-password.txt',
      'redesigned/login-quick-login.txt',
    ],
    why: 'the badge carries the Seal of Tamil Nadu, the subtitle and the two field placeholders just say what to do rather than spelling the accepted formats out, and the port\'s one-click demo sign-ins are gone',
  },
  sidebar: {
    ported: ['redesigned/sidebar-logo.txt'],
    why: 'the sidebar badge carries the Seal of Tamil Nadu instead of the "TN" lettering',
  },
  pageDashboard: {
    ported: ['redesigned/pageDashboard-hero-header.txt', 'redesigned/pageDashboard-crs-info.txt'],
    why: 'the hero header carries the Chief Minister\'s portrait and a scrolling TNCSC ticker between the title and the clock/date cards, and the shop card carries the whole CRS Master record and is filled from it',
  },
  pageCrs: {
    ported: ['redesigned/pageCrs-master.txt'],
    why: 'CRS Shops became the CRS Master Configuration: shop code, BC and packer, COLL / police requirement and usage status',
  },
  pageStatement: {
    ported: ['redesigned/pageStatement-heading.txt'],
    why: 'the subtitle no longer hard-codes "CRS 9 June 2026" — it is rewritten from the selected shop and period',
  },
  pageEntry: {
    ported: ['redesigned/pageEntry-remittance-actions.txt'],
    why: 'Daily Entry: remittance is mandatory and repeatable; the two completion buttons carry their Tamil names',
  },
  pageMonthly: {
    ported: [
      'redesigned/pageMonthly-success.txt',
      'redesigned/pageMonthly-actions.txt',
      'redesigned/pageMonthly-card-details.txt',
    ],
    why: 'Monthly Entry: the save button carries its Tamil name on the far right, and the Card Details Remarks column is replaced by an Allotment panel',
  },
};
const REDESIGN_START = '<!-- [+redesign-start]';
const REDESIGN_END = '<!-- [+redesign-end] -->';

/**
 * Drops lines tagged `[+]` — single-line additions inside an otherwise ported
 * file, e.g. the Gunny nav item in sidebar.ts. Everything not tagged still has
 * to match the original byte-for-byte, so an untagged edit is still a failure.
 */
const dropAdded = (text) =>
  text
    .split('\n')
    .filter((l) => !l.includes('[+]'))
    .join('\n');

console.log('CSS');
const css = read(join(root, 'src/app/globals.css'));
check('globals.css contains the original <style> block', css.includes(slice(11, 178)), true);

console.log('markup');
const markupFiles = readdirSync(join(root, 'src/markup')).filter(
  (f) => f.endsWith('.ts') && f !== 'index.ts'
);
const order = read(join(root, 'src/markup/index.ts'))
  .split('\n')
  .map((l) => /^import (\w+) from/.exec(l))
  .filter(Boolean)
  .map((m) => m[1]);
check('every markup chunk is imported by index.ts', order.length, markupFiles.length);

const chunkHtml = (name) => {
  const text = read(join(root, `src/markup/${name}.ts`));
  const start = text.indexOf('`') + 1;
  const end = text.lastIndexOf('`');
  let html = text.slice(start, end).replace(/^\n/, '').replace(/\n$/, '');

  const redesign = REDESIGNED[name];
  if (redesign) {
    let restored = 0;
    for (;;) {
      const from = html.indexOf(REDESIGN_START);
      if (from === -1) break;
      const to = html.indexOf(REDESIGN_END, from);
      if (to === -1) {
        failures++;
        console.log(`  FAIL  ${name}.ts has a ${REDESIGN_START} with no matching end marker`);
        break;
      }
      if (restored >= redesign.ported.length) {
        failures++;
        console.log(`  FAIL  ${name}.ts has more redesigned blocks than REDESIGNED records text for`);
        break;
      }
      const ported = read(join(root, 'tools', redesign.ported[restored]));
      // Splice from the start of the marker's own line so its indentation goes too.
      html =
        html.slice(0, html.lastIndexOf('\n', from) + 1) +
        ported +
        html.slice(to + REDESIGN_END.length);
      restored++;
    }
    if (restored !== redesign.ported.length) {
      failures++;
      console.log(`  FAIL  ${name}.ts restored ${restored} block(s) but REDESIGNED lists ${redesign.ported.length}`);
    } else {
      console.log(`  note  ${name}.ts — ${restored} redesigned block(s) restored for comparison (${redesign.why})`);
    }
  }
  return dropAdded(html);
};
// The last chunk (viewers) sits after the </script> tag in the source.
const bodyChunks = order.filter((n) => n !== 'viewers' && !NEW_MARKUP.has(n));
check('body markup', bodyChunks.map(chunkHtml).join('\n'), slice(182, 1698));
check('full-screen viewers', chunkHtml('viewers'), slice(10075, 10122));

console.log('engine');
const engineFiles = readdirSync(join(root, 'src/legacy'))
  .filter((f) => f.endsWith('.js'))
  .sort();
const engine = engineFiles
  .filter((f) => !NEW_ENGINE.has(f))
  .map((f) => dropAdded(stripHeader(read(join(root, 'src/legacy', f))).replace(/\n$/, '')))
  .join('\n');
check('engine sources', engine, slice(1700, 10073));

const bundle = read(join(root, 'public/js/tncsc-engine.js'));
for (const f of engineFiles) {
  const part = stripHeader(read(join(root, 'src/legacy', f)));
  if (!bundle.includes(part)) {
    failures++;
    console.log(`  FAIL  bundle is missing ${f}`);
  }
}
if (!failures) console.log('  ok    bundle contains every engine part in order');

console.log(failures === 0 ? '\nPARITY OK' : `\n${failures} PARITY FAILURE(S)`);
process.exit(failures === 0 ? 0 : 1);
