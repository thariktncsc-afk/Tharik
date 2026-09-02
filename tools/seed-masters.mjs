/**
 * Seeds the master data the converted screens read from crs_state, replacing
 * the values that were hardcoded in src/lib/engine/*.ts:
 *
 *   __shops            all 30 Madurai shops with the office's real names
 *                      (the row previously held the port's nine demo shops)
 *   __commodityMaster  full commodity records — id, Tamil/English names,
 *                      unit, rate, free flag, section (a=main, b=police),
 *                      display order, active flag, and crs29Only for the
 *                      camp's kerosene
 *
 * The frontend keeps the same values as compiled-in FALLBACKS only (used
 * before the first load or if a row is missing); after this seed the
 * database is authoritative and the Commodities / CRS Shops screens edit it.
 *
 *   node tools/seed-masters.mjs            # seeds missing / demo-sized rows
 *   node tools/seed-masters.mjs --force    # overwrites both rows outright
 */
import { readFileSync } from 'node:fs';
import { createClient } from '@supabase/supabase-js';

readFileSync('.env.local', 'utf8').split('\n').forEach((l) => {
  const m = l.match(/^([A-Z_]+)=(.*)$/);
  if (m) process.env[m[1]] = m[2].trim();
});
const db = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, {
  auth: { persistSession: false },
});
const FORCE = process.argv.includes('--force');

// ── The office's data, transcribed from the engine sources ──────────────────
const CRS_NAMES = {
  1: 'அண்ணா நகர்', 2: 'கே. கே. நகர்', 3: 'காந்திபுரம் – புதுார்', 4: 'மானகிரி',
  5: 'காமராஜர் சாலை', 6: 'இஸ்மாயில்புரம்', 7: 'இராமசாமி அய்யர் சாலை', 8: 'NMR ரோடு காமராஜபுரம்',
  9: 'பாலரெங்காபுரம்', 10: 'சின்ன அனுப்பானடி', 11: 'அனுப்பானடி', 12: 'மீனாட்சிபுரம்',
  13: 'திருமால் நதி சாலை', 14: 'கார்பன்கடை', 15: 'ராஜா தெரு', 16: 'சிம்மக்கல்',
  17: 'பழங்காநத்தம்', 18: 'மேல்பொன்னகரம் பிராட்வே', 19: 'காக்காதோப்பு', 20: 'சுப்பிரமணியபுரம்',
  21: 'வி.பி. சதுக்கம்', 22: 'மேற்கு பொன்னகரம்', 23: 'திருமலை காலனி', 24: 'ஜெய்ஹிந்புரம்',
  25: 'காஜா தெரு', 26: 'எழில் நகர்', 27: 'எல்லீஸ் நகர்', 28: 'நடராஜ் தியேட்டர்',
  29: 'கூடல் நகர்', 30: 'அனுப்பானடி',
};

