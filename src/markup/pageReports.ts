// Reports
// Verbatim from TNCSC_CRS_Demo_19 (1).html lines 1349-1407.
const html = `

      <div class="page" id="page-reports">
      <div class="page-header"><div class="page-title">Reports</div><div class="page-sub">Daily, monthly, quarterly and yearly analysis · PV Statement generator</div></div>
      <div class="card mb-4">
        <div class="card-body">
          <div class="flex gap-2 mb-4">
            <button class="btn btn-primary btn-sm" id="r-daily" onclick="switchReport('daily')">Daily</button>
            <button class="btn btn-outline btn-sm" id="r-monthly" onclick="switchReport('monthly')">Monthly</button>
            <button class="btn btn-outline btn-sm" id="r-quarterly" onclick="switchReport('quarterly')">📋 Quarterly PV (3-Month)</button>
            <button class="btn btn-outline btn-sm" id="r-yearly" onclick="switchReport('yearly')">📋 Yearly PV</button>
          </div>
          <div style="display:grid;grid-template-columns:1fr 1fr 1fr 1fr;gap:12px;align-items:end">
            <div>
              <label class="form-label">CRS SHOP</label>
              <select id="rpt-crs" onchange="generateReport()" style="width:100%;border:1px solid var(--border);border-radius:8px;padding:8px 12px;font-size:13px;outline:none">
                <option value="">Select CRS Shop…</option>
              </select>
            </div>
            <div id="rpt-date-wrap">
              <label class="form-label">DATE</label>
              <input type="date" id="rpt-date" onchange="generateReport()" style="width:100%;border:1px solid var(--border);border-radius:8px;padding:8px 12px;font-size:13px;outline:none"/>
            </div>
            <div id="rpt-month-wrap">
              <label class="form-label">MONTH</label>
              <select id="rpt-month" onchange="generateReport()" style="width:100%;border:1px solid var(--border);border-radius:8px;padding:8px 12px;font-size:13px;outline:none"></select>
            </div>
            <div id="rpt-quarter-wrap" style="display:none">
              <label class="form-label">QUARTER START MONTH</label>
              <select id="rpt-quarter-start" onchange="generateReport()" style="width:100%;border:1px solid var(--border);border-radius:8px;padding:8px 12px;font-size:13px;outline:none"></select>
            </div>
            <div id="rpt-year-wrap" style="display:none">
              <label class="form-label">FINANCIAL YEAR</label>
              <select id="rpt-year-sel" onchange="generateReport()" style="width:100%;border:1px solid var(--border);border-radius:8px;padding:8px 12px;font-size:13px;outline:none"></select>
            </div>
            <div>
              <button onclick="generateReport()" class="btn btn-primary" style="width:100%;font-size:13px;padding:9px 0">Generate Report</button>
            </div>
          </div>
          <div id="rpt-pv-actions" style="display:none;margin-top:12px;gap:10px;align-items:center">
            <button onclick="printPVStatement()" style="background:linear-gradient(135deg,#1B3A6B,#2563EB);color:#fff;border:none;padding:9px 20px;border-radius:8px;font-weight:700;font-size:13px;cursor:pointer">🖨️ Print PV Statement</button>
            <span style="font-size:11px;color:var(--muted)">Physical verification columns are left blank for the PV officer to fill on-site</span>
          </div>
        </div>
      </div>
      <div class="grid g3 mb-4" id="rpt-kpi-row">
        <div class="kpi"><div class="kpi-icon" style="background:#FEE2E2">💰</div><div><div class="kpi-val" id="rpt-kpi-sales" style="color:var(--red)">₹0</div><div class="kpi-label">Total Sales</div></div></div>
        <div class="kpi"><div class="kpi-icon" style="background:#DCFCE7">📦</div><div><div class="kpi-val" id="rpt-kpi-receipts" style="color:var(--green)">₹0</div><div class="kpi-label">Total Receipts</div></div></div>
        <div class="kpi"><div class="kpi-icon" style="background:#DBEAFE">📅</div><div><div class="kpi-val" id="rpt-kpi-days" style="color:var(--navy)">0</div><div class="kpi-label">Days with Entries</div></div></div>
      </div>
      <div class="card" id="rpt-result-card">
        <div class="card-header" style="display:flex;justify-content:space-between;align-items:center">
          <div class="card-title" id="rpt-result-title">Sales by Commodity</div>
        </div>
        <div id="rpt-result-body" style="overflow-x:auto">
          <div style="text-align:center;padding:32px;color:var(--muted)">Select a CRS shop and click Generate Report to view data.</div>
        </div>
      </div>
    </div>

`;

export default html;
