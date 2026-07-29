# TNCSC CRS Statement Management System — Next.js

Next.js (App Router, TypeScript) port of `TNCSC_CRS_Demo_19 (1).html`.

Frontend only — there is no backend, no database and no persistence, exactly as
in the original. All data lives in memory for the session, and the Backup
export/import screen is still the only way to carry a month between sessions.

## Running it

```bash
npm install
npm run dev
```

Then open http://localhost:3000.

Demo sign-ins: `9344114086` / `pds123` for Admin, `crs9` / `pds123` or
`crs1` / `pds123` for a shop user. Type them in — the port's one-click
"Quick Login" buttons have been removed, since a sign-in screen should not
carry working credentials.

| Script | What it does |
| --- | --- |
| `npm run dev` | Bundles the engine, then starts Next in dev mode |
| `npm run build` / `npm start` | Production build and serve |
| `npm run bundle:engine` | Rebuilds `public/js/tncsc-engine.js` from `src/legacy/*.js` |
| `npm run verify:parity` | Diffs the ported CSS / markup / JS against the original HTML file |

## How the port is laid out

```
src/app/layout.tsx        <html>/<body>, page title, metadata
src/app/page.tsx          composes the shell and the engine
src/app/globals.css       the original <style> block, verbatim
src/app/responsive.css    the responsive layer (added, not ported)
src/components/AppShell.tsx      injects the markup (server component)
src/components/LegacyEngine.tsx  loads the engine as a classic script
src/components/MobileNav.tsx     off-canvas nav for narrow screens
src/markup/*.ts           the original markup, one file per screen
src/legacy/*.js           the original script, split into 18 readable parts
tools/                    the porting, bundling and parity-check scripts
```

`src/markup/` and `src/legacy/` hold the original CSS, HTML and JavaScript
unchanged — `npm run verify:parity` proves it byte-for-byte. Nothing about the
layout, the calculations, the statement formats or the print/Excel output has
been altered.

### Adding to the ported files

Work done after the port is kept separable from it, so the parity check stays
meaningful:

- New behaviour is a new file — `src/legacy/20-`, `21-`, `22-` — listed in
  `NEW_MARKUP` / `NEW_ENGINE` in `tools/verify-parity.mjs`, which excludes it
  from the comparison. A whole new screen would add a `src/markup/page*.ts`
  the same way.
- A one-line addition inside a ported file is tagged `[+]`. Parity drops tagged
  lines before comparing, so everything untagged still has to match the
  original byte-for-byte — an untouched-looking edit is still a failure.
- A block that is genuinely *redesigned* (not merely added to) is fenced with
  `[+redesign-start]` / `[+redesign-end]` comments and registered in
  `REDESIGNED` in `tools/verify-parity.mjs`, with the port's own text for that
  block kept in `tools/redesigned/`. Parity splices the original back in before
  comparing and prints a note naming the block, so the divergence is recorded
  rather than waved through and the rest of the file is still held to parity.
  The Daily Entry remittance + action bar is the first of these.

Behaviour that belongs to a ported screen but not to the original file is added
by *wrapping*, not editing: a new engine part reassigns the ported function
(`saveEntryForm`, `showPage`, …) and calls through to it. Because the parts are
concatenated into one classic script, the last definition wins, so nothing in
`src/legacy/01-`–`18-` has to change.

## Branding

The sidebar and login badges carry the **Seal of Tamil Nadu**
(`public/img/seal-of-tamil-nadu.svg`) in place of the port's "TN" lettering. It
is served as a file rather than inlined — at ~666 KB it would otherwise land in
every page's HTML — and sits on a white badge with `object-fit:contain`, so the
taller-than-wide seal is never stretched.

## Shop names

The real Tamil shop names live in `src/legacy/02a-crs-names.js`, which
overwrites the placeholder English names on each record of `CRS_LIST`.

That one file is the whole change, because no screen keeps its own copy of a
shop name — every dropdown, page title, statement and export reads
`CRS_LIST.find(...).name` when it renders. It is also the one added part that
does not sort at the end: the bundler concatenates by filename, so `02a-` lands
straight after `02-masters.js`, where the list is built, and before
`03-daily-entry.js`, whose init already fills a dropdown from it.