const A = (id, ta, en, unit, rate, free) => ({ id, ta, en, unit, rate, free, section: 'a' });
const B = (id, ta, en, unit, rate, free) => ({ id, ta, en, unit, rate, free, section: 'b' });
const COMMODITIES = [
  A('BRA', 'புழுங்கல் அரிசி', 'BRA Rice', 'KG', 0, true),
  A('NPHH_FRK', 'NPHH FRK அரிசி', 'NPHH FRK Rice', 'KG', 0, true),
  A('PHH_FRK', 'PHH FRK அரிசி', 'PHH FRK Rice', 'KG', 0, true),
  A('PHH_BRA', 'PHH BRA அரிசி', 'PHH BRA Rice', 'KG', 0, true),
  A('AAY_FRK', 'AAY FRK அரிசி', 'AAY FRK Rice', 'KG', 0, true),
  A('AAY', 'AAY அரிசி', 'AAY Rice', 'KG', 0, true),
  A('RRA', 'பச்சை அரிசி (RRA)', 'RRA Rice', 'KG', 0, true),
  A('NPHH_RRA', 'NPHH FRK RRA அரிசி', 'NPHH FRK RRA Rice', 'KG', 0, true),
  A('OAP', 'OAP அரிசி', 'OAP Rice', 'KG', 0, true),
  A('APS', 'APS அரிசி', 'APS Rice', 'KG', 0, true),
  A('WHEAT', 'கோதுமை', 'Wheat', 'KG', 0, true),
  A('SUGAR', 'சீனி', 'Sugar', 'KG', 25.0, false),
  A('AAY_SUGAR', 'AAY சீனி', 'Sugar (AAY)', 'KG', 13.5, false),
  A('TOOR', 'துவரம் பருப்பு', 'Toor Dal', 'KG', 30.0, false),
  A('PALM', 'பாம் ஆயில்', 'Palm Oil', 'LTR', 25.0, false),
  A('SALT_CIS', 'உப்பு (CIS)', 'Salt (CIS)', 'PKT', 12.0, false),
  A('SALT_RFFS', 'உப்பு (RFFS)', 'Salt (RFFS)', 'PKT', 12.0, false),
  A('OOTY', 'OOTY', 'OOTY', 'PKT', 25.0, false),
  A('TAN', 'TAN', 'TAN', 'PKT', 25.0, false),
  A('EMPTY_BOX', 'காலி அட்டை+பெட்டி', 'Empty Card+Box', 'NOS', 0.6, false),
  A('EMPTY_BAG', 'காலி பாலித்தீன் பை', 'Empty Polythene Bag', 'NOS', 2.5, false),
  { ...A('KERO', 'மண்ணெண்ணெய்', 'Kerosene', 'LTR', 15.6, false), crs29Only: true },
  B('PB_BRA', 'புழுங்கல் அரிசி', 'BRA Rice (Police)', 'KG', 0, true),
  B('PB_SUGAR', 'சீனி', 'Sugar (Police)', 'KG', 12.5, false),
  B('PB_WHEAT', 'கோதுமை', 'Wheat (Police)', 'KG', 0, true),
  B('PB_TOOR', 'துவரம் பருப்பு', 'Toor Dal (Police)', 'KG', 15.0, false),
  B('PB_PALM', 'பாம் ஆயில்', 'Palm Oil (Police)', 'LTR', 12.5, false),
].map((c, i) => ({ ...c, order: i + 1, active: true }));

async function readRow(key) {
  const { data, error } = await db.from('crs_state').select('data, version').eq('scope', 'global').eq('store_key', key).maybeSingle();
  if (error) throw new Error(`${key}: ${error.message}`);
  return data;
}

async function writeRow(key, value) {
  const cur = await readRow(key);
  if (!cur) {
    const { error } = await db.from('crs_state').insert({ scope: 'global', store_key: key, data: value, version: 1, updated_by: 'seed:masters' });
    if (error) throw new Error(`${key} insert: ${error.message}`);
    return 'created v1';
  }
  const { error } = await db
    .from('crs_state')
    .update({ data: value, version: cur.version + 1, updated_at: new Date().toISOString(), updated_by: 'seed:masters' })
    .eq('scope', 'global')
    .eq('store_key', key)
    .eq('version', cur.version);
  if (error) throw new Error(`${key} update: ${error.message}`);
  return `v${cur.version + 1}`;
}

// __shops: full 30, real names; carry each shop's code from the CRS master.
const masterRow = await readRow('__crsMaster');
const crsMaster = masterRow?.data ?? [];
const shopsRow = await readRow('__shops');
const existingShops = shopsRow?.data ?? [];

if (!FORCE && existingShops.length === 30) {
  console.log(`__shops           already holds 30 shops — skipped (use --force to overwrite)`);
} else {
  const shops = Array.from({ length: 30 }, (_, i) => {
    const id = i + 1;
    const m = crsMaster.find((r) => r.id === id);
    const old = existingShops[i] ?? {};
    return {
      code: m?.code || old.code || '',
      name: CRS_NAMES[id],
      cards: old.cards ?? 0,
      taluk: old.taluk ?? '',
      district: old.district ?? 'Madurai',
      active: m ? m.status === 'active' : true,
    };
  });
  console.log(`__shops           ${await writeRow('__shops', shops)} (${shops.length} shops, was ${existingShops.length})`);
}

const commRow = await readRow('__commodityMaster');
if (!FORCE && commRow?.data?.length) {
  console.log(`__commodityMaster already holds ${commRow.data.length} records — skipped (use --force to overwrite)`);
} else {
  console.log(`__commodityMaster ${await writeRow('__commodityMaster', COMMODITIES)} (${COMMODITIES.length} commodities)`);
}
console.log('done.');
