/* Config, roles, page routing, modal helpers
   Verbatim from TNCSC_CRS_Demo_19 (1).html lines 1700-1842.
   These parts are concatenated back into one classic script by
   tools/bundle-engine.mjs - the code hoists across the whole block and
   its declarations must stay global for the markup's inline handlers. */
// ── SAFE DATE PICKER HELPER ──────────────────────────────────────────────
// showPicker() is blocked in cross-origin iframes — use visible date inputs only
function safeDateClick(inputId){
  try{
    var el=document.getElementById(inputId);
    if(!el) return;
    // Do NOT call showPicker() — just focus the input; browser shows native picker
    el.focus();
  }catch(e){ /* silently ignore cross-origin picker errors */ }
}

// Global error boundary for SecurityError (cross-origin showPicker)
window.addEventListener('error', function(e){
  if(e&&e.message&&e.message.indexOf('showPicker')>-1){
    e.preventDefault();
    e.stopPropagation();
    return false;
  }
});


// ── DATA ──────────────────────────────────────────────
const CRS_SHOPS = [
  {code:'CRS-001',name:'Madurai Central Market',district:'Madurai',taluk:'Madurai East',cards:812,active:true},
  {code:'CRS-002',name:'Anna Nagar Depot',district:'Madurai',taluk:'Madurai West',cards:654,active:true},
  {code:'CRS-003',name:'Thiruparankundram Rationing',district:'Madurai',taluk:'Thiruparankundram',cards:743,active:true},
  {code:'CRS-004',name:'Villapuram Branch',district:'Madurai',taluk:'Madurai South',cards:521,active:false},
  {code:'CRS-005',name:'Sellur Distribution',district:'Madurai',taluk:'Madurai North',cards:698,active:true},
  {code:'CRS-006',name:'Arapalayam Centre',district:'Madurai',taluk:'Madurai East',cards:445,active:true},
  {code:'CRS-007',name:'Koodal Nagar',district:'Madurai',taluk:'Madurai West',cards:889,active:true},
  {code:'CRS-008',name:'Tallakulam Depot',district:'Madurai',taluk:'Madurai North',cards:332,active:true},
  {code:'CRS-009',name:'Alagarsami — CRS 9',district:'Madurai',taluk:'Madurai East',cards:694,active:true},
];

const COMMODITIES = ['BRA','AAY','RRA','SUGAR','SUGAR(AAY)','WHEAT','CYL','P.OIL','OOTY','TAN','PHH FRK','AAY FRK','NPHH FRK'];
// [M5] MONTHS / MONTH_SALES removed with buildChart() — the six months of
// figures were placeholders and the #bar-chart / #bar-labels elements they
// painted into do not exist in this document. The dashboard draws its own
// bars from real entryStore data in buildDashDayBars().

// ── [M3] ORGANISATION CONFIG ────────────────────────────────────────────────
// The cereal account number used to be typed straight into the DSS xlsx export
// and the DSS on-screen page, so a re-posted account meant editing two string
// literals inside render code. It lives here now, with a per-shop override for
// regions that bank per CRS. Settings > "Cereal Account Number" writes to it.
var APP_CONFIG = {
  orgName:          'Tamil Nadu Civil Supplies Corporation',
  regionName:       'TNCSC-Madurai-20',
  submitToOffice:   'Submitted to SRM office',
  cerealAccountNo:  '10828605763',
  accountLabel:     'C A/C I'
};

// Optional per-CRS overrides: {9:'10828605764', ...}
var CRS_ACCOUNTS = {};

// Resolve the cereal account number for a shop (falls back to the org-wide one)
function cerealAccountNo(crsId){
  var v = CRS_ACCOUNTS[crsId] || CRS_ACCOUNTS[String(crsId)] || APP_CONFIG.cerealAccountNo;
  return v || '';
}

