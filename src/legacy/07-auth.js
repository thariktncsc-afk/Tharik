/* Login, role selection, per-role navigation
   Verbatim from TNCSC_CRS_Demo_19 (1).html lines 4038-4388.
   These parts are concatenated back into one classic script by
   tools/bundle-engine.mjs - the code hoists across the whole block and
   its declarations must stay global for the markup's inline handlers. */
var currentUser = null; // { id, fullName, role, crsId, phone, ... }

function toggleLoginPwd(){
  var inp = document.getElementById('login-pass');
  var btn = document.getElementById('login-eye-btn');
  if(inp){ inp.type = inp.type==='password' ? 'text' : 'password'; }
  if(btn){ btn.textContent = inp.type==='password' ? '👁' : '🙈'; }
}

function quickLogin(user, pass){
  var uEl = document.getElementById('login-user');
  var pEl = document.getElementById('login-pass');
  if(uEl) uEl.value = user;
  if(pEl) pEl.value = pass;
  doLogin();
}

function showLoginError(msg){
  var el = document.getElementById('login-err');
  if(el){ el.textContent = msg; el.style.display='block'; }
  var btn = document.getElementById('login-submit-btn');
  if(btn){ btn.disabled=false; btn.textContent='Sign In'; }
}

function doLogin(){
  var uRaw = (document.getElementById('login-user')?.value || '').trim();
  var p    = (document.getElementById('login-pass')?.value || '').trim();
  var errEl= document.getElementById('login-err');
  if(errEl) errEl.style.display='none';
  var btn  = document.getElementById('login-submit-btn');
  if(btn){ btn.disabled=true; btn.textContent='Signing in...'; }

  if(!uRaw || !p){
    showLoginError('Please enter your username/phone and password.');
    return;
  }
  if(p !== 'pds123'){
    showLoginError('Incorrect Password');
    return;
  }

  var u = uRaw.toLowerCase();

  // ── ADMIN: phone number login ──────────────────────────────────────────
  var adminUser = userStore.find(function(usr){
    return usr.role==='ADMIN' && (usr.phone===uRaw || usr.username===u);
  });
  if(adminUser){
    if(btn){ btn.disabled=false; btn.textContent='Sign In'; }
    try{ enterApp(adminUser); } catch(ex){ console.error('enterApp error:',ex); showLoginError('Login error: '+ex.message); }
    return;
  }

  // ── CRS USER: "Crs1".."Crs30" / "crs1".."crs30" login ──────────────────
  // Only the leading C is case-insensitive; "rs" must stay lowercase, so
  // CRS1 / CRs1 / CrS1 / cRs1 / crS1 are all rejected as bad usernames.
  var crsMatch = uRaw.match(/^[Cc]rs(\d+)$/);
  if(!crsMatch){
    showLoginError('Incorrect Username');
    return;
  }
  var crsId = parseInt(crsMatch[1]);
  if(crsId < 1 || crsId > 30){
    showLoginError('CRS number must be between 1 and 30.');
    return;
  }

  // Find all active users for this CRS
  var crsUsers = userStore.filter(function(usr){
    return usr.crsId === crsId && usr.active;
  });

  if(!crsUsers.length){
    showLoginError('No staff registered for CRS ' + crsId + '. Contact your administrator.');
    return;
  }

  if(crsUsers.length === 1){
    // Only one staff — log in directly
    if(btn){ btn.disabled=false; btn.textContent='Sign In'; }
    try{ enterApp(crsUsers[0]); } catch(ex){ console.error('enterApp error:',ex); showLoginError('Login error: '+ex.message); }
    return;
  }

  // Multiple staff (BC + Packer) — show role selection popup ON TOP of login screen
  if(btn){ btn.disabled=false; btn.textContent='Sign In'; }
  showRoleSelect(crsId, crsUsers);
}


