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

Demo sign-ins (unchanged): `9344114086` / `pds123` for Admin, `crs9` / `pds123`
or `crs1` / `pds123` for a shop user. The login screen's quick-login buttons
fill these in.

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
