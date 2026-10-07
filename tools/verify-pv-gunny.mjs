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

console.log('\n7. PV-only corrections (office, 2026-10-06): CRS 9 Gunny, CRS 7 Wheat bags (Manual PV), CRS 11 Police BRA bags (both PVs) — Jul–Sep 2026');
{
  const PC = await imp('lib/engine/pvCorrections.ts');
  // The PV as the office's screenshot shows it (period figures): SS 725 + 572 − 1025 = 272;
  // POLY 0 + 46 − 35 = 11; C.BOX 0 + 144 − 144 = 0.
  const flow = (opening, receipt, issues) => ({ opening, receipt, total: opening + receipt, issues, closing: opening + receipt - issues });
  const system = { ss50: flow(725, 572, 1025), poly: flow(0, 46, 35), cbox: flow(0, 144, 144) };
  const snapshot = J(system);
  const pv = PC.pvGunnyWithCorrection(9, quarter.months, system, 'manual');
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
  for (const [label, crs, months] of other) check(`${label}: untouched`, PC.pvGunnyWithCorrection(crs, months, system, 'manual') === system);
  // The PV's own figures from the stores are not where it is applied: pvPeriodGunny is unchanged.
  const pvq = readFileSync(join(root, 'src/lib/engine/pvQuarter.ts'), 'utf8');
  check('pvQuarter (the system figures, the 3-Month PV\'s chain check) does not apply it', !/pvCorrections|pvGunnyWithCorrection/.test(pvq));
  const page = readFileSync(join(root, 'src/app/(app)/reports/page.tsx'), 'utf8');
  check('Reports lays the corrections over BOTH PVs, each saying which it is (Manual / Automatic)',
    /commMap: pvCommMapWithCorrection\(crsId, pvPeriod\.months, pvPoliceOwnBags\(crsId, commMap, policeBagsFor\(crsId\)\), 'manual'\)/.test(page) && /gunny: pvGunnyWithCorrection\(crsId, pvPeriod\.months, gunny, 'manual'\)/.test(page) &&
    /commMap: pvCommMapWithCorrection\(crsId, pvPeriod\.months, pvPoliceOwnBags\(crsId, agg\.commMap, policeBagsFor\(crsId\)\), 'auto'\)/.test(page) && /const gunny = pvGunnyWithCorrection\(crsId, pvPeriod\.months, pvPeriodGunny\([\s\S]{0,120}\), 'auto'\)/.test(page));
  check('CRS 9\'s Gunny is the MANUAL PV\'s only: the Automatic PV of the same quarter is untouched', PC.pvGunnyWithCorrection(9, quarter.months, system, 'auto') === system);

  // CRS 7, the July – September 2026 PV: Wheat BAGS 16 + 73 = 89 − 68 = 21; its kgs and every other row untouched.
  const wheat = { name: 'Wheat', unit: 'KG', open: 816, receipt: 3716, total: 4532, issues: 3465, closing: 1067, amount: 0, free: false, transfer: 0, shortage: 0, excess: 0, bags: { open: 16, receipt: 74, total: 90, issues: 69, closing: 21 } };
  const sugar = { ...wheat, name: 'Sugar', bags: { open: 14, receipt: 42, total: 56, issues: 42, closing: 14 } };
  const map = { WHEAT: wheat, SUGAR: sugar };
  const mapSnap = J(map);
  const fixed = PC.pvCommMapWithCorrection(7, quarter.months, map, 'manual');
  const b = fixed.WHEAT.bags;
  check(`CRS 7 Wheat bags on the PV: ${b.open} + ${b.receipt} = ${b.total} − ${b.issues} = ${b.closing}`, J([b.open, b.receipt, b.total, b.issues, b.closing]) === J([16, 73, 89, 68, 21]));
  check('…its kgs unchanged, Sugar unchanged, the input map untouched', J({ ...fixed.WHEAT, bags: undefined, bagsFixed: undefined }) === J({ ...wheat, bags: undefined }) && fixed.SUGAR === sugar && J(map) === mapSnap);
  const sheet = buildPVTable({ commMap: fixed, periodLabel: 'Q', crsId: 7, crsName: '', gunny: system, billClerk: '', pvOfficer: '', pvDate: '' });
  const wrow = [...sheet.matchAll(/<tr[^>]*>([\s\S]*?)<\/tr>/g)].map((m) => [...m[1].matchAll(/<td[^>]*>([\s\S]*?)<\/td>/g)].map((x) => x[1].replace(/<[^>]+>/g, '').trim())).find((c) => c.includes('Wheat')) ?? [];
  const nums = wrow.filter((x) => /^-?\d+(\.\d+)?$/.test(x));
  check(`printed Wheat row: ${nums.join(' ')}`, ['16', '816', '73', '3716', '89', '4532', '68', '3465', '21', '1067'].every((v) => nums.includes(v)) && !nums.includes('74') && !nums.includes('69'));
  for (const [label, crs, months] of [['CRS 9, same quarter', 9, quarter.months], ['CRS 7, Oct – Dec 2026', 7, quarterByIndex(2026, 2).months], ['CRS 7, September alone', 7, [{ month: 9, year: 2026 }]]]) {
    check(`${label}: Wheat bags untouched`, PC.pvCommMapWithCorrection(crs, months, map, 'manual') === map);
  }
  check('CRS 7\'s Wheat is the MANUAL PV\'s only: the Automatic PV is untouched', PC.pvCommMapWithCorrection(7, quarter.months, map, 'auto') === map);

  // CRS 11, the July – September 2026 PV, Manual AND Automatic: BRA Rice (Police) Receipt +1 bag, Issues +1 bag.
  const police = (o) => ({ unit: 'KG', amount: 0, free: true, transfer: 0, shortage: 0, excess: 0, ...o });
  const map11 = {
    BRA: police({ name: 'BRA Rice', open: 6400, receipt: 11543.42, total: 17943.42, issues: 9267, closing: 8676.42, bags: { open: 128, receipt: 230, total: 358, issues: 185, closing: 173 } }),
    PB_BRA: police({ name: 'BRA Rice (Police)', open: 2, receipt: 54, total: 56, issues: 54, closing: 2 }),
    PB_SUGAR: police({ name: 'Sugar (Police)', open: 0, receipt: 6, total: 6, issues: 6, closing: 0 }),
  };
  const snap11 = J(map11);
  const policeRow = (m, name) => {
    const html = buildPVTable({ commMap: m, periodLabel: 'Q', crsId: 11, crsName: '', gunny: system, billClerk: '', pvOfficer: '', pvDate: '' });
    const c = [...html.matchAll(/<tr[^>]*>([\s\S]*?)<\/tr>/g)].map((x) => [...x[1].matchAll(/<td[^>]*>([\s\S]*?)<\/td>/g)].map((y) => y[1].replace(/<[^>]+>/g, '').trim())).find((r) => r.includes(name)) ?? [];
    // Sl · name · unit · then the 8 Opening, 10 Receipt, TRANSFER, TOTAL, 11 Issues … 14 Balance cells.
    const v = c.slice(3);
    return { open: [v[5], v[6]], receipt: [v[9], v[10]], total: [v[12], v[13]], issues: [v[14], v[15]], balance: [v[23], v[24]] };
  };
  const before11 = policeRow(map11, 'BRA Rice (Police)');
  for (const kind of ['manual', 'auto']) {
    const m = PC.pvCommMapWithCorrection(11, quarter.months, map11, kind);
    const r = policeRow(m, 'BRA Rice (Police)');
    check(`CRS 11 ${kind === 'manual' ? 'Manual' : 'Automatic'} PV, BRA Rice (Police) bags / kgs: Opening ${r.open.join(' / ')} · Receipt ${r.receipt.join(' / ')} · Total ${r.total.join(' / ')} · Issues ${r.issues.join(' / ')} · Balance ${r.balance.join(' / ')}`,
      J(r) === J({ open: ['0', '2'], receipt: ['1', '54'], total: ['1', '56'], issues: ['1', '54'], balance: ['0', '2'] }));
    check(`  …Sugar (Police) and B.RICE untouched, the input map untouched`, m.PB_SUGAR === map11.PB_SUGAR && m.BRA === map11.BRA && J(policeRow(m, 'Sugar (Police)')) === J(policeRow(map11, 'Sugar (Police)')) && J(map11) === snap11);
  }
  check(`without the correction the police row prints its bags as 0, as always (${J(before11)})`, J(before11) === J({ open: ['0', '2'], receipt: ['0', '54'], total: ['0', '56'], issues: ['0', '54'], balance: ['0', '2'] }));
  for (const [label, crs, months] of [['CRS 12, same quarter', 12, quarter.months], ['CRS 11, Oct – Dec 2026', 11, quarterByIndex(2026, 2).months], ['CRS 11, August alone', 11, [{ month: 8, year: 2026 }]]]) {
    check(`${label}: BRA Rice (Police) untouched`, PC.pvCommMapWithCorrection(crs, months, map11, 'auto') === map11 && PC.pvCommMapWithCorrection(crs, months, map11, 'manual') === map11);
  }

  // CRS 30, the July – September 2026 PV, Manual and Automatic: BRA Rice (Police) Receipt +1 bag, Issues +1 bag.
  const map30 = {
    PB_BRA: police({ name: 'BRA Rice (Police)', open: 25, receipt: 110, total: 135, issues: 96.5, closing: 38.5 }),
    PB_SUGAR: police({ name: 'Sugar (Police)', open: 2, receipt: 12, total: 14, issues: 10.5, closing: 3.5 }),
  };
  const snap30 = J(map30);
  for (const kind of ['manual', 'auto']) {
    const m = PC.pvCommMapWithCorrection(30, quarter.months, map30, kind);
    const r = policeRow(m, 'BRA Rice (Police)');
    check(`CRS 30 ${kind === 'manual' ? 'Manual' : 'Automatic'} PV, BRA Rice (Police) bags / kgs: Opening ${r.open.join(' / ')} · Receipt ${r.receipt.join(' / ')} · Total ${r.total.join(' / ')} · Issues ${r.issues.join(' / ')} · Balance ${r.balance.join(' / ')}`,
      J(r) === J({ open: ['0', '25'], receipt: ['1', '110'], total: ['1', '135'], issues: ['1', '96.500'], balance: ['0', '38.500'] }));
    check('  …Sugar (Police) untouched, the input map untouched', m.PB_SUGAR === map30.PB_SUGAR && J(map30) === snap30);
  }
  check('  CRS 30, Oct – Dec 2026: untouched', PC.pvCommMapWithCorrection(30, quarterByIndex(2026, 2).months, map30, 'auto') === map30);

  // CRS 10 (office, 2026-10-07): its Police BRA prints its own bag counts (Monthly Sales'), every PV; nothing else.
  const map10 = {
    PB_BRA: police({ name: 'BRA Rice (Police)', open: 36.5, receipt: 143, total: 179.5, issues: 142.5, closing: 37 }),
    PB_SUGAR: police({ name: 'Sugar (Police)', open: 2, receipt: 0, total: 2, issues: 0, closing: 2 }),
  };
  const snap10 = J(map10);
  const own10 = PC.pvPoliceOwnBags(10, map10, () => ({ PB_BRA: { open: 0, receipt: 2, total: 2, issues: 2, closing: 0 } }));
  const r10 = policeRow(own10, 'BRA Rice (Police)');
  check(`CRS 10 PV, BRA Rice (Police) bags / kgs: Opening ${r10.open.join(' / ')} · Receipt ${r10.receipt.join(' / ')} · Total ${r10.total.join(' / ')} · Issues ${r10.issues.join(' / ')} · Balance ${r10.balance.join(' / ')}`,
    J(r10) === J({ open: ['0', '36.500'], receipt: ['2', '143'], total: ['2', '179.500'], issues: ['2', '142.500'], balance: ['0', '37'] }));
  check('  …Sugar (Police) still prints 0 bags, the input map untouched', own10.PB_SUGAR === map10.PB_SUGAR && J(map10) === snap10);
  check('  no other shop: CRS 11 / 1 police lines unchanged by this list', PC.pvPoliceOwnBags(11, map10, () => ({ PB_BRA: { open: 9, receipt: 9, total: 9, issues: 9, closing: 9 } })) === map10 && PC.pvPoliceOwnBags(1, map10, () => ({})) === map10);
  const stacked = PC.pvCommMapWithCorrection(11, quarter.months, PC.pvPoliceOwnBags(11, map11, () => ({})), 'auto');
  check('  a PV correction still adds on top (CRS 11: +1 / +1 over its 0s)', J(policeRow(stacked, 'BRA Rice (Police)').receipt) === J(['1', '54']));

  // CRS 10, the July – September 2026 Manual PV: Police BRA Receipt 5, Issues 5 bags (set — not added to its own 2 / 2).
  const manual10 = PC.pvCommMapWithCorrection(10, quarter.months, own10, 'manual');
  const m10 = policeRow(manual10, 'BRA Rice (Police)');
  check(`CRS 10 Manual PV, BRA Rice (Police): Opening ${m10.open.join(' / ')} · Receipt ${m10.receipt.join(' / ')} · Total ${m10.total.join(' / ')} · Issues ${m10.issues.join(' / ')} · Balance ${m10.balance.join(' / ')}`,
    J(m10) === J({ open: ['0', '36.500'], receipt: ['5', '143'], total: ['5', '179.500'], issues: ['5', '142.500'], balance: ['0', '37'] }));
  check('  …the Automatic PV keeps its own 2 / 2, Sugar (Police) untouched', PC.pvCommMapWithCorrection(10, quarter.months, own10, 'auto').PB_BRA === own10.PB_BRA && manual10.PB_SUGAR === own10.PB_SUGAR);

  // A PV-only KGS correction (PV_KG_CORRECTIONS), kgs only, its bags untouched. CRS 10's OAP FRK used one on
  // 2026-10-07 until the real 2 kg sale was recorded (correct-sales.mjs): the mechanism is tested with it put back
  // for the test; the live table holds none for CRS 10 any more.
  check('  the live table: no KGS override for CRS 10 (its OAP FRK is the data itself now)', !PC.PV_KG_CORRECTIONS['10|2026-7|2026-9']);
  PC.PV_KG_CORRECTIONS['10|2026-7|2026-9'] = { note: 'test', applies: 'both', rows: { OAP_FRK: { receipt: 2, issues: 2, closing: 0 } } };
  const frkBags = { open: 0, receipt: 2, total: 2, issues: 2, closing: 0 };
  const map10k = { ...own10, OAP_FRK: police({ name: 'OAP FRK', open: 0, receipt: 2, total: 2, issues: 0, closing: 2, bags: frkBags }), BRA: police({ name: 'BRA Rice', open: 100, receipt: 0, total: 100, issues: 50, closing: 50 }) };
  const snap10k = J(map10k);
  for (const kind of ['manual', 'auto']) {
    const m = PC.pvCommMapWithCorrection(10, quarter.months, map10k, kind);
    const f = m.OAP_FRK;
    const html = buildPVTable({ commMap: m, periodLabel: 'Q', crsId: 10, crsName: '', gunny: system, billClerk: '', pvOfficer: '', pvDate: '' });
    const v = [...html.matchAll(/<tr[^>]*>([\s\S]*?)<\/tr>/g)].map((x) => [...x[1].matchAll(/<td[^>]*>([\s\S]*?)<\/td>/g)].map((y) => y[1].replace(/<[^>]+>/g, '').trim())).find((c) => c[1] === 'OAP FRK')?.slice(3) ?? [];
    check(`CRS 10 ${kind === 'manual' ? 'Manual' : 'Automatic'} PV, OAP FRK kgs ${f.open} + ${f.receipt} = ${f.total} − ${f.issues} = ${f.closing}; printed bags (blank — kgs only) "${[v[5], v[9], v[12], v[14], v[23]].join('|')}", kgs ${[v[6], v[10], v[13], v[15], v[24]].join(' / ')}`,
      J([f.open, f.receipt, f.total, f.issues, f.closing]) === J([0, 2, 2, 2, 0]) && J(f.bags) === J(frkBags) && J([v[5], v[9], v[12], v[14], v[23]]) === J(['', '', '', '', '']) /* kgs only — no bags printed */ && J([v[6], v[10], v[13], v[15], v[24]]) === J(['0', '2', '2', '2', '0']));
    check(`  …BRA Rice's kgs and the input untouched${kind === 'manual' ? '; Police BRA still 5 / 5 bags (bags only — its kgs as before)' : ''}`,
      (kind === 'manual' ? J({ ...m.BRA, bags: undefined, bagsFixed: undefined }) === J({ ...map10k.BRA, bags: undefined }) : m.BRA === map10k.BRA) && J(map10k) === snap10k && (kind !== 'manual' || (m.PB_BRA.bags.receipt === 5 && m.PB_BRA.receipt === map10k.PB_BRA.receipt && m.PB_BRA.closing === map10k.PB_BRA.closing)));
  }
  check('  another period of CRS 10: OAP FRK untouched', PC.pvCommMapWithCorrection(10, quarterByIndex(2026, 2).months, map10k, 'auto') === map10k);
  delete PC.PV_KG_CORRECTIONS['10|2026-7|2026-9'];

  // CRS 10, the July – September 2026 Manual PV: the GUNNY sheets' note "POLICE BRA 3 CONSIDER AS POLY" says 5.
  const notes10 = ['POLICE BRA 3 CONSIDER AS POLY', 'WHEAT CONSIDER AS GUNNY'];
  const n10 = PC.pvNotesWithCorrection(10, quarter.months, notes10, 'manual');
  check(`CRS 10 Manual PV NOTE: ${J(n10)}`, J(n10) === J(['POLICE BRA 5 CONSIDER AS POLY', 'WHEAT CONSIDER AS GUNNY']) && J(notes10) === J(['POLICE BRA 3 CONSIDER AS POLY', 'WHEAT CONSIDER AS GUNNY']));
  const noteSheet = buildPVTable({ commMap: {}, periodLabel: 'Q', crsId: 10, crsName: '', gunny: system, gunnyNotes: n10, billClerk: '', pvOfficer: '', pvDate: '' });
  check('  printed in the NOTE row as 5, the 3 gone', /POLICE BRA 5 CONSIDER AS POLY/.test(noteSheet) && !/POLICE BRA 3/.test(noteSheet));
  check('  the Automatic PV, other periods and other shops untouched',
    PC.pvNotesWithCorrection(10, quarter.months, notes10, 'auto') === notes10 && PC.pvNotesWithCorrection(10, quarterByIndex(2026, 2).months, notes10, 'manual') === notes10 && PC.pvNotesWithCorrection(30, quarter.months, notes10, 'manual') === notes10);

  // CRS 10, the July – September 2026 Manual PV (office, 2026-10-07): BRA Rice BAGS 0 + 259 = 259 − 259 = 0 (had 251),
  // POLYTHENE 3 + 73 = 76 − 76 = 0 (had 3 + 68 = 71 − 71), C.BOX 0 + 221 = 221 − 221 = 0 (had 219). No kgs move.
  const bra10 = police({ name: 'BRA Rice', open: 0, receipt: 12557, total: 12557, issues: 12557, closing: 0, free: false, bags: { open: 0, receipt: 251, total: 251, issues: 251, closing: 0 } });
  const map10b = { ...own10, BRA: bra10 };
  const snap10b = J(map10b);
  const fx10 = PC.pvCommMapWithCorrection(10, quarter.months, map10b, 'manual');
  const bb = fx10.BRA.bags;
  check(`CRS 10 Manual PV, BRA Rice bags: ${bb.open} + ${bb.receipt} = ${bb.total} − ${bb.issues} = ${bb.closing}`, J([bb.open, bb.receipt, bb.total, bb.issues, bb.closing]) === J([0, 259, 259, 259, 0]));
  check('  …its kgs unchanged (0 + 12557 = 12557 − 12557 = 0), Police BRA still 5 / 5, the input untouched',
    J({ ...fx10.BRA, bags: undefined, bagsFixed: undefined }) === J({ ...bra10, bags: undefined }) && fx10.PB_BRA.bags.receipt === 5 && fx10.PB_BRA.bags.issues === 5 && J(map10b) === snap10b);
  const braRow = [...buildPVTable({ commMap: fx10, periodLabel: 'Q', crsId: 10, crsName: '', gunny: system, billClerk: '', pvOfficer: '', pvDate: '' }).matchAll(/<tr[^>]*>([\s\S]*?)<\/tr>/g)]
    .map((x) => [...x[1].matchAll(/<td[^>]*>([\s\S]*?)<\/td>/g)].map((y) => y[1].replace(/<[^>]+>/g, '').trim())).find((c) => c[1] === 'BRA Rice')?.slice(3) ?? [];
  check(`  printed: bags ${[braRow[5], braRow[9], braRow[12], braRow[14], braRow[23]].join(' / ')}, kgs ${[braRow[6], braRow[10], braRow[13], braRow[15], braRow[24]].join(' / ')}`,
    J([braRow[5], braRow[9], braRow[12], braRow[14], braRow[23]]) === J(['0', '259', '259', '259', '0']) && J([braRow[6], braRow[10], braRow[13], braRow[15], braRow[24]]) === J(['0', '12557', '12557', '12557', '0']));
  check('  the Automatic PV and another period: BRA Rice untouched',
    PC.pvCommMapWithCorrection(10, quarter.months, map10b, 'auto').BRA === bra10 && PC.pvCommMapWithCorrection(10, quarterByIndex(2026, 2).months, map10b, 'manual') === map10b);
  const g10 = { ss50: { opening: 1156, receipt: 901, total: 2057, issues: 0, closing: 2057 }, poly: { opening: 3, receipt: 68, total: 71, issues: 71, closing: 0 }, cbox: { opening: 0, receipt: 219, total: 219, issues: 219, closing: 0 } };
  const g10snap = J(g10);
  const pv10 = PC.pvGunnyWithCorrection(10, quarter.months, g10, 'manual');
  check(`CRS 10 Manual PV, POLYTHENE ${J(tuple(pv10.poly))} = 3 + 73 = 76 − 76 = 0; C.BOX ${J(tuple(pv10.cbox))} = 0 + 221 = 221 − 221 = 0`,
    J(tuple(pv10.poly)) === J([3, 73, 76, 76, 0]) && J(tuple(pv10.cbox)) === J([0, 221, 221, 221, 0]));
  check('  50 KG SS GUNNY as it was, the input untouched', pv10.ss50 === g10.ss50 && J(g10) === g10snap);
  const p10 = printed(pv10);
  check(`  printed: POLYTHENE ${J(p10.POLYTHENE)}, C.BOX ${J(p10['C.BOX'])}`, J(p10.POLYTHENE.slice(1)) === J([3, 73, 76, 76, 0]) && J(p10['C.BOX'].slice(1)) === J([0, 221, 221, 221, 0]));
  check('  the Automatic PV, another period and another shop: Gunny untouched',
    PC.pvGunnyWithCorrection(10, quarter.months, g10, 'auto') === g10 && PC.pvGunnyWithCorrection(10, quarterByIndex(2026, 2).months, g10, 'manual') === g10 && PC.pvGunnyWithCorrection(11, quarter.months, g10, 'manual') === g10);

  // CRS 15, the July – September 2026 Manual PV (office, 2026-10-07): PHH BRA Rice bags 0 + 178 = 178 − 165 = 13
  // (had 0 + 186 = 186 − 173 = 13), Palm Oil 54 + 190 = 244 − 214 = 30 (had 54 + 189 = 243 − 213 = 30). No kgs move.
  const phh15 = police({ name: 'PHH BRA Rice', open: 0, receipt: 9305, total: 9305, issues: 8689.97, closing: 615.03, free: false, bags: { open: 0, receipt: 186, total: 186, issues: 173, closing: 13 } });
  const palm15 = police({ name: 'Palm Oil', unit: 'LTR', open: 536, receipt: 1890, total: 2426, issues: 2113, closing: 313, free: false, bags: { open: 54, receipt: 189, total: 243, issues: 213, closing: 30 } });
  const wheat15 = police({ name: 'Wheat', open: 100, receipt: 0, total: 100, issues: 50, closing: 50, free: false, bags: { open: 2, receipt: 0, total: 2, issues: 1, closing: 1 } });
  const map15 = { PHH_BRA: phh15, PALM: palm15, WHEAT: wheat15 };
  const snap15 = J(map15);
  const fx15 = PC.pvCommMapWithCorrection(15, quarter.months, map15, 'manual');
  const tup = (b) => [b.open, b.receipt, b.total, b.issues, b.closing];
  check(`CRS 15 Manual PV, PHH BRA Rice bags: ${tup(fx15.PHH_BRA.bags).join(' / ')} = 0 + 178 = 178 − 165 = 13`, J(tup(fx15.PHH_BRA.bags)) === J([0, 178, 178, 165, 13]));
  check(`CRS 15 Manual PV, Palm Oil bags: ${tup(fx15.PALM.bags).join(' / ')} = 54 + 190 = 244 − 214 = 30`, J(tup(fx15.PALM.bags)) === J([54, 190, 244, 214, 30]));
  check('  …their kgs unchanged, Wheat untouched, the input untouched',
    J({ ...fx15.PHH_BRA, bags: undefined, bagsFixed: undefined }) === J({ ...phh15, bags: undefined }) && J({ ...fx15.PALM, bags: undefined, bagsFixed: undefined }) === J({ ...palm15, bags: undefined }) && fx15.WHEAT === wheat15 && J(map15) === snap15);
  const html15 = buildPVTable({ commMap: fx15, periodLabel: 'Q', crsId: 15, crsName: '', gunny: system, billClerk: '', pvOfficer: '', pvDate: '' });
  const row15 = (name) => [...html15.matchAll(/<tr[^>]*>([\s\S]*?)<\/tr>/g)].map((x) => [...x[1].matchAll(/<td[^>]*>([\s\S]*?)<\/td>/g)].map((y) => y[1].replace(/<[^>]+>/g, '').trim())).find((c) => c[1] === name)?.slice(3) ?? [];
  const bk = (v) => [[v[5], v[9], v[12], v[14], v[23]], [v[6], v[10], v[13], v[15], v[24]]];
  const [pb, pk] = bk(row15('PHH BRA Rice')); const [ob, ok] = bk(row15('Palm Oil'));
  check(`  printed: PHH BRA bags ${pb.join(' / ')} kgs ${pk.join(' / ')}; Palm Oil bags ${ob.join(' / ')} kgs ${ok.join(' / ')}`,
    J(pb) === J(['0', '178', '178', '165', '13']) && J(pk) === J(['0', '9305', '9305', '8689.970', '615.030']) && J(ob) === J(['54', '190', '244', '214', '30']) && J(ok) === J(['536', '1890', '2426', '2113', '313']));
  check('  the Automatic PV, another period and another shop: untouched',
    PC.pvCommMapWithCorrection(15, quarter.months, map15, 'auto') === map15 && PC.pvCommMapWithCorrection(15, quarterByIndex(2026, 2).months, map15, 'manual') === map15 && PC.pvCommMapWithCorrection(16, quarter.months, map15, 'manual') === map15);

  // CRS 14, the July – September 2026 Manual PV: WHEAT bags 47 + 78 = 125 − 83 = 42 (had 47 + 52 = 99 − 57 = 42);
  // BRA Rice (an earlier request, withdrawn the same day) untouched.
  const wheat14 = police({ name: 'Wheat', open: 2400, receipt: 2620, total: 5020, issues: 2920, closing: 2100, bags: { open: 47, receipt: 52, total: 99, issues: 57, closing: 42 } });
  const bra14 = police({ name: 'BRA Rice', open: 3250, receipt: 26448, total: 29698, issues: 27672.67, closing: 2000.33, shortage: 25, bags: { open: 65, receipt: 529, total: 594, issues: 553, closing: 41 } });
  const map14 = { BRA: bra14, WHEAT: wheat14 };
  const snap14 = J(map14);
  const m14 = PC.pvCommMapWithCorrection(14, quarter.months, map14, 'manual');
  const g14 = m14.WHEAT.bags;
  check(`CRS 14 Manual PV, Wheat bags: ${g14.open} + ${g14.receipt} = ${g14.total} − ${g14.issues} = ${g14.closing}`, J([g14.open, g14.receipt, g14.total, g14.issues, g14.closing]) === J([47, 78, 125, 83, 42]));
  check('  …its kgs unchanged, BRA Rice untouched (65 / 529 / 594 / 553 / 41), the input map untouched',
    J({ ...m14.WHEAT, bags: undefined, bagsFixed: undefined }) === J({ ...wheat14, bags: undefined }) && m14.BRA === bra14 && J(map14) === snap14);
  const rowOf14 = (name) => [...buildPVTable({ commMap: m14, periodLabel: 'Q', crsId: 14, crsName: '', gunny: system, billClerk: '', pvOfficer: '', pvDate: '' }).matchAll(/<tr[^>]*>([\s\S]*?)<\/tr>/g)]
    .map((x) => [...x[1].matchAll(/<td[^>]*>([\s\S]*?)<\/td>/g)].map((y) => y[1].replace(/<[^>]+>/g, '').trim())).find((r) => r.includes(name))?.slice(3) ?? [];
  const p14 = rowOf14('Wheat');
  const b14 = rowOf14('BRA Rice');
  check(`  printed Wheat: Opening ${p14[5]} / ${p14[6]} · Receipt ${p14[9]} / ${p14[10]} · Total ${p14[12]} / ${p14[13]} · Issues ${p14[14]} / ${p14[15]} · Balance ${p14[23]} / ${p14[24]}`,
    J([p14[5], p14[9], p14[12], p14[14], p14[23]]) === J(['47', '78', '125', '83', '42']) && J([p14[6], p14[10], p14[13], p14[15], p14[24]]) === J(['2400', '2620', '5020', '2920', '2100']));
  check(`  printed BRA Rice as before: ${[b14[5], b14[9], b14[12], b14[14], b14[23]].join(' / ')}`, J([b14[5], b14[9], b14[12], b14[14], b14[23]]) === J(['65', '529', '594', '553', '41']));
  check('  the Automatic PV and other periods / shops untouched',
    PC.pvCommMapWithCorrection(14, quarter.months, map14, 'auto') === map14 && PC.pvCommMapWithCorrection(14, quarterByIndex(2026, 2).months, map14, 'manual') === map14 && PC.pvCommMapWithCorrection(13, quarter.months, map14, 'manual') === map14);

  const { execSync } = await import('node:child_process');
  const users = execSync("git grep -l -e \"from '@/lib/engine/pvCorrections'\" -e \"from './pvCorrections'\" -- src", { cwd: root, encoding: 'utf8' }).trim().split(/\r?\n/).sort();
  check(`nothing but the PV's Reports page imports it: ${users.join(', ')}`, J(users) === J(['src/app/(app)/reports/page.tsx']));
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
