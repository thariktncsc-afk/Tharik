/**
 * The Manual 3-Month PV's saved PDFs (office, 2026-10-06).
 *
 *   node tools/verify-pv-uploads.mjs
 *
 * The handlers behind /api/pv-uploads (src/lib/pvUploads/server.ts), run
 * against the in-memory store, plus the wiring of the route and the screen:
 *
 * 1. Save, list, read back: one row per file, the month's files, the bytes
 *    returned exactly; financial year, who and when recorded.
 * 2. Replace: the new file becomes the month's only one — no second active
 *    set; Add keeps the others; the same file twice is stored once.
 * 3. Refused, nothing stored: not a PDF, empty, too large, a month that has
 *    not happened, a bad mode or shop.
 * 4. Isolated by CRS: a shop user sees, saves, reads and removes only their
 *    own shop's; another shop's file answers 404; the administrator reaches all.
 * 5. Remove: the month's files go, other months and shops stay.
 * 6. The route and the screen: the route uses these handlers; the screen asks
 *    the server on opening, never keeps the pages in sessionStorage, saves
 *    before it ticks, and asks the server again before it generates.
 */
import { existsSync, readFileSync } from 'node:fs';
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
const C = await imp('src/lib/pvUploads/core.ts');
const V = await imp('src/lib/pvUploads/server.ts');

let failures = 0;
const check = (label, ok, detail = '') => {
  if (ok) console.log(`  ok    ${label}`);
  else {
    failures++;
    console.log(`  FAIL  ${label}${detail ? `\n        ${typeof detail === 'string' ? detail : JSON.stringify(detail)}` : ''}`);
  }
};

const TODAY = { year: 2026, month: 10 };
const admin = { userId: 1, role: 'ADMIN', crsId: null, name: 'Office Admin' };
const crs20 = { userId: 20, role: 'BC', crsId: 20, name: 'Alagarsamy' };
const crs23 = { userId: 23, role: 'BC', crsId: 23, name: 'Saravanan' };
const pdf = (text) => new Uint8Array(Buffer.from(`%PDF-1.4\n% ${text}\n%%EOF\n`));
const Q3 = [{ year: 2026, month: 7 }, { year: 2026, month: 8 }, { year: 2026, month: 9 }];
const save = (store, who, crsId, month, name, bytes, mode = 'replace') => V.saveUpload(store, who, { crsId, year: 2026, month, name, mode, bytes }, TODAY);

// ─── 1. Save, list, read back ────────────────────────────────────────────────
{
  console.log('\n§1  Save → list → read back');
  const st = V.memoryStore();
  const a = await save(st, crs20, 20, 9, 'statement_crs20_sep2026.pdf', pdf('sep v1'));
  check('saved: 200, the month as now saved, one file', a.status === 200 && a.body.month.files.length === 1 && a.body.month.files[0].name === 'statement_crs20_sep2026.pdf', a.body);
  const row = st.rows[0];
  check(`stored with CRS, month, FY ${row.fy}, size, sha256, who (${row.uploaded_by_name}) and when`, row.crs_id === 20 && row.year === 2026 && row.month === 9 && row.fy === '2026-27' && row.file_size === pdf('sep v1').length && /^[0-9a-f]{64}$/.test(row.sha256) && row.uploaded_by_id === 20 && row.uploaded_by_name === 'Alagarsamy' && !!row.uploaded_at);
  const l = await V.listUploads(st, crs20, 20, Q3);
  check('listed under 2026-9 only; July and August not there', Object.keys(l.body.months).join() === '2026-9' && !('data_b64' in l.body.months['2026-9'].files[0]));
  const f = await V.fileBytes(st, crs20, row.id);
  check('the saved bytes come back exactly', f.status === 200 && Buffer.from(f.bytes).equals(Buffer.from(pdf('sep v1'))) && f.name === 'statement_crs20_sep2026.pdf');
  check('FY: March 2027 → 2026-27, April 2026 → 2026-27, March 2026 → 2025-26', C.fyText(2027, 3) === '2026-27' && C.fyText(2026, 4) === '2026-27' && C.fyText(2026, 3) === '2025-26');
}

