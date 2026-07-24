/* Receipt Register + packing calculator
   Verbatim from TNCSC_CRS_Demo_19 (1).html lines 4747-5199.
   These parts are concatenated back into one classic script by
   tools/bundle-engine.mjs - the code hoists across the whole block and
   its declarations must stay global for the markup's inline handlers. */
function initReceiptPage(){
  // Always rebuild dropdowns based on current user (admin=all, CRS user=own shop only)
  var sel  = document.getElementById('rp-crs');
  var fsel = document.getElementById('rp-filter-crs');

  // Determine which shops to show
  var isCrsUser = currentUser && currentUser.crsId && currentUser.role !== 'ADMIN';
  var shopList  = isCrsUser
    ? CRS_LIST.filter(function(c){ return c.id === currentUser.crsId; })
    : CRS_LIST;

  // Rebuild both dropdowns fresh each time (handles login/logout correctly)
  if(sel){
    sel.innerHTML = '<option value="">Select CRS...</option>';
    shopList.forEach(function(c){
      var o = document.createElement('option');
      o.value = String(c.id);
      o.textContent = 'CRS ' + c.id + ' — ' + c.name;
      sel.appendChild(o);
    });
  }
  if(fsel){
    fsel.innerHTML = '<option value="">All CRS Shops</option>';
    shopList.forEach(function(c){
      var o = document.createElement('option');
      o.value = String(c.id);
      o.textContent = 'CRS ' + c.id + ' — ' + c.name;
      fsel.appendChild(o);
    });
  }

  // Date defaults
  var dateEl = document.getElementById('rp-date');
  if(dateEl && !dateEl.value) dateEl.value = new Date().toISOString().split('T')[0];
  var mEl = document.getElementById('rp-filter-month');
  if(mEl && !mEl.value){
    var n = new Date();
    mEl.value = n.getFullYear() + '-' + String(n.getMonth()+1).padStart(2,'0');
  }

  // Auto-select CRS and trigger table for CRS users
  if(isCrsUser){
    if(sel)  sel.value  = String(currentUser.crsId);
    if(fsel) fsel.value = String(currentUser.crsId);
    rpBuildTable();
  }

  renderReceiptLog();
}

function openReceiptForm(){var f=document.getElementById('rp-form');if(f)f.style.display='block';rpBuildTable();}
function closeReceiptForm(){var f=document.getElementById('rp-form');if(f)f.style.display='none';}

