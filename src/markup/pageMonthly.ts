// Monthly Sales Entry
// Verbatim from TNCSC_CRS_Demo_19 (1).html lines 862-1219.
const html = `
      <div class="page" id="page-monthly">
        <div class="page-header">
          <div class="page-title">Monthly Sales Entry</div>
          <div class="page-sub">மாதாந்திர விற்பனை அறிக்கை — Enter full month receipt &amp; sales, then generate statement</div>
        </div>

        <!-- Selection -->
        <div class="card mb-4">
          <div class="card-body">
            <div style="display:grid;grid-template-columns:1fr 1fr 1fr auto;gap:14px;align-items:end">
              <div>
                <label class="form-label">CRS Shop</label>
                <select id="me-crs" onchange="onMonthlyChange()">
                  <option value="">Select CRS Shop...</option>
                </select>
              </div>
              <div>
                <label class="form-label">Month</label>
                <select id="me-month" onchange="onMonthlyChange()">
                  <option value="1">January</option><option value="2">February</option>
                  <option value="3">March</option><option value="4">April</option>
                  <option value="5">May</option><option value="6">June</option>
                  <option value="7" selected>July</option><option value="8">August</option>
                  <option value="9">September</option><option value="10">October</option>
                  <option value="11">November</option><option value="12">December</option>
                </select>
              </div>
              <div>
                <label class="form-label">Year</label>
                <select id="me-year" onchange="onMonthlyChange()">
                  <option value="2025">2025</option>
                  <option value="2026" selected>2026</option>
                </select>
              </div>
              <div>
                <div style="display:flex;gap:8px;flex-wrap:wrap">
                  <button onclick="generateMonthlyStatement()" style="background:linear-gradient(135deg,#0284C7,#0EA5E9);color:#fff;border:none;padding:10px 18px;border-radius:9px;font-weight:700;font-size:13px;cursor:pointer;white-space:nowrap;box-shadow:0 2px 10px rgba(14,165,233,.3)">
                    📄 Generate Statement
                  </button>
                  <button onclick="meLoadSampleData()" title="Seed Daily Entry, Monthly Entry, Receipt, Gunny, Cards, Remittance and Inspection for this CRS and month"
                    style="background:linear-gradient(135deg,#7C3AED,#A855F7);color:#fff;border:none;padding:10px 16px;border-radius:9px;font-weight:700;font-size:13px;cursor:pointer;white-space:nowrap">
                    🧪 Sample Data
                  </button>
                </div>
              </div>
            </div>
          </div>
        </div>

        <!-- Empty state -->
        <div id="me-empty" style="text-align:center;padding:64px 24px;color:var(--muted)">
          <div style="font-size:52px;margin-bottom:14px">📅</div>
          <div style="font-weight:700;font-size:16px;color:var(--text);margin-bottom:6px">Select a CRS shop and month</div>
          <div style="font-size:13px">The monthly commodity entry table will appear</div>
        </div>

        <!-- Monthly form -->
        <div id="me-form-wrap" style="display:none">

          <!-- [+redesign-start] Success banner wording, to match the renamed action button. -->
          <div id="me-success" style="display:none;background:#DCFCE7;border:1px solid #86EFAC;border-radius:10px;padding:12px 16px;margin-bottom:14px;color:#15803D;font-size:13px;font-weight:600">
            &#9989; &#2990;&#3006;&#2980; &#2997;&#3007;&#2993;&#3021;&#2986;&#2985;&#3016; &#2984;&#3007;&#2993;&#3016;&#2997;&#3009; — this month's entry, remittance, gunny stock and card details are saved.
          </div>
          <!-- [+redesign-end] -->

          <!-- Header -->
          <div style="background:linear-gradient(135deg,#0369A1,#0EA5E9);border-radius:12px 12px 0 0;padding:14px 20px;display:flex;justify-content:space-between;align-items:center">
            <div>
              <div id="me-title" style="color:#fff;font-weight:800;font-size:15px"></div>
              <div id="me-sub" style="color:rgba(255,255,255,.65);font-size:11px;margin-top:2px">Enter receipt and sales for the full month</div>
            </div>
            <div style="text-align:right">
              <div style="color:rgba(255,255,255,.6);font-size:10px;text-transform:uppercase;letter-spacing:.08em">Total Amount</div>
              <div id="me-grand-total" style="color:#fff;font-weight:900;font-size:22px">₹0.00</div>
            </div>
          </div>

          <!-- Section A -->
          <div class="card" style="border-radius:0;border-top:none;border-bottom:none">
            <div style="background:#F0F9FF;padding:9px 16px;border-bottom:1px solid #BAE6FD;display:flex;align-items:center;gap:8px">
              <span style="background:#0369A1;color:#fff;font-size:10px;font-weight:800;padding:2px 8px;border-radius:4px">SECTION A</span>
              <span style="font-weight:700;font-size:12px;color:#0369A1">நியாய வகுப்பு / Main Ration — Monthly</span>
            </div>
            <div style="overflow-x:auto">
              <table style="width:100%;border-collapse:collapse;min-width:780px">
                                  <!-- Row 1: group headers -->
                  <tr style="background:#F8FAFC">
                    <th rowspan="2" style="padding:8px 6px;text-align:center;font-size:9px;font-weight:700;color:var(--muted);border-bottom:1px solid var(--border);border-right:1px solid #E2E8F0;width:30px">#</th>
                    <th rowspan="2" style="padding:8px 10px;text-align:left;font-size:9px;font-weight:700;color:var(--muted);border-bottom:1px solid var(--border);border-right:1px solid #E2E8F0;min-width:130px">பொருட்கள் / Commodity</th>
                    <th rowspan="2" style="padding:8px 5px;text-align:center;font-size:9px;font-weight:700;color:var(--muted);border-bottom:1px solid var(--border);border-right:1px solid #E2E8F0;width:38px">Unit</th>
                    <th colspan="2" style="padding:5px 4px;text-align:center;font-size:9px;font-weight:700;color:var(--muted);border-bottom:1px solid #E2E8F0;border-right:1px solid #CBD5E1;background:#F8FAFC">ஆரம்ப இருப்பு / Opening</th>
                    <th colspan="2" style="padding:5px 4px;text-align:center;font-size:9px;font-weight:700;color:var(--muted);border-bottom:1px solid #E2E8F0;border-right:1px solid #CBD5E1;background:#F8FAFC">வரவு / Receipt</th><th data-adjcol="excess" rowspan="2" style="padding:8px 5px;text-align:center;font-size:9px;font-weight:700;color:#166534;border-bottom:1px solid #E2E8F0;border-right:1px solid #E2E8F0;background:#F0FDF4;width:52px">Excess</th><th data-adjcol="shortage" rowspan="2" style="padding:8px 5px;text-align:center;font-size:9px;font-weight:700;color:#B91C1C;border-bottom:1px solid #E2E8F0;border-right:1px solid #E2E8F0;background:#FEF2F2;width:52px">Short<br>age</th><th data-adjcol="transfer" rowspan="2" style="padding:8px 5px;text-align:center;font-size:9px;font-weight:700;color:#92400E;border-bottom:1px solid #E2E8F0;border-right:1px solid #E2E8F0;background:#FFFBEB;width:52px">Trans<br>fer</th>
                    <th colspan="2" style="padding:5px 4px;text-align:center;font-size:9px;font-weight:700;color:#0284C7;border-bottom:1px solid #E2E8F0;border-right:1px solid #CBD5E1;background:#EFF6FF">மொத்தம் / Total</th>
                    <th colspan="2" style="padding:5px 4px;text-align:center;font-size:9px;font-weight:700;color:var(--muted);border-bottom:1px solid #E2E8F0;border-right:1px solid #CBD5E1;background:#F8FAFC">விற்பனை / Sales</th>
                    <th data-adjcol="cs" colspan="2" style="padding:5px 4px;text-align:center;font-size:9px;font-weight:700;color:#7C3AED;border-bottom:1px solid #E2E8F0;border-right:1px solid #CBD5E1;background:#F3E8FF">C.S / Cum.Short</th><!-- [+] -->
                    <th colspan="2" style="padding:5px 4px;text-align:center;font-size:9px;font-weight:700;color:var(--muted);border-bottom:1px solid #E2E8F0;border-right:1px solid #CBD5E1;background:#F8FAFC">இறுதி இருப்பு / Closing</th>
                    <th rowspan="2" style="padding:8px 5px;text-align:center;font-size:9px;font-weight:700;color:#D97706;border-bottom:1px solid var(--border);border-right:1px solid #E2E8F0;width:52px;background:#FFFBEB">Rate (₹)</th>
                    <th rowspan="2" style="padding:8px 5px;text-align:center;font-size:9px;font-weight:700;color:#0369A1;border-bottom:1px solid var(--border);background:#EFF6FF;min-width:80px">விற்பனை தொகை / Amount (₹)</th>
                  </tr>
                  <!-- Row 2: Gunny/Kgs sub-headers -->
                  <tr style="background:#F8FAFC">
                    <th style="padding:5px 3px;text-align:center;font-size:8px;font-weight:700;color:#92400E;border-bottom:1px solid var(--border);border-right:1px solid #E2E8F0;background:#FFFBEB;width:42px">Gunny</th>
                    <th style="padding:5px 3px;text-align:center;font-size:8px;font-weight:600;color:var(--muted);border-bottom:1px solid var(--border);border-right:1px solid #CBD5E1;width:80px">Kgs</th>
                    <th style="padding:5px 3px;text-align:center;font-size:8px;font-weight:700;color:#92400E;border-bottom:1px solid var(--border);border-right:1px solid #E2E8F0;background:#FFFBEB;width:42px">Gunny</th>
                    <th style="padding:5px 3px;text-align:center;font-size:8px;font-weight:600;color:var(--muted);border-bottom:1px solid var(--border);border-right:1px solid #CBD5E1;width:80px">Kgs</th>
                    <th style="padding:5px 3px;text-align:center;font-size:8px;font-weight:700;color:#0369A1;border-bottom:1px solid var(--border);border-right:1px solid #E2E8F0;background:#DBEAFE;width:42px">Gunny</th>
                    <th style="padding:5px 3px;text-align:center;font-size:8px;font-weight:600;color:#0369A1;border-bottom:1px solid var(--border);border-right:1px solid #CBD5E1;background:#EFF6FF;width:80px">Kgs</th>
                    <th style="padding:5px 3px;text-align:center;font-size:8px;font-weight:700;color:#92400E;border-bottom:1px solid var(--border);border-right:1px solid #E2E8F0;background:#FFFBEB;width:42px">Gunny</th>
                    <th style="padding:5px 3px;text-align:center;font-size:8px;font-weight:600;color:var(--muted);border-bottom:1px solid var(--border);border-right:1px solid #CBD5E1;width:80px">Kgs</th>
                    <th data-adjcol="cs" style="padding:5px 3px;text-align:center;font-size:8px;font-weight:700;color:#7C3AED;border-bottom:1px solid var(--border);border-right:1px solid #E2E8F0;background:#F3E8FF;width:42px">Bags</th><!-- [+] -->
                    <th data-adjcol="cs" style="padding:5px 3px;text-align:center;font-size:8px;font-weight:600;color:#7C3AED;border-bottom:1px solid var(--border);border-right:1px solid #CBD5E1;background:#FAF5FF;width:80px">Kgs</th><!-- [+] -->
                    <th style="padding:5px 3px;text-align:center;font-size:8px;font-weight:700;color:#92400E;border-bottom:1px solid var(--border);border-right:1px solid #E2E8F0;background:#FFFBEB;width:42px">Gunny</th>
                    <th style="padding:5px 3px;text-align:center;font-size:8px;font-weight:600;color:var(--muted);border-bottom:1px solid var(--border);border-right:1px solid #CBD5E1;width:80px">Kgs</th>
                  </tr>
                <tbody id="me-tbody-a"></tbody>
                <tfoot>
                  <tr style="background:#EFF6FF;font-weight:800">
                    <td id="me-a-foot" colspan="3" style="padding:10px 12px;font-size:12px;color:#0369A1;border-top:2px solid #BAE6FD">Section A Total</td>
                    <td id="me-a-gopen" style="padding:9px 3px;text-align:center;font-size:10px;font-weight:800;color:#92400E;background:#FFFBEB;border-top:2px solid #BAE6FD">0</td>
                    <td id="me-a-open" style="padding:9px 4px;text-align:right;font-size:11px;color:#0369A1;border-top:2px solid #BAE6FD">0.000</td>
                    <td id="me-a-grec" style="padding:9px 3px;text-align:center;font-size:10px;font-weight:800;color:#92400E;background:#FFFBEB;border-top:2px solid #BAE6FD">0</td>
                    <td id="me-a-rec" style="padding:9px 4px;text-align:right;font-size:11px;color:#0369A1;border-top:2px solid #BAE6FD">0.000</td>
                    <td id="me-a-ex" data-adjcol="excess"   style="padding:9px 4px;text-align:right;font-size:11px;color:#166534;background:#F0FDF4;border-top:2px solid #BAE6FD">0.000</td>
                    <td id="me-a-sh" data-adjcol="shortage" style="padding:9px 4px;text-align:right;font-size:11px;color:#B91C1C;background:#FEF2F2;border-top:2px solid #BAE6FD">0.000</td>
                    <td id="me-a-tr" data-adjcol="transfer" style="padding:9px 4px;text-align:right;font-size:11px;color:#92400E;background:#FFFBEB;border-top:2px solid #BAE6FD">0.000</td>
                    <td id="me-a-gtotal" style="padding:9px 3px;text-align:center;font-size:10px;font-weight:800;color:#0369A1;background:#DBEAFE;border-top:2px solid #BAE6FD">0</td>
                    <td id="me-a-total" style="padding:9px 4px;text-align:right;font-size:11px;color:#0284C7;background:#EFF6FF;border-top:2px solid #BAE6FD">0.000</td>
                    <td id="me-a-gsales" style="padding:9px 3px;text-align:center;font-size:10px;font-weight:800;color:#92400E;background:#FFFBEB;border-top:2px solid #BAE6FD">0</td>
                    <td id="me-a-sales" style="padding:9px 4px;text-align:right;font-size:11px;color:#0369A1;border-top:2px solid #BAE6FD">0.000</td>
                    <td id="me-a-gcs" data-adjcol="cs" style="padding:9px 3px;text-align:center;font-size:10px;font-weight:800;color:#7C3AED;background:#F3E8FF;border-top:2px solid #BAE6FD">0</td><!-- [+] -->
                    <td id="me-a-cs" data-adjcol="cs" style="padding:9px 4px;text-align:right;font-size:11px;color:#7C3AED;background:#FAF5FF;border-top:2px solid #BAE6FD">0.000</td><!-- [+] -->
                    <td id="me-a-gclose" style="padding:9px 3px;text-align:center;font-size:10px;font-weight:800;color:#92400E;background:#FFFBEB;border-top:2px solid #BAE6FD">0</td>
                    <td id="me-a-close" style="padding:9px 4px;text-align:right;font-size:11px;color:#0369A1;border-top:2px solid #BAE6FD">0.000</td>
                    <td style="border-top:2px solid #BAE6FD;background:#FFFBEB"></td>
                    <td id="me-a-amt" style="padding:9px 4px;text-align:right;font-size:11px;color:#0369A1;border-top:2px solid #BAE6FD">&#8377;0.00</td>
                  </tr>
                </tfoot>
              </table>
            </div>
          </div>

          <!-- Section B -->
          <div class="card" style="border-radius:0;border-top:none;border-bottom:none;margin-top:2px">
            <div style="background:#FFF7ED;padding:9px 16px;border-bottom:1px solid #FED7AA;border-top:1px solid #BAE6FD;display:flex;align-items:center;gap:8px">
              <span style="background:#C2410C;color:#fff;font-size:10px;font-weight:800;padding:2px 8px;border-radius:4px">SECTION B</span>
              <span style="font-weight:700;font-size:12px;color:#C2410C">காவலர் அட்டை / Police Ration — Monthly</span>
            </div>
            <div style="overflow-x:auto">
              <table style="width:100%;border-collapse:collapse;min-width:780px">
                <thead>
                  <!-- Row 1: group headers (Police section — warm orange theme) -->
                  <tr style="background:#FFFBF5">
                    <th rowspan="2" style="padding:8px 6px;text-align:center;font-size:9px;font-weight:700;color:var(--muted);border-bottom:1px solid #FED7AA;border-right:1px solid #FED7AA;width:30px">#</th>
                    <th rowspan="2" style="padding:8px 10px;text-align:left;font-size:9px;font-weight:700;color:var(--muted);border-bottom:1px solid #FED7AA;border-right:1px solid #FED7AA;min-width:130px">பொருட்கள் / Commodity</th>
                    <th rowspan="2" style="padding:8px 5px;text-align:center;font-size:9px;font-weight:700;color:var(--muted);border-bottom:1px solid #FED7AA;border-right:1px solid #FED7AA;width:38px">Unit</th>
                    <th colspan="2" style="padding:5px 4px;text-align:center;font-size:9px;font-weight:700;color:var(--muted);border-bottom:1px solid #FED7AA;border-right:1px solid #FED7AA;background:#FFFBF5">ஆரம்ப இருப்பு / Opening</th>
                    <th colspan="2" style="padding:5px 4px;text-align:center;font-size:9px;font-weight:700;color:var(--muted);border-bottom:1px solid #FED7AA;border-right:1px solid #FED7AA;background:#FFFBF5">வரவு / Receipt</th><th data-adjcol="excess" rowspan="2" style="padding:8px 5px;text-align:center;font-size:9px;font-weight:700;color:#166534;border-bottom:1px solid #FED7AA;border-right:1px solid #FED7AA;background:#F0FDF4;width:52px">Excess</th><th data-adjcol="shortage" rowspan="2" style="padding:8px 5px;text-align:center;font-size:9px;font-weight:700;color:#B91C1C;border-bottom:1px solid #FED7AA;border-right:1px solid #FED7AA;background:#FEF2F2;width:52px">Short<br>age</th><th data-adjcol="transfer" rowspan="2" style="padding:8px 5px;text-align:center;font-size:9px;font-weight:700;color:#92400E;border-bottom:1px solid #FED7AA;border-right:1px solid #FED7AA;background:#FFFBEB;width:52px">Trans<br>fer</th>
                    <th colspan="2" style="padding:5px 4px;text-align:center;font-size:9px;font-weight:700;color:#0284C7;border-bottom:1px solid #FED7AA;border-right:1px solid #FED7AA;background:#EFF6FF">மொத்தம் / Total</th>
                    <th colspan="2" style="padding:5px 4px;text-align:center;font-size:9px;font-weight:700;color:var(--muted);border-bottom:1px solid #FED7AA;border-right:1px solid #FED7AA;background:#FFFBF5">விற்பனை / Sales</th>
                    <th data-adjcol="cs" colspan="2" style="padding:5px 4px;text-align:center;font-size:9px;font-weight:700;color:#7C3AED;border-bottom:1px solid #FED7AA;border-right:1px solid #FED7AA;background:#F3E8FF">C.S / Cum.Short</th><!-- [+] -->
                    <th colspan="2" style="padding:5px 4px;text-align:center;font-size:9px;font-weight:700;color:var(--muted);border-bottom:1px solid #FED7AA;border-right:1px solid #FED7AA;background:#FFFBF5">இறுதி இருப்பு / Closing</th>
                    <th rowspan="2" style="padding:8px 5px;text-align:center;font-size:9px;font-weight:700;color:#D97706;border-bottom:1px solid #FED7AA;border-right:1px solid #FED7AA;width:52px;background:#FFFBEB">Rate (₹)</th>
                    <th rowspan="2" style="padding:8px 5px;text-align:center;font-size:9px;font-weight:700;color:#C2410C;border-bottom:1px solid #FED7AA;background:#FFF3E8;min-width:80px">விற்பனை தொகை / Amount (₹)</th>
                  </tr>
                  <!-- Row 2: Gunny/Kgs sub-headers -->
                  <tr style="background:#FFFBF5">
                    <th style="padding:5px 3px;text-align:center;font-size:8px;font-weight:700;color:#92400E;border-bottom:1px solid #FED7AA;border-right:1px solid #FED7AA;background:#FFFBEB;width:42px">Gunny</th>
                    <th style="padding:5px 3px;text-align:center;font-size:8px;font-weight:600;color:var(--muted);border-bottom:1px solid #FED7AA;border-right:1px solid #FED7AA;width:80px">Kgs</th>
                    <th style="padding:5px 3px;text-align:center;font-size:8px;font-weight:700;color:#92400E;border-bottom:1px solid #FED7AA;border-right:1px solid #FED7AA;background:#FFFBEB;width:42px">Gunny</th>
                    <th style="padding:5px 3px;text-align:center;font-size:8px;font-weight:600;color:var(--muted);border-bottom:1px solid #FED7AA;border-right:1px solid #FED7AA;width:80px">Kgs</th>
                    <th style="padding:5px 3px;text-align:center;font-size:8px;font-weight:700;color:#0369A1;border-bottom:1px solid #FED7AA;border-right:1px solid #FED7AA;background:#DBEAFE;width:42px">Gunny</th>
                    <th style="padding:5px 3px;text-align:center;font-size:8px;font-weight:600;color:#0369A1;border-bottom:1px solid #FED7AA;border-right:1px solid #FED7AA;background:#EFF6FF;width:80px">Kgs</th>
                    <th style="padding:5px 3px;text-align:center;font-size:8px;font-weight:700;color:#92400E;border-bottom:1px solid #FED7AA;border-right:1px solid #FED7AA;background:#FFFBEB;width:42px">Gunny</th>
                    <th style="padding:5px 3px;text-align:center;font-size:8px;font-weight:600;color:var(--muted);border-bottom:1px solid #FED7AA;border-right:1px solid #FED7AA;width:80px">Kgs</th>
                    <th data-adjcol="cs" style="padding:5px 3px;text-align:center;font-size:8px;font-weight:700;color:#7C3AED;border-bottom:1px solid #FED7AA;border-right:1px solid #FED7AA;background:#F3E8FF;width:42px">Bags</th><!-- [+] -->
                    <th data-adjcol="cs" style="padding:5px 3px;text-align:center;font-size:8px;font-weight:600;color:#7C3AED;border-bottom:1px solid #FED7AA;border-right:1px solid #FED7AA;background:#FAF5FF;width:80px">Kgs</th><!-- [+] -->
                    <th style="padding:5px 3px;text-align:center;font-size:8px;font-weight:700;color:#92400E;border-bottom:1px solid #FED7AA;border-right:1px solid #FED7AA;background:#FFFBEB;width:42px">Gunny</th>
                    <th style="padding:5px 3px;text-align:center;font-size:8px;font-weight:600;color:var(--muted);border-bottom:1px solid #FED7AA;border-right:1px solid #FED7AA;width:80px">Kgs</th>
                  </tr>
                </thead>
                <tbody id="me-tbody-b"></tbody>
                <tfoot>
                  <tr style="background:#FFF7ED;font-weight:800">
                                        <td id="me-b-foot" colspan="3" style="padding:10px 12px;font-size:12px;color:#C2410C;border-top:2px solid #FED7AA">Section B Total</td>
                    <td id="me-b-gopen" style="padding:9px 3px;text-align:center;font-size:10px;font-weight:800;color:#92400E;background:#FFFBEB;border-top:2px solid #FED7AA">0</td>
                    <td id="me-b-open" style="padding:9px 4px;text-align:right;font-size:11px;color:#C2410C;border-top:2px solid #FED7AA">0.000</td>
                    <td id="me-b-grec" style="padding:9px 3px;text-align:center;font-size:10px;font-weight:800;color:#92400E;background:#FFFBEB;border-top:2px solid #FED7AA">0</td>
                    <td id="me-b-rec" style="padding:9px 4px;text-align:right;font-size:11px;color:#C2410C;border-top:2px solid #FED7AA">0.000</td>
                    <td id="me-b-ex" data-adjcol="excess"   style="padding:9px 4px;text-align:right;font-size:11px;color:#166534;background:#F0FDF4;border-top:2px solid #FED7AA">0.000</td>
                    <td id="me-b-sh" data-adjcol="shortage" style="padding:9px 4px;text-align:right;font-size:11px;color:#B91C1C;background:#FEF2F2;border-top:2px solid #FED7AA">0.000</td>
                    <td id="me-b-tr" data-adjcol="transfer" style="padding:9px 4px;text-align:right;font-size:11px;color:#92400E;background:#FFFBEB;border-top:2px solid #FED7AA">0.000</td>
                    <td id="me-b-gtotal" style="padding:9px 3px;text-align:center;font-size:10px;font-weight:800;color:#0369A1;background:#DBEAFE;border-top:2px solid #FED7AA">0</td>
                    <td id="me-b-total" style="padding:9px 4px;text-align:right;font-size:11px;color:#0284C7;background:#EFF6FF;border-top:2px solid #FED7AA">0.000</td>
                    <td id="me-b-gsales" style="padding:9px 3px;text-align:center;font-size:10px;font-weight:800;color:#92400E;background:#FFFBEB;border-top:2px solid #FED7AA">0</td>
                    <td id="me-b-sales" style="padding:9px 4px;text-align:right;font-size:11px;color:#C2410C;border-top:2px solid #FED7AA">0.000</td>
                    <td id="me-b-gcs" data-adjcol="cs" style="padding:9px 3px;text-align:center;font-size:10px;font-weight:800;color:#7C3AED;background:#F3E8FF;border-top:2px solid #FED7AA">0</td><!-- [+] -->
                    <td id="me-b-cs" data-adjcol="cs" style="padding:9px 4px;text-align:right;font-size:11px;color:#7C3AED;background:#FAF5FF;border-top:2px solid #FED7AA">0.000</td><!-- [+] -->
                    <td id="me-b-gclose" style="padding:9px 3px;text-align:center;font-size:10px;font-weight:800;color:#92400E;background:#FFFBEB;border-top:2px solid #FED7AA">0</td>
                    <td id="me-b-close" style="padding:9px 4px;text-align:right;font-size:11px;color:#C2410C;border-top:2px solid #FED7AA">0.000</td>
                    <td style="border-top:2px solid #FED7AA;background:#FFFBEB"></td>
                    <td id="me-b-amt" style="padding:9px 4px;text-align:right;font-size:11px;color:#C2410C;border-top:2px solid #FED7AA">&#8377;0.00</td>
                  </tr>
                </tfoot>
              </table>
            </div>
          </div>

          <!-- Summary + Actions -->
          <div class="card" style="border-radius:0 0 12px 12px;border-top:none">
            <div style="padding:14px 20px;display:flex;align-items:center;justify-content:space-between;flex-wrap:wrap;gap:12px">
              <div style="display:flex;align-items:center;gap:20px">
                <div style="text-align:center">
                  <div style="font-size:10px;color:var(--muted);text-transform:uppercase;letter-spacing:.05em">Section A</div>
                  <div id="me-sum-a" style="font-weight:800;font-size:16px;color:#0369A1">₹0.00</div>
                </div>
                <div style="width:1px;height:32px;background:var(--border)"></div>
                <div style="text-align:center">
                  <div style="font-size:10px;color:var(--muted);text-transform:uppercase;letter-spacing:.05em">Section B</div>
                  <div id="me-sum-b" style="font-weight:800;font-size:16px;color:#C2410C">₹0.00</div>
                </div>
                <div style="width:1px;height:32px;background:var(--border)"></div>
                <div style="text-align:center">
                  <div style="font-size:10px;color:var(--muted);text-transform:uppercase;letter-spacing:.05em">Grand Total</div>
                  <div id="me-sum-grand" style="font-weight:900;font-size:18px;color:#16A34A">₹0.00</div>
                </div>
              </div>
              <!-- [+redesign-start] Monthly Entry action bar, redesigned after the port: the
                   save button carries its Tamil name and sits as the primary action on the far
                   right. The port's own text for this block is held in REDESIGNED in
                   tools/verify-parity.mjs and spliced back before the byte comparison. -->
              <!-- ── Actions ───────────────────────────────────────────────── -->
              <div style="display:flex;align-items:center;gap:10px;margin-top:14px;width:100%">
                <button class="btn btn-outline btn-sm" onclick="clearMonthlyForm()">🗑 Clear</button>
                <button id="me-save-btn" onclick="saveMonthlyEntry()" title="&#2990;&#3006;&#2980; &#2997;&#3007;&#2993;&#3021;&#2986;&#2985;&#3016; &#2984;&#3007;&#2993;&#3016;&#2997;&#3009; — store this month's entry, remittance, gunny stock and card details" style="margin-left:auto;background:linear-gradient(135deg,#0284C7,#0EA5E9);color:#fff;border:none;padding:10px 22px;border-radius:9px;font-weight:700;font-size:13px;cursor:pointer;box-shadow:0 2px 10px rgba(14,165,233,.3)">
                  &#128190; &#2990;&#3006;&#2980; &#2997;&#3007;&#2993;&#3021;&#2986;&#2985;&#3016; &#2984;&#3007;&#2993;&#3016;&#2997;&#3009;
                </button>
              </div>
              <!-- [+redesign-end] -->
              <!-- ── Monthly Remittance Section (below save button) ─────── --> ──────────────────────────── -->
              <div id="me-remit-section" style="display:none;width:100%;margin-top:20px">
                <div style="background:linear-gradient(135deg,#1E40AF,#2563EB);border-radius:10px 10px 0 0;padding:10px 16px;display:flex;justify-content:space-between;align-items:center">
                  <div>
                    <div style="color:#fff;font-weight:800;font-size:13px">&#127981; Monthly Remittance — SRCB</div>
                    <div id="me-remit-subtitle" style="color:rgba(255,255,255,.7);font-size:10px;margin-top:1px"></div>
                  </div>
                  <div style="color:rgba(255,255,255,.6);font-size:10px">Date-wise bank deposit details</div>
                </div>
                <div style="overflow-x:auto;border:1px solid #DBEAFE;border-top:none;border-radius:0 0 10px 10px">
                  <table style="width:100%;border-collapse:collapse;font-size:12px;min-width:700px">
                    <thead>
                      <tr style="background:#EFF6FF">
                        <th style="padding:8px 10px;text-align:center;font-size:10px;font-weight:700;color:#1D4ED8;border-bottom:2px solid #BFDBFE;white-space:nowrap">S.No</th>
                        <th style="padding:8px 12px;text-align:left;font-size:10px;font-weight:700;color:#1D4ED8;border-bottom:2px solid #BFDBFE;white-space:nowrap">Sales Date</th>
                        <th style="padding:8px 10px;text-align:center;font-size:10px;font-weight:700;color:#1D4ED8;border-bottom:2px solid #BFDBFE;white-space:nowrap">Remittance Date</th>
                        <th style="padding:8px 10px;text-align:right;font-size:10px;font-weight:700;color:#1D4ED8;border-bottom:2px solid #BFDBFE;white-space:nowrap">Non-Cereal A/C (&#8377;)</th>
                        <th style="padding:8px 10px;text-align:right;font-size:10px;font-weight:700;color:#1D4ED8;border-bottom:2px solid #BFDBFE;white-space:nowrap">Cereal A/C (&#8377;)</th>
                        <th style="padding:8px 10px;text-align:right;font-size:10px;font-weight:700;color:#0369A1;border-bottom:2px solid #BFDBFE;white-space:nowrap;background:#DBEAFE">Total Amount (&#8377;)</th>
                      </tr>
                    </thead>
                    <tbody id="me-remit-tbody"></tbody>
                    <tfoot id="me-remit-tfoot">
                      <tr style="background:#1E40AF">
                        <td colspan="3" style="padding:8px 12px;font-weight:800;font-size:12px;color:#fff;text-align:right">TOTAL</td>
                        <td id="me-remit-tot-noncereal" style="padding:8px 10px;font-weight:800;font-size:13px;color:#fff;text-align:right">&#8377;0.00</td>
                        <td id="me-remit-tot-cereal"    style="padding:8px 10px;font-weight:800;font-size:13px;color:#fff;text-align:right">&#8377;0.00</td>
                        <td id="me-remit-tot-total"     style="padding:8px 10px;font-weight:900;font-size:14px;color:#FDE68A;text-align:right">&#8377;0.00</td>
                      </tr>
                    </tfoot>
                  </table>
                </div>
                <div style="margin-top:8px;font-size:10px;color:var(--muted);display:flex;gap:16px">
                  <span>&#9432; Same Remittance Date allowed for multiple days (batch deposit)</span>
                  <span>&#9432; Leave Remittance Date empty if no deposit was made that day</span>
                </div>
              </div>

              <!-- ── Gunny Stock Management Section ──────────────────────────── -->
              <div id="me-gunny-section" style="display:none;width:100%;margin-top:20px">
                <div style="background:linear-gradient(135deg,#6D28D9,#8B5CF6);border-radius:10px 10px 0 0;padding:10px 16px;display:flex;justify-content:space-between;align-items:center">
                  <div>
                    <div style="color:#fff;font-weight:800;font-size:13px">&#128230; Gunny Stock Management</div>
                    <div id="me-gunny-subtitle" style="color:rgba(255,255,255,.7);font-size:10px;margin-top:1px"></div>
                  </div>
                  <div style="color:rgba(255,255,255,.6);font-size:10px">Gunny bags / sacks — opening, receipt, issues &amp; closing</div>
                </div>
                <div style="overflow-x:auto;border:1px solid #EDE9FE;border-top:none;border-radius:0 0 10px 10px">
                  <table style="width:100%;border-collapse:collapse;font-size:12px;min-width:560px">
                    <thead>
                      <tr style="background:#F5F3FF">
                        <th style="padding:9px 10px;text-align:center;font-size:10px;font-weight:700;color:#6D28D9;border-bottom:2px solid #DDD6FE;width:55px">S.No</th>
                        <th style="padding:9px 14px;text-align:left;font-size:10px;font-weight:700;color:#6D28D9;border-bottom:2px solid #DDD6FE">Item</th>
                        <th style="padding:9px 10px;text-align:center;font-size:10px;font-weight:700;color:#6D28D9;border-bottom:2px solid #DDD6FE">Opening</th>
                        <th style="padding:9px 10px;text-align:center;font-size:10px;font-weight:700;color:#6D28D9;border-bottom:2px solid #DDD6FE">Receipt</th>
                        <th style="padding:9px 10px;text-align:center;font-size:10px;font-weight:700;color:#6D28D9;border-bottom:2px solid #DDD6FE;background:#EDE9FE">Total</th>
                        <th style="padding:9px 10px;text-align:center;font-size:10px;font-weight:700;color:#6D28D9;border-bottom:2px solid #DDD6FE">Issues</th>
                        <th style="padding:9px 10px;text-align:center;font-size:10px;font-weight:700;color:#6D28D9;border-bottom:2px solid #DDD6FE">Closing</th>
                      </tr>
                    </thead>
                    <tbody id="me-gunny-tbody"></tbody>
                    <tfoot>
                      <tr style="background:#6D28D9">
                        <td colspan="2" style="padding:9px 14px;font-weight:800;color:#fff;font-size:12px;text-align:right;letter-spacing:.03em">TOTAL</td>
                        <td id="me-gunny-tot-opening" style="padding:9px 10px;font-weight:800;font-size:13px;color:#fff;text-align:center">0</td>
                        <td id="me-gunny-tot-receipt" style="padding:9px 10px;font-weight:800;font-size:13px;color:#fff;text-align:center">0</td>
                        <td id="me-gunny-tot-total" style="padding:9px 10px;font-weight:900;font-size:14px;color:#FDE68A;text-align:center">0</td>
                        <td id="me-gunny-tot-issues" style="padding:9px 10px;font-weight:800;font-size:13px;color:#fff;text-align:center">0</td>
                        <td id="me-gunny-tot-closing" style="padding:9px 10px;font-weight:900;font-size:14px;color:#FDE68A;text-align:center">0</td>
                      </tr>
                    </tfoot>
                  </table>
                </div>
                <div style="margin-top:8px;font-size:10px;color:var(--muted);display:flex;gap:16px;flex-wrap:wrap">
                  <span>&#9432; Opening auto-fills from last month's Closing and locks once carried forward</span>
                  <span>&#9432; Receipt is automatic — from the Sales Close totals (Daily Entry) or the Monthly Sales gunny/poly/c.box counts</span>
                  <span>&#9432; Total = Opening + Receipt &nbsp;|&nbsp; Closing = Total &minus; Issues (turns <b style="color:#DC2626">red</b> if Issues exceed Total) &nbsp;|&nbsp; Issues flow into Monthly Sales (Poly &rarr; Poly Bag, C.Box &rarr; Card+Box)</span>
                </div>
              </div>

              <!-- [+redesign-start] Card Details, redesigned after the port: the Remarks column
                   is replaced by an Allotment panel, and the section carries its own
                   No Change / Save actions. The port's own text for this block is held in
                   REDESIGNED in tools/verify-parity.mjs and spliced back before the byte
                   comparison, so every line OUTSIDE these markers is still held to parity. -->
              <!-- ── Card Details Section ──────────────────────────────────── -->
              <div id="me-card-section" style="display:none;width:100%;margin-top:20px">
                <div style="background:linear-gradient(135deg,#0F766E,#14B8A6);border-radius:10px 10px 0 0;padding:10px 16px;display:flex;justify-content:space-between;align-items:center">
                  <div>
                    <div style="color:#fff;font-weight:800;font-size:13px">&#129530; Card Details &amp; Allotment</div>
                    <div id="me-card-subtitle" style="color:rgba(255,255,255,.7);font-size:10px;margin-top:1px"></div>
                  </div>
                  <div style="color:rgba(255,255,255,.6);font-size:10px">card count carries forward &middot; allotment is entered each month</div>
                </div>
                <div style="border:1px solid #CCFBF1;border-top:none;border-radius:0 0 10px 10px;padding:14px;display:grid;grid-template-columns:1fr 1fr;gap:16px;align-items:start">

                  <!-- Left: card counts -->
                  <div style="border:1px solid #CCFBF1;border-radius:9px;overflow-x:auto">
                    <table style="width:100%;border-collapse:collapse;font-size:12px;min-width:260px">
                      <thead>
                        <tr style="background:#F0FDFA">
                          <th style="padding:9px 10px;text-align:center;font-size:10px;font-weight:700;color:#0F766E;border-bottom:2px solid #99F6E4;width:48px">S.NO</th>
                          <th style="padding:9px 14px;text-align:left;font-size:10px;font-weight:700;color:#0F766E;border-bottom:2px solid #99F6E4">CARD DETAILS</th>
                          <th style="padding:9px 10px;text-align:center;font-size:10px;font-weight:700;color:#0F766E;border-bottom:2px solid #99F6E4;width:120px">CARD COUNT</th>
                        </tr>
                      </thead>
                      <tbody id="me-card-tbody"></tbody>
                      <tfoot>
                        <tr style="background:#0F766E">
                          <td colspan="2" style="padding:9px 14px;font-weight:800;color:#fff;font-size:12px;text-align:right;letter-spacing:.03em">TOTAL CARD</td>
                          <td id="me-card-total" style="padding:9px 10px;font-weight:900;font-size:15px;color:#CCFBF1;text-align:center">0</td>
                        </tr>
                      </tfoot>
                    </table>
                  </div>

                  <!-- Right: allotment -->
                  <div style="border:1px solid #CCFBF1;border-radius:9px;overflow-x:auto">
                    <table style="width:100%;border-collapse:collapse;font-size:12px;min-width:380px">
                      <thead>
                        <tr style="background:#F0FDFA">
                          <th style="padding:9px 10px;text-align:center;font-size:10px;font-weight:700;color:#0F766E;border-bottom:2px solid #99F6E4;width:48px">S.NO</th>
                          <th style="padding:9px 14px;text-align:left;font-size:10px;font-weight:700;color:#0F766E;border-bottom:2px solid #99F6E4">ALLOTMENT</th>
                          <th style="padding:9px 10px;text-align:center;font-size:10px;font-weight:700;color:#0F766E;border-bottom:2px solid #99F6E4;width:150px">QUANTITY</th>
                          <th style="padding:9px 10px;text-align:center;font-size:10px;font-weight:700;color:#B45309;border-bottom:2px solid #FDE68A;width:140px">ADVANCE LOAD</th>
                        </tr>
                      </thead>
                      <tbody id="me-allot-tbody"></tbody>
                      <tfoot>
                        <tr style="background:#0F766E">
                          <td colspan="2" style="padding:9px 14px;font-weight:800;color:#fff;font-size:12px;text-align:right;letter-spacing:.03em">COMMODITIES ENTERED</td>
                          <td id="me-allot-total" style="padding:9px 10px;font-weight:900;font-size:15px;color:#CCFBF1;text-align:center">0</td>
                          <td style="padding:9px 10px"></td>
                        </tr>
                      </tfoot>
                    </table>
                  </div>
                </div>

                <!-- Actions -->
                <div style="display:flex;align-items:center;gap:10px;flex-wrap:wrap;margin-top:12px">
                  <span id="me-card-status" style="display:none;font-size:11px;font-weight:600"></span>
                  <button type="button" onclick="meCardNoChange()" title="Copy last month's card counts into this month"
                    style="margin-left:auto;background:#fff;border:1px solid #99F6E4;color:#0F766E;padding:9px 18px;border-radius:8px;font-weight:700;font-size:13px;cursor:pointer">
                    &#8630; No Change
                  </button>
                  <button type="button" onclick="meCardSave()" title="Store these card counts and allotment for this month"
                    style="background:linear-gradient(135deg,#0F766E,#14B8A6);color:#fff;border:none;padding:9px 22px;border-radius:8px;font-weight:700;font-size:13px;cursor:pointer;box-shadow:0 2px 10px rgba(20,184,166,.3)">
                    &#128190; Save
                  </button>
                </div>
              </div>
              <!-- [+redesign-end] -->

            </div>
          </div>

          <!-- Statement Preview (shown after Generate) -->
          <div id="me-stmt-wrap" style="display:none;margin-top:20px">
            <div class="card">
              <div class="card-header" style="display:flex;justify-content:space-between;align-items:center">
                <div>
                  <div class="card-title">Monthly Statement Preview</div>
                  <div id="me-stmt-label" style="font-size:11px;color:var(--muted);margin-top:2px"></div>
                </div>
                <div style="display:flex;gap:8px">
                  <button class="btn btn-outline btn-sm" onclick="window.print()">🖨️ Print</button>
                  <button class="btn btn-sm" style="background:#16A34A;color:#fff">⬇ Excel</button>
                </div>
              </div>
              <div class="card-body">
                <div id="me-stmt-content"></div>
              </div>
            </div>
          </div>

        </div><!-- /me-form-wrap -->
      </div><!-- /page-monthly -->

      <!-- ─── STATEMENT ──────────────────────── -->
`;

export default html;