## CRS Master Configuration

**CRS Shops** is the master the office works from, preloaded from *TNCSC
Statement Closer — Sheet5*: shop code, the Bill Clerk and Packer with their
mobile numbers, whether the shop files a **COLL** statement, whether it has a
**police ration**, and whether it is in use.

**Logins are generated from the master.** One account per person the sheet
names and none for a person it does not: 22 Bill Clerks, 5 Packers, plus the
administrator. Both roles of a shop share the username `crs<n>` and the role
chooser separates them, so the chooser now appears exactly when the shop really
has two people — the port's fixed demo list gave every shop a single BC, which
is why the five shops with a real packer never offered it and CRS 9 offered one
for a packer the sheet does not have. A shop set to *No Usage* has its logins
disabled and re-enabled when it is set back to Active.

**The master is where every screen gets a shop's staff.** `getUsersForCRS()` is
the engine's only accessor for a shop's Bill Clerk and Packer, and all three of
its callers — the dashboard card, the signature block printed on statements, and
the statement data object — go through it, so redirecting that one function
moves the whole application onto the master. The signed-in user's own name and
number are synced too, which is what the sidebar, the "Welcome," line and the
role-chooser read; the ported user list keeps only what the master does not
carry (usernames, roles, passwords, which shop a login belongs to).

Where the master has a record it is taken as **complete**: a blank packer means
the shop has no packer, not that one is unknown, so nothing is filled in from
the demo list behind it — that is how sample staff used to reappear on a shop
the sheet leaves empty. The statement builders print a ruled blank for missing
staff, which is the honest output.

Eight shops the sheet lists under *No usage* (2, 3, 4, 6, 13, 18, 21, 22) start
inactive. Nothing about them is deleted: an admin can set one back to **Active**
at any time and it keeps its code and staff. While a shop is out of use the CRS
pickers stop offering it, but a month already keyed against it stays readable.

## DSS statement totals

The official DSS form totals money only, so the total rows — row 25 on the main
section and row 7 on the police section — leave the opening, receipt, total,
sales and closing cells blank and print just the ₹ and the section amount. This
applies to **every shop**, on screen and in the Excel export.

