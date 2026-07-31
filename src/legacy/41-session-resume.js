/* Session resume on page reload  [+]
   The server issues a 12-hour HttpOnly session cookie on sign-in
   (src/app/api/session/route.ts), but the login state itself lived only in
   the currentUser variable — so any refresh landed back on the login screen
   even though the cookie was still valid. On load this asks the server who
   is signed in (GET /api/session) and, if the cookie holds, re-enters the
   app through the same path a fresh sign-in takes: crsPersistEnter() pulls
   every store down first, then enterApp() builds the screens.

   If there is no valid cookie the login screen simply stays — nothing here
   runs a fallback or stores credentials in the browser. */

(function(){
  if(typeof window === 'undefined') return;

  function crsResumeSession(){
    // The login form stays usable while this checks; on a dead cookie the
    // screen is already exactly where the user needs to be.
    var hint = document.getElementById('login-err');
    fetch('/api/session', {headers:{'Accept':'application/json'}})
      .then(function(r){
        if(r.status === 401) return null;              // no session — stay on login
        if(!r.ok) throw new Error('server returned ' + r.status);
        return r.json();
      })
      .then(function(body){
        if(!body || !body.user) return;
        if(typeof crsPersistEnter !== 'function') return;
        if(hint){ hint.textContent = 'Restoring your session…'; hint.style.display = 'block'; }
        return crsPersistEnter(body.user).then(function(){
          if(hint){ hint.textContent = ''; hint.style.display = 'none'; }
        });
      })
      .catch(function(err){
        // Resume is best-effort: any failure leaves the normal login flow.
        if(hint){ hint.style.display = 'none'; }
        try{ console.warn('[session-resume] ' + (err && err.message ? err.message : err)); }catch(e){}
      });
  }

  if(document.readyState === 'loading'){
    document.addEventListener('DOMContentLoaded', crsResumeSession);
  }else{
    crsResumeSession();
  }
})();
