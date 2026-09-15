/**
 * Notifications, as executable cases.
 *
 *   node tools/verify-notifications.mjs
 *
 * src/lib/notify/core.ts holds the parts of the notification system that can
 * be wrong without anything on screen saying so:
 *
 *   - WHO a message reaches. Addressing an admin, a disabled account or a user
 *     with no shop would leave an "unread" in the report nobody can ever clear;
 *     addressing the wrong shop's Packer sends one shop's instructions to
 *     another.
 *   - WHEN something counts as read. The office asked for exact read times, so
 *     a second opening must not move the first, and nothing but the person's
 *     own action may set one.
 *   - WHAT an approval says. The wording is what an administrator decides on.
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

const N = await import(pathToFileURL(join(root, 'src/lib/notify/core.ts')).href);

let failures = 0;
const check = (label, ok, detail = '') => {
  if (ok) console.log(`  ok    ${label}`);
  else {
    failures++;
    console.log(`  FAIL  ${label}${detail ? `\n        ${detail}` : ''}`);
  }
};

const u = (id, fullName, role, crsId, active = true) => ({ id, fullName, role, crsId, active });
const ROSTER = [
  u(1, 'Admin', 'ADMIN', null),
  u(5002, 'Divya', 'BC', 1),
  u(5010, 'Mathavi', 'BC', 7),
  u(5011, 'Balaji', 'Packer', 7),
  u(5030, 'Rahamathullakhan', 'BC', 19),
  u(5031, 'Kumar', 'Packer', 19),
  u(5040, 'Old Packer', 'Packer', 20, false), // disabled
  u(5050, 'Unassigned', 'BC', null), // removed from a shop
  u(5060, 'Ten', 'BC', 10), // must never match CRS 1
];
const ids = (list) => list.map((x) => x.id).join(',');

console.log('\nwho a message reaches');
{
  const all = N.resolveAudience(ROSTER, { mode: 'all' });
  check('"All CRS shops" reaches every active shop user', ids(all) === '5002,5010,5011,5060,5030,5031', ids(all));
  check('...never an administrator', !all.some((x) => x.role === 'ADMIN'));
  check('...never a disabled account', !all.some((x) => x.id === 5040));
  check('...never an account with no shop', !all.some((x) => x.id === 5050));
}
{
  check('one shop, both roles', ids(N.resolveAudience(ROSTER, { mode: 'shop', crsId: 7, roles: ['BC', 'Packer'] })) === '5010,5011');
  check('one shop, BC only', ids(N.resolveAudience(ROSTER, { mode: 'shop', crsId: 7, roles: ['BC'] })) === '5010');
  check('one shop, Packer only', ids(N.resolveAudience(ROSTER, { mode: 'shop', crsId: 19, roles: ['Packer'] })) === '5031');
  check('CRS 1 does not reach CRS 10', ids(N.resolveAudience(ROSTER, { mode: 'shop', crsId: 1, roles: ['BC', 'Packer'] })) === '5002');
}
{
  const many = N.resolveAudience(ROSTER, { mode: 'shops', crsIds: [1, 7, 19], roles: ['BC', 'Packer'] });
  check('ticked shops 1, 7 and 19', ids(many) === '5002,5010,5011,5030,5031', ids(many));
  check('...ordered by shop then role', many.map((x) => `${x.crsId}${x.role[0]}`).join() === '1B,7B,7P,19B,19P');
  check('a shop with only a disabled Packer reaches nobody', N.resolveAudience(ROSTER, { mode: 'shops', crsIds: [20], roles: ['Packer'] }).length === 0);
}
{
  check('all Packers across shops', ids(N.resolveAudience(ROSTER, { mode: 'roles', roles: ['Packer'] })) === '5011,5031');
  check('a chosen user', ids(N.resolveAudience(ROSTER, { mode: 'users', userIds: [5030] })) === '5030');
  check('an administrator cannot be picked as a user', N.resolveAudience(ROSTER, { mode: 'users', userIds: [1] }).length === 0);
  check('the same person picked twice is sent to once', N.resolveAudience(ROSTER, { mode: 'users', userIds: [5030, 5030] }).length === 1);
}

console.log('\nwhat a posted audience may say');
{
  check('an unknown mode is refused', 'error' in N.parseAudience({ mode: 'everyone-including-admins' }));
  check('a shop with no role is refused', 'error' in N.parseAudience({ mode: 'shop', crsId: 7, roles: [] }));
  check('an invented role is dropped', 'error' in N.parseAudience({ mode: 'roles', roles: ['ADMIN'] }));
  check('no shops ticked is refused', 'error' in N.parseAudience({ mode: 'shops', crsIds: [], roles: ['BC'] }));
  const ok = N.parseAudience({ mode: 'shops', crsIds: ['7', 7, 'x', -1, 19], roles: ['BC', 'BC', 'Packer'] });
  check('ids are cleaned and deduplicated', ok.mode === 'shops' && ok.crsIds.join() === '7,19' && ok.roles.join() === 'BC,Packer', JSON.stringify(ok));
}

console.log('\nhow the sent list names the audience');
{
  check('all shops', N.describeAudience({ mode: 'all' }) === 'All CRS shops');
  check('one shop', N.describeAudience({ mode: 'shop', crsId: 1, roles: ['BC', 'Packer'] }) === 'CRS 1 · BC & Packer');
  check('several shops, sorted', N.describeAudience({ mode: 'shops', crsIds: [19, 1, 7], roles: ['Packer'] }) === 'CRS 1, CRS 7, CRS 19 · Packer only');
  check('a long list is shortened', /\+2 more/.test(N.describeAudience({ mode: 'shops', crsIds: [1, 2, 3, 4, 5, 6, 7, 8], roles: ['BC'] })));
}

console.log('\nwhen something counts as read');
{
  const fresh = { deliveredAt: null, openedAt: null, readAt: null, acknowledgedAt: null, isRead: false };
  const T1 = '2026-09-14T15:32:00.000Z';
  const T2 = '2026-09-14T16:15:00.000Z';

  const opened = N.markPatch(fresh, 'open', T1);
  check('opening reads it', opened.read_at === T1 && opened.is_read === true && opened.opened_at === T1);
  check('...and records it as delivered', opened.delivered_at === T1);

  const state = { deliveredAt: T1, openedAt: T1, readAt: T1, acknowledgedAt: null, isRead: true };
  check('opening it again changes nothing', N.markPatch(state, 'open', T2) === null);
  check('...so the first read time stands', N.markPatch(state, 'read', T2) === null);

  const ack = N.markPatch(state, 'acknowledge', T2);
  check('acknowledging later sets only the acknowledgement', ack && ack.acknowledged_at === T2 && !('read_at' in ack), JSON.stringify(ack));

  const direct = N.markPatch(fresh, 'acknowledge', T1);
  check('acknowledging an unopened message reads it', direct.read_at === T1 && direct.acknowledged_at === T1 && !('opened_at' in direct));

  const marked = N.markPatch(fresh, 'read', T1);
  check('"Mark as read" reads it without claiming it was opened', marked.read_at === T1 && !('opened_at' in marked));

  const delivered = { ...fresh, deliveredAt: T1 };
  check('being delivered is not being read', N.readStats([delivered]).read === 0 && N.readStats([delivered]).delivered === 1);
}
{
  const r = (d, rd, a) => ({ deliveredAt: d, openedAt: null, readAt: rd, acknowledgedAt: a, isRead: !!rd });
  const s = N.readStats([r('x', 'x', 'x'), r('x', 'x', null), r('x', null, null), r(null, null, null)]);
  check('the read report adds up', s.recipients === 4 && s.delivered === 3 && s.read === 2 && s.unread === 2 && s.acknowledged === 1, JSON.stringify(s));
}

console.log('\nwhat pops up, and where it is filed');
{
  check('an important message must be acknowledged', N.requiresAck('MESSAGE', 'important'));
  check('an urgent message must be acknowledged', N.requiresAck('MESSAGE', 'urgent'));
  check('a normal message is simply read', !N.requiresAck('MESSAGE', 'normal'));
  check('approval traffic never pops up, whatever its priority', !N.requiresAck('PAYMENT_REQUEST', 'urgent'));
  check('an unknown priority falls back to normal', N.parsePriority('HIGHEST') === 'normal');
}
{
  check('a payment request is under Payments', N.categoryOf('PAYMENT_REQUEST') === 'payments');
  check('a clear request is under Clear Requests', N.categoryOf('CLEAR_REQUEST') === 'clear');
  check('an edit request is under Other Approvals', N.categoryOf('EDIT_REQUEST') === 'approvals');
  check('a payment RESULT is filed with payments', N.categoryOf('APPROVAL_RESULT', 'payments') === 'payments');
  check('a clear RESULT is filed with clear requests', N.categoryOf('APPROVAL_RESULT', 'clear-requests') === 'clear');
  check('a future module’s result is under Other Approvals', N.categoryOf('APPROVAL_RESULT', 'data-corrections') === 'approvals');
  check('every approval type has a home', N.APPROVAL_TYPES.every((t) => N.categoryOf(t) !== 'system'));
}

console.log('\nwhat an approval request says');
{
  const p = {
    orderNo: 'PAY-20260914-00007', crsId: 19, shopName: 'காக்காதோப்பு', requesterName: 'Rahamathullakhan', requesterRole: 'BC',
    kind: 'statement', month: 9, year: 2026, sheetCount: 3, dayCount: 0, totalPaise: 12000, utr: '767865644677', submittedAt: '2026-09-14T15:45:00.000Z',
  };
  const w = N.paymentRequestText(p);
  const line = (l) => w.details.find((d) => d.label === l)?.value;
  check('titled as in the spec', w.title === 'Payment Approval Request');
  check('names the shop', line('CRS') === 'CRS 19 — காக்காதோப்பு');
  check('names who asked, with their role', line('Requested By') === 'Rahamathullakhan (BC)');
  check('names the statement and period', line('Statement') === 'Monthly Statement – September 2026 · 3 sheets');
  check('states the amount in rupees from paise', line('Amount') === '₹120.00');
  check('carries the UTR the admin matches against the bank feed', line('UPI Reference (UTR)') === '767865644677');
  check('keeps the submitted time as ISO for the reader to localise', w.details.find((d) => d.label === 'Submitted')?.kind === 'date');
  check('is pending', line('Status') === 'Pending Approval');
  check('a DSS order is worded as a download of days', N.paymentSubject({ ...p, kind: 'dss', dayCount: 1 }) === 'DSS – September 2026 · 1 day');
}
{
  const c = {
    id: 245, crsId: 1, shopName: 'அண்ணா நகர்', modules: ['Daily Sales'], scopeKind: 'day', scopeLabel: '2026-09-01',
    requesterName: 'Divya', requesterRole: 'BC', reason: 'Wrong entry', createdAt: '2026-09-14T15:20:00.000Z',
  };
  const w = N.clearRequestText(c);
  const line = (l) => w.details.find((d) => d.label === l)?.value;
  check('titled as in the spec', w.title === 'Clear Approval Request');
  check('names the module', line('Module') === 'Daily Sales');
  check('writes the entry date the way the office does', line('Entry Date') === '01-09-2026');
  check('names the requester and role', line('Requested By') === 'Divya (BC)');
  check('carries the reason', line('Reason') === 'Wrong entry');
  check('a month-scoped clear says Month, not Entry Date', N.clearRequestText({ ...c, scopeKind: 'month', scopeLabel: 'September 2026' }).details.some((d) => d.label === 'Month'));
}

console.log('\nwhat the requester is told');
{
  const p = { orderNo: 'PAY-1', crsId: 19, shopName: '', requesterName: 'R', requesterRole: 'BC', kind: 'statement', month: 9, year: 2026, sheetCount: 1, dayCount: 0, totalPaise: 4000, submittedAt: 'x' };
  const ok = N.paymentResultText(p, 'approved');
  check('an approval says the download is unlocked', ok.title === 'Payment Request Approved' && /can now download the statement/.test(ok.message));
  const no = N.paymentResultText(p, 'rejected', 'UTR not found in bank feed');
  check('a rejection gives the reason', no.title === 'Payment Request Rejected' && /UTR not found/.test(no.message));
  check('a shop with no name on file still reads correctly', ok.details[0].value === 'CRS 19');
}
{
  const c = { id: 1, crsId: 1, shopName: '', modules: ['Daily Sales'], scopeKind: 'day', scopeLabel: '2026-09-01', requesterName: 'Divya', requesterRole: 'BC', reason: 'x', createdAt: 'x' };
  const no = N.clearResultText(c, 'rejected');
  check('a rejected clear is worded as in the spec', no.message === 'Your request to clear Daily Sales for 01-09-2026 was rejected by Admin.', no.message);
  check('an approved clear says the entry can be keyed again', /cleared and can be keyed again/.test(N.clearResultText(c, 'cleared').message));
}

console.log('\nstatus words');
{
  check('pending', N.statusLabel('pending') === 'Pending Approval');
  check('a performed clear reads as Approved', N.statusLabel('cleared') === 'Approved');
  check('a withdrawal reads as Withdrawn', N.statusLabel('cancelled') === 'Withdrawn');
}

console.log(`\n${failures ? `${failures} FAILED` : 'NOTIFICATIONS OK'}`);
process.exitCode = failures ? 1 : 0;
