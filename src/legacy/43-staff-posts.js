/* Who signs a statement, and under which title — from the users table  [+]

   Every statement names the shop's staff: "NAME OF THE B.C", "BILL CLERK :",
   "SIGNATURE OF BC", a mobile number. Until now every one of those lines
   said Bill Clerk, and the name came from CRS_MASTER's `bc:` column
   (23-crs-master.js) — which is a column in a spreadsheet, not a role. Five
   shops (5, 8, 19, 28, 29) have a PACKER there and no Bill Clerk at all, so
   their Packer was printed as the Bill Clerk on every sheet; and a shop with
   both posts only ever showed one.

   The users table is where roles are assigned and changed (Users screen), so
   it decides (office, 2026-09-21):
     - only a Bill Clerk  → only B.C lines, the Bill Clerk's name and phone;
     - only a Packer      → only P.K.R lines, the Packer's name and phone;
     - both               → both, each with its own name and phone, BC first;
     - neither            → no staff line at all — never an empty "B.C" label.
   Moving someone from BC to Packer on the Users screen changes every
   statement on the next render: the server reads the users table afresh each
   time (payments/server.ts → loadStatementEngine).

   d.posts is the list; the builders print one line per entry with the
   wording their sheet already used (B.C / BILL CLERK / BC), swapped for the
   Packer's (P.K.R / PACKER / PKR). d.bcName / d.packerName are reset from the
   same source, so nothing can print the master's name under the wrong title.

   Must come AFTER 23-crs-master.js in FILES — it undoes that file's name
   override. */

var STAFF_POSTS = [
  {key:'bc',     abbr:'BC',  short:'B.C',   title:'BILL CLERK'},
  {key:'packer', abbr:'PKR', short:'P.K.R', title:'PACKER'}
];

/** The shop's posts that are actually filled, BC first. */
function stmtPosts(d){ return (d && d.posts) || []; }

/**
 * One line per filled post, joined — `fn(post)` words the line. A shop with no
 * staff gets '' — the label is left out, never printed empty.
 */
function staffJoin(d, fn, sep){
  return stmtPosts(d).map(fn).join(sep == null ? '<br>' : sep);
}

/** The phone, or the ruled blank for a person whose number is not on record. */
function staffPhone(p){ return (p && p.phone) ? p.phone : STAFF_PHONE_BLANK; }

/**
 * A phone line's caption: plain when there is one person, naming the post
 * when there are two, so neither number can be read as the other's.
 */
function staffPhoneLabel(d, p, base){
  return stmtPosts(d).length > 1 ? base.replace(/\s*:?\s*$/, '') + ' (' + p.short + ') : ' : base;
}

var _postsOrigStmtGetData = stmtGetData;
stmtGetData = function(crsId, month, year){
  var d = _postsOrigStmtGetData.apply(this, arguments);
  try{
    var staff = (typeof getUsersForCRS === 'function') ? (getUsersForCRS(parseInt(crsId, 10)) || {}) : {};
    d.posts = STAFF_POSTS.filter(function(p){
      return staff[p.key] && staff[p.key].fullName;
    }).map(function(p){
      var u = staff[p.key];
      return {key:p.key, abbr:p.abbr, short:p.short, title:p.title, name:u.fullName, phone:u.phone || ''};
    });
    d.bcName      = staff.bc     ? staff.bc.fullName          : '';
    d.bcPhone     = staff.bc     ? (staff.bc.phone || '')     : '';
    d.packerName  = staff.packer ? staff.packer.fullName      : '';
    d.packerPhone = staff.packer ? (staff.packer.phone || '') : '';
  }catch(e){}
  return d;
};
