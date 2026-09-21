# TNCSC CRS — working notes for Claude Code

Statement management for Tamil Nadu Civil Supplies Corporation ration shops
(Madurai region). These are real government supply records — the figures end up
on statutory statements, so a wrong number is worse than a missing feature.

Most of what follows is here because it already cost someone a day.

## The one thing to understand first

The app is React (Next.js App Router) end to end. Every screen lives under
`src/app/(app)/*`; `/` just redirects to `/dashboard`.

**`src/legacy/` is not a second app. It is the source of the statement
engine** — 13 files, all that survives of the original single-file build.
Nothing in it runs in the browser as a script any more. It exists because
`tools/build-stmt-module.mjs` concatenates it into two importable modules:

| Generated | From | Used by |
| --- | --- | --- |
| `src/generated/statements-legacy.js` | 11 files | `/api/statements/render` (Node) |
| `src/generated/dss-legacy.js` | `17-dss-export.js` | Daily Entry's DSS export (browser) |

`DSS_A` / `DSS_B` are additionally sliced out of `03-daily-entry.js` for both
preludes, which is the only reason that file is still here.

Regeneration is wired into `predev` / `prebuild`, so the modules cannot drift
from their sources. **If you edit anything in `src/legacy/`, run
`npm run verify:statements` before you believe it.**

## Why the statement code is still legacy JavaScript

These are statutory print formats. `12-statement-builders.js` alone is 1,827
lines of string building whose output ends up on government paperwork, and
`golden/statements/` holds 306 snapshots of exactly what it produced before the
conversion. `npm run verify:statements` renders every shop × section through the
generated module and diffs byte-for-byte against them.

That check is the safety net, so:

- **Don't rewrite the builders in TypeScript for tidiness.** The rewrite buys
  nothing a user can see and risks a silent digit change on a statutory form.
- Prefer a **new numbered file at the end** that overrides an earlier function,
  the way `22-allotment.js`, `26-crs29.js` and `39-staff-roles.js` already wrap
  `stmtGetData`. Add it to `FILES` in `tools/build-stmt-module.mjs`.
- The legacy files are **classic-script style** — `var`, hoisting across the
  whole block, later definitions overriding earlier ones. That still holds
  inside the generated factory function, which is one concatenated scope.
- Symbols from files that no longer exist are supplied by the generator's
  `PRELUDE`. If you hit a `ReferenceError` after adding a file, that's where it
  goes — not into a resurrected engine part.

Historical note: this used to be a two-app repo (a legacy browser engine at `/`
alongside the React routes), guarded by a `verify:parity` check against the
original `TNCSC_CRS_Demo_19 (1).html`. The legacy UI and that check are gone;
the golden snapshots replaced them, and are the stronger guarantee because they
check rendered output rather than source text.

## Database

Supabase Postgres. Everything goes through Next.js route handlers — the browser
never talks to Supabase directly.

`crs_state` holds the engine's stores verbatim as JSONB, one row per
`(scope, store_key)`, with a `version` column for optimistic locking. Monthly
keys are `<crsId>_<month>_<year>` (e.g. `23_6_2026`); daily entries are
`<crsId>_<date>`. Masters use `__`-prefixed keys: `__shops`,
`__commodityMaster`, `__crsMaster`, `__holidays`, `__config`, `__counters`,
`__accounts`.

`users` is a real table (migration `0002`) with bcrypt hashes via pgcrypto.
`crs_state_audit` records every write.

Migrations in `supabase/migrations/` are **not run on deploy**. Pushing to Vercel
ships the frontend only — run the SQL against the live database yourself, or the
app 500s against an older schema.

### RLS posture

RLS is enabled on every table with **no permissive policy**, deliberately. The
app keeps its own login rather than Supabase Auth, so there is no `auth.uid()` to
write a policy against. The publishable key can read nothing; all access goes
through route handlers holding the secret key.

`security definer` functions need `set search_path = public, extensions` —
Supabase keeps pgcrypto in `extensions`, and pinning to `public` alone makes
`crypt()` invisible inside the function body.

**Postgres grants EXECUTE on new functions to PUBLIC by default.** Revoking from
`anon` by name is not enough — revoke from `public` first, then grant to
`service_role`. Migration `0003` exists because both auth functions were briefly
world-callable, `set_user_password` included.

## Auth

Sign-in is decided **only by the database**. `POST /api/session` verifies through
`verify_login()`, and the engine then calls `enterApp()` directly with the
account the server returned. The hardcoded `p !== 'pds123'` check still sitting
in ported `07-auth.js` is dead code — do not reintroduce a client-side password
check.

`username` is deliberately **not unique**: a shop username maps to both its Bill
Clerk and its Packer (`crs7`, `crs20`, `crs23`, `crs24`, `crs25`). Sign-in is a
two-step for those — the first call returns `needsRole` plus candidates and **no
cookie**, the second binds the session to the person chosen. Never make an
authenticated call between those two steps; there is no session yet. That bug
looked like "invalid credentials" and took a while to find.

Every seeded account still shares the password `pds123`.

## Paid downloads

Shop users pay per sheet before a statement can be opened; **ADMIN downloads are
always free**. There is no gateway — the customer pays into the office's UPI
handle, types the UTR back, and an admin matches it against the bank feed and
approves. Every approval is a human decision, and `decided_by`/`decided_at` on
`payment_orders` is the only thing standing behind it.

Tariff (migration `0004_payments.sql`, editable in Settings): **₹40 per sheet
inclusive of GST**, so 13 sheets = ₹520 and 14 = ₹560; **DSS ₹5 per day plus
GST**; GST 18%. A *sheet* is a statement section, not a printed copy — the four
sections with `copies: 2` still cost one sheet. **CRS 29 has twelve sections**,
not thirteen, so `13` is never hardcoded: counts come from
`engine.sectionsFor(crsId)`.

**Money is stored in paise as integers.** Rupee floats do not survive being
totalled and reconciled against a bank statement.

### Where the gate actually is

`/api/statements/render`, and nowhere else. The /statements page used to build
sheets in the browser, which made any React gate advisory — the document was
already in the page. The builders now run under Node in
`src/lib/payments/server.ts` (`loadStatementEngine`), reading crs_state
directly, and **the page no longer imports the statement engine at all**. Do not
put it back: that one import is the difference between a paywall and a disabled
button.

Preview, Print and Excel all take that route because they are the same document.
Gating only the download would collect nothing — Print → Save as PDF is free.

The builders themselves are unchanged; only their location moved.
`npm run verify:statements` still proves every section byte-identical,
and that is the check that matters after touching anything here.

