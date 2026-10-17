/**
 * Payment Management (office, 2026-10-16).
 *
 *   node tools/verify-payment-mgmt.mjs
 *
 * The handlers behind /api/payment-management (src/lib/paymentMgmt/server.ts)
 * and their rules (core.ts), run against the in-memory store — no database,
 * no network — plus the wiring of the routes, the live topic and the screens:
 *
 *  1. Rupee text → paise, never through a float.
 *  2. Creating: one Monthly / PV / Previous Balance per shop and month (409),
 *     any number of Other; refusals store nothing; money already received.
 *  3. Partial payments: 350 → 200 → 150 → 0 = paid, every entry kept; more
 *     than the balance refused; a bad payment refused.
 *  4. Editing the amount due: never below what is paid.
 *  5. Corrections keep what they replaced; a void keeps the entry and gives
 *     the balance back.
 *  6. Deleting: only with no payments and no reminders.
 *  7. Reminders: refused when paid; each send a new reminder with that
 *     moment's figures; delivered to that shop only; a failure is answered.
 *  8. A shop's /mine: its own reminded obligations only, no remarks, UTRs or
 *     names; waiting ones oldest first; links and media.
 *  9. OK: another shop's answers 404 and changes nothing; money untouched;
 *     every waiting reminder stamped; a second OK is harmless.
 * 10. Every administrator's handler: 403 for a shop user, 401 signed out,
 *     nothing changed.
 * 11. UPI links: amount, tr, tn, payee encoded; one query for all four.
 * 12. Files: sniffed by their bytes; SVG / HTML / empty / too big refused; a
 *     QR replaces the last; the active sound cannot be removed.
 * 13. Who may fetch a file: a shop only the current QR and the active sound.
 * 14. The activity log: module, actions, and never a UTR or remarks in a summary.
 * 15. The UPI ID: only those two columns, never empty, 503 without 0004.
 * 16. Wiring: every client.ts route has its route file and method; nav,
 *     middleware, the live topic, delivery, storage.
 */
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { register } from 'node:module';
import { dirname, join, relative, resolve } from 'node:path';
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
const C = await imp('src/lib/paymentMgmt/core.ts');
const V = await imp('src/lib/paymentMgmt/server.ts');
const U = await imp('src/lib/payments/upi.ts');
const read = (p) => (existsSync(join(root, p)) ? readFileSync(join(root, p), 'utf8') : '');

let failures = 0;
const check = (label, ok, detail = '') => {
  if (ok) console.log(`  ok    ${label}`);
  else {
    failures++;
    console.log(`  FAIL  ${label}${detail ? `\n        ${typeof detail === 'string' ? detail : JSON.stringify(detail)}` : ''}`);
  }
};
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);

// ── The outside world, recorded ──────────────────────────────────────────────
const TODAY = '2026-10-16';
let clock = Date.parse('2026-10-16T04:30:00.000Z');
const notified = [];
const drafts = [];
const acks = [];
let notifyImpl = async (input) => {
  notified.push(JSON.parse(JSON.stringify(input)));
  return { notificationId: 1000 + notified.length, recipients: 2 };
};
const deps = {
  notifyShop: (input) => notifyImpl(input),
  recordActivity: (d) => {
    drafts.push(...d);
  },
  ackNotification: async (userId, notificationId) => {
    acks.push([userId, notificationId]);
  },
  today: () => TODAY,
  now: () => new Date((clock += 60_000)).toISOString(),
  shopName: (id) => `Shop ${id}`,
};

const admin = { userId: 1, role: 'ADMIN', crsId: null, name: 'Office Admin' };
const bc1 = { userId: 11, role: 'BC', crsId: 1, name: 'Kumar' };
const pk1 = { userId: 12, role: 'Packer', crsId: 1, name: 'Ravi' };
const bc2 = { userId: 21, role: 'BC', crsId: 2, name: 'Devi' };
const noShop = { userId: 99, role: 'BC', crsId: null, name: 'Nobody' };

const nob = (crsId, type, due, extra = {}) => ({ crsId, month: 10, year: 2026, type, title: type === 'other' ? 'Training fee' : '', reference: '', dueRupees: due, ...extra });
const pay = (amountRupees, extra = {}) => ({ date: '2026-10-10', amountRupees, method: 'upi', utr: '', remarks: '', ...extra });
const create = async (st, body, who = admin) => V.createObligation(st, deps, who, body);
const rec = (st, id) => st.rows.get(id)?.ob;

// Bytes of each kind of file.
const bytes = (...parts) => new Uint8Array(Buffer.concat(parts.map((p) => (typeof p === 'string' ? Buffer.from(p, 'latin1') : Buffer.from(p)))));
const FILES = {
  png: bytes([0x89], 'PNG\r\n\x1a\n', [0, 0, 0, 13], 'IHDR', Buffer.alloc(40)),
  jpeg: bytes([0xff, 0xd8, 0xff, 0xe0], Buffer.alloc(40)),
  webp: bytes('RIFF', [40, 0, 0, 0], 'WEBPVP8 ', Buffer.alloc(40)),
  mp3: bytes('ID3', [4, 0, 0], Buffer.alloc(40)),
  mp3frame: bytes([0xff, 0xfb, 0x90, 0x64], Buffer.alloc(40)),
  wav: bytes('RIFF', [40, 0, 0, 0], 'WAVEfmt ', Buffer.alloc(40)),
  ogg: bytes('OggS', [0, 2], Buffer.alloc(40)),
  m4a: bytes([0, 0, 0, 0x20], 'ftypM4A ', Buffer.alloc(40)),
  aac: bytes([0xff, 0xf1, 0x50, 0x80], Buffer.alloc(40)),
  webm: bytes([0x1a, 0x45, 0xdf, 0xa3], Buffer.alloc(40)),
  svg: bytes('<svg xmlns="http://www.w3.org/2000/svg" onload="alert(1)"><rect/></svg>'),
  svgXml: bytes('<?xml version="1.0"?><svg xmlns="http://www.w3.org/2000/svg"></svg>'),
  html: bytes('<!DOCTYPE html><html><script>alert(1)</script></html>'),
};

// ─── 1. Rupees ────────────────────────────────────────────────────────────────
{
  console.log('\n§1  Rupee text → paise');
  const cases = [
    ['350', 35000], ['200.5', 20050], ['200.50', 20050], ['0.05', 5], [' 1200 ', 120000], ['9999999.99', 999999999], ['0', 0],
    ['1,000', null], ['-5', null], ['1.234', null], ['', null], ['abc', null], ['12345678', null], ['₹350', null], ['3 50', null], ['.5', null], [null, null],
  ];
  for (const [text, want] of cases) check(`${JSON.stringify(text)} → ${want}`, C.parseRupees(text) === want, String(C.parseRupees(text)));
}

