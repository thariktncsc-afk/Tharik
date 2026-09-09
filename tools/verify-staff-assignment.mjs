/**
 * Staff transfer, removal and replacement, as executable cases.
 *
 *   node tools/verify-staff-assignment.mjs
 *
 * src/lib/engine/staffAssignment.ts holds the rules behind moving a Bill Clerk
 * or Packer between shops. Three of them are worth a test rather than a
 * reading, because getting any one wrong is invisible on screen and wrong on
 * statutory paperwork:
 *
 *   - the office's sheet must let go of somebody who left, and must NOT let go
 *     of somebody it names who did not;
 *   - a shop-scoped username has to move with the person, or the old shop's
 *     sign-in list keeps offering them;
 *   - an unassigned shop account must not be able to sign in — the scope guard
 *     on /api/state reads a null crsId as "administrator".
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

const A = await import(pathToFileURL(join(root, 'src/lib/engine/staffAssignment.ts')).href);

let failures = 0;
const check = (label, ok, detail = '') => {
  if (ok) console.log(`  ok    ${label}`);
  else {
    failures++;
    console.log(`  FAIL  ${label}${detail ? `\n        ${detail}` : ''}`);
  }
};

const u = (id, fullName, username, role, crsId, active = true) => ({ id, fullName, username, phone: `90000000${id}`, role, crsId, active });

// CRS 24 as the screenshot shows it, plus a neighbouring shop to move between.
const ROSTER = [
  u(1, 'Sivadharanya', 'crs24', 'BC', 24),
  u(2, 'Pandi', 'crs24', 'Packer', 24, false),
  u(3, 'Rajathi', 'crs25', 'BC', 25),
  u(4, 'Rajkumar', 'crs25', 'Packer', 25),
  u(5, 'Admin', 'admin', 'ADMIN', null),
];
const MASTER = [
  { id: 24, code: '22DA009PN', bc: 'Sivadharanya', bcMobile: '9345310159', packer: 'Pandi', packerMobile: '9843287692' },
  { id: 25, code: '22CA008PN', bc: 'Rajathi', bcMobile: '9092895087', packer: 'Rajkumar', packerMobile: '9159256482' },
];

console.log('\nwho holds which post');
{
  check('the BC of a shop is found', A.occupant(ROSTER, 24, 'BC')?.fullName === 'Sivadharanya');
  // The statements resolve staff through getUsersForCRS, which filters on
  // active — so a disabled account is not the holder, and the shop card must
  // not claim otherwise.
  check('a disabled account does not hold the post', A.occupant(ROSTER, 24, 'Packer') === null);
  check('...so that post reads as vacant', A.vacantRoles(ROSTER, 24).join() === 'Packer');
  check('a fully staffed shop has no vacancy', A.vacantRoles(ROSTER, 25).length === 0);
  check('an unstaffed shop has both posts vacant', A.vacantRoles(ROSTER, 7).join() === 'BC,Packer');
}

console.log('\nthe office sheet lets go of the person who left');
{
  const after = A.clearedMasterSlot(MASTER, 24, 'Packer', 'Pandi');
  check('the slot naming them is emptied', after[0].packer === '' && after[0].packerMobile === '');
  check('...and their mobile with it', after[0].packerMobile === '');
  check('the other post at that shop is untouched', after[0].bc === 'Sivadharanya' && after[0].bcMobile === '9345310159');
  check('other shops are untouched', JSON.stringify(after[1]) === JSON.stringify(MASTER[1]));
  check('the shop code and the rest of the row survive', after[0].code === '22DA009PN');
  check('the original array is not mutated', MASTER[0].packer === 'Pandi');
}
{
  // This is the guard that matters: the sheet is the office's own record, and
  // one person leaving is no reason to erase a name that is not theirs.
  check('a slot naming somebody else is left alone', A.clearedMasterSlot(MASTER, 24, 'Packer', 'Kumar') === null);
  check('matching ignores case and padding', A.clearedMasterSlot(MASTER, 24, 'Packer', '  pandi ') !== null);
  check('a shop the sheet does not list is a no-op', A.clearedMasterSlot(MASTER, 99, 'BC', 'Anyone') === null);
}
{
  const filled = A.withMasterSlot(MASTER, 24, 'Packer', 'Kumar', '9876543210');
  check('a replacement is recorded in the sheet', filled[0].packer === 'Kumar' && filled[0].packerMobile === '9876543210');
  check('writing the same values again changes nothing', A.withMasterSlot(filled, 24, 'Packer', 'Kumar', '9876543210') === null);
}

console.log('\nthe shop username moves with the person');
{
  check('crs24 → crs7 on transfer', A.usernameOnTransfer('crs24', 24, 7) === 'crs7');
  check('a personal username is theirs and stays', A.usernameOnTransfer('Sivadharanya', 24, 7) === null);
  check('staying at the same shop changes nothing', A.usernameOnTransfer('crs24', 24, 24) === null);
  // Somebody whose username says crs9 while they sit at CRS 24 is a data
  // oddity, not an invitation to rewrite their login.
  check('a username naming another shop is not rewritten', A.usernameOnTransfer('crs9', 24, 7) === null);
  check('case is not a way to dodge the rule', A.usernameOnTransfer('CRS24', 24, 7) === 'crs7');
  check('crs2 is not read as crs24', A.isShopUsername('crs2') && A.usernameOnTransfer('crs2', 2, 7) === 'crs7');
  check('a name is not a shop username', A.isShopUsername('Pandi') === false);
}

console.log('\nplanning a transfer');
{
  const p = A.planTransfer(ROSTER, ROSTER[0], 7, 'BC');
  check('an empty post is not blocked', p.blocked === null);
  check('the old post is recorded as vacated', p.vacates?.crsId === 24 && p.vacates.role === 'BC');
  check('the username change comes with it', p.username === 'crs7');
}
{
  const p = A.planTransfer(ROSTER, ROSTER[0], 25, 'BC');
  check('a taken post names its holder', p.blocked?.holder.fullName === 'Rajathi');
  check('...so the screen can offer Replace or Cancel', p.blocked?.kind === 'occupied');
}
{
  // Pandi is disabled, so CRS 24's Packer post is free — a disabled account
  // must not block a replacement.
  check('a disabled holder does not block the post', A.planTransfer(ROSTER, ROSTER[3], 24, 'Packer').blocked === null);
}
{
  const p = A.planTransfer(ROSTER, ROSTER[0], 24, 'BC');
  check('moving somebody to the post they already hold is a no-op', p.noop === true);
  check('...and vacates nothing', p.vacates === null);
  check('...and does not rename them', p.username === null);
}
{
  // Promotion inside one shop: Packer → BC at CRS 25.
  const p = A.planTransfer(ROSTER, ROSTER[3], 25, 'BC');
  check('a role change within a shop vacates the old post', p.vacates?.crsId === 25 && p.vacates.role === 'Packer');
  check('...is blocked by the sitting BC', p.blocked?.holder.fullName === 'Rajathi');
  check('...and keeps the username, which is already this shop’s', p.username === null);
}

console.log('\nan unassigned shop account cannot sign in');
{
  // /api/state reads a null crsId as "administrator" (clearGuard's ownCrsId),
  // so an active BC with no shop would carry write access to every shop.
  check('a BC with no shop is refused', A.canSignIn('BC', null) === false);
  check('a Packer with no shop is refused', A.canSignIn('Packer', undefined) === false);
  check('a BC with a shop signs in', A.canSignIn('BC', 24) === true);
  check('an administrator needs no shop', A.canSignIn('ADMIN', null) === true);
  check('CRS 0 is not mistaken for "no shop"', A.canSignIn('BC', 0) === true);
}

console.log(`\n${failures ? `${failures} FAILED` : 'STAFF ASSIGNMENT OK'}`);
process.exit(failures ? 1 : 0);
