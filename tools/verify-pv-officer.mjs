/**
 * PV officer assignment rules.
 *
 *   node tools/verify-pv-officer.mjs
 *
 * The two that matter most: every shop resolves to exactly one officer (a shop
 * in no group prints a blank line on its statutory form, one in two resolves
 * arbitrarily), and a per-shop date overrides its group's without the group's
 * date leaking back.
 */
import { register } from 'node:module';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const srcUrl = pathToFileURL(join(root, 'src') + '/').href;
register(
  `data:text/javascript,${encodeURIComponent(`
export async function resolve(spec, ctx, next) {
  if (spec.startsWith('@/')) return next(${JSON.stringify(srcUrl)} + spec.slice(2) + '.ts', ctx);
  return next(spec, ctx);
}`)}`,
  import.meta.url,
);

const O = await import(pathToFileURL(join(root, 'src/lib/engine/pvOfficer.ts')).href);

let failures = 0;
const check = (label, ok, detail = '') => {
  if (ok) console.log(`  ok    ${label}`);
  else {
    failures++;
    console.log(`  FAIL  ${label}${detail ? `\n        ${detail}` : ''}`);
  }
};

console.log('the default grouping covers every shop exactly once');
const base = O.emptyStore();
check('six groups', base.groups.length === 6, String(base.groups.length));
check('30 shops in total', base.groups.flatMap((g) => g.crsIds).length === 30);
check('no shop is in two groups', O.duplicateShops(base).length === 0, O.duplicateShops(base).join(','));
check('no shop is left out of every group', O.unassignedShops(base, 30).length === 0, O.unassignedShops(base, 30).join(','));
check('the groups match the office list', base.groups.map((g) => g.crsIds.join('-')).join(' | ') === '1-2-3-4-5 | 6-7-8-9-12 | 10-11-14-15-30 | 13-16-24-25-26 | 18-19-20-21-22 | 17-23-27-28-29');

console.log('one officer covers the whole group');
const s = O.emptyStore();
const g1 = s.groups[0];
g1.officerName = 'R. Kumar';
g1.designation = 'Assistant Manager';
g1.pvDate = '2026-09-15';
for (const id of [1, 2, 3, 4, 5]) {
  const r = O.resolveForStatement(s, id);
  check(`CRS ${id} prints "R. Kumar, Assistant Manager" / 15-09-2026`, r.officer === 'R. Kumar, Assistant Manager' && r.date === '15-09-2026', JSON.stringify(r));
}
check('a shop in another group is untouched', O.resolveForStatement(s, 7).officer === '');

console.log('the date can differ per shop, the name cannot');
s.dates['3'] = '2026-09-16';
s.dates['5'] = '2026-09-17';
check('CRS 3 takes its own date', O.resolveForStatement(s, 3).date === '16-09-2026');
check('CRS 5 takes its own date', O.resolveForStatement(s, 5).date === '17-09-2026');
check('CRS 1 still takes the group date', O.resolveForStatement(s, 1).date === '15-09-2026');
check('the officer name is the same for all of them', [1, 3, 5].every((id) => O.resolveForStatement(s, id).officer === 'R. Kumar, Assistant Manager'));
check('an empty override falls back rather than blanking the field', (() => { const t = O.normalise(JSON.parse(JSON.stringify(s))); t.dates['3'] = ''; return O.dateFor(t, 3) === '2026-09-15'; })());

console.log('formatting and partial data');
check('the form wants DD-MM-YYYY', O.fmtPvDate('2026-09-15') === '15-09-2026');
check('a junk date prints nothing, not "NaN"', O.fmtPvDate('') === '' && O.fmtPvDate('rubbish') === '');
check('a name with no designation prints just the name', O.officerLabel({ officerName: 'R. Kumar', designation: '', crsIds: [] }) === 'R. Kumar');
check('an unassigned shop resolves to blanks, not a crash', JSON.stringify(O.resolveForStatement(O.emptyStore(), 99)) === '{"officer":"","date":""}');

console.log('a half-written store still resolves');
check('undefined normalises to the default groups', O.normalise(undefined).groups.length === 6);
check('a stored grouping wins over the shipped default', O.normalise({ groups: [{ id: 'x', label: 'X', crsIds: [1, 2] }], dates: {} }).groups.length === 1);
check('garbage crsIds are dropped, not printed', O.normalise({ groups: [{ id: 'x', label: 'X', crsIds: [1, 'oops', null, 3] }], dates: {} }).groups[0].crsIds.join() === '1,3');
check('a reshuffled group is detected as leaving shops out', O.unassignedShops(O.normalise({ groups: [{ id: 'x', label: 'X', crsIds: [1] }], dates: {} }), 5).join() === '2,3,4,5');

console.log(failures === 0 ? '\nPV OFFICER OK' : `\n${failures} FAILURE(S)`);
process.exit(failures === 0 ? 0 : 1);
