/* Who holds which post comes from the users table  [+]
   Added after the port; listed in NEW_ENGINE in tools/verify-parity.mjs.

   25-crs-profile.js points getUsersForCRS() at CRS_MASTER, so the dashboard's
   staff blocks label people by the field they occupy in the sheet — a name in
   `bc:` is shown as "BILL CLERK (BC)" whatever their account says. The sidebar
   meanwhile shows currentUser.role, which comes from the users table. When the
   two disagree the same person is a Bill Clerk on the shop card and a Packer in
   the sidebar, and no amount of editing on the Users screen can reconcile it,
   because that screen writes to the table the card never reads.

   Users are administered in the database now, so the database decides. Roles
   come from userStore; CRS_MASTER keeps what it is genuinely the authority on —
   shop code, COLL and police flags, usage status.

   A shop with no accounts at all still falls back to the sheet, so shops that
   have never been set up keep showing the staff the office listed for them. */

(function(){
  if(typeof window === 'undefined') return;
  if(typeof getUsersForCRS !== 'function') return;

  var fromMaster = getUsersForCRS;   // the 25-crs-profile.js version

  getUsersForCRS = function(crsId){
    if(typeof userStore === 'undefined' || !Array.isArray(userStore)){
      return fromMaster(crsId);
    }

    var mine = userStore.filter(function(u){
      return u.crsId === crsId && u.active !== false;
    });

    // Never been set up — the sheet is still the best answer available.
    if(!mine.length) return fromMaster(crsId);

    function firstWithRole(role){
      for(var i=0; i<mine.length; i++){
        if(mine[i].role === role) return mine[i];
      }
      return null;
    }

    return {
      bc:     firstWithRole('BC'),
      packer: firstWithRole('Packer')
    };
  };

  /* The dashboard's staff blocks are only ever shown, never hidden.
     08-dashboard.js does:

       if(staff.bc && bcB){ bcB.style.display='block'; ...fill name/phone... }

     with no else — so a shop that has no Bill Clerk keeps whatever the last
     shop put there. Switching from CRS 23 to CRS 8 left "Shankaran" sitting in
     CRS 8's packer block, which reads as CRS 8 having staff it does not have.

     Latent before, because the roster came from CRS_MASTER and nearly every
     shop filled both posts. Once roles came from the users table many shops
     legitimately have only one person, and the leftover became visible. */
  function dashClearEmptyStaffBlocks(){
    var me = (typeof currentUser !== 'undefined') ? currentUser : null;
    if(!me || !me.crsId) return;
    var staff = (typeof getUsersForCRS === 'function') ? (getUsersForCRS(me.crsId) || {}) : {};

    [['dash-bc-block', 'bc', 'dash-bc-name', 'dash-bc-phone'],
     ['dash-packer-block', 'packer', 'dash-packer-name', 'dash-packer-phone']].forEach(function(p){
      var block = document.getElementById(p[0]);
      if(!block || staff[p[1]]) return;
      block.style.display = 'none';
      // Blank the text too, so nothing stale can flash if it is shown again.
      var n = document.getElementById(p[2]); if(n) n.textContent = '';
      var t = document.getElementById(p[3]); if(t) t.textContent = '';
    });
  }

  if(typeof buildDashboard === 'function'){
    var origBuildDashboard = buildDashboard;
    buildDashboard = function(){
      var out = origBuildDashboard.apply(this, arguments);
      try{ dashClearEmptyStaffBlocks(); }catch(e){}
      return out;
    };
  }
})();
