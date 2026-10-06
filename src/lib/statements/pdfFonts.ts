/**
 * The fonts the server's PDFs are drawn with (office, 2026-10-06).
 *
 * The PDFs are drawn by Chrome on the SERVER — on Vercel a Linux Chrome with
 * almost no fonts: no Arial, no Calibri, and NO TAMIL font at all. So the
 * downloaded PV read "NAME OF THE CRS : 20 —" with the shop's Tamil name
 * simply missing, and CRS 29's Tamil commodity names were gone from its
 * statements. On an office PC (Latha / Nirmala UI) the same page was fine.
 *
 * Two fonts travel with the page instead, as data (nothing is fetched):
 *
 *   - NOTO SANS TAMIL (Google, SIL OFL, @fontsource/noto-sans-tamil) for
 *     Tamil characters ONLY (`unicode-range`), registered under every family
 *     the statements and the PV ask for — so whatever a sheet's CSS names,
 *     its Tamil text has glyphs. English letters are not touched: under the
 *     same family names they still come from the machine's own font
 *     (`local()`), exactly as before.
 *   - LIBERATION SANS (pdf.js's standard font, SIL OFL) as Arial on the PV —
 *     Arial's character widths, so the PV is measured on Vercel as on an
 *     office PC (`pvSheetToPdf`).
 *
 * Both are shipped with the PDF routes (next.config.mjs
 * outputFileTracingIncludes). A font that cannot be read is left out — the
 * PDF is still made, with the machine's own fonts.
 */
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';

/**
 * Every family a statement or the PV names (the builders, templateRender's
 * office workbook font, the PV), with the machine's own faces under them:
 * full name and PostScript name, regular and bold — so English text is drawn
 * exactly as it was.
 */
const FAMILIES: { name: string; regular: string[]; bold: string[] }[] = [
  { name: 'Arial', regular: ['Arial', 'ArialMT'], bold: ['Arial Bold', 'Arial-BoldMT'] },
  { name: 'Calibri', regular: ['Calibri'], bold: ['Calibri Bold', 'Calibri-Bold'] },
  { name: 'Carlito', regular: ['Carlito', 'Carlito-Regular'], bold: ['Carlito Bold', 'Carlito-Bold'] },
  { name: 'Latha', regular: ['Latha'], bold: ['Latha Bold', 'Latha-Bold'] },
  { name: 'Nirmala UI', regular: ['Nirmala UI', 'NirmalaUI'], bold: ['Nirmala UI Bold', 'NirmalaUI-Bold'] },
  { name: 'Arial Unicode MS', regular: ['Arial Unicode MS', 'ArialUnicodeMS'], bold: ['Arial Unicode MS', 'ArialUnicodeMS'] },
];
/** A family's italic faces, by full name and PostScript name (Arial's carry "MT"). */
function italicNames(name: string, bold: boolean): string[] {
  const ps = name.replace(/\s+/g, '');
  return bold
    ? [`${name} Bold Italic`, `${ps}-BoldItalic`, `${ps}-BoldItalicMT`]
    : [`${name} Italic`, `${ps}-Italic`, `${ps}-ItalicMT`];
}
/** Noto Sans Tamil's own subset (its @fontsource 400.css). */
const TAMIL_RANGE = 'U+0964-0965,U+0B82-0BFA,U+200C-200D,U+20B9,U+25CC';

const nm = (...p: string[]) => join(process.cwd(), 'node_modules', ...p);

async function dataUrl(file: string, mime: string): Promise<string | null> {
  try {
    return `data:${mime};base64,${(await readFile(file)).toString('base64')}`;
  } catch {
    return null;
  }
}

const cache = new Map<string, Promise<string>>();

/**
 * `@font-face` rules for a PDF document. `pv`: Arial is Liberation Sans for
 * the Latin text too (the PV is fitted by measuring it). `statements`: Latin
 * text keeps the machine's own fonts.
 */
export function pdfFontCss(kind: 'pv' | 'statements'): Promise<string> {
  let p = cache.get(kind);
  if (!p) {
    p = (async () => {
      const [tamil400, tamil700, libReg, libBold] = await Promise.all([
        dataUrl(nm('@fontsource', 'noto-sans-tamil', 'files', 'noto-sans-tamil-tamil-400-normal.woff2'), 'font/woff2'),
        dataUrl(nm('@fontsource', 'noto-sans-tamil', 'files', 'noto-sans-tamil-tamil-700-normal.woff2'), 'font/woff2'),
        kind === 'pv' ? dataUrl(nm('pdfjs-dist', 'standard_fonts', 'LiberationSans-Regular.ttf'), 'font/ttf') : Promise.resolve(null),
        kind === 'pv' ? dataUrl(nm('pdfjs-dist', 'standard_fonts', 'LiberationSans-Bold.ttf'), 'font/ttf') : Promise.resolve(null),
      ]);
      let css = '';
      // Regular (400) and bold (700), upright and italic; Chrome takes the
      // nearest weight for 500–900.
      for (const fam of FAMILIES) {
        for (const w of [400, 700]) {
          for (const style of ['normal', 'italic'] as const) {
            const bold = w === 700;
            // The Latin text first: the PV's Arial is Liberation Sans; anything
            // else is the machine's own font under its own names, as before.
            const lib = bold ? libBold : libReg;
            const names = style === 'italic' ? italicNames(fam.name, bold) : bold ? fam.bold : fam.regular;
            const latin =
              kind === 'pv' && fam.name === 'Arial' && lib && style === 'normal'
                ? `url(${lib}) format('truetype')`
                : names.map((n) => `local('${n}')`).join(',');
            css += `@font-face{font-family:'${fam.name}';font-weight:${w};font-style:${style};src:${latin}}`;
            // Then the Tamil characters — declared LAST, so they win for their range.
            const t = bold ? tamil700 : tamil400;
            if (t) css += `@font-face{font-family:'${fam.name}';font-weight:${w};font-style:${style};src:url(${t}) format('woff2');unicode-range:${TAMIL_RANGE}}`;
          }
        }
      }
      return css;
    })();
    cache.set(kind, p);
  }
  return p;
}