Both builders are ported, so neither is edited: the on-screen sheet is corrected
on the rendered DOM and the workbook on its way to `XLSX.writeFile`, which is
the only reachable seam (the export's cell-writing helper is a local). Both find
the total rows by their Tamil label rather than by a fixed cell address, so a
change of layout cannot silently blank the wrong cells.

## CRS 29 — Refugee Camp

The refugee camp files a different family of statements, reproduced in
`src/legacy/26-crs29.js` from *CRS 29-REFUGEE CAMP JUNE'26.xlsx*. It is chosen
by shop number alone: select CRS 29 on the Statements screen and its section
list and builders take over; select anything else and none of that file runs,
so **CRS 1–28 and CRS 30 keep the ported formats untouched**.

The camp carries **eight commodities and no others** — B.RICE, R.R.A, SUGAR,
WHEAT, T.DHALL, CYL, P.OIL, KEROSENE — on every sheet, and they are all the
allotment panel offers for this shop. Card Details counts cards as a single
total rather than by type. CRS PAGE1 has no card-details column, only the
allotment.

Three sheets have no standard equivalent (**C Rice, Sales Report, Indent**), and
there is no COLL, Free Com, Cost Com, CRS Police or RBI — asking for one of
those returns a note rather than the wrong format. Receipt, CRS Daily Sale and
Remittance keep the ported layouts, which the camp's workbook matches.

`STMT_SECTIONS` is read by name across the ported statement screen, so the
array object is kept and its contents swapped for whichever list applies; ticks
belonging to a section the new list lacks are dropped on the swap.

### Entry screens

Daily Entry, Monthly Entry and Receipt show the camp only **BRA, RRA, Sugar,
Wheat, Toor Dal, Palm Oil and Kerosene**, plus the existing Poly and C.Box
lines; there is no police section. The allotment offers the same seven. Card
Details is a single **Total Cards** figure rather than nine categories.

Kerosene is not a ported commodity, so `27-crs29-entry.js` defines it and it
appears only in the camp's list. It is issued by the litre out of a barrel, so
it carries **no gunny count** — its gunny cells on Monthly Entry are the same
ruled dash the packing lines show. CYL is printed on the statements but is not
stocked or allotted, so it is not asked for and its stock columns read zero.

The ported render, recalculate and save routines all reach for `DSS_A`/`DSS_B`
by name from inside themselves, so there is no argument to override. Their
**contents are swapped for the duration of one call** and put back in a
`finally`, which is why the swap never outlives a synchronous call — a statement
for CRS 7 rendered while Daily Entry sits on CRS 29 still sees all twenty-one
commodities. `ME_CARD_TYPES` is handled the same way.

### Dashboard, reports and the police section

The camp has **no police section anywhere**: the Section B blocks and their
summary tiles come off Daily Entry and Monthly Entry, and the police rows and
headings are gone from its reports, its Monthly Statement panel and its DSS
sheet. Its Closing Stock widget lists the seven stocked commodities and the
dashboard's figures count those alone.

Four printed outputs build straight from `DSS_A`/`DSS_B` rather than from the
screens — `generateMonthlyStatement`, `openDSSPreview`, `downloadDSSExcel` and
`generateReport` — so each is wrapped too; hiding the on-screen grid alone would
have left them printing all twenty-one commodities and a police table. The
Excel export builds its sheets inside an asynchronous callback, so the scope is
put around the callback rather than the call.

**What each output counts differs on purpose.** The dashboard counts the seven
stocked commodities, because its headline figure is a weight and Poly/C.Box are
counts of packing. A report keeps them: they are paid lines (₹2.50 and ₹0.60)
that were explicitly retained on the camp's entry screen, and dropping them
would leave the report's money short of the remittance it reconciles against.
Neither ever keeps a removed commodity or the police side. A report over *every*
shop still resolves the camp's Kerosene by name and unit rather than falling
back to the raw id in KG.

### Free / cost rice

Daily Entry gains a **BRA Rice — Free / Cost split** panel for the camp. Enter
either figure and the other is worked out so the two always total the day's BRA
sales; neither can exceed it. Which box was typed is remembered, so when the BRA
sales figure later changes the same half is held and the other re-derived rather
than the split being silently reassigned. It saves with the day sheet.

## COLL statement

Each column now draws on its own source, where the ported builder printed the
monthly receipt in both Allotment and Received:

| Column | Source |
| --- | --- |
| Opening balance | unchanged — the ported monthly opening |
| Allotment | Monthly Entry → Allotment |
| Received from godown | the Daily Entry receipt, **less any advance load** |
| Total | Opening + Received |
| Closing balance | Total − shortage + excess − sales |

**Advance load** is stock drawn ahead of the month it belongs to. It is entered
per commodity beside the allotment on Monthly Entry, and only ever reduces what
this month's statement claims to have received. Worked through: opening 100,
300 actually received of which 100 was an advance, prints 200 received and a
total of 300; sales of 300 leave a closing of 0.

The shortage and excess come from the Daily Entry inspection adjustments and
are applied *after* the total, before sales. A shop the master marks as having
no police ration gets no POLICE section.

## Daily Entry: remittance and the two completion buttons

A day sheet cannot be completed without a remittance. **Remittance Amount** and
**Remittance Date** are both required, and a day may carry more than one — a
deposit split across two challans is one day with two remittance rows. Enter an
amount and date and press **Add** to build the list; a single deposit can just
be left in the fields and it is taken as one row on save.

The day's rows are stored on the saved sheet as `remits`, with the ported
single-value fields kept in step as the aggregate — `remitAmount` is their sum
and `remitDate` the earliest of their dates — so the statements, the PV/DSS
builders and the exports read exactly what they always did. Sheets saved before
this existed (and the sample data) carry only the single pair and are read back
as one row.

The action bar reads **Clear · தினசரி விற்பனை நிறைவு** on the left, with
**மாத விற்பனை நிறைவு** on the far right. The first saves the day sheet, the
second is the monthly Sales Close. Both are gated on the remittance: Sales Close
saves the marked day on its way through, and the ported version ignores what
that save returns, so the gate is applied to it directly rather than letting a
month close on an unremitted day.

## Monthly Entry: Card Details and Allotment

Monthly Entry is the one place card counts and the month's allotment are typed.
Both feed the generated statement, so neither is entered twice:

| Entered here | Reaches |
| --- | --- |
| Card count | CRS PAGE1 (left column) · CARD DETAILS sheet |
| Allotment | CRS PAGE1 (right column) · COLL *Allotment* column |

The Remarks column is gone; the right-hand half of the section is now the
allotment — the 15 main ration commodities, each with its own KG / LTR unit.
The packet lines (salt, OOTY, TAN), the empty packing materials and the police
ration are not asked for, because none of them is issued as a monthly
allotment; they are exactly the lines CRS PAGE1 and COLL's main section print.
This narrowing is the allotment panel's alone — Daily Entry, the Monthly sales
grid and the statements still carry every commodity.

**The two behave differently on purpose.** Card counts barely move month to
month, so they carry forward: opening a month that has none *shows* last
month's figures, **No Change** accepts them as they stand, and **Save** stores
whatever is on screen — which becomes next month's starting point by virtue of
being this month's. Allotment is re-issued every month and is never carried, so
each month starts blank and has to be filled in.

Carried counts are a **preview, not data**. They are held separately from
`meCardStore` and only promoted into it by the first edit, Save, or No Change —
because the statements read that store directly and cannot tell a carried
figure from a typed one, so writing on render would make every month someone
merely glanced at report last month's cards as its own. Until it is promoted,
the month reports no card details anywhere and the monthly close still refuses
it. Promotion adopts the whole set, so editing one row does not leave the
others behind.

Monthly Entry's own action bar is **Clear** on the left and
**மாத விற்பனை நிறைவு** as the primary action on the far right — the ported
save, renamed, with its tooltip and success banner carrying the same words. It
still stores the month's entry, remittance, gunny stock and card details in one
go; none of that logic changed.

The Daily Entry button of the same name (the monthly Sales Close) will not run
until the month has card counts, those counts have been saved or accepted, and
an allotment has been entered. It runs from Daily Entry, so the message names
the shop and month to go and complete.

A month with no allotment falls back to the ported behaviour — CRS PAGE1 draws
its allotment from the Receipt module as it always did — so old months keep
rendering exactly as before.

## Responsive behaviour

The original was desktop-only. `src/app/responsive.css` adds the small-screen
layout on top of the ported CSS without editing a line of it — every rule that
changes layout sits inside a media query, so above 1100px the rendering is
unchanged (verified by comparing element geometry against the original file: all
11 screens match exactly at 1280px).

| Width | Behaviour |
| --- | --- |
| > 1100px | The original desktop layout, untouched |
| ≤ 1100px | Four- and three-column KPI grids drop to two |
| ≤ 900px | Sidebar becomes an off-canvas drawer behind a ☰ toggle; grids reflow with `auto-fit`; inputs go to 16px so iOS does not zoom on focus |
| ≤ 560px | Tighter padding and type; modal buttons stack |

The wide data grids (Daily Entry, Monthly Entry, the statements) keep their real
column widths and scroll horizontally inside their own wrappers, rather than
being reflowed — a stock register that silently rearranges its columns is worse
than one you swipe. Every screen was checked at 375px and 768px for content
escaping the viewport; there is none.

Below 900px, action buttons come up to a ~42px touch height and the nav rows
gain padding to match — scoped inside the media query, so desktop keeps the
ported sizes, and away from the table-row micro-buttons (`.btn-sm`) whose rows
would double in height. Inputs are already 16px there, so iOS does not zoom on
focus. Statement previews scroll inside their own panel, and the DSS viewer's
sheet scrolls inside `#dss-scroll` — on a phone the 840px sheet is swiped, not
shrunk into illegibility.

`MobileNav` renders only the toggle and the backdrop and sets a `nav-open` class
on `<body>`. It never touches the sidebar markup, which the engine owns. It
watches the login screen's `hidden` class so the toggle stays out of the way
until someone is signed in, and closes the drawer on nav taps, Escape, backdrop
taps, and resize back to desktop.

### Why the markup is injected rather than written as JSX

Every screen is driven by the imperative engine: it looks elements up by `id`,
writes tables with `innerHTML`, and the markup calls back into it through inline
`onclick` / `onchange` attributes. React does not own any of that state, so
rewriting the markup as JSX would mean React and the engine both trying to
control the same DOM — and the smallest re-render would wipe out whatever the
engine had written.

Injecting the markup in one pass sidesteps that entirely. The browser parses
exactly the document the original produced, React never re-renders or diffs the
subtree, and the engine keeps working the way it always did. `AppShell` is a
server component, so the markup ships in the first HTML response — there is no
blank first paint.

`#app-root` (the wrapper the markup goes into) is `display:contents`, so
`#login-screen`, `#sidebar` and `#main` stay direct flex children of `<body>`
and the layout is pixel-identical.

### Browser back / forward

The ported navigation only toggled which `.page` is visible, so the browser had
one history entry for the whole session and Back left the app — which read as
"Back goes to the login page" from any screen. `src/legacy/30-nav-history.js`
wires the existing funnel into the History API without changing the URL: each
navigation pushes a `{page}` state against the same path, so Next's router
(which reacts to path changes) is never involved.

Three wrappers cover the whole app, because every navigation already goes
through them: `showPage` (all sidebar items, `navTo`, and the role-gate's
internal fallback — the recursion calls the identifier `showPage`, which
resolves to the wrapper), `enterApp` (the post-login landing paints the
dashboard directly), and `doLogout`. Each pushes whichever page actually ended
up active rather than trusting its argument, deduplicated against the top
entry, so the role-gate's redirect produces one entry, not two.

Back therefore walks Monthly Entry → Daily Entry → Dashboard, and one more Back
past the first page ends the session the same way Sign Out does — by design,
not as a stray redirect. Logging out (either way) pushes a fresh login entry,
which truncates the ended session's forward stack; stepping Forward afterwards
never restores a session without credentials.

### Why the engine is one bundled classic script

The engine was one long `<script>` block and it hoists across its whole length —
the Daily Entry init IIFE reads `currentUser`, which is declared several hundred
lines below it in the auth section. Split across separate `<script>` files that
becomes a `ReferenceError` that silently kills the rest of the file, so
`tools/bundle-engine.mjs` concatenates `src/legacy/*.js` back into a single
script before dev/build. Edit the files in `src/legacy/`; the bundle is generated
and gitignored.

It is a classic script, not an ES module, for the same reason: the inline
handlers in the markup call these functions by name off `window`.

## Re-running the port

`tools/extract-from-legacy.mjs` regenerates `src/app/globals.css`,
`src/markup/*` and `src/legacy/*` from `../TNCSC_CRS_Demo_19 (1).html`. It is a
one-shot tool kept for traceability — running it discards any edits made to
those generated files.

## Suggested next steps

Now that the app is a Next.js project, screens can be migrated to real React one
at a time: move a page's markup into a component with local state, delete the
matching section from `src/legacy/`, and leave the rest of the engine untouched.
Adding a backend later means replacing the in-memory stores in `src/legacy`
(`entryStore`, `monthlyStore`, `receiptStore`, `userStore`, …) with API calls.

## Persistence (Supabase)

The stores now survive a session. Nothing about the engine's data model changed:
the same stores the Backup screen exports are written to Postgres as JSONB and
read back on sign-in, so the statement, calculation and print code is untouched
and `36-persistence.js` is excluded from the parity check like every other
post-port addition.

| Piece | What it does |
| --- | --- |
| `supabase/migrations/0001_init.sql` | `crs_state` (one JSONB row per store, versioned) + `crs_state_audit` |
| `src/lib/supabaseAdmin.ts` | Server-only client using the secret key |
| `src/lib/session.ts` | HMAC-signed HttpOnly session cookie |
| `src/app/api/session/route.ts` | Re-checks the credentials server-side, issues the cookie |
| `src/app/api/state/route.ts` | `GET` loads every store, `POST` saves only the changed ones |
| `src/legacy/36-persistence.js` | Wraps `doLogin`/`doLogout`, autosaves on a dirty check |

### Setting it up

1. Create a Supabase project. **The region cannot be changed later** — prefer
   `ap-south-1` (Mumbai) for users in Tamil Nadu.
2. `cp .env.local.example .env.local` and fill in the URL, keys and a generated
   `APP_SESSION_SECRET`.
3. Run `supabase/migrations/0001_init.sql` against the database — via
   `npx supabase db push`, or paste it into the SQL editor.
4. In Vercel, set the same four variables under Project Settings → Environment
   Variables, and set the function region to Mumbai (`bom1`) so requests do not
   round-trip through us-east.

**Migrations do not run on deploy.** Pushing to Vercel ships the frontend only;
run the SQL against the live database as an explicit deploy step or the app will
500 against an older schema.

### Why the browser does not talk to Supabase directly

Supabase's Row Level Security keys off `auth.uid()`, which only exists with
Supabase Auth. This app keeps its own client-side login, so there is no database
identity to write a policy against. RLS is therefore enabled with *no* policy —
the publishable key can read nothing — and all access goes through the route
handlers, which hold the secret key and authorise against the session cookie.
Moving to Supabase Auth later would let the browser query Supabase directly.

### User management

Users have their own table, not a JSON blob. `supabase/migrations/0002_users.sql`
creates it, seeds it from the previous `userStore` row, and hashes every password
with bcrypt via pgcrypto. The old blob is renamed to `userStore__pre_0002` rather
than dropped, so the pre-migration roster stays recoverable.

| Route | Who | Does |
| --- | --- | --- |
| `POST /api/session` | anyone | Verifies credentials via `verify_login()`; issues the cookie |
| `GET /api/users` | any signed-in user | Roster without password hashes |
| `POST /api/users` | ADMIN | Create |
| `PATCH /api/users/:id` | ADMIN | Update, activate/deactivate, set password |
| `DELETE /api/users/:id` | ADMIN | Delete |

**Sign-in is decided only by the database.** `doLogin()` compared every password
against a hardcoded `'pds123'`, so an admin-set password was ignored by the login
screen while the server checked the real one — when those disagreed the user just
saw "invalid credentials" with nothing to act on. The sign-in path now calls
`enterApp()` directly with the account the server returned, so that check is out
of the loop entirely.

`username` is deliberately **not** unique. A shop username maps to more than one
person (a Bill Clerk and a Packer share `crs9`), and the sign-in screen relies on
that to offer its role picker. The picker now takes two calls: the first
authenticates and returns the candidates, the second binds the session to the
account chosen. Credentials are held in memory only between those two calls.

An administrator cannot delete or deactivate their own account, and the last
active administrator cannot be deleted.

### Known limits

- **All shops share one dataset.** `scope` is `'global'` for every row, matching
  the current in-memory behaviour where one backup file holds every shop. A shop
  user's browser therefore receives all shops' data — as it already did. Since
  `entryStore` is keyed `'crsId_date'`, splitting it per shop is possible without
  a schema change and is what closes this gap.
- **Concurrent saves are version-checked, not merged.** Two shops editing the
  same store get a 409; the loser reloads and re-sends. Per-shop scoping removes
  most of the contention.
- **Every seeded account still shares the password `pds123`**, and new users are
  created with it. The hashing is real now, but a shared default means the audit
  trail's `updated_by` proves little until each person has their own password.
  Forcing a change on first sign-in is the next step.
- `doLogin()` still contains its hardcoded `'pds123'` comparison. Nothing reaches
  it any more — the sign-in path bypasses it — but it is dead code in a ported
  file and worth removing when parity is next revisited.
