/**
 * The activity log's rules, as executable cases.
 *
 *   node tools/verify-activity-log.mjs
 *
 * src/lib/activityLog/core.ts decides, for every write through /api/state and
 * every approval, payment and document action, what the log says: which shop,
 * which DATE THE DATA BELONGS TO (never the clock), which module, whether the
 * person did it or the system recalculated it because of what they did, and
 * what changed from what to what.
 *
 * The reported shapes are here: CRS 7 updating the 1 Sep sheet (entry date 1
 * Sep, whatever day it is done on), sales 100 → 150 and remittance ₹1,000 →
 * ₹1,500, later days' Opening re-carried as System Update rather than as if
 * keyed by hand, and nothing logged twice for a save of identical content.
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

const L = await import(pathToFileURL(join(root, 'src/lib/activityLog/core.ts')).href);

let failures = 0;
const check = (label, ok, detail = '') => {
  if (ok) console.log(`  ok    ${label}`);
  else {
    failures++;
    console.log(`  FAIL  ${label}${detail ? `\n        ${detail}` : ''}`);
  }
};
const clone = (v) => JSON.parse(JSON.stringify(v));
const has = (d, label, before, after) => (d?.changes ?? []).some((c) => c.label === label && c.before === before && c.after === after);
const show = (v) => JSON.stringify(v);

const row = (open, sales, extra = {}) => {
  const receipt = extra.receipt ?? 0;
  const total = open + receipt;
  return { open, receipt, total, sales, close: total - sales, amount: extra.amount ?? 0, excess: 0, shortage: 0, transfer: 0 };
};
const day = (bra, remit, extra = {}) => ({ a: { BRA: bra }, b: {}, remitAmount: remit, remitDate: '2026-09-01', remits: [{ id: 'r1', amount: remit, date: '2026-09-01' }], ...extra });

console.log('\nDaily Sales — the reported shapes');
{
  const before = { entryStore: { '7_2026-09-01': day(row(1000, 100), 1000), '7_2026-09-02': day(row(900, 50), 500) } };
  const after = clone(before);
  after.entryStore['7_2026-09-01'] = day(row(1000, 150), 1500);
  after.entryStore['7_2026-09-02'] = day(row(850, 50), 500); // re-carried: 1000 − 150
  const drafts = L.diffStateWrite(before, after, { entryStore: { '7_2026-09-01': 'edited' } });
  const edited = drafts.find((d) => d.recordKey === '7_2026-09-01');
  const carried = drafts.find((d) => d.recordKey === '7_2026-09-02');

  check('updating the 1 Sep sheet is logged against CRS 7 with ENTRY date 1 Sep', edited?.crsId === 7 && edited?.entryDate === '2026-09-01', show(edited));
  check('...as a person’s Daily Sales update', edited?.module === 'Daily Sales' && edited?.action === 'updated' && edited?.source === 'user');
  check('...showing BRA Rice Sales 100 → 150', has(edited, 'BRA Rice · Sales', '100', '150'));
  check('...and the deposit itself, Remittance 1 · Amount ₹1,000.00 → ₹1,500.00', has(edited, 'Remittance 1 · Amount', '₹1,000.00', '₹1,500.00'), show(edited));
  check('...with the day total alongside', has(edited, 'Remittance total', '₹1,000.00', '₹1,500.00'));
  check('the later day whose Opening was re-carried is a System Update, not a person’s edit',
    carried?.action === 'recalculated' && carried?.source === 'system' && L.ACTION_LABEL[carried.action] === 'System Update', show(carried));
  check('...with its Opening 900 → 850 in the detail', has(carried, 'BRA Rice · Opening', '900', '850'));
  check('two records changed, two rows — no more', drafts.length === 2);

  check('saving identical content logs nothing — no duplicates from a re-save or a sync', L.diffStateWrite(before, clone(before)).length === 0);

  const unhinted = L.diffStateWrite(before, after);
  check('without the browser’s hint, a Sales change is still the person’s', unhinted.find((d) => d.recordKey === '7_2026-09-01')?.source === 'user');

  const created = L.diffStateWrite({ entryStore: {} }, { entryStore: { '7_2026-09-16': day(row(125, 20), 2000) } });
  check('a new sheet is Created, with what it held and a blank before', created[0]?.action === 'created' && has(created[0], 'BRA Rice · Sales', '—', '20') && has(created[0], 'Remittance 1 added', '—', '₹2,000.00 · 01-09-2026'), show(created[0]));
  check('...and no zero figures listed', !created[0]?.changes.some((c) => c.after === '0'));

  const deleted = L.diffStateWrite({ entryStore: { '7_2026-09-16': day(row(125, 20), 2000) } }, { entryStore: {} });
  check('a removed sheet is Deleted, with what it held', deleted[0]?.action === 'deleted' && has(deleted[0], 'BRA Rice · Sales', '20', '—'));

  const remitOnly = clone(before);
  remitOnly.entryStore['7_2026-09-01'] = day(row(1000, 100), 1200);
  const r = L.diffStateWrite(before, remitOnly, { entryStore: { '7_2026-09-01': 'edited' } });
  check('a change to the remittance alone is logged under Remittance', r[0]?.module === 'Remittance' && r[0]?.action === 'updated');

  const adminOpening = clone(before);
  adminOpening.entryStore['7_2026-09-01'] = day(row(1100, 100), 1000);
  const a = L.diffStateWrite(before, adminOpening, { entryStore: { '7_2026-09-01': 'edited' } });
  check('an Opening keyed by the person on the day they edited is theirs, not the system’s', a[0]?.source === 'user' && a[0]?.action === 'updated');

  const rice = L.diffStateWrite({ entryStore: { '29_2026-09-01': day(row(0, 0), 0, { freeRice: 10, costRice: 5 }) } },
    { entryStore: { '29_2026-09-01': day(row(0, 0), 0, { freeRice: 12, costRice: 5 }) } });
  check('CRS 29 Free Rice is a keyed figure: 10 → 12', rice[0]?.source === 'user' && has(rice[0], 'Free Rice', '10', '12'));
}

console.log('\nWhat is never logged as a day');
{
  const proj = { a: { BRA: row(0, 0) }, b: {}, __projection: { source: 'monthly', at: 'x' } };
  const gen = L.diffStateWrite({ entryStore: {} }, { entryStore: { '7_2026-09-30': proj } });
  check('a month-close projection is Monthly Entry’s output, not a day: one automatic "generated" row', gen.length === 1 && gen[0].module === 'Monthly Entry' && gen[0].action === 'generated' && gen[0].source === 'system' && !gen[0].changes.length, show(gen));
  check('...nor is its removal', L.diffStateWrite({ entryStore: { '7_2026-09-30': proj } }, { entryStore: {} }).length === 0);
  const converted = L.diffStateWrite({ entryStore: { '7_2026-09-30': proj } }, { entryStore: { '7_2026-09-30': day(row(0, 10), 100) } });
  check('a projection turned into a real day sheet is a Created day', converted[0]?.action === 'created' && converted[0]?.module === 'Daily Sales');
  check('monthlyStore and meSourceStore (published by the roll-up) are never logged',
    L.diffStateWrite({ monthlyStore: { a: 1 }, meSourceStore: { a: 1 } }, { monthlyStore: { a: 2 }, meSourceStore: { a: 2 } }).length === 0);
  check('counters are never logged', L.diffStateWrite({ __counters: { rpNextId: 1 } }, { __counters: { rpNextId: 2 } }).length === 0);
  check('projected inspection adjustments are the month-close’s', L.diffStateWrite({ inspectionStore: {} }, { inspectionStore: { '7_2026-09-30': { a: { BRA: { shortage: 5, __projection: true } } } } }).length === 0);
}

console.log('\nOther modules');
{
  const rec = { id: 41, crsId: 19, date: '2026-09-12', receiptNo: 'R/41', items: { BRA: { qty: 500 } } };
  const created = L.diffStateWrite({ receiptStore: [] }, { receiptStore: [rec] });
  check('a receipt added at CRS 19 is Receipt · Created, dated the receipt’s date', created[0]?.module === 'Receipt' && created[0]?.crsId === 19 && created[0]?.entryDate === '2026-09-12' && created[0]?.action === 'created', show(created[0]));
  check('...with its quantity', created[0]?.changes.some((c) => c.label.startsWith('BRA Rice') && c.after === '500'), show(created[0]?.changes));
  const gone = L.diffStateWrite({ receiptStore: [rec] }, { receiptStore: [] });
  check('a deleted receipt is Deleted', gone[0]?.action === 'deleted');
  const gen = L.diffStateWrite({ receiptStore: [] }, { receiptStore: [{ ...rec, id: 42, source: 'monthly-entry' }] });
  check('the register row Monthly Entry writes is the system’s', gen[0]?.source === 'system');

  const insp = L.diffStateWrite({ inspectionStore: {} }, { inspectionStore: { '7_2026-09-05': { a: { BRA: { shortage: 12 } } } } });
  check('an inspection is Inspection · Created on its date', insp[0]?.module === 'Inspection' && insp[0]?.entryDate === '2026-09-05' && has(insp[0], 'BRA Rice · Shortage', '—', '12'));

  const mrec = { open: 1000, receipt: 0, total: 1000, sales: 400, close: 600, amount: 0 };
  const closed = L.diffStateWrite({ meManualStore: {} }, { meManualStore: { '7_9_2026': { a: { BRA: mrec }, b: {} } } }, { meManualStore: { '7_9_2026': 'closed' } });
  check('Monthly Entry’s month-close is Monthly Entry · Closed for Sep 2026', closed[0]?.action === 'closed' && closed[0]?.entryMonth === 9 && closed[0]?.entryYear === 2026 && L.entryLabel(closed[0]) === 'Sep 2026');
  const reconciled = L.diffStateWrite({ meManualStore: { '7_9_2026': { a: { BRA: mrec }, b: {} } } }, { meManualStore: { '7_9_2026': { a: { BRA: { ...mrec, receipt: 50, total: 1050, close: 650 } }, b: {} } } });
  check('a register reconcile moving only Receipt / Total / Closing is a System Update', reconciled[0]?.source === 'system' && reconciled[0]?.action === 'recalculated');

  const sc = L.diffStateWrite({ salesCloseStore: {} }, { salesCloseStore: { '7_9_2026': { date: '2026-09-29', gunny: 3, poly: 1, cbox: 0 } } });
  check('Monthly Sales Close is Sales Close · Closed, dated the last sales day', sc[0]?.module === 'Sales Close' && sc[0]?.action === 'closed' && sc[0]?.entryDate === '2026-09-29');

  const gunny = L.diffStateWrite({ meGunnyStore: {} }, { meGunnyStore: { '7_9_2026': { GUNNY: { receipt: 10 } } } });
  check('a month store change names its module and month', gunny[0]?.module === 'Gunny' && gunny[0]?.entryMonth === 9 && gunny[0]?.crsId === 7);

  const master = L.diffStateWrite({ __holidays: ['2026-01-26'] }, { __holidays: ['2026-01-26', '2026-08-15'] });
  check('a master change is Masters · Updated', master[0]?.module === 'Masters' && master[0]?.action === 'updated');

  const req = { id: 12, crsId: 7, storeKeys: ['7_2026-09-01'], scopeKind: 'day', scopeLabel: '1 Sep 2026', reason: 'Keyed wrong', requestedBy: 'crs7',
    snapshot: { entryStore: { '7_2026-09-01': day(row(1000, 100), 1000) } } };
  const asked = L.clearRequestDraft(req, 'requested');
  check('a clear request is Clear Request · Requested for the day it covers', asked.module === 'Clear Request' && asked.entryDate === '2026-09-01' && asked.relatedId === '12');
  const cleared = L.clearedDrafts(req, [{ store: 'entryStore', key: '7_2026-09-01' }, { store: 'monthlyStore', key: '7_9_2026' }], ['7_2026-09-02']);
  check('an approved clear logs the day as Cleared with what it held, by the approver', cleared[0]?.action === 'cleared' && cleared[0]?.module === 'Daily Sales' && has(cleared[0], 'BRA Rice · Sales', '100', '—'));
  check('...skips the derived month it republished', !cleared.some((d) => d.recordKey === '7_9_2026'));
  check('...and logs the re-carried day as a System Update', cleared.some((d) => d.recordKey === '7_2026-09-02' && d.source === 'system'));

  const order = { id: 3, orderNo: 'PAY-20260917-00003', crsId: 7, kind: 'statement', month: 9, year: 2026, sheetCount: 13, dayCount: 0, totalPaise: 52000, utr: '123456789012' };
  const paid = L.paymentDraft(order, 'submitted');
  check('a submitted payment names the order, amount and UTR', paid.module === 'Payment' && has(paid, 'Amount', '', '₹520.00') && has(paid, 'UTR', '', '123456789012'));

  const moved = L.userDraft({ id: 5, username: 'crs7', full_name: 'Divya', role: 'BC', crs_id: 7, active: true }, { id: 5, username: 'crs19', full_name: 'Divya', role: 'BC', crs_id: 19, active: true });
  check('a transfer is Users · Updated, CRS 7 → CRS 19', moved?.action === 'updated' && has(moved, 'Shop', 'CRS 7', 'CRS 19') && moved.summary.includes('CRS 7 → CRS 19'));
}

console.log('\nWording and scope');
{
  check('the dashboard line reads module · shop · entry date — action',
    L.feedLine({ module: 'Daily Sales', crsId: 7, action: 'updated', entryDate: '2026-09-16', entryMonth: null, entryYear: null }) === 'Daily Sales · CRS 7 · 16-09-2026 — Updated');
  check('roles are named as the office names them', L.roleLabel('BC') === 'BC' && L.roleLabel('Packer') === 'Packer' && L.roleLabel('ADMIN') === 'Admin');
  const feed = [{ crsId: 7 }, { crsId: 19 }, { crsId: null }];
  check('a shop user’s feed holds its own shop only — no unattributed rows', L.scopeFeed(feed, 7).length === 1 && L.scopeFeed(feed, 7)[0].crsId === 7);
  check('an administrator’s feed holds everything', L.scopeFeed(feed, null).length === 3);
  const hints = L.readHints({ edited: { entryStore: { '7_2026-09-01': 'edited', x: 'drop table' }, meManualStore: { '7_9_2026': 'closed' }, junk: 5 } });
  check('edit hints are accepted only in their exact shape', JSON.stringify(hints) === JSON.stringify({ entryStore: { '7_2026-09-01': 'edited' }, meManualStore: { '7_9_2026': 'closed' } }), JSON.stringify(hints));
}


console.log('\nRemittance deposits, admin corrections, shops, carry-forward wording');
{
  const base = (remits) => ({ a: { BRA: row(100, 10) }, b: {}, remits });
  const r1 = { id: 'r1', amount: 500, date: '2026-09-16' };
  const r2 = { id: 'r2', amount: 40, date: '2026-09-16', reason: 'Tea' };
  const edit = L.diffStateWrite({ entryStore: { '7_2026-09-16': base([r1, r2]) } }, { entryStore: { '7_2026-09-16': base([{ ...r1, date: '2026-09-17' }, { ...r2, reason: 'Salt' }]) } });
  check('a remittance-only change is under Remittance', edit[0]?.module === 'Remittance', show(edit));
  check('...naming the date change on deposit 1', has(edit[0], 'Remittance 1 · Date', '16-09-2026', '17-09-2026'));
  check('...and the reason change on deposit 2', has(edit[0], 'Remittance 2 (Salt) · Reason', 'Tea', 'Salt'));
  const removed = L.diffStateWrite({ entryStore: { '7_2026-09-16': base([r1, r2]) } }, { entryStore: { '7_2026-09-16': base([r1]) } });
  check('a removed deposit is its own line', has(removed[0], 'Remittance 2 (Tea) removed', '₹40.00 · 16-09-2026', '—'), show(removed));

  const fixed = L.diffStateWrite({ entryStore: { '7_2026-09-16': { a: { BRA: row(100, 10) }, b: {} } } }, { entryStore: { '7_2026-09-16': { a: { BRA: { ...row(120, 10), openFixed: true } }, b: {} } } });
  check('an administrator fixing an Opening is a person’s update, marked as a correction', fixed[0]?.source === 'user' && has(fixed[0], 'BRA Rice · Opening correction', 'Carried', 'Fixed'), show(fixed));

  const carried = L.diffStateWrite(
    { entryStore: { '7_2026-09-16': { a: { BRA: row(100, 10) }, b: {} }, '7_2026-09-17': { a: { BRA: row(90, 5) }, b: {} } } },
    { entryStore: { '7_2026-09-16': { a: { BRA: row(100, 20) }, b: {} }, '7_2026-09-17': { a: { BRA: row(80, 5) }, b: {} } } },
    { entryStore: { '7_2026-09-16': 'edited' } },
  );
  const sys = carried.find((d) => d.recordKey === '7_2026-09-17');
  check('the re-carried day reads "Opening carried forward from 16-09-2026 Closing to 17-09-2026 Opening"', sys?.source === 'system' && /^Opening carried forward from 16-09-2026 Closing to 17-09-2026 Opening/.test(sys.summary), show(sys));

  const shopsBefore = [{ name: 'A', active: true }, { name: 'B', active: false }];
  const shopsAfter = [{ name: 'A', active: true }, { name: 'B', active: true }];
  const t = L.diffStateWrite({ __shops: shopsBefore }, { __shops: shopsAfter });
  check('a shop made active is one CRS Shops row for that shop — no duplicate Masters row', t.length === 1 && t[0].module === 'CRS Shops' && t[0].crsId === 2 && t[0].action === 'activated', show(t));
  const m = L.diffStateWrite({ __crsMaster: [{ id: 13, status: 'active' }] }, { __crsMaster: [{ id: 13, status: 'no_usage' }] });
  check('CRS Master no_usage is a deactivation of CRS 13', m.length === 1 && m[0].action === 'deactivated' && m[0].crsId === 13, show(m));

  const msg = L.messageDraft({ id: 5, title: 'Stock check', audience: 'CRS 7 · BC & Packer', recipients: 2, priority: 'normal' });
  check('an admin message is a Notifications "sent" row', msg.module === 'Notifications' && msg.action === 'sent' && /Stock check/.test(msg.summary));
  const pv = L.documentDraft({ module: 'Reports', action: 'printed', crsId: 7, month: 7, year: 2026, report: 'Quarterly PV (3-Month)', period: 'Jul–Sep 2026' });
  check('a printed PV names the report and period', pv.module === 'Reports' && has(pv, 'Report', '', 'Quarterly PV (3-Month)') && has(pv, 'Period', '', 'Jul–Sep 2026'));
}

console.log(`\n${failures ? `${failures} FAILED` : 'ACTIVITY LOG OK'}`);
process.exitCode = failures ? 1 : 0;
