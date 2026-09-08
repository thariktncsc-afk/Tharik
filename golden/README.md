# Golden statement snapshots — conversion safety net

`statements/` holds the HTML of **every statement section for every shop for
June 2026**, rendered by the legacy engine (`public/js/tncsc-engine.js`) from
the live database. 306 files: 21 standard shops × 14 sections + CRS 29
(Refugee Camp) × its own 12-section family.

These are the regression baseline for the Next.js conversion (branch
`next-conversion`): the converted statement code must reproduce each file
**byte-for-byte**. Any diff is a conversion bug until proven otherwise —
these are statutory documents; "close enough" is not a pass.

## Regenerate (against the current engine)

**These files are a frozen baseline — captured from the legacy engine, and not
meant to be regenerated.** Their whole value is that they predate the
conversion: re-rendering them through today's code would only prove the code
agrees with itself. Treat a diff as a bug in the code, never as a stale
snapshot.

The original capture ran the browser engine (`public/js/tncsc-engine.js`) from
the console of the legacy page at `/`. Both were removed when the legacy UI was
retired, so that procedure no longer exists. If the baseline ever genuinely has
to be extended — a new month, a new shop — render the new sections through
`src/generated/statements-legacy.js`, which `verify-statements` proves
byte-identical to the engine that produced everything here, and say so in the
commit.

## Compare (the check that runs today)

```
node tools/dump-golden-stores.mjs     # refresh public/golden-stores.json (live data, gitignored)
npm run build:stmt                    # regenerate the module from src/legacy
npm run verify:statements             # render every shop × section, diff against these files
```

Whitespace differences count — nothing is normalised before diffing. Expect
`306 byte-identical, 0 failing`.

Not covered here: XLSX exports (DSS export & friends download client-side).
They are baselined separately in the phase that converts them, by diffing
workbook cell values rather than bytes.
