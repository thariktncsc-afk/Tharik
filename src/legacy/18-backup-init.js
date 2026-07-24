/* Backup export/import + application bootstrap
   Verbatim from TNCSC_CRS_Demo_19 (1).html lines 9829-10073.
   These parts are concatenated back into one classic script by
   tools/bundle-engine.mjs - the code hoists across the whole block and
   its declarations must stay global for the markup's inline handlers. */
var BACKUP_FORMAT  = 'TNCSC_CRS_BACKUP';
var BACKUP_VERSION = 1;

// Registry of everything worth persisting. `kind` tells the importer what an
// empty value should look like when a key is missing from an older file.
var BACKUP_STORES = [
  {key:'entryStore',       kind:'object', label:'Daily Entry'},
  {key:'inspectionStore',  kind:'object', label:'Inspection'},
  {key:'monthlyStore',     kind:'object', label:'Monthly Entry'},
  {key:'meManualStore',    kind:'object', label:'Monthly manual overrides'},
  {key:'meSourceStore',    kind:'object', label:'Monthly source flags'},
  {key:'meRemitStore',     kind:'object', label:'Remittance'},
  {key:'meGunnyStore',     kind:'object', label:'Gunny Stock'},
  {key:'meCardStore',      kind:'object', label:'Card Details'},
  {key:'salesCloseStore',  kind:'object', label:'Sales Close'},
  {key:'receiptStore',     kind:'array',  label:'Receipts'},
  {key:'userStore',        kind:'array',  label:'Users'}
];

// Counters that must travel with the data or new rows collide with old ids.
var BACKUP_COUNTERS = ['rpNextId', 'muNextId', 'muEditId'];

function backupCollect(){
  var data = {};
  BACKUP_STORES.forEach(function(st){
    try{
      var v = window[st.key];
      data[st.key] = (v === undefined || v === null) ? (st.kind === 'array' ? [] : {}) : v;
    }catch(e){ data[st.key] = (st.kind === 'array' ? [] : {}); }
  });
  var counters = {};
  BACKUP_COUNTERS.forEach(function(k){
    try{ if(window[k] !== undefined) counters[k] = window[k]; }catch(e){}
  });
  return {
    format:   BACKUP_FORMAT,
    version:  BACKUP_VERSION,
    savedAt:  new Date().toISOString(),
    savedBy:  (typeof currentUser !== 'undefined' && currentUser)
                ? {username:currentUser.username, role:currentUser.role, crsId:currentUser.crsId}
                : null,
    config:   (typeof APP_CONFIG   !== 'undefined') ? APP_CONFIG   : null,
    accounts: (typeof CRS_ACCOUNTS !== 'undefined') ? CRS_ACCOUNTS : null,
    counters: counters,
    data:     data
  };
}

// Rough "how much is in here" line for the confirm dialog and the status text.
function backupSummary(payload){
  var d = (payload && payload.data) || {};
  var parts = [];
  BACKUP_STORES.forEach(function(st){
    var v = d[st.key];
    var n = Array.isArray(v) ? v.length : (v && typeof v === 'object' ? Object.keys(v).length : 0);
    if(n) parts.push(n + ' \u00d7 ' + st.label);
  });
  return parts.length ? parts.join(', ') : 'no records';
}

function backupFilename(){
  var n = new Date();
  var p = function(x){ return String(x).padStart(2,'0'); };
  return 'TNCSC_CRS_backup_' + n.getFullYear() + p(n.getMonth()+1) + p(n.getDate()) +
         '_' + p(n.getHours()) + p(n.getMinutes()) + '.json';
}

// ── EXPORT ───────────────────────────────────────────────────────────────────
function exportBackup(){
  var json;
  try{
    json = JSON.stringify(backupCollect(), null, 2);
  }catch(e){
    backupStatus('Could not build the backup: ' + e.message, 'error');
    return;
  }
  var name = backupFilename();
  try{
    var blob = new Blob([json], {type:'application/json'});
    var url  = URL.createObjectURL(blob);
    var a    = document.createElement('a');
    a.href = url; a.download = name;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    setTimeout(function(){ URL.revokeObjectURL(url); }, 1000);
    backupStatus('Backup downloaded as ' + name + ' \u2014 ' + backupSummary(JSON.parse(json)), 'ok');
  }catch(e){
    // Sandboxed frames can refuse the download. Fall back to copy-and-paste so
    // the operator is never stuck with no way to get the data out.
    backupShowRaw(json, name);
  }
}

// Fallback: dump the JSON into a selectable textarea.
function backupShowRaw(json, name){
  var box = document.getElementById('backup-raw-wrap');
  if(!box) return;
  box.style.display = 'block';
  var ta = document.getElementById('backup-raw');
  if(ta){ ta.value = json; ta.focus(); ta.select(); }
  backupStatus('Download was blocked here \u2014 copy the text below into a file named ' +
               name + ' instead.', 'warn');
}

function backupCopyRaw(){
  var ta = document.getElementById('backup-raw');
  if(!ta) return;
  ta.select();
  var done = false;
  try{ done = document.execCommand('copy'); }catch(e){}
  backupStatus(done ? 'Backup JSON copied to the clipboard.'
                    : 'Could not copy automatically \u2014 select the text and copy it manually.',
               done ? 'ok' : 'warn');
}

