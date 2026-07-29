/* Supabase persistence — added after the port, not part of the original file.
   Listed in NEW_ENGINE in tools/verify-parity.mjs so the parity check ignores it.

   The engine's data model is untouched. This file only moves the same stores
   the Backup screen already exports (BACKUP_STORES, src/legacy/18-backup-init.js)
   to and from the server, so nothing in the statement, calculation or print code
   has to know a database exists.

   Flow:
     sign in  -> POST /api/session (cookie) -> GET  /api/state -> fill the stores
     changes  -> dirty check every few seconds -> POST /api/state (changed only)
     sign out -> flush, then DELETE /api/session

   Saves send only the stores whose JSON actually changed, each with the version
   it was read at. The server rejects a stale version instead of overwriting, so
   two shops saving at once cannot silently clobber each other. */

var CRS_PERSIST = {
  enabled:  false,   // true once a session cookie exists
  loading:  false,
  saving:   false,
  timer:    null,
  versions: {},      // store_key -> version last seen from the server
  snapshot: {},      // store_key -> JSON string last known to be on the server
  pollMs:   5000,
  lastError: null
};

// Pseudo-stores: everything the database owns that BACKUP_STORES does not list.
// The masters (__shops … __holidays) used to exist only as literals in the
// engine sources. They are seeded from those literals once, on the first run
// against an empty database, and after that the database is authoritative —
// editing a shop or a holiday has to survive a reload, which a const array in
// 01-core.js cannot do.
var CRS_PERSIST_EXTRA = [
  '__counters', '__config', '__accounts',
  '__shops', '__commodities', '__crsMaster', '__holidays'
];

// Masters. `get` returns the live binding.
//
// It has to be a function referencing the identifier directly, not a
// window[name] lookup: CRS_SHOPS and COMMODITIES are declared `const`, and
// const/let at the top level of a classic script live in the global lexical
// environment — they never become properties of window. Reading them off window
// silently yielded undefined, so both masters were skipped on save.
var CRS_PERSIST_MASTERS = [
  {key:'__shops',       kind:'array',  get:function(){ return typeof CRS_SHOPS        !== 'undefined' ? CRS_SHOPS        : null; }},
  {key:'__commodities', kind:'array',  get:function(){ return typeof COMMODITIES      !== 'undefined' ? COMMODITIES      : null; }},
  {key:'__crsMaster',   kind:'array',  get:function(){ return typeof CRS_MASTER       !== 'undefined' ? CRS_MASTER       : null; }},
  {key:'__holidays',    kind:'object', get:function(){ return typeof TN_GOVT_HOLIDAYS !== 'undefined' ? TN_GOVT_HOLIDAYS : null; }}
];

function crsPersistMaster(key){
  for(var i=0; i<CRS_PERSIST_MASTERS.length; i++){
    if(CRS_PERSIST_MASTERS[i].key === key) return CRS_PERSIST_MASTERS[i];
  }
  return null;
}

function crsPersistKeys(){
  var keys = [];
  try{
    BACKUP_STORES.forEach(function(st){ keys.push(st.key); });
  }catch(e){ /* 18-backup-init.js not loaded */ }
  return keys.concat(CRS_PERSIST_EXTRA);
}

// CRS_SHOPS and COMMODITIES are `const`, so they cannot be reassigned — but the
// arrays themselves are mutable, and other files hold references to them. Fill
// in place so every existing reference sees the database's values.
function crsPersistFillArray(target, next){
  if(!Array.isArray(target) || !Array.isArray(next)) return false;
  target.length = 0;
  for(var i=0; i<next.length; i++) target.push(next[i]);
  return true;
}

function crsPersistFillObject(target, next){
  if(!target || typeof target !== 'object' || !next || typeof next !== 'object') return false;
  Object.keys(target).forEach(function(k){ delete target[k]; });
  Object.keys(next).forEach(function(k){ target[k] = next[k]; });
  return true;
}

