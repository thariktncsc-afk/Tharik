/* Session resume on page reload  [+]
   The server issues a 12-hour HttpOnly session cookie on sign-in
   (src/app/api/session/route.ts), but the login state itself lived only in
   the currentUser variable — so any refresh landed back on the login screen
   even though the cookie was still valid. On load this asks the server who
   is signed in (GET /api/session) and, if the cookie holds, re-enters the
   app through the same path a fresh sign-in takes: crsPersistEnter() pulls
   every store down first, then enterApp() builds the screens.

   While the check runs a full-screen loader covers the login screen, so a
   signed-in user never sees the form flash past (and an expired session
   just reveals the form when the loader lifts). No credentials are ever
   stored in the browser. */

(function(){
  if(typeof window === 'undefined') return;

  var OVERLAY_ID = 'crs-resume-overlay';

  function showResumeLoader(){
    if(document.getElementById(OVERLAY_ID)) return;
    var st = document.createElement('style');
    st.textContent =
      '@keyframes crsResumeSpin{to{transform:rotate(360deg)}}' +
      '#' + OVERLAY_ID + '{position:fixed;inset:0;z-index:99999;display:flex;flex-direction:column;' +
      'align-items:center;justify-content:center;gap:18px;' +
      'background:linear-gradient(160deg,#0F2B52 0%,#123A6B 55%,#0B2545 100%)}' +
      '#' + OVERLAY_ID + ' .crs-resume-ring{width:46px;height:46px;border-radius:50%;' +
      'border:4px solid rgba(255,255,255,.18);border-top-color:#7DD3FC;' +
      'animation:crsResumeSpin .8s linear infinite}' +
      '#' + OVERLAY_ID + ' .crs-resume-txt{color:rgba(255,255,255,.85);font-size:14px;font-weight:600;' +
      'font-family:inherit;letter-spacing:.3px}';
    document.head.appendChild(st);

    var ov = document.createElement('div');
    ov.id = OVERLAY_ID;
    ov.innerHTML =
      '<div class="crs-resume-ring"></div>' +
      '<div class="crs-resume-txt">Signing you back in…</div>';
    document.body.appendChild(ov);
  }

  function hideResumeLoader(){
    var ov = document.getElementById(OVERLAY_ID);
    if(ov && ov.parentNode) ov.parentNode.removeChild(ov);
  }

  function crsResumeSession(){
    showResumeLoader();
    fetch('/api/session', {headers:{'Accept':'application/json'}})
      .then(function(r){
        if(r.status === 401) return null;              // no session — reveal the login form
        if(!r.ok) throw new Error('server returned ' + r.status);
        return r.json();
      })
      .then(function(body){
        if(!body || !body.user || typeof crsPersistEnter !== 'function'){
          hideResumeLoader();
          return;
        }
        return crsPersistEnter(body.user)
          .then(hideResumeLoader)
          .catch(function(err){
            // The cookie was valid but the data would not load — fall back to
            // a fresh sign-in rather than opening the app half-filled.
            hideResumeLoader();
            try{ console.warn('[session-resume] ' + (err && err.message ? err.message : err)); }catch(e){}
          });
      })
      .catch(function(err){
        // Resume is best-effort: any failure leaves the normal login flow.
        hideResumeLoader();
        try{ console.warn('[session-resume] ' + (err && err.message ? err.message : err)); }catch(e){}
      });
  }

  if(document.readyState === 'loading'){
    document.addEventListener('DOMContentLoaded', crsResumeSession);
  }else{
    crsResumeSession();
  }
})();
