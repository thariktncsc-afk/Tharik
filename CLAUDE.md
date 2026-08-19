# TNCSC CRS — working notes for Claude Code

Statement management for Tamil Nadu Civil Supplies Corporation ration shops
(Madurai region). These are real government supply records — the figures end up
on statutory statements, so a wrong number is worse than a missing feature.

Most of what follows is here because it already cost someone a day.

## The one thing to understand first

**Two implementations of this app live in the repo, and both run.**

| | Where | Served at |
| --- | --- | --- |
| Legacy engine | `src/legacy/*.js` (41 files) + `src/markup/*.ts` | `src/app/page.tsx` |
| React conversion | `src/app/(app)/*` | `/dashboard`, `/daily-entry`, … |

The engine is the original single-file app split into numbered parts and
concatenated back into one classic script by `tools/bundle-engine.mjs`. Screens
are being migrated to React one at a time. **Both run against the same database
and the same store shapes**, so a data-model change has to work for both.
`src/lib/dataStore.ts` is the React port of `src/legacy/36-persistence.js` and
deliberately keeps the same wire contract.

## The parity guarantee — do not break it

`npm run verify:parity` proves the ported code is byte-for-byte identical to the
original `TNCSC_CRS_Demo_19 (1).html`. It is the project's evidence that the port
did not silently change a calculation.

- **Never edit a ported file** (`src/legacy/0*`–`19*`, `src/markup/*`) to add
  behaviour. Put new behaviour in a **new numbered file at the end** — currently
  up to `41-session-resume.js` — and add its name to `NEW_ENGINE` in
  `tools/verify-parity.mjs`.
- If you genuinely must touch a line inside a ported file, tag that line `[+]`.
  Parity drops every line containing `[+]` before comparing. A one-line early
  return is the intended scale.
- The engine is a **classic script, not a module**. Inline `on*` handlers call
  its functions by name off `window`, and it hoists across its whole length.
  Later files redefining earlier functions is the supported override mechanism.

**Parity needs `TNCSC_CRS_Demo_19 (1).html` in the repo's PARENT directory**
(`D:\services projects\`). It is not in the repo and is currently missing, so the
check dies with ENOENT. Get that file before trusting a green run.

One known pre-existing failure at offset ~123514: commit `a404a6d` changed a
login error string inside ported `07-auth.js` without a `[+]` tag. Not yours.

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

## Tools

```
npm run dev                 bundles the engine, then next dev
npm run verify:parity       byte-for-byte check against the original
node tools/import-monthly-xlsx.mjs <folder> [--skip=29] [--write]
node tools/seed-masters.mjs
node tools/backup-crs-state.mjs
node tools/verify-statements.mjs
```

The Excel importer maps columns **by header name, never by position**. Not a
style preference: the 22 monthly workbooks have **13 distinct column layouts**,
differing in how many adjustment columns (`EXCESS` / `SHORTAGE` / `TRANSFER` /
`C.S`) sit between RECEIPT and TOTAL. A positional importer silently shifted 13
of 22 shops' figures. Sheet names vary too (`CRS PAGE2`, `CRS PAGE2 `,
`CRS PAGE2 - 2`), so sheets are matched by normalised prefix.

## Gotchas that have already bitten

- **`const` globals are not on `window`.** `CRS_SHOPS` and `COMMODITIES` are
  `const`; top-level `const`/`let` live in the global lexical environment and
  never become `window` properties. Reading them off `window` yields `undefined`
  silently. Reference them by identifier.
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
- **Show/hide is not symmetric in ported UI code.** Several ported renderers only
  ever *show* an element when data exists and never hide it when absent, so the
  previous shop's values linger. `39-staff-roles.js` fixes the dashboard staff
  blocks; assume the pattern exists elsewhere.
- **The engine bundle is cache-busted** by a content hash (`?v=…`) written to
  `src/generated/engine-version.json` by the bundler. If behaviour looks stale,
  hard-reload before debugging.
- Statement layout arrays in `12-statement-builders.js` are **form templates, not
  data**. Leave them in code — a bad database row there produces malformed
  statutory paperwork with no diff and no review.

## Deploy checklist

- Set all four env vars in Vercel (`.env.local` is local only)
- Vercel → Functions region **Mumbai (`bom1`)** — users are in Tamil Nadu, and
  the default `iad1` round-trips every request through Virginia
- Run any new migration against the live database as an explicit step
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