// ── IMPORT ───────────────────────────────────────────────────────────────────
function importBackupFile(input){
  var file = input && input.files && input.files[0];
  if(!file) return;
  var reader = new FileReader();
  reader.onerror = function(){
    backupStatus('Could not read ' + file.name + '.', 'error');
    input.value = '';
  };
  reader.onload = function(){
    try{
      applyBackup(JSON.parse(String(reader.result)), file.name);
    }catch(e){
      backupStatus('That file is not valid backup JSON (' + e.message + ').', 'error');
    }
    input.value = '';   // let the same file be picked again
  };
  reader.readAsText(file);
}

function importBackupText(){
  var ta = document.getElementById('backup-raw');
  if(!ta || !ta.value.trim()){
    backupStatus('Paste backup JSON into the box first.', 'warn');
    return;
  }
  try{
    applyBackup(JSON.parse(ta.value), 'pasted text');
  }catch(e){
    backupStatus('That is not valid backup JSON (' + e.message + ').', 'error');
  }
}

function applyBackup(payload, sourceName){
  if(!payload || typeof payload !== 'object' || !payload.data){
    backupStatus('That file does not look like a CRS backup.', 'error');
    return;
  }
  if(payload.format && payload.format !== BACKUP_FORMAT){
    backupStatus('Unrecognised backup format "' + payload.format + '".', 'error');
    return;
  }
  if(payload.version > BACKUP_VERSION){
    backupStatus('This backup was written by a newer version (v' + payload.version +
                 '). Update the app before restoring it.', 'error');
    return;
  }

  var when = payload.savedAt ? new Date(payload.savedAt).toLocaleString('en-IN') : 'an unknown date';
  if(!confirm('Restore from ' + sourceName + '?\n\n' +
              'Saved: ' + when + '\n' +
              'Contains: ' + backupSummary(payload) + '\n\n' +
              'This REPLACES all data currently in the app. Export a backup first if ' +
              'you want to keep it.\n\nRestore now?')){
    backupStatus('Restore cancelled \u2014 nothing was changed.', 'warn');
    return;
  }

  var restored = 0, skipped = [];
  BACKUP_STORES.forEach(function(st){
    var v = payload.data[st.key];
    if(v === undefined || v === null){ skipped.push(st.label); return; }
    var okShape = (st.kind === 'array') ? Array.isArray(v) : (typeof v === 'object' && !Array.isArray(v));
    if(!okShape){ skipped.push(st.label + ' (wrong shape)'); return; }
    try{ window[st.key] = v; restored++; }catch(e){ skipped.push(st.label); }
  });

  if(payload.counters){
    BACKUP_COUNTERS.forEach(function(k){
      if(payload.counters[k] !== undefined){ try{ window[k] = payload.counters[k]; }catch(e){} }
    });
  }
  if(payload.config   && typeof APP_CONFIG   !== 'undefined'){
    Object.keys(payload.config).forEach(function(k){ APP_CONFIG[k] = payload.config[k]; });
  }
  if(payload.accounts && typeof CRS_ACCOUNTS !== 'undefined'){
    try{ CRS_ACCOUNTS = payload.accounts; }catch(e){}
  }

  backupRefreshUI();

  var msg = 'Restored ' + restored + ' module(s) from ' + sourceName + '.';
  if(skipped.length) msg += ' Not in the file: ' + skipped.join(', ') + '.';
  backupStatus(msg, 'ok');
}

// Repaint whatever is on screen so restored data is visible immediately.
function backupRefreshUI(){
  var calls = ['buildCrsTable','renderUsersTable','buildDashboard','initReceiptPage',
               'renderReceiptLog','onEntryChange','onMonthlyChange','initStmtPage',
               'stmtRenderModuleStatus','entryUpdateSalesCloseBadge'];
  calls.forEach(function(fn){
    try{ if(typeof window[fn] === 'function') window[fn](); }catch(e){ /* page not open */ }
  });
}

// ── STATUS LINE ──────────────────────────────────────────────────────────────
function backupStatus(msg, tone){
  var el = document.getElementById('backup-status');
  if(!el){ console.log('[backup] ' + msg); return; }
  var colors = {ok:'#166534', warn:'#92400E', error:'#B91C1C'};
  var backs  = {ok:'#F0FDF4', warn:'#FFFBEB', error:'#FEF2F2'};
  var borders= {ok:'#86EFAC', warn:'#FDE047', error:'#FCA5A5'};
  tone = tone || 'ok';
  el.style.display    = 'block';
  el.style.color      = colors[tone];
  el.style.background = backs[tone];
  el.style.border     = '1px solid ' + borders[tone];
  el.textContent      = msg;
}

// ── DATA-LOSS GUARD ──────────────────────────────────────────────────────────
// Nothing is persisted, so warn before a reload throws the month away.
window.addEventListener('beforeunload', function(e){
  var dirty = false;
  try{
    dirty = (typeof entryStore   !== 'undefined' && Object.keys(entryStore).length   > 0) ||
            (typeof monthlyStore !== 'undefined' && Object.keys(monthlyStore).length > 0);
  }catch(err){}
  if(dirty){ e.preventDefault(); e.returnValue = ''; return ''; }
});

// ── DATE ──────────────────────────────────────────────
var curDateEl=document.getElementById('cur-date');
if(curDateEl) curDateEl.textContent=new Date().toLocaleDateString('en-IN',{day:'2-digit',month:'short',year:'numeric'});

// ── INIT ──────────────────────────────────────────────
buildCrsTable();
// Dashboard built via showPage on first navigation
