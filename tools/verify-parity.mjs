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
const lines = readFileSync(SOURCE, 'utf8').split(/\r?\n/);
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

console.log('CSS');
const css = readFileSync(join(root, 'src/app/globals.css'), 'utf8');
check('globals.css contains the original <style> block', css.includes(slice(11, 178)), true);

console.log('markup');
const markupFiles = readdirSync(join(root, 'src/markup')).filter(
  (f) => f.endsWith('.ts') && f !== 'index.ts'
);
const order = readFileSync(join(root, 'src/markup/index.ts'), 'utf8')
  .split('\n')
  .map((l) => /^import (\w+) from/.exec(l))
  .filter(Boolean)
  .map((m) => m[1]);
check('every markup chunk is imported by index.ts', order.length, markupFiles.length);

const chunkHtml = (name) => {
  const text = readFileSync(join(root, `src/markup/${name}.ts`), 'utf8');
  const start = text.indexOf('`') + 1;
  const end = text.lastIndexOf('`');
  return text.slice(start, end).replace(/^\n/, '').replace(/\n$/, '');
};
// The last chunk (viewers) sits after the </script> tag in the source.
const bodyChunks = order.filter((n) => n !== 'viewers');
check('body markup', bodyChunks.map(chunkHtml).join('\n'), slice(182, 1698));
check('full-screen viewers', chunkHtml('viewers'), slice(10075, 10122));

console.log('engine');
const engineFiles = readdirSync(join(root, 'src/legacy'))
  .filter((f) => f.endsWith('.js'))
  .sort();
const engine = engineFiles
  .map((f) => stripHeader(readFileSync(join(root, 'src/legacy', f), 'utf8')).replace(/\n$/, ''))
  .join('\n');
check('engine sources', engine, slice(1700, 10073));

const bundle = readFileSync(join(root, 'public/js/tncsc-engine.js'), 'utf8');
for (const f of engineFiles) {
  const part = stripHeader(readFileSync(join(root, 'src/legacy', f), 'utf8'));
  if (!bundle.includes(part)) {
    failures++;
    console.log(`  FAIL  bundle is missing ${f}`);
  }
}
if (!failures) console.log('  ok    bundle contains every engine part in order');

console.log(failures === 0 ? '\nPARITY OK' : `\n${failures} PARITY FAILURE(S)`);
process.exit(failures === 0 ? 0 : 1);