// Current value of one store / pseudo-store, ready to serialise.
function crsPersistRead(key){
  if(key === '__counters'){
    var c = {};
    try{
      BACKUP_COUNTERS.forEach(function(k){
        if(window[k] !== undefined) c[k] = window[k];
      });
    }catch(e){}
    return c;
  }
  if(key === '__config'){
    return (typeof APP_CONFIG   !== 'undefined' && APP_CONFIG)   ? APP_CONFIG   : {};
  }
  if(key === '__accounts'){
    return (typeof CRS_ACCOUNTS !== 'undefined' && CRS_ACCOUNTS) ? CRS_ACCOUNTS : {};
  }

  var m = crsPersistMaster(key);
  if(m){
    try{
      var cur = m.get();
      return (cur === undefined || cur === null) ? null : cur;
    }catch(e){ return null; }
  }

  try{
    var v = window[key];
    return (v === undefined || v === null) ? null : v;
  }catch(e){ return null; }
}

// Put a value back. Mirrors applyBackup()'s shape checks so a malformed row
// cannot replace a good store with something the engine will choke on.
function crsPersistWrite(key, value){
  if(value === undefined || value === null) return false;

  if(key === '__counters'){
    try{
      BACKUP_COUNTERS.forEach(function(k){
        if(value[k] !== undefined){ try{ window[k] = value[k]; }catch(e){} }
      });
    }catch(e){}
    return true;
  }
  if(key === '__config'){
    if(typeof APP_CONFIG === 'undefined') return false;
    Object.keys(value).forEach(function(k){ APP_CONFIG[k] = value[k]; });
    return true;
  }
  if(key === '__accounts'){
    if(typeof CRS_ACCOUNTS === 'undefined') return false;
    try{ CRS_ACCOUNTS = value; }catch(e){}
    return true;
  }

  var m = crsPersistMaster(key);
  if(m){
    var target;
    try{ target = m.get(); }catch(e){ return false; }
    if(target === undefined || target === null) return false;
    return (m.kind === 'array')
      ? crsPersistFillArray(target, value)
      : crsPersistFillObject(target, value);
  }

  var st = null;
  try{
    BACKUP_STORES.forEach(function(s){ if(s.key === key) st = s; });
  }catch(e){}
  if(st){
    var okShape = (st.kind === 'array')
      ? Array.isArray(value)
      : (typeof value === 'object' && !Array.isArray(value));
    if(!okShape) return false;
  }
  try{ window[key] = value; return true; }catch(e){ return false; }
}

function crsPersistStatus(msg, tone){
  CRS_PERSIST.lastError = (tone === 'error') ? msg : null;
  var el = document.getElementById('persist-status');
  if(el){
    el.textContent = msg;
    el.className = 'persist-status persist-' + (tone || 'ok');
  }
  if(tone === 'error') try{ console.warn('[persistence] ' + msg); }catch(e){}
}

// ── SESSION ─────────────────────────────────────────────────────────────────
// doLogin() has already validated the credentials in the browser. The server
// re-checks them because a browser-side check cannot protect an API.
function crsPersistSignIn(username, password){
  return fetch('/api/session', {
    method:  'POST',
    headers: {'Content-Type':'application/json'},
    body:    JSON.stringify({username:username, password:password})
  }).then(function(r){
    if(r.ok) return r.json();
    // Keep the status on the error. "Could not reach the server" for a 401 sends
    // people to check the database when the real answer is the password.
    return r.json().catch(function(){ return {}; }).then(function(b){
      var err = new Error((b && b.error) || ('server returned ' + r.status));
      err.status = r.status;
      throw err;
    });
  });
}

// Turn a sign-in failure into something that names the actual problem.
function crsPersistSignInMessage(err){
  var s = err && err.status;
  if(s === 401) return 'Incorrect username or password.';
  if(s === 503) return 'The database is not set up or not reachable — ' + err.message;
  if(s)         return 'Sign-in failed (' + s + ') — ' + err.message;
  return 'Could not reach the server — ' + (err && err.message ? err.message : 'network error') +
         '. Sign-in needs the database; nothing is stored on this machine.';
}

function crsPersistSignOut(){
  CRS_PERSIST.enabled = false;
  crsPersistStop();
  try{ fetch('/api/session', {method:'DELETE', keepalive:true}); }catch(e){}
  CRS_PERSIST.versions = {};
  CRS_PERSIST.snapshot = {};
}

