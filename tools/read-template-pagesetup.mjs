/**
 * What the office workbook says about printing each sheet.
 *
 *   node tools/read-template-pagesetup.mjs "CRS 19 AUG26.xlsx"
 *
 * Prints every sheet's paper, orientation, scale, fit-to-page, centring and
 * margins, straight from the sheet XML. src/lib/statements/pageSetup.ts holds
 * what this printed for the master template; run it again if the office sends
 * a new one, and update that file from the output.
 */
import { unzipSync, strFromU8 } from 'fflate';
import { readFileSync } from 'node:fs';
const zip = unzipSync(new Uint8Array(readFileSync(process.argv[2])));
const wb = strFromU8(zip['xl/workbook.xml']);
const rels = strFromU8(zip['xl/_rels/workbook.xml.rels']);
const target = {};
for (const m of rels.matchAll(/<Relationship[^>]*Id="([^"]+)"[^>]*Target="([^"]+)"/g)) target[m[1]] = m[2].replace(/^\/?xl\//, '');
const attr = (s, a) => (s.match(new RegExp(`${a}="([^"]*)"`)) || [,''])[1];
console.log('sheet                 paper  orient      scale  fitW/H  centred  margins L/R/T/B          cols  merges  maxRow');
for (const m of wb.matchAll(/<sheet[^>]*name="([^"]*)"[^>]*r:id="([^"]*)"[^>]*\/>/g)) {
  const [, name, rid] = m;
  const xml = strFromU8(zip['xl/' + target[rid]]);
  const ps = (xml.match(/<pageSetup\b[^>]*\/>/) || [''])[0];
  const pm = (xml.match(/<pageMargins\b[^>]*\/>/) || [''])[0];
  const po = (xml.match(/<printOptions\b[^>]*\/>/) || [''])[0];
  const fit = /fitToPage="1"/.test(xml) ? `${attr(ps,'fitToWidth')||1}/${attr(ps,'fitToHeight')||1}` : '—';
  const rows = [...xml.matchAll(/<row\b[^>]*r="(\d+)"/g)].map(x => +x[1]);
  const used = [...xml.matchAll(/<c r="[A-Z]+(\d+)"[^>]*>\s*<v>/g)].map(x => +x[1]);
  console.log(
    name.padEnd(21),
    (attr(ps,'paperSize')||'-').padEnd(6),
    (attr(ps,'orientation')||'default').padEnd(11),
    (attr(ps,'scale')||'100').padEnd(6),
    fit.padEnd(7),
    (/horizontalCentered="1"/.test(po) ? 'H' : '') + (/verticalCentered="1"/.test(po) ? 'V' : '') || '—',
    `  ${attr(pm,'left')}/${attr(pm,'right')}/${attr(pm,'top')}/${attr(pm,'bottom')}`.padEnd(24),
    String((xml.match(/<col\b/g)||[]).length).padEnd(5),
    String((xml.match(/<mergeCell\b/g)||[]).length).padEnd(7),
    String(used.length ? Math.max(...used) : 0),
  );
}
