/**
 * The save-success confirmation, as executable cases.
 *
 *   node tools/verify-save-success.mjs
 *
 * Two things are under test.
 *
 * src/lib/saveSuccess.ts — what the popup says for each of the three saves
 * (Daily Sales, Monthly Sales, Receipt), and when a second press is the same
 * save rather than a new one.
 *
 * src/lib/dataStore.ts `saveConfirmed()` — the answer the popup is gated on.
 * `save()` returns false for three different things: a refusal, a save
 * already in flight, and nothing left to send; only the first is a failure.
 * The autosave beat runs every 5 s, so a clerk pressing save lands on the
 * other two often enough to matter, and a tick that goes missing on a save
 * that DID land is as bad as one that appears for a save that did not. Both
 * directions are checked here against an in-memory stand-in for /api/state
 * that enforces versions the way the route does.
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
const clone = (v) => JSON.parse(JSON.stringify(v));

const S = await import(pathToFileURL(join(root, 'src/lib/saveSuccess.ts')).href);

console.log('\nWhat the popup says — the office’s three saves');
{
  const d = S.dailySaved(7, '2026-09-16');
  check('Daily Sales: title', d.title === 'Daily Sales Saved Successfully', d.title);
  check('Daily Sales: names the exact date, 16-09-2026', d.detail === 'Daily Sales for 16-09-2026 has been saved successfully.', d.detail);

  const m = S.monthlySaved(7, 9, 2026);
  check('Monthly Sales: title', m.title === 'Monthly Sales Saved Successfully', m.title);
  check('Monthly Sales: names the month, September 2026', m.detail === 'Monthly Sales for September 2026 has been saved successfully.', m.detail);

  const r = S.receiptSaved(41, '2026-09-16');
  check('Receipt: title', r.title === 'Receipt Saved Successfully', r.title);
  check('Receipt: names the receipt’s date', r.detail === 'Receipt for 16-09-2026 has been saved successfully.', r.detail);

  check('every month reads properly', S.monthLabel(1, 2026) === 'January 2026' && S.monthLabel(12, 2025) === 'December 2025');
  check('a date is never printed half-formed', S.fmtSavedDate('') === '' && S.fmtSavedDate('2026-09') === '2026-09');
}

console.log('\nOne press, one popup');
{
  const now = 1_000_000;
  const first = S.dailySaved(7, '2026-09-16');
  const last = { key: first.key, at: now };
  check('the same save pressed twice shows once', S.isRepeat(last, first.key, now + 50));
  check('…still the same save a moment after it left', S.isRepeat(last, first.key, now + S.HOLD_MS + S.LEAVE_MS + 500));
  check('…but a later save of the same day is a new confirmation', !S.isRepeat(last, first.key, now + S.HOLD_MS + S.LEAVE_MS + S.REPEAT_MS + 1));
  check('another date is never treated as a repeat', !S.isRepeat(last, S.dailySaved(7, '2026-09-17').key, now + 50));
  check('another shop, same date, is not a repeat', !S.isRepeat(last, S.dailySaved(8, '2026-09-16').key, now + 50));
  check('Daily, Monthly and Receipt never collide', new Set([first.key, S.monthlySaved(7, 9, 2026).key, S.receiptSaved(41, '2026-09-16').key]).size === 3);
  check('nothing shown yet is never a repeat', !S.isRepeat(null, first.key, now));
}

// ── saveConfirmed(), against a stand-in /api/state ──────────────────────────
const server = {
  rows: { entryStore: { data: { '7_2026-09-15': { a: {} } }, version: 3 } },
  refuse: false,
  /** Held open to keep a save in flight while the clerk presses the button. */
  gate: null,
};
const json = (status, body) => ({ ok: status >= 200 && status < 300, status, json: async () => body });

globalThis.fetch = async (url, init = {}) => {
  const u = new URL(url, 'http://local');
  if (u.pathname === '/api/users') return json(200, { users: [] });
  if (u.pathname === '/api/sync') return json(200, { versions: Object.fromEntries(Object.entries(server.rows).map(([k, r]) => [k, r.version])) });
  if (u.pathname === '/api/state' && (init.method ?? 'GET') === 'GET') {
    const stores = {};
    const versions = {};
    for (const [k, r] of Object.entries(server.rows)) {
      stores[k] = clone(r.data);
      versions[k] = r.version;
    }
    return json(200, { stores, versions });
  }
  if (u.pathname === '/api/state' && init.method === 'POST') {
    if (server.gate) await server.gate;
    if (server.refuse) return json(403, { error: 'That change was refused.' });
    const body = JSON.parse(init.body);
    const saved = {};
    for (const [k, value] of Object.entries(body.stores)) {
      const expected = Number(body.versions[k] ?? 0);
      if ((server.rows[k]?.version ?? 0) !== expected) return json(409, { error: 'conflict', conflicts: [k], versions: saved });
      server.rows[k] = { data: clone(value), version: expected + 1 };
      saved[k] = expected + 1;
    }
    return json(200, { ok: true, versions: saved });
  }
  return json(404, {});
};

