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

**A sign-in never hangs.** `login()` (authClient.tsx) abandons the request
after `SIGN_IN_TIMEOUT_MS` (20 s) and says so, and the login page always takes
the button back from "Connecting…" (try/finally) — it used to wait for ever on
a request that never answered. The sign-in's activity-log row is written with
`after()`, so the answer no longer waits for three log round trips.

**A sign-in the server accepted either opens the app or says why it
cannot** (office, 2026-09-28; `npm run verify:sign-in`, add
`--base=http://localhost:3000` for the flow in Chrome, desktop and phone).
An administrator (the ADMIN account, signing in by its phone number) pressed
Sign In 19 times in 33 seconds: `verify_login` accepted every one — the
activity log has 19 "Signed in" rows — but the browser kept no session
cookie, so each "yes" went to /dashboard, the middleware (cookie presence)
sent it back to /login, and the page said nothing: "Connecting…" for a
moment, then the same form. Shop users signed in normally the same day, so
it was that browser, not the server or the account.
- The answer now also sets `crs_signed_in=1` (`sessionMarker.ts`): the
  session's own attributes, not HttpOnly, carrying no identity. No marker
  after a yes → one GET /api/session; still no session → *"…this browser
  did not keep the sign-in… allow this site under Cookies and site data…"*.
  A kept sign-in costs nothing extra.
- The page's first "who is signed in?" check could answer AFTER a sign-in
  (a cold server) and set "signed out" over it; an `epoch` now discards an
  answer older than the latest sign-in or sign-out.
- The login error box was pale pink (`#FCA5A5`) on the WHITE card — close to
  invisible, so even a wrong password looked like no answer. Now dark red on
  light red, `role="alert"`.

**A shop's sign-in username is the shop's — `crs8` — never the person's
name.** The Users screen's Add / Edit form used to send `username: name` on
every save, so editing an account silently renamed its login: on 2026-09-22
an admin edit of CRS 8's Anand turned `crs8` into `Anand`, and `crs8` /
`pds123` answered "Incorrect username or password" (verify_login found no
row — its `lower(username) = lower(input)` match was never the problem).
`signInUsernameFor()` (engine/staffAssignment.ts) now decides: a new account
takes `crs<N>`; an edit sends no username, unless the account moves shop,
when a shop username follows it as a transfer does. #5016 was restored to
`crs8` (backup in `backups/user-5016-…`). `npm run verify:staff`.

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

`/api/statements/render` and `/api/statements/pdf` — and both run the ONE
gate in `lib/statements/renderServer.ts` (`buildStatements`: validate →
`authorise()` before anything is built → re-derive what the shop may ask for
→ build exactly those). Do not give either route its own copy: a second copy
of the gate is one forgotten check away from a free statement. The /statements page used to build
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

### The DSS viewer on a phone

`17-dss-export.js`, the viewer's own CSS: an `@media screen and (max-width:560px)`
block (office, 2026-09-22). The title and the Excel / Print-PDF / Close buttons
wrap into two rows; the table sits in `.dss-tbl-wrap` and scrolls inside it,
sized to its content (≈ 770px — a fixed width cut the Tamil headings), with the
commodity column pinned while it scrolls. Markup is the same apart from the
wrapper and `dssv-*` class names, so every figure is identical (all 10 of CRS
19's September pages compared old vs new), and tablet, desktop and the printed
page lay out exactly as before (compared position for position at 768 and 1280).

### The DSS prices sales at the SAVED rate

`DSS_A` / `DSS_B` are sliced out of `03-daily-entry.js` by the module builder,
**rates and all**, so every rate in the generated engine is frozen at whatever
was compiled into that file. The office moved CIS to ₹10.00 on the Commodities
screen on 2026-09-22 and every DSS page went on printing 12.00 — and pricing
the day's salt sales by it (office, 2026-09-26).

The DSS engine now takes `ctx.commodityMaster` (Daily Entry passes
`__commodityMaster`, read when the DSS is opened) and **overwrites the rate of
any commodity the master names**, in `DSS_EPILOGUE`. One preview, one Excel
export, one print — all three read the same list, so they cannot disagree.

- **Only the rate.** Which commodities exist, their order, their Tamil labels
  and which are free stay the engine's; a master row for a commodity the DSS
  has no line for adds nothing. A missing, blank or non-numeric rate leaves
  the compiled one; a rate of `0` is a rate.
- The lists are created fresh inside each `createDssEngine` call, so the
  override cannot leak between instances.
- Live, 2026-09-26: **CIS is the only commodity whose saved rate differs from
  the compiled one** (10 vs 12) — every other rate and free flag already
  agrees, which is why this changes exactly that one figure.
- **The statement engine still uses the compiled rates** (`c.rate` in
  `12-statement-builders.js`, e.g. the Sale Tax sheet), so a statement prints
  CIS at 12.00 while the DSS now prints 10.00. Same fix would apply — the
  statements were left alone because their output is checked byte-for-byte
  against the goldens and that is the office's call.

`npm run verify:dss-rates`.

### The DSS TOTAL row, and what the C A/C line states

Both changed on the office's asking (2026-09-26); `npm run verify:dss-totals`.

- **The TOTAL row carries the money alone.** It used to add the kilo columns
  down the page — opening + receipt + total + sales + closing — figures the
  form does not ask for. Those five cells are now blank (their ruled box
  kept), and the row keeps its number, its மொத்தம் label, ரூபாய் and the
  amount. Both TOTAL rows: the main one and the police one.
  `sectionRows` / `writeSection` still add the sums up; nothing prints them.
- **The C A/C line is the money BANKED for that sales date**, read from the
  day sheet's own deposits (`dssRemitOf`, the same reading as
  `engine/remittance.ts` `txnsOf`: the `remits` array, else the single
  `remitAmount` an older sheet carries). It used to be `A.total + B.total`,
  the day's sales priced out — CRS 8's 21-09-2026 page said **4639.50** where
  the shop had banked **4640**.
  - Every deposit on the date counts, Cereal and Non-Cereal alike: the line
    states what reached the bank, and shops key Non-Cereal only, so a
    cereal-only reading would print 0.00 on nearly every page.
  - An administrator's correction, an added deposit and a removed one all
    land in that array, and the sheet is read when the DSS is opened — so the
    next DSS shows them, and nothing is cached. A date with no deposit prints
    **0.00**, which is what the shop banked.
- Preview, Print/PDF and the .xlsx (D–H of rows 35 and 43, G45) all changed
  together; the commodity rows, the rates and the OB→CB arithmetic are
  untouched.

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

**A month opens where its FIRST day sheet opens** (office, 2026-09-29;
`dailyRollupForMonth`). The roll-up used to take a commodity's Opening from
the first sheet on which it had a NON-ZERO figure, so a commodity that opened
the month at 0 took its Opening from a later day that already carried a
receipt the month also counts as Receipt — counted twice. CRS 8 CIS: 0 on
01-09, 100 received on the sheet-less 15th, sold on the 21st — published as
Opening 100 + Receipt 100 − Sales 100 = Closing 100, where the shop held 0.
Now the Opening is the first sheet's, zeros included, less anything received
or adjusted on the month's sheet-less days before it (the chain carried those
into it). Found on live data the same day: CRS 8 (BRA, PHH BRA, AAY, CIS),
14 (NPHH FRK), 19 (PHH BRA, AAY), 20 (the four police lines), 30 (RRA, CIS,
RFFS) — every one now closes where its last day sheet does and the old
figure did not. `verify:rollup` allows exactly that difference from `dev`
and nothing else, and carries the CRS 8 case. CRS 8's stored CIS row was
rewritten with `node tools/republish-month-rows.mjs --crs=8 --month=9
--year=2026 --ids=SALT_CIS [--write]` (a Daily-keyed row only, and only if
the republished Closing equals the last day sheet's; backed up); the other
rows follow on the next render or Monthly Entry save.

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

**An Initial Opening keyed into the wrong commodity's box** is corrected with
`node tools/swap-opening.mjs --crs=N --date=YYYY-MM-DD --a=ID --b=ID` (dry run)
then `--write`. It trades the two Openings on the shop's chain-start sheet
(refusing any later, carried day), moves each Total and Closing by the same
amount, then does what a Daily Entry save does — rebuilds the month and the
chain after it — and writes only that shop's records, backed up and under
version. It first proves that rebuilding the untouched month reproduces the
stored one. Used for CRS 10 on 2026-09-22: PHH BRA 2056.02 ↔ PHH FRK 1195.982
on 01-09-2026 (backup `backups/swap-opening-crs10-…`).

## Commodity scope — All Shops or one Particular Shop

Office, 2026-10-01 (`src/lib/engine/commodityScope.ts`, `npm run
verify:commodity-scope`). Commodity Master's Add / Edit takes an **Order**,
a **Scope** (All Shops / Particular Shop) and, for a particular shop, the
CRS.
- **One record, never a copy per shop**: `{ scope: 'shop', shopId: 14 }` on
  the master row. No scope = All Shops, so every row that existed before is
  exactly as it was.
- **Every entry list is "global + this shop's own", in Order** —
  `commodityListsFor` / `useStockLists` (masters.ts), i.e. Daily Entry,
  Monthly Entry, Inspection, Receipt, Allotment, the Dashboard stock lists.
  CRS 29's fixed camp list takes its own scoped rows at their Order too.
  An all-shops view (no shop chosen) sees every row.
- **Order is the position on every list.** A free number moves nothing; a
  taken one moves only the run of rows from it up to the first free number
  (`placeAtOrder`), never the rest. Order is one numbering across both
  sections (Main 1–22, Police 23–27, then additions).
- **The server holds the line** (`/api/state`): a shop user's read of the
  master is `masterForShop` (global + own — never another shop's); only an
  administrator may write `__commodityMaster` (a shop user's filtered copy
  written back would drop every other shop's rows — and nothing in the shop
  screens writes it); `inspectScopeWrite` refuses a figure KEYED into a
  commodity that belongs to another shop (day sheet Sales / Receipt, a
  month's Opening / Receipt / Sales, a receipt line), administrators
  included. Figures saved before a re-scope, re-carried by the chain, pass.
- **Editing**: names, unit, rate, Order and Scope always; code and section
  only while no shop holds a saved figure for it (every record is keyed by
  both). Narrowing to one shop when others hold figures asks first; their
  figures stay in the database, the commodity leaves their screens.
- **Not covered — statements, the DSS and the PV.** They print the
  statutory forms' fixed rows from the compiled engine (CLAUDE.md above),
  so NO added commodity — All Shops or Particular — appears on them; the
  master only feeds them rates. Unchanged here; a decision for the office.
- Localhost, admin, live copy: Special Rice CRS 14 / Order 23 → CRS 14's
  Daily and Monthly Entry between Empty Polythene Bag and OAP FRK, absent on
  CRS 1 / 5 / 10; Order 23 → 5 → between PHH BRA and AAY FRK; → All Shops →
  on CRS 1 and 30; existing rows untouched; 390 px phone, no sideways scroll.

## The OAP / APS / ANP statement (Reports)

Office, 2026-10-01 (`src/lib/engine/oapStatement.ts`, `reports/OapStatement.tsx`,
`npm run verify:oap-statement`). Reports → **🧓 OAP / APS / ANP**: one A4
landscape sheet per shop, in the office's "OAP & ANP" layout (TAMIL NADU …
MADURAI REGION / title / CRS n … MON'YY / COMMODITY · O.B · RECEIPT ·
SHORTAGE · TOTAL · SALES · C.B).
- **Kept apart from the statements**: not a section of the statement
  engine — no paywall, no golden, no builder touched.
- **The family is the Commodity Master's**: every code OAP…, APS… or ANP…
  (today OAP, APS — the POS's "ANP" —, OAP_FRK; ANP / APS_FRK / ANP_FRK join
  when added). Commodity: one of them, or All (the sheet's title is then the
  ones on it, "OAP & APS").
- **A shop gets a sheet only with an entry**: the commodity has some
  Opening, Receipt, Shortage, Sales or Closing that month. An administrator
  ticks any set of shops (all by default); a shop user sees their own.
- **Figures are Monthly Sales' own** (`rebuildMonthlyFromDaily` with the
  shop's master list), worked out on every render — Daily / Monthly edits
  show at once. TOTAL and C.B are the month's own, i.e. O.B + RECEIPT and
  TOTAL − SALES when there is no shortage (with one, TOTAL is after it, as
  everywhere else).
- **Print / PDF**: a document of its own printed from a hidden frame
  (`lib/printHtmlFrame.ts`) — `@page A4 landscape`, one page per shop, no
  app on it; "Save as PDF" in the dialog gives the PDF.
- Localhost, live copy, September 2026: CRS 10 (OAP 3+2−5=0, APS 10), 19
  (OAP 5), 26 (OAP 0+5−5=0) — the 27 others left out; APS alone → CRS 10;
  the printed document → 3 pages, each 297 × 210 mm; CRS 19's Packer sees
  CRS 19 only. (No shop has an OAP entry for August.)

## Dates on screen are DD-MM-YYYY

Office, 2026-09-29 (`npm run verify:date-format`). A phone's Chrome in US
English showed Daily Entry's date as **09/29/2026**: `<input type="date">`
draws its text in the BROWSER's language and ignores the page (`lang`, CSS,
nothing changes it).

- **Every date box is `DateField`** (`src/components/DateField.tsx`) — never
  a bare `<input type="date">` (the verify refuses one). It shows our own
  text, `29-09-2026`, and keeps the browser's calendar: on a touch screen the
  native input lies invisibly over the box, so a tap opens the phone's own
  picker; with a mouse the date can be typed (digits, dashes come by
  themselves; `min`/`max` hold) and 📅 calls `showPicker()`.
- **Value in and out is ISO `YYYY-MM-DD`**, exactly what the native input
  gave — stores, keys, the chain, holidays and every calculation unchanged.
- `src/lib/dateFormat.ts`: `dmy`, `dmyTime`, `parseDmy` (DAY FIRST; the US
  `09/29/2026` is not a date, never guessed into one), `maskDmy`,
  `dmyFromLocale` (a receipt's STORED `savedAt` text is only re-shown; what
  is stored is unchanged).
- The screens' hand-made `DD/MM/YYYY` (remittance rows, Sales Close, clear
  requests, confirm dialogs) are `DD-MM-YYYY`. Named-month texts ("Tuesday,
  29 September 2026", "29 Sept 2026") stay — they cannot be misread.
- **The printed statements and the DSS are untouched**: their dates are the
  statutory forms' own (`fmtDate` in the builders) and the goldens hold them.

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

- **The bar takes the clerk back up** (office, 2026-09-28): ← Previous and
  Next → change the day and then — once the new day is on screen (the
  `scrollTo` effect waits for `date` to be the one asked for, and runs after
  the fill effect) — scroll to `#de-entry`, the shop's blue header over
  Section A, 12 px under the top bar. **Current Date** is a button that only
  scrolls, never changes the day. The date box at the top does not scroll.

### An administrator may save a day without a remittance

Office, 2026-09-28. `remitCollect()` refuses an empty deposit list for shop
staff exactly as before ("Please enter the Remittance Amount."), but lets an
ADMIN through: the sheet is saved with `remits: []`, `remitAmount 0`, blank
`remitDate` — what every reader already takes as nothing banked (the DSS's
C A/C line 0.00, no Monthly Remittance row). The server never required a
deposit, so nothing there changed; a remittance added later on Daily Entry
goes through the usual save and chain. The note under Remittance says which
rule applies to the person looking at it.

### Last Entry Date | Total Entry Dates

Under the shop / date pickers (office, 2026-09-28; `npm run verify:entry-dates`),
from `engine/entryDates.ts`:
- **A date counts once, for a real saved day sheet**: key `<crs>_<YYYY-MM-DD>`,
  some figure not zero (`sheetHasStock`), and NOT a Monthly Entry projection
  — a form emptied and saved is not an entry. Calendar, working days and
  holidays play no part.
- **Saved, not typed**: it reads dataStore's `useSavedStore('entryStore')`,
  the copy last confirmed in the database (`getSaved`, parsed once per saved
  JSON). A sheet still being sent or one the server refused is not counted;
  a landed save, another person's save and an approved clear (live sync) move
  it at once. `save()` now emits when a save lands, so readers of the saved
  copy hear about it.
- Live, 2026-09-28: CRS 19 19-09-2026 | 14 days, CRS 7 26-09-2026 | 22 days.

## Phones: dashboard order and the header bell

`responsive.css`, the last `@media (max-width: 560px)` block (office,
2026-09-21). Tablets and desktops are untouched.

- **Dashboard order**: Quick Actions straight under the hero; the three
  summary cards (Entries This Month, Days Without Entry, Receipt Dates) together
  at the foot. `#page-dashboard` becomes a flex column and `.dash-hero` /
  `.dash-quick` / `.dash-kpis` take an `order` — the markup and data are
  unchanged, and it is by class, so it is the same for every user.
- **The bell**: the title block had no `min-width:0`, so it never shrank and
  pushed the right-hand group (bell + date chip, 88px) 46px off a 375px screen,
  leaving the bell jammed against the edge with no room for its badge. The
  title now gives way (it ends in "…"), the bell group never shrinks, and the
  date chip is hidden on a phone — it was already off-screen there.
- Checked at 320 / 375 / 390 / 414 / 430: no sideways scroll, header fits, bell
  12px from the edge (the badge sticks out 6px), panel on screen.

### Last month's Closing is this month's Opening — for administrators too

Office, 2026-10-01 (`npm run verify:carry-forward`). CRS 5 October 2026, an
administrator on Monthly Entry: every Opening box 0.000 although September
had closed. `rowFor` worked the carry out only for a shop user's LOCKED
Opening; an administrator's box showed a typed or saved figure, and a month
nobody had saved has neither — a month-close would have saved the zeros.
- Where the month holds **no saved row** for the commodity, the Opening is
  the carry for everyone: the stock chain's balance on the 1st, else last
  month's published Closing (`prevMerged` — a month keyed by month and not
  yet closed has no sheet for the chain: CRS 23, September BRA 1000). A
  typed or saved Opening still wins; the box shows the figure that will be
  saved; the sales-only bag rows (Empty Card+Box / Polythene Bag) keep the
  chain's 0 — their stock is Gunny's. The rule for shop staff is unchanged.