function cancelRoleSelect(){
  // Switch back: hide role picker, show login form
  var formSec = document.getElementById('login-form-section');
  var roleSec = document.getElementById('login-role-section');
  if(roleSec) roleSec.style.display = 'none';
  if(formSec) formSec.style.display = 'block';
  // Clear inputs for fresh login
  var uEl = document.getElementById('login-user');
  var pEl = document.getElementById('login-pass');
  if(uEl) uEl.value = '';
  if(pEl) pEl.value = '';
  var btn = document.getElementById('login-submit-btn');
  if(btn){ btn.disabled=false; btn.textContent='Sign In'; }
}

function showRoleSelect(crsId, users){
  var crs = CRS_LIST.find(function(c){ return c.id===crsId; });
  // Show INLINE inside login card (works in all iframe contexts)
  var formSec = document.getElementById('login-form-section');
  var roleSec = document.getElementById('login-role-section');
  var lbl     = document.getElementById('login-role-crs-label');
  var opts    = document.getElementById('login-role-options');
  if(!roleSec || !opts) return;

  if(lbl) lbl.textContent = 'CRS ' + crsId + (crs ? ' \u2014 ' + crs.name : '');

  opts.innerHTML = users.map(function(u){
    var isBC      = u.role==='BC';
    var roleColor = isBC ? '#0369A1' : '#C2410C';
    var roleBg    = isBC ? 'rgba(14,165,233,.12)' : 'rgba(194,65,12,.08)';
    var roleIcon  = isBC ? '\uD83D\uDD8A' : '\uD83D\uDCE6';
    return '<button onclick="selectRoleAndEnter('+u.id+')"' +
      ' style="display:flex;align-items:center;gap:12px;width:100%;' +
      'border:2px solid '+roleColor+';border-radius:12px;padding:14px 16px;' +
      'background:'+roleBg+';cursor:pointer;text-align:left;transition:.15s"' +
      ' onmouseover="this.style.background=\''+roleBg.replace('12','25')+'\'"' +
      ' onmouseout="this.style.background=\''+roleBg+'\'">'+
      '<div style="font-size:22px">'+roleIcon+'</div>'+
      '<div>'+
        '<div style="font-weight:800;font-size:14px;color:'+roleColor+'">'+u.role+' \u2014 '+u.fullName+'</div>'+
        '<div style="font-size:12px;color:rgba(255,255,255,.6);margin-top:2px">'+u.phone+'</div>'+
      '</div>'+
    '</button>';
  }).join('');

  // Switch: hide form, show role picker
  if(formSec) formSec.style.display = 'none';
  roleSec.style.display = 'block';
}

function selectRoleAndEnter(userId){
  var user = userStore.find(function(u){ return u.id===userId; });
  document.getElementById('role-select-overlay').style.display='none';
  if(user) enterApp(user);
}

