/* CRS Master Configuration  [+]
   Added after the port; not part of TNCSC_CRS_Demo_19 (1).html, so
   tools/verify-parity.mjs skips this file (see NEW_ENGINE there).

   One record per shop, preloaded from "TNCSC Statement Closer - Sheet5":
   shop code, the Bill Clerk and Packer with their mobiles, whether the shop
   files a COLL statement, whether it has a police ration, and whether it is in
   use at all. The statement builders already ask for the BC's name and number
   and for the police section, and until now took them from userStore alone —
   this is the sheet the office actually works from.

   The eight shops the sheet lists under "No usage" (2, 3, 4, 6, 13, 18, 21, 22)
   start inactive. They are expected back, so nothing about them is deleted and
   an admin can switch one to Active on the CRS Shops screen at any time.

   Concatenated last but one by tools/bundle-engine.mjs; everything it wraps
   already exists by the time it runs. */

// status: 'active' | 'no_usage'   ·   coll/police: booleans
// A blank packer means the shop has no packer on record — the statement
// builders already print a ruled blank in that case (STAFF_NAME_BLANK).
var CRS_MASTER = [
  {id:1,  code:'22BA003PN',    bc:'Divya',            bcMobile:'9894024694', packer:'',          packerMobile:'',           coll:false, police:true,  status:'active'},
  {id:2,  code:'',             bc:'',                 bcMobile:'',           packer:'',          packerMobile:'',           coll:false, police:false, status:'no_usage'},
  {id:3,  code:'',             bc:'',                 bcMobile:'',           packer:'',          packerMobile:'',           coll:false, police:false, status:'no_usage'},
  {id:4,  code:'',             bc:'',                 bcMobile:'',           packer:'',          packerMobile:'',           coll:false, police:false, status:'no_usage'},
  {id:5,  code:'22EA001PN',    bc:'Ramamoorthy',      bcMobile:'9345642879', packer:'',          packerMobile:'',           coll:true,  police:true,  status:'active'},
  {id:6,  code:'',             bc:'',                 bcMobile:'',           packer:'',          packerMobile:'',           coll:false, police:false, status:'no_usage'},
  {id:7,  code:'22EA005PN',    bc:'Mathavi',          bcMobile:'8300193084', packer:'Balaji',    packerMobile:'8778024748', coll:true,  police:false, status:'active'},
  {id:8,  code:'22EA007PN',    bc:'Anand',            bcMobile:'9025604560', packer:'',          packerMobile:'',           coll:true,  police:false, status:'active'},
  {id:9,  code:'22EA002PN',    bc:'Prakasham',        bcMobile:'9943382480', packer:'',          packerMobile:'',           coll:true,  police:true,  status:'active'},
  {id:10, code:'22EA003PN',    bc:'Rajeshkanna',      bcMobile:'9092124055', packer:'',          packerMobile:'',           coll:true,  police:true,  status:'active'},
  {id:11, code:'22EA004PN',    bc:'Mohandoss',        bcMobile:'9787380758', packer:'',          packerMobile:'',           coll:true,  police:true,  status:'active'},
  {id:12, code:'22EA008PN',    bc:'Thirumurugan',     bcMobile:'8940635005', packer:'',          packerMobile:'',           coll:true,  police:false, status:'active'},
  {id:13, code:'',             bc:'',                 bcMobile:'',           packer:'',          packerMobile:'',           coll:false, police:false, status:'no_usage'},
  {id:14, code:'22CA002PN',    bc:'Pandiyan',         bcMobile:'6379749831', packer:'',          packerMobile:'',           coll:false, police:false, status:'active'},
  {id:15, code:'22CA003PN',    bc:'Bharathimohan',    bcMobile:'9578380326', packer:'',          packerMobile:'',           coll:false, police:true,  status:'active'},
  {id:16, code:'22CA004PN',    bc:'Meera',            bcMobile:'9843328496', packer:'',          packerMobile:'',           coll:false, police:false, status:'active'},
  {id:17, code:'22DA002PN',    bc:'Kalamegam',        bcMobile:'8903474550', packer:'',          packerMobile:'',           coll:false, police:true,  status:'active'},
  {id:18, code:'',             bc:'',                 bcMobile:'',           packer:'',          packerMobile:'',           coll:false, police:false, status:'no_usage'},
  {id:19, code:'22CA005PN',    bc:'Rahamathullakhan', bcMobile:'9994245051', packer:'',          packerMobile:'',           coll:true,  police:true,  status:'active'},
  {id:20, code:'22DA001PN',    bc:'Alagarsamy',       bcMobile:'9976349655', packer:'Prakash',   packerMobile:'8148551873', coll:false, police:true,  status:'active'},
  {id:21, code:'',             bc:'',                 bcMobile:'',           packer:'',          packerMobile:'',           coll:false, police:false, status:'no_usage'},
  {id:22, code:'',             bc:'',                 bcMobile:'',           packer:'',          packerMobile:'',           coll:false, police:false, status:'no_usage'},
  {id:23, code:'22DA005PN',    bc:'Saravanan',        bcMobile:'9159541617', packer:'Shankaran', packerMobile:'6379467878', coll:false, police:true,  status:'active'},
  {id:24, code:'22DA009PN',    bc:'Sivadharanya',     bcMobile:'9345310159', packer:'Pandi',     packerMobile:'9843287692', coll:false, police:true,  status:'active'},
  {id:25, code:'22CA008PN',    bc:'Rajathi',          bcMobile:'9092895087', packer:'Rajkumar',  packerMobile:'9159256482', coll:false, police:false, status:'active'},
  {id:26, code:'22DA007PN',    bc:'Ramachandran',     bcMobile:'9500135474', packer:'',          packerMobile:'',           coll:false, police:false, status:'active'},
  {id:27, code:'22DA004PN',    bc:'Manibharathi',     bcMobile:'7339521359', packer:'',          packerMobile:'',           coll:false, police:true,  status:'active'},
  {id:28, code:'22DA003PN',    bc:'Vellaichami',      bcMobile:'9345926814', packer:'',          packerMobile:'',           coll:false, police:true,  status:'active'},
  // The sheet gives CRS 29 no shop code (it is the refugee camp) and leaves its
  // police cell blank, which is read here as no police ration.
  {id:29, code:'REFUGEE CAMP', bc:'Velu Brindhavan',  bcMobile:'9677607399', packer:'',          packerMobile:'',           coll:true,  police:false, status:'active'},
  {id:30, code:'22EA009PN',    bc:'Ramachandran',     bcMobile:'9788246242', packer:'',          packerMobile:'',           coll:true,  police:true,  status:'active'},
];

