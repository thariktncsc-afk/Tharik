// CRS / Commodity / User modals, role + holiday overlays
// Verbatim from TNCSC_CRS_Demo_19 (1).html lines 1536-1698.
const html = `
<div class="modal-bg" id="modal-crs">
  <div class="modal">
    <div class="modal-head"><h3>Add New CRS Shop</h3></div>
    <div class="modal-body">
      <div class="grid g2"><div class="form-group"><label>Code *</label><input placeholder="e.g. CRS-031"/></div><div class="form-group"><label>Shop Name *</label><input placeholder="Full name"/></div></div>
      <div class="form-group"><label>Address</label><input placeholder="Street address"/></div>
      <div class="grid g2"><div class="form-group"><label>District</label><input value="Madurai"/></div><div class="form-group"><label>Taluk</label><input placeholder="Taluk name"/></div></div>
      <div class="grid g2"><div class="form-group"><label>Ward No</label><input placeholder="Ward number"/></div><div class="form-group"><label>Card Holders</label><input type="number" placeholder="0"/></div></div>
    </div>
    <div class="modal-foot"><button class="btn btn-outline" onclick="closeModal('modal-crs')">Cancel</button><button class="btn btn-primary">Save Shop</button></div>
  </div>
</div>

<div class="modal-bg" id="modal-comm">
  <div class="modal">
    <div class="modal-head"><h3>Add Commodity</h3></div>
    <div class="modal-body">
      <div class="grid g2"><div class="form-group"><label>Code *</label><input placeholder="e.g. URAD"/></div><div class="form-group"><label>Display Order</label><input type="number" placeholder="0"/></div></div>
      <div class="grid g2"><div class="form-group"><label>Name (English) *</label><input placeholder="English name"/></div><div class="form-group"><label>Name (Tamil)</label><input placeholder="தமிழ் பெயர்"/></div></div>
      <div class="grid g2"><div class="form-group"><label>Unit *</label><select><option>KG</option><option>LTR</option><option>NOS</option><option>BUNDLE</option></select></div><div class="form-group"><label>Category</label><input placeholder="Category"/></div></div>
    </div>
    <div class="modal-foot"><button class="btn btn-outline" onclick="closeModal('modal-comm')">Cancel</button><button class="btn btn-primary">Save Commodity</button></div>
  </div>
</div>

<div class="modal-bg" id="modal-user">
  <div class="modal" style="width:520px;max-height:90vh;overflow-y:auto">
    <div class="modal-head" style="background:linear-gradient(135deg,#0369A1,#0EA5E9)">
      <h3 id="mu-modal-title" style="color:#fff">Add New User</h3>
      <div style="color:rgba(255,255,255,.6);font-size:11px;margin-top:2px">Default password: <code style="background:rgba(255,255,255,.15);padding:1px 6px;border-radius:4px">pds123</code></div>
    </div>
    <div class="modal-body" style="padding:20px">

      <!-- Full Name -->
      <div class="form-group">
        <label>Full Name <span style="color:#DC2626">*</span></label>
        <input id="mu-fullname" type="text" placeholder="Enter full name"
          oninput="muAutoUsername(this.value)"
          style="border:1px solid var(--border);border-radius:8px;padding:9px 12px;font-size:13px;width:100%;outline:none"/>
        <div id="mu-name-err" style="color:#DC2626;font-size:11px;margin-top:3px;display:none">Full name is required</div>
      </div>

      <!-- Auto Username (read-only display) -->
      <div class="form-group">
        <label>Username <span style="font-size:10px;color:var(--muted);font-weight:400">(auto-generated from full name)</span></label>
        <div style="display:flex;gap:8px;align-items:center">
          <input id="mu-username" type="text" readonly placeholder="Will be set automatically"
            style="flex:1;background:#F8FAFC;border:1px solid var(--border);border-radius:8px;padding:9px 12px;font-size:13px;color:var(--muted);cursor:not-allowed"/>
          <div style="background:#E0F2FE;color:#0369A1;font-size:10px;font-weight:700;padding:4px 8px;border-radius:6px;white-space:nowrap">AUTO</div>
        </div>
      </div>

      <!-- Phone (mandatory) + Email (optional) -->
      <div style="display:grid;grid-template-columns:1fr 1fr;gap:12px">
        <div class="form-group">
          <label>Phone Number <span style="color:#DC2626">*</span></label>
          <input id="mu-phone" type="tel" placeholder="10-digit mobile number" maxlength="10"
            oninput="this.value=this.value.replace(/[^0-9]/,'')"
            style="border:1px solid var(--border);border-radius:8px;padding:9px 12px;font-size:13px;width:100%;outline:none"/>
          <div id="mu-phone-err" style="color:#DC2626;font-size:11px;margin-top:3px;display:none">Valid 10-digit number required</div>
        </div>
        <div class="form-group">
          <label>Email <span style="font-size:10px;color:var(--muted);font-weight:400">(optional)</span></label>
          <input id="mu-email" type="email" placeholder="email@tncsc.gov.in"
            style="border:1px solid var(--border);border-radius:8px;padding:9px 12px;font-size:13px;width:100%;outline:none"/>
        </div>
      </div>

      <!-- Role (mandatory) -->
      <div class="form-group">
        <label>Role <span style="color:#DC2626">*</span></label>
        <div style="display:grid;grid-template-columns:1fr 1fr;gap:10px">
          <label id="mu-role-bc" onclick="muSelectRole('BC')"
            style="display:flex;align-items:center;gap:10px;border:2px solid var(--border);border-radius:10px;padding:12px;cursor:pointer;transition:.15s">
            <div style="width:18px;height:18px;border-radius:50%;border:2px solid #0369A1;flex-shrink:0;display:flex;align-items:center;justify-content:center" id="mu-role-bc-dot">
              <div style="width:8px;height:8px;border-radius:50%;background:transparent" id="mu-role-bc-fill"></div>
            </div>
            <div>
              <div style="font-weight:700;font-size:13px;color:var(--text)">Bill Clerk (BC)</div>
              <div style="font-size:10px;color:var(--muted)">Handles billing &amp; entry</div>
            </div>
          </label>
          <label id="mu-role-packer" onclick="muSelectRole('Packer')"
            style="display:flex;align-items:center;gap:10px;border:2px solid var(--border);border-radius:10px;padding:12px;cursor:pointer;transition:.15s">
            <div style="width:18px;height:18px;border-radius:50%;border:2px solid #C2410C;flex-shrink:0;display:flex;align-items:center;justify-content:center" id="mu-role-packer-dot">
              <div style="width:8px;height:8px;border-radius:50%;background:transparent" id="mu-role-packer-fill"></div>
            </div>
            <div>
              <div style="font-weight:700;font-size:13px;color:var(--text)">Packer</div>
              <div style="font-size:10px;color:var(--muted)">Handles packing &amp; dispatch</div>
            </div>
          </label>
        </div>
        <input type="hidden" id="mu-role-val"/>
        <div id="mu-role-err" style="color:#DC2626;font-size:11px;margin-top:4px;display:none">Please select a role</div>
      </div>

      <!-- CRS Assignment (mandatory, CRS 1-30) -->
      <div class="form-group">
        <label>CRS Assignment <span style="color:#DC2626">*</span></label>
        <div style="position:relative">
          <select id="mu-crs" style="width:100%;border:1px solid var(--border);border-radius:8px;padding:9px 12px;font-size:13px;outline:none;appearance:auto">
            <option value="">Select CRS Shop...</option>
          </select>
        </div>
        <div id="mu-crs-err" style="color:#DC2626;font-size:11px;margin-top:3px;display:none">CRS assignment is required</div>
        <!-- Preview: existing users for selected CRS -->
        <div id="mu-crs-preview" style="display:none;margin-top:8px;background:#F0F9FF;border:1px solid #BAE6FD;border-radius:8px;padding:10px 12px">
          <div style="font-size:10px;font-weight:700;color:#0369A1;text-transform:uppercase;letter-spacing:.05em;margin-bottom:6px">Currently assigned to this CRS</div>
          <div id="mu-crs-preview-content"></div>
        </div>
      </div>

      <!-- Password info (display only) -->
      <div style="background:#F0F9FF;border:1px solid #BAE6FD;border-radius:8px;padding:10px 14px;display:flex;align-items:center;gap:10px">
        <span style="font-size:16px">🔐</span>
        <div>
          <div style="font-size:12px;font-weight:700;color:#0369A1">Default Password</div>
          <div style="font-size:12px;color:var(--muted)">New user will login with: <code style="background:#fff;padding:1px 6px;border-radius:4px;font-weight:700;color:#0369A1">pds123</code></div>
        </div>
      </div>

      <!-- Validation summary -->
      <div id="mu-val-summary" style="display:none;background:#FEE2E2;border:1px solid #FECACA;border-radius:8px;padding:10px 14px;color:#B91C1C;font-size:12px;margin-top:12px">
        ⚠ Please fix the errors above before saving.

<!-- ─── ROLE SELECT MODAL (shown when CRS has BC + Packer) ─── -->
<div id="role-select-overlay" style="display:none;position:fixed;inset:0;background:rgba(0,0,0,.6);z-index:9999;align-items:center;justify-content:center">
  <div style="background:#fff;border-radius:16px;width:380px;max-width:95vw;overflow:hidden;box-shadow:0 20px 60px rgba(0,0,0,.4)">
    <div style="background:linear-gradient(135deg,#0369A1,#0EA5E9);padding:18px 22px">
      <div style="color:#fff;font-weight:800;font-size:15px" id="rs-crs-label">CRS 9</div>
      <div style="color:rgba(255,255,255,.7);font-size:12px;margin-top:2px">Select your role to continue</div>
    </div>
    <div style="padding:20px">
      <div style="margin-bottom:12px;font-size:12px;color:var(--muted);text-align:center">Multiple staff found for this shop. Who are you?</div>
      <div id="rs-options" style="display:flex;flex-direction:column;gap:10px"></div>
      <button onclick="cancelRoleSelect()"
        style="width:100%;margin-top:14px;padding:9px;background:#fff;border:1px solid var(--border);border-radius:8px;font-size:12px;color:var(--muted);cursor:pointer">
        Cancel
      </button>
    </div>
  </div>
</div>


<!-- ─── HOLIDAY CALENDAR MODAL ─── -->
<div id="holiday-cal-overlay" style="display:none;position:fixed;inset:0;background:rgba(0,0,0,.55);z-index:3000;align-items:center;justify-content:center;padding:16px">
  <div style="background:#fff;border-radius:16px;width:680px;max-width:98vw;max-height:90vh;overflow:hidden;box-shadow:0 24px 60px rgba(0,0,0,.35);display:flex;flex-direction:column">
    <!-- Modal header -->
    <div style="background:linear-gradient(135deg,#0369A1,#0EA5E9);padding:16px 20px;display:flex;justify-content:space-between;align-items:center;flex-shrink:0">
      <div>
        <div style="color:#fff;font-weight:800;font-size:15px">Holiday Calendar</div>
        <div style="color:rgba(255,255,255,.7);font-size:11px;margin-top:2px">Tamil Nadu Public Holidays + TNCSC Shop Holidays</div>
      </div>
      <div style="display:flex;align-items:center;gap:10px">
        <select id="hcal-year" onchange="renderHolidayCal()" style="border:1px solid rgba(255,255,255,.3);background:rgba(255,255,255,.15);color:#fff;padding:4px 8px;border-radius:6px;font-size:12px"></select>
        <button onclick="closeHolidayCalendar()" style="background:rgba(255,255,255,.15);border:1px solid rgba(255,255,255,.3);color:#fff;padding:5px 12px;border-radius:6px;font-size:12px;cursor:pointer">✕ Close</button>
      </div>
    </div>
    <div id="hcal-grid" style="padding:16px;overflow-y:auto;max-height:70vh"></div>
  </div>
</div>

`;

export default html;