function enterApp(user){
  currentUser = user;

  // Update sidebar header
  var sbName = document.querySelector('.sb-uname');
  var sbRole = document.querySelector('.sb-urole');
  var sbAvatar = document.querySelector('.sb-avatar');
  if(sbName) sbName.textContent = user.fullName;
  if(sbRole) sbRole.textContent = user.role;
  if(sbAvatar) sbAvatar.textContent = user.fullName.charAt(0).toUpperCase();

  // Apply role-based nav visibility
  applyNavForRole(user);

  // Hide login
  var loginScr = document.getElementById('login-screen');
  if(loginScr) loginScr.classList.add('hidden');

  // Cancel animation if running
  if(typeof animFrame!=='undefined') cancelAnimationFrame(animFrame);

  // Show dashboard
  document.querySelectorAll('.page').forEach(function(pg){ pg.classList.remove('active'); });
  var dash = document.getElementById('page-dashboard');
  if(dash) dash.classList.add('active');
  document.querySelectorAll('.nav-item').forEach(function(n){ n.classList.remove('active'); });
  var firstNav = document.querySelector('.nav-item:not([style*="display:none"])');
  if(firstNav) firstNav.classList.add('active');

  if(typeof buildCrsTable==='function') buildCrsTable();

  // If CRS user: rebuild dropdowns to show ONLY their CRS shop
  if(user.crsId){
    // Rebuild Daily Entry CRS dropdown — only their shop
    var eCrs = document.getElementById('entry-crs');
    if(eCrs){
      eCrs.innerHTML = '<option value="">Select CRS Shop...</option>';
      var myShop = CRS_LIST.find(function(c){ return c.id===user.crsId; });
      if(myShop){
        var eOpt = document.createElement('option');
        eOpt.value = String(myShop.id);
        eOpt.textContent = 'CRS ' + myShop.id + ' — ' + myShop.name;
        eCrs.appendChild(eOpt);
      }
      eCrs.value = String(user.crsId);
    }
    // Rebuild Monthly Entry CRS dropdown — only their shop
    var mCrs = document.getElementById('me-crs');
    if(mCrs){
      mCrs.innerHTML = '<option value="">Select CRS Shop...</option>';
      if(myShop){
        var mOpt = document.createElement('option');
        mOpt.value = String(myShop.id);
        mOpt.textContent = 'CRS ' + myShop.id + ' — ' + myShop.name;
        mCrs.appendChild(mOpt);
      }
      mCrs.value = String(user.crsId);
    }
    // Pre-select CRS dropdown
    if(eCrs) eCrs.value = String(user.crsId);

    // Auto-set month/year dropdowns to current month
    var nowD = new Date();
    var moEl = document.getElementById('me-month');
    var yrEl = document.getElementById('me-year');
    if(moEl) moEl.value = String(nowD.getMonth()+1);
    if(yrEl) yrEl.value = String(nowD.getFullYear());

    // Set today's date on entry form
    var today = new Date().toISOString().split('T')[0];
    var eDateEl = document.getElementById('entry-date');
    if(eDateEl){ eDateEl.value = today; eDateEl.max = today; }

    // Pre-select CRS on monthly entry too
    var mCrs = document.getElementById('me-crs');
    if(mCrs) mCrs.value = String(user.crsId);

    // Auto-trigger entry form immediately (no click needed)
    setTimeout(function(){
      try{ if(typeof onEntryChange==='function') onEntryChange(); }catch(ex){ console.error('onEntryChange error:',ex); }
      try{ if(typeof onMonthlyChange==='function') onMonthlyChange(); }catch(ex){ console.error('onMonthlyChange error:',ex); }
    }, 0);
  }

  // Build dashboard IMMEDIATELY after login — no waiting for showPage
  try{ if(typeof buildDashboard==='function') buildDashboard(); }catch(ex){ console.error('buildDashboard error:',ex); }
}

function applyNavForRole(user){
  // ADMIN: sees everything
  // BC / Packer: sees only their relevant pages (Daily Entry, Monthly Entry, Statements)
  // Hide admin-only pages from CRS users
  var adminOnly = ['page-crs','page-commodity','page-users','page-settings','page-audit','page-reports'];
  var adminNavLabels = ['CRS Shops','Commodities','Users','Settings','Audit Logs','Reports'];

  if(user.role === 'ADMIN'){
    // Show all nav items
    document.querySelectorAll('.nav-item').forEach(function(n){ n.style.display=''; });
    var adminSec = document.querySelector('.sb-section:last-of-type');
    if(adminSec) adminSec.style.display='';
  } else {
    // Hide admin-only nav items
    document.querySelectorAll('.nav-item').forEach(function(n){
      var txt = n.textContent.trim();
      var hide = adminNavLabels.some(function(lbl){ return txt.includes(lbl); });
      n.style.display = hide ? 'none' : '';
    });
    // Hide Admin section header
    document.querySelectorAll('.sb-section').forEach(function(s){
      if(s.textContent.trim()==='Admin') s.style.display='none';
    });
  }
}

