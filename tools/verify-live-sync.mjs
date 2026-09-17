/**
 * Live sync, as executable cases.
 *
 *   node tools/verify-live-sync.mjs
 *
 * Two things are under test.
 *
 * src/lib/storeMerge.ts decides what survives when two people write the same
 * crs_state row — which, with every shop's day sheets in one row, is ordinary.
 *
 * src/lib/dataStore.ts is then driven for real, against an in-memory stand-in
 * for /api/state and /api/sync that enforces versions the way the route does:
 * another shop saving between this client's read and its save, a store written
 * elsewhere arriving while this client has unsaved typing, an approved clear
 * removing a day, a clear request being decided. The stand-in writes the other
 * side's changes straight into its rows, exactly as another browser would.
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
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);
const clone = (v) => JSON.parse(JSON.stringify(v));

const { rebaseStore } = await import(pathToFileURL(join(root, 'src/lib/storeMerge.ts')).href);

console.log('\nWhat survives a conflict (storeMerge.ts)');
{
  const remote = { '5_2026-09-17': { s: 5 } };
  check('with nothing unsaved, the server’s copy is taken as it is', rebaseStore('entryStore', {}, {}, remote) === remote);

  const base = { '1_2026-09-16': { s: 1 } };
  const local = { '1_2026-09-16': { s: 1 }, '1_2026-09-17': { s: 17 } };
  const theirs = { '1_2026-09-16': { s: 1 }, '5_2026-09-17': { s: 5 } };
  check('two shops saving at once both keep their day', same(rebaseStore('entryStore', base, local, theirs), { '1_2026-09-16': { s: 1 }, '5_2026-09-17': { s: 5 }, '1_2026-09-17': { s: 17 } }));

  check('the same record changed on both sides keeps this client’s copy',
    same(rebaseStore('entryStore', { k: { v: 1 } }, { k: { v: 2 } }, { k: { v: 3 } }), { k: { v: 2 } }));
  check('a record this client removed stays removed',
    same(rebaseStore('entryStore', { k: { v: 1 }, j: { v: 1 } }, { j: { v: 1 } }, { k: { v: 1 }, j: { v: 1 }, x: { v: 9 } }), { j: { v: 1 }, x: { v: 9 } }));
  check('a record removed elsewhere (an approved clear) is not brought back by an untouched client',
    same(rebaseStore('entryStore', { k: { v: 1 }, j: { v: 1 } }, { k: { v: 1 }, j: { v: 2 } }, { j: { v: 1 } }), { j: { v: 2 } }));

  const rb = [{ id: 1, q: 1 }, { id: 5, q: 5 }, { id: 7, q: 7 }];
  const rl = [{ id: 1, q: 1 }, { id: 7, q: 7 }, { id: 11, q: 11 }];
  const rr = [{ id: 1, q: 1 }, { id: 5, q: 5 }, { id: 7, q: 70 }, { id: 12, q: 12 }];
  check('receipts merge by id: both new rows kept, the deleted one gone, the other side’s edit kept',
    same(rebaseStore('receiptStore', rb, rl, rr), [{ id: 1, q: 1 }, { id: 7, q: 70 }, { id: 12, q: 12 }, { id: 11, q: 11 }]), JSON.stringify(rebaseStore('receiptStore', rb, rl, rr)));
  check('counters never go backwards', rebaseStore('__counters', { rpNextId: 10 }, { rpNextId: 11 }, { rpNextId: 12 }).rpNextId === 12 &&
    rebaseStore('__counters', { rpNextId: 10 }, { rpNextId: 13 }, { rpNextId: 12 }).rpNextId === 13);
  check('an id-less row the other side removed is not resurrected', same(rebaseStore('x', [{ a: 1 }], [{ a: 1 }, { b: 2 }], []), [{ b: 2 }]));
}

// ── The data layer, driven against a stand-in server ────────────────────────
const server = {
  rows: {
    entryStore: { data: { '1_2026-09-16': { a: { BRA: { sales: 1 } } } }, version: 4 },
    receiptStore: { data: [{ id: 1 }], version: 2 },
    __counters: { data: { rpNextId: 2 }, version: 1 },
    __clearRequests: { data: { requests: [] }, version: 9 },
  },
  calls: [],
  /** What another browser does: write straight into the rows. */
  otherSaves(key, mutate) {
    const row = this.rows[key];
    row.data = mutate(clone(row.data));
    row.version++;
  },
};
const CLEAR_KEY = '__clearRequests';
const json = (status, body) => ({ ok: status >= 200 && status < 300, status, json: async () => body });