**The DSS export is the exception.** It is still assembled in the browser: the
styled .xlsx needs `xlsx-js-style`'s borders and fonts, which the `xlsx` in this
project cannot write, and shipping a DSS with its formatting stripped is a worse
regression than a weaker gate. Its check is server-verified but client-enforced.
`xlsx-js-style` is now a dependency (the statement Excel export uses it), so
closing that gap is just a matter of porting `downloadDSSExcel()` server-side,
shimming `XLSX.writeFile` to capture the workbook instead of writing it.

### Which dates get a DSS page

One page per shop per date (`src/lib/engine/dssDays.ts`): every day sheet,
plus a page **worked out when the DSS opens** for every date with Receipt
Register receipts and no sheet — Opening carried from the chain, that date's
receipts, Sales 0, Closing = Total. Never stored, so a receipt added, edited or
deleted, or Sales saved on that date later, changes it at once and cannot
duplicate (saving Sales makes the real sheet, which already carries the
register receipt, the one page). Skipped: months keyed on Monthly Entry (the
projection already states them) and receipts before a shop's first sheet. The
DSS fee (`daysWithEntries` in `/api/payments`) counts the same set, so a shop
pays for exactly the pages it gets. The legacy DSS builder is unchanged — it
is handed the augmented entryStore. `npm run verify:dss-days`.

### Payment Access Control (shop-wise switches)

