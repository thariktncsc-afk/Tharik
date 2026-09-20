/**
 * Who may change a remittance, and what a correction does — as executable cases.
 *
 *   node tools/verify-remittance-admin.mjs
 *
 * Three things are under test.
 *
 * src/lib/stockGuard.ts — the rule /api/state actually enforces: a shop user
 * may ADD deposits, but a deposit already in the database keeps its amount,
 * date, account and reason, and stays there. An administrator may do all of
 * it. The screens only mirror this; the refusal is the server's.
 *
 * src/lib/engine/remittance.ts — an administrator's correction: the account
 * and the reason as ONE choice that cannot contradict itself, and the day
 * sheet's own totals (what the statements read) recomputed from the deposits.
 *
 * And the arithmetic the office asked for: the total for a sales date is the
 * sum of every deposit on it, however many there are and whatever accounts
 * they went into.
 *
 * Runs the TypeScript source directly (Node >= 23.6 strips types).
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

let failures = 0;
const check = (label, ok, detail = '') => {
  if (ok) console.log(`  ok    ${label}`);
  else {
    failures++;
    console.log(`  FAIL  ${label}${detail ? `\n        ${detail}` : ''}`);
  }
};

const R = await import(pathToFileURL(join(root, 'src/lib/engine/remittance.ts')).href);
const G = await import(pathToFileURL(join(root, 'src/lib/stockGuard.ts')).href);

const DATE = '2026-09-16';
const KEY = `7_${DATE}`;
const txn = (id, amount, date, extra = {}) => ({ id, amount, date, account: 'nc', ...extra });
/** A day sheet whose figures are consistent, so only the remittance rules can speak. */
const sheet = (remits) => ({
  a: { BRA: { open: 100, receipt: 0, total: 100, sales: 40, close: 60, amount: 0 } },
  b: {},
  remits,
  ...R.sheetTotals(remits),
});
/** What /api/state would say about this write. */
const violations = (before, after, isAdmin) =>
  G.inspectStockWrite({ entryStore: { [KEY]: before } }, { entryStore: { [KEY]: after } }, isAdmin).map((v) => v.kind);
const remitOnly = (kinds) => kinds.filter((k) => k === 'remittance-locked').length;

const one = txn('rm_1', 2000, '2026-09-16');
const two = txn('rm_2', 1500, '2026-09-17', { reason: 'Missed' });
const saved = sheet([one, two]);

console.log('\nA shop user and a saved remittance');
{
  check('adding another deposit is the existing workflow and passes',
    remitOnly(violations(saved, sheet([one, two, txn('rm_3', 500, '2026-09-17', { reason: 'Tea' })]), false)) === 0);
  check('changing a saved amount is refused',
    remitOnly(violations(saved, sheet([{ ...one, amount: 2500 }, two]), false)) === 1);
  check('changing a saved deposit DATE is refused',
    remitOnly(violations(saved, sheet([{ ...one, date: '2026-09-18' }, two]), false)) === 1);
  check('changing a saved account is refused',
    remitOnly(violations(saved, sheet([{ ...one, account: 'ce' }, two]), false)) === 1);
  check('changing a saved reason is refused',
    remitOnly(violations(saved, sheet([one, { ...two, reason: 'Salt' }]), false)) === 1);
  check('REMOVING a saved deposit is refused — no deleting it and adding it back',
    remitOnly(violations(saved, sheet([one]), false)) === 1);
  check('…and removing it while adding a replacement is still refused',
    remitOnly(violations(saved, sheet([one, txn('rm_9', 1500, '2026-09-20')]), false)) === 1);
  check('the refusal says what it was and who may do it',
    G.inspectStockWrite({ entryStore: { [KEY]: saved } }, { entryStore: { [KEY]: sheet([one]) } }, false)
      .some((v) => /removed/.test(v.detail) && /administrator/.test(v.detail)));
  check('a deposit this screen has not saved yet is the user’s own to take back',
    remitOnly(violations(sheet([one]), sheet([one]), false)) === 0 &&
      remitOnly(violations(undefined, sheet([one]), false)) === 0);
  check('saving the day again unchanged says nothing', remitOnly(violations(saved, saved, false)) === 0);
}

console.log('\nAn administrator');
{
  for (const [what, after] of [
    ['amount', sheet([{ ...one, amount: 2500 }, two])],
    ['date', sheet([{ ...one, date: '2026-09-18' }, two])],
    ['account', sheet([{ ...one, account: 'ce' }, two])],
    ['removal', sheet([one])],
    ['everything at once', sheet([{ ...one, amount: 1, date: '2026-09-30', account: 'ce' }])],
  ]) {
    check(`may correct the ${what}`, remitOnly(violations(saved, after, true)) === 0);
  }
}

