/**
 * One-shot porting tool.
 *
 * Slices the original single-file build (TNCSC_CRS_Demo_19 (1).html) into the
 * pieces this Next.js project consumes:
 *
 *   <style> block      -> src/app/globals.css
 *   <body> markup      -> src/markup/*.ts   (verbatim HTML, one file per screen)
 *   <script> block     -> src/legacy/*.js   (verbatim JS, bundled back into one
 *                                            classic script at build time)
 *
 * Every byte of the original is carried across unchanged - the split points are
 * chosen on blank/comment lines only, so concatenating the pieces back together
 * reproduces the source exactly. Run with:
 *
 *   node tools/extract-from-legacy.mjs
 */
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const root = resolve(here, '..');
const SOURCE = resolve(root, '..', 'TNCSC_CRS_Demo_19 (1).html');

const lines = readFileSync(SOURCE, 'utf8').split(/\r?\n/);

/** 1-indexed inclusive slice. */
const slice = (from, to) => lines.slice(from - 1, to).join('\n');

const write = (relPath, content) => {
  const abs = join(root, relPath);
  mkdirSync(dirname(abs), { recursive: true });
  writeFileSync(abs, content, 'utf8');
  console.log('  wrote', relPath);
};

/* ── 1. CSS ────────────────────────────────────────────────────────────── */
console.log('CSS');
write(
  'src/app/globals.css',
  '/* Ported verbatim from the original TNCSC_CRS_Demo_19 <style> block. */\n' +
    slice(11, 178) +
    '\n\n/* The markup is injected into a single wrapper element; display:contents\n' +
    '   keeps #login-screen / #sidebar / #main as direct flex children of body,\n' +
    '   exactly as they were in the standalone HTML file. */\n' +
    '#app-root{display:contents}\n'
);

/* ── 2. Markup ─────────────────────────────────────────────────────────── */
console.log('markup');
const MARKUP = [
  ['login', 182, 233, 'Login screen + role picker'],
  ['sidebar', 234, 266, 'Left navigation rail'],
  ['shellOpen', 267, 280, 'Main column: topbar + #content opening tag'],
  ['pageDashboard', 281, 514, 'Dashboard'],
  ['pageReceipt', 515, 570, 'Receipt Register'],
  ['pageCrs', 571, 591, 'CRS Shops'],
  ['pageCommodity', 592, 615, 'Commodity Master'],
  ['pageEntry', 616, 861, 'Daily Sales Entry'],
  ['pageMonthly', 862, 1219, 'Monthly Sales Entry'],
  ['pageStatement', 1220, 1348, 'Statement Generation'],
  ['pageReports', 1349, 1407, 'Reports'],
  ['pageUsers', 1408, 1446, 'User Management'],
  ['pageSettings', 1447, 1504, 'Application Settings'],
  ['pageAudit', 1505, 1531, 'Audit Logs'],
  ['shellClose', 1532, 1535, '#content / #main closing tags'],
  ['modals', 1536, 1698, 'CRS / Commodity / User modals, role + holiday overlays'],
  ['viewers', 10075, 10122, 'Inspection & DSS full-screen viewers'],
];

for (const [name, from, to, label] of MARKUP) {
  const html = slice(from, to);
  if (html.includes('`') || html.includes('${')) {
    throw new Error(`chunk ${name} contains template-literal syntax`);
  }
  write(
    `src/markup/${name}.ts`,
    `// ${label}\n` +
      `// Verbatim from TNCSC_CRS_Demo_19 (1).html lines ${from}-${to}.\n` +
      `const html = \`\n${html}\n\`;\n\nexport default html;\n`
  );
}

write(
  'src/markup/index.ts',
  '// Assembles the full application markup.\n' +
    '//\n' +
    '// The chunks are concatenated back into ONE string before being injected, so\n' +
    '// the browser parses byte-for-byte the same document the original single-file\n' +
    '// build produced (including its few unbalanced tags).\n' +
    MARKUP.map(([n]) => `import ${n} from './${n}';`).join('\n') +
    '\n\nconst APP_MARKUP = [\n' +
    MARKUP.map(([n]) => `  ${n},`).join('\n') +
    '\n].join(\'\\n\');\n\nexport default APP_MARKUP;\n'
);

/* ── 3. Engine ─────────────────────────────────────────────────────────── */
console.log('engine');
const JS = [
  ['01-core', 1700, 1842, 'Config, roles, page routing, modal helpers'],
  ['02-masters', 1843, 1887, 'CRS shop + commodity master tables'],
  ['03-daily-entry', 1888, 2746, 'Daily Sales Entry grid, auto-opening, sales close'],
  ['04-reports', 2747, 3114, 'Reports page + PV statement builder'],
  ['05-monthly-entry', 3115, 3692, 'Monthly Sales Entry grid and roll-up from daily'],
  ['06-users', 3693, 4037, 'User Management CRUD'],
  ['07-auth', 4038, 4388, 'Login, role selection, per-role navigation'],
  ['08-dashboard', 4389, 4746, 'Dashboard KPIs, day bars, closing list'],
  ['09-receipt', 4747, 5199, 'Receipt Register + packing calculator'],
  ['10-holidays', 5200, 5370, 'TN government holiday calendar'],
  ['11-statement-core', 5371, 5921, 'Statement section registry, data aggregation, print CSS'],
  ['12-statement-builders', 5922, 7743, 'The 15 official statement layouts + print/Excel export'],
  ['13-sample-data', 7744, 8227, 'Sample-data seeding engine'],
  ['14-inspection', 8228, 8318, 'Inspection adjustments + remittance notes'],
  ['15-monthly-extras', 8319, 9246, 'Monthly remittance, gunny and card tables'],
  ['16-inspection-actions', 9247, 9436, 'Inspection entry overlay and actions'],
  ['17-dss-export', 9437, 9828, 'Sample data loader, DSS preview and Excel export'],
  ['18-backup-init', 9829, 10073, 'Backup export/import + application bootstrap'],
];

for (const [name, from, to, label] of JS) {
  write(
    `src/legacy/${name}.js`,
    `/* ${label}\n` +
      `   Verbatim from TNCSC_CRS_Demo_19 (1).html lines ${from}-${to}.\n` +
      `   These parts are concatenated back into one classic script by\n` +
      `   tools/bundle-engine.mjs - the code hoists across the whole block and\n` +
      `   its declarations must stay global for the markup's inline handlers. */\n` +
      slice(from, to) +
      '\n'
  );
}

/* ── 4. Round-trip check ───────────────────────────────────────────────── */
const rebuiltJs = JS.map(([, f, t]) => slice(f, t)).join('\n');
if (rebuiltJs !== slice(1700, 10073)) throw new Error('JS round-trip mismatch');
const rebuiltHtml = MARKUP.slice(0, 16).map(([, f, t]) => slice(f, t)).join('\n');
if (rebuiltHtml !== slice(182, 1698)) throw new Error('markup round-trip mismatch');
console.log('\nround-trip verified: markup and engine are byte-identical to source');
