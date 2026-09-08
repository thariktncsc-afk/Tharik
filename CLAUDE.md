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
To close that gap, add `xlsx-js-style` as a dependency and port
`downloadDSSExcel()` server-side, shimming `XLSX.writeFile` to capture the
workbook instead of writing it.

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

## Tools

```
npm run dev                 regenerates the statement modules, then next dev
npm run build:stmt          regenerate src/generated/*-legacy.js from src/legacy
npm run verify:statements    306 golden statements, byte-for-byte
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
- Supabase free tier **pauses after 7 days idle and has no backups** — upgrade
  before real users depend on it

Backups live in `backups/`, gitignored because they contain staff names and
phone numbers.

## Open items

- Five staff are `bc:` in `CRS_MASTER` but `Packer` in the users table
  (CRS 5, 8, 19, 28, 29). Those shops therefore have no Bill Clerk, so statements
  print a blank BC signature line. Needs the office to confirm before switching.
- Everyone shares the password `pds123`; the audit trail's `updated_by` proves
  little until that changes.