// ─── 2. Creating ──────────────────────────────────────────────────────────────
{
  console.log('\n§2  Create — one Monthly / PV / Previous Balance per shop and month; Other any number of times');
  const st = V.memoryStore();
  const m = await create(st, nob(1, 'monthly', '350'));
  const o = m.body.obligation;
  check('Monthly Statement for CRS 1, October 2026: 200, id 1-2026-10-monthly, ₹350.00 due, unpaid',
    m.status === 200 && o.id === '1-2026-10-monthly' && o.duePaise === 35000 && o.paidPaise === 0 && o.balancePaise === 35000 && o.status === 'unpaid' && o.reminderStatus === 'none' && o.version === 1 && o.typeLabel === 'Monthly Statement' && o.shopName === 'Shop 1', o);
  check('who and when recorded', o.createdByName === 'Office Admin' && o.createdBy === 1 && !!o.createdAt && o.updatedByName === 'Office Admin');
  for (const [type, label] of [['monthly', 'Monthly Statement'], ['pv', 'PV Statement'], ['prev_balance', 'Previous Month Balance']]) {
    if (type !== 'monthly') check(`first ${label}: 200`, (await create(st, nob(1, type, '100'))).status === 200);
    const again = await create(st, nob(1, type, '999'));
    check(`a second ${label} for CRS 1, October 2026: 409 "${again.body.error}"`,
      again.status === 409 && again.body.error === `A ${label} for CRS 1, October 2026 already exists — edit that one.` && rec(st, `1-2026-10-${type}`).duePaise !== 99900);
  }
  // Combined types (office, 2026-10-17): ONE record, ONE amount — and a part
  // may be billed only once per shop-month.
  {
    const cs = V.memoryStore();
    const mp = await create(cs, nob(5, 'monthly_pv', '850'));
    check('"Monthly + PV Statement" for CRS 5: one record 5-2026-10-monthly_pv, one amount ₹850.00',
      mp.status === 200 && mp.body.obligation.id === '5-2026-10-monthly_pv' && mp.body.obligation.duePaise === 85000 && mp.body.obligation.typeLabel === 'Monthly + PV Statement' && cs.rows.size === 1, mp.body);
    const m5 = await create(cs, nob(5, 'monthly', '500'));
    check(`a Monthly Statement beside it is refused (Monthly billed twice): 409 "${m5.body.error}"`,
      m5.status === 409 && /already has a Monthly \+ PV Statement, which also covers the Monthly Statement/.test(m5.body.error) && cs.rows.size === 1);
    const all3 = await create(cs, nob(5, 'monthly_pv_prev', '900'));
    check('so is "Monthly + PV + Previous" (covers both): 409', all3.status === 409 && /Monthly Statement and PV Statement/.test(all3.body.error), all3.body.error);
    const pb = await create(cs, nob(5, 'prev_balance', '120'));
    check('the Previous Month Balance on its own is free: 200', pb.status === 200);
    check('…and then "PV + Previous" overlaps both records: 409', (await create(cs, nob(5, 'pv_prev', '1'))).status === 409);
    check('Other is never blocked by a combined record', (await create(cs, nob(5, 'other', '10', { title: 'Scale repair' }))).status === 200);
    const mb = await create(cs, nob(6, 'monthly_prev', '300'));
    const pv6 = await create(cs, nob(6, 'pv', '200'));
    check('CRS 6: "Monthly + Previous" ₹300 and a PV ₹200 live side by side', mb.status === 200 && pv6.status === 200 && mb.body.obligation.typeLabel === 'Monthly Statement + Previous Month Balance');
    const pay6 = await V.recordPayment(cs, deps, admin, mb.body.obligation.id, pay('300'));
    check('paying the combined ₹300 leaves the PV untouched (₹200 outstanding)', pay6.status === 200 && pay6.body.obligation.status === 'paid' && rec(cs, '6-2026-10-pv').payments.length === 0);
    const msg = C.reminderMessage({ month: 10, year: 2026, type: 'monthly_pv', title: '', duePaise: 85000, payments: [] });
    check(`the reminder names the combined type: "${msg.slice(0, 70)}…"`, msg.startsWith('Your payment balance for the October 2026 Monthly + PV statement is ₹850. '));
    check('UPI reference codes: CRS5-MSPV-102026, CRS5-MSPVPB-102026; every note ≤ 50 characters',
      C.linkReference({ crsId: 5, type: 'monthly_pv', month: 10, year: 2026, title: '' }) === 'CRS5-MSPV-102026' && C.linkReference({ crsId: 5, type: 'monthly_pv_prev', month: 10, year: 2026, title: '' }) === 'CRS5-MSPVPB-102026' &&
      C.linkNote({ crsId: 30, type: 'monthly_pv_prev', month: 12, year: 2026, title: '' }).length <= 50);
    check('the four combined ids are valid ids; nonsense is not',
      ['1-2026-10-monthly_pv', '1-2026-10-monthly_prev', '1-2026-10-pv_prev', '1-2026-10-monthly_pv_prev'].every(C.validObligationId) && !C.validObligationId('1-2026-10-pv_monthly'));
  }
  check('the same type for November, or for another shop, is its own: 200, 200',
    (await create(st, nob(1, 'pv', '100', { month: 11 }))).status === 200 && (await create(st, nob(2, 'pv', '100'))).status === 200);
  const others = [];
  for (const t of ['Training fee', 'Stationery', 'Training fee']) others.push(await create(st, nob(1, 'other', '50', { title: t })));
  check('three Other obligations for the same shop and month: all saved, each its own id',
    others.every((x) => x.status === 200 && /^1-2026-10-other-[a-z0-9]{6}$/.test(x.body.obligation.id)) && new Set(others.map((x) => x.body.obligation.id)).size === 3, others.map((x) => x.body.obligation?.id));
  const before = st.rows.size;
  const refusals = [
    ['Other without a title', nob(1, 'other', '50', { title: '  ' }), 400],
    ['a title over 80 characters', nob(1, 'other', '50', { title: 'x'.repeat(81) }), 400],
    ['a reference over 60 characters', nob(3, 'pv', '50', { reference: 'r'.repeat(61) }), 400],
    ['due 0', nob(3, 'pv', '0'), 400],
    ['due "abc"', nob(3, 'pv', 'abc'), 400],
    ['due "-5"', nob(3, 'pv', '-5'), 400],
    ['CRS 31', nob(31, 'pv', '5'), 400],
    ['CRS 0', nob(0, 'pv', '5'), 400],
    ['month 13', nob(3, 'pv', '5', { month: 13 }), 400],
    ['year 2019', nob(3, 'pv', '5', { year: 2019 }), 400],
    ['type "gift"', nob(3, 'gift', '5'), 400],
    ['money already paid, dated tomorrow', nob(3, 'pv', '500', { initialPayment: pay('200', { date: '2026-10-17' }) }), 400],
    ['money already paid above the due', nob(3, 'pv', '500', { initialPayment: pay('501') }), 409],
    ['no body at all', null, 400],
  ];
  for (const [label, body, want] of refusals) {
    const a = await create(st, body);
    check(`${label}: ${a.status} — ${a.body.error}`, a.status === want && typeof a.body.error === 'string' && a.body.error.length > 5);
  }
  check('nothing was stored by any of them', st.rows.size === before);
  const init = await create(st, nob(4, 'pv', '500', { initialPayment: pay('200', { utr: 'UTR4INIT', remarks: 'paid at the counter' }) }));
  const io = init.body.obligation;
  check('money already received is its first payment: paid ₹200.00, balance ₹300.00, partly paid',
    init.status === 200 && io.paidPaise === 20000 && io.balancePaise === 30000 && io.status === 'partial' && io.payments.length === 1 && io.payments[0].utr === 'UTR4INIT' && io.payments[0].byName === 'Office Admin');
  const list = await V.listObligations(st, deps, admin);
  check(`the administrator lists every one (${list.body.obligations.length}), newest month first`,
    list.status === 200 && list.body.obligations.length === st.rows.size && list.body.obligations[0].month === 11);
}

// ─── 3. Partial payments ──────────────────────────────────────────────────────
{
  console.log('\n§3  Partial payments — 350 → 200 → 150 → 0, every entry kept');
  const st = V.memoryStore();
  const id = (await create(st, nob(3, 'pv', '350'))).body.obligation.id;
  const p1 = await V.recordPayment(st, deps, admin, id, pay('200', { utr: 'UTR3A' }));
  check('₹200 received: paid ₹200.00, balance ₹150.00, partly paid', p1.status === 200 && p1.body.obligation.paidPaise === 20000 && p1.body.obligation.balancePaise === 15000 && p1.body.obligation.status === 'partial');
  const over = await V.recordPayment(st, deps, admin, id, pay('151'));
  check(`₹151 against ₹150 outstanding: 409 "${over.body.error}", nothing recorded`, over.status === 409 && over.body.error === 'That is more than the outstanding ₹150.00.' && rec(st, id).payments.length === 1);
  const p2 = await V.recordPayment(st, deps, admin, id, pay('150', { method: 'cash' }));
  const o = p2.body.obligation;
  check('₹150 received: balance ₹0.00, fully paid', p2.status === 200 && o.balancePaise === 0 && o.paidPaise === 35000 && o.status === 'paid');
  check('both payments kept, in order, each with its own id, time and who recorded it',
    o.payments.length === 2 && same(o.payments.map((p) => p.amountPaise), [20000, 15000]) && o.payments[0].id !== o.payments[1].id && o.payments.every((p) => p.at && p.byName === 'Office Admin' && p.edits.length === 0 && p.voided === null));
  const more = await V.recordPayment(st, deps, admin, id, pay('1'));
  check(`another payment once paid: 409 "${more.body.error}"`, more.status === 409 && more.body.error === "CRS 3's October 2026 PV Statement is fully paid." && rec(st, id).payments.length === 2);
  const id2 = (await create(st, nob(3, 'monthly', '350'))).body.obligation.id;
  const big = await V.recordPayment(st, deps, admin, id2, pay('400'));
  check(`₹400 against ₹350 due: 409 "${big.body.error}"`, big.status === 409 && big.body.error === 'That is more than the outstanding ₹350.00.');
  const bad = [
    ['dated tomorrow', pay('10', { date: '2026-10-17' }), 400],
    ['30 February', pay('10', { date: '2026-02-30' }), 400],
    ['no date', pay('10', { date: '' }), 400],
    ['method "cheque"', pay('10', { method: 'cheque' }), 400],
    ['amount 0', pay('0'), 400],
    ['amount "ten"', pay('ten'), 400],
    ['a UTR of 41 characters', pay('10', { utr: 'U'.repeat(41) }), 400],
    ['remarks of 301 characters', pay('10', { remarks: 'r'.repeat(301) }), 400],
  ];
  for (const [label, body, want] of bad) {
    const a = await V.recordPayment(st, deps, admin, id2, body);
    check(`${label}: ${a.status} — ${a.body.error}`, a.status === want);
  }
  check('none of them recorded anything', rec(st, id2).payments.length === 0);
  check('an obligation that does not exist: 404; a malformed id: 404',
    (await V.recordPayment(st, deps, admin, '9-2026-10-pv', pay('1'))).status === 404 && (await V.recordPayment(st, deps, admin, '../x', pay('1'))).status === 404);
  check('today itself is a valid payment date', (await V.recordPayment(st, deps, admin, id2, pay('1', { date: TODAY }))).status === 200);
}