function crsMaster(crsId){
  var n = parseInt(crsId, 10);
  return CRS_MASTER.find(function(m){ return m.id === n; }) || null;
}
function crsMasterName(crsId){
  var c = (typeof CRS_LIST !== 'undefined')
    ? CRS_LIST.find(function(x){ return x.id === parseInt(crsId, 10); })
    : null;
  return c ? c.name : '';
}
function crsMasterActive(crsId){
  var m = crsMaster(crsId);
  return !m || m.status === 'active';
}
function crsMasterNeedsColl(crsId){   var m = crsMaster(crsId); return !!(m && m.coll); }
function crsMasterHasPolice(crsId){   var m = crsMaster(crsId); return !!(m && m.police); }

// ── CONFIGURATION TABLE ─────────────────────────────────────────────────────
// Replaces the ported buildCrsTable(), which listed nine hard-coded demo shops
// with district/taluk/card columns. This is the master the office works from.
function buildCrsTable(){
  var tbody = document.getElementById('crs-tbody');
  if(!tbody) return;
  // The engine is one script and this declaration is hoisted over the whole of
  // it, so the ported init at the end of 18-backup-init.js reaches this name
  // before the CRS_MASTER assignment below has run. Returning quietly is the
  // point: throwing here would abort the rest of the script's top-level, and
  // the init at the foot of this file paints the table once the data exists.
  if(typeof CRS_MASTER === 'undefined' || !CRS_MASTER) return;

  var q = (document.getElementById('crs-master-filter') || {}).value || 'all';
  var rows = '', shown = 0, active = 0, noUse = 0, coll = 0, police = 0;

  CRS_MASTER.forEach(function(m){
    if(m.status === 'active') active++; else noUse++;
    if(m.coll) coll++;
    if(m.police) police++;
    if(q === 'active'   && m.status !== 'active')   return;
    if(q === 'no_usage' && m.status !== 'no_usage') return;
    shown++;

    var off  = m.status !== 'active';
    var tint = off ? 'background:#F8FAFC;color:#94A3B8' : '';
    var dash = '<span style="color:#CBD5E1">—</span>';

    rows +=
      '<tr style="' + tint + '">' +
        '<td><strong style="color:var(--navy);font-family:monospace">' + (m.code || dash) + '</strong></td>' +
        '<td><strong>CRS ' + m.id + '</strong> <span style="color:var(--muted)">— ' + crsMasterName(m.id) + '</span></td>' +
        '<td>' + (m.bc || dash) + '</td>' +
        '<td style="font-family:monospace">' + (m.bcMobile || dash) + '</td>' +
        '<td>' + (m.packer || dash) + '</td>' +
        '<td style="font-family:monospace">' + (m.packerMobile || dash) + '</td>' +
        '<td style="text-align:center">' +
          (m.coll ? '<span class="badge badge-blue">COLL</span>' : dash) + '</td>' +
        '<td style="text-align:center">' +
          (m.police ? '<span class="badge badge-purple">Had Police</span>'
                    : '<span style="font-size:11px;color:var(--muted)">No Police</span>') + '</td>' +
        '<td style="text-align:center">' +
          (off ? '<span class="badge badge-amber">No Usage</span>'
               : '<span class="badge badge-green">Active</span>') + '</td>' +
        '<td style="text-align:center">' +
          '<button class="btn btn-outline btn-sm" onclick="crsMasterToggle(' + m.id + ')" ' +
          'title="' + (off ? 'Bring this shop back into use' : 'Mark this shop as not in use') + '" ' +
          'style="color:' + (off ? 'var(--green)' : 'var(--red)') + '">' +
          (off ? 'Set Active' : 'Set No Usage') + '</button>' +
        '</td>' +
      '</tr>';
  });

  tbody.innerHTML = rows ||
    '<tr><td colspan="10" style="text-align:center;padding:24px;color:var(--muted);font-size:12px">No shops match this filter.</td></tr>';

  var sum = document.getElementById('crs-master-summary');
  if(sum){
    sum.textContent = shown + ' of ' + CRS_MASTER.length + ' shown · ' + active + ' active · ' +
      noUse + ' no usage · ' + coll + ' file COLL · ' + police + ' have police ration';
  }
}

