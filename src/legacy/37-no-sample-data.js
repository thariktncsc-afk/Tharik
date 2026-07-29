/* Sample data removed  [+]
   Added after the port; listed in NEW_ENGINE in tools/verify-parity.mjs.

   The demo figures are removed here rather than deleted from the files that
   declare them, because those files are ported. 08-dashboard.js carries two
   fabricated receipts, and pageEntry / pageMonthly / pageStatement each carry a
   "Sample Data" button — editing any of them would break the byte-for-byte
   parity check, which is the project's evidence that the port is faithful.
   Neutralising them from a file the check already excludes keeps both
   properties: no invented figures at runtime, no damage to the guarantee.

   What this removes:
     - the two demo receipts R/2026/001 and R/2026/002 (CRS 9, July 2026)
     - the four sample-data loaders, including from the browser console
     - the three "Sample Data" buttons

   Note this runs at load, before sign-in. Real receipts come from the database
   during hydration, which happens afterwards, so clearing the array here cannot
   discard anything real — there is nothing real in it yet. */

(function(){
  if(typeof window === 'undefined') return;

  // ── 1. Drop the fabricated receipts ───────────────────────────────────────
  // In place, because other files hold a reference to this array.
  try{
    if(typeof receiptStore !== 'undefined' && Array.isArray(receiptStore)){
      receiptStore.length = 0;
    }
    // Ids restart at 1 so the first real receipt is not numbered 3.
    if(typeof rpNextId !== 'undefined') rpNextId = 1;
  }catch(e){ /* 08-dashboard.js not loaded */ }

  // ── 2. Neutralise the seeders ─────────────────────────────────────────────
  // Replaced rather than merely unbound, so calling one from the console does
  // nothing instead of throwing — and says why.
  var SEEDERS = ['sdSeedAllModules', 'loadSampleData', 'meLoadSampleData', 'stmtLoadSampleData'];
  var refuse = function(name){
    return function(){
      try{ console.warn('[sample-data] ' + name + ' is disabled — this build carries real data only.'); }catch(e){}
      if(typeof alert === 'function'){
        alert('Sample data is disabled. This system holds real records only.');
      }
      return false;
    };
  };
  SEEDERS.forEach(function(name){
    try{ if(typeof window[name] === 'function' || typeof eval(name) === 'function') window[name] = refuse(name); }
    catch(e){ try{ window[name] = refuse(name); }catch(e2){} }
  });

  // ── 3. Take the buttons out of the DOM ────────────────────────────────────
  // Matched on their handler rather than on a label, so a renamed caption or an
  // added screen cannot quietly reintroduce one.
  function stripButtons(){
    try{
      var nodes = document.querySelectorAll('button[onclick]');
      Array.prototype.forEach.call(nodes, function(b){
        var h = b.getAttribute('onclick') || '';
        if(/loadSampleData|sdSeedAllModules/i.test(h)){
          if(b.parentNode) b.parentNode.removeChild(b);
        }
      });
      var byId = document.getElementById('btn-sample');
      if(byId && byId.parentNode) byId.parentNode.removeChild(byId);
    }catch(e){}
  }

  if(document.readyState === 'loading'){
    document.addEventListener('DOMContentLoaded', stripButtons);
  }else{
    stripButtons();
  }
  // The engine rebuilds screens after a restore or a page switch, so sweep again
  // once the first paint has settled.
  setTimeout(stripButtons, 0);
  setTimeout(stripButtons, 1500);
})();