`/payment-access` (admin only) sets, per shop, whether the **DSS** and the
**Statements** need paying for — two independent switches
(`src/lib/payments/gate.ts`, crs_state `__paymentGate`, written only by the
admin-only `/api/payments/gate`, never by `/api/state`). **Unset = Payment
Required**, i.e. the behaviour before the switches existed. The global
`payment_settings.enabled` still sits above them: charging off = everything
free. Enforced on the server: `authorise()` in `/api/statements/render`,
`/api/payments/access` (`free` = Statements, `dssFree` = DSS — keep them
apart; Daily Entry's DSS button must read `dssFree`), and order creation
refuses a shop whose switch is OFF. Switches never touch orders or approvals.
Each change is an activity-log row (`Payment Access`, `ON → OFF`), bulk ones
too, one per shop. The Statements page and this page re-read on a live-sync
change to `__paymentGate`. `npm run verify:payment-gate`.

### Gotchas

- **The payee VPA is NOT in `__config`.** Any signed-in user can write crs_state
  through /api/state, so a shop user could redirect every payment to their own
  handle. It lives in `payment_settings`, written only through the admin-only
  `/api/payments/settings`.
- **Entitlement is per SHOP, not per user.** crs9's Bill Clerk and Packer are
  two users behind one shop; billing that shop twice for one month would be
  indefensible.
- **Approvals accumulate.** Buying three sheets today and ten tomorrow leaves
  the shop entitled to all thirteen, re-downloadable without paying again.
- **Prices are frozen onto the order.** Changing the tariff must not
  retroactively alter what someone already paid.
- **The server never reads an amount from the request.** It takes only *what* is
  being bought and re-derives the price from the settings row.
- **`Math.max(0, NaN)` is NaN, not 0.** Quantities go through `units()` in
  `pricing.ts` before touching money — a NaN reaches the customer as a "₹NaN"
  price tag and lands an unreconcilable amount in the ledger.
- Missing `payment_settings` (0004 not run) falls back to charging **off**, so a
  migration gap makes downloads free rather than locking shops out of statutory
  paperwork.

## Two ways to key a month — and the projected day sheet

A shop keys its month either **by day** (Daily Entry; the sheets accumulate
into Monthly Entry and lock their rows) or **by month** (straight into Monthly
Entry). Never both. `src/lib/engine/monthProjection.ts` is the rule.

A month keyed by month has no day sheets, and two things only ever print from
day sheets: the DSS, and the two date-wise statement sections. So the
month-close (the save button) writes the month out as **one day sheet dated
the last calendar day**, marked `__projection`, plus the manual rows'
adjustments into `inspectionStore` on that date, marked the same way — the
DSS recomputes a day from inspectionStore and ignores a sheet's own
total/close, so without them it would disagree with Monthly Entry.

- **The roll-up never reads a projected sheet.** It is an output of the
  month's manual values. Read back, it would lock every row as "from Daily"
  and the shop could never correct its month again — and once a real sheet
  was keyed, the month would count twice.
- **Saving a real day sheet drops the projection** for that month. That is the
  exclusivity rule, enforced in code, not by convention.
- **An inspection alone no longer locks a row.** The original engine's rule
  was `days > 0 || excess || shortage || transfer`. Monthly Inspection lands
  on the last day, so under that rule recording a shortage wiped the month to
  zeros. Now only a keyed day sheet makes a row `'daily'`; adjustments
  overlay the manual row — replaced, not added, because after a save the
  manual row already holds the same sums.
- Monthly Inspection is the Daily Entry overlay with a month `context`; the
  record is keyed by the last calendar day in both modes. One store, one key,
  nothing to sync.
- Remittance and gunny are NOT copied onto the projected sheet. Their monthly
  stores already carry them and the statements fall back to those; a copy
  would be summed twice.

**The goldens cannot see any of this.** `verify:statements` renders from the
stored `monthlyStore` and never runs the roll-up — but production does
(`server.ts` rebuilds the month before rendering), so a roll-up change
reaches every statement unnoticed. `npm run verify:rollup` covers the gap:
the roll-up at `dev` and the working tree must publish identical figures for
every live month, plus the two-mode rules as synthetic months. Run it after
touching `monthlyRollup.ts` or `monthProjection.ts`.

32 of the 35 live months are keyed by month (the imported workbooks). They
are projected only when someone presses save on them — never on open.

## Notifications

`notifications` + `notification_recipients` (migration `0005`). One mechanism
for every approval: a module words its request (`src/lib/notify/core.ts`) and
calls `notifyApprovalRequested` / `notifyApprovalDecided`
(`src/lib/notify/server.ts`). `src/lib/notify/approvals.ts` holds the two that
exist — payments and clear requests. A future approval module adds a wording
pair there; no schema change.

- **It never breaks an approval.** Both approval calls swallow their own
  failures, the tables not existing included. Only `sendMessage` throws.
- **The requester is the sender of the request notification.** That is how a
  decision finds who to tell, for any module, without each one carrying its own
  requester column.
- **Payments notify on submit, not on create** — an unpaid `pending` order is
  nobody's to approve. **A clear tells its requester only once `cleared`**:
  approval can still fail back to pending.
- **Scoping is by query** (`recipient_user_id = session.userId`), never
  load-then-filter. No notification route takes a user id.
- **Read times are first-write-wins.** `markPatch` never moves a timestamp, and
  only the person's own action — open, mark read, acknowledge — sets `read_at`.
  A poll sets `delivered_at` and nothing else; a popup appearing sets nothing.
- **Polling, not Supabase Realtime, on purpose.** RLS is on with no policy
  (there is no `auth.uid()`), so a subscribed browser receives nothing. Making
  it receive would mean a policy exposing every shop's notifications to the
  public key, or a guessable broadcast channel — and either breaks "the browser
  never talks to Supabase". The bell rides the live-sync beat: `/api/sync
  ?topics=inbox` answers `<unread>:<newest recipient id>` for the session's
  user (`inboxBeat`), and a change makes the bell fetch its summary — so a
  badge moves within ~4 s. A 30 s poll, focus and the person's own actions
  are the fallbacks.
- **One request, one notification.** `notifyApprovalRequested` skips a
  request that already has a `pending` notification, and migration `0007`
  says the same with a partial unique index (a 23505 is treated as "already
  there"). A result is skipped if one with the same decision was already sent
  since the latest request notification. A payment rejected and resubmitted is
  a new request, so it is notified again.
- **Waiting requests are backfilled.** An administrator's first summary per
  server process announces every `awaiting_approval` payment and `pending`
  clear request that has no notification (`backfillPendingApprovals`) — read
  only, idempotent, and only once the tables are known to exist. An unpaid
  `pending` payment order is not waiting for anyone and is not announced.
- Request wording is the office's: `CRS 7 – Daily Sales Clear Request` over
  `16-09-2026 | Requested by Name (BC) | 10:35 AM` (time in IST).
- Recipients are denormalised at send time, so a Packer transferred next month
  still appears under their old shop in an old message's read report.

`npm run verify:notifications` covers who a message reaches, the read-time
rules and the approval wording.

## The Opening → Closing chain runs in date order

A saved day sheet stores its own Opening. **Only the start of the chain — a day
with nothing earlier to carry from — keeps a typed Opening.** Every other day
opens with the previous applicable day's Closing, plus receipts and inspection
on the sheet-less days between (`stockChain.ts`); a missing date is stepped
over, never read as zero. Daily Entry shows that carry read-only, for every
role.

- **Order of keying does not matter.** Key the 16th first with a typed 200,
  then the 2nd: the 16th re-opens at the 15th's Closing.
- **Every balance-moving write rebuilds the chain from its date forward** and
  republishes every month it moved (`engine/rechain.ts`,
  `rechainAndRepublish`): Daily Entry save, a receipt saved or deleted, an
  inspection, a Monthly Entry month-close, and every approved clear. A
  rewritten row also takes its date's inspection adjustments, as a re-save
  would. Projected sheets are never rewritten, only carried from.
- The stock guard's Opening lock lets a saved Opening move **to its carried
  balance and nothing else**, or a shop saving an earlier day would be refused
  for the later days it re-carries.
- **A sheet's Closing is calculated, never read.** `buildChainIndex` walks each
  commodity in date order and works out every sheet's Closing from the Opening
  carried into it, that day's register receipt, inspection and sales — what
  Daily Entry shows for that day. A stale stored Closing can therefore never
  leak into the next day's Opening (CRS 7: 16 Sep stored 100 while its screen
  showed 3342, and 17 Sep opened at 100). The rebuild writes the same figures
  back: Opening, Receipt where the register speaks, adjustments, Total, Closing
  — never Sales or anything else keyed.
- Stored sheets that predate the rule are repaired with
  `node tools/repair-stock-chain.mjs [--crs=N]` (dry run) then `--write`, which
  backs up the rows to `backups/` first and writes under version.

`npm run verify:chain-rebuild` has the reported CRS 7 case, gaps, and each kind
of change.

## Daily Entry — which day is on screen

The foot of Daily Entry reads `← Previous Date | Current Date | Next Date →`,
each button showing the date it goes to (`daily-entry/dateNav.ts`; office,
2026-09-21 — clerks were losing track of which day they were keying).

- Worked out from the date ON SCREEN, never from today, in UTC so no time
  zone can shift it. Next stops at today, as the date box already did.
- The date box, the "Selected" label and the bar all read the one `date`
  state; every change of date goes through `goToDate()`.
- A new date reloads that day's saved sheet from scratch (the key effect's
  `applyFill`), so nothing of the previous day can show on it. Figures typed
  but not saved would be lost by a date change, so `goToDate()` asks first
  ("Stay on …" / "Go to …"). Saved days are never touched.
- The OB → CB chain is untouched: 20-09 opens at 19-09's Closing whichever way
  you arrive at it.

`npm run verify:daily-date-nav`.

## Holidays — one engine

`src/lib/engine/holidays.ts` decides every date: a **government holiday on
exactly that date** (the `__holidays` master, `{ d, name }` per year) first,
then the **1st/2nd Friday and 3rd/4th Sunday**, else a working day. The
Dashboard's status and its Entries / Days Without Entry counts
(`workingDayCounts`), Daily Entry's date line and the holiday calendar all call
it — do not add a formula anywhere else.

- **"3rd Sunday" is the third Sunday in the month: `ceil(day / 7)`.** The
  ported engine used the calendar row (`ceil((day + firstWeekday) / 7)`), which
  in September 2026 called the 13th the 3rd Sunday and missed the real 4th (the
  27th). The legacy prelude and `10-holidays.js` carry the corrected formula
  too; no statement builder reads either, and `verify:statements` output was
  identical before and after.
- Nothing is cached: the Dashboard recomputes from `new Date()` every render
  (the clock re-renders it each second), so it moves past midnight on its own.
- A holiday's date is only as right as the master. `__holidays` 2026 had
  Vinayagar Chaturthi on 2026-09-17 (seeded from the legacy literals); the
  office confirmed 2026-09-14, and both the live row and `10-holidays.js` were
  corrected. Check such dates with the office rather than working around them
  in code.

`npm run verify:holidays`.

## Who may type an Opening — once for a shop, always for an admin

`src/lib/engine/stockInit.ts`, enforced in `stockGuard.ts` (rule 1) on every
`/api/state` write; the screens only mirror it.

- **Shop staff type an Opening once, ever** — the shop's Initial Opening
  Balance, before it has *started*. After that every Opening they save must be
  the carried balance, or the figure already stored where nothing carries in.
  They also may not key a day before the shop's first day (it would re-carry
  the Initial Opening away), nor change or remove a saved remittance (rule 1b
  — see "Remittance", below; adding a deposit is unchanged).
- **"Started" = the shop holds stock data**, recorded in crs_state
  `__stockInit` (`{date, at, by, source}`) and **recalculated from what
  remains** (`reconcileStockInit`) after every landed save that touches a
  shop's sheets (`shopsTouchedBy`) and after every approved clear
  (`stockInitServer.reconcileShops`). A sheet counts only if some figure is
  non-zero or it is a Monthly Entry projection (`sheetHasStock`) — a form
  emptied and saved is not a start. Clear the only stock and the record goes
  (a new shop again: the Initial Opening can be keyed on any date); clear the
  first day and it moves to the next sheet; clear a later day and nothing
  changes. Not in `ALLOWED_KEYS`, so no client writes it. It never reads
  `__shops.active` / `__crsMaster.status`, so Active → Inactive → Active
  changes nothing. `node tools/reconcile-stock-init.mjs [--write]` applies the
  rule to every shop (it fixed CRS 20, whose 18 Sep Initial Opening had been
  saved over with zeros while the record kept 18 Sep).
- **An administrator's Clear on a saved day or month** goes through the clear
  request — raised and approved at once (`ClearRequestDialog admin`) — so the
  executor really removes it, rebuilds the chain and reconciles the record.
  "Just empty the form" keeps the old behaviour for retyping.
- Seeded with `node tools/seed-stock-init.mjs --crs=7,19,30 --write` (the office
  named them; CRS 16 holds a 1 Sep sheet but was listed as not started, so it
  was deliberately left out). The tool only adds.
- **Administrators may correct any Opening, Total or Closing** on Daily Entry.
  Total and Closing are arithmetic, so a correction is saved as the Opening
  that produces it — Sales (money banked) stays as keyed. A corrected row is
  marked `openFixed: true`; `buildChainIndex` and `rebuildChain` keep a fixed
  Opening instead of the carry, and the days after carry from it. The Initial
  Opening is saved fixed too, so a day keyed before it later cannot carry it
  away. Emptying an admin's Opening box goes back to the carry. Total and
  Closing arithmetic is still enforced for everyone.
- Administrators correct a saved remittance in place (✎, same id), so Monthly
  Remittance and the statements — which read the day sheets — follow without
  a duplicate row.

`npm run verify:initial-opening` has the office's scenarios A–H.

## Gunny figures: the screen's rule is the only rule

`src/legacy/42-gunny-live.js` wraps `stmtGetData` and rebuilds `d.gunny`, so
the statements resolve gunny exactly as **Gunny Stock Management** displays it.

**The bug.** The screen worked Opening / Receipt / Total / Closing out on every
render but only WROTE them to `meGunnyStore` when somebody edited a row, and
`stmtGetData` used that stored record whenever any field in it was non-zero.
The statements therefore printed whatever the figures were the last time a row
was touched. CRS 19, September 2026: the screen showed Receipt 205 and Total
496 for 50 KG SS and 14 and 57 for POLY and C. BOX; the statement printed
Receipt 10 and Total 301, and nothing at all for the other two — the stored row
dated 11 Sep, and POLY/C. BOX never touched, so they fell through to a
different derivation again (the `EMPTY_BAG` / `EMPTY_BOX` monthly rows, which
are not where those bags come from).

**The rule**, per item, matching `GunnyTable.tsx`:

| | |
| --- | --- |
| Opening | this month's own figure, else last month's Closing carried, else 0 |
| Receipt | `receiptImported` (the office's workbook), else the month's Sales Close totals for that pack type, else the bag counts on the month's own sales rows (`g_sales`, over `SC_PACK_TYPES`) |
| Issues | as keyed, else 0 |
| Total | Opening + Receipt |
| Closing | Total − Issues |

- **The stored `receipt`, `total` and `closing` are never read.** They are
  derived copies, and reading them is what let the statement drift.
- Keyed figures — Opening, Issues, an imported Receipt — are still the
  office's and still win. A keyed Opening of `0` counts as keyed.
- Both the Gunny statement and the gunny report at the foot of the Receipt
  statement read `d.gunny`, so both were wrong together and are right together.
- The wrapper swallows its own errors and leaves the earlier resolution in
  place: a statement is never lost over this.

`npm run verify:gunny-rows` has the live CRS 19 case and each source in turn.

## The Gunny statement: three rows, one column

`buildGunny` in `12-statement-builders.js`. Two things the office asked for
(2026-09-20), both changing what prints:

- **The spare fourth row is gone.** A row of eleven empty cells printed under
  50KG SS / POLY / C. BOX on every statement — a ruled line from the paper
  form. The three varieties always print, a variety with no figures keeping
  its row with its cells empty: a stock statement that leaves a variety out
  reads as if none was ever held.
- **Every variety's figures print in the EMPTY GUNNY sub-column**, leaving
  GUNNY WITH GRAINS blank. 50KG SS used to be written into WITH GRAINS while
  POLY and C. BOX went into EMPTY, so the figures sat in different cells down
  the sheet and read as scattered. The office named EMPTY GUNNY as the column
  for all three. **Which figure belongs to which variety and stage is
  unchanged** — only the cell it prints in moved.
- That is also where the Receipt statement's own gunny report (`gRow` in
  `buildReceipt`) has always put them, so the two sheets now agree — which is
  a reason to believe the column is right.
- A closing balance of zero still prints `0`; every other zero still prints
  blank. That rule is untouched.

`npm run verify:gunny-rows` states the whole table cell by cell at one, two
and three varieties with figures, and at none.

## The Receipt statement's rows follow its receipts

`buildReceipt` in `12-statement-builders.js` reproduces a paper form with ten
ruled lines — seven, a TOTAL, three more, a second TOTAL — and it used to emit
all ten whether or not there was anything to put on them. A month with two
receipts printed two rows and eight empty ones; a month with none printed ten
empty rows under the headings. **The office asked for the lines to follow the
entries** (2026-09-20), so:

- one row per receipt recorded, and nothing reserved;
- a batch's TOTAL only when that batch has rows, so a month with no receipts
  leaves the headings standing alone above the gunny report;
- the second block is no longer capped at three (`slice(7,10)` → `slice(7)`):
  an **eleventh receipt in a month used to be left off the statement
  altogether**, and off its TOTAL with it.

`buildDataRow` and `buildTotalRow` are untouched, so a recorded receipt prints
exactly as it always has. **This is an intended change to a statutory format,
so the `*_receipt.html` goldens no longer match** — as is true of
`*_gunny.html` above. Both must be regenerated
and the diff shown to the office once `public/golden-stores.json` is refreshed
(see below). It was proved instead by rendering every shop's receipt section
before and after the change from the same data
(`node tools/render-section.mjs receipt <dir>`): the only difference is the
removed blank rows. `npm run verify:receipt-rows` covers 0, 1, 2, 4, 7, 8, 10,
12 and 25 receipts through the real engine.

**`public/golden-stores.json` is stale** (re-dumped from live on 2026-09-17,
after the Initial OB entries), so `verify:statements` already fails 285 of 306
on `dev` for reasons that have nothing to do with any of this. Until it is
refreshed — `node tools/dump-golden-stores.mjs`, then re-render and review —
that check cannot see anything, receipt sections included.

## Exporting statements — PDF and Excel

`src/lib/statements/`. The builders are NOT involved: they still produce
exactly what the 306 goldens hold, and everything here is assembly of that
output. `npm run verify:statement-export` drives both exports over all 306.

- **Print (and so Save as PDF): one statement, one sheet.** `printDoc.ts`
  wraps each section — and each COPY of a `copies: 2` section — in its own
  `.stmt-sheet`, and appends its page rules AFTER every section's own
  `<style>`. Three faults lived here: nothing ever broke a page
  (`STMT_PRINT_CSS` breaks on `.stmt-page`, a class no builder emits); the
  Daily Sales builder's `@media print{@page{size:A3 landscape}}` is a
  DOCUMENT rule, so one wide statement put every other one on A3, which an A4
  printer then shrank; and its `body{font-size:8px}` reached everything.
- **Named pages are what keep them apart**: `@page stmtP` / `stmtL` (A4
  portrait and landscape, 8 mm margins), assigned per sheet. A named page
  beats the builder's unnamed `@page` for the elements that use it, so the
  A3 rule can stay where it is and the goldens stay byte-identical.
- **Orientation is measured, not listed**: `columnCount` reads the parsed
  grid, so a builder that gains a column keeps printing right. Over 9 columns
  goes landscape (Receipt is 37, Daily Sale 22, CRS Page 1 only 2).
  `ALWAYS_LANDSCAPE` is the exception the office asked for: **CRS Police,
  Card Details and RBI** are filed on their side whatever their width (they
  are 9, 8 and 8 columns, just under the threshold). It applies to the
  preview, the printed sheet and the Excel page setup alike.
- **Excel: one statement, one WORKSHEET**, in one .xlsx. It used to be the
  statements' HTML with a `.xls` name — Excel opened it as a single sheet,
  and the flex-laid-out statements collapsed on top of each other.
  `sheetModel.ts` parses a statement into a grid (tables, and the flex rows
  that CRS Page 1 is made of), `toWorkbook.ts` writes the sheets.
- Parsed from the markup string, NOT through DOMParser, so the same code runs
  in the browser and under Node in the verify script.
- Numbers are written as numbers with the decimals the statement printed
  (`4750.000` stays three places); anything else stays text, so a date or
  `998 & 59` is never reinterpreted.
- `xlsx-js-style` writes cells, styles, merges, widths, heights, margins and
  defined names but has NO writer for freeze panes or page setup, so
  `applyPrintSetup` unzips the file and edits each sheet's XML (fflate).
  Order matters: `sheetPr` first, `pageSetup` last, or Excel calls the file
  corrupt — and the writer already emits a `<sheetViews>`, so the freeze pane
  must REPLACE it rather than be added beside it.
- Header rows repeat on every printed page through `_xlnm.Print_Titles`, and
  each sheet gets a `_xlnm.Print_Area`, A4, fit to one page wide.
- `node tools/sample-statement-export.mjs crs19 <outDir>` builds both files
  from the goldens — no database, nothing live — for looking at the format.

### The office's master workbook as the format

`src/generated/statement-template.json` is `CRS 19 AUG'26.xlsx` read by
`tools/extract-template.mjs` **with every figure, name, month and phone
blanked** — rerun the privacy scan after re-extracting. A data cell keeps
its caption (`p`: `"RICE CARD : "`, `"POLICE RECEIPT FOR THE MONTH OF "`,
`"CRS."`), and the fill supplies what follows.

- `TEMPLATE_FILL` in `templateFill.ts` lists the sections drawn on the
  office's sheet: `crs_page1` by caption, `crs_police` by table (row label ×
  column heading, figures only into non-static cells, title lines by
  caption prefix). Everything else still renders our own markup.