// ─── 4. Editing ───────────────────────────────────────────────────────────────
{
  console.log('\n§4  Edit — the amount due never below what is paid');
  const st = V.memoryStore();
  const id = (await create(st, nob(4, 'monthly', '350'))).body.obligation.id;
  await V.recordPayment(st, deps, admin, id, pay('200'));
  const low = await V.updateObligation(st, deps, admin, id, { dueRupees: '150' });
  check(`due ₹150 with ₹200 received: 409 "${low.body.error}"`, low.status === 409 && low.body.error === '₹200.00 has already been received; the amount due cannot be less.' && rec(st, id).duePaise === 35000);
  const eq = await V.updateObligation(st, deps, admin, id, { dueRupees: '200' });
  check('due ₹200 = received: fully paid', eq.status === 200 && eq.body.obligation.status === 'paid' && eq.body.obligation.balancePaise === 0);
  const n = drafts.length;
  const up = await V.updateObligation(st, deps, admin, id, { dueRupees: '400', reference: 'STMT/10/2026' });
  check('due ₹400 and a reference: balance ₹200.00, partly paid, the payments untouched',
    up.status === 200 && up.body.obligation.balancePaise === 20000 && up.body.obligation.status === 'partial' && up.body.obligation.reference === 'STMT/10/2026' && up.body.obligation.payments.length === 1 && up.body.obligation.version === 4);
  check('the activity log names the change: Amount due ₹200.00 → ₹400.00',
    drafts.length === n + 1 && drafts[n].action === 'updated' && drafts[n].changes.some((c) => c.label === 'Amount due' && c.before === '₹200.00' && c.after === '₹400.00'));
  const same0 = await V.updateObligation(st, deps, admin, id, { dueRupees: '400' });
  check('saving the same figure: 200, nothing written, nothing logged', same0.status === 200 && rec(st, id) && st.rows.get(id).version === 4 && drafts.length === n + 1);
  check('nothing to change: 400', (await V.updateObligation(st, deps, admin, id, {})).status === 400);
  check('a title on a Monthly Statement is ignored (it is named by its type)', (await V.updateObligation(st, deps, admin, id, { title: 'Something' })).status === 200 && rec(st, id).title === '');
  const oid = (await create(st, nob(4, 'other', '50'))).body.obligation.id;
  check('an Other obligation\'s title can be changed, not emptied',
    (await V.updateObligation(st, deps, admin, oid, { title: 'Stationery' })).body.obligation.title === 'Stationery' && (await V.updateObligation(st, deps, admin, oid, { title: '' })).status === 400);
  check('due 0 or not a number: 400; unknown: 404',
    (await V.updateObligation(st, deps, admin, id, { dueRupees: '0' })).status === 400 && (await V.updateObligation(st, deps, admin, id, { dueRupees: 'x' })).status === 400 && (await V.updateObligation(st, deps, admin, '4-2026-10-pv', { dueRupees: '5' })).status === 404);
}

// ─── 5. Corrections and voids ─────────────────────────────────────────────────
{
  console.log('\n§5  A correction keeps what it replaced; a void keeps the entry');
  const st = V.memoryStore();
  const id = (await create(st, nob(5, 'monthly', '350'))).body.obligation.id;
  const pid = (await V.recordPayment(st, deps, admin, id, pay('200', { utr: 'UTR5ORIG', remarks: 'first entry' }))).body.obligation.payments[0].id;
  const c1 = await V.changePayment(st, deps, admin, id, pid, { action: 'correct', ...pay('180', { utr: 'UTR5FIX', remarks: 'typo' }) });
  const p = c1.body.obligation.payments[0];
  check('corrected ₹200 → ₹180: balance ₹170.00, the entry shows ₹180',
    c1.status === 200 && p.amountPaise === 18000 && p.utr === 'UTR5FIX' && c1.body.obligation.balancePaise === 17000);
  check("…and keeps what it replaced: 'before' ₹200.00, UTR5ORIG, 'first entry', who and when",
    p.edits.length === 1 && p.edits[0].before.amountPaise === 20000 && p.edits[0].before.utr === 'UTR5ORIG' && p.edits[0].before.remarks === 'first entry' && p.edits[0].byName === 'Office Admin' && !!p.edits[0].at);
  const over = await V.changePayment(st, deps, admin, id, pid, { action: 'correct', ...pay('351') });
  check(`corrected to ₹351 against ₹350 due: 409 "${over.body.error}"`, over.status === 409 && rec(st, id).payments[0].amountPaise === 18000);
  const full = await V.changePayment(st, deps, admin, id, pid, { action: 'correct', ...pay('350') });
  check('corrected to ₹350: fully paid, two corrections kept', full.status === 200 && full.body.obligation.status === 'paid' && full.body.obligation.payments[0].edits.length === 2);
  const same1 = await V.changePayment(st, deps, admin, id, pid, { action: 'correct', ...pay('350') });
  check('the same figures again: 200, no third correction', same1.status === 200 && rec(st, id).payments[0].edits.length === 2);
  check('a void needs a reason: 400', (await V.changePayment(st, deps, admin, id, pid, { action: 'void', reason: ' ' })).status === 400);
  const v = await V.changePayment(st, deps, admin, id, pid, { action: 'void', reason: 'entered twice' });
  const vp = v.body.obligation.payments[0];
  check('voided: the entry is kept, with the reason; the balance is back to ₹350.00, unpaid',
    v.status === 200 && v.body.obligation.payments.length === 1 && vp.voided?.reason === 'entered twice' && vp.voided.byName === 'Office Admin' && v.body.obligation.balancePaise === 35000 && v.body.obligation.paidPaise === 0 && v.body.obligation.status === 'unpaid');
  check('voiding it again: 409; correcting a voided payment: 409',
    (await V.changePayment(st, deps, admin, id, pid, { action: 'void', reason: 'again' })).status === 409 && (await V.changePayment(st, deps, admin, id, pid, { action: 'correct', ...pay('10') })).status === 409);
  check('an unknown payment: 404; an unknown action: 400',
    (await V.changePayment(st, deps, admin, id, 'pnothere', { action: 'void', reason: 'x' })).status === 404 && (await V.changePayment(st, deps, admin, id, pid, { action: 'delete' })).status === 400);
  check('a new payment after the void may take the whole ₹350.00 again', (await V.recordPayment(st, deps, admin, id, pay('350'))).body.obligation.status === 'paid');
}

// ─── 6. Deleting ──────────────────────────────────────────────────────────────
{
  console.log('\n§6  Delete — only with no payments and no reminders');
  const st = V.memoryStore();
  const clean = (await create(st, nob(6, 'pv', '100'))).body.obligation.id;
  const paid = (await create(st, nob(6, 'monthly', '100'))).body.obligation.id;
  await V.recordPayment(st, deps, admin, paid, pay('10'));
  const reminded = (await create(st, nob(6, 'prev_balance', '100'))).body.obligation.id;
  await V.sendReminder(st, deps, admin, reminded);
  const d1 = await V.deleteObligation(st, deps, admin, clean);
  check('nothing on it: deleted', d1.status === 200 && !st.rows.has(clean));
  check('deleting it again: 404', (await V.deleteObligation(st, deps, admin, clean)).status === 404);
  const d2 = await V.deleteObligation(st, deps, admin, paid);
  check(`with a payment: 409 "${d2.body.error}", still there`, d2.status === 409 && st.rows.has(paid));
  const pid = rec(st, paid).payments[0].id;
  await V.changePayment(st, deps, admin, paid, pid, { action: 'void', reason: 'mistake' });
  check('with only a voided payment: still 409 (the history stays)', (await V.deleteObligation(st, deps, admin, paid)).status === 409 && st.rows.has(paid));
  const d3 = await V.deleteObligation(st, deps, admin, reminded);
  check(`with a reminder sent: 409 "${d3.body.error}", still there`, d3.status === 409 && st.rows.has(reminded));
}

