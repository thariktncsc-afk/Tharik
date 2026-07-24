/* User Management CRUD
   Verbatim from TNCSC_CRS_Demo_19 (1).html lines 3693-4037.
   These parts are concatenated back into one classic script by
   tools/bundle-engine.mjs - the code hoists across the whole block and
   its declarations must stay global for the markup's inline handlers. */
var userStore = [
  {id:1, fullName:'Administrator', username:'admin', phone:'9344114086', email:'admin@tncsc.gov.in', role:'ADMIN', crsId:null, password:'pds123', active:true, createdAt:'2026-01-01'},
  {id:2, fullName:'Alagarsami', username:'crs9', phone:'9876543210', email:'', role:'BC', crsId:9, password:'pds123', active:true, createdAt:'2026-01-01'},
  {id:3, fullName:'Murugan', username:'crs9', phone:'9876543211', email:'', role:'Packer', crsId:9, password:'pds123', active:true, createdAt:'2026-01-01'},
  {id:4, fullName:'Ravi', username:'crs1', phone:'9876500001', email:'', role:'BC', crsId:1, password:'pds123', active:true, createdAt:'2026-01-01'},
  {id:5, fullName:'Selvi', username:'crs2', phone:'9876500002', email:'', role:'BC', crsId:2, password:'pds123', active:true, createdAt:'2026-01-01'},
  {id:6, fullName:'Kumar', username:'crs3', phone:'9876500003', email:'', role:'BC', crsId:3, password:'pds123', active:true, createdAt:'2026-01-01'},
  {id:7, fullName:'Priya', username:'crs4', phone:'9876500004', email:'', role:'BC', crsId:4, password:'pds123', active:true, createdAt:'2026-01-01'},
  {id:8, fullName:'Suresh', username:'crs5', phone:'9876500005', email:'', role:'BC', crsId:5, password:'pds123', active:true, createdAt:'2026-01-01'},
  {id:9, fullName:'Meena', username:'crs6', phone:'9876500006', email:'', role:'BC', crsId:6, password:'pds123', active:true, createdAt:'2026-01-01'},
  {id:10, fullName:'Rajesh', username:'crs7', phone:'9876500007', email:'', role:'BC', crsId:7, password:'pds123', active:true, createdAt:'2026-01-01'},
  {id:11, fullName:'Anbu', username:'crs8', phone:'9876500008', email:'', role:'BC', crsId:8, password:'pds123', active:true, createdAt:'2026-01-01'},
  {id:12, fullName:'Kavitha', username:'crs10', phone:'9876500010', email:'', role:'BC', crsId:10, password:'pds123', active:true, createdAt:'2026-01-01'},
  {id:13, fullName:'Mani', username:'crs11', phone:'9876500011', email:'', role:'BC', crsId:11, password:'pds123', active:true, createdAt:'2026-01-01'},
  {id:14, fullName:'Saranya', username:'crs12', phone:'9876500012', email:'', role:'BC', crsId:12, password:'pds123', active:true, createdAt:'2026-01-01'},
  {id:15, fullName:'Venkat', username:'crs13', phone:'9876500013', email:'', role:'BC', crsId:13, password:'pds123', active:true, createdAt:'2026-01-01'},
  {id:16, fullName:'Lalitha', username:'crs14', phone:'9876500014', email:'', role:'BC', crsId:14, password:'pds123', active:true, createdAt:'2026-01-01'},
  {id:17, fullName:'Babu', username:'crs15', phone:'9876500015', email:'', role:'BC', crsId:15, password:'pds123', active:true, createdAt:'2026-01-01'},
  {id:18, fullName:'Geetha', username:'crs16', phone:'9876500016', email:'', role:'BC', crsId:16, password:'pds123', active:true, createdAt:'2026-01-01'},
  {id:19, fullName:'Muthu', username:'crs17', phone:'9876500017', email:'', role:'BC', crsId:17, password:'pds123', active:true, createdAt:'2026-01-01'},
  {id:20, fullName:'Indira', username:'crs18', phone:'9876500018', email:'', role:'BC', crsId:18, password:'pds123', active:true, createdAt:'2026-01-01'},
  {id:21, fullName:'Vijay', username:'crs19', phone:'9876500019', email:'', role:'BC', crsId:19, password:'pds123', active:true, createdAt:'2026-01-01'},
  {id:22, fullName:'Padma', username:'crs20', phone:'9876500020', email:'', role:'BC', crsId:20, password:'pds123', active:true, createdAt:'2026-01-01'},
  {id:23, fullName:'Sundar', username:'crs21', phone:'9876500021', email:'', role:'BC', crsId:21, password:'pds123', active:true, createdAt:'2026-01-01'},
  {id:24, fullName:'Rekha', username:'crs22', phone:'9876500022', email:'', role:'BC', crsId:22, password:'pds123', active:true, createdAt:'2026-01-01'},
  {id:25, fullName:'Ganesh', username:'crs23', phone:'9876500023', email:'', role:'BC', crsId:23, password:'pds123', active:true, createdAt:'2026-01-01'},
  {id:26, fullName:'Chitra', username:'crs24', phone:'9876500024', email:'', role:'BC', crsId:24, password:'pds123', active:true, createdAt:'2026-01-01'},
  {id:27, fullName:'Durai', username:'crs25', phone:'9876500025', email:'', role:'BC', crsId:25, password:'pds123', active:true, createdAt:'2026-01-01'},
  {id:28, fullName:'Nirmala', username:'crs26', phone:'9876500026', email:'', role:'BC', crsId:26, password:'pds123', active:true, createdAt:'2026-01-01'},
  {id:29, fullName:'Senthil', username:'crs27', phone:'9876500027', email:'', role:'BC', crsId:27, password:'pds123', active:true, createdAt:'2026-01-01'},
  {id:30, fullName:'Kala', username:'crs28', phone:'9876500028', email:'', role:'BC', crsId:28, password:'pds123', active:true, createdAt:'2026-01-01'},
  {id:31, fullName:'Arjun', username:'crs29', phone:'9876500029', email:'', role:'BC', crsId:29, password:'pds123', active:true, createdAt:'2026-01-01'},
  {id:32, fullName:'Shanthi', username:'crs30', phone:'9876500030', email:'', role:'BC', crsId:30, password:'pds123', active:true, createdAt:'2026-01-01'}
];
var muNextId = 33;
var muNextId  = 4;
var muEditId  = null; // null = adding, number = editing
var muSelRole = '';