- Preview and Print draw the same `templateSheetPreview` markup.
  Formulas are evaluated for display (`evaluateFormulas`); the export keeps
  them unless a value was filled, and drops cross-sheet ones.
- **CRS Police and RBI fill their page** (`fillsPage`: the office prints them
  above 100%, not fitted). On the template sheet that is `fillScale` —
  worked out from the office's widths and heights, never below its own
  percentage; on our markup (RBI) it is `fillSheets` measuring in the
  browser. The Excel export keeps the office's own 145% page setup.
- **Remittance and Sale Tax stretch to the foot of the page**
  (`stretchesToPage`, office request 2026-09-21; COLL too). They are fit-to-page,
  which only shrinks, so `fillSheets` enlarges them as far as the width
  allows and then gives the height still left to the main table's rows
  (`data-fill-stretch`) — taller lines, same cells. Printable height is the
  office's own margins, with 3% spare so nothing tips onto a second page.

### COLL — the Advance block is its own one-column table

`buildColl` in `24-coll.js` (which overrides the one in
`12-statement-builders.js`). "ADVANCE FOR THE MONTH OF OCT'2026" prints
under the report as COMMODITY + one quantity column, in the office's row
order from the master's Coll sheet (rows 34–46, PHH FRK twice included) —
it used to be a section of the main table with six columns an advance does
not have (office request 2026-09-21). The quantities are still blank: there
is no source for them. Every shop's COLL was rendered before and after and
is byte-identical outside that block.