- **Gunny**: October opens at September's STORED Closing (`gunnyRowFor`),
  and 20 shops' September copies lagged their sales (CRS 11 50 KG SS 870 vs
  1291; CRS 7 none vs 311). `refresh-gunny --month=9 --year=2026 --write`
  was run on 2026-10-01 (office's go-ahead; derived copies only, backed up
  `backups/refresh-gunny-9-2026-…`); it now compares figures, not
  `updatedAt`, so a re-run writes nothing.
- Localhost, live copy: CRS 5, 1, 11, 23, 29, 14, 7 October — every
  commodity Opening and SS / Poly / C.Box = September's Closing, as admin
  and as CRS 1's Bill Clerk; after a refresh, leave-and-return, a shop
  change, and a month-close (CRS 5 BRA saved 2173) reopened.
- Not changed: CRS 10's September Salt rows are a hand-keyed month row
  (Opening / Closing 100) beside its day sheets; the chain does not see it,
  so October carries 0 there — the office's to settle.

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

### An Opening correction is asked about before it is saved

Office, 2026-09-30 (`npm run verify:opening-correction`). A correction on a
LATER day is stock the month cannot see: the month opens at its first
sheet's Opening and closes at Opening + Receipt ± adjustments − Sales, so
the corrected day — and next month — no longer agree with it ("previous
month CB → next month OB" breaks). CRS 5, 30-09-2026: Police BRA carried 0,
12 was typed on Daily Entry; September closed at 0 while October would have
opened at 12. It looked like "Police OB not syncing to Monthly Entry"; the
roll-up was right.
- Daily Entry's save now asks an administrator first (`newOpeningCorrections`
  in `daily-entry/openingCorrections.ts`): every Opening about to be saved
  fixed that differs from its carry, each with carried / typed / difference.
  "Go back" is the default and saves nothing. Not asked: the start of the
  chain (the Initial Opening), a figure typed back to the carry, a correction
  already saved at that figure. The rule, the permission and the calculation
  are unchanged.
- The office decided the 12 was right, so CRS 5's 01-09 Police BRA Opening
  was put back to 12 (it had been set to 0 from the POS on 2026-09-29):
  01-09 12 → September 12 + 18 − 18 = 12 → 30-09 carries 12 (no longer a
  correction) → October 12. Done with `node tools/correct-opening.mjs
  --crs=N --date=YYYY-MM-DD --id=ID --open=V [--write]` — Daily Entry's admin
  correction on a saved sheet; a later fixed Opening that then equals its
  carry loses the mark; month republished, chain rebuilt, backed up, under
  version.

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
| Opening | this month's own figure, else last month's Closing carried, else 0 — a stored COPY of the carry (`openingAuto`) follows last month's Closing |
| Receipt | the sum of the bag counts MONTHLY SALES shows, by pack — its only source; see "Gunny Receipt is counted from the saved sales" (Sales Close and a typed `receiptImported` are no longer read, 2026-09-30) |
| Issues | as typed, else POLY / C.BOX's month's EMPTY_BAG / EMPTY_BOX sales, else 0 |
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

## C.Box and Poly: the sale is the Gunny issue

Office, 2026-09-26. `npm run verify:gunny-sales`.

Empty Card+Box and Empty Polythene Bag are **not stocked on the sales grid** —
the bags they cover are held in Gunny Stock Management. Selling 166 boxes on a
grid that stocks none printed a closing of **−166.000**, because the binding
ran the wrong way: typing **Issues** in the Gunny table WROTE those sales rows
(`onIssuesToMonthly`). It now runs the way the office keys it.

- **The sale is the Issues figure.** `gunnyRowFor` (and its legacy twin
  `42-gunny-live.js`, so the Gunny statement agrees) takes POLY and C.BOX
  Issues from the month's own EMPTY_BAG / EMPTY_BOX **sales**. A keyed figure
  — an administrator's correction — still wins. **50 KG SS has no commodity
  row of its own and stays hand-keyed**, by the shop as before.
- **The entry row takes Sales only for those two** (`SALES_ONLY`,
  engine/commodities.ts), on Daily and Monthly Entry alike: Opening, Receipt,
  Total and Closing are not shown at all (office, 2026-09-27; the Closing
  alone went on 2026-09-26), because those four are kept in Gunny Stock
  Management and four empty boxes on the grid only invite a second,
  contradictory stock record. Rate and Amount are unchanged, so the money
  still reaches remittance. Display only: what is stored, what the statements
  print and what the DSS prices are untouched — every section of every shop
  renders byte-identical on live data.
- **Deducted once.** Sale → amount → remittance → gunny Issues → statement
  sales. Nothing else subtracts those bags.
- **The gunny figures are the office's.** Opening, Receipt, Total, Closing and
  the two automatic Issues are read-only for shop staff; an administrator may
  correct Opening. (Receipt was admin-typable through `receiptImported` until
  2026-09-30; it is now Monthly Sales' figure for everyone, and Issues are
  typed by the shop too — see "Gunny Receipt is counted from the saved
  sales".) **Total and Closing stay derived for everyone** —
  they are `Opening + Receipt` and `Total − Issues`, and a typable one only
  lets a row disagree with itself, the same rule the commodity grid keeps.
- **Enforced on the server**: `stockGuard.ts` rule 5 (`inspectGunnyWrite`),
  run from `/api/state`. A shop user's write must agree with what the rule
  works out — which is what the screen sends, since it stores those derived
  copies. Refusals are labelled `Gunny Stock`. There was **no server rule at
  all** before: the guard only ever looked at entryStore, meManualStore and
  monthlyStore.
- **Monthly Entry writes the gunny rows out on save**, because a shop can now
  key a whole month without touching that table and **next month's Opening is
  the Closing stored here**. The derived Issues are deliberately NOT stored: a
  stored figure reads as keyed and would stop following the sales.
- **No TOTAL summary** under the gunny table: sacks, bags and boxes added into
  one figure state a quantity of nothing. Each row keeps its own Total.
- Live, 2026-09-26: no month has C.Box/Poly sales and every gunny Issues is
  blank, so none of this moves an existing figure.

### Gunny Stock Management's own Save

Office, 2026-09-29. `npm run verify:gunny-save`.

- **💾 Save Gunny Stock**, under the table's ⓘ notes (its own row, full
  width on a phone), saves the selected shop and month **exactly as the
  month-close does**: both call `gunnyMonthRecords` (monthly-entry/lib.ts).
  Do not give either one its own copy of that write.
- Stored: keyed figures as keyed (an Opening the office set, typed Issues),
  plus the derived copies the table always
  kept — the carried Opening, Receipt, Total, Closing. POLY / C.BOX automatic
  Issues are still NOT stored. Next month opens at the Closing stored here.
- `gunnySaveProblems` runs first: a keyed Opening / Receipt / Issues that is
  not a number ≥ 0 is refused with nothing sent; a Closing below 0 asks
  ("Closing below zero") before saving.
- The tick (`gunnySaved`) appears only after `saveConfirmed()`. A refusal
  (e.g. stockGuard rule 5) shows the server's reason and no tick. A second tap
  while one is being sent is ignored.
- Permissions are the inputs' own and rule 5's; the button changes neither.
  A shop user's Save passes rule 5 because it stores what the rule works out.