// ── LOAD ────────────────────────────────────────────────────────────────────
// opts.strict — reject instead of degrading. Used by sign-in, where carrying on
// without the database would mean working from the engine's built-in literals.
function crsPersistLoad(opts){
  var strict = !!(opts && opts.strict);
  if(CRS_PERSIST.loading) return Promise.resolve(false);
  CRS_PERSIST.loading = true;
  crsPersistStatus('Loading saved data…', 'busy');

  return fetch('/api/state', {headers:{'Accept':'application/json'}})
    .then(function(r){
      if(!r.ok) throw new Error('server returned ' + r.status);
      return r.json();
    })
    .then(function(payload){
      var stores   = (payload && payload.stores)   || {};
      var versions = (payload && payload.versions) || {};
      var loaded   = 0;

      crsPersistKeys().forEach(function(key){
        if(!(key in stores)) return;
        if(crsPersistWrite(key, stores[key])) loaded++;
        CRS_PERSIST.versions[key] = versions[key];
      });

      // Only what actually came back counts as "the server has this". Snapshotting
      // every key here would mark the engine's built-in literals as already
      // stored, and an empty database would then never receive its first write.
      crsPersistKeys().forEach(function(key){
        if(key in stores) CRS_PERSIST.snapshot[key] = crsPersistSerialise(key);
        else delete CRS_PERSIST.snapshot[key];
      });

      if(typeof backupRefreshUI === 'function'){
        try{ backupRefreshUI(); }catch(e){}
      }
      crsPersistStatus(loaded ? ('Loaded ' + loaded + ' module(s).') : 'No saved data yet.', 'ok');
      return true;
    })
    .catch(function(err){
      CRS_PERSIST.loading = false;
      crsPersistStatus('Could not load saved data — ' + err.message, 'error');
      if(strict) throw err;
      return false;
    })
    .then(function(res){ CRS_PERSIST.loading = false; return res; });
}

// First run against an empty database: the masters exist only as literals in
// the engine sources, so push them up once. From then on the database owns them
// and this is a no-op, because the rows will come back on the next load.
function crsPersistSeedMasters(){
  var missing = [];
  CRS_PERSIST_MASTERS.forEach(function(m){
    if(CRS_PERSIST.versions[m.key] === undefined) missing.push(m.key);
  });
  if(!missing.length) return Promise.resolve(false);

  crsPersistStatus('Seeding ' + missing.length + ' master table(s) into the database…', 'busy');
  return crsPersistSave();
}

function crsPersistSerialise(key){
  try{ return JSON.stringify(crsPersistRead(key)); }catch(e){ return null; }
}

// ── SAVE ────────────────────────────────────────────────────────────────────
// Only stores whose serialised form differs from what the server last confirmed.
function crsPersistCollectChanged(){
  var stores = {}, versions = {}, any = false;
  crsPersistKeys().forEach(function(key){
    var json = crsPersistSerialise(key);
    if(json === null || json === undefined) return;
    if(json === CRS_PERSIST.snapshot[key]) return;
    try{ stores[key] = JSON.parse(json); }catch(e){ return; }
    versions[key] = CRS_PERSIST.versions[key] || 0;
    any = true;
  });
  return any ? {stores:stores, versions:versions} : null;
}

function crsPersistSave(opts){
  if(!CRS_PERSIST.enabled || CRS_PERSIST.saving) return Promise.resolve(false);

  var payload = crsPersistCollectChanged();
  if(!payload) return Promise.resolve(false);

  CRS_PERSIST.saving = true;
  var sentKeys = Object.keys(payload.stores);

  return fetch('/api/state', {
    method:    'POST',
    headers:   {'Content-Type':'application/json'},
    body:      JSON.stringify(payload),
    keepalive: !!(opts && opts.keepalive)
  })
    .then(function(r){
      return r.json().catch(function(){ return {}; }).then(function(b){
        return {status:r.status, body:b};
      });
    })
    .then(function(res){
      if(res.status === 409){
        // Someone else wrote first. Their data is authoritative; reload and let
        // the next tick re-send whatever of ours is still genuinely different.
        crsPersistStatus('Another user saved first — reloading to merge…', 'warn');
        CRS_PERSIST.saving = false;
        return crsPersistLoad().then(function(){ return false; });
      }
      if(res.status !== 200){
        throw new Error((res.body && res.body.error) || ('server returned ' + res.status));
      }

      var vs = res.body.versions || {};
      sentKeys.forEach(function(key){
        if(vs[key] !== undefined) CRS_PERSIST.versions[key] = vs[key];
        CRS_PERSIST.snapshot[key] = JSON.stringify(payload.stores[key]);
      });
      crsPersistStatus('Saved ' + sentKeys.length + ' change(s).', 'ok');
      return true;
    })
    .catch(function(err){
      crsPersistStatus('Could not save — ' + err.message + '. Will retry.', 'error');
      return false;
    })
    .then(function(res){ CRS_PERSIST.saving = false; return res; });
}

