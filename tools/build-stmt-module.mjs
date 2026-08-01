/**
 * Assembles the legacy statement engine into an importable ES module:
 *   src/generated/statements-legacy.js
 *
 * The statement builders are statutory print formats whose output must stay
 * byte-identical through the Next.js conversion (see golden/README.md).
 * Hand-rewriting ~4,000 lines of string-building guarantees drift, so the
 * REAL legacy source is wrapped instead: the files below are concatenated
 * verbatim inside a factory function whose prelude supplies everything the
 * excluded files used to provide (commodity lists, bag divisors, DOM shim,
 * store bindings), and whose epilogue re-points the store bindings at the
 * caller's data. tools/verify-statements.mjs proves the output against
 * golden/statements/ byte-for-byte.
 *
 * Regenerate after touching any of the source files:
 *   node tools/build-stmt-module.mjs
 */
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');

// Statement-relevant engine parts, in bundle order. Excluded files' symbols
// are supplied by the prelude below.
const FILES = [
  '06-users.js',          // getUsersForCRS, buildUserSignatureBlock, userStore
  '10-holidays.js',       // govt holiday calendar helpers
  '11-statement-core.js', // section registry, stmtGetData, print CSS
  '12-statement-builders.js',
  '22-allotment.js',      // stmtGetData wrapper: allotment on the data object
  '23-crs-master.js',     // stmtGetData wrapper: BC/packer from the master
  '24-coll.js',           // COLL statement family
  '26-crs29.js',          // CRS 29 statement family + section routing
  '29-dss-total.js',      // DSS total-row tweak
  '31-stmt-heading.js',   // statement heading rewrite (DOM-only, inert here)
  '39-staff-roles.js',    // staff post resolution from the users table
];