// Init CRS dropdown in Add-User modal and filter
(function initUserCRSDropdown(){
  var sel  = document.getElementById('mu-crs');
  var fsel = document.getElementById('users-filter-crs');
  if(!sel) return;
  CRS_LIST.forEach(function(c){
    var opt = document.createElement('option');
    opt.value = String(c.id);
    opt.textContent = 'CRS ' + c.id + ' — ' + c.name;
    sel.appendChild(opt);
    if(fsel){
      var fopt = opt.cloneNode(true);
      fsel.appendChild(fopt);
    }
  });
  sel.addEventListener('change', muPreviewCRS);
})();

function muAutoUsername(name){
  var uEl = document.getElementById('mu-username');
  if(uEl) uEl.value = name.trim();
}

function muSelectRole(role){
  muSelRole = role;
  document.getElementById('mu-role-val').value = role;
  // Visual feedback
  var bcCard     = document.getElementById('mu-role-bc');
  var pkCard     = document.getElementById('mu-role-packer');
  var bcFill     = document.getElementById('mu-role-bc-fill');
  var pkFill     = document.getElementById('mu-role-packer-fill');
  if(role==='BC'){
    bcCard.style.borderColor='#0369A1'; bcCard.style.background='#EFF6FF';
    pkCard.style.borderColor='var(--border)'; pkCard.style.background='#fff';
    bcFill.style.background='#0369A1'; pkFill.style.background='transparent';
  } else {
    pkCard.style.borderColor='#C2410C'; pkCard.style.background='#FFF7ED';
    bcCard.style.borderColor='var(--border)'; bcCard.style.background='#fff';
    pkFill.style.background='#C2410C'; bcFill.style.background='transparent';
  }
  document.getElementById('mu-role-err').style.display='none';
}

