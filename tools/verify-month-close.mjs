/**
 * What a Monthly Sales Close requires, as executable cases.
 *
 *   node tools/verify-month-close.mjs
 *
 * The office's rule: a month closes only once Card Details AND Allotment have
 * been SAVED for that month. Not "filled" — card counts carry forward from
 * last month as a draft, so a month nobody has touched can show 500 RICE CARD.
 * The month-close therefore asks for each section's saved marker
 * (meCardConfirmed / meAllotConfirmed, one per crsId_month_year), and editing
 * a figure clears that marker again.
 *
 * Checked here: the four outcomes and their exact wording, that the markers
 * are per shop and per month, that a carry forward is a draft and never a
 * save, and that nothing written for this month touches last month's.
 *
 * (An administrator is warned rather than stopped — monthly-entry/page.tsx —
 * so that months imported before this rule can still be corrected.)
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

const L = await import(pathToFileURL(join(root, 'src/app/(app)/monthly-entry/lib.ts')).href);
const S = await import(pathToFileURL(join(root, 'src/lib/saveSuccess.ts')).href);

const KEY = '7_9_2026';
const PREV = '7_8_2026';

console.log('\nWhat stops a month-close');
{
  check('both saved: nothing stops it', L.monthCloseBlock(true, true) === null);

  const neither = L.monthCloseBlock(false, false);
  check('neither saved: "Monthly Details Not Saved"', neither?.title === 'Monthly Details Not Saved', neither?.title);
  check('…with the office’s wording', neither?.message === 'Please save Card Details and Allotment for this month before completing Monthly Sales.', neither?.message);

  const cards = L.monthCloseBlock(false, true);
  check('only cards missing: "Card Details Not Saved"', cards?.title === 'Card Details Not Saved', cards?.title);
  check('…with the office’s wording', cards?.message === 'Please review and save the Card Details for this month before completing Monthly Sales.', cards?.message);

  const allot = L.monthCloseBlock(true, false);
  check('only allotment missing: "Allotment Not Saved"', allot?.title === 'Allotment Not Saved', allot?.title);
  check('…with the office’s wording', allot?.message === 'Please review and save the Allotment for this month before completing Monthly Sales.', allot?.message);

  check('each names what is missing, for the screen to mark',
    JSON.stringify([neither.missing, cards.missing, allot.missing]) === JSON.stringify([['cards', 'allotment'], ['cards'], ['allotment']]));
}

console.log('\nSaved is per shop and per month');
{
  const flags = { [KEY]: true };
  check('the month that was saved reads saved', L.sectionSaved(flags, KEY));
  check('another shop’s same month does not', !L.sectionSaved(flags, '8_9_2026'));
  check('the next month does not', !L.sectionSaved(flags, '7_10_2026'));
  check('last month does not', !L.sectionSaved(flags, PREV));
  check('no record at all reads unsaved', !L.sectionSaved(undefined, KEY) && !L.sectionSaved({}, KEY));
  check('only `true` counts — a stray falsy value is not a save', !L.sectionSaved({ [KEY]: false }, KEY));
}

console.log('\nSaving and un-saving one month only');
{
  const flags = { [PREV]: true };
  L.applySectionFlag(flags, KEY, true);
  check('saving September leaves August saved', flags[KEY] === true && flags[PREV] === true, JSON.stringify(flags));
  L.applySectionFlag(flags, KEY, false);
  check('editing a figure puts September back to unsaved', !L.sectionSaved(flags, KEY));
  check('…and August is still saved — history is never rewritten', flags[PREV] === true, JSON.stringify(flags));
  check('an unsaved month reads like one never saved', !(KEY in flags));
}

console.log('\nA carry forward is a draft, never a save');
{
  const cards = { [PREV]: { rice: { count: 500 }, sugar: { count: 300 } } };
  const sep = L.cardDraft(cards, 7, 9, 2026);
  check('September previews August’s counts', sep.carried && sep.shown.rice.count === 500 && sep.shown.sugar.count === 300, JSON.stringify(sep));
  check('…and the month still counts as NOT saved', !!L.monthCloseBlock(L.sectionSaved({}, KEY), true));
  check('…rendering wrote nothing into September', !cards[KEY], JSON.stringify(Object.keys(cards)));
  check('…and August is untouched', cards[PREV].rice.count === 500);

  const own = { ...cards, [KEY]: { rice: { count: 520 }, sugar: { count: 300 } } };
  const edited = L.cardDraft(own, 7, 9, 2026);
  check('once September has its own counts it is no longer a carry', !edited.carried && edited.shown.rice.count === 520);
  check('a first month with nothing behind it shows empty', JSON.stringify(L.cardDraft({}, 7, 9, 2026)) === JSON.stringify({ shown: {}, carried: false }));
  check('an empty record for the month still carries last month’s',
    L.cardDraft({ ...cards, [KEY]: {} }, 7, 9, 2026).carried);
  check('January reads back to December of the year before', L.mePrevKey(7, 1, 2026) === '7_12_2025');
}

console.log('\nWhat the tick says when each section is saved');
{
  const c = S.cardDetailsSaved(7, 9, 2026);
  check('Card Details: title', c.title === 'Card Details Saved Successfully', c.title);
  check('Card Details: names the month', c.detail === 'Card Details for September 2026 have been saved successfully.', c.detail);
  const a = S.allotmentSaved(7, 9, 2026);
  check('Allotment: title', a.title === 'Allotment Saved Successfully', a.title);
  check('Allotment: names the month', a.detail === 'Allotment for September 2026 has been saved successfully.', a.detail);
  check('the two never collide, nor with the month-close tick',
    new Set([c.key, a.key, S.monthlySaved(7, 9, 2026).key]).size === 3);
}

console.log('\nThe fields the office listed are the ones on screen');
{
  const ids = L.ME_CARD_TYPES.map((t) => t.label);
  const want = ['RICE CARD', 'LOF RICE CARD', 'SUGAR CARD', 'LOF SUGAR', 'AAY CARD', 'LOF AAY CARD', 'OAP', 'POLICE', '"N" CARD'];
  check('all nine card categories, in order', JSON.stringify(ids) === JSON.stringify(want), JSON.stringify(ids));
}

console.log(failures ? `\n${failures} FAILED` : '\nMONTH CLOSE OK');
process.exitCode = failures ? 1 : 0;