// ─── 7. Reminders ─────────────────────────────────────────────────────────────
{
  console.log('\n§7  Reminders — that shop only, a new one each time, with that moment\'s figures');
  const st = V.memoryStore();
  const id = (await create(st, nob(6, 'pv', '350'))).body.obligation.id;
  notified.length = 0;
  const r1 = await V.sendReminder(st, deps, admin, id);
  const n1 = notified[0];
  check('sent: 200, one notification', r1.status === 200 && notified.length === 1);
  check('to CRS 6 only, titled "Payment Reminder — CRS 6", linked to its card on the Payments screen',
    n1.crsId === 6 && n1.title === 'Payment Reminder — CRS 6' && n1.link === '/payments?ob=6-2026-10-pv' && n1.obligationId === id && !JSON.stringify(n1).includes('"crsId":1,'));
  check('the message the office asked for',
    n1.message === 'Your payment balance for the October 2026 PV statement is ₹350. Please complete the outstanding payment using the UPI options below.', n1.message);
  check('details: Month, Payment Type, Total Amount Due, Amount Paid, Outstanding Balance',
    same(n1.details.map((d) => [d.label, d.value]), [['Month', 'October 2026'], ['Payment Type', 'PV Statement'], ['Total Amount Due', '₹350.00'], ['Amount Paid', '₹0.00'], ['Outstanding Balance', '₹350.00']]), n1.details);
  check('sent by the administrator', n1.sender.userId === 1 && n1.sender.name === 'Office Admin');
  const rm = r1.body.reminder;
  check('recorded with its figures, notification id and recipients, waiting for OK',
    rm.duePaise === 35000 && rm.paidPaise === 0 && rm.balancePaise === 35000 && rm.notificationId === 1001 && rm.recipients === 2 && rm.ackAt === null && rm.byName === 'Office Admin' && r1.body.obligation.reminderStatus === 'sent' && r1.body.obligation.lastReminderAt === rm.at);
  check('no payment was touched', rec(st, id).payments.length === 0);
  await V.recordPayment(st, deps, admin, id, pay('100'));
  const r2 = await V.sendReminder(st, deps, admin, id);
  const rs = rec(st, id).reminders;
  check('after ₹100 is paid, a second send is a NEW reminder: ₹350 / ₹100 / ₹250; the first still says ₹350',
    r2.status === 200 && rs.length === 2 && rs[0].balancePaise === 35000 && rs[1].balancePaise === 25000 && rs[1].paidPaise === 10000 && rs[1].duePaise === 35000 && rs[0].id !== rs[1].id);
  check('…and its notification says ₹250 outstanding', notified[1].message.includes('is ₹250.') && notified[1].details[3].value === '₹100.00');
  check('the payments are as they were (one)', rec(st, id).payments.length === 1);
  check('every notification went to CRS 6 and nowhere else', notified.every((n) => n.crsId === 6));
  await V.recordPayment(st, deps, admin, id, pay('250'));
  const r3 = await V.sendReminder(st, deps, admin, id);
  check(`fully paid: 409 "${r3.body.error}", nothing sent`, r3.status === 409 && r3.body.error === "CRS 6's October 2026 PV Statement is fully paid." && notified.length === 2 && rec(st, id).reminders.length === 2);

  const id7 = (await create(st, nob(7, 'monthly', '100'))).body.obligation.id;
  notifyImpl = async () => {
    throw Object.assign(new Error('CRS 7 has no active Bill Clerk or Packer to receive the reminder.'), { status: 400 });
  };
  const nobody = await V.sendReminder(st, deps, admin, id7);
  check(`a shop with nobody to receive it: 400 "${nobody.body.error}", nothing recorded`, nobody.status === 400 && nobody.body.error === 'CRS 7 has no active Bill Clerk or Packer to receive the reminder.' && rec(st, id7).reminders.length === 0);
  notifyImpl = async () => {
    throw Object.assign(new Error('Notifications are not installed yet — run supabase/migrations/0005_notifications.sql.'), { status: 503 });
  };
  check('notifications not installed: 503, nothing recorded', (await V.sendReminder(st, deps, admin, id7)).status === 503 && rec(st, id7).reminders.length === 0);
  const logged = [];
  const realError = console.error;
  console.error = (...a) => logged.push(a.join(' '));
  notifyImpl = async () => {
    throw new Error('connection reset');
  };
  const boom = await V.sendReminder(st, deps, admin, id7);
  check('any other delivery failure: 500, a plain sentence (the detail to the server log)', boom.status === 500 && !/connection reset/.test(boom.body.error) && logged.some((l) => /connection reset/.test(l)));
  notifyImpl = async (input) => {
    notified.push(JSON.parse(JSON.stringify(input)));
    return { notificationId: 1000 + notified.length, recipients: 2 };
  };
  logged.length = 0;
  const broken = { ...st, changeObligation: async () => { throw new Error('crs_state update failed'); } };
  const lost = await V.sendReminder(broken, deps, admin, id7);
  console.error = realError;
  check('sent but not recorded: 500, saying it reached the shop — and the server log says so',
    lost.status === 500 && /reached CRS 7/.test(lost.body.error) && logged.some((l) => /REACHED CRS 7/.test(l)), [lost.body.error, logged]);
}

// ─── 8. A shop's own reminders ────────────────────────────────────────────────
const SECRET_UTR = 'UTRSECRET9911';
const SECRET_REMARK = 'internal note: shop argued at counter';
{
  console.log('\n§8  /mine — a shop sees its own reminded obligations only, without remarks, UTRs or names');
  const st = V.memoryStore({ upi: { vpa: 'office@okaxis', payeeName: 'TNCSC Madurai & Co' } });
  const qr = await V.uploadMedia(st, deps, admin, { kind: 'qr', name: 'qr.png', bytes: FILES.png });
  const snd = await V.uploadMedia(st, deps, admin, { kind: 'sound', name: 'bell.mp3', bytes: FILES.mp3 });
  const soundId = snd.body.media.sounds[0].id;
  await V.setActiveSound(st, deps, admin, { activeSoundId: soundId });
  const A = (await create(st, nob(1, 'monthly', '350'))).body.obligation.id;
  await V.recordPayment(st, deps, admin, A, pay('100', { utr: SECRET_UTR, remarks: SECRET_REMARK }));
  const B = (await create(st, nob(1, 'pv', '500'))).body.obligation.id; // never reminded
  const Cid = (await create(st, nob(2, 'pv', '700'))).body.obligation.id;
  const D = (await create(st, nob(1, 'prev_balance', '80'))).body.obligation.id;
  await V.sendReminder(st, deps, admin, D); // D first: the longest-waiting
  await V.sendReminder(st, deps, admin, A);
  await V.sendReminder(st, deps, admin, Cid);
  const m = await V.mine(st, deps, bc1);
  const body = m.body;
  const text = JSON.stringify(body);
  check('200 for CRS 1: crsId 1, its name', m.status === 200 && body.crsId === 1 && body.shopName === 'Shop 1');
  check("only CRS 1's reminded obligations: never CRS 2's, never one not reminded",
    same(body.all.map((o) => o.id).sort(), [A, D].sort()) && !text.includes(Cid) && !text.includes(B) && body.all.every((o) => o.crsId === 1), body.all.map((o) => o.id));
  check('no UTR, no remarks, no recorder\'s name, no voided entries in what the shop receives',
    !text.includes(SECRET_UTR) && !text.includes(SECRET_REMARK) && !text.includes('Office Admin') && !/"utr"|"remarks"|"byName"|"edits"|"voided"/.test(text));
  check('waiting ones, oldest reminder first: the Previous Balance, then the Monthly Statement', same(body.pending.map((o) => o.id), [D, A]), body.pending.map((o) => o.id));
  check('every one, newest reminder first: the Monthly Statement, then the Previous Balance', same(body.all.map((o) => o.id), [A, D]));
  const a = body.all.find((o) => o.id === A);
  check('its figures: ₹350 due, ₹100 paid, ₹250 outstanding, partly paid, one payment (date, amount, method)',
    a.duePaise === 35000 && a.paidPaise === 10000 && a.balancePaise === 25000 && a.status === 'partial' && same(a.payments, [{ date: '2026-10-10', amountPaise: 10000, method: 'upi' }]) && a.pendingAck === true && a.reminder.ackAt === null);
  check('its message and links for the CURRENT balance (₹250.00)',
    a.message === 'Your payment balance for the October 2026 Monthly statement is ₹250. Please complete the outstanding payment using the UPI options below.' && a.links?.amountPaise === 25000 && a.links.reference === 'CRS1-MS-102026' && /am=250\.00/.test(a.links.upi));
  check('the UPI ID, the QR and the active sound, each at /api/payment-management/media/<id>',
    same(body.upi, { vpa: 'office@okaxis', payeeName: 'TNCSC Madurai & Co' }) && body.qrUrl === `/api/payment-management/media/${qr.body.media.qr.id}` && body.soundUrl === `/api/payment-management/media/${soundId}`);
  check('CRS 2 sees only its own', same((await V.mine(st, deps, bc2)).body.all.map((o) => o.id), [Cid]));
  const am = await V.mine(st, deps, admin);
  check(`an administrator: 403 "${am.body.error}"; signed out: 401; an account with no shop: 403`,
    am.status === 403 && am.body.error === 'For shop users.' && (await V.mine(st, deps, null)).status === 401 && (await V.mine(st, deps, noShop)).status === 403);
  check('a crsId sent by the browser plays no part: the handler takes no shop argument', V.mine.length === 3);
  await V.recordPayment(st, deps, admin, D, pay('80'));
  const paidView = (await V.mine(st, deps, bc1)).body.all.find((o) => o.id === D);
  check('a reminded obligation since paid: "paid", no links', paidView.status === 'paid' && paidView.links === null && paidView.balancePaise === 0);
  const noVpa = V.memoryStore();
  const nid = (await create(noVpa, nob(1, 'pv', '10'))).body.obligation.id;
  await V.sendReminder(noVpa, deps, admin, nid);
  const nm = (await V.mine(noVpa, deps, bc1)).body;
  check('no UPI ID configured: upi null, no links, no QR, no sound (a beep)', nm.upi === null && nm.all[0].links === null && nm.qrUrl === null && nm.soundUrl === null);
}