function muPreviewCRS(){
  var crsId = parseInt(document.getElementById('mu-crs').value);
  var preview = document.getElementById('mu-crs-preview');
  var content = document.getElementById('mu-crs-preview-content');
  if(!crsId || !preview || !content){ if(preview) preview.style.display='none'; return; }
  var existing = userStore.filter(function(u){ return u.crsId===crsId && u.active; });
  if(!existing.length){ preview.style.display='none'; return; }
  preview.style.display='block';
  content.innerHTML = existing.map(function(u){
    var roleColor = u.role==='BC'?'#0369A1':'#C2410C';
    return '<div style="display:flex;align-items:center;gap:8px;padding:3px 0">' +
      '<span style="background:'+(u.role==='BC'?'#E0F2FE':'#FFF3E8')+';color:'+roleColor+';font-size:10px;font-weight:700;padding:2px 6px;border-radius:4px;min-width:60px;text-align:center">'+u.role+'</span>' +
      '<span style="font-size:12px;font-weight:600">'+u.fullName+'</span>' +
      '<span style="font-size:11px;color:var(--muted)">'+u.phone+'</span>' +
    '</div>';
  }).join('');
}

function muOpenAdd(){
  muEditId = null;
  muSelRole = '';
  document.getElementById('mu-modal-title').textContent = 'Add New User';
  document.getElementById('mu-fullname').value  = '';
  document.getElementById('mu-username').value  = '';
  document.getElementById('mu-phone').value     = '';
  document.getElementById('mu-email').value     = '';
  document.getElementById('mu-crs').value       = '';
  document.getElementById('mu-role-val').value  = '';
  // Reset role UI
  ['bc','packer'].forEach(function(r){
    var card = document.getElementById('mu-role-'+r);
    var fill = document.getElementById('mu-role-'+r+'-fill');
    if(card){ card.style.borderColor='var(--border)'; card.style.background='#fff'; }
    if(fill) fill.style.background='transparent';
  });
  ['mu-name-err','mu-phone-err','mu-role-err','mu-crs-err','mu-val-summary'].forEach(function(id){
    var el=document.getElementById(id); if(el) el.style.display='none';
  });
  document.getElementById('mu-crs-preview').style.display='none';
  openModal('modal-user');
}

function muOpenEdit(userId){
  var user = userStore.find(function(u){ return u.id===userId; });
  if(!user) return;
  muEditId = userId;
  document.getElementById('mu-modal-title').textContent = 'Edit User';
  document.getElementById('mu-fullname').value = user.fullName;
  document.getElementById('mu-username').value = user.username;
  document.getElementById('mu-phone').value    = user.phone;
  document.getElementById('mu-email').value    = user.email||'';
  document.getElementById('mu-crs').value      = user.crsId ? String(user.crsId) : '';
  muSelectRole(user.role);
  muPreviewCRS();
  openModal('modal-user');
}

function muCancel(){ closeModal('modal-user'); }

