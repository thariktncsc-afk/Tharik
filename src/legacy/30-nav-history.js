/* Browser back/forward navigation  [+]
   Added after the port; not part of TNCSC_CRS_Demo_19 (1).html, so
   tools/verify-parity.mjs skips this file (see NEW_ENGINE there).

   The ported showPage() only ever toggled which .page has the "active" class —
   it never touched history, so the browser had exactly one entry for the whole
   session (the initial load). Pressing Back therefore left the app entirely,
   which from inside an iframe or a fresh tab reads as "Back takes me to the
   login page" no matter how many screens were visited in between.

   This wires the existing navigation into the History API without changing
   the URL: every push carries only a `{page: id}` state object against the
   SAME url, so Next's own router (which reacts to actual path/query changes)
   never sees these calls and is not involved.

   THE FUNNEL. Every in-app navigation already goes through one of three
   functions, so wrapping those three is enough to cover the whole app:
     showPage(id, el)  — all 11 sidebar items, the dashboard's own navTo(),
                          and the role-gate's internal fallback redirect
                          (which calls the identifier `showPage`, resolving to
                          THIS wrapper at call time, so it is covered too)
     enterApp(user)    — the post-login landing page. It paints the dashboard
                          directly rather than calling showPage(), so it needs
                          its own push
     doLogout()        — returns to the login screen without a page reload

   Rather than trust the `id` argument (which the role-gate can override
   mid-call via its own recursive showPage() call), each wrapper reads back
   whichever .page actually ended up with the "active" class once the call is
   done, and pushes THAT. history is deduplicated against the last pushed
   page, so the fallback recursion — an outer call and the inner redirect it
   triggers, both wrapped — only ever produces one entry.

   Loads last, so every enterApp/doLogout installed by 20/21/22/25 already
   exists and this sits outermost, running once after all of them. */

var navSuppressPush = false;   // true while replaying a popstate — never re-push
var navLastPushedPage = null;  // dedupe: skip a push that would repeat the top entry

function navActivePageId(){
  var el = document.querySelector('.page.active');
  return el ? el.id.replace(/^page-/, '') : null;
}

function navPush(pageId){
  if(!pageId || pageId === navLastPushedPage) return;
  try{
    history.pushState({page: pageId}, '', location.pathname + location.search);
    navLastPushedPage = pageId;
  }catch(e){ /* pushState can throw under sandboxed/about:blank framing — non-fatal */ }
}

// ── showPage: push whatever ended up on screen ──────────────────────────────
var _navOrigShowPage = showPage;
showPage = function(){
  var r = _navOrigShowPage.apply(this, arguments);
  if(!navSuppressPush) navPush(navActivePageId());
  return r;
};

// ── enterApp: the ported code paints the dashboard directly, not via
// showPage(), so the post-login landing page needs its own push ───────────
var _navOrigEnterApp = enterApp;
enterApp = function(){
  var r = _navOrigEnterApp.apply(this, arguments);
  if(!navSuppressPush) navPush(navActivePageId() || 'dashboard');
  return r;
};

// ── doLogout: seals the session. Pushing (not replacing) here also discards
// any forward entries into the ended session — the browser truncates the
// forward stack the moment you push from a position that is not already the
// top, which is exactly the "logout ends this session's history" behaviour
// requirement 3 asks for. ───────────────────────────────────────────────────
var _navOrigDoLogout = doLogout;
doLogout = function(){
  var r = _navOrigDoLogout.apply(this, arguments);
  if(navSuppressPush) navLastPushedPage = 'login';
  else navPush('login');
  return r;
};

// ── Back / forward ───────────────────────────────────────────────────────────
window.addEventListener('popstate', function(e){
  navSuppressPush = true;
  try{
    var pageId = e.state && e.state.page;

    if(!pageId || pageId === 'login'){
      // Landed on the pre-login entry. If a session is still live, this IS the
      // intentional "back past the first page" case the spec describes, not
      // an unexpected redirect — end it the same way the Sign Out button does.
      if(typeof currentUser !== 'undefined' && currentUser) doLogout();
      navLastPushedPage = 'login';
      return;
    }

    if(typeof currentUser !== 'undefined' && currentUser){
      var navEl = document.querySelector('.nav-item[onclick*="\'' + pageId + '\'"]');
      showPage(pageId, navEl);
      navLastPushedPage = navActivePageId() || pageId;
      return;
    }

    // No live session (already logged out, or a fresh tab landed mid-stack via
    // forward) and the target state needs one: there is nothing to restore
    // without credentials. The login screen is already the visible state, so
    // there is nothing to repaint — just keep the bookkeeping consistent for
    // whatever back/forward comes next.
    navLastPushedPage = 'login';
  } finally {
    navSuppressPush = false;
  }
});

// ── Base state ────────────────────────────────────────────────────────────
// Every fresh load starts unauthenticated (nothing is persisted — see the
// README), so the entry the browser already has for this load IS the login
// page; label it rather than push a duplicate.
(function initNavHistory(){
  try{
    history.replaceState({page: 'login'}, '', location.pathname + location.search);
    navLastPushedPage = 'login';
  }catch(e){}
})();