function rpBuildTable(){
  var tbody = document.getElementById('rp-tbody');
  if(!tbody) return;
  tbody.innerHTML = '';
  var allComms = (typeof DSS_A!=='undefined'?DSS_A:[]).concat(typeof DSS_B!=='undefined'?DSS_B:[]);

  // ── Packing rules ─────────────────────────────────────────────────────────
  // Each rule: {type, div, label, countLabel, qtyLabel}
  // Commodities can have 1 or 2 packing types (e.g. GUNNY only, or GUNNY+POLY)
  var packingRules = {
    // ── GUNNY (qty ÷ 50 = bags) ────────────────────────────────────────────
    'BRA':       [{type:'GUNNY', div:50, label:'Gunny', countLabel:'bags', qtyLabel:'kgs'}],
    'NPHH_FRK':  [{type:'GUNNY', div:50, label:'Gunny', countLabel:'bags', qtyLabel:'kgs'}],
    'PHH_FRK':   [{type:'GUNNY', div:50, label:'Gunny', countLabel:'bags', qtyLabel:'kgs'}],
    'AAY_FRK':   [{type:'GUNNY', div:50, label:'Gunny', countLabel:'bags', qtyLabel:'kgs'}],
    'AAY':       [{type:'GUNNY', div:50, label:'Gunny', countLabel:'bags', qtyLabel:'kgs'}],
    'OAP':       [{type:'GUNNY', div:50, label:'Gunny', countLabel:'bags', qtyLabel:'kgs'}],
    'APS':       [{type:'GUNNY', div:50, label:'Gunny', countLabel:'bags', qtyLabel:'kgs'}],
    'TOOR':      [{type:'GUNNY', div:50, label:'Gunny', countLabel:'bags', qtyLabel:'kgs'}],
    'PHH_BRA':   [{type:'GUNNY', div:50, label:'Gunny', countLabel:'bags', qtyLabel:'kgs'}],
    // ── SWITCHABLE: GUNNY or POLY (Wheat, RRA, NPHH FRK RRA) ───────────────
    // These come in either gunny bags OR poly bags depending on the godown
    'WHEAT':     [{type:'GUNNY', div:50, label:'Gunny', countLabel:'bags', qtyLabel:'kgs'}, 'SWITCHABLE'],
    'RRA':       [{type:'GUNNY', div:50, label:'Gunny', countLabel:'bags', qtyLabel:'kgs'}, 'SWITCHABLE'],
    'NPHH_RRA':  [{type:'GUNNY', div:50, label:'Gunny', countLabel:'bags', qtyLabel:'kgs'}, 'SWITCHABLE'],
    // ── C.BOX ──────────────────────────────────────────────────────────────
    'PALM':      [{type:'CBOX',  div:10, label:'C.Box', countLabel:'boxes', qtyLabel:'pkts'}],
    'OOTY':      [{type:'CBOX',  div:50, label:'C.Box', countLabel:'boxes', qtyLabel:'pkts'}],
    'TAN':       [{type:'CBOX',  div:50, label:'C.Box', countLabel:'boxes', qtyLabel:'pkts'}],
    // ── POLY (Sugar & Salt) ─────────────────────────────────────────────────
    'SUGAR':     [{type:'POLY',  div:50, label:'Poly',  countLabel:'poly',  qtyLabel:'kgs'}],
    'AAY_SUGAR': [{type:'POLY',  div:50, label:'Poly',  countLabel:'poly',  qtyLabel:'kgs'}],
    'SALT_CIS':  [{type:'POLY',  div:25, label:'Poly',  countLabel:'poly',  qtyLabel:'pkts'}],
    'SALT_RFFS': [{type:'POLY',  div:25, label:'Poly',  countLabel:'poly',  qtyLabel:'pkts'}],
    // ── DSS_B Police items — GUNNY ──────────────────────────────────────────
    'PB_BRA':    [{type:'GUNNY', div:50, label:'Gunny', countLabel:'bags', qtyLabel:'kgs'}, 'SWITCHABLE'],
    'PB_WHEAT':  [{type:'GUNNY', div:50, label:'Gunny', countLabel:'bags', qtyLabel:'kgs'}],
    'PB_TOOR':   [{type:'GUNNY', div:50, label:'Gunny', countLabel:'bags', qtyLabel:'kgs'}],
    'PB_SUGAR':  [{type:'POLY',  div:50, label:'Poly',  countLabel:'poly',  qtyLabel:'kgs'}],
    'PB_PALM':   [{type:'CBOX',  div:10, label:'C.Box', countLabel:'boxes', qtyLabel:'pkts'}],
  };

  // ── Badge colours ──────────────────────────────────────────────────────────
  var packColors = {
    'GUNNY': {bg:'#FEF9C3', border:'#FDE047', text:'#854D0E', badge:'#F59E0B'},
    'CBOX':  {bg:'#FEE2E2', border:'#FCA5A5', text:'#991B1B', badge:'#EF4444'},
    'POLY':  {bg:'#DCFCE7', border:'#86EFAC', text:'#14532D', badge:'#16A34A'},
  };

  allComms.forEach(function(c, i){
    var rules = packingRules[c.id] || null;
    var rowBg = i%2===0 ? '#fff' : '#FAFCFF';
    var tr = document.createElement('tr');
    tr.style.background = rowBg;

    // ── Qty input ───────────────────────────────────────────────────────────
    var qtyCell = '<td style="padding:5px 8px;border-bottom:1px solid #F0F9FF;background:#EFF6FF">' +
      '<input type="number" min="0" step="0.001" placeholder="0.000"' +
      ' data-id="' + c.id + '"' +
      ' oninput="rpUpdatePacking(this)"' +
      ' style="width:100px;border:1px solid #BAE6FD;border-radius:6px;padding:5px 8px;' +
             'font-size:12px;text-align:right;font-weight:600"/>' +
      '</td>';

    // ── Packing cell — editable inputs pre-filled by formula ────────────────
    var packCell = '';
    var isSwitchable = rules && rules.indexOf('SWITCHABLE') > -1;
    var actualRules  = rules ? rules.filter(function(r){ return r !== 'SWITCHABLE'; }) : [];

    if(actualRules.length > 0){
      var packParts = actualRules.map(function(rule){
        var col = packColors[rule.type];
        // Toggle button (only for switchable commodities)
        var toggleBtn = '';
        if(isSwitchable){
          var isGunny = rule.type === 'GUNNY';
          toggleBtn = '<button type="button"' +
            ' id="rp-toggle-' + c.id + '"' +
            ' data-id="' + c.id + '"' +
            ' data-current="' + rule.type + '"' +
            ' onclick="rpTogglePackType(this)"' +
            ' title="Switch between GUNNY / POLY"' +
            ' style="background:' + (isGunny?'#F59E0B':'#16A34A') + ';color:#fff;border:none;' +
                   'border-radius:4px;padding:2px 6px;font-size:8px;font-weight:800;cursor:pointer;' +
                   'flex-shrink:0;white-space:nowrap">⇄ Switch</button>';
        }
        return '<div id="rp-packrow-' + c.id + '"' +
              ' style="display:flex;align-items:center;gap:6px;margin-bottom:3px;' +
                    'background:' + col.bg + ';border-radius:6px;padding:4px 6px;border:1px solid ' + col.border + '">' +
          // Badge
          '<span id="rp-badge-' + c.id + '"' +
            ' style="background:' + col.badge + ';color:#fff;font-size:9px;font-weight:800;' +
                'padding:1px 5px;border-radius:3px;flex-shrink:0">' + rule.label.toUpperCase() + '</span>' +
          // Count input (editable)
          '<input type="number" min="0" step="1"' +
            ' id="rp-pack-count-' + c.id + '-' + rule.type + '"' +
            ' data-id="' + c.id + '" data-type="' + rule.type + '" data-div="' + rule.div + '" data-field="count"' +
            ' placeholder="0"' +
            ' style="width:52px;border:1px solid ' + col.border + ';border-radius:5px;padding:3px 5px;' +
                   'font-size:12px;font-weight:800;text-align:center;color:' + col.text + ';background:#fff"' +
            ' oninput="rpPackCountEdited(this)"/>' +
          '<span id="rp-countlbl-' + c.id + '" style="font-size:9px;color:' + col.text + '">' + rule.countLabel + '</span>' +
          '<span style="font-size:10px;color:' + col.text + ';margin-left:2px">= </span>' +
          '<input type="number" min="0" step="0.001"' +
            ' id="rp-pack-qty-' + c.id + '-' + rule.type + '"' +
            ' data-id="' + c.id + '" data-type="' + rule.type + '" data-div="' + rule.div + '" data-field="qty"' +
            ' placeholder="0.000"' +
            ' style="width:70px;border:1px solid ' + col.border + ';border-radius:5px;padding:3px 5px;' +
                   'font-size:11px;font-weight:600;text-align:right;color:' + col.text + ';background:#fff"' +
            ' oninput="rpPackQtyEdited(this)"/>' +
          '<span id="rp-qtylbl-' + c.id + '" style="font-size:9px;color:' + col.text + '">' + rule.qtyLabel + '</span>' +
          toggleBtn +
        '</div>';
      }).join('');
      packCell = '<td style="padding:4px 8px;border-bottom:1px solid #F0F9FF;min-width:300px">' + packParts + '</td>';
    } else {
      packCell = '<td style="padding:5px 8px;border-bottom:1px solid #F0F9FF;text-align:center;color:#CBD5E1;font-size:11px">—</td>';
    }

    tr.innerHTML =
      '<td style="padding:7px 10px;text-align:center;font-size:11px;color:var(--muted);border-bottom:1px solid #F0F9FF">' + (i+1) + '</td>' +
      '<td style="padding:7px 12px;border-bottom:1px solid #F0F9FF">' +
        '<div style="font-weight:600;font-size:12px">' + c.ta + '</div>' +
        '<div style="font-size:10px;color:var(--muted)">' + c.en + '</div>' +
      '</td>' +
      '<td style="padding:7px 10px;text-align:center;font-size:11px;color:var(--muted);border-bottom:1px solid #F0F9FF">' + c.unit + '</td>' +
      qtyCell +
      packCell;
    tbody.appendChild(tr);
  });
}