const PRELUDE = `
  // ── Environment shim ─────────────────────────────────────────────────────
  // The legacy code runs against a page; here it runs against ctx. Elements
  // it may look up resolve through ctx.dom (default: the empty-value selects
  // a signed-out page carries, which is the environment the golden snapshots
  // were captured in). Everything else DOM-ish is inert.
  var __dom = Object.assign({
    'me-crs': {value: ''}, 'me-month': {value: ''}, 'me-year': {value: ''},
    'stmt-crs': {value: ''}, 'stmt-month': {value: ''}, 'stmt-year': {value: ''},
    'rpt-crs': {value: ''}, 'entry-crs': {value: ''}, 'entry-date': {value: ''}
  }, ctx.dom || {});
  var document = {
    getElementById: function(id){ return Object.prototype.hasOwnProperty.call(__dom, id) ? __dom[id] : null; },
    querySelector: function(){ return null; },
    querySelectorAll: function(){ return []; },
    addEventListener: function(){},
    createElement: function(){ return {style:{}, dataset:{}, appendChild:function(){}, remove:function(){}, querySelector:function(){return null;}, setAttribute:function(){}}; },
    body: {appendChild: function(){}, removeChild: function(){}}
  };
  var window = ctx.window || {};
  var alert = function(){}; var confirm = function(){ return true; }; var prompt = function(){ return null; };
  var setTimeout = function(){}; var setInterval = function(){}; var clearInterval = function(){};
  var currentUser = ctx.currentUser || null;

  // ── Masters and constants from excluded engine parts ─────────────────────
  var CRS_LIST = ctx.CRS_LIST || [];
__DSS_LISTS__
  var STAFF_NAME_BLANK  = '________________';                       // 01-core.js
  var STAFF_PHONE_BLANK = '__________';
  var APP_CONFIG   = ctx.APP_CONFIG   || {};
  var CRS_ACCOUNTS = ctx.CRS_ACCOUNTS || {};
  var BAG_DIV = {PALM:10, SALT_CIS:25, SALT_RFFS:25, OOTY:50, TAN:50, PB_PALM:10};   // 03-daily-entry.js
  var BAG_DIV_DEFAULT = 50;
  function bagDiv(id){ return BAG_DIV[id] || BAG_DIV_DEFAULT; }
  function bagsOf(kgs, id){ var v = parseFloat(kgs) || 0; return v > 0 ? Math.floor(v / bagDiv(id)) : 0; }
  var SC_PACK_TYPES = {                                              // 03-daily-entry.js
    GUNNY: {BRA:50,NPHH_FRK:50,PHH_FRK:50,AAY_FRK:50,AAY:50,OAP:50,APS:50,TOOR:50,PHH_BRA:50,
            WHEAT:50,RRA:50,NPHH_RRA:50,PB_BRA:50,PB_WHEAT:50,PB_TOOR:50},
    POLY:  {SUGAR:50,AAY_SUGAR:50,SALT_CIS:25,SALT_RFFS:25,PB_SUGAR:50},
    CBOX:  {PALM:10,OOTY:50,TAN:50,PB_PALM:10}
  };
  function inspNet(adj){                                             // 03-daily-entry.js
    return (parseFloat(adj.excess) || 0)
         - (parseFloat(adj.shortage) || 0)
         - (parseFloat(adj.transfer) || 0);
  }
  function isHoliday(dateObj){                                       // 08-dashboard.js
    var d=dateObj.getDay(),dt=dateObj.getDate();
    var firstDay=new Date(dateObj.getFullYear(),dateObj.getMonth(),1).getDay();
    var weekNum=Math.ceil((dt+firstDay)/7);
    if(d===5&&(weekNum===1||weekNum===2)) return true;
    if(d===0&&(weekNum===3||weekNum===4)) return true;
    return false;
  }
  function getHolidayName(dateObj){                                  // 08-dashboard.js
    var d=dateObj.getDay(),dt=dateObj.getDate();
    var f=new Date(dateObj.getFullYear(),dateObj.getMonth(),1).getDay();
    var w=Math.ceil((dt+f)/7);
    if(d===5&&w===1) return '1st Friday Holiday';
    if(d===5&&w===2) return '2nd Friday Holiday';
    if(d===0&&w===3) return '3rd Sunday Holiday';
    if(d===0&&w===4) return '4th Sunday Holiday';
    return null;
  }
  var ME_MONTH_NAMES = ['','January','February','March','April','May','June',  // 05-monthly-entry.js
    'July','August','September','October','November','December'];
  var MNAMES = ME_MONTH_NAMES.slice();                               // 04-reports.js
  var ME_CARD_TYPES = [                                              // 15-monthly-extras.js
    {id:'rice',      label:'RICE CARD'},
    {id:'lof_rice',  label:'LOF RICE CARD'},
    {id:'sugar',     label:'SUGAR CARD'},
    {id:'lof_sugar', label:'LOF SUGAR'},
    {id:'aay',       label:'AAY CARD'},
    {id:'lof_aay',   label:'LOF AAY CARD'},
    {id:'oap',       label:'OAP'},
    {id:'police',    label:'POLICE'},
    {id:'n_card',    label:'"N" CARD'}
  ];
  var ME_GUNNY_ITEMS = [{id:'ss50', label:'50 KG SS'}, {id:'poly', label:'POLY'}, {id:'cbox', label:'C.BOX'}];
  var CRS29_KERO = {label:'KEROSENE', id:'KERO', allotId:'KERO', div:50, rate:15.60, unit:'LTR', ta:'மண்ணெண்ணெய்'};

  // ── Store bindings (re-pointed at ctx.stores after the includes) ─────────
  var entryStore = {}, inspectionStore = {}, monthlyStore = {}, meManualStore = {},
      meSourceStore = {}, meRemitStore = {}, meGunnyStore = {}, meCardStore = {},
      salesCloseStore = {}, receiptStore = [];

  // ── Stubs for wrapped-but-absent screen functions ────────────────────────
  // Side-effect wrappers in the included files re-wrap these; the statement
  // build never calls them.
  var markSalesClose = function(){}; var saveEntryForm = function(){};
  var meCardCalc = function(){}; var meGunnyRefreshReceipts = function(){};
  var onEntryChange = function(){}; var clearEntryForm = function(){};
  var onMonthlyChange = function(){}; var enterApp = function(){};
  var showPage = function(){}; var buildDashboard = function(){};
  var refreshDashboard = function(){}; var renderMeSection = function(){};
  var buildMeCardTable = function(){}; var buildMeAllotTable = function(){};
  var applyAdjColVisibility = function(){}; var recalcMe = function(){};
  var rebuildMonthlyFromDaily = ctx.rebuildMonthlyFromDaily || null;
`;