globalThis.fetch = async (url, init = {}) => {
  const u = new URL(url, 'http://local');
  server.calls.push(`${init.method ?? 'GET'} ${u.pathname}${u.search}`);
  if (u.pathname === '/api/users') return json(200, { users: [] });
  if (u.pathname === '/api/sync') {
    const versions = {};
    for (const [k, r] of Object.entries(server.rows)) if (k !== CLEAR_KEY) versions[k] = r.version;
    const body = { versions, clears: server.rows[CLEAR_KEY].version };
    if ((u.searchParams.get('topics') ?? '').includes('payments')) body.payments = 'p1';
    return json(200, body);
  }
  if (u.pathname === '/api/state' && (init.method ?? 'GET') === 'GET') {
    const keys = (u.searchParams.get('keys') ?? '').split(',').filter(Boolean);
    const stores = {};
    const versions = {};
    for (const [k, r] of Object.entries(server.rows)) {
      if (k === CLEAR_KEY || (keys.length && !keys.includes(k))) continue;
      stores[k] = clone(r.data);
      versions[k] = r.version;
    }
    return json(200, { stores, versions });
  }
  if (u.pathname === '/api/state' && init.method === 'POST') {
    const body = JSON.parse(init.body);
    const saved = {};
    const conflicts = [];
    for (const [k, value] of Object.entries(body.stores)) {
      const row = server.rows[k];
      const expected = Number(body.versions[k] ?? 0);
      if ((row?.version ?? 0) !== expected) {
        conflicts.push(k);
        continue;
      }
      server.rows[k] = { data: clone(value), version: expected + 1 };
      saved[k] = expected + 1;
    }
    return conflicts.length ? json(409, { error: 'conflict', conflicts, versions: saved }) : json(200, { ok: true, versions: saved });
  }
  return json(404, {});
};

const { crsData } = await import(pathToFileURL(join(root, 'src/lib/dataStore.ts')).href);
let emits = 0;
crsData.subscribe(() => emits++);

console.log('\nThe data layer');
{
  check('loads', (await crsData.load()) === true && same(crsData.get('entryStore'), server.rows.entryStore.data));

  // Another shop saves its day between this client's read and its save.
  crsData.update('entryStore', (d) => {
    d['1_2026-09-17'] = { a: { BRA: { sales: 17 } } };
  });
  server.otherSaves('entryStore', (d) => ({ ...d, '5_2026-09-17': { a: { BRA: { sales: 5 } } } }));
  server.calls.length = 0;
  const ok = await crsData.save();
  check('a save that meets another shop’s save still succeeds', ok === true, server.calls.join(' → '));
  check('...after a 409, a fetch of just that store, and a second POST',
    same(server.calls, ['POST /api/state', 'GET /api/state?keys=entryStore', 'POST /api/state']), server.calls.join(' → '));
  check('...and the database holds BOTH days — nothing was reloaded away',
    '1_2026-09-17' in server.rows.entryStore.data && '5_2026-09-17' in server.rows.entryStore.data);
  check('...and so does this screen', '1_2026-09-17' in crsData.get('entryStore') && '5_2026-09-17' in crsData.get('entryStore'));
  check('a second save finds nothing left to send', (await crsData.save()) === false);

  // A receipt saved elsewhere arrives on the next beat.
  server.otherSaves('receiptStore', (d) => [...d, { id: 2 }]);
  server.calls.length = 0;
  const before = emits;
  await crsData.poll();
  check('a beat notices the other store and fetches only it', same(server.calls, ['GET /api/sync', 'GET /api/state?keys=receiptStore']), server.calls.join(' → '));
  check('...and the screen now shows it', same(crsData.get('receiptStore'), [{ id: 1 }, { id: 2 }]));
  check('...waking the components that read the stores', emits > before);

  // A quiet beat changes nothing and fetches nothing.
  server.calls.length = 0;
  const quiet = emits;
  await crsData.poll();
  check('a quiet beat asks /api/sync and nothing else', same(server.calls, ['GET /api/sync']));
  check('...and re-renders nothing', emits === quiet);

  // Unsaved typing here while an approved clear removes another day elsewhere.
  crsData.update('entryStore', (d) => {
    d['1_2026-09-18'] = { a: { BRA: { sales: 18 } } };
  });
  server.otherSaves('entryStore', (d) => {
    const n = { ...d };
    delete n['5_2026-09-17'];
    return n;
  });
  await crsData.poll();
  const mine = crsData.get('entryStore');
  check('a change arriving mid-typing keeps the unsaved day on screen', '1_2026-09-18' in mine);
  check('...and applies the other side’s removal', !('5_2026-09-17' in mine));
  check('...and the next save sends the unsaved day without a conflict', (await crsData.save()) === true && '1_2026-09-18' in server.rows.entryStore.data && !('5_2026-09-17' in server.rows.entryStore.data));

  // A clear request decided elsewhere.
  const rev = crsData.getRevision('clears');
  server.otherSaves(CLEAR_KEY, (d) => d);
  await crsData.poll();
  check('a clear request decided elsewhere moves the clears revision', crsData.getRevision('clears') !== rev);
  check('...without the request record ever being fetched into this browser', crsData.get(CLEAR_KEY) === undefined);

  // Payments only while a screen showing orders is open.
  server.calls.length = 0;
  await crsData.poll();
  check('orders are not asked about when no screen shows them', !server.calls.some((c) => c.includes('topics=payments')));
  const unwatch = crsData.watch('payments');
  await new Promise((r) => setTimeout(r, 0));
  await crsData.poll();
  check('...and are while one does', server.calls.some((c) => c.includes('topics=payments')) && crsData.getRevision('payments') === 'p1');
  unwatch();
}

console.log(`\n${failures ? `${failures} FAILED` : 'LIVE SYNC OK'}`);
process.exitCode = failures ? 1 : 0;