function muSaveUser(){
  // Validate
  var name    = document.getElementById('mu-fullname').value.trim();
  var phone   = document.getElementById('mu-phone').value.trim();
  var role    = document.getElementById('mu-role-val').value;
  var crsVal  = document.getElementById('mu-crs').value;
  var email   = document.getElementById('mu-email').value.trim();
  var valid   = true;

  var nameErr  = document.getElementById('mu-name-err');
  var phoneErr = document.getElementById('mu-phone-err');
  var roleErr  = document.getElementById('mu-role-err');
  var crsErr   = document.getElementById('mu-crs-err');
  var summary  = document.getElementById('mu-val-summary');

  if(!name){ nameErr.style.display='block'; valid=false; } else nameErr.style.display='none';
  if(!/^[6-9][0-9]{9}$/.test(phone)){ phoneErr.style.display='block'; valid=false; } else phoneErr.style.display='none';
  if(!role){ roleErr.style.display='block'; valid=false; } else roleErr.style.display='none';
  if(!crsVal){ crsErr.style.display='block'; valid=false; } else crsErr.style.display='none';

  if(!valid){ summary.style.display='block'; return; }
  summary.style.display='none';

  var crsId  = parseInt(crsVal);
  var crs    = CRS_LIST.find(function(c){ return c.id===crsId; });

  if(muEditId !== null){
    // Update existing
    var user = userStore.find(function(u){ return u.id===muEditId; });
    if(user){
      user.fullName = name;
      user.username = name;
      user.phone    = phone;
      user.email    = email;
      user.role     = role;
      user.crsId    = crsId;
    }
    muShowSuccess('User "'+name+'" updated successfully.');
  } else {
    // Add new
    userStore.push({
      id: muNextId++,
      fullName: name,
      username: name,
      phone:    phone,
      email:    email,
      role:     role,
      crsId:    crsId,
      password: 'pds123',
      active:   true,
      createdAt: new Date().toISOString().split('T')[0]
    });
    muShowSuccess('User "'+name+'" added successfully to CRS '+(crs?crs.id+' — '+crs.name:crsId)+' as '+role+'.');
  }

  closeModal('modal-user');
  renderUsersTable();
}

function muToggleActive(userId){
  var user = userStore.find(function(u){ return u.id===userId; });
  if(!user) return;
  user.active = !user.active;
  renderUsersTable();
}

function muResetPassword(userId){
  var user = userStore.find(function(u){ return u.id===userId; });
  if(!user) return;
  user.password = 'pds123';
  muShowSuccess('Password for "'+user.fullName+'" reset to default: pds123');
}

function muShowSuccess(msg){
  var el = document.getElementById('users-success');
  if(el){ el.textContent='✅ '+msg; el.style.display='block'; setTimeout(function(){el.style.display='none';},5000); }
}