// ── AUTOSAVE ────────────────────────────────────────────────────────────────
// A dirty check rather than hooks into each screen: the engine mutates its
// stores from dozens of places across 35 files, and a comparison here cannot
// miss one the way a hand-kept list of function names would.
function crsPersistStart(){
  crsPersistStop();
  CRS_PERSIST.timer = setInterval(function(){
    if(CRS_PERSIST.enabled) crsPersistSave();
  }, CRS_PERSIST.pollMs);
}

function crsPersistStop(){
  if(CRS_PERSIST.timer){ clearInterval(CRS_PERSIST.timer); CRS_PERSIST.timer = null; }
}

// ── HOOKS ───────────────────────────────────────────────────────────────────
// This file is bundled last, so the ported functions already exist and can be
// wrapped without editing them — 07-auth.js stays byte-for-byte identical.
(function(){
  if(typeof window === 'undefined') return;

  // Sign-in, database first.
  //
  // The order is deliberate: authenticate against the server, pull every store
  // and master down, and only then run the original doLogin(). By the time it
  // validates the credentials and builds the screens, the globals it reads hold
  // the database's data rather than the literals in the engine sources — so
  // there is no flash of built-in values and no path where the app opens on
  // local data. If the server or the database is unreachable the sign-in fails;
  // it does not fall through to working offline, because a statement built from
  // stale local figures is worse than one that could not be built at all.
  if(typeof doLogin === 'function'){
    var origLogin = doLogin;
    doLogin = function(){
      var self = this, args = arguments;
      var u = document.getElementById('login-user');
      var p = document.getElementById('login-pass');
      var username = u ? u.value.trim() : '';
      var password = p ? p.value.trim() : '';
      var btn = document.getElementById('login-submit-btn');

      // Let the engine's own empty-field and password checks answer first, so
      // an obvious typo never becomes a round trip.
      if(!username || !password) return origLogin.apply(self, args);

      if(btn){ btn.disabled = true; btn.textContent = 'Connecting…'; }

      var fail = function(msg){
        if(btn){ btn.disabled = false; btn.textContent = 'Sign In'; }
        CRS_PERSIST.enabled = false;
        if(typeof showLoginError === 'function') showLoginError(msg);
        else alert(msg);
      };

      crsPersistSignIn(username, password)
        .then(function(){
          CRS_PERSIST.enabled = true;
          return crsPersistLoad({strict:true});
        })
        .then(function(){
          if(btn){ btn.disabled = false; btn.textContent = 'Sign In'; }
          // Stores now hold the database's data — hand over to the original.
          origLogin.apply(self, args);
          if(typeof currentUser !== 'undefined' && currentUser){
            crsPersistSeedMasters();
            crsPersistStart();
          }else{
            CRS_PERSIST.enabled = false;
            crsPersistSignOut();
          }
        })
        .catch(function(err){
          fail(crsPersistSignInMessage(err));
        });
    };
  }

  if(typeof doLogout === 'function'){
    var origLogout = doLogout;
    doLogout = function(){
      try{ crsPersistSave({keepalive:true}); }catch(e){}
      crsPersistSignOut();
      return origLogout.apply(this, arguments);
    };
  }

  // Flush on the way out. keepalive lets the request outlive the page.
  window.addEventListener('visibilitychange', function(){
    if(document.visibilityState === 'hidden' && CRS_PERSIST.enabled){
      try{ crsPersistSave({keepalive:true}); }catch(e){}
    }
  });
  window.addEventListener('pagehide', function(){
    if(CRS_PERSIST.enabled){ try{ crsPersistSave({keepalive:true}); }catch(e){} }
  });
})();
