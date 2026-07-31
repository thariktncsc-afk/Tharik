/**
 * Dumps every crs_state store plus the users roster to public/golden-stores.json,
 * where the golden-snapshot harness (tools/capture-goldens note in golden/README)
 * loads it into the running engine. Part of the Next.js conversion safety net —
 * see golden/README.md.
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { createClient } from '@supabase/supabase-js';

readFileSync('.env.local', 'utf8').split('\n').forEach((l) => {
  const m = l.match(/^([A-Z_]+)=(.*)$/);
  if (m) process.env[m[1]] = m[2].trim();
});
const db = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, {
  auth: { persistSession: false },
});

const { data: rows, error } = await db.from('crs_state').select('store_key, data').eq('scope', 'global');
if (error) { console.error(error.message); process.exit(1); }

const stores = {};
for (const r of rows) stores[r.store_key] = r.data;

const { data: users, error: uerr } = await db
  .from('users')
  .select('id, username, full_name, phone, email, role, crs_id, active, created_at')
  .order('id');
if (uerr) { console.error(uerr.message); process.exit(1); }

const userStore = users.map((r) => ({
  id: r.id, fullName: r.full_name ?? '', username: r.username ?? '',
  phone: r.phone ?? '', email: r.email ?? '', role: r.role ?? '',
  crsId: r.crs_id, active: r.active !== false, createdAt: String(r.created_at ?? '').slice(0, 10),
}));

writeFileSync('public/golden-stores.json', JSON.stringify({ stores, userStore }));
console.log(`public/golden-stores.json: ${Object.keys(stores).length} store(s), ${userStore.length} user(s)`);