// ─── 9. OK ────────────────────────────────────────────────────────────────────
{
  console.log('\n§9  OK — the shop\'s own only; no money touched; every waiting reminder stamped; a second OK harmless');
  const st = V.memoryStore({ upi: { vpa: 'office@okaxis', payeeName: 'TNCSC' } });
  const id = (await create(st, nob(1, 'pv', '350'))).body.obligation.id;
  await V.recordPayment(st, deps, admin, id, pay('50'));
  await V.sendReminder(st, deps, admin, id);
  await V.sendReminder(st, deps, admin, id);
  const before = JSON.stringify(st.rows.get(id));
  acks.length = 0;
  const other = await V.acknowledge(st, deps, bc2, { obligationId: id });
  check(`CRS 2 pressing OK on CRS 1's: 404 "${other.body.error}" — and nothing changed`, other.status === 404 && JSON.stringify(st.rows.get(id)) === before && acks.length === 0);
  check('an id that does not exist: 404; a malformed one: 404; no body: 404',
    (await V.acknowledge(st, deps, bc1, { obligationId: '1-2026-10-monthly' })).status === 404 && (await V.acknowledge(st, deps, bc1, { obligationId: "1' or 1=1" })).status === 404 && (await V.acknowledge(st, deps, bc1, null)).status === 404);
  check('an administrator: 403; signed out: 401', (await V.acknowledge(st, deps, admin, { obligationId: id })).status === 403 && (await V.acknowledge(st, deps, null, { obligationId: id })).status === 401);
  const was = rec(st, id);
  const n = drafts.length;
  const ok1 = await V.acknowledge(st, deps, bc1, { obligationId: id });
  const now = rec(st, id);
  check('Kumar (CRS 1 BC) presses OK: 200, both waiting reminders acknowledged', ok1.status === 200 && ok1.body.ok === true && ok1.body.acknowledged === 2);
  check('each stamped with when and by whom', now.reminders.every((r) => r.ackAt && r.ackBy === 11 && r.ackName === 'Kumar'));
  check('no money touched: due, payments and the reminders\' own figures as they were',
    now.duePaise === was.duePaise && same(now.payments, was.payments) && same(now.reminders.map((r) => [r.duePaise, r.paidPaise, r.balancePaise, r.notificationId]), was.reminders.map((r) => [r.duePaise, r.paidPaise, r.balancePaise, r.notificationId])));
  check("Kumar's own copy of each notification acknowledged", same(acks, was.reminders.map((r) => [11, r.notificationId])), acks);
  check('one activity row: acknowledged, Payment Management, CRS 1', drafts.length === n + 1 && drafts[n].action === 'acknowledged' && drafts[n].module === 'Payment Management' && drafts[n].crsId === 1);
  const ok2 = await V.acknowledge(st, deps, pk1, { obligationId: id });
  check('Ravi (CRS 1 Packer) presses OK on another phone: 200, acknowledged 0, the first OK stands', ok2.status === 200 && ok2.body.acknowledged === 0 && rec(st, id).reminders.every((r) => r.ackBy === 11) && drafts.length === n + 1);
  const mine1 = (await V.mine(st, deps, bc1)).body;
  check('nothing waits any more; the page still lists it, acknowledged', mine1.pending.length === 0 && mine1.all[0].reminder.ackName === 'Kumar' && mine1.all[0].pendingAck === false);
  const list = (await V.listObligations(st, deps, admin)).body.obligations.find((o) => o.id === id);
  check('the office sees it acknowledged', list.reminderStatus === 'acknowledged');
  await V.sendReminder(st, deps, admin, id);
  check('a new reminder after the OK waits again', (await V.mine(st, deps, bc1)).body.pending.length === 1 && (await V.listObligations(st, deps, admin)).body.obligations.find((o) => o.id === id).reminderStatus === 'sent');
}

// ─── 10. Administrators only ─────────────────────────────────────────────────
{
  console.log('\n§10 Every administrator\'s handler: 403 for a shop user, 401 signed out, nothing changed');
  const st = V.memoryStore({ upi: { vpa: 'office@okaxis', payeeName: 'TNCSC' } });
  const id = (await create(st, nob(1, 'pv', '350'))).body.obligation.id;
  const pid = (await V.recordPayment(st, deps, admin, id, pay('10'))).body.obligation.payments[0].id;
  const sid = (await V.uploadMedia(st, deps, admin, { kind: 'sound', name: 's.mp3', bytes: FILES.mp3 })).body.media.sounds[0].id;
  const snap = () => JSON.stringify([[...st.rows], [...st.files.keys()], st.media, st.upi]);
  const before = snap();
  const n = notified.length;
  const handlers = [
    ['list obligations', (a) => V.listObligations(st, deps, a)],
    ['create', (a) => V.createObligation(st, deps, a, nob(1, 'monthly', '5'))],
    ['edit', (a) => V.updateObligation(st, deps, a, id, { dueRupees: '1' })],
    ['delete', (a) => V.deleteObligation(st, deps, a, id)],
    ['record payment', (a) => V.recordPayment(st, deps, a, id, pay('1'))],
    ['correct payment', (a) => V.changePayment(st, deps, a, id, pid, { action: 'correct', ...pay('2') })],
    ['void payment', (a) => V.changePayment(st, deps, a, id, pid, { action: 'void', reason: 'x' })],
    ['send reminder', (a) => V.sendReminder(st, deps, a, id)],
    ['read settings', (a) => V.getSettings(st, deps, a)],
    ['save UPI ID', (a) => V.saveUpi(st, deps, a, { vpa: 'thief@okaxis', payeeName: 'Thief' })],
    ['upload a file', (a) => V.uploadMedia(st, deps, a, { kind: 'qr', name: 'x.png', bytes: FILES.png })],
    ['set the active sound', (a) => V.setActiveSound(st, deps, a, { activeSoundId: sid })],
    ['remove a file', (a) => V.removeMedia(st, deps, a, sid)],
  ];
  for (const [label, run] of handlers) {
    const shop = await run(bc1);
    const out = await run(null);
    check(`${label}: shop user ${shop.status}, signed out ${out.status}`,
      shop.status === 403 && shop.body.error === 'Payment Management is for administrators only.' && out.status === 401 && out.body.error === 'Not signed in.');
  }
  check('nothing stored, removed, sent or written by any of them', snap() === before && notified.length === n);
}

// ─── 11. UPI links ────────────────────────────────────────────────────────────
{
  console.log('\n§11 UPI links — amount, tr, tn and payee, one query for all four apps');
  const upi = { vpa: 'office@okaxis', payeeName: 'TNCSC Madurai & Co' };
  const L = C.buildLinks(upi, 35000, 'CRS1-PV-102026', 'CRS 1 PV Statement Oct 2026');
  const q = L.upi.slice('upi://pay?'.length);
  const p = new URLSearchParams(q);
  check('upi://pay with pa, pn, am 350.00, cu INR, tn, tr', L.upi.startsWith('upi://pay?') && p.get('pa') === 'office@okaxis' && p.get('pn') === 'TNCSC Madurai & Co' && p.get('am') === '350.00' && p.get('cu') === 'INR' && p.get('tr') === 'CRS1-PV-102026' && p.get('tn') === 'CRS 1 PV Statement Oct 2026', L.upi);
  check("the payee's & and spaces encoded (%26, %20 — never a bare & or +)", q.includes('pn=TNCSC%20Madurai%20%26%20Co') && !q.includes('+') && q.split('&').length === 6, q);
  check('Google Pay / PhonePe / Paytm carry exactly that query', L.gpay === `tez://upi/pay?${q}` && L.phonepe === `phonepe://pay?${q}` && L.paytm === `paytmmp://pay?${q}`);
  check('the same link the paid downloads build (upiUri)', L.upi === U.upiUri({ ...upi, amountPaise: 35000, reference: 'CRS1-PV-102026', note: 'CRS 1 PV Statement Oct 2026' }));
  check('amount, reference and note returned with them', L.amountPaise === 35000 && L.reference === 'CRS1-PV-102026' && L.note === 'CRS 1 PV Statement Oct 2026');
  check('no links for ₹0, without a UPI ID, or with no settings', C.buildLinks(upi, 0, 'r', 'n') === null && C.buildLinks({ vpa: ' ', payeeName: 'x' }, 100, 'r', 'n') === null && C.buildLinks(null, 100, 'r', 'n') === null);
  const ob = (crsId, type, month, year) => ({ crsId, type, month, year, title: '' });
  check('tr / tn for CRS 1 PV October 2026: CRS1-PV-102026 / "CRS 1 PV Statement Oct 2026"', C.linkReference(ob(1, 'pv', 10, 2026)) === 'CRS1-PV-102026' && C.linkNote(ob(1, 'pv', 10, 2026)) === 'CRS 1 PV Statement Oct 2026');
  check('tr / tn for CRS 12 Previous Balance March 2027: CRS12-PB-032027 / "CRS 12 Previous Month Balance Mar 2027"', C.linkReference(ob(12, 'prev_balance', 3, 2027)) === 'CRS12-PB-032027' && C.linkNote(ob(12, 'prev_balance', 3, 2027)) === 'CRS 12 Previous Month Balance Mar 2027');
  check('Monthly MS, Other OT; every note at most 50 characters', C.linkReference(ob(30, 'monthly', 1, 2026)) === 'CRS30-MS-012026' && C.linkReference(ob(3, 'other', 12, 2026)) === 'CRS3-OT-122026' && C.linkNote(ob(30, 'prev_balance', 12, 2026)).length <= 50);
  const msg = (type, due, paid, title = '') => C.reminderMessage({ month: 10, year: 2026, type, title, duePaise: due, payments: paid ? [{ amountPaise: paid, voided: null }] : [] });
  check('the office\'s words: "…PV statement is ₹350." (whole rupees, no .00)', msg('pv', 35000, 0) === 'Your payment balance for the October 2026 PV statement is ₹350. Please complete the outstanding payment using the UPI options below.', msg('pv', 35000, 0));
  check('paise kept when there are any (₹150.50), ₹1350 written as the app writes money everywhere', / is ₹150\.50\. /.test(msg('monthly', 35050, 20000)) && / is ₹1350\. /.test(msg('prev_balance', 135000, 0)) && /Previous Month Balance is/.test(msg('prev_balance', 135000, 0)) && /Weighing scale repair is/.test(msg('other', 5000, 0, 'Weighing scale repair')), [msg('monthly', 35050, 20000), msg('prev_balance', 135000, 0)].join(' | '));
  const st = V.memoryStore({ upi });
  const s = (await V.getSettings(st, deps, admin)).body;
  check('the settings carry ₹1.00 test links', s.sampleLinks?.amountPaise === 100 && /am=1\.00/.test(s.sampleLinks.upi) && s.sampleLinks.gpay.startsWith('tez://upi/pay?'));
}

