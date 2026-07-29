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
})();
