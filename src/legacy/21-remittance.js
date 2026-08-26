/* Daily Entry — mandatory, repeatable remittance  [+]
   Added after the port; not part of TNCSC_CRS_Demo_19 (1).html, so
   tools/verify-parity.mjs skips this file (see NEW_ENGINE there).

   A day sheet can no longer be completed without at least one remittance
   (amount + date), and a day may carry several of them — a deposit split
   across two challans is one day with two remittance rows.

   Each row also names the SRCB account it went into — the two columns of the
   Monthly Remittance table: 'nc' (Non-Cereal, the priced commodities) or 'ce'
   (Cereal, the free rice/wheat lines). A day sold only free commodities still
   has a deposit to key; before the split there was nowhere to put it.

   STORAGE. The day's rows live on the saved sheet as `remits`:
       entryStore[crsId_date].remits =
           [{amount:Number, date:'YYYY-MM-DD', account:'nc'|'ce'}, ...]
   The ported single-value fields are kept in step as the aggregate —
   `remitAmount` = sum of the rows, `remitDate` = the earliest row's date — so
   every existing reader (11-statement-core's remitByDay, the PV/DSS builders,
   17-dss-export) keeps working unchanged and un-edited. `remitNonCereal` and
   `remitCereal` carry the split alongside them. A row with no `account` is a
   sheet saved before the split and reads as Non-Cereal, which is what the
   single amount box always meant.

   This part is concatenated last by tools/bundle-engine.mjs, so the functions
   it wraps below already exist, and its wrappers sit outside the ones
   20-dashboard-stock.js installed. */

// Rows for the sheet currently on screen. Rebuilt from the store on every
// CRS/date change, so it never carries another day's deposits.
var entryRemitList = [];

// Which account the next "Add" goes into. Reset with the sheet, not sticky
// across shops.
var entryRemitAcct = 'nc';

var ENTRY_REMIT_ACCT = {
  nc: {label:'Non-Cereal A/C', hint:'Sugar, Toor, Palm Oil, Salt, Ooty/Tan, empty box & bag — the priced commodities',
       fg:'#0369A1', bg:'#F0F9FF', bd:'#BAE6FD'},
  ce: {label:'Cereal A/C', hint:'Rice and Wheat — the free commodities',
       fg:'#15803D', bg:'#F0FDF4', bd:'#86EFAC'}
};
function entryRemitAcctOf(r){ return (r && r.account === 'ce') ? 'ce' : 'nc'; }

function entryRemitFmt(n){
  return '₹' + (Number(n)||0).toLocaleString('en-IN',{minimumFractionDigits:2, maximumFractionDigits:2});
}
function entryRemitFmtDate(s){
  return s ? s.split('-').reverse().join('/') : '';
}
function entryRemitTotal(){
  return entryRemitList.reduce(function(t,r){ return t + (parseFloat(r.amount)||0); }, 0);
}
// Per-account totals; `acct` omitted means the whole day.
function entryRemitTotalOf(acct){
  return entryRemitList.reduce(function(t,r){
    return entryRemitAcctOf(r) === acct ? t + (parseFloat(r.amount)||0) : t;
  }, 0);
}