// ── Toggle GUNNY ↔ POLY for switchable commodities (Wheat, RRA, NPHH FRK RRA) ──
function rpTogglePackType(btn){
  var id       = btn.dataset.id;
  var current  = btn.dataset.current; // 'GUNNY' or 'POLY'
  var newType  = current === 'GUNNY' ? 'POLY' : 'GUNNY';
  var div      = 50; // both GUNNY and POLY use ÷50 for these commodities

  // Colour definitions
  var colors = {
    'GUNNY': {bg:'#FEF9C3', border:'#FDE047', text:'#854D0E', badge:'#F59E0B', label:'Gunny', countLabel:'bags', qtyLabel:'kgs'},
    'POLY':  {bg:'#DCFCE7', border:'#86EFAC', text:'#14532D', badge:'#16A34A', label:'Poly',  countLabel:'poly', qtyLabel:'kgs'},
  };
  var col = colors[newType];

  // Get current values to preserve them
  var oldCountEl = document.getElementById('rp-pack-count-' + id + '-' + current);
  var oldQtyEl   = document.getElementById('rp-pack-qty-'   + id + '-' + current);
  var countVal   = oldCountEl ? oldCountEl.value : '';
  var qtyVal     = oldQtyEl   ? oldQtyEl.value   : '';

  // Update the row background & border
  var row = document.getElementById('rp-packrow-' + id);
  if(row){
    row.style.background   = col.bg;
    row.style.borderColor  = col.border;
  }

  // Update badge
  var badge = document.getElementById('rp-badge-' + id);
  if(badge){
    badge.textContent       = col.label.toUpperCase();
    badge.style.background  = col.badge;
  }

  // Update count label
  var cntLbl = document.getElementById('rp-countlbl-' + id);
  if(cntLbl) cntLbl.textContent = col.countLabel;

  // Update qty label
  var qtyLbl = document.getElementById('rp-qtylbl-' + id);
  if(qtyLbl) qtyLbl.textContent = col.qtyLabel;

  // Rename the input IDs so rpUpdatePacking can find them
  if(oldCountEl){
    oldCountEl.id           = 'rp-pack-count-' + id + '-' + newType;
    oldCountEl.dataset.type = newType;
    oldCountEl.style.color  = col.text;
    oldCountEl.style.borderColor = col.border;
    oldCountEl.value        = countVal;
  }
  if(oldQtyEl){
    oldQtyEl.id             = 'rp-pack-qty-' + id + '-' + newType;
    oldQtyEl.dataset.type   = newType;
    oldQtyEl.style.color    = col.text;
    oldQtyEl.style.borderColor = col.border;
    oldQtyEl.value          = qtyVal;
  }

  // Update toggle button state
  btn.dataset.current      = newType;
  btn.style.background     = col.badge;
  btn.title                = 'Currently: ' + col.label + ' — click to switch';

  // Also update the rpUpdatePacking type lookup for this id
  // by storing the current type in a dataset on the qty-input element
  var qtyMainInput = document.querySelector('input[data-id="' + id + '"][oninput="rpUpdatePacking(this)"]');
  if(qtyMainInput) qtyMainInput.dataset.packtype = newType;
}

