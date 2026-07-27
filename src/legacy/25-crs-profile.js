/* CRS Master as the source for staff and shop details  [+]
   Added after the port; not part of TNCSC_CRS_Demo_19 (1).html, so
   tools/verify-parity.mjs skips this file (see NEW_ENGINE there).

   The port shipped a demo user list — "Ravi" on 9876500001, "Alagarsami" on
   9876543210 — and every screen that named a shop's staff read it. The office's
   own CRS Master is the authority, so it feeds them all instead.

   There is one seam that does the work: getUsersForCRS(crsId) is the only
   accessor the engine has for a shop's Bill Clerk and Packer, and all three of
   its callers go through it —

     08-dashboard.js      the shop card
     06-users.js          buildUserSignatureBlock(), printed on statements
     11-statement-core.js the statement data object

   — so redirecting that one function moves the whole application onto the
   master. The signed-in user's own name and number are synced too, which is
   what the sidebar, the "Welcome," line and the role-chooser read.

   The demo list is not discarded: it still holds usernames, roles, passwords
   and the CRS a user belongs to, none of which the master carries. Only the
   display name and mobile are taken from the master, and only where the master
   actually has someone. */

// Staff for a shop, shaped like the userStore records the callers expect.
//
// Where the master has a record it is taken as complete: a blank packer means
// the shop HAS no packer, not that one is unknown, so nothing is filled in from
// the demo list behind it — that is how "Murugan" and the rest of the sample
// staff used to reappear on a shop the sheet leaves empty. The statement
// builders already print a ruled blank for missing staff ([M4] in 01-core.js),
// which is the honest output. The ported list is consulted only for a shop the
// master does not describe at all.
function crsMasterStaff(crsId){
  var n = parseInt(crsId, 10);
  var m = (typeof crsMaster === 'function') ? crsMaster(n) : null;

  if(!m){
    var bc = null, packer = null;
    try{
      bc     = userStore.find(function(u){ return u.crsId===n && u.role==='BC'     && u.active; }) || null;
      packer = userStore.find(function(u){ return u.crsId===n && u.role==='Packer' && u.active; }) || null;
    }catch(e){}
    return {bc: bc, packer: packer};
  }

  function person(name, phone, role){
    if(!name) return null;
    var base = null;
    try{ base = userStore.find(function(u){ return u.crsId===n && u.role===role && u.active; }) || null; }catch(e){}
    return {
      fullName: name,
      phone: phone || '',
      role: role,
      crsId: n,
      username: base ? base.username : '',
      active: true,
      fromMaster: true
    };
  }
  return {
    bc:     person(m.bc,     m.bcMobile,     'BC'),
    packer: person(m.packer, m.packerMobile, 'Packer')
  };
}

// The one accessor the rest of the engine asks for a shop's staff.
function getUsersForCRS(crsId){
  return crsMasterStaff(crsId);
}

// ── ACCOUNTS ────────────────────────────────────────────────────────────────
// Every shop login is generated from the master: one account per person it
// names, and none for a person it does not. The port shipped a fixed demo list
// that matched the sheet nowhere — a single BC for every shop, so the five
// shops that really do have a packer could never offer the role chooser, while
// CRS 9 offered it for a packer ("Murugan") the sheet does not have.
//
// Both roles of a shop share the username `crs<n>`; the role chooser is what
// separates them, which is the flow the port already implements.
var CRS_ACCOUNT_PASSWORD = 'pds123';

function crsAccountsFromMaster(){
  var out = [];
  if(typeof CRS_MASTER === 'undefined') return out;
  CRS_MASTER.forEach(function(m){
    // A shop out of use keeps its record but cannot be signed into.
    var live = m.status === 'active';
    function account(name, phone, role, offset){
      if(!name) return;                       // no such person -> no account
      out.push({
        id: 5000 + m.id * 2 + offset,
        fullName: name,
        username: 'crs' + m.id,
        phone: phone || '',
        email: '',
        role: role,
        crsId: m.id,
        password: CRS_ACCOUNT_PASSWORD,
        active: live,
        createdAt: '2026-01-01',
        fromMaster: true
      });
    }
    account(m.bc,     m.bcMobile,     'BC',     0);
    account(m.packer, m.packerMobile, 'Packer', 1);
  });
  return out;
}