// ─── 12. Files ────────────────────────────────────────────────────────────────
{
  console.log('\n§12 Files — what they are comes from their bytes');
  const want = [['png', 'image/png', 'qr'], ['jpeg', 'image/jpeg', 'qr'], ['webp', 'image/webp', 'qr'], ['mp3', 'audio/mpeg', 'sound'], ['mp3frame', 'audio/mpeg', 'sound'], ['wav', 'audio/wav', 'sound'], ['ogg', 'audio/ogg', 'sound'], ['m4a', 'audio/mp4', 'sound'], ['aac', 'audio/aac', 'sound'], ['webm', 'audio/webm', 'sound']];
  for (const [k, mime, kind] of want) {
    const s = C.sniffMedia(FILES[k]);
    check(`${k.toUpperCase()} → ${mime}`, s?.mime === mime && s.kind === kind, s);
  }
  for (const k of ['svg', 'svgXml', 'html']) check(`${k} is not kept`, C.sniffMedia(FILES[k]) === null && 'error' in C.mediaCheck('qr', FILES[k]) && 'error' in C.mediaCheck('sound', FILES[k]));
  const empty = C.mediaCheck('qr', new Uint8Array(0));
  const big = new Uint8Array(C.MAX_MEDIA_BYTES + 1);
  big.set(FILES.png);
  const tooBig = C.mediaCheck('qr', big);
  check(`empty: ${empty.status}; over 4 MB: ${tooBig.status}`, empty.status === 400 && tooBig.status === 413);
  const exact = new Uint8Array(C.MAX_MEDIA_BYTES);
  exact.set(FILES.png);
  check('exactly 4 MB is kept', C.mediaCheck('qr', exact).mime === 'image/png');

  const st = V.memoryStore();
  const q1 = await V.uploadMedia(st, deps, admin, { kind: 'qr', name: 'C:\\Users\\office\\qr code.png', bytes: FILES.png });
  const a1 = q1.body.media.qr;
  check('QR uploaded: image/png (from the bytes), the name without its folder, stored at qr/<id>.png',
    q1.status === 200 && a1.mime === 'image/png' && a1.name === 'qr code.png' && a1.size === FILES.png.length && st.files.get(`qr/${a1.id}.png`)?.mime === 'image/png');
  const n = drafts.length;
  const q2 = await V.uploadMedia(st, deps, admin, { kind: 'qr', name: 'new.jpg', bytes: FILES.jpeg });
  check('a second QR replaces the first: the old file is removed, one QR file left',
    q2.status === 200 && q2.body.media.qr.mime === 'image/jpeg' && !st.files.has(`qr/${a1.id}.png`) && [...st.files.keys()].filter((k) => k.startsWith('qr/')).length === 1 && drafts[n]?.summary === 'Official UPI QR replaced: new.jpg');
  const refusals = [
    ['a PNG as the sound', { kind: 'sound', name: 'a.png', bytes: FILES.png }, 400],
    ['an MP3 as the QR', { kind: 'qr', name: 'a.mp3', bytes: FILES.mp3 }, 400],
    ['an SVG named .png', { kind: 'qr', name: 'qr.png', bytes: FILES.svg }, 400],
    ['an HTML page', { kind: 'qr', name: 'qr.html', bytes: FILES.html }, 400],
    ['an empty file', { kind: 'sound', name: 'a.mp3', bytes: new Uint8Array(0) }, 400],
    ['over 4 MB', { kind: 'qr', name: 'big.png', bytes: big }, 413],
    ['kind "video"', { kind: 'video', name: 'a.mp4', bytes: FILES.m4a }, 400],
  ];
  const files = st.files.size;
  for (const [label, req, w] of refusals) {
    const a = await V.uploadMedia(st, deps, admin, req);
    check(`${label}: ${a.status} — ${a.body.error}`, a.status === w);
  }
  check('nothing stored by any of them', st.files.size === files);
  const s1 = (await V.uploadMedia(st, deps, admin, { kind: 'sound', name: 'bell.mp3', bytes: FILES.mp3 })).body.media.sounds[0];
  const s2 = (await V.uploadMedia(st, deps, admin, { kind: 'sound', name: 'chime.wav', bytes: FILES.wav })).body.media.sounds[1];
  check('two sounds uploaded: audio/mpeg and audio/wav', s1.mime === 'audio/mpeg' && s2.mime === 'audio/wav' && st.files.has(`sound/${s1.id}.mp3`) && st.files.has(`sound/${s2.id}.wav`));
  check('setting a sound that is not uploaded: 404', (await V.setActiveSound(st, deps, admin, { activeSoundId: 'anothere' })).status === 404);
  const act = await V.setActiveSound(st, deps, admin, { activeSoundId: s1.id });
  check('bell.mp3 made active', act.status === 200 && act.body.media.activeSoundId === s1.id);
  const ra = await V.removeMedia(st, deps, admin, s1.id);
  check(`removing the active sound: 409 "${ra.body.error}", still there`, ra.status === 409 && ra.body.error === 'Choose another active sound first.' && st.files.has(`sound/${s1.id}.mp3`));
  const rb = await V.removeMedia(st, deps, admin, s2.id);
  check('removing another sound: 200, its file gone', rb.status === 200 && rb.body.media.sounds.length === 1 && !st.files.has(`sound/${s2.id}.wav`));
  check('no active sound (a beep): then bell.mp3 may go', (await V.setActiveSound(st, deps, admin, { activeSoundId: null })).body.media.activeSoundId === null && (await V.removeMedia(st, deps, admin, s1.id)).status === 200);
  const rq = await V.removeMedia(st, deps, admin, q2.body.media.qr.id);
  check('removing the QR: the record has none, the file is gone', rq.status === 200 && rq.body.media.qr === null && ![...st.files.keys()].some((k) => k.startsWith('qr/')));
  check('removing something not uploaded: 404', (await V.removeMedia(st, deps, admin, 'agone')).status === 404);
  const broken = { ...st, changeMedia: async () => { throw new Error('crs_state update failed'); } };
  let threw = false;
  try {
    await V.uploadMedia(broken, deps, admin, { kind: 'sound', name: 'x.ogg', bytes: FILES.ogg });
  } catch {
    threw = true;
  }
  check('the record not written: the uploaded file is removed again (nothing lingers unlisted)', threw && ![...st.files.keys()].some((k) => k.endsWith('.ogg')));
}

// ─── 13. Who may fetch a file ─────────────────────────────────────────────────
{
  console.log('\n§13 Files served — a shop only the current QR and the active sound');
  const st = V.memoryStore();
  const old = (await V.uploadMedia(st, deps, admin, { kind: 'qr', name: 'old.png', bytes: FILES.png })).body.media.qr.id;
  const qr = (await V.uploadMedia(st, deps, admin, { kind: 'qr', name: 'qr.webp', bytes: FILES.webp })).body.media.qr.id;
  const on = (await V.uploadMedia(st, deps, admin, { kind: 'sound', name: 'on.mp3', bytes: FILES.mp3 })).body.media.sounds[0].id;
  const off = (await V.uploadMedia(st, deps, admin, { kind: 'sound', name: 'off.ogg', bytes: FILES.ogg })).body.media.sounds[1].id;
  await V.setActiveSound(st, deps, admin, { activeSoundId: on });
  const f1 = await V.mediaFile(st, deps, bc1, qr);
  check('the shop fetches the current QR: 200, image/webp, the bytes as uploaded', f1.status === 200 && f1.mime === 'image/webp' && Buffer.from(f1.bytes).equals(Buffer.from(FILES.webp)));
  const f2 = await V.mediaFile(st, deps, bc1, on);
  check('…and the active sound: 200, audio/mpeg', f2.status === 200 && f2.mime === 'audio/mpeg');
  check('…but not a sound that is not active: 404', (await V.mediaFile(st, deps, bc1, off)).status === 404);
  check('…nor the replaced QR: 404', (await V.mediaFile(st, deps, bc1, old)).status === 404);
  check('the administrator fetches any uploaded file (the inactive sound: 200)', (await V.mediaFile(st, deps, admin, off)).status === 200);
  check('signed out: 401; an unknown id: 404', (await V.mediaFile(st, deps, null, qr)).status === 401 && (await V.mediaFile(st, deps, bc1, 'anything')).status === 404);
}