// ── Live update: qty typed → recalculate packing count & qty ─────────────────
function rpUpdatePacking(input){
  var id  = input.dataset.id;
  var qty = parseFloat(input.value) || 0;

  var dividers = {
    'BRA':50,'NPHH_FRK':50,'PHH_FRK':50,'AAY_FRK':50,'AAY':50,
    'RRA':50,'NPHH_RRA':50,'OAP':50,'APS':50,'WHEAT':50,'TOOR':50,
    'PALM':10,'OOTY':50,'TAN':50,
    'SUGAR':50,'AAY_SUGAR':50,'SALT_CIS':25,'SALT_RFFS':25,
    'PB_BRA':50,'PB_WHEAT':50,'PB_TOOR':50,'PB_SUGAR':50,'PB_PALM':10,'PHH_BRA':50,
  };
  var types = {
    'BRA':'GUNNY','NPHH_FRK':'GUNNY','PHH_FRK':'GUNNY','AAY_FRK':'GUNNY',
    'AAY':'GUNNY','RRA':'GUNNY','NPHH_RRA':'GUNNY','OAP':'GUNNY','APS':'GUNNY',
    'WHEAT':'GUNNY','TOOR':'GUNNY',
    'PALM':'CBOX','OOTY':'CBOX','TAN':'CBOX',
    'SUGAR':'POLY','AAY_SUGAR':'POLY','SALT_CIS':'POLY','SALT_RFFS':'POLY',
    'PB_BRA':'GUNNY','PB_WHEAT':'GUNNY','PB_TOOR':'GUNNY','PHH_BRA':'GUNNY',
    'PB_SUGAR':'POLY','PB_PALM':'CBOX',
  };

  var div   = dividers[id];
  // For switchable commodities (WHEAT, RRA, NPHH_RRA), check current toggle state
  var switchableIds = {WHEAT:1, RRA:1, NPHH_RRA:1, PB_BRA:1};
  var ptype;
  if(switchableIds[id]){
    // Find which type is currently active by checking which input ID exists
    var gunnyCnt = document.getElementById('rp-pack-count-' + id + '-GUNNY');
    var polyCnt  = document.getElementById('rp-pack-count-' + id + '-POLY');
    ptype = (gunnyCnt ? 'GUNNY' : (polyCnt ? 'POLY' : 'GUNNY'));
  } else {
    ptype = types[id];
  }
  if(!div || !ptype) return;

  var countEl = document.getElementById('rp-pack-count-' + id + '-' + ptype);
  var qtyEl   = document.getElementById('rp-pack-qty-'   + id + '-' + ptype);

  // Auto-calculate: count = floor(qty/div), qty displayed = actual qty entered
  // But if user already manually edited count, don't override it
  if(countEl && !countEl.dataset.manualEdit){
    countEl.value = qty ? Math.floor(qty / div) : '';
  }
  if(qtyEl && !qtyEl.dataset.manualEdit){
    qtyEl.value = qty ? qty.toFixed(3) : '';
  }
}

