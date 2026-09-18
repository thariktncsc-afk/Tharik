/**
 * Payment Access Control rules (src/lib/payments/gate.ts), as executable cases.
 *
 *   node tools/verify-payment-gate.mjs
 *
 * The server asks gateRequired() in /api/statements/render (authorise), in
 * /api/payments/access and before creating an order, so these are the answers
 * a shop user actually gets — whatever the page shows.
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
const P = await import(pathToFileURL(join(root, 'src/lib/payments/gate.ts')).href);

let failures = 0;
const check = (label, ok, detail = '') => {
  if (ok) console.log(`  ok    ${label}`);
  else {
    failures++;
    console.log(`  FAIL  ${label}${detail ? `\n        ${detail}` : ''}`);
  }
};

console.log('\nDefaults — nothing changes until an administrator switches');
{
  const g = P.readGate(undefined);
  check('no record: DSS payment required (as before)', P.gateRequired(g, 10, 'dss'));
  check('no record: Statement payment required (as before)', P.gateRequired(g, 10, 'statement'));
  check('a shop with only one kind set keeps the other required', P.gateRequired(P.readGate({ shops: { 11: { dss: false } } }), 11, 'statement'));
  check('garbage record reads as "required"', P.gateRequired(P.readGate('x'), 3, 'dss') && P.gateRequired(P.readGate({ shops: 5 }), 3, 'dss'));
}

console.log('\nIndependent switches per shop and kind');
{
  let g = P.readGate(undefined);
  ({ next: g } = P.applyGate(g, [{ crsId: 11, kind: 'dss', required: false }], 'admin', 'now'));
  check('CRS 11 DSS OFF → free', !P.gateRequired(g, 11, 'dss'));
  check('… its Statements still required', P.gateRequired(g, 11, 'statement'));
  check('… other shops untouched', P.gateRequired(g, 10, 'dss') && P.gateRequired(g, 12, 'dss'));
  ({ next: g } = P.applyGate(g, [{ crsId: 20, kind: 'dss', required: false }, { crsId: 20, kind: 'statement', required: true }], 'admin', 'now'));
  check('CRS 20: DSS OFF + Statement ON', !P.gateRequired(g, 20, 'dss') && P.gateRequired(g, 20, 'statement'));
  ({ next: g } = P.applyGate(g, [{ crsId: 20, kind: 'dss', required: true }, { crsId: 20, kind: 'statement', required: false }], 'admin', 'now'));
  check('CRS 20: DSS ON + Statement OFF', P.gateRequired(g, 20, 'dss') && !P.gateRequired(g, 20, 'statement'));
}

console.log('\nWhat is recorded as a change');
{
  const g0 = P.readGate(undefined);
  const a = P.applyGate(g0, [{ crsId: 25, kind: 'statement', required: false }], 'admin', 't1');
  check('ON → OFF is one change with from/to', a.changes.length === 1 && a.changes[0].from === true && a.changes[0].to === false, JSON.stringify(a.changes));
  const b = P.applyGate(a.next, [{ crsId: 25, kind: 'statement', required: false }], 'admin', 't2');
  check('switching to what it already is records nothing (no duplicate log rows)', b.changes.length === 0);
  const ids = Array.from({ length: 30 }, (_, i) => i + 1);
  const bulk = P.applyGate(a.next, ids.map((id) => ({ crsId: id, kind: 'statement', required: false })), 'admin', 't3');
  check('bulk OFF for all: 29 changes (CRS 25 was already OFF)', bulk.changes.length === 29, String(bulk.changes.length));
  check('… every shop free for Statements', ids.every((id) => !P.gateRequired(bulk.next, id, 'statement')));
  check('… DSS untouched by a Statement bulk change', ids.every((id) => P.gateRequired(bulk.next, id, 'dss')));
  check('the record names who and when', bulk.next.by === 'admin' && bulk.next.at === 't3');
  check('the input record is not mutated', P.gateRequired(a.next, 1, 'statement'));
}

console.log(failures ? `\n${failures} FAILED` : '\nPAYMENT GATE OK');
process.exitCode = failures ? 1 : 0;