// ── ACCOUNT PICKER ──────────────────────────────────────────────────────────
// The ported markup has no account field, and that block is held to parity, so
// the picker is injected as a new first column of the same grid.
function entryRemitPaintAcct(){
  ['nc','ce'].forEach(function(k){
    var b = document.getElementById('entry-remit-acct-' + k);
    if(!b) return;
    var on = entryRemitAcct === k;
    b.style.background = on ? ENTRY_REMIT_ACCT[k].fg : '#fff';
    b.style.color      = on ? '#fff' : 'var(--muted)';
  });
  var hint = document.getElementById('entry-remit-acct-hint');
  if(hint) hint.textContent = ENTRY_REMIT_ACCT[entryRemitAcct].hint;
  // The amount box keeps its ported colours: its own inline onblur handler
  // resets the border, so tinting it here would only half-work.
}
function entryRemitSetAcct(k){
  entryRemitAcct = (k === 'ce') ? 'ce' : 'nc';
  entryRemitPaintAcct();
  var amt = document.getElementById('entry-remit-amount');
  if(amt) amt.focus();
}
function entryRemitInstallAcct(){
  if(document.getElementById('entry-remit-acct-nc')) return;      // already there
  var amt = document.getElementById('entry-remit-amount');
  if(!amt) return;
  var grid = amt.closest('div[style*="grid-template-columns"]');
  if(!grid) return;
  grid.style.gridTemplateColumns = 'minmax(210px,auto) 1fr 1fr auto';

  var btn = function(k){
    return '<button type="button" id="entry-remit-acct-' + k + '" onclick="entryRemitSetAcct(\'' + k + '\')" ' +
      'title="' + ENTRY_REMIT_ACCT[k].hint.replace(/"/g,'&quot;') + '" ' +
      'style="flex:1;border:none;' + (k === 'ce' ? 'border-left:1px solid #E2E8F0;' : '') +
      'padding:9px 10px;font-size:11.5px;font-weight:800;cursor:pointer;white-space:nowrap">' +
      ENTRY_REMIT_ACCT[k].label + '</button>';
  };
  var cell = document.createElement('div');
  cell.innerHTML =
    '<label style="display:block;font-size:11px;font-weight:700;color:var(--text);margin-bottom:5px">' +
      'Deposited To <span style="color:#DC2626">*</span></label>' +
    '<div style="display:flex;border:2px solid #E2E8F0;border-radius:8px;overflow:hidden">' +
      btn('nc') + btn('ce') +
    '</div>' +
    '<div id="entry-remit-acct-hint" style="font-size:9.5px;color:var(--muted);margin-top:4px;line-height:1.35"></div>';
  grid.insertBefore(cell, grid.firstChild);
  entryRemitPaintAcct();
}

// ── FIELD-LEVEL VALIDATION MESSAGES ─────────────────────────────────────────
function entryRemitError(which, msg){
  var el = document.getElementById('entry-remit-' + which + '-err');
  var inp = document.getElementById('entry-remit-' + (which === 'amount' ? 'amount' : 'date'));
  if(el){ el.textContent = msg; el.style.display = 'block'; }
  if(inp) inp.style.borderColor = '#DC2626';
}
function entryRemitClearError(which){
  var el = document.getElementById('entry-remit-' + which + '-err');
  var inp = document.getElementById('entry-remit-' + which);
  if(el){ el.textContent = ''; el.style.display = 'none'; }
  if(inp) inp.style.borderColor = '#BAE6FD';
}
function entryRemitClearErrors(){
  entryRemitClearError('amount');
  entryRemitClearError('date');
}

function entryRemitInputs(){
  var aEl = document.getElementById('entry-remit-amount');
  var dEl = document.getElementById('entry-remit-date');
  var raw = aEl ? String(aEl.value).trim() : '';
  var amt = parseFloat(raw);
  return {
    amtEl: aEl, dateEl: dEl,
    amount: amt, date: dEl ? dEl.value : '', account: entryRemitAcct,
    hasAmount: raw !== '' && !isNaN(amt) && amt > 0,
    hasDate: !!(dEl && dEl.value)
  };
}

// ── ADD / REMOVE ────────────────────────────────────────────────────────────
function entryRemitAdd(){
  entryRemitClearErrors();
  var f = entryRemitInputs();
  var ok = true;
  if(!f.hasAmount){ entryRemitError('amount', 'Please enter the Remittance Amount.'); ok = false; }
  if(!f.hasDate){   entryRemitError('date',   'Please select the Remittance Date.');   ok = false; }
  if(!ok){
    var focusEl = !f.hasAmount ? f.amtEl : f.dateEl;
    if(focusEl) focusEl.focus();
    return false;
  }
  entryRemitList.push({amount: f.amount, date: f.date, account: f.account});
  // The amount is now a row; the date stays as the default for the next one.
  if(f.amtEl){ f.amtEl.value = ''; f.amtEl.focus(); }
  entryRemitRender();
  if(typeof entryUpdateRemitDiff === 'function') entryUpdateRemitDiff();
  return true;
}

function entryRemitRemove(i){
  if(i < 0 || i >= entryRemitList.length) return;
  entryRemitList.splice(i, 1);
  entryRemitRender();
  if(typeof entryUpdateRemitDiff === 'function') entryUpdateRemitDiff();
}

// ── LIST ────────────────────────────────────────────────────────────────────
function entryRemitRender(){
  var box = document.getElementById('entry-remit-list');
  if(!box) return;

  if(!entryRemitList.length){
    box.innerHTML = '<div style="font-size:11px;color:#B45309;background:#FFFBEB;border:1px dashed #FDE047;' +
      'border-radius:8px;padding:8px 12px">⚠ No remittance added yet — pick the account, enter the amount and date, ' +
      'then press <strong>Add</strong>. At least one deposit — Non-Cereal or Cereal — is required to complete the day.</div>';
    return;
  }

  var rows = entryRemitList.map(function(r, i){
    var ac = ENTRY_REMIT_ACCT[entryRemitAcctOf(r)];
    return '<tr style="background:' + (i % 2 === 0 ? '#fff' : '#F8FAFC') + '">' +
      '<td style="padding:6px 10px;font-size:11px;color:var(--muted);text-align:center;border-bottom:1px solid #F1F5F9">' + (i+1) + '</td>' +
      '<td style="padding:6px 10px;text-align:center;border-bottom:1px solid #F1F5F9;white-space:nowrap">' +
        '<span style="display:inline-block;background:' + ac.bg + ';border:1px solid ' + ac.bd + ';color:' + ac.fg +
        ';font-size:10px;font-weight:800;padding:2px 8px;border-radius:5px">' + ac.label + '</span></td>' +
      '<td style="padding:6px 10px;font-size:13px;font-weight:800;color:' + ac.fg + ';text-align:right;border-bottom:1px solid #F1F5F9;white-space:nowrap">' + entryRemitFmt(r.amount) + '</td>' +
      '<td style="padding:6px 10px;font-size:12px;font-weight:600;color:#334155;text-align:center;border-bottom:1px solid #F1F5F9;white-space:nowrap">' + entryRemitFmtDate(r.date) + '</td>' +
      '<td style="padding:4px 10px;text-align:right;border-bottom:1px solid #F1F5F9">' +
        '<button type="button" onclick="entryRemitRemove(' + i + ')" title="Remove this remittance" ' +
        'style="background:#FEE2E2;color:#B91C1C;border:1px solid #FCA5A5;border-radius:6px;padding:3px 9px;' +
        'font-size:11px;font-weight:700;cursor:pointer">✕</button>' +
      '</td></tr>';
  }).join('');

  var th = 'padding:6px 10px;font-size:9.5px;font-weight:800;color:var(--muted);text-transform:uppercase;' +
           'letter-spacing:.05em;border-bottom:1px solid #E2E8F0;';
  var nc = entryRemitTotalOf('nc'), ce = entryRemitTotalOf('ce');

  box.innerHTML =
    '<div style="border:1px solid #E2E8F0;border-radius:9px;overflow:hidden">' +
      '<table style="width:100%;border-collapse:collapse">' +
        '<thead><tr style="background:#F8FAFC">' +
          '<th style="' + th + 'text-align:center;width:34px">#</th>' +
          '<th style="' + th + 'text-align:center">Account</th>' +
          '<th style="' + th + 'text-align:right">Amount</th>' +
          '<th style="' + th + 'text-align:center">Deposit Date</th>' +
          '<th style="' + th + 'text-align:right;width:56px"></th>' +
        '</tr></thead>' +
        '<tbody>' + rows + '</tbody>' +
        '<tfoot><tr style="background:#F0F9FF">' +
          '<td style="padding:7px 10px" colspan="1"></td>' +
          '<td style="padding:7px 10px;font-size:9.5px;font-weight:800;color:var(--muted);text-transform:uppercase;letter-spacing:.05em;text-align:center">Day Total</td>' +
          '<td style="padding:7px 10px;font-size:13px;font-weight:900;color:#0369A1;text-align:right;white-space:nowrap">' + entryRemitFmt(entryRemitTotal()) + '</td>' +
          '<td style="padding:7px 10px;font-size:10px;font-weight:700;color:var(--muted)" colspan="2">' +
            entryRemitList.length + ' remittance' + (entryRemitList.length === 1 ? '' : 's') +
            (nc ? '<span style="color:' + ENTRY_REMIT_ACCT.nc.fg + ';margin-left:8px">Non-Cereal ' + entryRemitFmt(nc) + '</span>' : '') +
            (ce ? '<span style="color:' + ENTRY_REMIT_ACCT.ce.fg + ';margin-left:8px">Cereal ' + entryRemitFmt(ce) + '</span>' : '') +
          '</td>' +
        '</tr></tfoot>' +
      '</table>' +
    '</div>';
}

// ── COLLECT + VALIDATE ──────────────────────────────────────────────────────
// Returns the day's rows, or null after showing the field messages.
// A filled amount box counts as a row, so a single deposit does not have to be
// pushed through "Add" first. The date box is pre-filled by the ported
// loadEntryForm, so only the AMOUNT decides whether the box is "in use".
function entryRemitCollect(){
  entryRemitClearErrors();
  var f = entryRemitInputs();
  var list = entryRemitList.slice();

  if(f.hasAmount){
    if(!f.hasDate){
      entryRemitError('date', 'Please select the Remittance Date.');
      if(f.dateEl) f.dateEl.focus();
      return null;
    }
    list.push({amount: f.amount, date: f.date, account: f.account});
  } else if(!list.length){
    entryRemitError('amount', 'Please enter the Remittance Amount.');
    if(!f.hasDate) entryRemitError('date', 'Please select the Remittance Date.');
    if(f.amtEl) f.amtEl.focus();
    return null;
  }
  return list;
}

// Restore the rows for the sheet being opened. Sheets saved before this
// feature (and the sample data) carry only the single ported pair, so they are
// read as one row.
function entryRemitSyncFromStore(crsId, date){
  var e = (crsId && date && typeof entryStore !== 'undefined') ? entryStore[crsId + '_' + date] : null;
  if(e && e.remits && e.remits.length){
    entryRemitList = e.remits.map(function(r){
      return {amount: parseFloat(r.amount)||0, date: r.date || '', account: entryRemitAcctOf(r)};
    });
  } else if(e && parseFloat(e.remitAmount)){
    entryRemitList = [{amount: parseFloat(e.remitAmount), date: e.remitDate || date, account: 'nc'}];
  } else {
    entryRemitList = [];
  }
  entryRemitAcct = 'nc';
  entryRemitInstallAcct();
  entryRemitPaintAcct();
  // The saved figure now lives in the list; leaving it in the box too would
  // add it a second time on the next save.
  var aEl = document.getElementById('entry-remit-amount');
  if(aEl && entryRemitList.length) aEl.value = '';
  entryRemitClearErrors();
  entryRemitRender();
}

// ── WRAPPED PORTED FUNCTIONS ────────────────────────────────────────────────

// Opening another CRS/date reloads that sheet's rows.
var _remitOrigOnEntryChange = onEntryChange;
onEntryChange = function(){
  var r = _remitOrigOnEntryChange.apply(this, arguments);
  try{
    entryRemitSyncFromStore(document.getElementById('entry-crs').value,
                            document.getElementById('entry-date').value);
    if(typeof entryUpdateRemitDiff === 'function') entryUpdateRemitDiff();
  }catch(e){}
  return r;
};

// Clearing the sheet clears its deposits too.
var _remitOrigClearEntryForm = clearEntryForm;
clearEntryForm = function(){
  var r = _remitOrigClearEntryForm.apply(this, arguments);
  try{
    entryRemitList = [];
    entryRemitAcct = 'nc';
    entryRemitPaintAcct();
    var aEl = document.getElementById('entry-remit-amount');
    if(aEl) aEl.value = '';
    entryRemitClearErrors();
    entryRemitRender();
    if(typeof entryUpdateRemitDiff === 'function') entryUpdateRemitDiff();
  }catch(e){}
  return r;
};

// "தினசரி விற்பனை நிறைவு" — the day is only completed once the remittance is
// there. The aggregate is written into the inputs before the ported save runs,
// so the record it builds already carries the right single-value fields; the
// rows themselves are attached to the saved sheet afterwards.
var _remitOrigSaveEntryForm = saveEntryForm;
saveEntryForm = function(){
  var crsEl = document.getElementById('entry-crs');
  var dtEl  = document.getElementById('entry-date');
  // Nothing selected: leave the ported guard (and its own message) in charge.
  if(!crsEl || !dtEl || !crsEl.value || !dtEl.value){
    return _remitOrigSaveEntryForm.apply(this, arguments);
  }

  var list = entryRemitCollect();
  if(!list) return false;

  var crsId = crsEl.value, date = dtEl.value;
  var total = list.reduce(function(t,r){ return t + (parseFloat(r.amount)||0); }, 0);
  var first = list.map(function(r){ return r.date; }).filter(Boolean).sort()[0] || '';

  var aEl = document.getElementById('entry-remit-amount');
  var dEl = document.getElementById('entry-remit-date');
  var keepAmt = aEl ? aEl.value : '', keepDate = dEl ? dEl.value : '';
  if(aEl) aEl.value = total ? total.toFixed(2) : '';
  if(dEl && first) dEl.value = first;

  var r = _remitOrigSaveEntryForm.apply(this, arguments);

  var saved = entryStore[crsId + '_' + date];
  if(saved){
    // Saved: the rows are the record. If the ported save was declined at its
    // overwrite prompt, `saved` is the untouched prior sheet — detect that by
    // its aggregate and leave it alone.
    var wrote = Math.abs((parseFloat(saved.remitAmount)||0) - total) < 0.005;
    if(wrote){
      saved.remits = list.map(function(x){ return {amount: x.amount, date: x.date, account: entryRemitAcctOf(x)}; });
      saved.remitNonCereal = list.reduce(function(t,x){ return entryRemitAcctOf(x) === 'ce' ? t : t + (parseFloat(x.amount)||0); }, 0);
      saved.remitCereal    = list.reduce(function(t,x){ return entryRemitAcctOf(x) === 'ce' ? t + (parseFloat(x.amount)||0) : t; }, 0);
      entryRemitList = saved.remits.map(function(x){ return {amount: x.amount, date: x.date, account: x.account}; });
      if(aEl) aEl.value = '';
      if(dEl && first) dEl.value = first;
      entryRemitRender();
      if(typeof entryUpdateRemitDiff === 'function') entryUpdateRemitDiff();
      return r;
    }
  }
  // Not written (declined overwrite) — put the form back the way it was.
  if(aEl) aEl.value = keepAmt;
  if(dEl) dEl.value = keepDate;
  return r;
};

// "மாத விற்பனை நிறைவு" — it saves the marked day on the way through, and the
// ported version ignores what that save returns, so the same gate is applied
// here rather than letting a month close on an unremitted day.
var _remitOrigMarkSalesClose = markSalesClose;
markSalesClose = function(){
  var crsEl = document.getElementById('entry-crs');
  var dtEl  = document.getElementById('entry-date');
  if(crsEl && dtEl && crsEl.value && dtEl.value){
    if(!entryRemitCollect()) return false;
  }
  return _remitOrigMarkSalesClose.apply(this, arguments);
};

// The "vs sales total" hint has to weigh the whole day's deposits, not just
// whatever is sitting in the amount box.
function entryUpdateRemitDiff(){
  var grandEl = document.getElementById('ef-sum-grand');
  var diffEl  = document.getElementById('entry-remit-diff');
  if(!grandEl || !diffEl) return;
  // Only the Non-Cereal side is weighed against the sales total — the free
  // commodities carry no rate, so the sheet holds nothing for a Cereal deposit
  // to match, and a cereal-only day must not read as "below sales total".
  var f  = entryRemitInputs();
  var nc = entryRemitTotalOf('nc') + (f.hasAmount && entryRemitAcct === 'nc' ? f.amount : 0);
  var ce = entryRemitTotalOf('ce') + (f.hasAmount && entryRemitAcct === 'ce' ? f.amount : 0);
  if(!nc && !ce){ diffEl.textContent = ''; return; }
  var grand = parseFloat((grandEl.textContent||'').replace(/[^\d.]/g,'')) || 0;
  var diff  = nc - grand;
  var ncRows = entryRemitList.filter(function(r){ return entryRemitAcctOf(r) === 'nc'; }).length +
               (f.hasAmount && entryRemitAcct === 'nc' ? 1 : 0);
  var many  = ncRows > 1 ? ' (' + ncRows + ' deposits)' : '';
  var lines = [];
  if(nc){
    if(Math.abs(diff) < 0.001) lines.push('<span style="color:#16A34A">✓ Non-Cereal matches sales total' + many + '</span>');
    else if(diff > 0)          lines.push('<span style="color:#D97706">▲ Non-Cereal +₹' + diff.toFixed(2) + ' above sales total' + many + '</span>');
    else                       lines.push('<span style="color:#DC2626">▼ Non-Cereal ₹' + Math.abs(diff).toFixed(2) + ' below sales total' + many + '</span>');
  }
  if(ce) lines.push('<span style="color:' + ENTRY_REMIT_ACCT.ce.fg + '">🌾 Cereal A/C ₹' + ce.toFixed(2) +
                    ' — free commodities, not weighed against the sales total</span>');
  diffEl.innerHTML = lines.join('<br>');
}

// First paint, for the sheet the ported init already opened.
(function initEntryRemit(){
  if(!document.getElementById('entry-remit-list')) return;
  entryRemitInstallAcct();
  try{
    entryRemitSyncFromStore(document.getElementById('entry-crs').value,
                            document.getElementById('entry-date').value);
  }catch(e){ entryRemitRender(); }
})();