// An admin flips a shop in or out of use. Nothing is deleted either way — a
// shop coming back keeps the codes and staff the sheet gave it.
function crsMasterToggle(crsId){
  var m = crsMaster(crsId);
  if(!m) return;
  var goingOff = m.status === 'active';
  var label = 'CRS ' + m.id + (crsMasterName(m.id) ? ' — ' + crsMasterName(m.id) : '');
  if(goingOff && !confirm('Mark ' + label + ' as No Usage?\n\n' +
      'It stops being offered for new entry. Its saved data and master details are kept, ' +
      'so it can be set back to Active later.')){
    return;
  }
  m.status = goingOff ? 'no_usage' : 'active';
  buildCrsTable();
  if(typeof crsMasterRefreshDropdowns === 'function') crsMasterRefreshDropdowns();
}

// The CRS pickers should stop offering a shop that is out of use, but must
// still show one that is already selected — a month keyed before the shop was
// retired has to stay readable.
function crsMasterRefreshDropdowns(){
  ['entry-crs', 'me-crs', 'rp-crs', 'stmt-crs'].forEach(function(id){
    var sel = document.getElementById(id);
    if(!sel) return;
    Array.prototype.forEach.call(sel.options, function(o){
      if(!o.value) return;
      var off = !crsMasterActive(o.value);
      o.hidden = off && sel.value !== o.value;
      o.textContent = o.textContent.replace(/ \(no usage\)$/, '') + (off ? ' (no usage)' : '');
    });
  });
}

// ── STATEMENT WIRING ────────────────────────────────────────────────────────
// The sheet is the authority on who signs a shop's paperwork, so the statement
// data takes the master's BC and packer when it has them and keeps the ported
// userStore lookup as the fallback.
var _masterOrigStmtGetData = stmtGetData;
stmtGetData = function(crsId, month, year){
  var d = _masterOrigStmtGetData.apply(this, arguments);
  try{
    var m = crsMaster(crsId);
    if(m){
      if(m.bc)           d.bcName      = m.bc;
      if(m.bcMobile)     d.bcPhone     = m.bcMobile;
      if(m.packer)       d.packerName  = m.packer;
      if(m.packerMobile) d.packerPhone = m.packerMobile;
      d.master     = m;
      d.needsColl  = !!m.coll;
      d.hasPolice  = !!m.police;
    }
  }catch(e){}
  return d;
};

// ── PERSISTENCE ─────────────────────────────────────────────────────────────
if(typeof BACKUP_STORES !== 'undefined'){
  BACKUP_STORES.push({key:'CRS_MASTER', kind:'array', label:'CRS Master'});
}

(function initCrsMaster(){
  if(!document.getElementById('crs-tbody')) return;
  try{ buildCrsTable(); crsMasterRefreshDropdowns(); }catch(e){}
})();
