/**
 * The automatic (Quarterly / Yearly) PV's Gunny section is Gunny Stock
 * Management's own figures (office, 2026-10-01; pvQuarter.ts pvPeriodGunny).
 *
 *   node tools/verify-pv-gunny.mjs
 *
 * It printed the RAW stored record of the period's first month, so a
 * July–September quarter with no July record printed every Gunny figure 0.
 *   1. one month with data (September): the PV's Gunny = the Gunny Stock
 *      screen's row (gunnyRowFor) — Opening, Receipt, Total, Issues, Closing —
 *      for 50 KG SS, POLY and C.BOX, printed on the sheet;
 *   2. two months (August + September): Opening = August's, Receipt and
 *      Issues added, Total = Opening + Receipt, Closing = Total − Issues =
 *      September's Closing (August CB → September OB);
 *   3. a month with nothing in between passes; the first months with nothing
 *      do not zero the Opening;
 *   4. latest data: a Gunny Opening typed after the PV was built shows on the
 *      next build (nothing cached);
 *   5. the old reading (first month's raw record) would have printed 0;
 *   6. wiring: the Reports page builds the automatic PV's Gunny with
 *      pvPeriodGunny, not a stored record.
 */
import { readFileSync } from 'node:fs';
import { register } from 'node:module';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const srcUrl = pathToFileURL(join(root, 'src') + '/').href;
register(
  `data:text/javascript,${encodeURIComponent(`
const SRC = ${JSON.stringify(srcUrl)};
export async function resolve(spec, ctx, next) {
  let s = spec;
  const rel = (s.startsWith('./') || s.startsWith('../')) && ctx.parentURL && ctx.parentURL.startsWith(SRC);
  if (s.startsWith('@/') || rel) {
    const base = s.startsWith('@/') ? SRC + s.slice(2) : new URL(s, ctx.parentURL).href;
    if (/\\.[a-z]+$/.test(s)) return next(base, ctx);
    for (const ext of ['.ts', '.tsx', '.js']) { try { return await next(base + ext, ctx); } catch {} }
  }
  const r = await next(s, ctx);
  return r.url.endsWith('.json') ? { ...r, importAttributes: { type: 'json' } } : r;
}`)}`,
  import.meta.url,
);
const imp = (p) => import(pathToFileURL(join(root, 'src', p)).href);
const Q = await imp('lib/engine/pvQuarter.ts');
const { buildPVTable } = await imp('lib/engine/pvStatement.ts');
const { quarterByIndex } = await imp('lib/engine/pvPeriod.ts');
const { gunnyRowFor } = await imp('app/(app)/monthly-entry/lib.ts');

let failures = 0;
const check = (label, ok, detail = '') => {
  if (ok) console.log(`  ok    ${label}`);
  else { failures++; console.log(`  FAIL  ${label}${detail ? `\n        ${detail}` : ''}`); }
};
const J = JSON.stringify;
const CRS = 1;
const row = (o) => ({ open: 0, receipt: 0, total: 0, sales: 0, close: 0, amount: 0, excess: 0, shortage: 0, transfer: 0, ...o });
const quarter = quarterByIndex(2026, 1); // July–September 2026
const tuple = (g) => [g.opening, g.receipt, g.total, g.issues, g.closing];
// CRS 1 September as it stands live (2026-10-01): SS 569 + 206 = 775 − 525 = 250; POLY 15 + 16 = 31; C.BOX 0 + 58 − 22 = 36.
function shop() {
  return {
    entryStore: {
      '1_2026-09-30': { a: { BRA: row({ open: 10300, total: 10300, sales: 10300 }), SUGAR: row({ open: 800, total: 800, sales: 800 }), PALM: row({ open: 580, total: 580, sales: 580 }), EMPTY_BOX: row({ sales: 22 }) }, b: {} },
    },
    inspectionStore: {},
    meManualStore: {},
    receiptStore: [],
    salesCloseStore: {},
    meGunnyStore: { '1_9_2026': { ss50: { opening: 569, openingAuto: false, issues: 525 }, poly: { opening: 15, openingAuto: false } } },
  };
}
const has = (st) => (m) => Object.keys(st.entryStore).some((k) => k.startsWith(`${CRS}_${m.year}-${String(m.month).padStart(2, '0')}`)) || !!st.meGunnyStore[`${CRS}_${m.month}_${m.year}`] || !!st.meManualStore[`${CRS}_${m.month}_${m.year}`];
const screen = (st, month) => Q.systemQuarterMonth(CRS, month, 2026, st, false).gunny;
const printed = (g) => {
  const html = buildPVTable({ commMap: {}, periodLabel: 'Q', crsId: CRS, crsName: '', gunny: g, billClerk: '', pvOfficer: '', pvDate: '' });
  const out = {};
  for (const [, tr] of html.matchAll(/<tr[^>]*>([\s\S]*?)<\/tr>/g)) {
    const c = [...tr.matchAll(/<td[^>]*>([\s\S]*?)<\/td>/g)].map((m) => m[1].replace(/<[^>]+>/g, '').trim());
    const name = c.find((x) => /SS GUNNY|^POLYTHENE$|^C\.BOX$/.test(x));
    if (name) out[name] = c.filter((x) => /^-?\d+(\.\d+)?$/.test(x)).map(Number);
  }
  return out;
};