// ─── 14. The activity log ─────────────────────────────────────────────────────
{
  console.log('\n§14 Activity — Payment Management rows; UTRs and remarks never in a summary');
  const st = V.memoryStore();
  const n = drafts.length;
  const id = (await create(st, nob(1, 'pv', '350'))).body.obligation.id;
  const pid = (await V.recordPayment(st, deps, admin, id, pay('200', { utr: 'UTRLOG77', remarks: 'collected by Murugan' }))).body.obligation.payments[0].id;
  await V.changePayment(st, deps, admin, id, pid, { action: 'correct', ...pay('200', { utr: 'UTRLOG78', remarks: 'collected by Murugan, corrected' }) });
  await V.changePayment(st, deps, admin, id, pid, { action: 'void', reason: 'bank bounced it' });
  const mine = drafts.slice(n);
  const recorded = mine.find((d) => d.action === 'created' && /recorded/.test(d.summary));
  check('"Payment ₹200.00 recorded — CRS 1 October 2026 PV Statement (balance ₹150.00)"', recorded?.summary === 'Payment ₹200.00 recorded — CRS 1 October 2026 PV Statement (balance ₹150.00)', recorded?.summary);
  check('the UTR and remarks are in its changes', recorded.changes.some((c) => c.label === 'UTR' && c.after === 'UTRLOG77') && recorded.changes.some((c) => c.label === 'Remarks' && c.after === 'collected by Murugan'));
  check('a correction names before → after in its changes', mine.some((d) => d.action === 'updated' && d.changes.some((c) => c.label === 'UTR' && c.before === 'UTRLOG77' && c.after === 'UTRLOG78')));
  check('a void: the reason in its changes, not its summary', mine.some((d) => /voided/.test(d.summary) && !d.summary.includes('bounced') && d.changes.some((c) => c.label === 'Reason' && c.after === 'bank bounced it')));
  const secrets = ['UTRLOG77', 'UTRLOG78', 'Murugan', 'bounced', SECRET_UTR, SECRET_REMARK, 'UTR4INIT', 'paid at the counter', 'UTR5ORIG', 'UTR5FIX', 'first entry', 'typo', 'entered twice'];
  const leaks = drafts.filter((d) => secrets.some((s) => String(d.summary ?? '').includes(s)));
  check(`no summary of the ${drafts.length} rows drafted in this run carries a UTR, remarks or a void reason`, leaks.length === 0, leaks.map((d) => d.summary));
  check('every row is module Payment Management, source user, with a summary', drafts.every((d) => d.module === 'Payment Management' && d.source === 'user' && d.summary));
  check('obligation rows carry the shop, the month and the record key', drafts.filter((d) => d.crsId).every((d) => d.entryMonth >= 1 && d.entryYear >= 2020 && /^pmob:/.test(d.recordKey) && d.relatedId));
  check('settings and file rows carry no shop', drafts.filter((d) => /QR|sound|UPI ID/.test(d.summary)).every((d) => d.crsId === null));
  check('actions used: created, updated, deleted, sent, acknowledged', ['created', 'updated', 'deleted', 'sent', 'acknowledged'].every((a) => drafts.some((d) => d.action === a)));
  const log = read('src/lib/activityLog/core.ts');
  check("activityLog/core.ts: 'acknowledged' in ActivityAction and ACTION_LABEL ('Acknowledged'), 'Payment Management' in MODULES",
    /\|\s*'acknowledged';/.test(log) && /acknowledged: 'Acknowledged'/.test(log) && /MODULES = \[[\s\S]*'Payment Management'[\s\S]*\];/.test(log));
}