console.log('\nAccount and reason are one choice');
{
  check('a reason always lands in Non-Cereal', R.applyRemitType(txn('x', 500, DATE, { account: 'ce' }), 'Tea').account === 'nc');
  const ce = R.applyRemitType(txn('x', 500, DATE, { reason: 'Tea' }), 'ce');
  check('choosing an account clears the reason', ce.account === 'ce' && !('reason' in ce), JSON.stringify(ce));
  check('…so "Cereal with a reason" cannot be produced', !R.REMIT_REASONS.some((r) => {
    const t = R.applyRemitType(txn('x', 1, DATE), r);
    return t.account === 'ce' || !t.reason;
  }));
  check('a stored deposit reads back as the type it was given',
    R.remitTypeOf(R.applyRemitType(txn('x', 1, DATE), 'ce')) === 'ce' && R.remitTypeOf(R.applyRemitType(txn('x', 1, DATE), 'Salt')) === 'Salt');
  check('the type list is what the screens offer', R.REMIT_TYPE_LABEL.nc === 'Non-Cereal A/C' && R.REMIT_TYPE_LABEL.ce === 'Cereal A/C');
}

console.log('\nThe office’s example — three deposits on 16-09-2026');
{
  // Non-Cereal ₹2,000 + Non-Cereal ₹1,500 (additional) + Cereal ₹500.
  const list = [
    txn('rm_1', 2000, DATE),
    R.applyRemitType(txn('rm_2', 1500, DATE), 'Missed'),
    R.applyRemitType(txn('rm_3', 500, DATE), 'ce'),
  ];
  const t = R.sheetTotals(list);
  check('they stay three separate records', list.length === 3 && new Set(list.map((x) => x.id)).size === 3);
  check('date total = ₹4,000 — every deposit on the date, whatever the account', t.remitAmount === 4000, JSON.stringify(t));
  check('Non-Cereal = ₹3,500 (the additional one counts there, by rule)', t.remitNonCereal === 3500);
  check('Cereal = ₹500', t.remitCereal === 500);
  check('the sheet’s remittance date is the earliest deposit', t.remitDate === DATE);

  const rows = R.txnsOf(sheet(list), DATE);
  check('the monthly table shows three rows for the date', rows.length === 3);
  check('…the Cereal one as money, the additional one as its reason',
    JSON.stringify(rows.map(R.amounts)) === JSON.stringify([{ nc: 2000, ce: 0 }, { nc: 1500, ce: 0 }, { nc: 0, ce: 500 }]),
    JSON.stringify(rows.map(R.amounts)));
}

console.log('\nCorrecting never duplicates');
{
  const before = [txn('rm_1', 2000, DATE), R.applyRemitType(txn('rm_2', 1500, DATE), 'Missed')];
  // What the screens do: read the sheet, map by id, write it back.
  const read = R.txnsOf(sheet(before), DATE).map(R.toTxn);
  const corrected = read.map((t) => (t.id === 'rm_1' ? R.applyRemitType({ ...t, amount: 2855, date: '2026-09-17' }, 'nc') : t));
  check('an edit rewrites the same row, never adds one', corrected.length === 2 && corrected[0].id === 'rm_1');
  check('…and the day’s total follows it', R.sheetTotals(corrected).remitAmount === 4355);
  check('…and the sheet’s remittance date follows the earliest that remains', R.sheetTotals(corrected).remitDate === DATE);
  check('reading and writing back unchanged changes nothing', JSON.stringify(read) === JSON.stringify(before), JSON.stringify(read));

  // A sheet saved before deposits had ids: read back as one deposit, not lost.
  const legacy = { a: {}, b: {}, remitAmount: 900, remitDate: '2026-09-02' };
  const fromLegacy = R.txnsOf(legacy, DATE).map(R.toTxn);
  check('a pre-ids sheet converts to one deposit with the same money', fromLegacy.length === 1 && fromLegacy[0].amount === 900 && fromLegacy[0].date === '2026-09-02');
  check('…and its total is unchanged by the conversion', R.sheetTotals(fromLegacy).remitAmount === 900);
}

console.log('\nWho may press ✕ on screen');
{
  const savedIds = R.savedRemitIds(sheet([one, two]), DATE);
  check('the saved ids are the sheet’s deposits', savedIds.has('rm_1') && savedIds.has('rm_2') && savedIds.size === 2);
  check('a shop user may not remove a saved deposit', !R.canRemoveRemit(false, savedIds, 'rm_1'));
  check('…but may take back one just added', R.canRemoveRemit(false, savedIds, 'rm_new'));
  check('an administrator may remove either', R.canRemoveRemit(true, savedIds, 'rm_1') && R.canRemoveRemit(true, savedIds, 'rm_new'));
  check('a day with nothing saved locks nothing', R.savedRemitIds(undefined, DATE).size === 0);
}

console.log(failures ? `\n${failures} FAILED` : '\nREMITTANCE ADMIN OK');
process.exitCode = failures ? 1 : 0;