**COLL has no signature line** — the staff name and AREA SUPERVISOR under
its tables were taken off (office, 2026-09-21); it ends with the Advance
table. Every other sheet keeps its own. COLL also stretches to its page like
Remittance and Sale Tax (`STRETCH_TO_PAGE`): its main table's rows grow to
the office's bottom margin.

Under the title COLL prints the shop's code alone, centred at 13px (`22CA005PN`) —
"CRS 19" beside it was dropped (office, 2026-09-21). A shop with no code on
the master falls back to "CRS n" so the sheet still says whose it is.

**The app's table CSS stops at a statement.** `globals.css` styles bare
`table`/`th`/`td` for the app's own lists, and those rules used to reach
every statement in the preview: cells at 13px against the statement's own
7.5–10px, headings muted grey and uppercase, the last ruled line dropped,
rows shaded on hover. The print window never loads `globals.css`, so the
preview was showing a different document from the paper. They are now
`:where(td:not(.stmt-sheet *, .tpl-sheet *))` and so on — zero specificity,
so the app's own tables are unchanged — and `.stmt-sheet` sets `color:#000`.
Side effect worth knowing: sheets like CRS Page 2 now LOOK smaller in the
preview, because that is the size they have always printed at.

CRS Page 2, Free Com, Cost Com and B6 print their "NAME OF THE B.C … CRS
NO" line at 12px (was 10px; office, 2026-09-21).