// ─── 2. Replace / Add / duplicate ────────────────────────────────────────────
{
  console.log('\n§2  Replace PDF, Add PDF, the same file twice');
  const st = V.memoryStore();
  await save(st, admin, 20, 9, 'page2.pdf', pdf('v1'));
  await save(st, admin, 20, 9, 'gunny.pdf', pdf('gunny'), 'add');
  check('Add keeps the month\'s other file: 2 files', st.rows.filter((r) => r.month === 9).length === 2);
  const r = await save(st, admin, 20, 9, 'page2-corrected.pdf', pdf('v2'), 'replace');
  const names = st.rows.filter((x) => x.crs_id === 20 && x.month === 9).map((x) => x.file_name);
  check(`Replace leaves ONE active file for CRS 20 September: ${names.join(', ')}`, names.length === 1 && names[0] === 'page2-corrected.pdf');
  check(`the answer names what it replaced (${r.body.replaced})`, r.body.replaced.sort().join() === 'gunny.pdf,page2.pdf' && r.saved.removed.length === 2);
  const d = await save(st, admin, 20, 9, 'same-again.pdf', pdf('v2'), 'add');
  check('the same file again is not stored twice (sha256)', d.body.duplicate === true && st.rows.filter((x) => x.month === 9).length === 1);
  const d2 = await save(st, admin, 20, 9, 'page2-corrected.pdf', pdf('v2'), 'replace');
  check('Replace with the same file keeps it, still one row', d2.status === 200 && st.rows.filter((x) => x.month === 9).length === 1);
  await save(st, admin, 20, 8, 'aug.pdf', pdf('aug'));
  await save(st, admin, 20, 9, 'v3.pdf', pdf('v3'));
  check('replacing September leaves August alone', st.rows.some((x) => x.month === 8 && x.file_name === 'aug.pdf') && st.rows.filter((x) => x.month === 9).map((x) => x.file_name).join() === 'v3.pdf');
  const latest = await V.fileBytes(st, admin, st.rows.find((x) => x.month === 9).id);
  check('the active file is the latest one saved', Buffer.from(latest.bytes).toString().includes('v3'));
}

// ─── 3. Refused, nothing stored ──────────────────────────────────────────────
{
  console.log('\n§3  Refused — and nothing stored');
  const st = V.memoryStore();
  const cases = [
    ['not .pdf', await save(st, admin, 20, 9, 'sheet.xlsx', pdf('x')), 400],
    ['not a PDF inside', await save(st, admin, 20, 9, 'fake.pdf', new Uint8Array(Buffer.from('hello world'))), 400],
    ['empty', await save(st, admin, 20, 9, 'empty.pdf', new Uint8Array(0)), 400],
    ['too large', await save(st, admin, 20, 9, 'big.pdf', new Uint8Array(C.MAX_PDF_BYTES + 1).fill(37)), 400],
    ['a month not yet happened (November 2026)', await save(st, admin, 20, 11, 'nov.pdf', pdf('nov')), 400],
    ['a bad mode', await V.saveUpload(st, admin, { crsId: 20, year: 2026, month: 9, name: 'a.pdf', mode: 'merge', bytes: pdf('a') }, TODAY), 400],
    ['an unknown shop', await save(st, admin, 0, 9, 'a.pdf', pdf('a')), 400],
    ['signed out', await save(st, null, 20, 9, 'a.pdf', pdf('a')), 401],
  ];
  for (const [label, a, want] of cases) check(`${label}: ${a.status} — ${a.body.error}`, a.status === want);
  check('nothing was stored by any of them', st.rows.length === 0);
  check('the current month may be saved (October 2026)', (await save(st, admin, 20, 10, 'oct.pdf', pdf('oct'))).status === 200);
  check('a folder in the name is dropped', C.cleanName('C:\\Users\\x\\CRS 20 SEP.pdf') === 'CRS 20 SEP.pdf');
}

// ─── 4. Isolated by CRS ──────────────────────────────────────────────────────
{
  console.log('\n§4  Each shop sees only its own');
  const st = V.memoryStore();
  await save(st, crs20, 20, 9, 'crs20-sep.pdf', pdf('20'));
  await save(st, crs23, 23, 9, 'crs23-sep.pdf', pdf('23'));
  const l20 = await V.listUploads(st, crs20, 20, Q3);
  const l23 = await V.listUploads(st, crs23, 23, Q3);
  check('CRS 20 lists only crs20-sep.pdf; CRS 23 only crs23-sep.pdf', l20.body.months['2026-9'].files.map((f) => f.name).join() === 'crs20-sep.pdf' && l23.body.months['2026-9'].files.map((f) => f.name).join() === 'crs23-sep.pdf');
  check('CRS 20\'s user asking for CRS 23: 403', (await V.listUploads(st, crs20, 23, Q3)).status === 403);
  check('CRS 20\'s user saving for CRS 23: 403, nothing stored', (await save(st, crs20, 23, 8, 'x.pdf', pdf('x'))).status === 403 && st.rows.length === 2);
  const other = st.rows.find((r) => r.crs_id === 23);
  check('CRS 20\'s user fetching CRS 23\'s file by id: 404, as if it did not exist', (await V.fileBytes(st, crs20, other.id)).status === 404);
  check('CRS 20\'s user removing CRS 23\'s month: 403, still there', (await V.removeMonth(st, crs20, 23, 2026, 9)).status === 403 && st.rows.length === 2);
  const r20 = await save(st, crs20, 20, 9, 'crs20-sep-v2.pdf', pdf('20b'));
  check('replacing CRS 20 September leaves CRS 23 September alone', r20.status === 200 && st.rows.some((r) => r.crs_id === 23 && r.file_name === 'crs23-sep.pdf'));
  const la = await V.listUploads(st, admin, 23, Q3);
  check('the administrator reaches any shop', la.status === 200 && la.body.months['2026-9'].files[0].name === 'crs23-sep.pdf' && (await V.fileBytes(st, admin, other.id)).status === 200);
}