// ─── 15. The UPI ID ───────────────────────────────────────────────────────────
{
  console.log('\n§15 UPI ID — only those two columns; never empty; 503 without 0004');
  const st = V.memoryStore({ upi: { vpa: 'old@okaxis', payeeName: 'Old' } });
  const e = await V.saveUpi(st, deps, admin, { vpa: '  ', payeeName: 'TNCSC' });
  check(`empty: 400 "${e.body.error}"`, e.status === 400 && st.upi.writes.length === 0);
  check('not a UPI ID ("office", "a@b1", "<script>@x"): 400 each',
    (await V.saveUpi(st, deps, admin, { vpa: 'office', payeeName: '' })).status === 400 && (await V.saveUpi(st, deps, admin, { vpa: 'a@b1', payeeName: '' })).status === 400 && (await V.saveUpi(st, deps, admin, { vpa: '<script>@x', payeeName: '' })).status === 400 && st.upi.writes.length === 0);
  const s = await V.saveUpi(st, deps, admin, { vpa: ' office@okaxis ', payeeName: ' TNCSC Madurai ' });
  check('saved: trimmed; the answer is the settings as now saved, with test links',
    s.status === 200 && same(st.upi.writes, [{ vpa: 'office@okaxis', payeeName: 'TNCSC Madurai', by: 'Office Admin' }]) && same(s.body.upi, { vpa: 'office@okaxis', payeeName: 'TNCSC Madurai' }) && s.body.sampleLinks?.upi.includes('pa=office%40okaxis'));
  check('the same again: nothing written', (await V.saveUpi(st, deps, admin, { vpa: 'office@okaxis', payeeName: 'TNCSC Madurai' })).status === 200 && st.upi.writes.length === 1);
  const missing = V.memoryStore({ settingsMissing: true });
  const g = await V.getSettings(missing, deps, admin);
  check('0004 not run: the settings still open (no UPI ID, no test links)', g.status === 200 && g.body.upi === null && g.body.sampleLinks === null);
  let err = null;
  try {
    await V.saveUpi(missing, deps, admin, { vpa: 'office@okaxis', payeeName: '' });
  } catch (x) {
    err = x;
  }
  check('0004 not run: saving is answered 503 "Payment settings are not installed (run 0004_payments.sql)."', err?.status === 503 && err.plain === 'Payment settings are not installed (run 0004_payments.sql).');
  const store = read('src/lib/paymentMgmt/storageStore.ts');
  const setUpi = store.slice(store.indexOf('async setUpi('), store.indexOf('pmFingerprint'));
  const patch = /const patch = \{([^}]*)\}/.exec(setUpi)?.[1] ?? '';
  check('storageStore.setUpi writes upi_vpa, upi_payee_name, updated_at, updated_by — nothing else',
    same(patch.split(',').map((s) => s.split(':')[0].trim()).filter(Boolean).sort(), ['updated_at', 'updated_by', 'upi_payee_name', 'upi_vpa']) && /\.update\(patch\)\.eq\('id', 1\)/.test(setUpi), patch);
  const all = ['src/lib/paymentMgmt/core.ts', 'src/lib/paymentMgmt/server.ts', 'src/lib/paymentMgmt/storageStore.ts', 'src/lib/paymentMgmt/routeKit.ts'].map(read).join('\n');
  check('no upsert of payment_settings, and never the /api/payments/settings route', !/upsert\(/.test(all) && !/api\/payments\/settings'/.test(all));
  check('the tariff and the switch are never named', !/enabled|statement_sheet_paise|dss_day_paise|gst_rate_bp/.test(store));
}

// ─── 16. Wiring ───────────────────────────────────────────────────────────────
{
  console.log('\n§16 Wiring — routes, the Payments screen’s tabs, nav, middleware, the live topic, delivery, storage');
  const client = read('src/lib/paymentMgmt/client.ts');
  const calls = [];
  for (const m of client.matchAll(/call<[^>]*>\(\s*(`[^`]*`|'[^']*')(?:\s*,\s*(?:json\('([A-Z]+)'|\{\s*method:\s*'([A-Z]+)'))?/g)) {
    const path = m[1].slice(1, -1).split('?')[0].replace(/\$\{[^}]*\}/g, '[*]');
    calls.push({ method: m[2] ?? m[3] ?? 'GET', path });
  }
  if (/export const mediaUrl = /.test(client)) calls.push({ method: 'GET', path: '/media/[*]' });
  const base = join(root, 'src/app/api/payment-management');
  const walk = (d) => (existsSync(d) ? readdirSync(d, { withFileTypes: true }).flatMap((e) => (e.isDirectory() ? walk(join(d, e.name)) : e.name === 'route.ts' ? [join(d, e.name)] : [])) : []);
  const routes = new Map();
  for (const f of walk(base)) {
    const key = '/' + relative(base, dirname(f)).split(/[\\/]/).filter(Boolean).join('/').replace(/\[[^\]]+\]/g, '[*]');
    const src = readFileSync(f, 'utf8');
    routes.set(key === '/' ? '' : key, { src, methods: new Set([...src.matchAll(/export async function (GET|POST|PUT|PATCH|DELETE)\b/g)].map((x) => x[1])) });
  }
  const distinct = new Set(calls.map((c) => `${c.method} ${c.path}`));
  check(`client.ts calls ${distinct.size} routes (${calls.length} calls)`, distinct.size === 15, [...distinct]);
  for (const c of calls) {
    const r = routes.get(c.path);
    check(`${c.method} /api/payment-management${c.path}: route file with that method`, !!r && r.methods.has(c.method), r ? [...r.methods] : 'no route file');
  }
  const extra = [...routes].flatMap(([p, r]) => [...r.methods].map((m) => `${m} ${p}`)).filter((x) => !calls.some((c) => `${c.method} ${c.path}` === x));
  check('no route the client does not call', extra.length === 0, extra);
  const routeSrc = [...routes.values()].map((r) => r.src);
  check("every route: runtime 'nodejs', dynamic 'force-dynamic', the handlers from lib/paymentMgmt/server",
    routeSrc.every((s) => /export const runtime = 'nodejs'/.test(s) && /export const dynamic = 'force-dynamic'/.test(s) && /from '@\/lib\/paymentMgmt\/server'/.test(s)));
  const everything = [...routeSrc, read('src/lib/paymentMgmt/routeKit.ts'), read('src/lib/paymentMgmt/storageStore.ts')].join('\n');
  check('nothing imports lib/payments/server (it pulls in the statement engine)', !/@\/lib\/payments\/server/.test(everything));
  const pure = ['src/lib/paymentMgmt/core.ts', 'src/lib/paymentMgmt/server.ts'].map((f) => [f, read(f)]);
  for (const [f, s] of pure) {
    const imports = [...s.matchAll(/^import\s+(type\s+)?[\s\S]*?from\s+'([^']+)'/gm)].filter((m) => !m[1]).map((m) => m[2]);
    check(`${f.split('/').pop()} imports no next/*, supabase or I/O module (${imports.join(', ')})`, imports.every((p) => !/^next|supabase|storageStore|routeKit|notify\/server|activityLog\/server|payments\/server/.test(p)));
  }

  // The office's change (2026-10-16, "i need that in this screen"): Payment
  // Management lives on the Payments screen, not on pages of its own.
  const layout = read('src/app/(app)/layout.tsx');
  check('nav: no Payment Management / Payment Reminders entry of its own (they are tabs and a section of Payments)',
    !/payment-management|payment-reminders|'Payment Management'|'Payment Reminders'|SHOP_ONLY/.test(layout) && /href: '\/payments', icon: '[^']*', label: 'Payments'/.test(layout));
  check('the reminder popup is mounted in the shell', /import PaymentReminderPopup from '@\/components\/PaymentReminderPopup'/.test(layout) && /<PaymentReminderPopup\s*\/>/.test(layout));
  const mw = read('src/middleware.ts');
  check('middleware: neither removed path in APP_PATHS or the matcher; /payments still guarded',
    !/payment-management|payment-reminders/.test(mw) && /'\/payments',/.test(mw) && /'\/payments\/:path\*'/.test(mw));
  const app = join(root, 'src/app/(app)');
  check('no route folder /payment-management or /payment-reminders',
    !existsSync(join(app, 'payment-management')) && !existsSync(join(app, 'payment-reminders')));
  check('the moved code is private to /payments: _management and _reminders, no page.tsx in either',
    existsSync(join(app, 'payments/_management/PaymentManagement.tsx')) && existsSync(join(app, 'payments/_reminders/ShopReminders.tsx')) &&
      !existsSync(join(app, 'payments/_management/page.tsx')) && !existsSync(join(app, 'payments/_reminders/page.tsx')));
  const pay = read('src/app/(app)/payments/page.tsx');
  const tabs = /const TABS[^=]*= \[([\s\S]*?)\];/.exec(pay)?.[1] ?? '';
  check("Payments: three tabs, Download Approvals first, then Payment Management, then UPI & Reminder Sound",
    /id: 'approvals'[\s\S]*Download Approvals[\s\S]*id: 'management'[\s\S]*Payment Management[\s\S]*id: 'settings'[\s\S]*UPI & Reminder Sound/.test(tabs));
  check('Payments: the approval queue is the default tab, ?tab= opens only management / settings, and an address naming neither (the sidebar, ?id=) goes back to the queue',
    /useState<Tab>\('approvals'\)/.test(pay) && /t === 'management' \|\| t === 'settings'\) setTab\(t\);[\s\S]{0,200}?else setTab\('approvals'\);/.test(pay));
  check('Payments: the tabs and Payment Management render for an ADMIN only; the queue only on its own tab',
    /\{isAdmin \? \(\s*<div className="pay-tabs"/.test(pay) && /\{isAdmin && tab !== 'approvals' \? <PaymentManagement view=\{tab\} focusOb=\{ob\} onDoneWithOb=\{doneWithOb\} \/> : null\}/.test(pay) && /\{isAdmin && tab !== 'approvals' \? null : \(/.test(pay));
  check("Payments: a shop user's reminders section, never an administrator's",
    /\{!isAdmin && user \? <ShopReminders ob=\{ob\}/.test(pay));
  check('Payments: the existing queue is untouched (fetchOrders, decideOrder, the payments revision, PaymentDialog, ?id=)',
    /fetchOrders\(isAdmin \? filter : 'all'\)/.test(pay) && /decideOrder\(o\.id, action, reason\)/.test(pay) && /useLiveRevision\('payments'\)/.test(pay) && /<PaymentDialog/.test(pay) && /get\('id'\)/.test(pay));
  check("Payments: ?ob=<id> opens the Payment Management tab for an administrator", /if \(o\) setTab\('management'\)/.test(pay));
  check("the reminder's link is /payments?ob=<id>", /reminderLink = \(id: string\) => `\/payments\?ob=\$\{encodeURIComponent\(id\)\}`/.test(read('src/lib/paymentMgmt/core.ts')));
  check('the shop section hides itself when there is no reminder', /if \(!all\.length && !ob\) return null;/.test(read('src/app/(app)/payments/_reminders/ShopReminders.tsx')));

  const sync = read('src/app/api/sync/route.ts');
  const ds = read('src/lib/dataStore.ts');
  check("/api/sync answers 'paymgmt' with pmFingerprint", /topics\.includes\('paymgmt'\)\) body\.paymgmt = await pmFingerprint\(session\)/.test(sync));
  check("dataStore: 'paymgmt' a LiveTopic, a revision, a watcher, read from the answer",
    /export type LiveTopic = [^;]*'paymgmt'/.test(ds) && /revisions: Record<LiveTopic[^;]*paymgmt: ''/.test(ds) && /watchers: Record<WatchedTopic[^;]*paymgmt: 0/.test(ds) && /paymgmt\?: string \} \| null/.test(ds) && /\['clears', 'payments', 'activity', 'inbox', 'paymgmt'\] as const/.test(ds));
  const store = read('src/lib/paymentMgmt/storageStore.ts');
  check("fingerprint: an administrator every record, a shop only its own (.contains crsId), '' with no shop",
    /export async function pmFingerprint/.test(store) && /if \(!admin\) q = q\.like\('store_key', `\$\{OB_PREFIX\}%`\)\.contains\('data', \{ crsId \}\)/.test(store) && /return '';/.test(store));
  check("records under scope 'payment_mgmt' (never 'global'), written under version, listed in pages",
    /PM_SCOPE = 'payment_mgmt'/.test(store) && /\.eq\('version', version\)/.test(store) && /\.range\(from, from \+ PAGE - 1\)/.test(store) && !/\.eq\('scope', 'global'\)/.test(store) && (store.match(/\.eq\('scope', PM_SCOPE\)/g) ?? []).length >= 4);
  check("a shop's own by .contains('data', { crsId }) — never a LIKE on the key with its number",
    /\.contains\('data', \{ crsId \}\)/.test(store) && !/like\('store_key', `pmob:\$\{crsId/.test(store));
  check("files in a private bucket 'payment-media' the server creates, 4 MB, images and audio only",
    /PM_BUCKET = 'payment-media'/.test(store) && /createBucket\(PM_BUCKET, \{\s*public: false,\s*fileSizeLimit: MAX_MEDIA_BYTES/.test(store) && !/svg|html/i.test(/allowedMimeTypes: \[([^\]]*)\]/.exec(store)?.[1] ?? 'svg'));
  const notify = read('src/lib/notify/server.ts');
  const fn = notify.slice(notify.indexOf('export async function notifyShopPayment'), notify.indexOf('// ── Reading one person'));
  check("delivery: notifyShopPayment — that shop's BC and Packer from the users table; SYSTEM, urgent, status 'sent', module 'payment-management'",
    /mode: 'shop', crsId: input\.crsId, roles: \['BC', 'Packer'\]/.test(fn) && /resolveAudience\(await roster\(\)/.test(fn) && /type: 'SYSTEM'/.test(fn) && /priority: 'urgent'/.test(fn) && /status: 'sent'/.test(fn) && /module: 'payment-management'/.test(fn) && /status: 400/.test(fn) && /status: 503/.test(fn));
  const kit = read('src/lib/paymentMgmt/routeKit.ts');
  check('the route kit: the session from the cookie, delivery by notifyShopPayment, activity after the answer, OK acknowledges the notification',
    /decodeSession\(jar\.get\(SESSION_COOKIE\)/.test(kit) && /notifyShopPayment\(input\)/.test(kit) && /after\(\(\) => recordActivity\(session, drafts\)\)/.test(kit) && /markForUser\(userId, notificationId, 'acknowledge'\)/.test(kit));
  const media = read('src/app/api/payment-management/media/[assetId]/route.ts');
  const br = (h, n = 1000) => JSON.stringify(C.byteRange(h, n));
  check('byte ranges, as an iPhone asks for a sound: bytes=0-1 → [0,1], 0- → whole, -100 → last 100, past the end → 416, none / several → the whole file',
    br('bytes=0-1') === '[0,1]' && br('bytes=0-') === '[0,999]' && br('bytes=-100') === '[900,999]' && br('bytes=500-5000') === '[500,999]' && br('bytes=1000-') === '"unsatisfiable"' && br(null) === 'null' && br('bytes=0-1,5-9') === 'null' && br('bytes=-0') === '"unsatisfiable"',
    [br('bytes=0-1'), br('bytes=-100'), br('bytes=1000-')].join(' '));
  check('the file route answers a Range with 206 + Content-Range, past the end with 416, and always says Accept-Ranges',
    /status: 206/.test(media) && /'Content-Range': `bytes \$\{start\}-\$\{end\}\/\$\{buf\.length\}`/.test(media) && /status: 416/.test(media) && /'Accept-Ranges': 'bytes'/.test(media) && /byteRange\(req\.headers\.get\('range'\)/.test(media));
  check('a file is served inline with its own type, nosniff, cached privately', /'Content-Disposition': 'inline'/.test(media) && /'X-Content-Type-Options': 'nosniff'/.test(media) && /'Cache-Control': 'private, max-age=31536000, immutable'/.test(media) && /'Content-Type': f\.mime!/.test(media));
  const up = read('src/app/api/payment-management/media/route.ts');
  check('an upload says its size before it is read: over 4 MB answers 413', /content-length/.test(up) && /status: 413/.test(up));
  const pkg = read('package.json');
  check('package.json: verify:payment-mgmt, right after verify:payment-gate', /"verify:payment-gate": "node tools\/verify-payment-gate\.mjs",\s*\n\s*"verify:payment-mgmt": "node tools\/verify-payment-mgmt\.mjs"/.test(pkg));
  const reads = ['src/app/api/state/route.ts', 'src/app/api/sync/route.ts', 'src/lib/clearExecute.ts', 'src/app/api/activity/route.ts'].map(read);
  check("the app's own crs_state reads stay on scope global (these records never reach /api/state)", reads.every((s) => /\.eq\('scope', 'global'\)/.test(s)));
}

console.log(failures ? `\n${failures} FAILED\n` : '\nall passed\n');
process.exit(failures ? 1 : 0);
