/* User management against the database  [+]
   Added after the port; listed in NEW_ENGINE in tools/verify-parity.mjs.

   The Users screen used to edit the in-memory userStore array, and passwords
   were plain strings sitting next to the records. Users now live in their own
   table with bcrypt hashes (supabase/migrations/0002_users.sql), so the three
   functions that mutate them are replaced with calls to /api/users.

   The screen itself is untouched — same fields, same validation rules, same
   success messages. Only where the change lands is different, and the table is
   re-read from the server afterwards so what is on screen is what was stored.

   Passwords are never held in userStore now; /api/users does not return them. */

(function(){
  if(typeof window === 'undefined') return;

  function muApiError(err){
    var msg = (err && err.message) ? err.message : 'the server did not respond';
    var el = document.getElementById('users-success');
    if(el){
      el.textContent = '⚠️ ' + msg;
      el.style.display = 'block';
      el.style.background = '#FEE2E2';
      el.style.color = '#991B1B';
      setTimeout(function(){ el.style.display = 'none'; el.style.background = ''; el.style.color = ''; }, 8000);
    }else{
      alert(msg);
    }
  }

  function muRequest(url, method, body){
    return fetch(url, {
      method:  method,
      headers: {'Content-Type':'application/json'},
      body:    body ? JSON.stringify(body) : undefined
    }).then(function(r){
      return r.json().catch(function(){ return {}; }).then(function(b){
        if(!r.ok) throw new Error((b && b.error) || ('server returned ' + r.status));
        return b;
      });
    });
  }

  // Re-read the roster, then repaint. Cheap, and it means the screen can never
  // show an edit that did not actually reach the database.
  function muRefresh(){
    if(typeof crsPersistLoadUsers !== 'function') return Promise.resolve();
    return crsPersistLoadUsers().then(function(){
      if(typeof renderUsersTable === 'function') renderUsersTable();
    });
  }

  // ── Add / edit ────────────────────────────────────────────────────────────
  if(typeof muSaveUser === 'function'){
    muSaveUser = function(){
      var name   = document.getElementById('mu-fullname').value.trim();
      var phone  = document.getElementById('mu-phone').value.trim();
      var role   = document.getElementById('mu-role-val').value;
      var crsVal = document.getElementById('mu-crs').value;
      var email  = document.getElementById('mu-email').value.trim();

      // Same rules the ported screen applied, kept so the field-level messages
      // stay meaningful.
      var nameErr  = document.getElementById('mu-name-err');
      var phoneErr = document.getElementById('mu-phone-err');
      var roleErr  = document.getElementById('mu-role-err');
      var crsErr   = document.getElementById('mu-crs-err');
      var summary  = document.getElementById('mu-val-summary');
      var valid    = true;

      if(!name){ nameErr.style.display='block'; valid=false; } else nameErr.style.display='none';
      if(!/^[6-9][0-9]{9}$/.test(phone)){ phoneErr.style.display='block'; valid=false; } else phoneErr.style.display='none';
      if(!role){ roleErr.style.display='block'; valid=false; } else roleErr.style.display='none';
      if(!crsVal){ crsErr.style.display='block'; valid=false; } else crsErr.style.display='none';
      if(!valid){ summary.style.display='block'; return; }
      summary.style.display='none';

      var crsId = parseInt(crsVal);
      var crs   = (typeof CRS_LIST !== 'undefined') ? CRS_LIST.find(function(c){ return c.id===crsId; }) : null;

      // username follows fullName, as the ported screen did.
      var payload = {fullName:name, username:name, phone:phone, email:email, role:role, crsId:crsId};

      var req;
      if(typeof muEditId !== 'undefined' && muEditId !== null){
        req = muRequest('/api/users/' + muEditId, 'PATCH', payload)
          .then(function(){ muShowSuccess('User "'+name+'" updated successfully.'); });
      }else{
        payload.password = 'pds123';   // reset on first sign-in; see README
        req = muRequest('/api/users', 'POST', payload)
          .then(function(){
            muShowSuccess('User "'+name+'" added successfully to CRS ' +
                          (crs ? crs.id+' — '+crs.name : crsId) + ' as ' + role + '.');
          });
      }

      req.then(function(){ closeModal('modal-user'); return muRefresh(); })
         .catch(muApiError);
    };
  }

  // ── Activate / deactivate ─────────────────────────────────────────────────
  if(typeof muToggleActive === 'function'){
    muToggleActive = function(userId){
      var user = (typeof userStore !== 'undefined')
        ? userStore.find(function(u){ return u.id===userId; }) : null;
      if(!user) return;
      muRequest('/api/users/' + userId, 'PATCH', {active: !user.active})
        .then(muRefresh)
        .catch(muApiError);
    };
  }

  // ── Reset password ────────────────────────────────────────────────────────
  if(typeof muResetPassword === 'function'){
    muResetPassword = function(userId){
      var user = (typeof userStore !== 'undefined')
        ? userStore.find(function(u){ return u.id===userId; }) : null;
      if(!user) return;
      muRequest('/api/users/' + userId, 'PATCH', {password:'pds123'})
        .then(function(){
          muShowSuccess('Password for "'+user.fullName+'" reset to default: pds123');
        })
        .catch(muApiError);
    };
  }
})();
