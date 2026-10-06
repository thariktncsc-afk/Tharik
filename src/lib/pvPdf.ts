/**
 * The PV download (office, 2026-10-06): what /api/pv/pdf will draw, and the
 * file names it is saved under. Pure — tools/verify-pv-pdf.mjs runs it.
 *
 * The browser builds the sheet (pvStatement.ts `buildPVTable`, the same
 * markup the screen shows) and the server draws it to PDF in headless Chrome.
 * Since that markup arrives from the browser, the server takes only what the
 * builder makes: the PV's own wrapper, for the shop asked for, on the paper
 * asked for, with nothing in it that could fetch or run anything.
 */
import type { PvPaperSize } from '@/lib/engine/pvStatement';

/** A PV sheet is ~60 KB; anything near this is not one. */
export const MAX_PV_SHEET_CHARS = 600_000;

/**
 * Markup that could run or fetch something — never in a PV the builder makes.
 * Checked in the TAGS and the style sheet only: the text between them is
 * what people typed (a NOTE, a name), escaped by the builder, and a note
 * that happens to say "onwards=" or "url(" is just words.
 */
const BAD_TAG = /^<\s*\/?\s*(script|iframe|frame|object|embed|img|image|svg|link|meta|base|form|input|video|audio|source|picture|style\s+[^>]*src)\b/i;
const BAD_ATTR = /\son[a-z]+\s*=|\s(src|href|srcset|action|formaction|xlink:href|background|poster)\s*=|javascript:|url\s*\(|expression\s*\(/i;
const BAD_CSS = /url\s*\(|@import|expression\s*\(|javascript:|behavior\s*:/i;

function markupProblem(html: string): boolean {
  for (const css of html.match(/<style[^>]*>[\s\S]*?<\/style>/gi) ?? []) if (BAD_CSS.test(css)) return true;
  const withoutCss = html.replace(/<style[^>]*>[\s\S]*?<\/style>/gi, '');
  for (const tag of withoutCss.match(/<[^>]*>/g) ?? []) if (BAD_TAG.test(tag) || BAD_ATTR.test(tag)) return true;
  return false;
}

export function pvSheetProblem(html: unknown, want: { crsId: number; paper: PvPaperSize }): string | null {
  if (typeof html !== 'string' || !html) return 'No PV sheet was sent.';
  if (html.length > MAX_PV_SHEET_CHARS) return 'That is not a PV sheet (too large).';
  if (!html.startsWith('<div id="pv-print-area">')) return 'That is not a PV sheet.';
  if (!html.includes(`data-paper="${want.paper}"`)) return `The sheet is not laid out for ${want.paper} paper.`;
  if (!new RegExp(`<b>NAME OF THE CRS :</b> ${Number(want.crsId)}(?!\\d)`).test(html)) return `The sheet is not CRS ${want.crsId}'s.`;
  if (markupProblem(html)) return 'The sheet holds content a PV never has — refused.';
  return null;
}

/** `Jul – Sep 2026` → `Jul-Sep-2026`: safe in a file name on every system. */
const slug = (s: string) => String(s ?? '').replace(/[^A-Za-z0-9]+/g, '-').replace(/^-+|-+$/g, '');

/** `PV_CRS-20_July-2026-to-September-2026_A4.pdf` */
export function pvFileName(crsId: number, periodLabel: string, paper: PvPaperSize): string {
  return `PV_CRS-${String(crsId).padStart(2, '0')}_${slug(periodLabel)}_${paper}.pdf`;
}

/** `PV_All-Shops_July-2026-to-September-2026_A4.zip` */
export function pvZipName(periodLabel: string, paper: PvPaperSize): string {
  return `PV_All-Shops_${slug(periodLabel)}_${paper}.zip`;
}