// ── Count edited manually → update qty display (count × div) ─────────────────
function rpPackCountEdited(input){
  input.dataset.manualEdit = '1';
  var id   = input.dataset.id;
  var div  = parseInt(input.dataset.div) || 50;
  var type = input.dataset.type;
  var cnt  = parseFloat(input.value) || 0;

  var qtyEl = document.getElementById('rp-pack-qty-' + id + '-' + type);
  if(qtyEl && !qtyEl.dataset.manualEdit){
    qtyEl.value = cnt ? (cnt * div).toFixed(3) : '';
  }
}

// ── Qty edited manually → update count display (qty ÷ div) ───────────────────
function rpPackQtyEdited(input){
  input.dataset.manualEdit = '1';
  var id   = input.dataset.id;
  var div  = parseInt(input.dataset.div) || 50;
  var type = input.dataset.type;
  var qty  = parseFloat(input.value) || 0;

  var cntEl = document.getElementById('rp-pack-count-' + id + '-' + type);
  if(cntEl && !cntEl.dataset.manualEdit){
    cntEl.value = qty ? Math.round(qty / div) : '';
  }
}

function saveReceipt(){
  var crsId=parseInt(document.getElementById('rp-crs').value);
  var date=document.getElementById('rp-date').value;
  var rpNo=document.getElementById('rp-no').value.trim();
  if(!crsId){alert('Please select a CRS shop.');return;}
  if(!date){alert('Please select a date.');return;}
  var items={};
  document.querySelectorAll('#rp-tbody input[data-id]').forEach(function(inp){
    var v=parseFloat(inp.value);if(v>0) items[inp.dataset.id]={qty:v};
  });
  if(!Object.keys(items).length){alert('Enter at least one commodity quantity.');return;}
  receiptStore.push({
    id:rpNextId++,crsId:crsId,date:date,
    receiptNo:rpNo||('R/'+new Date().getFullYear()+'/'+String(rpNextId).padStart(3,'0')),
    items:items,savedAt:new Date().toLocaleString('en-IN')
  });
  closeReceiptForm();
  renderReceiptLog();
  buildDashboard();
  var msg=document.createElement('div');
  msg.style.cssText='background:#DCFCE7;border:1px solid #86EFAC;border-radius:8px;padding:10px 14px;color:#15803D;font-size:13px;font-weight:600;margin-bottom:14px';
  msg.innerHTML='&#10003; Receipt saved successfully!';
  var wrap=document.getElementById('rp-log-wrap');
  if(wrap) wrap.parentNode.insertBefore(msg,wrap);
  setTimeout(function(){msg.remove();},4000);
}