console.log('1. July–September with only September keyed: the PV is the Gunny Stock screen');
{
  const st = shop();
  const g = Q.pvPeriodGunny(CRS, quarter.months, st, has(st));
  const s = screen(st, 9);
  for (const [k, name] of [['ss50', '50 kg SS GUNNY'], ['poly', 'POLYTHENE'], ['cbox', 'C.BOX']]) {
    const p = printed(g)[name] ?? [];
    check(`${name}: screen ${J(tuple(s[k]))} · PV ${J(tuple(g[k]))} · printed ${J(p)}`, J(tuple(s[k])) === J(tuple(g[k])) && tuple(g[k]).every((v) => p.includes(v)));
  }
  check(`50 KG SS = the office's example: 569 + 206 = 775 − 525 = 250 (${J(tuple(g.ss50))})`, J(tuple(g.ss50)) === J([569, 206, 775, 525, 250]));
}

console.log('\n2. August and September keyed: carried and added up');
{
  const st = shop();
  st.entryStore['1_2026-08-31'] = { a: { BRA: row({ open: 5000, total: 5000, sales: 5000 }) }, b: {} };
  st.meGunnyStore['1_8_2026'] = { ss50: { opening: 400, openingAuto: false, issues: 100 } };
  // September's Opening carried from August's stored Closing (not keyed).
  delete st.meGunnyStore['1_9_2026'].ss50.opening;
  st.meGunnyStore['1_9_2026'].ss50.openingAuto = true;
  const aug = screen(st, 8).ss50;
  st.meGunnyStore['1_8_2026'].ss50 = { ...st.meGunnyStore['1_8_2026'].ss50, receipt: aug.receipt, total: aug.total, closing: aug.closing };
  const sep = screen(st, 9).ss50;
  const g = Q.pvPeriodGunny(CRS, quarter.months, st, has(st)).ss50;
  check(`August ${J(tuple(aug))} → September opens at August's Closing ${sep.opening}`, sep.opening === aug.closing);
  check(`PV: Opening ${g.opening} (August's) + Receipt ${g.receipt} (both months) = ${g.total} − Issues ${g.issues} = Closing ${g.closing} (September's ${sep.closing})`, g.opening === aug.opening && g.receipt === aug.receipt + sep.receipt && g.issues === aug.issues + sep.issues && g.total === g.opening + g.receipt && g.closing === sep.closing);
}

console.log('\n3. Months with nothing');
{
  const st = shop();
  const g = Q.pvPeriodGunny(CRS, [{ month: 7, year: 2026 }, { month: 8, year: 2026 }, { month: 9, year: 2026 }], st, has(st));
  check(`July and August hold nothing: the Opening is September's 569, not 0 (${g.ss50.opening})`, g.ss50.opening === 569);
  const none = Q.pvPeriodGunny(CRS, [{ month: 4, year: 2026 }], st, has(st));
  check(`a period with nothing at all prints zeros (${J(tuple(none.ss50))})`, J(tuple(none.ss50)) === J([0, 0, 0, 0, 0]));
}

console.log('\n4. Latest saved data, nothing cached');
{
  const st = shop();
  const before = Q.pvPeriodGunny(CRS, quarter.months, st, has(st)).ss50;
  st.meGunnyStore['1_9_2026'].ss50.opening = 570;
  const after = Q.pvPeriodGunny(CRS, quarter.months, st, has(st)).ss50;
  check(`Opening typed 569 → 570 on Gunny Stock: the next PV build shows ${after.opening}, Total ${after.total}, Closing ${after.closing}`, before.opening === 569 && after.opening === 570 && after.total === 776 && after.closing === 251);
}

console.log('\n5. What the old reading printed');
{
  const st = shop();
  const old = st.meGunnyStore[`${CRS}_${quarter.months[0].month}_${quarter.months[0].year}`] ?? {};
  check(`the period's first month (July) has no stored record → the old PV printed ${J(printed(old)['50 kg SS GUNNY'].slice(1))} (after the Sl. No.)`, J(printed(old)['50 kg SS GUNNY'].slice(1)) === J([0, 0, 0, 0, 0]));
}

