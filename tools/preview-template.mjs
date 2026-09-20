/**
 * Draw the office's own sheets as the pages they print on.
 *
 *   node tools/preview-template.mjs <outFile.html> [sheet names…]
 *
 * Renders src/generated/statement-template.json through the same renderer the
 * app uses, with no figures in it — the blank form. Open it and press Ctrl+P
 * to compare against the master workbook's own print preview.
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { register } from 'node:module';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
register(`data:text/javascript,${encodeURIComponent(`
export async function resolve(spec, ctx, next) {
  if (spec.startsWith('@/')) return next(${JSON.stringify(pathToFileURL(join(root,'src')+'/').href)} + spec.slice(2) + '.ts', ctx);
  return next(spec, ctx);
}`)}`, import.meta.url);
const R = await import(pathToFileURL(join(root, 'src/lib/statements/templateRender.ts')).href);
const model = JSON.parse(readFileSync(join(root, 'src/generated/statement-template.json'), 'utf8'));
const out = process.argv[2] ?? join(root, 'tmp-template.html');
const want = process.argv.slice(3);
const sheets = want.length ? model.sheets.filter((s) => want.includes(s.name)) : model.sheets;
const pages = sheets.map((s, i) => R.renderSheet(model, s, {}, `p${i}`)).join('\n');
const css = sheets.map((s, i) => R.pageCssFor(s, `p${i}`)).join('\n');
writeFileSync(out, `<!DOCTYPE html><html><head><meta charset="utf-8"/><title>Template — blank form</title><style>${R.TEMPLATE_CSS}\n${css}</style></head><body>${pages}</body></html>`);
for (const s of sheets) console.log(`${s.name.padEnd(18)} ${s.print.orientation.padEnd(9)} scale ${(R.printScale(s) * 100).toFixed(0).padStart(3)}%  ${s.maxCol} cols × ${s.maxRow} rows`);
console.log(`→ ${out}`);
