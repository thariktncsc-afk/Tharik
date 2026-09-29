/**
 * Republish chosen commodity rows of ONE shop's stored month (monthlyStore)
 * from the current roll-up — exactly what Monthly Entry would publish for
 * them — leaving every other row of that month, and every other month,
 * byte-for-byte as stored.
 *
 *   node tools/republish-month-rows.mjs --crs=8 --month=9 --year=2026 --ids=SALT_CIS            dry run
 *   node tools/republish-month-rows.mjs --crs=8 --month=9 --year=2026 --ids=SALT_CIS --write    apply
 *
 * For a stored month the roll-up got wrong (2026-09-29: an Opening taken from
 * a later day that already carried a receipt the month also counted — see
 * monthlyRollup.ts). Before writing, each row must be a Daily-keyed row
 * (meSourceStore 'daily') whose republished Closing equals the Closing of the
 * month's last day sheet — what Daily Entry shows — and add up
 * (Opening + Receipt + Excess − Shortage − Transfer = Total, Total − Sales =
 * Closing). The row is backed up to backups/ and written under version.
 * Run from a tree that carries the roll-up fix.
 */
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { createRequire, register } from 'node:module';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const srcUrl = pathToFileURL(join(root, 'src') + '/').href;
register(
  `data:text/javascript,${encodeURIComponent(`
export async function resolve(spec, ctx, next) {
  if (spec.startsWith('@/')) return next(${JSON.stringify(srcUrl)} + spec.slice(2) + (/\\.[a-z]+$/.test(spec) ? '' : '.ts'), ctx);
  return next(spec, ctx);
}`)}`,
  import.meta.url,
);
readFileSync(join(root, '.env.local'), 'utf8').split('\n').forEach((l) => {
  const m = l.match(/^([A-Z_]+)=(.*)$/);
  if (m) process.env[m[1]] = m[2].trim();
});
const { createClient } = createRequire(join(root, 'package.json'))('@supabase/supabase-js');
const db = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } });
const { rebuildMonthlyFromDaily } = await import(pathToFileURL(join(root, 'src/lib/engine/monthlyRollup.ts')).href);