function renderReceiptLog(){
  var wrap=document.getElementById('rp-log-wrap');
  var countEl=document.getElementById('rp-log-count');
  var fCRS=document.getElementById('rp-filter-crs')?document.getElementById('rp-filter-crs').value:'';
  var fMonth=document.getElementById('rp-filter-month')?document.getElementById('rp-filter-month').value:'';
  if(!wrap) return;
  var logs=receiptStore.filter(function(r){
    if(fCRS&&String(r.crsId)!==fCRS) return false;
    if(fMonth&&!r.date.startsWith(fMonth)) return false;
    return true;
  }).sort(function(a,b){return b.date.localeCompare(a.date);});
  if(countEl) countEl.textContent=logs.length+' receipt(s) found';
  if(!logs.length){
    wrap.innerHTML='<div style="text-align:center;padding:40px;color:var(--muted)"><div style="font-size:36px;margin-bottom:10px">&#129534;</div><div style="font-weight:600">No receipts found</div></div>';
    return;
  }
  var allComms=(typeof DSS_A!=='undefined'?DSS_A:[]).concat(typeof DSS_B!=='undefined'?DSS_B:[]);
  var out='<table style="width:100%;border-collapse:collapse"><thead><tr style="background:#F8FAFC">'+
    '<th style="padding:9px 14px;text-align:left;font-size:10px;font-weight:700;color:var(--muted);border-bottom:1px solid var(--border)">Date</th>'+
    '<th style="padding:9px 10px;font-size:10px;font-weight:700;color:var(--muted);border-bottom:1px solid var(--border)">CRS</th>'+
    '<th style="padding:9px 10px;font-size:10px;font-weight:700;color:var(--muted);border-bottom:1px solid var(--border)">Receipt No.</th>'+
    '<th style="padding:9px 10px;font-size:10px;font-weight:700;color:var(--muted);border-bottom:1px solid var(--border)">Commodities Received</th>'+
    '<th style="padding:9px 10px;text-align:center;font-size:10px;font-weight:700;color:var(--muted);border-bottom:1px solid var(--border)">Saved At</th>'+
    '</tr></thead><tbody>';
  logs.forEach(function(r){
    var crs=typeof CRS_LIST!=='undefined'?CRS_LIST.find(function(c){return c.id===r.crsId;}):null;
    var chips=Object.keys(r.items).map(function(id){
      var c=allComms.find(function(x){return x.id===id;});
      return '<span style="display:inline-flex;gap:3px;background:#E0F2FE;color:#0369A1;font-size:11px;font-weight:700;padding:2px 8px;border-radius:4px;margin:2px">'+(c?c.en:id)+': '+r.items[id].qty.toFixed(3)+'</span>';
    }).join('');
    out+='<tr>'+
      '<td style="padding:11px 14px;border-bottom:1px solid #F0F9FF;font-weight:700;font-size:13px">'+r.date+'</td>'+
      '<td style="padding:11px 10px;border-bottom:1px solid #F0F9FF;font-size:12px"><strong>CRS '+r.crsId+'</strong>'+(crs?' \u2014 '+crs.name:'')+'</td>'+
      '<td style="padding:11px 10px;border-bottom:1px solid #F0F9FF;font-size:12px;font-family:monospace;color:#0369A1">'+r.receiptNo+'</td>'+
      '<td style="padding:11px 10px;border-bottom:1px solid #F0F9FF">'+chips+'</td>'+
      '<td style="padding:11px 10px;border-bottom:1px solid #F0F9FF;text-align:center;font-size:11px;color:var(--muted)">'+r.savedAt+'</td>'+
    '</tr>';
  });
  wrap.innerHTML=out+'</tbody></table>';
}