function renderUsersTable(){
  var wrap     = document.getElementById('users-table-wrap');
  var search   = (document.getElementById('users-search')?.value||'').toLowerCase();
  var filterCRS= document.getElementById('users-filter-crs')?.value||'';
  var filterRole=document.getElementById('users-filter-role')?.value||'';

  // Filter users (exclude admin for display simplicity, show CRS users)
  var users = userStore.filter(function(u){
    if(search && !u.fullName.toLowerCase().includes(search) &&
       !(u.crsId && ('crs '+u.crsId).includes(search))) return false;
    if(filterCRS && String(u.crsId)!==filterCRS) return false;
    if(filterRole && u.role!==filterRole) return false;
    return true;
  });

  // Update subtitle
  var crsUsers = userStore.filter(function(u){ return u.crsId; });
  var sub = document.getElementById('users-count-sub');
  if(sub) sub.textContent = crsUsers.length + ' CRS user(s) registered · Showing ' + users.length;

  if(!users.length){
    wrap.innerHTML='<div style="text-align:center;padding:40px;color:var(--muted)"><div style="font-size:36px;margin-bottom:10px">👥</div><div style="font-weight:600">No users found</div></div>';
    return;
  }

  // Group by CRS
  var byCRS = {};
  users.forEach(function(u){
    var key = u.crsId ? 'CRS '+u.crsId : 'system';
    if(!byCRS[key]) byCRS[key]={crsId:u.crsId,users:[]};
    byCRS[key].users.push(u);
  });

  var html_out = '';
  Object.keys(byCRS).sort(function(a,b){
    var ai=parseInt(a.replace('CRS ',''))||0, bi=parseInt(b.replace('CRS ',''))||0;
    return ai-bi;
  }).forEach(function(crsKey){
    var group = byCRS[crsKey];
    var crs   = group.crsId ? CRS_LIST.find(function(c){return c.id===group.crsId;}) : null;
    var crsLabel = crs ? 'CRS '+crs.id+' — '+crs.name : 'System Users';
    var bcUser  = group.users.find(function(u){return u.role==='BC';});
    var pkUser  = group.users.find(function(u){return u.role==='Packer';});

    html_out += '<div class="card" style="margin-bottom:12px">' +
      '<div style="background:linear-gradient(135deg,#0369A1,#0EA5E9);padding:10px 16px;border-radius:11px 11px 0 0;display:flex;align-items:center;justify-content:space-between">' +
        '<div style="color:#fff;font-weight:800;font-size:13px">'+crsLabel+'</div>' +
        '<div style="display:flex;gap:6px">' +
          (bcUser   ? '<span style="background:rgba(255,255,255,.15);color:#fff;font-size:10px;font-weight:700;padding:2px 8px;border-radius:4px">BC: '+bcUser.fullName+'</span>':'<span style="background:rgba(255,255,255,.1);color:rgba(255,255,255,.5);font-size:10px;padding:2px 8px;border-radius:4px">No BC</span>') +
          (pkUser   ? '<span style="background:rgba(255,165,0,.3);color:#FFE082;font-size:10px;font-weight:700;padding:2px 8px;border-radius:4px">Packer: '+pkUser.fullName+'</span>':'<span style="background:rgba(255,255,255,.1);color:rgba(255,255,255,.5);font-size:10px;padding:2px 8px;border-radius:4px">No Packer</span>') +
        '</div>' +
      '</div>' +
      '<div style="overflow-x:auto"><table style="width:100%;border-collapse:collapse">' +
        '<thead><tr style="background:#F8FAFC">' +
          '<th style="padding:9px 14px;text-align:left;font-size:10px;font-weight:700;color:var(--muted);border-bottom:1px solid var(--border)">Name</th>' +
          '<th style="padding:9px 10px;text-align:center;font-size:10px;font-weight:700;color:var(--muted);border-bottom:1px solid var(--border)">Role</th>' +
          '<th style="padding:9px 10px;text-align:left;font-size:10px;font-weight:700;color:var(--muted);border-bottom:1px solid var(--border)">Phone</th>' +
          '<th style="padding:9px 10px;text-align:left;font-size:10px;font-weight:700;color:var(--muted);border-bottom:1px solid var(--border)">Email</th>' +
          '<th style="padding:9px 10px;text-align:center;font-size:10px;font-weight:700;color:var(--muted);border-bottom:1px solid var(--border)">Status</th>' +
          '<th style="padding:9px 10px;text-align:center;font-size:10px;font-weight:700;color:var(--muted);border-bottom:1px solid var(--border)">Actions</th>' +
        '</tr></thead><tbody>';

    group.users.forEach(function(u){
      var roleColor = u.role==='BC'?'#0369A1':'#C2410C';
      var roleBg    = u.role==='BC'?'#E0F2FE':'#FFF3E8';
      html_out +=
        '<tr>' +
          '<td style="padding:11px 14px;border-bottom:1px solid #F0F9FF">' +
            '<div style="font-weight:700;font-size:13px">'+u.fullName+'</div>' +
            '<div style="font-size:11px;color:var(--muted)">@'+u.username+'</div>' +
          '</td>' +
          '<td style="padding:11px 10px;text-align:center;border-bottom:1px solid #F0F9FF">' +
            '<span style="background:'+roleBg+';color:'+roleColor+';font-size:11px;font-weight:700;padding:3px 9px;border-radius:20px">'+u.role+'</span>' +
          '</td>' +
          '<td style="padding:11px 10px;font-size:12px;border-bottom:1px solid #F0F9FF">'+u.phone+'</td>' +
          '<td style="padding:11px 10px;font-size:12px;color:var(--muted);border-bottom:1px solid #F0F9FF">'+(u.email||'—')+'</td>' +
          '<td style="padding:11px 10px;text-align:center;border-bottom:1px solid #F0F9FF">' +
            '<span style="background:'+(u.active?'#DCFCE7':'#FEE2E2')+';color:'+(u.active?'#15803D':'#B91C1C')+';font-size:11px;font-weight:700;padding:3px 9px;border-radius:20px">'+(u.active?'Active':'Inactive')+'</span>' +
          '</td>' +
          '<td style="padding:11px 10px;text-align:center;border-bottom:1px solid #F0F9FF">' +
            '<div style="display:flex;gap:6px;justify-content:center">' +
              '<button onclick="muOpenEdit('+u.id+')" style="background:#fff;border:1px solid var(--border);color:var(--text);padding:5px 10px;border-radius:6px;font-size:12px;cursor:pointer;font-weight:600">Edit</button>' +
              '<button onclick="muResetPassword('+u.id+')" style="background:#fff;border:1px solid var(--border);color:#D97706;padding:5px 10px;border-radius:6px;font-size:12px;cursor:pointer">🔑 Reset</button>' +
              '<button onclick="muToggleActive('+u.id+')" style="background:#fff;border:1px solid var(--border);color:'+(u.active?'#DC2626':'#16A34A')+';padding:5px 10px;border-radius:6px;font-size:12px;cursor:pointer">'+(u.active?'Disable':'Enable')+'</button>' +
            '</div>' +
          '</td>' +
        '</tr>';
    });

    html_out += '</tbody></table></div></div>';
  });

  wrap.innerHTML = html_out;
}