// ─── 5. Remove ───────────────────────────────────────────────────────────────
{
  console.log('\n§5  Remove');
  const st = V.memoryStore();
  await save(st, admin, 20, 9, 'a.pdf', pdf('a'));
  await save(st, admin, 20, 9, 'b.pdf', pdf('b'), 'add');
  await save(st, admin, 20, 8, 'aug.pdf', pdf('aug'));
  await save(st, admin, 23, 9, 'c.pdf', pdf('c'));
  const r = await V.removeMonth(st, admin, 20, 2026, 9);
  check(`removes CRS 20 September's two files (${r.body.removed})`, r.status === 200 && r.removed.length === 2);
  check('August and CRS 23 stay', st.rows.map((x) => x.file_name).sort().join() === 'aug.pdf,c.pdf');
}

// ─── 6. The route and the screen ─────────────────────────────────────────────
{
  console.log('\n§6  Route and screen wiring');
  const route = readFileSync(join(root, 'src/app/api/pv-uploads/route.ts'), 'utf8');
  const file = readFileSync(join(root, 'src/app/api/pv-uploads/[id]/route.ts'), 'utf8');
  const ui = readFileSync(join(root, 'src/app/(app)/reports/ManualPvUpload.tsx'), 'utf8');
  check('the route answers through listUploads / saveUpload / removeMonth on the storage store', /listUploads\(storagePvStore\(\)/.test(route) && /saveUpload\(storagePvStore\(\)/.test(route) && /removeMonth\(storagePvStore\(\)/.test(route));
  check('the file route checks the shop through fileBytes', /fileBytes\(storagePvStore\(\)/.test(file));
  check('the screen keeps nothing in sessionStorage / localStorage', !/sessionStorage|localStorage/.test(ui));
  check('on opening it asks the server (refresh in the scope effect)', /useEffect\(\(\) => \{[\s\S]{0,200}void refresh\(\)/.test(ui));
  check('the tick only after the server answers with the file saved', /await refresh\(\[m\][\s\S]*saveSuccess\(/.test(ui) && !/saveSuccess\([\s\S]*savePdf\(/.test(ui));
  check('Generate asks the server again before building', /const generate = async \(\) => \{[\s\S]{0,200}await refresh\(\)/.test(ui));
  check('Replace PDF and Browse PDF on the card', /'Replace PDF'/.test(ui) && /'Browse PDF'/.test(ui));
  // Office, 2026-10-06: a month the system has figures for is fetched, never asked for as a PDF.
  check('each month from its own source: system figures first (any month, not only the current one), then a PDF',
    /isCurrent\(m\) \|\| systemStates\[keyOf\(m\)\]\?\.has \? 'system' : 'pdf'/.test(ui) && /✓ Data available — automatically fetched/.test(ui) && /⚠ Manual upload required/.test(ui));
  check('the system month is worked out again whenever the saved stores change, and Generate uses it, not a PDF',
    /const systemStates = useMemo\([\s\S]*?\[period, systemMonth, today\.year, today\.month\]\)/.test(ui) && /kindOf\(m\) === 'system' \? systemMonth\(m\) : pdfQuarterMonth/.test(ui));
  const store = readFileSync(join(root, 'src/lib/pvUploads/storageStore.ts'), 'utf8');
  const kit = readFileSync(join(root, 'src/lib/pvUploads/routeKit.ts'), 'utf8');
  check('no migration needed: files in a private Storage bucket the server creates, details in crs_state under scope pv_upload',
    !existsSync(join(root, 'supabase/migrations/0009_pv_uploads.sql')) && /createBucket\(PV_BUCKET, \{ public: false/.test(store) && /PV_SCOPE = 'pv_upload'/.test(store) && /\.eq\('version', version\)/.test(store));
  check('the routes use that store, and tell the person a plain sentence (the detail goes to the server log)',
    /storagePvStore\(\)/.test(route) && /storagePvStore\(\)/.test(file) && /Unable to save the PDF\. Please try again\./.test(kit) && !/migration|0009|table/i.test(kit.split('const PLAIN')[1]));
  // Nothing else in the app reads crs_state outside scope 'global', so these records stay out of every store load.
  const reads = ['src/app/api/state/route.ts', 'src/app/api/sync/route.ts', 'src/lib/clearExecute.ts', 'src/app/api/activity/route.ts'].map((f) => readFileSync(join(root, f), 'utf8'));
  check("the app's own crs_state reads stay on scope global", reads.every((s) => /\.eq\('scope', 'global'\)/.test(s)));
}

console.log(failures ? `\n${failures} FAILED\n` : '\nall passed\n');
process.exit(failures ? 1 : 0);