const EPILOGUE = `
  // ── Hydrate the store bindings from the caller ───────────────────────────
  var __s = ctx.stores || {};
  entryStore      = __s.entryStore      || {};
  inspectionStore = __s.inspectionStore || {};
  monthlyStore    = __s.monthlyStore    || {};
  meManualStore   = __s.meManualStore   || {};
  meSourceStore   = __s.meSourceStore   || {};
  meRemitStore    = __s.meRemitStore    || {};
  meGunnyStore    = __s.meGunnyStore    || {};
  meCardStore     = __s.meCardStore     || {};
  salesCloseStore = __s.salesCloseStore || {};
  receiptStore    = __s.receiptStore    || [];
  meAllotStore    = __s.meAllotStore    || {};
  meCardConfirmed = __s.meCardConfirmed || {};
  if (typeof meAdvanceStore !== 'undefined') meAdvanceStore = __s.meAdvanceStore || {};
  userStore = ctx.users || [];
  if (ctx.CRS_MASTER && ctx.CRS_MASTER.length) CRS_MASTER = ctx.CRS_MASTER;
  if (ctx.TN_GOVT_HOLIDAYS) TN_GOVT_HOLIDAYS = ctx.TN_GOVT_HOLIDAYS;

  return {
    getData: function(crsId, month, year){ return stmtGetData(crsId, month, year); },
    buildSection: function(sectionId, d){ return buildSectionHTML(sectionId, d); },
    sectionsFor: function(crsId){
      return (typeof isCrs29 === 'function' && isCrs29(crsId)) ? CRS29_SECTIONS : STMT_SECTIONS_STANDARD;
    },
    printCss: STMT_PRINT_CSS
  };
`;

// DSS_A / DSS_B verbatim from 03-daily-entry.js (the file itself is too
// DOM-bound to include whole).
const daily = readFileSync(join(root, 'src', 'legacy', '03-daily-entry.js'), 'utf8').replace(/\r\n/g, '\n');
const slice = (marker) => {
  const from = daily.indexOf(`var ${marker} = [`);
  const to = daily.indexOf('];', from);
  if (from === -1 || to === -1) throw new Error(`could not extract ${marker} from 03-daily-entry.js`);
  return daily.slice(from, to + 2);
};
const dssLists = `  ${slice('DSS_A')}\n  ${slice('DSS_B')}\n`;

let body = '';
for (const f of FILES) {
  const src = readFileSync(join(root, 'src', 'legacy', f), 'utf8').replace(/\r\n/g, '\n');
  body += `\n/* ═══ ${f} ${'═'.repeat(Math.max(0, 60 - f.length))} */\n${src}\n`;
}

const out =
  '/* AUTO-GENERATED by tools/build-stmt-module.mjs — DO NOT EDIT.\n' +
  `   Sources: ${FILES.join(', ')}\n` +
  '   The legacy statement engine, verbatim, behind a context shim. See the\n' +
  '   generator header for why. Verified byte-for-byte by\n' +
  '   tools/verify-statements.mjs against golden/statements/. */\n' +
  '/* eslint-disable */\n' +
  '// @ts-nocheck\n' +
  'export function createStatementEngine(ctx) {\n' +
  PRELUDE.replace('__DSS_LISTS__', dssLists) +
  body +
  EPILOGUE +
  '\n}\n';