// ── Statement integration: get users for a CRS ─────────────────────────────
function getUsersForCRS(crsId){
  var bc     = userStore.find(function(u){ return u.crsId===crsId && u.role==='BC' && u.active; });
  var packer = userStore.find(function(u){ return u.crsId===crsId && u.role==='Packer' && u.active; });
  return { bc: bc||null, packer: packer||null };
}

function buildUserSignatureBlock(crsId){
  var staff = getUsersForCRS(crsId);
  if(!staff.bc && !staff.packer) return '';
  var rows='';
  if(staff.bc){
    rows+='<div style="display:flex;justify-content:space-between;padding:7px 0;border-bottom:1px dashed #BAE6FD">' +
      '<span style="font-size:12px;color:#444">Name of the <strong>Bill Clerk (BC)</strong>:</span>' +
      '<span style="font-size:12px;font-weight:700">'+staff.bc.fullName+'</span>' +
      '<span style="font-size:12px;color:#444">Mobile: <strong>'+staff.bc.phone+'</strong></span>' +
    '</div>';
  }
  if(staff.packer){
    rows+='<div style="display:flex;justify-content:space-between;padding:7px 0">' +
      '<span style="font-size:12px;color:#444">Name of the <strong>Packer</strong>:</span>' +
      '<span style="font-size:12px;font-weight:700">'+staff.packer.fullName+'</span>' +
      '<span style="font-size:12px;color:#444">Mobile: <strong>'+staff.packer.phone+'</strong></span>' +
    '</div>';
  }
  return '<div style="background:#F0F9FF;border:1px solid #BAE6FD;border-radius:8px;padding:12px 16px;margin-top:14px">' +
    '<div style="font-size:10px;font-weight:700;color:#0369A1;text-transform:uppercase;letter-spacing:.05em;margin-bottom:8px">Assigned Staff</div>' +
    rows + '</div>';
}

// ═══ AUTH SYSTEM ══════════════════════════════════════════════════════════
