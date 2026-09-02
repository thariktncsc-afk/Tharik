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

1. `node tools/dump-golden-stores.mjs` — dumps every store + the users roster
   to `public/golden-stores.json` (contains live data, gitignored).
2. Open the app in a browser on the dev server (login screen is enough) and run
   the harness snippet below in the console. It fills the engine's globals via
   `crsPersistWrite`, renders every shop × section through `stmtGetData` +
   `buildSectionHTML`, and POSTs the results to the dev-only `/api/golden`
   route, which writes the files here.

```js
(async function(){
  const dump = await fetch('/golden-stores.json').then(r=>r.json());
  for(const [k,v] of Object.entries(dump.stores)){ try{ crsPersistWrite(k,v); }catch(e){} }
  userStore.length = 0; dump.userStore.forEach(u=>userStore.push(u));
  const SHOPS=[1,5,7,8,9,10,11,12,14,15,16,17,19,20,23,24,25,26,27,28,29,30];
  const snapshots=[];
  for(const crs of SHOPS){
    const ids=(crs===29?CRS29_SECTIONS:STMT_SECTIONS_STANDARD).map(s=>s.id);
    const d=stmtGetData(crs,6,2026);
    for(const id of ids) snapshots.push({name:'crs'+crs+'_'+id, html:buildSectionHTML(id,d)});
  }
  return (await fetch('/api/golden',{method:'POST',headers:{'Content-Type':'application/json'},
    body:JSON.stringify({snapshots})}).then(r=>r.json())).written;
})()
```

## Compare (converted code vs baseline)

Render the same sections through the converted builders and diff against
these files. Whitespace differences count — do not normalise before diffing.

Not covered here: XLSX exports (DSS export & friends download client-side).
They are baselined separately in the phase that converts them, by diffing
workbook cell values rather than bytes.
