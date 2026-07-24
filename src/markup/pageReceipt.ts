// Receipt Register
// Verbatim from TNCSC_CRS_Demo_19 (1).html lines 515-570.
const html = `
      <!-- RECEIPT PAGE -->
      <div class="page" id="page-receipt">
        <div class="page-header" style="display:flex;justify-content:space-between;align-items:center;flex-wrap:wrap;gap:10px">
          <div><div class="page-title">Receipt Register</div><div class="page-sub">Godown receipts &mdash; commodities received from depot</div></div>
          <button onclick="openReceiptForm()" style="background:linear-gradient(135deg,#0284C7,#0EA5E9);color:#fff;border:none;padding:9px 18px;border-radius:8px;font-weight:700;font-size:13px;cursor:pointer">+ Add Receipt</button>
        </div>
        <div id="rp-form" style="display:none;margin-bottom:16px">
          <div class="card">
            <div style="background:linear-gradient(135deg,#0369A1,#0EA5E9);border-radius:12px 12px 0 0;padding:12px 18px">
              <div style="color:#fff;font-weight:700">New Godown Receipt</div>
              <div style="color:rgba(255,255,255,.65);font-size:11px">Record commodities received from depot</div>
            </div>
            <div class="card-body">
              <div style="display:grid;grid-template-columns:1fr 1fr auto;gap:12px;margin-bottom:14px;align-items:end">
                <div><label class="form-label">CRS Shop</label><select id="rp-crs" style="width:100%;border:1px solid var(--border);border-radius:8px;padding:8px 12px;font-size:13px"><option value="">Select CRS...</option></select></div>
                <div><label class="form-label">Receipt Date</label><input type="date" id="rp-date" style="width:100%;border:1px solid var(--border);border-radius:8px;padding:8px 12px;font-size:13px"/></div>
                <div><label class="form-label">Receipt No.</label><input type="text" id="rp-no" placeholder="e.g. R/2026/001" style="width:140px;border:1px solid var(--border);border-radius:8px;padding:8px 12px;font-size:13px"/></div>
              </div>
              <div style="overflow-x:auto">
                <table style="width:100%;border-collapse:collapse;min-width:500px">
                  <thead><tr style="background:#F8FAFC">
                    <th style="padding:8px 10px;text-align:center;font-size:10px;font-weight:700;color:var(--muted);border-bottom:1px solid var(--border)">#</th>
                    <th style="padding:8px 12px;text-align:left;font-size:10px;font-weight:700;color:var(--muted);border-bottom:1px solid var(--border)">Commodity</th>
                    <th style="padding:8px 10px;text-align:center;font-size:10px;font-weight:700;color:var(--muted);border-bottom:1px solid var(--border)">Unit</th>
                    <th style="padding:8px 10px;text-align:center;font-size:10px;font-weight:700;color:#0369A1;border-bottom:1px solid var(--border);background:#EFF6FF">Qty Received</th>
                    <th style="padding:8px 10px;text-align:center;font-size:10px;font-weight:700;color:var(--muted);border-bottom:1px solid var(--border)">
                      Packing <span style="font-size:9px;font-weight:400">(auto-calculated)</span><br>
                      <span style="display:inline-flex;gap:4px;margin-top:2px">
                        <span style="background:#F59E0B;color:#fff;font-size:8px;padding:1px 4px;border-radius:3px">GUNNY ÷50</span>
                        <span style="background:#EF4444;color:#fff;font-size:8px;padding:1px 4px;border-radius:3px">C.BOX ÷10/50</span>
                        <span style="background:#16A34A;color:#fff;font-size:8px;padding:1px 4px;border-radius:3px">POLY ÷50/25</span>
                      </span>
                    </th>
                  </tr></thead>
                  <tbody id="rp-tbody"></tbody>
                </table>
              </div>
              <div style="display:flex;justify-content:flex-end;gap:10px;margin-top:14px">
                <button onclick="closeReceiptForm()" style="background:#fff;border:1px solid var(--border);padding:8px 18px;border-radius:8px;font-size:13px;cursor:pointer">Cancel</button>
                <button onclick="saveReceipt()" style="background:linear-gradient(135deg,#0284C7,#0EA5E9);color:#fff;border:none;padding:8px 22px;border-radius:8px;font-weight:700;font-size:13px;cursor:pointer">&#128190; Save Receipt</button>
              </div>
            </div>
          </div>
        </div>
        <div class="card">
          <div style="padding:12px 16px;border-bottom:1px solid var(--border);display:flex;gap:10px;align-items:center;flex-wrap:wrap">
            <select id="rp-filter-crs" onchange="renderReceiptLog()" style="border:1px solid var(--border);border-radius:7px;padding:7px 10px;font-size:12px"><option value="">All CRS Shops</option></select>
            <input type="month" id="rp-filter-month" onchange="renderReceiptLog()" style="border:1px solid var(--border);border-radius:7px;padding:7px 10px;font-size:12px"/>
            <span id="rp-log-count" style="margin-left:auto;font-size:12px;color:var(--muted)"></span>
          </div>
          <div id="rp-log-wrap">
            <div style="text-align:center;padding:40px;color:var(--muted)"><div style="font-size:36px;margin-bottom:10px">&#129534;</div><div style="font-weight:600">No receipts recorded yet</div><div style="font-size:12px;margin-top:4px">Click "+ Add Receipt" to log godown receipts</div></div>
          </div>
        </div>
      </div>

`;

export default html;