- **Save-only, with an unsaved marker** (office, 2026-09-30). Typing used to
  write the store, whose 5-second autosave sent each keystroke — so pressing
  Save often had nothing left to send, and the office read that as "Save
  does not work" (CRS 29, 11:11 and 11:36: two saves that changed only the
  timestamp). Now typing changes a DRAFT held by the table, per shop-month
  (`drafts[ctx.key]`), and nothing reaches the database until Save. Total
  and Closing follow the draft on the same render; the button turns amber
  ("unsaved changes", `data-dirty`), a value typed back to the stored one
  drops out of the draft, and leaving the page with a draft asks first
  (`beforeunload`). Save lays the draft over the month AS THE DATABASE HOLDS
  IT NOW (so someone else's newer figure is kept), validates, stores, and
  clears only the edits that were sent once `saveConfirmed()` lands; edits
  typed while it was on its way stay unsaved.
- **An administrator may type the Receipt** (office's choice, 2026-09-30):
  stored as `receiptTyped`, it wins over Monthly Sales' figure for that
  month, shown orange with "Monthly Sales says N"; clearing the box drops
  the field and goes back to Monthly Sales. Shop staff: read-only, and rule
  5 refuses a `receiptTyped` a shop user changes. The legacy
  `receiptImported` (CRS 5's 236 / 23) stays unread — only a Receipt typed
  from this date counts. Screen, rule 5, PV and statements (42-gunny-live.js)
  read it the same way.
- Browser run on a copy of live data (stubbed API; each write judged by the
  real guard): every row × Opening / Receipt / Issues on its own, all nine
  in one Save, clearing a typed Receipt, CRS and month changes, a shop user's
  Issues, CRS 20 and 29 — each saved, ticked after the database, and read
  back after a reload.

### Gunny Save carries POLY / C.BOX into Monthly Sales and the last day

Office, 2026-09-30 (`engine/gunnySync.ts`, `npm run verify:gunny-sync`).
Keyed once, in Gunny Stock Management: its Save turns POLY / C.BOX **Issues**
into Empty Polythene Bag / Empty Card+Box **Sales** — the only rows those
bags have on Monthly and Daily Entry, and where their money reaches
remittance — before storing the gunny rows. Worked out first; if it cannot
be placed, nothing is sent.
- **Monthly Sales**: meManualStore's EMPTY row = the Issues (the grid's own
  arithmetic; unchanged figures are not rewritten).
- **The last CALENDAR date** carries what the month's other day sheets have
  not sold (so the month = the Issues, once; more already sold than the
  Issues → refused). Keyed by day: the sheet there is updated in place (its
  remittance and every other row untouched), or — office's choice — CREATED
  as a Daily Entry save makes it (carried Openings, that day's register
  receipts and inspection, Sales 0 elsewhere, no remittance; it counts as an
  entry date and gets a DSS page). Only once the date has come (office's
  choice): before it, Monthly Sales alone, and the first Gunny Save on or
  after the date writes the sheet. Keyed by month: the projection is updated
  if the month was closed; otherwise the month-close projects it. CRS 29: no
  sheet is made without its Free / Cost Rice.
- Then the month republishes and the chain rebuilds from the last day, so the
  next month opens at its Closing (day chain and Gunny Opening alike).
- **50 KG SS** has no row on either screen: Gunny Stock Management only.
- No loop: nothing reads a Gunny figure back from these sales except the
  table's existing rule (POLY / C.BOX Issues = those sales when not keyed).
- Permissions unchanged; /api/state's guards judge the write as ever. Live
  dry run 2026-09-30, read only: CRS 20 → 30-09 created (C.Box 108, Poly 72),
  CRS 5 → 30-09 updated (62 / 22); only those shops' keys; stock guard passes
  as shop user and admin.
- On the day chain, C.Box / Poly have no stock (it is kept here), so their
  hidden Closing on the sheet goes below 0 by the sales — as it always has
  when those bags are sold on Daily Entry.

### Gunny Receipt is counted from the saved sales

Office, 2026-09-30 (`engine/gunnyPack.ts`, `npm run verify:gunny-receipt`).
ONE rule for the Gunny screen, the month-close, Daily Entry, rule 5, the PV
and — in `42-gunny-live.js` — the statements:
- **Receipt = the packs the month's saved sales emptied**: per commodity,
  floor(month's sales ÷ pack size) (`bagsOf`) — GUNNY: BRA, AAY, AAY FRK,
  NPHH FRK, PHH FRK, PHH BRA, RRA, NPHH FRK RRA, WHEAT, T.DHALL (+ OAP, APS,
  police BRA) ÷50; POLY: SUGAR, AAY SUGAR ÷50, SALT CIS / RFFS ÷25; C.BOX:
  P.OIL ÷10, OOTY, TAN ÷50. On the MONTH's total from the roll-up, so keyed
  by day and keyed by month give the same count, once.
- **Only rows with a bag box on the Monthly Sales grid are counted.** Police
  sugar / wheat / dhall / palm oil have none there (`NO_GUNNY`), so they left
  `PACK_BASE` on 2026-09-30 — a bag Gunny counted that Monthly Sales does not
  show would be a mismatch. No live month has a police sale that fills a
  pack (largest 10), so no figure moved.
- **The Receipt page's Gunny / Poly switch is saved** on the receipt line
  (`items[id].pack`) for WHEAT, RRA, NPHH FRK RRA (and police BRA); a
  month counts each as its latest receipt dated in that month says, else
  Gunny (receipts saved before 2026-09-30 carry no switch → Gunny).
- **Sales Close no longer sets the Receipt** (office's choice). CRS 7
  September moves from its Sales Close 112 / 11 / 33 to 311 / 39 / 88 —
  its POLY / C.BOX Closings −28 / −55 → 0; every other live shop unchanged.
- **Monthly Sales is the single source — nothing typed overrides it** (amended
  the same afternoon: an administrator's `receiptTyped` does; see "Gunny Stock
  Management's own Save")
  (office's second instruction, 2026-09-30; reverses "an administrator's
  Receipt wins" of the same morning). The Receipt is the SUM OF THE BAG
  COUNTS MONTHLY SALES SHOWS in its Sales column, by pack: `salesBags` is
  one row's count exactly as the grid works it out (the office's stored
  `g_sales` where it keyed one that differs from the division, else sales ÷
  pack size), `monthSalesBags` a whole month's; on screen the table is
  handed the grid's own figures. `receiptImported` is **no longer read** by
  the screen, rule 5, the PV or the statements, and the Receipt box is
  read-only for administrators too. CRS 5 September showed 236 / 23 from a
  Receipt typed off the POS on 2026-09-29 while Monthly Sales said
  **227 / 28** — it now reads 227 / 28 / 61. Live, read only: that was the
  ONLY record with a typed Receipt, and no Monthly Sales row anywhere has a
  bag count differing from the division, so no other shop moves; all 16
  shop-months with sales: Monthly Sales = Gunny screen = Gunny statement.
  The stored `receiptImported` values are left in place, unread.
  `tools/import-monthly-xlsx.mjs` still writes one from an office workbook;
  it is likewise unread — the imported sales' own bag counts decide.
- **Issues are typed by the shop too** (office; reverses 2026-09-26's
  read-only POLY / C.BOX Issues for shop staff). Blank → POLY / C.BOX show
  the month's EMPTY sales, as before; a typed figure is never replaced.
  Rule 5 checks only that it is a number ≥ 0 and that Closing follows.
- **The stored copies follow the sales** (`refreshGunnyMonths`,
  `lib/gunnyRefresh.ts`): Daily Entry's save, a receipt saved or removed,
  the month-close and Gunny Save's following months, and an approved clear
  (`clearExecute.ts`, only a month that keeps a record and whose sales it
  moved) re-work Receipt / Total / Closing and re-carry every following
  month whose Opening is a carried copy — so CB → next month's OB holds.
  Keyed figures stay. Rule 5 judges a re-carried Opening against last
  month's Closing as the same write leaves it.
- **Stored copies saved before this** lag (live 2026-09-30: 18 September
  records, e.g. CRS 11 Closing 870 stored vs 1291). Each shop's next save
  in the month refreshes it; `node tools/refresh-gunny.mjs --month=M
  --year=Y [--crs=…] [--write]` catches all up (dry run; meGunnyStore
  only, backed up, stock guard, under version).
- Golden dump: Gunny and Receipt statements byte-identical for all shops.

### A "from Daily" row's bag counts are saved as typed

Office, 2026-09-30 (recording: CRS 1 September, BRA Rice — Opening bags
29 → 30, Sales bags 59 → 60, Save, the tick — and back on Monthly Entry it
read 29 / 59 again). `npm run verify:daily-bags`.
- **Two faults, both fixed.** The month-close skipped a daily row entirely
  (`if (r.derived) continue`), so its bag boxes — keyable on every row — were
  never sent; the tick was true of everything else. And the roll-up
  re-derived every daily row's bag counts as kgs ÷ pack size on each
  republish, so even a stored figure would have been replaced by the next
  Daily Entry save.
- **Where they live**: `meManualStore[key].dailyBags[sec][id]` —
  `g_open` / `g_receipt` / `g_sales`, only a count that DIFFERS from kgs ÷
  pack size (a typed 0 included). Typed back to that figure → dropped, and
  the box follows its kgs again. Not inside the a / b rows: a row there is a
  hand-keyed month, and a bags-only row would become one the day the sheets
  were cleared.
- `rebuildMonthlyFromDaily` lays them over the daily row (`withDailyBags`:
  Total = Opening + Receipt, Closing = Total − Sales − C.S, the grid's own
  arithmetic), so every republish — Daily Entry save, receipt, rechain,
  Gunny Save, the statement render — keeps them; a count NOT typed still
  follows its kgs. The kgs are untouched and stay the day sheets'.
- They reach what already reads the published bags: the Gunny Receipt
  (`salesBags`: a stored g_sales that differs from the division wins), the
  statements, the PV.
- `syncGunnyToSales` now spreads the month record before rewriting a / b,
  so Gunny Save cannot drop them. The activity log names each change
  ("BRA Rice · Gunny Opening (bags): from kgs → 30").
- Permissions unchanged: the boxes were already keyable for whoever sees
  them; nothing in stockGuard judges bag counts. Clear: a month clear
  removes the record with the month, as before.
- Browser run on a copy of live data, each write judged by the real guard:
  the recording (OB 13, Sales 60 → 13 + 30 = 43, CB −17), then another page,
  a refresh, CRS and month changes; Opening only / Receipt only / Sales only;
  typed back to kgs ÷ 50; CRS 19 with all three — each saved and read back.

### A commodity's bags on the statements are Monthly Sales' bags

Office, 2026-09-30 (`src/legacy/45-bag-counts.js`, `npm run
verify:bag-counts`). CRS 19 September: Palm Oil's Opening bags saved as 53
on Monthly Sales — stored, published, shown again after navigating away —
while CRS Page 2 printed 52. Nothing was cached (every Preview / Print / PDF
re-renders from the database); **Page 2's `bags()` never read a saved
count** — it divided the kgs every time (525 ÷ 10), so Wheat 40 / Toor Dal
11 / AAY Sugar 1 printed 39 / 10 / 0 too. Free Com, Cost Com and B6 read
the stored Opening / Receipt / Sales but took Total and Closing from stored
copies (kgs Total ÷ pack), not the grid's arithmetic.
- `stmtBagCounts(d, id)` is Monthly Entry's `rowFor()`, bag for bag:
  Opening / Receipt / Sales = a count typed on a FROM-DAILY row (dailyBags, a
  typed 0 included), else a stored count above 0 that differs from kgs ÷
  pack, else kgs ÷ pack; **Total = Opening + Receipt, Closing = Total −
  Sales − C.S**. CRS Page 2 (rows and RICE TOTAL), Free Com, Cost Com and B6
  all print from it; a 0 prints "0" where the figure has kgs, blank where it
  has none (Page 2's old convention). The kgs, amounts and every other cell
  are untouched.
- Golden dump: all four sheets byte-identical for every shop. Live,
  September 2026: 69 of 120 sheets change, every changed cell a bag count
  (452 cells) — the saved counts, and Totals / Closings that now add up the
  grid's way (e.g. CRS 19 B.RICE CB 71 → 72, CRS 5 SUGAR TOT 34 → 33).
- Browser run on a copy of live data, each write judged by the real guard,
  the statement built as loadStatementEngine builds it: CRS 19 Palm Oil
  53 → 54 → 52 → 53 (each saved, page left and reopened, Preview and PDF
  equal to the screen), Wheat Sales bags, CRS 1 BRA Opening bags.
- **CRS 29's own Page 2 and B6 too** (office, 2026-10-01). The camp's
  sheets are a separate family (`26-crs29.js`, `c29StockGrid` — one grid
  for both) and still divided the kgs by each row's pack size: CRS 29
  September printed RRA 2 / 25 / 27 / 25 / 1 while its Monthly Sales showed
  the saved 3 / 25 / 28 / 26 / 2, and every Closing as the kgs Closing ÷
  pack (B.RICE 0 where 0 + 471 − 470 = 1). It now reads `stmtBagCounts` too
  (CYL, not stocked, stays kgs ÷ pack); RICE TOTAL adds the rows' counts.
  Live: only bag cells change (15 on each sheet); golden dump identical.
- **An open preview follows the data** (statements/page.tsx): when a store a
  statement reads changes — this tab's save or another person's by live
  sync — the section on screen is built again from the server. Print and
  PDF were already built fresh on every click.
- Localhost, live copy, the Statements page itself (its render / pdf /
  access routes answered by the engine built as loadStatementEngine builds
  it, from the same in-memory database): CRS 1 BRA Opening → 53, CRS 19
  Wheat Receipt +2, CRS 29 RRA Sales +1, CRS 14 (keyed by month) Sugar
  Opening +1 — each saved, the page left and reopened, then Monthly =
  Preview = PDF on all five bag columns; a preview left open went 53 → 54
  when another tab saved.

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

## What a SCREEN prints

The statements print from a window of their own (`printDoc.ts`, below), which
holds none of the app. A screen that prints ITSELF is the other case, and
until 2026-09-27 **there was no `@media print` rule in the app at all**:
`#sidebar` is `height:100vh` and stood down the left of every sheet, `#main`
hides its overflow and `#content` scrolls, so the paper got a squeezed column
of statement cut off at whatever happened to be on screen.

`src/app/print.css` (loaded by the root layout) takes the furniture away and
unclips the page; `src/lib/printArea.ts` marks one area as the thing being
printed. `npm run verify:print-layout`.

- **Nothing here changes how a statement looks** — its own styles still decide
  that. The rules hide `#sidebar`, `#topbar` and `.no-print`, set
  `overflow:visible` and `height:auto` on the shell, and make anything still
  `fixed` or `sticky` static.
- **`position: absolute`, never `fixed`.** A fixed element prints its first
  page and nothing after it — which is how a multi-page PV lost everything
  past page one. The DSS viewer got this right from the start
  (17-dss-export.js) and is untouched.
- **A wide-screen table is brought back to the paper's width** inside a print
  area (`min-width:0;max-width:100%`): a `min-width:1400px` table in a
  horizontal scroller keeps that width on paper and drops its right-hand
  columns off the sheet, and because an absolutely placed area does not
  scroll, nothing shows that they are gone.
- Two screens print themselves: **Monthly Entry's statement preview** and the
  **PV on Reports**. Both now call `printArea()` and mark their document
  `.print-area`; the PV carries its own `@page{size:legal landscape}` — see
  "The PV sheet: Annexure-I on Legal paper", below.
- The check also refuses a NEW screen that calls `window.print()` without
  either printing an area or opening a document of its own — which is how
  this fault would come back.

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
- **…but a named page cannot reach the FIRST page** (office, 2026-09-27).
  Chrome takes page one's size from the document's own `@page` and changes
  size only at a break, so the first statement printed on whatever the
  default was — **A3 landscape**, from the Daily Sales builder — in an
  otherwise A4 job, and every printer and Save-as-PDF then shrank the whole
  document to fit that one page. That is why the statements came out small
  and squeezed. Two rules fix it, both in `pageCss`:
  - **an A4 default** (`@page{size:A4 landscape}`), which also overrides the
    builder's A3. **Landscape**, because the default page is the box the
    browser fits the document to: against a 210 mm portrait default every
    landscape sheet is wider than its page and the whole job shrinks — the
    Receipt's smallest type went 5.2 pt → 3.6 pt when it said portrait;
  - **`@page :first`** carrying the first statement's own paper and margins.
  Naming the page on the `<main>` wrapper does not work, and neither does
  taking its box away with `display:contents` — both were tried against real
  PDFs. `npm run verify:print-pdf` prints the document with headless Chrome
  and reads the page sizes back out; it fails on all three counts against the
  old rules.
- **Print is ONE server-made PDF, printed in ONE session** (office,
  2026-09-27). Why, in the order it was learnt:
  - An HTML print reaches a physical printer with ONE Layout for the whole
    job. The statements mix landscape and portrait sheets, so on the
    office's EPSON (Layout = Portrait) every landscape sheet was shrunk
    sideways onto portrait paper — small, pushed left, half the page empty.
    Save-as-PDF hid it, because a PDF holds a size per page.
  - Splitting the print into a landscape job and a portrait job fixed the
    paper but made two print sessions, which the office would not accept;
    and a second `window.open` from `afterprint` is not a click, so Chrome
    blocked it ("The print window was blocked by the browser").
  - So **`/api/statements/pdf` renders the print document (printDoc.ts,
    unchanged) to ONE PDF in headless Chrome** (`lib/statements/pdfServer.ts`,
    `preferCSSPageSize`, so each sheet keeps its own A4 orientation), and the
    page prints that file from a hidden same-origin `<iframe>` loaded from a
    `blob:` URL (`printPdfBlob`, `lib/statements/printFrame.ts`). One dialog,
    every selected sheet in order, and the PDF viewer turns each page to the
    paper instead of shrinking it. No pop-up; nothing of the app can reach
    the paper, because the PDF is the whole document.
  - The **📄 PDF** button downloads that same file; **Print This** in the
    preview uses the same route for one statement.
  - If a browser refuses to print a PDF from a frame, the office is offered
    "Open PDF" — the only `window.open` left, and it runs on that click.
  - `verify:print-pdf` §4 drives the production `htmlToPdf` over mixed
    (P→L→P→L), landscape-only and portrait-only selections and reads the
    pages back: one file, every page A4, each in its own orientation, in the
    order ticked. `verify:print-layout` §6 holds the architecture.
  - **Deploy:** Chrome on Vercel is `@sparticuz/chromium` (~60 MB), kept
    out of the bundle with `serverExternalPackages` and shipped with
    `outputFileTracingIncludes` (next.config.mjs). The route sets
    `maxDuration = 60`; a cold start unpacks Chrome first (~5 s locally for
    a four-statement PDF). Locally it uses the installed Chrome (or
    `CHROME_PATH`). **Not yet proven on Vercel** — the first deploy is the
    test; check the function's size, memory (Chrome wants ~1 GB+) and time.
  - **Not provable from here:** that the office's printer driver turns
    landscape PDF pages to the paper. Chrome's Windows PDF printing
    auto-rotates; the office's first print is the confirmation.
- **Exactly what is ticked now** (`lib/statements/selection.ts`,
  `selectedInOrder`): the offered sections in their listed order, filtered by
  the ticks — never click order, never an id the shop/month no longer offers.
  The server then builds exactly those, de-duplicated, in that order. The
  four `copies: 2` statements (CRS Page 2, Gunny, Remittance, CRS Police)
  still print twice — the office confirmed the two-copy rule stays
  (2026-09-27). `verify:print-layout` §7; the whole flow (single, three,
  select-all, 5−2, stale tick, repeat print, zero `window.open`) was driven in
  a real browser against live documents.
- **Orientation is measured, not listed**: `columnCount` reads the parsed
  grid, so a builder that gains a column keeps printing right. Over 9 columns
  goes landscape (Receipt is 37, Daily Sale 22, CRS Page 1 only 2).
  `ALWAYS_LANDSCAPE` is the exception the office asked for: **CRS Police,
  Card Details and RBI** are filed on their side whatever their width (they
  are 9, 8 and 8 columns, just under the threshold). It applies to the
  preview, the printed sheet and the Excel page setup alike.
  **CRS 29's Indent** joined the list on 2026-10-01 (8 columns; office asked
  for A4 landscape): one page, and its table across the page — the camp's
  sheets cap their width at 900px (`.c29-wrap`, ~238 mm), so `pageCss` lifts
  that cap for the Indent sheet alone (`.stmt-sheet[data-section="indent"]`;
  the builder's markup is untouched). Printed with headless Chrome from live
  data: 297 × 210 mm, 1 page, text 9.5–287.6 mm across, signatures on it; in
  a select-all PDF of all 12 CRS 29 sheets only the Indent's page turned.
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
- **Remittance: CEREAL ACCOUNT is narrower, and the page has a right margin**
  (office, 2026-09-27). Measured on the printed PDF, the table ran from
  11.6 mm to **208.5 mm on 210 mm paper** — printers cut off TOTAL AMOUNT and
  the signature. Two causes, both fixed:
  - the workbook's right margin is 0 (Excel's "printer minimum", but as a CSS
    page margin it is the paper's edge) → now 5 mm, the same as the left
    (`pageSetup.ts`);
  - CEREAL ACCOUNT, empty on most shops' sheets, was 16% of the width → 11%.
    The table is 95% wide and centred (`buildRemittance`), with every other
    column's width unchanged as a share of the page, so TOTAL AMOUNT moved
    ~9.6 mm inward. The fill zoom is measured off the statement's wrapper, not
    the table, so the narrower table is not stretched back.
  After: borders ~10 mm from each edge, type unchanged (7.5–9.7 pt). Every
  shop's Remittance was rendered before and after: only the table width and
  the `<col>` widths differ. **An intended change to a statutory format, so
  the `*_remittance.html` goldens no longer match** (like receipt and gunny).
- **Free Com and Cost Com print between equal margins** (office,
  2026-09-27). Their workbook right margin is 0 too, so both ran to 297.1 mm
  of 297 — CLOSING BALANCE, CRS NO and AREA SUPERVISOR cut off — and Cost Com
  sat 18 mm in from the left. Changing their `margins` would also move the
  Excel page setup, so the printed page / PDF takes `paper` instead
  (`paperMargins()`, read by `printDoc.ts` and `printableBoxPx`; the Excel
  export keeps the office's `margins`):
  - Cost Com: 9 + 9 mm, the same 18 mm in all — the table is the same size
    and moved exactly 9.0 mm left (CRS NO 283.5 → 274.5 mm);
  - Free Com had only 3.4 mm of margin in all: 5 + 5 mm makes it 6.6 mm (2.2%)
    narrower, column shares unchanged.
  Type unchanged (6.0–9.7 pt), one page; no cell overflows at the new widths
  in any of the 30 shops. The builders are untouched, so no golden changes.
  **B6** the same day, like Cost Com: its 17.1 mm split 8.55 + 8.55, same
  size, moved 8.7 mm left (text 21.9 → 297.1 mm became 13.1 → 288.4 mm).
  **Still at the paper edge, not yet asked for:** Daily Sale and Gunny
  (right margin 0, measured 297.1 mm of 297); Receipt has 3.9 mm.
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

**An Advance receipt never reaches COLL's closing balance** (office,
2026-09-25). `npm run verify:coll-advance`.

- A receipt typed **Advance** on the Receipt Entry page is stock drawn ahead
  for next month. The Collector's sheet states this month's own movement, so
  the advance is out of RECEIVED FROM GODOWN, TOTAL **and** the CLOSING
  BALANCE, and prints instead in the ADVANCE FOR THE MONTH OF … table under
  the report, commodity by commodity, from the receipts actually keyed.
- **It was reaching the closing balance because two functions did not exist.**
  `collRow` has always asked for `rcpHasRowsInMonth` / `rcpRegularQty`, but
  they lived in `33-receipt-type.js`, which went in the port — nothing defined
  them in the generated module, the `typeof … === 'function'` guard was false
  on every render, and COLL fell back to the monthly receipt figure, which
  counts both types. They now live in `24-coll.js`, its only reader. A row
  with no `type` is a Regular receipt: the field was added later.
- The stored monthly close counts an Advance receipt like any other (the grain
  IS in the shop — `receiptRollup.ts` says so), so COLL takes the advance back
  off that figure and changes nothing else in it; C.S and the rest stand.
- **Only COLL.** CRS PAGE2, RBI, the DSS, Daily and Monthly Entry all still
  count an Advance receipt as stock received. Checked by rendering every
  section of every shop before and after: the only file that changed is COLL.
- The office's second "PHH FRK" row (its sheet, row 42) **is PHH BRA** —
  confirmed 2026-09-25. A commodity taken in advance that the office's table
  has no row for (AAY, the police lines) gets a row added under them: it has
  been kept out of the closing balance, so leaving it off would lose it.
- Live, September 2026: one advance receipt exists (CRS 7, 24-09 — BRA 5000,
  PHH BRA 1950, WHEAT 500, T.DHALL 500, P.OIL 400, SUGAR 700, AAY 250, AAY
  SUGAR 13). Every other shop's COLL changes only in that row label.
- The **Advance LOAD** (`meAdvanceStore`, keyed on Monthly Entry) is a
  different, older lever and is unchanged: it still only nets off RECEIVED and
  says so in the note under the table. No shop has ever keyed one.

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

## Dashboard → Card Details & Allotment

A Quick Action (🪪, office 2026-09-28; `npm run verify:card-jump`) that
opens Monthly Entry scrolled to the EXISTING Card Details & Allotment
section (`CardAllot`, wrapped in `#card-details`) — there is no second Card
Details page, and nothing in CardAllot changed. `monthly-entry/jump.ts`:
the Dashboard leaves a one-time sessionStorage marker (the router may put
`#card-details` in the address only after the page mounts), the address
carries it for a reload; Monthly Entry scrolls once data is `ready` and the
section exists, settles once more after 450 ms (the tables above grow as
they render), focuses it, flashes it, then clears both so a change of month
does not jump again. A shop user's shop is preset, so it goes straight
there; an administrator has none, so the shop box is focused with "Choose a
CRS shop for Card Details & Allotment" and choosing one opens the section.
The Quick Actions row is five across (a phone stacks them).

## Card Details & Allotment boxes: typing, the wheel, Enter

`monthly-entry/NumInput.tsx`, used by every Card Count, Allotment and
Advance Load box (office, 2026-09-28; `npm run verify:card-inputs`).
- **The recording**: Sugar Card focused, pointer beside it, page scrolled —
  and the count stepped 0 ↔ 1 by itself. Chrome changes a FOCUSED number
  input on the mouse wheel; the same steps against the old box gave
  0 → 1 → 0 → 1. The wheel now scrolls the page (#content) and never steps
  the figure.
- While a box has focus it shows exactly what was typed (`draft`) — the old
  box showed the stored value reformatted on every key (`parseInt`), so the
  caret jumped and a key typed before a 0 gave 10. Every change still goes
  straight to setCount / setAllot / setAdvance (unchanged), so Total Card
  follows at once; on leaving, the box shows the stored value.
- Focusing selects the figure, so typing replaces the 0. Enter moves DOWN
  the same column (`data-num-col`). ↑ / ↓ and the spinner are the browser's
  own, within the existing min and step. Phones get a number pad and Next.

## Card Details keyed from a shop's POS screen

`node tools/set-card-details.mjs --crs=N --month=M --year=Y --rice= --lof_rice=
--sugar= --lof_sugar= --aay= --lof_aay= --oap= --police= --n_card=` (dry run),
then `--write`: exactly what **Save Card Details** does — `meCardStore[key]`
plus the month's saved mark in `meCardConfirmed` — for figures the office
reads off a shop's POS ("அட்டை விவரங்கள்"). All nine cards must be given (a
card the POS does not list is 0, said out loud), so TOTAL CARD is the sum and
nothing ever writes a total. Refuses a month that already has counts unless
`--replace`; touches no other key; backs both rows up to `backups/`; writes
under version; a re-run with the same figures writes nothing.
- POS → field: அரிசி அட்டை → `rice`, LOF அரிசி அட்டை → `lof_rice`,
  சர்க்கரை அட்டை → `sugar`, AAY அட்டை → `aay`, காவலர் அட்டை → `police`,
  பண்டகமில்லா அட்டை (no-commodity card) → `n_card`.
- **CRS 30, September 2026** (office, 2026-09-29): 728 / 4 / 13 / 0 / 27 / 0 /
  0 / 4 / 1 → TOTAL 777 (backup `backups/card-details-crs30-9-2026-…`). Read
  back through the server statement engine: CRS Page 1's PDF prints each card
  and TOTAL CARD DETAILS 777; Monthly Entry shows them "✓ saved".
- **CRS 20, September 2026** (office, 2026-09-30, POS photos): RICE 1048 /
  LOF RICE 254 / SUGAR 19 / LOF SUGAR 7 / AAY 38 / LOF AAY 5 / OAP 0 /
  POLICE 1 / "N" CARD (பண்டகமில்லா அட்டை) 1 → TOTAL 1373 (backup
  `backups/card-details-crs20-9-2026-…`).
- **CRS 26, September 2026** (office, 2026-09-30, POS photos): RICE 1195 /
  LOF RICE 12 / SUGAR 20 / LOF SUGAR 1 / AAY 14 / LOF AAY 0 / OAP 1 / POLICE 0
  / "N" CARD (பண்டகமில்லா அட்டை) 4 → TOTAL 1247, as the POS says (backup
  `backups/card-details-crs26-9-2026-…`). Page 1 preview and PDF read back.
- **CRS 27, September 2026** (office, 2026-09-30, POS photos): RICE 1123 /
  LOF RICE 19 / SUGAR 177 / LOF SUGAR 9 / AAY 12 / LOF AAY 0 / OAP 0 /
  POLICE 4 / "N" CARD (பண்டகமில்லா அட்டை) 25 → TOTAL 1369, as the POS's
  மொத்த அட்டைகள் says (LOF AAY and OAP are not on the POS: 0). Page 1
  preview and PDF read back; the screen holds them after reload, shop and
  month changes (backup `backups/card-details-crs27-9-2026-…`).
- **CRS 10, September 2026** (office, 2026-09-30, POS photos; the month
  clear of the same evening had removed any earlier record): RICE 805 / LOF
  RICE 6 / SUGAR 17 / LOF SUGAR 0 / AAY 57 / LOF AAY 0 / OAP 1 / POLICE 10 /
  "N" CARD 2 → TOTAL 898, as the POS says. Page 1 read back (backup
  `backups/card-details-crs10-9-2026-…`).
- **CRS 14, September 2026** (office, 2026-09-30, POS photos): RICE 1190 /
  LOF RICE 29 / SUGAR 165 / LOF SUGAR 4 / AAY 12 / LOF AAY 0 / OAP 0 /
  POLICE 0 / "N" CARD (பண்டகமில்லா அட்டை) 34 → TOTAL 1434, as the POS says
  (Police, LOF AAY and OAP are not on it: 0). Page 1 preview and PDF read
  back (backup `backups/card-details-crs14-9-2026-…`).
- **CRS 1, September 2026** (office, 2026-09-30, from a Page 1 sheet headed
  "MONTH : AUG'2026" — saved under September on the office's answer): RICE
  544 / LOF RICE 4 / SUGAR 54 / LOF SUGAR 1 / AAY 19 / LOF AAY 0 / OAP 0 /
  POLICE 1 / "N" CARD 12 → TOTAL 635, as the sheet says (backup
  `backups/card-details-crs1-9-2026-…`).

## A day sheet keyed from a paper statement

`node tools/save-day-sheet.mjs --crs=N --date=YYYY-MM-DD --sales=ID:qty,…
[--remit=<amount>] [--remit-date=…]` (dry run), then `--write`: Daily
Entry's own save, run with the app's own functions as an administrator on
the office's instruction. Only SALES and the deposit come from the paper;
Opening (the chain's carry), Receipt (the register), adjustments, Total,
Closing and Amount (master rate) are worked out exactly as `derive` does.
Then, as the save does: projection / monthly register row dropped, month
republished, chain rebuilt from the date. The server's stock guard and CRS
29 rice guard are run on the result before anything is sent; only that
shop's keys may change; a date that already has a sheet is refused (it adds
a day, never replaces one); stores backed up and written under version; the
activity log gets `diffStateWrite`'s rows and the started-record is
reconciled, as after any landed save.
- **CRS 19, 29-09-2026** (office, 2026-09-29, from the shop's paper
  statement): BRA 176, PHH BRA 50, AAY 35, SUGAR 18.5, AAY SUGAR 1.5,
  T.DHALL 13, P.OIL 13; one deposit ₹1,200.00 dated 29-09 (the paper's
  "1200/2" is ₹1,200, not ₹600 — the office's reading). Sales amount
  ₹1,197.75. Republishing the month with the fixed roll-up also corrected
  CRS 19 September's stored PHH BRA and AAY (see "A month opens where its
  FIRST day sheet opens"). Backup `backups/day-sheet-19_2026-09-29-…`.

**A whole month from a POS stock summary, on its last day** (same tool,
office 2026-09-29). A shop keyed by DAY (its Initial Opening is a day sheet)
cannot take the month on Monthly Entry, so the month goes onto ONE day
sheet: `--receipt=ID:qty,… --receipt-no=…` (one Receipt Register receipt
dated the sheet's date — the register stays the only source of receipts),
`--shortage=ID:qty,…` (that date's inspection; Section A only),
`--gunny-receipt` (RETIRED 2026-09-30 and refused — the Gunny Receipt is
Monthly Sales' bag counts, never typed; the tool now refreshes the stored
Gunny copies from the sales as Daily Entry's save does), `--correct-open=DATE:ID:v`
(an administrator's Opening correction on an earlier sheet; the chain is
rebuilt from it) and `--expect=ID:closing,…` (nothing is written unless
every Closing equals the paper's).
- **CRS 5, September 2026** (POS "பொருட்கள் இருப்பு நிலவரச் சுருக்கம்"
  01-09 → 29-09): one sheet on 29-09-2026 — Receipt `POS/5/09/2026`
  (14 commodities), Sales, shortage SUGAR 9 and PALM 4 — all 18 closings
  equal the POS (BRA 2173, SUGAR 680.624, PALM 220…). Gunny 50 KG SS
  89 + 236 = 325 and POLY 0 + 23 = 23 from the POS sack column (C.BOX kept
  at the system's 61 from Palm Oil sales; the POS shows NA) — **superseded
  2026-09-30**: the office made Monthly Sales the only source, so these two
  typed Receipts are no longer read and the month shows 227 / 28. Police BRA's
  Opening on 01-09 corrected 12 → 0 (the POS's; office decision). DSS pages:
  01-09 and 29-09 only. Monthly Remittance untouched (the 29th's ₹848 stays
  there, so the 29-09 DSS C A/C line reads 0.00). Backup
  `backups/day-sheet-5_2026-09-29-…`.
- **CRS 26, September 2026** (office, 2026-09-30; POS "பொருட்கள் இருப்பு
  நிலவரச் சுருக்கம்" 01-09 → 30-09): Receipt and Sales only, on one sheet
  dated 30-09 — Receipt `POS/26/09/2026` (11 commodities) and the month's
  sales; Opening carried from the 01-09 Initial Opening, which already equals
  the POS. All 14 closings equal the POS (BRA 333, RRA 294, PHH BRA 773,
  PHH FRK 1443.126, AAY 3, AAY FRK 0.010, NPHH FRK 2384.014, NPHH RRA 0.026,
  OAP 0, T.DHALL 189.010, P.OIL 190, SUGAR 422.502, AAY SUGAR 1.500, WHEAT
  508.990). Sugar / AAY Sugar / Wheat were on the POS but not in the typed
  list — included on the office's answer. The police "P" rows, PHH பச்சை
  அரிசி and the Pongal lines are 0 or have no field. No remittance added
  (September EXCESS reads −88810.25 until deposits are keyed). Backup
  `backups/day-sheet-26_2026-09-30-…`.

**A shop's Initial Opening, from an office sheet** (same tool, office
2026-09-30): `--open=ID:qty,…` types the Openings on the shop's CHAIN START
(refused if any earlier day sheet exists), saved fixed (`openFixed`) as Daily
Entry saves an Initial Opening, every other commodity at 0; `--gunny-open=
ss50:n,poly:n,cbox:n` sets the month's Gunny Opening as an administrator
types it (`openingAuto: false`). With no `--sales` the sheet sells nothing.
- **CRS 27, from 01-09-2026** (office, 2026-09-30; CRS 27 held no stock data
  and was not started): BRA 3908, PHH BRA 850, PHH FRK 1500.062, NPHH FRK
  5000.062, AAY 105, AAY FRK 154.010, RRA 1000, NPHH RRA 0.030, SUGAR
  1348.002, AAY SUGAR 9, WHEAT 1525, T.DHALL 677.020, P.OIL 679, OOTY 304;
  police BRA 26, SUGAR 2, WHEAT 2, T.DHALL 4, P.OIL 1; Gunny 50 KG SS 1496
  (POLY / C.BOX were blank on the sheet and are left blank). Started-record
  01-09-2026. Read back on the day sheet, the published month, Gunny, and
  CRS Page 2 / CRS Police PDFs. Backup `backups/day-sheet-27_2026-09-01-…`.
- **CRS 10, from 01-09-2026, re-entered** (office, 2026-09-30): an
  administrator had cleared CRS 10's whole September that evening (request
  #16 — every day sheet, the 01-09 Initial Opening included; receipt
  R/2026/046 of 25-09 stays), leaving it not started. Re-keyed BY DAY, as
  before (office's answer): `--open` on 01-09, no sales — BRA 4792, PHH BRA
  2056.020, PHH FRK 1195.982, AAY 1326, OAP 3 (the sheet's "OAP FRK"), APS 10
  ("ANP FRK"), SUGAR 779, AAY SUGAR 49.5, WHEAT 1825.030, T.DHALL 506, P.OIL
  505, OOTY 340; police BRA 36.5, SUGAR 2, WHEAT 2, T.DHALL 4, P.OIL 1; Gunny
  50 KG SS 1751, POLY 0, C.BOX 0. Started-record 01-09-2026. Backup
  `backups/day-sheet-10_2026-09-01-…`.
- **CRS 17, September 2026 movement** (office, 2026-10-01, POS summary 01-09 →
  30-09): RECEIPT AND SALES ONLY (office's instruction) on one sheet dated
  30-09 — Receipt `POS/17/09/2026` (15 commodities) and the month's Sales.
  The POS's Openings, its BRA −23 adjustment and its Closings were NOT
  entered: CRS 17 keeps its own 01-09 Initial Opening, so Closings differ
  from the POS by exactly the Opening differences (BRA 2592.698 vs the
  POS's 569.698 = 2000 + the 23 not entered; PHH BRA +2500, NPHH FRK
  +2126, SUGAR +600, WHEAT +400, T.DHALL +400, AAY +200, AAY SUGAR +8;
  police BRA +3.454 = the POS's separate P FRK BR line). RRA, PHH FRK, AAY
  FRK, P.OIL and the other police lines equal the POS. No remittance.
  Backup `backups/day-sheet-17_2026-09-30-…`.
- **CRS 10, September 2026 movement** (office, 2026-09-30, POS summary 01-09
  → 30-09): one sheet dated 30-09 with the month's Sales; RRA 600 (on no
  receipt) added as `POS/10/09/2026` dated 30-09; the register's
  R/2026/046 police lines corrected 18 / 18 / 36 → 16 / 16 / 32 (Sugar,
  Wheat, T.DHALL P — `correct-receipt.mjs --set`, office's answer: the POS);
  PHH FRK's −20 as a SHORTAGE of 20 on 30-09; the POS's OAP FRK ("BR OAP",
  2 / 2) added into OAP (sales 5) and P FRK BR (143 / 112.5) into Police BRA
  (sales 142.5, closing 37 = the POS's 6.5 + 30.5). All 20 closings equal the
  POS (BRA 0, RRA 50, NPHH FRK 1438, PHH BRA 959.02, PHH FRK 0.982, AAY FRK
  267, SUGAR 214.91, WHEAT 1486.03, T.DHALL 71, P.OIL 71, …). No remittance.
  DSS pages: 01-09, the receipt-only 25-09, 30-09. Backup
  `backups/day-sheet-10_2026-09-30-…`.
- **CRS 27, September 2026 movement** (office, 2026-09-30, POS summary 01-09
  → 30-09): one sheet dated 30-09 — Receipt `POS/27/09/2026` (14
  commodities), the month's Sales, and NPHH FRK's −19 in the POS's
  இருப்பு சரிசெய்தல் column as a SHORTAGE of 19 on 30-09 (the app stores a
  shortage as a positive amount taken off, shown red as −19; a literal −19
  would have added 19). All 19 closings equal the POS (NPHH FRK 2633.062,
  PHH FRK 501.062, AAY FRK 74.010, SUGAR 705.502, WHEAT 1483, T.DHALL
  216.020, P.OIL 217, …). Office's answers: R.R.A takes the screenshot's
  500 / 1500 (the typed list said 0 / 0); the POS's "P FRK BR" (police FRK
  rice, 54 / 36 / 18 — the app has no such line) is ADDED INTO Police B.R.A,
  which therefore reads 26 + 54 − 36 = 44 where the POS shows B.R.A 26 and
  P FRK BR 18 apart. Backup `backups/day-sheet-27_2026-09-30-…`.

## Receipts keyed from a shop's POS challans

`node tools/add-receipts.mjs --data=<file.json>` (dry run), then `--write`:
the Receipt page's Save for one shop — Receipt Register rows
(`{ crsId, receipts: [{ date, receiptNo, type: regular|advance, items }] }`),
then what `republishMonth` does: the day sheet takes the receipt, the month
republishes, the chain rebuilds from the date, Gunny follows. Refuses a
commodity not on the shop's Receipt list, a quantity ≤ 0, a receipt number
the register already holds, any other shop's keys, or the stock guard;
backs up to `backups/`, writes under version, logs activity. It adds; it
never replaces.
- **CRS 26, advance for October 2026** (office, 2026-09-30, POS "பொருட்கள்
  வருகை வரலாறு", received 28-09-2026, vehicle TN38H3303): three ADVANCE
  receipts dated 28-09 — S184607324 BRA 2000, T.DHALL 550, SUGAR 500, WHEAT
  400, AAY SUGAR 12; S184607325 NPHH FRK 2000; S184607326 AAY FRK 250, PHH
  FRK 2000. S184607324's BRA 2000 appears in two overlapping screenshots of
  that one challan and is entered once (office's answer). Dated 28-09 on the
  office's choice, so — as Advance receipts always are — September counts
  them as stock received: CRS 26 September's Receipts and Closings rose by
  exactly those quantities (e.g. NPHH FRK 2384.014 → 4384.014, BRA 333 →
  2333) and no longer equal the POS stock summary, which leaves them out.
  CRS 26 is not a COLL shop, so there is no ADVANCE FOR OCT'2026 table.
  Backup `backups/receipts-crs26-…`.
- **CRS 27, advance for October 2026** (office, 2026-09-30, same POS screen,
  received 28-09-2026, TN38H3303): two ADVANCE receipts dated 28-09 —
  S184607327 SUGAR 500, NPHH FRK 5000, WHEAT 100, AAY SUGAR 9, T.DHALL 550;
  S184607328 AAY FRK 150, PHH FRK 1500. Wheat 100 was in two overlapping
  screenshots of S184607327 and is entered once (office's answer). Dated
  28-09 as for CRS 26, so September's Receipts / Closings rose by those
  quantities (NPHH FRK 2633.062 → 7633.062, PHH FRK 501.062 → 2001.062, …).
  CRS 27 is not a COLL shop. Backup `backups/receipts-crs27-…`.
- **CRS 14, advance for October 2026** (office, 2026-09-30, same POS screen,
  received 28-09-2026, TN60A6777): three ADVANCE receipts dated 28-09 —
  S184607300 BRA 2000, WHEAT 100, SUGAR 1000, T.DHALL 650, AAY SUGAR 9;
  S184607301 NPHH FRK 3000; S184607302 AAY FRK 250, PHH FRK 2000. Wheat 100
  was in two overlapping screenshots of S184607300 and is entered once
  (office's answer). CRS 14 is keyed by month and already closed: the
  receipt path updated its manual rows and the 30-09 projection as well, so
  September's Receipts / Closings rose by exactly those quantities (BRA
  0.330 → 2000.330, NPHH FRK 2953 → 5953, PHH FRK 587 → 2587, …) and no
  longer equal the POS summary. Not a COLL shop. Backup
  `backups/receipts-crs14-…`.
- **CRS 10, advance for October 2026** (office, 2026-09-30, POS challans
  dated 25-09-2026, TN46E1127): S180602898 NPHH FRK 2500, P.OIL 300, AAY
  SUGAR 30, SUGAR 500, WHEAT 100; S180602899 AAY FRK 950, PHH FRK 2000;
  S180602924 T.DHALL 400 — dated 25-09 as the challans say. AAY SUGAR 30 was
  in two overlapping screenshots of S180602898 and is entered once. The
  30-09 sheet re-carried them, so September's Closings rose by exactly those
  quantities (NPHH FRK 1438 → 3938, PHH FRK 0.982 → 2000.982, …) and no
  longer equal the POS summary. CRS 10 IS a COLL shop: COLL lists all
  eight under ADVANCE FOR THE MONTH OF OCT'2026 and keeps them out of its
  closing balance. Backup `backups/receipts-crs10-…`.

**Correcting a saved receipt line** — `node tools/correct-receipt.mjs --crs=N
--receipt-no=NO --move=FROM:TO,…` (dry run), then `--write`: moves a line's
quantity to the commodity it belongs to on ONE receipt (date, number, type
and every other line kept), then republishes as the Receipt page's save
does. Refuses a FROM the receipt lacks, a TO it already carries or that is
not on the shop's list, another shop's keys, or the stock guard.

## A month keyed BY MONTH, closed from a POS stock summary

`node tools/close-month.mjs --crs=N --month=M --year=Y --sales=ID:qty,…
[--shortage=ID:qty,…] [--expect=ID:closing,…]` (dry run), then `--write`:
Monthly Entry's month-close as an administrator, for a month with NO real
day sheets (refused otherwise — use save-day-sheet.mjs). Only Sales and the
month's Inspection shortages come from the paper; Opening is what the month
holds (never typed by the tool), Receipt the register's (refused if a Receipt
is not a register total — add it with add-receipts.mjs first), Total /
Closing / Amount worked out as rowFor does. Then what the save does:
meManualStore rows, the shortages as Monthly Inspection's record on the last
calendar day, ONE projected sheet on that day (`__projection`; one DSS page),
republish, rechain from the 1st, Gunny refresh. Backed up, under version,
activity logged, started-record reconciled; a re-run writes nothing
(timestamps are not figures).
- **CRS 14, September 2026** (office, 2026-09-30, POS summary 01-09 → 30-09):
  Receipt and Sales only. The register's S184606559 (10-09) held PHH BRA 2429
  and AAY 255 where the POS has them under PHH FRK and AAY FRK — moved
  (correct-receipt); Wheat 1217 was on no receipt — added as
  `POS/14/09/2026` dated 30-09. Sales: BRA 10892, NPHH FRK 2182, PHH BRA 2000,
  PHH FRK 2038, AAY 200, AAY FRK 255, T.DHALL 1129, P.OIL 1129, SUGAR 1941,
  AAY SUGAR 15.5, WHEAT 1627; shortages BRA 25, SUGAR 7 (the POS's red
  −25 / −7). The office's typed list had Sugar at 532 / 1129 (the Palm Oil
  row) and Wheat sales 1627.060 — the screenshots' figures were used on the
  office's answer (Sugar 1439 / 1941, Palm Oil 532 / 1129, Wheat 1627, which
  the POS's own OB + Receipt − Sales = CB confirms). **No Opening was
  entered (office's choice)**: CRS 14 had never been started, so every
  Closing is the POS's CB less its OB — BRA −7917, PHH BRA −2000, WHEAT
  −410, SUGAR −509, … — until the Opening is keyed (POS OB: BRA 7917.330,
  PHH BRA 2000, PHH FRK 196, AAY 200, T.DHALL 737.914, P.OIL 741, SUGAR
  1084.180, WHEAT 2400). CRS 14 is now "started" (30-09-2026), so that
  Opening is an administrator's correction on Monthly Entry. Backups
  `backups/correct-receipt-crs14-…`, `receipts-crs14-…`, `close-month-crs14-…`.
- **CRS 14's Opening, the same day** (office's sheet): `close-month.mjs
  --open=… --gunny-open=…` — what typing into Monthly Entry's Opening box
  does, Sales / shortages kept as stored. BRA 7917.330, PHH BRA 2000, PHH FRK
  196, NPHH FRK 0, AAY 200, NPHH FRK RRA 0.010, SUGAR 1084.180, AAY SUGAR 9,
  WHEAT 2400, T.DHALL 737.914, P.OIL 741, OOTY 250 (not on the POS pages
  sent; the sheet's figure); Gunny 50 KG SS 492, POLY 0, C.BOX 0. Every
  Closing now equals the POS (BRA 0.330, PHH FRK 587, NPHH FRK 2953, SUGAR
  575.180, WHEAT 1990, T.DHALL 142.914, P.OIL 144, the rest 0; OOTY 250).

## Allotment keyed from the FPS Allocation Report

`node tools/set-allotment.mjs --month=M --year=Y --data=<file.json>` (dry
run), then `--write`: what **Save Allotment** does, for several shops at
once — each named shop's `meAllotStore[key]` REPLACED by exactly the figures
given (0 included), plus its saved mark in `meAllotConfirmed`. The file is
`{ "<crs>": { "fps": "<FPS code>", "<commodityId>": qty, … } }`; the tool
refuses an FPS code that is not the shop's in `__crsMaster`, a commodity
Allotment does not list, any change to a key not named, and a key already
holding different figures unless `--replace`. Backs both rows up (with the
input) to `backups/`, writes under version; a re-run writes nothing.
- **Report column → field** (settled 2026-09-29 from the office's own CRS 7
  entry of the same report, and confirmed): Rice → `BRA`, AAY Rice → `AAY`,
  Sugar → `SUGAR`, Wheat → `WHEAT`, Toor Dal → `TOOR`, Palm Oil → `PALM`,
  OAP Rice → `OAP`, AAY Sugar → `AAY_SUGAR`, **PHH Rice → `PHH_BRA`**. The
  five **Police** columns have no Allotment field (Allotment lists Section A
  only; Page 1 prints no police allotment) and are left out — the office's
  decision, not an omission.
- **September 2026** (office, 2026-09-29, the East zone TSO report dated
  01-09-2026): CRS 5, 7, 8, 9, 10, 11, 12, 30 written; CRS 7's own rounded
  entry replaced by the report's exact figures; CRS 6, 19 and every other
  shop untouched. Every shop's Page 1 PDF read back line for line against
  the report. Backup `backups/allotment-9-2026-…`.
- **CRS 20, September 2026** (office, 2026-09-30, the POS's இருப்புப் பொருள்
  ஒதுக்கீடு screens; FPS code taken from `__crsMaster`, 22DA001PN — the
  photos do not show it): BRA 10130.886, AAY 1085, PHH_BRA 7047, WHEAT
  **1517.974**, SUGAR 1565.918, AAY_SUGAR 44.57, TOOR 1061.997, PALM 1062,
  OAP 0, APS 0 (the POS's "ANP Rice"). The POS lists Wheat twice; the
  office named the 6th row (1517.974) and the 2nd (1610.565) is ignored,
  never added. Police lines left out as before. Page 1 PDF read back.
- **CRS 26, September 2026** (office, 2026-09-30, the POS's இருப்புப் பொருள்
  ஒதுக்கீடு rows 6–17; FPS code 22DA007PN from `__crsMaster`): BRA 7946.875,
  AAY 454, PHH_BRA 7389, WHEAT 1490.122, SUGAR 1358.998, AAY_SUGAR 21.5,
  TOOR 917.98, PALM 918. Rows 11–15 were in two overlapping screenshots and
  are entered once; the four police rows are 0 and have no field; rows 1–5
  were not in the images and nothing was stored for them. Page 1 PDF read
  back; the screen holds them after reload, shop and month changes.
- **CRS 10, September 2026, re-entered** (office, 2026-09-30, the POS's
  rows 6–17; FPS code 22EA003PN): the evening's month clear had removed the
  TSO-report entry above. BRA 6623.026, AAY 1619, PHH_BRA 4637, WHEAT
  892.876, SUGAR 1028.5, AAY_SUGAR 64.5, TOOR 703.792, PALM 704.7; police
  rows have no field. Page 1 and the screen read back.
- **CRS 14, September 2026** (office, 2026-09-30, the POS's இருப்புப் பொருள்
  ஒதுக்கீடு rows 6–17; FPS code 22CA002PN from `__crsMaster`): BRA 13135.048,
  AAY 455, PHH_BRA 4429, WHEAT 1241.457, SUGAR 1939.32, AAY_SUGAR 15.5, TOOR
  1134.964, PALM 1132.2. The four police rows are 0 and have no field; rows
  1–5 not in the images. Page 1 preview and PDF read back.
- **CRS 27, September 2026** (office, 2026-09-30, the same POS screen, rows
  6–17; FPS code 22DA004PN from `__crsMaster`): BRA 11207.988, AAY 310,
  PHH_BRA 2809, WHEAT 1253.262, SUGAR 1584.498, AAY_SUGAR 15.5, TOOR
  952.171, PALM 951. The four police rows are NOT zero here (Police Rice 54,
  Sugar 6, Toor Dal 12, Palm Oil 3) but still have no Allotment field, so
  they are not stored — and never added into the Section A lines. Rows 1–5
  not in the images, nothing stored. Page 1 PDF and screen read back.
- **CRS 1, September 2026** (office, 2026-09-30, the same AUG'2026-headed
  Page 1 sheet as its Card Details; FPS code 22BA003PN from `__crsMaster`):
  BRA 5286, AAY 665, SUGAR 783, AAY_SUGAR 24, WHEAT 692, TOOR 547, PALM 547,
  PHH_BRA 2981. The sheet's "5.PHH BRA&FRK : 2981" is one figure: stored as
  PHH_BRA only, PHH_FRK not stored (office's answer), so Page 1 prints
  "2981 & 0". Page 1 PDF and screen read back.

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

## CRS Page 2's Remittance Amount is the deposits

Office, 2026-09-30 (`npm run verify:remit-total`). `buildCrsPage2` added up
the Monthly Remittance table's hand-keyed rows only and, when they came to
nothing, printed the sheet's own TOTAL as "Remittance Amount". A shop keyed
by day keeps its deposits on the day sheets, so CRS 8, September 2026,
printed 55061.30 (= Sales 54803.00 + C.Box 100.80 + P.Gunny 157.50) while its
Remittance sheet totals 55095.
- `stmtRemitTotal(d)` (`src/legacy/44-remit-total.js`) is the Remittance
  sheet's own TOTAL, worked out the way `buildRemittance` works it: per sales
  date the hand-keyed row, else the day sheet's deposits (`remitByDay`,
  every deposit on the date), plus the three extra rows. Page 2 prints
  exactly that; no remittance prints blank, never TOTAL. EXCESS keeps its
  formula (Remittance − TOTAL). `buildRemittance` is untouched.
- Live, September 2026: all 16 shops with deposits now print the Remittance
  sheet's TOTAL on Page 2 (each had printed less — TOTAL or the hand-keyed
  part only). Rendered from the golden dump, Page 2 is byte-identical for
  every shop (none there keeps deposits on day sheets).
- **Every statement that states the month's remittance reads it there**
  (office, same day, "one single source"): Cost Com (EXCESS / NET TOTAL) and
  Sale Tax (EXCESS / GRAND TOTAL) had the same hand-keyed-rows-only source;
  CRS 29's Page 2 read `remitDayTotal`, which leaves the extra rows out.
  Each sheet keeps its OWN EXCESS formula against its own totals, so
  EXCESS may differ between sheets (CRS 5 Sept: Page 2 and Cost Com −7.50,
  Sale Tax −457.50) — the remittance in all of them is the same figure.
  The Daily Sale sheet's remittance column already agreed.
- Live, September 2026: for all 16 shops with remittance, the Monthly
  Remittance screen's total = the Remittance sheet = Page 2 = Cost Com NET
  TOTAL = Sale Tax GRAND TOTAL = the Daily Sale remittance total (CRS 5:
  62372 everywhere; it had printed 62282 — the hand-keyed rows without the
  90 Poly & C.Box row, which happens to equal its Sales Amount).
- **One rule NOT changed:** for a date holding BOTH a Daily Entry deposit
  and a hand-keyed row, the Remittance sheet (and so `stmtRemitTotal`)
  takes the hand-keyed row — its comment calls that row the cereal /
  non-cereal split of the day's banking — while the Monthly Remittance
  screen shows the deposit. No such date exists live (2026-09-30); if one
  ever does, the office decides which rule is right.

## The month's reconciliation — Expected vs Remittance, one Excess

Office, 2026-09-30 (`npm run verify:reconcile`). `stmtReconcile(d)`
(`src/legacy/44-remit-total.js`) is the one calculation:

    Expected = POS sales + TEA / SALT + Police + C.Box / Poly
    Excess   = actual remittance (stmtRemitTotal) − Expected

- **POS sales**: every priced Page 2 commodity except tea / salt.
  **TEA / SALT**: OOTY, TAN, SALT CIS, SALT RFFS (keyed by hand, not on the
  POS). **Police**: Section B, as Page 2's POLICE row — included (office's
  decision). **C.Box / Poly**: Empty Card+Box / Empty Polythene Bag sold on
  the sales grid; when a shop keyed none there, the Monthly Remittance
  "Poly Gunny & C.Box" row (office's decision — CRS 5 keys it only there).
  Every figure is Page 2's own arithmetic.
- **Printed**: CRS Page 2's TOTAL is Expected and its EXCESS the Excess;
  Cost Com and Sale Tax print the SAME Excess (they had their own
  subtotals). Negative is printed as it is — never forced to 0; nothing
  banked prints −Expected. CRS 29 has its own sheets: `null`, unchanged.
- **The popup**: `ReconcileNotice` on the Statements page (under shop /
  month / year) and Monthly Remittance (above Save Remittance) asks
  `/api/statements/reconcile` — the engine's own calculation from the saved
  stores (signed in; a shop user only for their own shop). Negative → the
  "Reconciliation Mismatch" popup opens once per shop-month-figure with
  Statement Amount / Actual Remittance / Difference, the breakdown and the
  reasons, and a red line with "View details" stays; it refetches when a
  save of the remittance / day sheets / month lands, so a correction turns it
  green ("Reconciled … Excess ₹11.00") with no popup.
- **Reasons are the shop-month's own** (`reconcileReasons`,
  `src/lib/statements/reconcile.ts`): the shortfall equal to one component
  (Police, C.Box/Poly, TEA/SALT or one tea/salt item) or two together; for a
  month keyed day by day, the days banked below their own sales; nothing
  banked; else a plain statement of the gap.
- Live, September 2026: 16 shops with remittance, all consistent (Page 2
  TOTAL = Expected, one Excess on the three sheets); only **CRS 5 is short,
  −97.50 — exactly its Police sales** (60032 + 2250 + 97.50 + 90 = 62469.50
  against 62372 banked).
- **Priced at the SAVED rate**: every amount is sales × the Commodity Master
  rate (`stmtRateOf` / `stmtPriced`; the engine gets `__commodityMaster` as
  `ctx.commodityMaster`, else its compiled rate; free stays the engine's), so
  a rate changed on the Commodities screen follows on its own. The other
  builders' own RATE / AMOUNT columns still use the compiled rates. Live
  2026-09-30: all 2,131 stored day-sheet amounts equal sales × saved rate.

### The Daily Sale sheet's money

`buildCrsDailySale` (office, 2026-09-30, CRS 5 September). It printed TOTAL
AMOUNT OF DAILY SALES 62379.50 = Section A 62282 **+ Police 97.50**, then added
"CRS POLICE + JAGGERY 97.50" again (TOTAL 62567.00), and put the day's
inspection shortage — SUGAR 9 + PALM 4 **kg** — in the money EXCESS column
as "-13".
- Each day's TOTAL AMOUNT = chargeable **Section A** sales × saved rate
  (tea / salt included; Empty Card+Box / Polythene Bag and Police are the
  footer's own lines). Worked out from the sales, never the stored amount.
- Footer: DAILY SALES (the column's sum) + POLICE (`stmtPoliceAmount`) +
  C.BOX / P.GUNNY (`stmtPackAmount`: grid, else the e1 row — no longer e2/e3)
  = TOTAL = CRS Page 2's TOTAL = Expected.
- The EXCESS column prints no inspection figure; its TOTAL cell is the
  month's Excess = AMT PAID IN BANK − TOTAL (= the reconciliation's).
  Remittance figures are unchanged.
- Live, September 2026: all 16 shops' TOTAL = Page 2 TOTAL and EXCESS = the
  reconciliation's; CRS 5 = 62282 + 97.50 + 92.20 (C.Box 62 / Poly 22 keyed
  on Monthly Entry 2026-09-30) = 62471.70 against 62472 → +0.30. Golden
  dump: only `*_crs_daily_sale.html` changes (its TOTAL-row EXCESS cell).

### Cost Com prints no negative CLOSING BALANCE

`buildCostCom` (office, 2026-09-30): a CB below zero prints **0** — both the
bags and the kgs column, and the C.BOX / POLY rows. CRS 5 September printed
C.BOX **-62** and POLY **-22**: they were sold on Monthly Entry with no stock
on the grid (their stock is kept in Gunny Stock Management), so the stored
close is Opening 0 − Sales. **Display only** (`cbShown`): the stored close,
the amounts, EXCESS and NET TOTAL are unchanged, and every other sheet prints
its own closing exactly as before. Golden dump: Cost Com byte-identical for
all shops (none there is negative). `verify:reconcile` §7.

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

### Monthly Remittance's own Save

Office, 2026-09-29. `npm run verify:remittance-save`.

- **💾 Save Remittance**, under the table's ⓘ notes (full width on a phone,
  the section's blue), saves the month's **hand-keyed** rows — the days with
  no deposit on a day sheet, and the three extra rows. They are one record
  per day (`meRemitStore[key][day]`) and per extra row, so pressing Save
  again rewrites the same record; it can never add one. A day sheet's own
  deposits are not touched: they stay derived, and an administrator's
  ✎ / ✕ / ➕ still save them on their own (per date, as before).
- `remitMonthProblems` (monthly-entry/lib.ts) runs first, with Daily Entry's
  rule per row: amounts are numbers ≥ 0, an amount above zero needs its
  Remittance Date, a date needs an amount. Refused → nothing sent, the rows
  named in the status. The tick (`remittanceMonthSaved`) appears only after
  `saveConfirmed()`; a refusal shows the server's reason and no tick.
- The hand-keyed boxes now write **as typed** (were on blur), so the row and
  the TOTAL follow at once. Their rows are keyed by shop and month: the boxes
  are uncontrolled, and a row reused across months kept the previous month's
  typed figure on screen.
- **Where the figure goes** (unchanged flow): the statements read
  `meRemitStore` for any day with no Daily Entry deposit (`remitByDay`,
  `buildRemittance`). The DSS and Daily Entry read the day sheets, so a
  hand-keyed row — a day with no sheet — has no DSS page or Daily Entry
  deposit to reach (a receipt-only DSS page still prints C A/C 0.00).
- **Permissions unchanged**: who may type a hand-keyed row, and rule 1b for
  day-sheet deposits, are exactly as before.
- **The TOTAL row under the pointer.** `globals.css`'s hover shading reached
  footer cells, painting the TOTAL's cells `#F8FAFC` under its white text —
  the row went blank whenever the pointer was on it. Hover now shades
  `tbody` rows only.

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

**No delay between the database and the tick** (office, 2026-09-22):
- `saveConfirmed()` WAITS on the save already in flight (`inFlight`) rather
  than polling every 120 ms — the press is answered the moment it lands.
- `/api/state` writes its stores side by side (`Promise.all`; each keeps its
  own version check, so each still lands or conflicts exactly as before) and
  records the activity log with next/server `after()`, once the response is
  sent. `reconcileShops` stays BEFORE the response: the next save's
  Initial-Opening guard reads what it writes.
- Receipt uses `saveConfirmed()` (it used `save()`, which says "not saved"
  while the autosave is sending); Sales Close shows its tick as soon as the
  save lands, not after its dialog is dismissed; Daily and Receipt save
  buttons ignore a second tap while a save runs.
- The popup's tick draws 0.08 s after the card (was 0.22 s) — same design.

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

## The 3-month PV from uploaded PDFs

Reports → 3-Month PV → Manual (office, 2026-09-22). Past months of the quarter
are **uploaded as the office's PDFs**; the current month is **read from the
system**; they are chained into one quarter PV. `npm run verify:pv-quarter`.

- **Reading.** `pvPdfLoad.ts` (pdf.js, bundled worker, browser only) turns a
  PDF into positioned text; `pvPdfParse.ts` reads CRS PAGE2, GUNNY and CRS
  POLICE from it **by position, not text order** — a text dump collapses
  empty cells and shifts Police C.B values a line. A figure belongs to the
  rightmost heading whose centre is left of its right edge (the sheets
  right-align numbers). Every row must add up or the upload is refused;
  transfer's direction is whichever sign makes the row's own TOTAL.
- Several PDFs per month, any order, any file names, or the whole workbook as
  one PDF: other sheets are stepped over. **CRS PAGE2 is the only required
  sheet**; a month is complete the moment it is read. GUNNY and CRS POLICE
  are read when uploaded (office, 2026-09-22).
- **How PAGE2 is recognised.** B6, Free Com and Cost Com share its title, so
  PAGE2 is the sheet with RATE/AMOUNT columns (B6 has none) and both a B.RICE
  and a SUGAR row (Free Com has no SUGAR, Cost Com no B.RICE). **Never by its
  adjustment columns**: CRS 1's PAGE2 has no EXCESS/SHORTAGE at all, and
  requiring SHORTAG… stepped it over silently — "still needs CRS PAGE2" with
  the file sitting right there. A file named like a PAGE2 that is not read as
  one is now an error naming it.
- **A blank CLOSING cell is Total − Sales**, not 0. CRS 1 leaves C.BOX and
  P.GUNNY's Closing unprinted and opens the next month at exactly Total −
  Sales (July C.BOX 398 → August opens 398). A printed Closing, 0 included,
  is still read and checked.
- The same file picked again (name + size) is not read twice; the same sheet
  twice with identical figures counts once; with different figures it is
  refused. A wrong shop or month, or an unknown commodity row, refuses it.
- Uploads survive a refresh: the pages read are kept in sessionStorage per
  shop and quarter, restored after mount (restoring during the first render
  broke hydration). Nothing is written to the database.
- **Police only where `__crsMaster[].police`** says so — the system month
  drops its (zero) police rows otherwise, and a police sheet uploaded for a
  shop without it is left out, so no empty police section prints. Police and
  gunny each chain over the months that have them: the first month with the
  sheet opens the section, a month without it is stepped over (the carry is
  still checked across it).
- **The current month** is `systemQuarterMonth`: the Monthly Entry roll-up
  (`rebuildMonthlyFromDaily`) and the Gunny Stock screen's own rule
  (`gunnyRowFor`, now shared with `GunnyTable.tsx`), from the stores at that
  moment — no copy is kept. Stored transfer is outward-positive; a chain flow
  is signed (in +). C.S counts as sales.
- **The chain** (`chainQuarter`): opening = first month's; each later month
  must open at the previous Closing, and each month must add up, or Generate is
  refused listing every difference. Gunny carries the same way. Opening +
  Receipt + Transfer + Excess − Sales − Shortage = Balance.
- **Empty Polythene Bag / Empty Card+Box in the current month are the Gunny
  rows** (office, 2026-09-30). Since 2026-09-26/27 those two are SALES ONLY on
  the grid — their stock is Gunny Stock Management's POLY / C.BOX — so the
  grid row opens at 0 and closes at −sales. The chain compared the uploaded
  PAGE2's P.GUNNY Closing with that empty row: CRS 1, "Empty Polythene Bag:
  August 2026 closes at 15, but September 2026 opens at 0" while the Gunny
  screen opened POLY at 15 — not stale data, the wrong row.
  `systemQuarterMonth` now gives EMPTY_BAG / EMPTY_BOX the Gunny row's
  Opening, Receipt, Issues (= those sales unless typed) and Closing; uploaded
  months and every other commodity are unchanged. A genuine break still
  refuses (September POLY opening 0 → both the commodity and the Gunny line).
  Localhost, CRS 1 with the office's July + latest August PAGE2 (`… (2).pdf`)
  and September from a live copy: the PV generates, P.GUNNY Balance 31 =
  POLYTHENE 31, C.BOX 36 = C.BOX 36.
- **Gunny notes** ("WHEAT CONSIDER AS GUNNY") are lines containing CONSIDER
  below the Gunny table, printed as written under the PV's Gunny rows — this PV
  only; they change no figure.
- Nothing uploaded is saved anywhere. The generated quarter is tagged with its
  shop and period, and a PDF still being read when the shop changes is
  dropped, so one shop's figures can never print under another's name.
- **CRS 1, Q2 2026 (dry run, 2026-09-22):** July and August read in full and
  carry July → August exactly, but Generate refuses on six commodities because
  the Initial Openings typed on 01-09-2026 ("admin (office instruction)")
  differ from the August PDF's closings: PHH FRK 1995 vs 495 + PHH BRA 0 vs
  1500, AAY FRK 350 vs 50 + AAY 0 vs 300 (each pair sums the same), TAN 0 vs
  150, Empty Polythene Bag 15 vs 0. That is the office's to settle — not
  worked around in code. Still so on 2026-09-28.

### The PV sheet: Annexure-I on Legal paper

`buildPVTable` (`pvStatement.ts`), for both the automatic and the 3-month PV
(office, 2026-09-28). `npm run verify:pv-quarter` §5.

- **The format is the office's own**: `CRS 19 PV STATEMENT.xlsx`, sheet
  "30.09.23" (Annexure-I) — **38 columns** (B:AM), headed as rows 9–12 there,
  the number row one number per heading (1–18; TRANSFER and TOTAL carry
  none). The old sheet had 36 columns under title rows spanning 39 and a
  number row running to 38, so the numbers and section rows stuck out past
  the commodity rows — it had lost "Shortage during the year" and the PV
  result's Excess / Shortage pair.
- **Legal landscape, one page** — the workbook is `paperSize="5"`,
  landscape, fit to page, and all nine PV PDFs the office sent are
  355.6 × 215.9 mm, one page. `@page{size:legal landscape;margin:12mm 18mm}`
  (18 mm = the workbook's 0.709 in).
- **Laid out in millimetres, never against the window**: on screen the sheet
  is a 355.6 mm page (its scroller scrolls on a narrow window); in print the
  same table at the same 319.6 mm. The old one was a `min-width:1400px`
  screen table, squeezed onto A4. Columns have fixed shares (`PV_COL_MM`):
  kgs columns hold a 9-figure quantity at the sheet's own type (8.5px data,
  unchanged); the columns the officer fills by hand are narrower. Every
  commodity there is, at the widest figures, still fits one page with no cell
  cut (checked by printing it).
- **Where each figure prints** (as the office's PDFs place them): Opening →
  8 "Physical"; Receipt 10; TRANSFER (net, in +); TOTAL = Opening + Receipt +
  Transfer + Excess; Issues 11 (sales); **Shortage → 12 "Shortage during the
  period", red**; Balance 14 = TOTAL − Issues − Shortage (the Closing);
  **Excess → 17 "Excess" (Physical Verification), green**. The form has no
  Excess column before TOTAL, so 17 is the only Excess on it — an assumption
  to confirm with the office. Colour only when the printed figure is not zero
  (15 kg is 0 bags: that 0 stays black). By Counting / By 100 % stay blank
  for the officer.
- Checked on live data (read only), 2026-09-28: CRS 1's July and August PDFs
  add up for all 24 commodities and carry July → August; September adds up
  for all 30 shops; the printed cells read back as OB + Rec + Tr + Ex = TOTAL
  and TOTAL − Issues − Short = Balance on every row.

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
npm run verify:pv-quarter      3-month PV: office PDFs read by position, July → August → September chain, police/notes, dev parity
npm run verify:coll-advance    COLL: an Advance receipt stays out of the closing balance and prints in the ADVANCE table
npm run verify:dss-rates       DSS prices sales at the saved Commodity Master rate, in the preview, the print and the .xlsx
npm run verify:dss-totals      DSS TOTAL row carries the money alone; the C A/C line is the money banked
npm run verify:gunny-sales     C.Box/Poly sales are the Gunny Issues; the gunny figures are admin-only, server-enforced
npm run verify:gunny-save      Gunny Stock Save: same write as the month-close, passes rule 5 as a shop user, validation, tick after the database
npm run verify:remittance-save  Monthly Remittance Save: Daily Entry's rule per hand-keyed row, one record per day, statement reads it, tick after the database
npm run verify:date-format      dates on screen are DD-MM-YYYY: DateField for every date box, day-first parsing, stored dates untouched
npm run verify:opening-correction  Daily Entry asks an administrator before saving an Opening that differs from the carry
npm run verify:remit-total       every statement's remittance (Page 2, Cost Com, Sale Tax, CRS 29) = the Remittance sheet TOTAL, never a total
npm run verify:reconcile        Expected (POS + TEA/SALT + Police + C.Box/Poly) vs remittance: one Excess on Page 2 / Cost Com / Sale Tax, the mismatch popup
npm run verify:gunny-sync       Gunny Save → Monthly Sales + last-day Daily Entry: created / updated / waiting / projection, no duplicates, next month's OB
npm run verify:daily-bags       a "from Daily" row's typed bag counts: saved, kept by every republish and by Gunny Save, logged
npm run verify:oap-statement    Reports OAP / APS / ANP: shops with an entry only, Monthly Sales figures, family from the master, one A4 landscape page per shop
npm run verify:carry-forward    previous month Closing → this month Opening on Monthly Entry, for administrators too; chain, then last month published
npm run verify:commodity-scope  Commodity Master scope: All Shops / one shop, Order position, server read filter, admin-only master, keying guard
npm run verify:bag-counts       Page 2 / Free Com / Cost Com / B6 print Monthly Sales' bag counts: saved counts, 52→53→54→52, OB + RC = TOT, TOT − SAL = CB
npm run verify:gunny-receipt    Gunny Receipt = Monthly Sales' bag counts (never typed): each commodity's pack and size, CRS 5's 227 / 28, the Receipt-page switch, day vs month once, refresh, next month's OB, rule 5, statement parity
npm run verify:print-layout    a screen that prints, prints one area — not the sidebar, the topbar and a clipped page
npm run verify:print-pdf       prints the real document with headless Chrome and reads the PAGE SIZES out of the PDF
npm run verify:sign-in         an accepted sign-in opens the app or says why (cookie not kept); --base=… runs it in Chrome
npm run verify:entry-dates      Daily Entry Last Entry Date | Total Entry Dates: the rule, saved-not-typed, live data vs an independent count
npm run verify:card-jump        Dashboard → Card Details & Allotment: the jump hand-off and its wiring
npm run verify:card-inputs      Card Details & Allotment boxes: typed value kept, no wheel stepping, Enter down the column
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
  the default `iad1` round-trips every request through Virginia. Now pinned in
  `vercel.json` (`"regions": ["bom1"]`) — it was never set in the dashboard: on
  2026-09-22 the live site's `X-Vercel-Id` read `bom1::iad1`, every function in
  Virginia, and a CRS 17 sign-in on a phone sat on "Connecting…" until the clerk
  closed the tab
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

## Which shops have police ration

`__crsMaster[].police` (live) — CRS 1, 5, 9, 10, 11, **12**, 15, 17, 19, 20, 23, 24,
27, 28, 30 as of 2026-09-22, when the office assigned CRS 12 police ration. It
is read by the CRS Master screen, the dashboard shop card ("Had Police") and
the COLL statement's POLICE block (`d.hasPolice`); Daily and Monthly Entry show
Section B and the CRS Police statement is offered for every shop regardless.

The CRS Master screen shows the flag but cannot change it. Use
`node tools/set-crs-police.mjs --crs=N --on|--off` (dry run) then `--write`:
one field of one shop, the row backed up to `backups/` first, written under
its version. The compiled default in `23-crs-master.js` is the seed only —
keep it in step so a re-seed cannot undo the office's change.

## Open items

- Five staff are `bc:` in `CRS_MASTER` but `Packer` in the users table
  (CRS 5, 8, 19, 28, 29). Statements now follow the users table and print them
  as P.K.R (2026-09-21); the master's column itself is unchanged.
- Everyone shares the password `pds123`; the audit trail's `updated_by` proves
  little until that changes.