// Patch showPage
var _origSP=typeof showPage==='function'?showPage:null;
showPage=function(id,el){
  // [S3] respect the gate in the base implementation
  if(typeof currentUser !== 'undefined' && currentUser && !canViewPage(id, currentUser)){
    if(_origSP) _origSP(id,el);   // shows the toast + redirects
    return;
  }
  if(_origSP) _origSP(id,el);
  if(id==='dashboard') buildDashboard();
  if(id==='receipt') initReceiptPage();
  if(id==='statement'){ try{initStmtPage();}catch(e){} }
  if(id==='reports') { try{initReportPage();}catch(e){} }
  if(id==='entry'){
    try{
      if(currentUser&&currentUser.crsId){
        var ec=document.getElementById('entry-crs');
        if(ec&&!ec.value) ec.value=String(currentUser.crsId);
        var ed=document.getElementById('entry-date');
        var td=new Date().toISOString().split('T')[0];
        if(ed&&!ed.value){ ed.value=td; ed.max=td; }
        if(ec&&ec.value){
          setTimeout(function(){ try{if(typeof onEntryChange==='function') onEntryChange();}catch(e){} },0);
        }
      }
    } catch(ex){ console.error('showPage entry error:',ex); }
  }
  if(id==='monthly'){
    try{
      if(currentUser&&currentUser.crsId){
        // Set CRS
        var mc=document.getElementById('me-crs');
        if(mc&&!mc.value) mc.value=String(currentUser.crsId);
        // Set current month & year
        var nowN=new Date();
        var moEl=document.getElementById('me-month');
        var yrEl=document.getElementById('me-year');
        if(moEl&&!moEl.value) moEl.value=String(nowN.getMonth()+1);
        if(yrEl&&!yrEl.value) yrEl.value=String(nowN.getFullYear());
        // Auto-trigger form
        setTimeout(function(){
          try{if(typeof onMonthlyChange==='function') onMonthlyChange();}catch(e){}
          setTimeout(function(){ if(typeof buildMeRemitTable==='function') buildMeRemitTable(); },100);
        },0);
      }
    } catch(ex){ console.error('showPage monthly error:',ex); }
  }
};


// ═══ HOLIDAY CALENDAR ═══════════════════════════════════════════════════════

// Tamil Nadu Government Holidays 2026
// Sources: TN Govt Gazette, National Holidays