### CRS Page 1 — saved Card Details and saved Allotment, nothing else

`buildCrsPage1` (office, 2026-09-21). `npm run verify:page1-card-allot`.
npm run verify:staff-posts     B.C / P.K.R by users-table role on every sheet: only BC, only Packer, both, none, role moved
npm run verify:daily-date-nav  Daily Entry ← Previous | Current | Next →: from the date on screen, calendar edges, stops at today

- **Allotment is the saved Allotment (`meAllotStore`) only.** It used to fall
  back to the month's godown receipts when no allotment was saved — and no
  allotment had ever been saved, so every Page 1 printed receipts under
  ALLOTMENT (CRS 19 Sep: 402 & 26.5, 851, 318 & 314…). A month with nothing
  saved now prints the captions with nothing after them; a saved month prints
  0 for a commodity it did not allot. The `receiptQty` redirect in
  `22-allotment.js` is left alone for its other reader (COLL).
- **Lines 1–5 are the office's; 6 and 7 are added**: 1.RICE&AAY = BRA & AAY,
  2 SUGAR & AAY_SUGAR, 3 WHEAT, 4 TOOR & PALM, 5 PHH_BRA & PHH_FRK,
  6.NPHH&AAY FRK, 7.RRA&NPHH RRA. There is no line 8: an 8.OAP&APS line was
  added and the office had it taken off, so OAP and APS allotments do not
  appear on Page 1.
- **Cards are placed by card id, in the office's order and captions**, plus
  LOF AAY CARD (the office's form had no row for it, so its count was in the
  total and nowhere else) and TOTAL CARD DETAILS = `d.cards.total`, the same
  sum Monthly Entry shows. A carried-forward draft nobody saved is not shown.
- **Staff lines follow the shop's roles** — see "Who signs a statement",
  below. The office's form (worded for CRS 19's Packer) is re-captioned per
  shop by `officeSheetFor()`; both posts add a name row and a signature block.
- The extra rows are added to the office's sheet in code
  (`templateAmend.ts`, `officeSheet()`), not in the extracted JSON, so
  re-extracting the workbook cannot lose them. Preview, Print and Excel all
  read the sheet through `officeSheet()`.
- Nothing is cached: every preview/print/export re-renders on the server from
  the database, so a save shows on the next preview. Live has no saved Card
  Details or Allotment for any shop (2026-09-21), so Page 1 currently shows
  0 cards and blank allotment everywhere — that is the saved data.

## Who signs a statement — B.C, P.K.R, both or neither

`src/legacy/43-staff-posts.js` (office, 2026-09-21). `npm run verify:staff-posts`.

- **The users table decides**, by role: `BC` prints as B.C / BILL CLERK / BC,
  `Packer` as P.K.R / PACKER / PKR — each sheet keeps its own wording. Only
  active users of that shop count; a role changed on the Users screen shows
  on the next render (the server reads the users table every time).
- **CRS_MASTER's `bc:`/`packer:` columns no longer name anyone on a
  statement.** They are spreadsheet columns, not roles: CRS 5, 8, 19, 28 and 29
  have a Packer in `bc:`, so every sheet called that Packer the Bill Clerk.
  `23-crs-master.js` still sets `d.bcName`; 43 runs after it and resets it.
