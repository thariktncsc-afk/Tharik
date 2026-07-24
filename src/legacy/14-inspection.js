/* Inspection adjustments + remittance notes
   Verbatim from TNCSC_CRS_Demo_19 (1).html lines 8228-8318.
   These parts are concatenated back into one classic script by
   tools/bundle-engine.mjs - the code hoists across the whole block and
   its declarations must stay global for the markup's inline handlers. */
function inspRefreshEntryScreens(crsId, date){
  try{ rebuildMonthlyForDate(crsId, date); }catch(e){}
  try{ if(typeof onEntryChange === 'function') onEntryChange(); }catch(e){}
  try{
    var meCrs = document.getElementById('me-crs');
    if(meCrs && meCrs.value && String(meCrs.value) === String(crsId)){
      var p  = String(date).split('-');
      var mm = parseInt(p[1],10), yy = parseInt(p[0],10);
      if(parseInt(document.getElementById('me-month').value,10) === mm &&
         parseInt(document.getElementById('me-year').value,10)  === yy &&
         typeof onMonthlyChange === 'function'){ onMonthlyChange(); }
    }
  }catch(e){}
  try{ if(typeof stmtRenderModuleStatus === 'function') stmtRenderModuleStatus(); }catch(e){}
}

// ── Save inspection data to inspectionStore ─────────────────────────────────
function saveInspectionData(crsId, date){
  var content = document.getElementById('fsv-content');
  if(!content) return;
  var inputs = content.querySelectorAll('input[data-id]');
  var inspKey = crsId + '_' + date;
  if(typeof inspectionStore === 'undefined') window.inspectionStore = {};
  if(!inspectionStore[inspKey]) inspectionStore[inspKey] = {a:{}, b:{}};

  inputs.forEach(function(inp){
    var id    = inp.dataset.id;
    var sec   = inp.dataset.sec;
    var field = inp.dataset.field;
    var val   = parseFloat(inp.value) || 0;
    if(!inspectionStore[inspKey][sec]) inspectionStore[inspKey][sec] = {};
    if(!inspectionStore[inspKey][sec][id]) inspectionStore[inspKey][sec][id] = {};
    inspectionStore[inspKey][sec][id][field] = val;
  });

  // Show success message
  var msg = document.getElementById('insp-save-msg');
  if(msg){ msg.textContent = '✓ Saved! Daily Entry now shows updated badges.'; }

  // Re-render the daily entry if we're on that page
  setTimeout(function(){
    inspRefreshEntryScreens(crsId, date);
    if(msg) msg.textContent = '';
  }, 1500);
}


// ── Remittance helpers ────────────────────────────────────────────────────────
function entryShowRemitNote(){
  var crsId   = document.getElementById('entry-crs').value;
  var entDate = document.getElementById('entry-date').value;
  var remDate = document.getElementById('entry-remit-date').value;
  var noteEl  = document.getElementById('entry-remit-note');
  if(!noteEl || !remDate || !crsId) return;

  // Check how many other dates share this remittance date
  var others = [];
  Object.keys(entryStore).forEach(function(k){
    if(k.startsWith(crsId + '_')){
      var e = entryStore[k];
      if(e && e.remitDate === remDate){
        var d = k.replace(crsId+'_','');
        if(d !== entDate) others.push(d);
      }
    }
  });
  if(others.length > 0){
    noteEl.innerHTML = '&#9432; Same remit date used for: ' + others.join(', ') +
      ' <span style="color:#6B7A8F">(multiple days → single deposit is allowed)</span>';
    noteEl.style.color = '#7C3AED';
  } else {
    noteEl.textContent = '';
  }
}

function entryUpdateRemitDiff(){
  var grandEl  = document.getElementById('ef-sum-grand');
  var remitEl  = document.getElementById('entry-remit-amount');
  var diffEl   = document.getElementById('entry-remit-diff');
  if(!grandEl || !remitEl || !diffEl) return;
  var grand  = parseFloat((grandEl.textContent||'').replace(/[^\d.]/g,'')) || 0;
  var remit  = parseFloat(remitEl.value) || 0;
  if(!remit){ diffEl.textContent = ''; return; }
  var diff = remit - grand;
  if(Math.abs(diff) < 0.001){ diffEl.textContent = '\u2713 Matches sales total'; diffEl.style.color='#16A34A'; }
  else if(diff > 0){ diffEl.innerHTML = '\u25b2 +\u20b9' + diff.toFixed(2) + ' above sales total'; diffEl.style.color='#D97706'; }
  else { diffEl.innerHTML = '\u25bc \u20b9' + Math.abs(diff).toFixed(2) + ' below sales total'; diffEl.style.color='#DC2626'; }
}


// ─── MONTHLY REMITTANCE TABLE ──────────────────────────────────────────────────