console.log('\n7. A PV-only correction: CRS 9, the July – September 2026 PV (office, 2026-10-06)');
{
  const PC = await imp('lib/engine/pvCorrections.ts');
  // The PV as the office's screenshot shows it (period figures): SS 725 + 572 − 1025 = 272;
  // POLY 0 + 46 − 35 = 11; C.BOX 0 + 144 − 144 = 0.
  const flow = (opening, receipt, issues) => ({ opening, receipt, total: opening + receipt, issues, closing: opening + receipt - issues });
  const system = { ss50: flow(725, 572, 1025), poly: flow(0, 46, 35), cbox: flow(0, 144, 144) };
  const snapshot = J(system);
  const pv = PC.pvGunnyWithCorrection(9, quarter.months, system);
  check(`POLYTHENE on the PV: ${J(tuple(pv.poly))} = 0 + 49 = 49 − 38 = 11`, J(tuple(pv.poly)) === J([0, 49, 49, 38, 11]));
  check(`C.BOX on the PV: ${J(tuple(pv.cbox))} = 0 + 145 = 145 − 145 = 0`, J(tuple(pv.cbox)) === J([0, 145, 145, 145, 0]));
  check(`50 KG SS GUNNY exactly as before: ${J(tuple(pv.ss50))}`, J(tuple(pv.ss50)) === J([725, 572, 1297, 1025, 272]) && pv.ss50 === system.ss50);
  check('the system\'s own figures are not changed (a new object; the input is untouched)', J(system) === snapshot && pv !== system);
  check('every corrected row adds up: TOTAL = OPENING + RECEIPT, CB = TOTAL − SALES', ['poly', 'cbox'].every((k) => pv[k].total === pv[k].opening + pv[k].receipt && pv[k].closing === pv[k].total - pv[k].issues));
  const p = printed(pv);
  check(`printed on the PV sheet (Preview = Print = PDF, one markup): POLYTHENE ${J(p.POLYTHENE)}, C.BOX ${J(p['C.BOX'])}`,
    J(p.POLYTHENE.slice(1)) === J([0, 49, 49, 38, 11]) && J(p['C.BOX'].slice(1)) === J([0, 145, 145, 145, 0]) && J(p['50 kg SS GUNNY'].slice(1)) === J([725, 572, 1297, 1025, 272]));
  // Only this shop and this PV.
  const other = [
    ['CRS 8, same quarter', 8, quarter.months],
    ['CRS 9, September alone', 9, [{ month: 9, year: 2026 }]],
    ['CRS 9, Oct – Dec 2026', 9, quarterByIndex(2026, 2).months],
    ['CRS 9, the year Apr 2026 – Mar 2027', 9, Array.from({ length: 12 }, (_, i) => ({ month: ((i + 3) % 12) + 1, year: i < 9 ? 2026 : 2027 }))],
  ];
  for (const [label, crs, months] of other) check(`${label}: untouched`, PC.pvGunnyWithCorrection(crs, months, system) === system);
  // The PV's own figures from the stores are not where it is applied: pvPeriodGunny is unchanged.
  const pvq = readFileSync(join(root, 'src/lib/engine/pvQuarter.ts'), 'utf8');
  check('pvQuarter (the system figures, the 3-Month PV\'s chain check) does not apply it', !/pvCorrections|pvGunnyWithCorrection/.test(pvq));
  const page = readFileSync(join(root, 'src/app/(app)/reports/page.tsx'), 'utf8');
  check('Reports applies it to BOTH PVs: Automatic and Manual 3-Month',
    /const gunny = pvGunnyWithCorrection\(crsId, pvPeriod\.months, pvPeriodGunny\(/.test(page) && /gunny: pvGunnyWithCorrection\(crsId, pvPeriod\.months, gunny\)/.test(page));
  const { execSync } = await import('node:child_process');
  const users = execSync('git grep -l -e pvCorrections -e pvGunnyWithCorrection -e PV_GUNNY_CORRECTIONS -- src', { cwd: root, encoding: 'utf8' }).trim().split(/\r?\n/).sort();
  check(`nothing but the PV reads it: ${users.join(', ')}`, J(users) === J(['src/app/(app)/reports/page.tsx', 'src/lib/engine/pvCorrections.ts']));
}

console.log('\n6. Wiring');
{
  const page = readFileSync(join(root, 'src/app/(app)/reports/page.tsx'), 'utf8');
  check('the automatic PV builds its Gunny with pvPeriodGunny over the period\'s months', /const gunny = (pvGunnyWithCorrection\(crsId, pvPeriod\.months, )?pvPeriodGunny\(\s*crsId,\s*pvPeriod\.months,/.test(page));
  check('…and no longer reads the first month\'s stored record', !/meGunnyStore\[`\$\{crsId\}_\$\{first\.month\}_\$\{first\.year\}`\]/.test(page));
  const pvq = readFileSync(join(root, 'src/lib/engine/pvQuarter.ts'), 'utf8');
  check('the 3-month PV\'s current month uses the same function (gunnyOfMonth)', /const gunny = gunnyOfMonth\(crsId, month, year, stores, merged\)/.test(pvq) && /gunnyRowFor\(k,/.test(pvq));
  check('gunnyRowFor is the Gunny Stock screen\'s function', typeof gunnyRowFor === 'function');
}

console.log(failures ? `\n${failures} FAILED` : '\nALL PV-GUNNY CHECKS PASSED');
process.exit(failures ? 1 : 0);