- Only BC → B.C lines only. Only Packer → P.K.R lines only. Both → both, each
  with its own name and mobile, BC first (a phone line that could be read as
  either person's says whose it is, e.g. `CONTACT NO (P.K.R)`). Neither →
  no staff line at all, never an empty label or a ruled blank.
- Builders print through `staffJoin(d, fn)`, one line per filled post. A
  shop with only a Bill Clerk renders byte-identical to before (all 182
  sheets checked); the rest change only in their staff lines.
- Live, 2026-09-21: only BC 1, 9–12, 14–17, 23, 26, 27, 30; only Packer 5, 8,
  19, 28, 29; both 7, 20, 24, 25; none 2–4, 6, 13, 18, 21, 22.

## Monthly Sales Close needs both sections SAVED

A month closes only once **Card Details** and **Allotment** have been saved for
that month — checked before the month-close confirmation, so the confirmation
never appears for a month that cannot close (`monthCloseBlock`,
`monthly-entry/lib.ts`).

- **Saved, not filled.** Card counts carry forward from last month as a draft
  (`cardDraft`), so a month nobody has touched can show 500 RICE CARD. The
  check reads each section's marker — `meCardConfirmed` / `meAllotConfirmed`,
  one flag per `crsId_month_year` — set by **Save Card Details** and **Save
  Allotment**, which are now two separate buttons with their own ticks.
  Editing a figure clears that month's flag again (`applySectionFlag`), so a
  change made after a save is saved again before it counts.
- **Administrators are warned, not stopped.** Months keyed before this rule
  carry no marker, and a correction to one of those must not be walled off.
  Shop staff are stopped, with the office's wording:
  *Card Details Not Saved* / *Allotment Not Saved* / *Monthly Details Not
  Saved*.
- **Nothing here writes another month.** Last month's card details and
  allotment are read for the draft and left alone; each month's figures and
  markers stand on their own key.
- `meAllotConfirmed` is a new crs_state store: it is in `ALLOWED_KEYS`, the
  clear lists and the activity log's store labels, beside `meCardConfirmed`.
- **Allotment is still not carried forward** — it is re-issued by the
  department every month, and prefilling last month's figures would put a
  government quantity on a month it was never issued for. Only its *save* is
  new. Card counts carry as they always have.
- Daily Entry's own **மாத விற்பனை நிறைவு** (the Sales Close mark) is NOT gated
  by this: it marks the last sales day from the daily screen, where card and
  allotment figures are not shown.

`npm run verify:month-close`.

## Remittance — who may change what

One sales date, many deposits, all on the day sheet's `remits` array
(`engine/remittance.ts`). Monthly Remittance **derives** its rows from that
array; it never holds a copy, which is what stops a deposit duplicating or
drifting.

- **Rule 1b, in `stockGuard.ts`, is the whole permission model** and it is
  enforced in `/api/state`, not in the screens: a shop user may ADD deposits
  and take back one they have not saved yet, but a deposit already in the
  database keeps its amount, date, account and reason **and stays there**.
  Removal is refused too — otherwise "delete it and add it again" is a way
  round the lock, which is exactly how a saved date could be changed before.
- **Administrators** may correct a deposit's amount, deposit date and account,
  remove it, and add another to the same date — on **Daily Entry** (✎) and on
  **Monthly Remittance** (✎ / ✕ / ➕). The Monthly controls write the DAY SHEET
  the row came from, by id, and recompute `sheetTotals`; the rows stay derived.
  They save immediately (`saveConfirmed`), not at the month-close.
- **Account and reason are one choice** (`RemitType`, `applyRemitType`): a
  reason always lands in Non-Cereal, an account always clears the reason. So
  "Cereal A/C with a reason" — money in a column that is not a money column —
  cannot be produced by any correction. The classification rules themselves
  are unchanged.
- **Cereal A/C is admin-only and asks no reason.** A Cereal deposit is a
  separate account, not a second Non-Cereal payment, so it skips the
  additional-remittance dialog even when it is not the date's first deposit.
  Shop staff still key Non-Cereal only.
- The date's total is simply every deposit on it (`sheetTotals.remitAmount`);
  `remitDate` is the earliest of them, which is what the statements read.
- A sheet saved before deposits had ids converts to one deposit, same money,
  when an administrator corrects it — `txnsOf` already read it that way.
- Days with **no day sheet** (a month keyed by month) keep their hand-keyed
  Monthly Remittance row for everyone, as before: that is the month's own
  entry, not a saved deposit, and locking it would stop shops keying a month.

`npm run verify:remittance-admin`.

## Clear requests — what a day and a month take

`clearExecute.ts`. A **day** clear removes that shop and date only: the sheet
(its remittance lives on it), that date's inspection, and Sales Close only if
it names that day. A **month** clear removes every month store for it AND every
Daily Sales sheet and inspection dated in the month — a month keyed by day has
nothing else to clear. Neither touches receipts, other shops or other months'
records; both then rebuild the chain after them, so the next day outside a
cleared month re-opens from the last Closing before it. `verify:clear-execute`.

## Live sync

Open screens take other people's writes within about 4 s, without a refresh.
`dataStore.ts` asks `/api/sync` for store **versions** only; a store someone
else wrote is fetched alone (`/api/state?keys=`) and taken in, with this
client's unsaved changes laid over it record by record (`storeMerge.ts`). A 409
is rebased the same way and re-sent instead of reloading — every shop's day
sheets share one row, so reloading used to throw away the second of two
near-simultaneous saves. Clear requests and payment orders are not stores: they
move a revision (`useLiveRevision`) that the screens showing them re-fetch on.
Not Supabase Realtime, for the same RLS reason as notifications.
`verify:live-sync` drives the real data layer against a stand-in server.

## The save-success tick

One popup for all three saves — Daily Sales, Monthly Sales and a Receipt.
`src/components/SaveSuccess.tsx` is the host (mounted once in the root layout,
beside `DialogHost`); `src/lib/saveSuccess.ts` holds the wording and the
duplicate rule, so both can be checked without a browser.

- **It is evidence, not decoration: it appears only once the write has landed
  in the database.** The gate is `crsData.saveConfirmed()`, not `save()` —
  `save()` returns false for a refusal, for a save already in flight AND for
  nothing left to send, and only the first is a failure. With the autosave
  beat every 5 s, gating on `save()` would hide the tick on days that saved
  perfectly and send the clerk to key them again. `saveConfirmed()` waits out
  an in-flight save (3 s at most), then treats "nothing left to send" as
  stored unless a refusal left its reason in `lastError`.
- Each confirmation names the date the DATA belongs to (`16-09-2026`,
  `September 2026`), never today.
- **A repeat of the same save shows once.** The key is per shop and date or
  month (`daily:7:2026-09-16`), so a double-tapped button is one popup while a
  genuine later save of the same day is a new one.
- The month-close beside Daily Sales saves the day sheet `quiet`, then
  confirms the month — one tick per press, not two.
- The popup never takes the pointer and sits above the modals (z 9900 over
  9800), so it blocks nothing and is never hidden behind a dialog.

`npm run verify:save-success`.

## Activity log (admin only)

`activity_log` (migration `0006`), shown on `/audit` — "Activity Log" in the
nav, administrators only, enforced by `/api/activity/log` returning 403 to
anyone else. `src/lib/activityLog/core.ts` holds the rules; `server.ts` writes
and reads.

- **Written on the server where data changes, never in the browser.**
  `/api/state` diffs stored vs written record by record (`diffStateWrite`);
  clear decisions, payments, statement renders, users and sign-in build their
  own rows. So a live-sync fetch, a rebased re-send or a save of identical
  content never logs anything, and a refused or conflicting write logs only
  the refusal. Printing from a preview and opening the DSS happen in the
  browser, so those two are reported through `POST /api/activity`.
- **Two dates on every row.** `at` is when the person acted; `entry_date` (or
  `entry_month`/`entry_year`) is the date the DATA belongs to, taken from the
  record's key.
- **The person, not the login.** User id, full name and role are copied onto
  the row — a shop's BC and Packer share one username.
- **System updates are marked.** Later days re-carried by a save, a receipt
  moving its day's figures, a register reconcile: `source: 'system'`,
  `action: 'recalculated'`, attributed to whoever caused them. The browser
  names the record the person saved (`crsData.markEdited`) so a hand-keyed
  Opening on that day stays theirs.
- `monthlyStore`, `meSourceStore` and `__counters` are never logged — the
  roll-up republishes them on every save.
- **Recording never fails the action.** Errors are swallowed; a missing table
  is noticed and skipped for a minute. Until 0006 is run the dashboard's Recent
  Activity falls back to deriving from `crs_state_audit` (`src/lib/activity.ts`).
- Live: the log page and the dashboard watch the `activity` topic on
  `/api/sync` and fetch only rows newer than the ones shown.
- **Append-only, in the database** (migration `0008`): update, delete and
  truncate raise for every role, the service key included. `anon` and
  `authenticated` hold no privileges on the table. There is no edit path.
- **Snapshots**: name, role and `actor_crs_id` (the shop they belonged to then)
  are copied onto each row, so transfers, renames and deletions never rewrite
  old rows. The page's User filter lists only the selected shop's current staff.
- **History** (`historical = true`): `node tools/backfill-activity-log.mjs
  [--preview|--write]` rebuilds what the database genuinely shows — consecutive
  `crs_state_audit` versions diffed with the live rules, payment order
  timestamps, the clear-request event list, user `created_at`. Maintenance tool
  writes (`import:xlsx`, `cleanup:…`) are System; a shared shop login (crs7)
  leaves the role blank; an unrecorded person or previous value stays blank.
  `backfill_key` makes re-runs add nothing, and evidence newer than the first
  live row is ignored.
- Admin updates to operational figures are summarised "Admin correction — …";
  a remittance change names the deposit (amount, date, reason, added, removed);
  shops activated/deactivated, admin messages sent, PV/report prints and the
  Monthly Entry last-day sheet generation are their own rows.

`npm run verify:activity-log`.

## CRS 29 — Free Rice and Cost Rice

CRS 29 (Refugee Camp) keys two extra figures per day on Daily Entry: the kilos
of rice issued **free** and sold at **cost**. Both are required to complete the
day, and `0` is an answer where blank is not. No other shop has these fields.

- Stored on the day sheet as `freeRice` / `costRice`. A month keyed by month
  types them on Monthly Entry and carries them on its projected last-day
  sheet; `receiptSync` keeps them there when it rebuilds that projection.
- Printed by `src/legacy/40-crs29-rice.js`, which overrides `c29CRice`:
  FREE RICE (KG'S) → TOTAL, COST RICE BRA, and TOTAL RICE as the two
  together. A sheet without them prints what it always did — which is why the
  goldens still match, and why `verify:crs29-rice` covers the other case.
- `/api/state` refuses a new CRS 29 sheet without both and a save that strips
  them from one that had them, for admins too (`src/lib/engine/crs29Rice.ts`).
- Not written to `monthlyStore`: the statement's TOTAL row is the month's
  figure, so the roll-up is untouched.
- The **Sales Report** is the office's own sheet, reproduced in
  `src/legacy/41-crs29-sales-report.js` from `CRS 29-REFUGEE CAMP AUG'26 -
  SALES REPORT.pdf`: BRA FREE is B.RICE sales, BRA COST is the day's Cost
  Rice. Its geometry is the PDF's, in points, on a named `@page c29-sales`, so
  the A3-landscape `@page` another builder carries cannot reach it.
  `verify:crs29-sales` checks it against the PDF's own figures.

## Tools

```
npm run dev                 regenerates the statement modules, then next dev
npm run build:stmt          regenerate src/generated/*-legacy.js from src/legacy
npm run verify:statements    306 golden statements, byte-for-byte
npm run verify:rollup        roll-up at dev vs working tree, every live month + two-mode rules
npm run verify:crs29-rice    CRS 29 Free/Cost Rice: entry rules, server guard, C RICE mapping
npm run verify:crs29-sales   CRS 29 Sales Report against the office's own PDF: figures, headings, geometry
npm run verify:save-success  save-success tick: wording, one press one popup, and that it waits for the database
npm run verify:remittance-admin  remittance: what a shop user may change, what an admin may, and that a correction never duplicates
npm run verify:month-close   month-close needs Card Details and Allotment SAVED for that month (not merely filled)
npm run verify:statement-export  PDF sheets and one-worksheet-per-statement Excel, over all 306 goldens
npm run verify:receipt-rows  Receipt statement: a row per receipt, none reserved, none dropped
npm run verify:gunny-rows    Gunny statement: three rows, no spare line, every figure in one column
npm run verify:page1-card-allot  CRS Page 1: saved card counts by id + total, saved allotment only (never receipts), per shop and month
node tools/render-section.mjs <sectionId> <outDir>   render one section for every shop, to diff a builder change
node tools/dump-golden-stores.mjs   refresh public/golden-stores.json first
node tools/import-monthly-xlsx.mjs <folder> [--skip=29] [--write]
node tools/seed-masters.mjs
node tools/backup-crs-state.mjs
```

`verify:statements` needs `public/golden-stores.json`, which is gitignored live
data — run `dump-golden-stores.mjs` (needs `.env.local`) or it dies with ENOENT.

The Excel importer maps columns **by header name, never by position**. Not a
style preference: the 22 monthly workbooks have **13 distinct column layouts**,
differing in how many adjustment columns (`EXCESS` / `SHORTAGE` / `TRANSFER` /
`C.S`) sit between RECEIPT and TOTAL. A positional importer silently shifted 13
of 22 shops' figures. Sheet names vary too (`CRS PAGE2`, `CRS PAGE2 `,
`CRS PAGE2 - 2`), so sheets are matched by normalised prefix.

## Gotchas that have already bitten

- **Write to `meManualStore`, not just `monthlyStore`.**
  `rebuildMonthlyFromDaily()` regenerates `monthlyStore` from the daily rollup
  plus `meManualStore` whenever Monthly Entry opens. Data written only to
  `monthlyStore` disappears on first view.
- **Never verify using the assumption under test.** An import was once
  "verified" by re-reading the sheets with the same hardcoded column indices —
  it proved the code agreed with itself while 13 shops were wrong. Verify by an
  independent route, and check arithmetic that does not depend on your mapping:
  `open + receipt ± adjustments = total`, `total − sales − cs = close`.
- **Test from a signed-out state.** A leftover session cookie once made a broken
  two-step login look fine.
- **Adjustment signs**: `inspNet()` computes `excess − shortage +
  transferDelta(transfer)`, and `TRANSFER_IS_OUTWARD = true`, so a positive
  transfer subtracts. Store shortages as positive magnitudes. Shortage does not
  apply to Section B (police) commodities.
- **`src/generated/*-legacy.js` are build output.** Their header says DO NOT
  EDIT and means it — `predev`/`prebuild` overwrite them. Edit `src/legacy/`.
- Statement layout arrays in `12-statement-builders.js` are **form templates, not
  data**. Leave them in code — a bad database row there produces malformed
  statutory paperwork with no diff and no review.

## Deploy checklist

- Set all four env vars in Vercel (`.env.local` is local only)
- Vercel → Functions region **Mumbai (`bom1`)** — users are in Tamil Nadu, and
  the default `iad1` round-trips every request through Virginia
- Run any new migration against the live database as an explicit step —
  `0004_payments.sql` included, or the Payments screen 503s and every download
  silently stays free
- `0005_notifications.sql`, then `0007_notification_dedupe.sql`, too. Unlike 0004 nothing breaks without it — every
  approval proceeds and notifications are silently skipped — which is exactly
  why it is easy to forget: the bell just stays at zero forever
- Supabase free tier **pauses after 7 days idle and has no backups** — upgrade
  before real users depend on it

Backups live in `backups/`, gitignored because they contain staff names and
phone numbers.

## Open items

- Five staff are `bc:` in `CRS_MASTER` but `Packer` in the users table
  (CRS 5, 8, 19, 28, 29). Statements now follow the users table and print them
  as P.K.R (2026-09-21); the master's column itself is unchanged.
- Everyone shares the password `pds123`; the audit trail's `updated_by` proves
  little until that changes.