const { crsData } = await import(pathToFileURL(join(root, 'src/lib/dataStore.ts')).href);
const keyed = (day, sales) =>
  crsData.update('entryStore', (d) => {
    d[`7_2026-09-${day}`] = { a: { BRA: { sales } } };
  });

console.log('\nThe tick waits for the database (dataStore.saveConfirmed)');
{
  check('loads', (await crsData.load()) === true);

  keyed('16', 100);
  check('a day that saves cleanly is confirmed', (await crsData.saveConfirmed()) === true);
  check('…and the database holds it', server.rows.entryStore.data['7_2026-09-16'].a.BRA.sales === 100);

  check('pressing save again with nothing new is still "stored"', (await crsData.saveConfirmed()) === true);

  // The autosave beat is mid-flight when the clerk presses save. save() alone
  // answers false here — the day IS saved, and a missing tick would send the
  // clerk to key it a second time.
  keyed('17', 170);
  let open;
  server.gate = new Promise((r) => (open = r));
  const inFlight = crsData.save();
  const pressed = crsData.saveConfirmed();
  open();
  server.gate = null;
  const [beat, confirmed] = await Promise.all([inFlight, pressed]);
  check('a save already in flight does not lose the tick', beat === true && confirmed === true, `autosave=${beat} pressed=${confirmed}`);
  check('…and the day really is in the database', server.rows.entryStore.data['7_2026-09-17'].a.BRA.sales === 170);

  // A refusal must NOT be confirmed: a locked Opening, a day needing approval.
  server.refuse = true;
  keyed('18', 180);
  check('a refused save shows no tick', (await crsData.saveConfirmed()) === false);
  check('…and the database does not hold the day', !server.rows.entryStore.data['7_2026-09-18']);
  server.refuse = false;

  // The refusal took the server's copy back; the next real save is confirmed
  // again rather than being poisoned by the earlier failure.
  keyed('19', 190);
  check('a good save after a refusal is confirmed again', (await crsData.saveConfirmed()) === true && server.rows.entryStore.data['7_2026-09-19'].a.BRA.sales === 190);
}

console.log('\nThe tick comes the moment the database answers (office, 2026-09-22)');
{
  // A save in flight is WAITED ON, not polled: the answer to the press
  // arrives within a few ms of the save landing. It used to check every
  // 120 ms, which could hold the tick back that long after the save was in.
  keyed('20', 200);
  let open;
  server.gate = new Promise((r) => (open = r));
  const inFlight = crsData.save();
  let answeredAt = 0;
  const pressed = crsData.saveConfirmed().then((v) => ((answeredAt = performance.now()), v));
  await new Promise((r) => setTimeout(r, 30)); // the save is held open for a moment
  const landedAt = performance.now();
  open();
  server.gate = null;
  await inFlight;
  const ok = await pressed;
  const lag = Math.round(answeredAt - landedAt);
  check(`the press is answered as soon as the save lands (${lag} ms after, no 120 ms polling step)`, ok === true && lag < 60, `lag ${lag} ms`);

  // Two presses in the same instant send the records once.
  let posts = 0;
  const realFetch = globalThis.fetch;
  globalThis.fetch = (url, init = {}) => {
    if (String(url).includes('/api/state') && init.method === 'POST') posts++;
    return realFetch(url, init);
  };
  keyed('21', 210);
  const [a, b] = await Promise.all([crsData.saveConfirmed(), crsData.saveConfirmed()]);
  globalThis.fetch = realFetch;
  check('a double press sends ONE save request, and both presses are answered "stored"', posts === 1 && a === true && b === true, `posts=${posts} a=${a} b=${b}`);
  check('…and the day is in the database', server.rows.entryStore.data['7_2026-09-21'].a.BRA.sales === 210);

  // A failed save still shows no tick, however quickly it fails.
  server.refuse = true;
  keyed('22', 220);
  check('a refused save is answered "not stored" (no tick) — speed never overrides the database', (await crsData.saveConfirmed()) === false && !server.rows.entryStore.data['7_2026-09-22']);
  server.refuse = false;
}

console.log(failures ? `\n${failures} FAILED` : '\nSAVE SUCCESS OK');
process.exitCode = failures ? 1 : 0;