function doLogout(){
  currentUser = null;

  // ── Reset nav (show all items) ─────────────────────────────────────────
  document.querySelectorAll('.nav-item').forEach(function(n){ n.style.display=''; });
  document.querySelectorAll('.sb-section').forEach(function(s){ s.style.display=''; });

  // ── Clear credentials ──────────────────────────────────────────────────
  var uEl = document.getElementById('login-user');
  var pEl = document.getElementById('login-pass');
  if(uEl) uEl.value='';
  if(pEl) pEl.value='';
  var errEl = document.getElementById('login-err');
  if(errEl) errEl.style.display='none';

  // ── Reset role-picker: always show form, hide role section ─────────────
  var formSec = document.getElementById('login-form-section');
  var roleSec = document.getElementById('login-role-section');
  if(formSec) formSec.style.display = 'block';
  if(roleSec) roleSec.style.display = 'none';

  // ── Reset Sign In button ───────────────────────────────────────────────
  var btn = document.getElementById('login-submit-btn');
  if(btn){ btn.disabled=false; btn.textContent='Sign In'; }

  // ── Reset sidebar name/role/avatar to defaults ─────────────────────────
  var sbName   = document.querySelector('.sb-uname');
  var sbRole   = document.querySelector('.sb-urole');
  var sbAvatar = document.querySelector('.sb-avatar');
  if(sbName)   sbName.textContent   = 'CRS Management';
  if(sbRole)   sbRole.textContent   = '';
  if(sbAvatar) sbAvatar.textContent = 'T';

  // ── Reset dashboard to loading state ──────────────────────────────────
  var subEl = document.getElementById('dash-sub');
  if(subEl) subEl.textContent = 'Loading...';
  var crsInfo = document.getElementById('dash-crs-info');
  if(crsInfo) crsInfo.style.display = 'none';
  var kpiE = document.getElementById('kpi-entries');   if(kpiE) kpiE.textContent = '0';
  var kpiN = document.getElementById('kpi-noentry');   if(kpiN) kpiN.textContent = '0';
  var kpiR = document.getElementById('kpi-receipts');  if(kpiR) kpiR.textContent = '0';
  var closing = document.getElementById('dash-closing-list');
  if(closing) closing.innerHTML = '<div style="color:var(--muted);font-size:12px;text-align:center;padding:20px">No entry data yet</div>';
  var bars = document.getElementById('dash-day-bars');   if(bars)   bars.innerHTML='';
  var lbls = document.getElementById('dash-day-labels'); if(lbls)   lbls.innerHTML='';
  var brkd = document.getElementById('dash-commodity-breakdown');
  if(brkd) brkd.innerHTML='<div style="color:var(--muted);font-size:12px;text-align:center;padding:14px">Select a date with entry data to see breakdown</div>';
  var totAmt = document.getElementById('dash-sale-total'); if(totAmt) totAmt.textContent='₹0.00';
  var totQty = document.getElementById('dash-sale-qty');   if(totQty) totQty.textContent='0 kg total';

  // ── Reset clock state so it restarts on next login ─────────────────────
  window._clockStarted = false;
  var clockEl = document.getElementById('dash-clock');
  if(clockEl) clockEl.textContent = '--:--:--';
  var ampmEl = document.getElementById('dash-ampm');
  if(ampmEl) ampmEl.textContent = '--';

  // ── Reset active page to dashboard ────────────────────────────────────
  document.querySelectorAll('.page').forEach(function(p){ p.classList.remove('active'); });
  var dash = document.getElementById('page-dashboard');
  if(dash) dash.classList.add('active');
  document.querySelectorAll('.nav-item').forEach(function(n){ n.classList.remove('active'); });
  var firstNav = document.querySelector('.nav-item');
  if(firstNav) firstNav.classList.add('active');

  // ── Reset daily entry dropdowns ────────────────────────────────────────
  var logoutSelIds=['entry-crs','me-crs'];
  logoutSelIds.forEach(function(selId){
    var s=document.getElementById(selId);
    if(!s) return;
    s.innerHTML='<option value="">Select CRS Shop...</option>';
    CRS_LIST.forEach(function(c){
      var o=document.createElement('option');
      o.value=String(c.id);o.textContent='CRS '+c.id+' — '+c.name;
      s.appendChild(o);
    });
    s.value='';
  });
  var entryWrap = document.getElementById('entry-form-wrap');
  var entryEmpty = document.getElementById('entry-empty');
  if(entryWrap)  entryWrap.style.display  = 'none';
  if(entryEmpty) entryEmpty.style.display = 'block';

  // ── Show login screen ──────────────────────────────────────────────────
  var loginScr = document.getElementById('login-screen');
  if(loginScr) loginScr.classList.remove('hidden');
}



// ============================================================
// DASHBOARD & RECEIPT JS
// ============================================================