async function main() {
  const arg = (name) => process.argv.find((a) => a.startsWith(`--${name}=`))?.slice(name.length + 3);
  const crsId = Number(arg('crs'));
  const month = Number(arg('month'));
  const year = Number(arg('year'));
  const ids = (arg('ids') ?? '').split(',').map((s) => s.trim()).filter(Boolean);
  const write = process.argv.includes('--write');
  if (!Number.isInteger(crsId) || !Number.isInteger(month) || !Number.isInteger(year) || !ids.length) {
    console.error('Usage: node tools/republish-month-rows.mjs --crs=<n> --month=<1-12> --year=<yyyy> --ids=<ID,ID…> [--write]');
    return 2;
  }
  const key = `${crsId}_${month}_${year}`;
  const { data, error } = await db.from('crs_state').select('store_key,data,version').eq('scope', 'global').in('store_key', ['entryStore', 'inspectionStore', 'meManualStore', 'receiptStore', 'monthlyStore', 'meSourceStore']);
  if (error) throw error;
  const s = Object.fromEntries(data.map((r) => [r.store_key, r.data]));
  const monthly = data.find((r) => r.store_key === 'monthlyStore');
  const stored = s.monthlyStore?.[key];
  if (!stored) {
    console.error(`No stored month ${key} — nothing to republish.`);
    return 1;
  }
  const { merged } = rebuildMonthlyFromDaily(crsId, month, year, s.entryStore, s.inspectionStore, s.meManualStore?.[key], undefined, s.receiptStore);
  const mm = String(month).padStart(2, '0');
  const lastSheet = Object.keys(s.entryStore).filter((k) => k.startsWith(`${crsId}_${year}-${mm}-`) && !s.entryStore[k]?.__projection).sort().pop();
  console.log(`monthlyStore v${monthly.version} · ${key} · last day sheet ${lastSheet ?? '(none)'}`);

  const problems = [];
  const nextMonth = { a: { ...(stored.a ?? {}) }, b: { ...(stored.b ?? {}) } };
  for (const id of ids) {
    const sec = merged.a?.[id] ? 'a' : merged.b?.[id] ? 'b' : null;
    if (!sec) { problems.push(`${id}: not in the republished month`); continue; }
    const now = stored[sec]?.[id];
    const nu = merged[sec][id];
    const src = s.meSourceStore?.[key]?.[sec]?.[id];
    if (src !== 'daily') problems.push(`${id}: source is ${src ?? 'none'}, not 'daily' — a hand-keyed row is the clerk's, not the roll-up's`);
    const last = Number(s.entryStore[lastSheet]?.[sec]?.[id]?.close);
    if (!(Math.abs(last - nu.close) < 0.0005)) problems.push(`${id}: republished Closing ${nu.close} ≠ last day sheet's ${last}`);
    const t = nu.open + nu.receipt + (nu.excess || 0) - (nu.shortage || 0) - (nu.transfer || 0);
    if (Math.abs(t - nu.total) > 0.0005 || Math.abs(nu.total - nu.sales - nu.close) > 0.0005) problems.push(`${id}: republished row does not add up`);
    const f = (r) => `open ${r?.open} rcp ${r?.receipt} tot ${r?.total} sal ${r?.sales} cls ${r?.close}`;
    console.log(`  ${id}: stored  ${f(now)}\n  ${' '.repeat(id.length)}  becomes ${f(nu)}   (last day sheet closes at ${last})`);
    nextMonth[sec][id] = nu;
  }
  if (problems.length) {
    console.error('Refused:\n  ' + problems.join('\n  '));
    return 1;
  }
  const untouched = [...Object.keys(stored.a ?? {}), ...Object.keys(stored.b ?? {})].filter((id) => !ids.includes(id));
  console.log(`  ${untouched.length} other row(s) of ${key} and every other month stay exactly as stored`);
  // Keys sorted: the database hands JSONB back in its own key order, which is not a change.
  const canon = (v) => JSON.stringify(v, (_k, x) => (x && typeof x === 'object' && !Array.isArray(x) ? Object.fromEntries(Object.entries(x).sort(([p], [q]) => p.localeCompare(q))) : x));
  if (ids.every((id) => canon(stored.a?.[id] ?? stored.b?.[id]) === canon(nextMonth.a[id] ?? nextMonth.b[id]))) {
    console.log('Already so — nothing to write.');
    return 0;
  }
  if (!write) {
    console.log('DRY RUN — pass --write to apply.');
    return 0;
  }
  mkdirSync(join(root, 'backups'), { recursive: true });
  const file = join(root, 'backups', `republish-${key}-${ids.join('+')}-${new Date().toISOString().replace(/[:.]/g, '-')}.json`);
  writeFileSync(file, JSON.stringify({ key, ids, before: stored, after: nextMonth, version: monthly.version }, null, 1));
  console.log(`Backed up ${key} to ${file}`);
  const { data: upd, error: e2 } = await db
    .from('crs_state')
    .update({ data: { ...s.monthlyStore, [key]: nextMonth }, version: Number(monthly.version) + 1, updated_at: new Date().toISOString(), updated_by: 'republish-month-rows' })
    .eq('scope', 'global')
    .eq('store_key', 'monthlyStore')
    .eq('version', monthly.version)
    .select('version');
  if (e2) throw e2;
  if (!upd?.length) {
    console.error('Refused: monthlyStore changed since it was read. Nothing was written — run it again.');
    return 1;
  }
  console.log(`WROTE monthlyStore v${monthly.version} → v${upd[0].version}: ${key} ${ids.join(', ')}`);
  return 0;
}
// Returned, not process.exit(): exiting while the database socket closes trips a
// libuv assertion on Windows (exit 127) even when all went well.
process.exitCode = await main();