// ── [M4] UNASSIGNED-STAFF PLACEHOLDERS ──────────────────────────────────────
// When a CRS has no Bill Clerk or Packer on record the statement builders used
// to print a real employee's name and mobile number ('ALAGARSAMI' / 'MURUGAN'
// and their phones) on every shop's official paperwork. Print a ruled blank
// instead, so the form is signed by whoever actually worked the counter.
var STAFF_NAME_BLANK  = '________________';
var STAFF_PHONE_BLANK = '__________';

// ── LOGIN ─────────────────────────────────────────────

// ── NAVIGATION ────────────────────────────────────────

// [S3] Page access control. Roles listed here may open the page; anything not
// listed is admin-only. Keep this in step with applyNavForRole(), which hides
// the matching nav items — that is cosmetic, this is the actual gate.
var PAGE_ROLES = {
  dashboard: ['ADMIN','BC','Packer'],
  entry:     ['ADMIN','BC','Packer'],
  monthly:   ['ADMIN','BC','Packer'],
  receipt:   ['ADMIN','BC','Packer'],
  statement: ['ADMIN','BC','Packer'],
  crs:       ['ADMIN'],
  commodity: ['ADMIN'],
  users:     ['ADMIN'],
  settings:  ['ADMIN'],
  audit:     ['ADMIN'],
  reports:   ['ADMIN']
};

// Fallback page for a role that may not see the one it asked for.
function defaultPageForRole(role){ return role === 'ADMIN' ? 'dashboard' : 'dashboard'; }

function canViewPage(id, user){
  var allowed = PAGE_ROLES[id];
  if(!allowed) return false;                 // unknown page -> deny
  if(!user) return false;                    // not signed in -> deny
  return allowed.indexOf(user.role) > -1;
}

function showPage(id,el){
  // [S3] gate first — never paint a page the signed-in role may not see
  if(typeof currentUser !== 'undefined' && currentUser && !canViewPage(id, currentUser)){
    console.warn('showPage: role ' + currentUser.role + ' blocked from "' + id + '"');
    if(typeof showAccessDenied === 'function') showAccessDenied(id);
    var fb = defaultPageForRole(currentUser.role);
    if(fb === id) return;                    // avoid recursing on a bad map
    return showPage(fb, document.querySelector('.nav-item[onclick*="\'' + fb + '\'"]'));
  }
  var target = document.getElementById('page-'+id);
  if(!target) return;                        // unknown id -> no-op, not a crash
  document.querySelectorAll('.page').forEach(p=>p.classList.remove('active'));
  target.classList.add('active');
  document.querySelectorAll('.nav-item').forEach(n=>n.classList.remove('active'));
  if(el) el.classList.add('active');
}

// Small non-blocking toast so a blocked navigation is visible, not silent.
function showAccessDenied(id){
  var t = document.getElementById('access-denied-toast');
  if(!t){
    t = document.createElement('div');
    t.id = 'access-denied-toast';
    t.style.cssText = 'position:fixed;top:18px;left:50%;transform:translateX(-50%);'+
      'background:#7F1D1D;color:#fff;padding:10px 18px;border-radius:10px;font-size:13px;'+
      'font-weight:600;z-index:99999;box-shadow:0 8px 24px rgba(0,0,0,.28);display:none';
    document.body.appendChild(t);
  }
  t.textContent = '\uD83D\uDD12 Your role does not have access to "' + id + '".';
  t.style.display = 'block';
  clearTimeout(showAccessDenied._t);
  showAccessDenied._t = setTimeout(function(){ t.style.display = 'none'; }, 3200);
}

// ── MODALS ────────────────────────────────────────────
function openModal(id){document.getElementById(id).classList.add('open')}
function closeModal(id){document.getElementById(id).classList.remove('open')}
document.querySelectorAll('.modal-bg').forEach(m=>{
  m.addEventListener('click',e=>{if(e.target===m)m.classList.remove('open')});
});

// ── CRS TABLE ─────────────────────────────────────────