mkdirSync(join(root, 'src', 'generated'), { recursive: true });
writeFileSync(join(root, 'src', 'generated', 'statements-legacy.js'), out, 'utf8');
console.log(`src/generated/statements-legacy.js: ${out.length.toLocaleString()} chars from ${FILES.length} sources`);

// ── DSS module ──────────────────────────────────────────────────────────────
// 17-dss-export.js (preview + styled .xlsx) wrapped the same way, but with a
// REAL-DOM passthrough: the ctx.dom map answers only for the ids the caller
// sets ('entry-crs', 'entry-date'); everything else (creating the viewer
// overlay, loading the Excel writer, printing) reaches the actual page. The
// statement module stays fully inert — only this one touches the DOM.
const DSS_PRELUDE = `
  var __dom = ctx.dom || {};
  var __realDoc = ctx.document || (typeof globalThis !== 'undefined' ? globalThis.document : null);
  var document = {
    getElementById: function(id){
      if (Object.prototype.hasOwnProperty.call(__dom, id)) return __dom[id];
      return __realDoc ? __realDoc.getElementById(id) : null;
    },
    createElement: function(t){ return __realDoc.createElement(t); },
    get head(){ return __realDoc.head; },
    get body(){ return __realDoc.body; }
  };
  var window = ctx.window || (typeof globalThis !== 'undefined' ? globalThis : {});
  var alert = window.alert ? window.alert.bind(window) : function(){};
  var CRS_LIST = ctx.CRS_LIST || [];
  var APP_CONFIG = ctx.APP_CONFIG || {};
  var CRS_ACCOUNTS = ctx.CRS_ACCOUNTS || {};
  function cerealAccountNo(crsId){                                   // 01-core.js
    var v = CRS_ACCOUNTS[crsId] || CRS_ACCOUNTS[String(crsId)] || APP_CONFIG.cerealAccountNo;
    return v || '';
  }
  function inspNet(adj){                                             // 03-daily-entry.js
    return (parseFloat(adj.excess) || 0)
         - (parseFloat(adj.shortage) || 0)
         - (parseFloat(adj.transfer) || 0);
  }
  var onEntryChange = function(){};
  var entryStore = {}, inspectionStore = {};
__DSS_LISTS__
`;

const DSS_EPILOGUE = `
  var __s = ctx.stores || {};
  entryStore = __s.entryStore || {};
  inspectionStore = __s.inspectionStore || {};

  // The viewer's toolbar buttons carry inline onclick strings that resolve
  // against the page's window at click time.
  if (window && __realDoc) window.downloadDSSExcel = downloadDSSExcel;

  return {
    openPreview: function(crsId, date){
      __dom['entry-crs'] = { value: String(crsId) };
      __dom['entry-date'] = { value: date || '' };
      return openDSSPreview();
    },
    downloadExcel: function(crsId, date){
      __dom['entry-crs'] = { value: String(crsId) };
      __dom['entry-date'] = { value: date || '' };
      return downloadDSSExcel();
    }
  };
`;

const dssSrc = readFileSync(join(root, 'src', 'legacy', '17-dss-export.js'), 'utf8').replace(/\r\n/g, '\n');
const dssOut =
  '/* AUTO-GENERATED by tools/build-stmt-module.mjs — DO NOT EDIT.\n' +
  '   Source: 17-dss-export.js (DSS preview + styled Excel export), verbatim,\n' +
  '   behind a real-DOM passthrough shim. */\n' +
  '/* eslint-disable */\n' +
  '// @ts-nocheck\n' +
  'export function createDssEngine(ctx) {\n' +
  DSS_PRELUDE.replace('__DSS_LISTS__', dssLists) +
  `\n/* ═══ 17-dss-export.js ═══ */\n${dssSrc}\n` +
  DSS_EPILOGUE +
  '\n}\n';
writeFileSync(join(root, 'src', 'generated', 'dss-legacy.js'), dssOut, 'utf8');
console.log(`src/generated/dss-legacy.js: ${dssOut.length.toLocaleString()} chars`);