// Rebuilt in place: `userStore` is reassigned by the backup importer and read
// by name everywhere else, so the array object is kept and its contents
// replaced. Accounts with no shop (the administrator) are untouched.
function crsRebuildUserStoreFromMaster(){
  if(typeof userStore === 'undefined' || typeof CRS_MASTER === 'undefined') return;
  var keep = userStore.filter(function(u){ return !u.crsId; });
  var made = crsAccountsFromMaster();
  userStore.length = 0;
  keep.concat(made).forEach(function(u){ userStore.push(u); });
  try{ if(typeof renderUsersTable === 'function') renderUsersTable(); }catch(e){}
}

// ── SHOP CARD ───────────────────────────────────────────────────────────────
// The ported buildDashboard already fills the CRS number and the two staff
// blocks (through getUsersForCRS, so they are the master's). This adds the rest
// of the record: shop name, shop code, and the COLL / police / usage flags.
function dashFillCrsMaster(){
  var wrap = document.getElementById('dash-crs-info');
  if(!wrap) return;
  var crsId = (typeof currentUser !== 'undefined' && currentUser) ? currentUser.crsId : null;
  var nameEl = document.getElementById('dash-crs-name');
  var codeEl = document.getElementById('dash-crs-code');
  var flagEl = document.getElementById('dash-crs-flags');
  if(!crsId){
    if(nameEl) nameEl.textContent = '';
    if(codeEl) codeEl.textContent = '';
    if(flagEl) flagEl.innerHTML = '';
    return;
  }

  var m = (typeof crsMaster === 'function') ? crsMaster(crsId) : null;
  if(nameEl) nameEl.textContent = (typeof crsMasterName === 'function') ? crsMasterName(crsId) : '';
  if(codeEl) codeEl.textContent = (m && m.code) ? m.code : '';

  if(flagEl){
    function chip(text, bg, fg){
      return '<span style="background:' + bg + ';color:' + fg + ';font-size:10px;font-weight:800;' +
             'padding:3px 9px;border-radius:20px;letter-spacing:.03em">' + text + '</span>';
    }
    var chips = '';
    if(m){
      chips += m.coll   ? chip('COLL statement', 'rgba(255,255,255,.9)', '#0369A1')
                        : chip('No COLL', 'rgba(255,255,255,.16)', '#E0F2FE');
      chips += m.police ? chip('Had Police', 'rgba(255,255,255,.9)', '#6D28D9')
                        : chip('No Police', 'rgba(255,255,255,.16)', '#E0F2FE');
      chips += (m.status === 'active') ? chip('Active', '#DCFCE7', '#15803D')
                                       : chip('No Usage', '#FEF3C7', '#92400E');
    }
    flagEl.innerHTML = chips;
  }
}

var _profileOrigBuildDashboard = buildDashboard;
buildDashboard = function(){
  var r = _profileOrigBuildDashboard.apply(this, arguments);
  try{ dashFillCrsMaster(); }catch(e){}
  return r;
};

// The accounts already carry the master's names, so this only has to catch a
// user object that came from somewhere else — a backup written before the
// accounts were generated, say — before the ported enterApp paints the sidebar
// and the welcome line with it.
var _profileOrigEnterApp = enterApp;
enterApp = function(user){
  try{
    if(user && user.crsId && typeof crsMaster === 'function'){
      var m = crsMaster(user.crsId);
      if(m){
        if(user.role === 'BC' && m.bc){ user.fullName = m.bc; if(m.bcMobile) user.phone = m.bcMobile; }
        if(user.role === 'Packer' && m.packer){ user.fullName = m.packer; if(m.packerMobile) user.phone = m.packerMobile; }
      }
    }
  }catch(e){}
  return _profileOrigEnterApp.apply(this, arguments);
};

// Taking a shop out of use disables its logins; bringing it back enables them.
// The card behind the master screen is repainted at the same time.
if(typeof crsMasterToggle === 'function'){
  var _profileOrigToggle = crsMasterToggle;
  crsMasterToggle = function(crsId){
    var r = _profileOrigToggle.apply(this, arguments);
    try{ crsRebuildUserStoreFromMaster(); dashFillCrsMaster(); }catch(e){}
    return r;
  };
}

// Restoring a backup replaces userStore wholesale; the accounts have to be
// regenerated afterwards or a pre-master file reinstates the demo logins.
if(typeof applyBackup === 'function'){
  var _profileOrigApplyBackup = applyBackup;
  applyBackup = function(){
    var r = _profileOrigApplyBackup.apply(this, arguments);
    try{ crsRebuildUserStoreFromMaster(); }catch(e){}
    return r;
  };
}

(function initCrsProfile(){
  try{ crsRebuildUserStoreFromMaster(); }catch(e){}
})();
