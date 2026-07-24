// Statement Generation
// Verbatim from TNCSC_CRS_Demo_19 (1).html lines 1220-1348.
const html = `
          <!-- ─── STATEMENTS ──────────────────────── -->
      <div class="page" id="page-statement">
        <div class="page-header" style="display:flex;justify-content:space-between;align-items:flex-start;flex-wrap:wrap;gap:10px">
          <div>
            <div class="page-title">Statement Generation</div>
            <div class="page-sub">Generate official TNCSC monthly statements — CRS 9 June 2026 format</div>
          </div>
        </div>

        <!-- Parameters -->
        <div class="card mb-4">
          <div class="card-header"><div class="card-title">Select Parameters</div></div>
          <div class="card-body">
            <div style="display:grid;grid-template-columns:1fr 1fr 1fr;gap:14px;align-items:end;margin-bottom:16px">
              <div>
                <label class="form-label">CRS Shop</label>
                <select id="stmt-crs" onchange="stmtOnCRSChange()" style="width:100%;border:1px solid var(--border);border-radius:8px;padding:8px 12px;font-size:13px">
                  <option value="">Select CRS Shop...</option>
                </select>
              </div>
              <div>
                <label class="form-label">Month</label>
                <select id="stmt-month" onchange="stmtOnPeriodChange()" style="width:100%;border:1px solid var(--border);border-radius:8px;padding:8px 12px;font-size:13px">
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
                <select id="stmt-year" onchange="stmtOnPeriodChange()" style="width:100%;border:1px solid var(--border);border-radius:8px;padding:8px 12px;font-size:13px">
                  <option value="2025">2025</option>
                  <option value="2026" selected>2026</option>
                  <option value="2027">2027</option>
                </select>
              </div>
            </div>

            <!-- Module data status + sample-data controls -->
            <div style="border-top:1px dashed var(--border);padding-top:14px">
              <div style="display:flex;justify-content:space-between;align-items:center;flex-wrap:wrap;gap:10px;margin-bottom:10px">
                <div style="font-size:12px;font-weight:700;color:var(--text)">Source modules</div>
                <div style="display:flex;gap:8px;flex-wrap:wrap">
                  <button onclick="stmtLoadSampleData()" title="Fills Daily Entry, Monthly Entry, Receipt, Gunny Stock, Card Details, Remittance and Inspection for the selected CRS and month"
                    style="background:linear-gradient(135deg,#7C3AED,#A855F7);color:#fff;border:none;padding:8px 16px;border-radius:8px;font-size:12px;font-weight:700;cursor:pointer;box-shadow:0 2px 8px rgba(124,58,237,.25)">
                    &#129514; Load Sample Data (All Modules)
                  </button>
                  <button onclick="stmtClearSampleData()"
                    style="background:#fff;border:1px solid var(--border);color:#B91C1C;padding:8px 14px;border-radius:8px;font-size:12px;font-weight:600;cursor:pointer">
                    &#128465; Clear This Month
                  </button>
                </div>
              </div>
              <div id="stmt-module-status" style="display:flex;gap:7px;flex-wrap:wrap">
                <span style="font-size:11px;color:var(--muted)">Select a CRS shop to see which modules hold data.</span>
              </div>
              <div style="font-size:11px;color:var(--muted);margin-top:9px;line-height:1.5">
                Every section below reads live data: <strong>CRS Page 1</strong> &rarr; Card Details + Receipt &middot;
                <strong>Receipt</strong> &rarr; Receipt + Gunny Stock &middot;
                <strong>Daily Sales</strong> &rarr; Daily Entry + Remittance + Inspection &middot;
                <strong>Page 2 / Free Com / Cost Com / B6 / RBI / COLL</strong> &rarr; Monthly Entry (falling back to the Daily Entry roll-up) + Inspection &middot;
                <strong>Gunny</strong> &rarr; Gunny Stock &middot;
                <strong>Remittance / Sale Tax</strong> &rarr; Remittance &middot;
                <strong>CRS Police</strong> &rarr; Monthly Entry Section&nbsp;B.
              </div>
            </div>
          </div>
        </div>

        <!-- Statement Sections Grid -->
        <div class="card mb-4">
          <div class="card-header">
            <div class="card-title">Statement Sections</div>
            <div style="font-size:12px;color:var(--muted)">Click a heading to preview · Select checkboxes to export</div>
          </div>
          <div class="card-body">
            <div style="display:grid;grid-template-columns:repeat(4,1fr);gap:10px" id="stmt-sections-grid">
              <!-- Populated by JS -->
            </div>
          </div>
        </div>

        <!-- Export Actions (shown when sections selected) -->
        <div id="stmt-export-bar" style="display:none;background:linear-gradient(135deg,#0369A1,#0EA5E9);border-radius:12px;padding:14px 20px;margin-bottom:14px;display:flex;align-items:center;justify-content:space-between;flex-wrap:wrap;gap:10px">
          <div>
            <div style="color:#fff;font-weight:700;font-size:14px"><span id="stmt-selected-count">0</span> section(s) selected</div>
            <div style="color:rgba(255,255,255,.7);font-size:11px;margin-top:2px">for CRS <span id="stmt-export-crs-label">—</span></div>
          </div>
          <div style="display:flex;gap:8px;flex-wrap:wrap">
            <button onclick="stmtSelectAll()" style="background:rgba(255,255,255,.15);border:1px solid rgba(255,255,255,.3);color:#fff;padding:7px 14px;border-radius:7px;font-size:12px;cursor:pointer;font-weight:600">☑ Select All</button>
            <button onclick="stmtClearAll()" style="background:rgba(255,255,255,.15);border:1px solid rgba(255,255,255,.3);color:#fff;padding:7px 14px;border-radius:7px;font-size:12px;cursor:pointer">✕ Clear</button>
            <button onclick="stmtExcelDownload()" style="background:#16A34A;border:none;color:#fff;padding:7px 14px;border-radius:7px;font-size:12px;cursor:pointer;font-weight:700">📊 Excel</button>
            <button onclick="stmtPDFDownload()" style="background:#DC2626;border:none;color:#fff;padding:7px 14px;border-radius:7px;font-size:12px;cursor:pointer;font-weight:700">📄 PDF</button>
            <button onclick="stmtPrint()" style="background:#D97706;border:none;color:#fff;padding:7px 14px;border-radius:7px;font-size:12px;cursor:pointer;font-weight:700">🖨️ Print</button>
          </div>
        </div>

        <!-- Preview Panel -->
        <div id="stmt-preview-panel" style="display:none">
          <div class="card">
            <div class="card-header" style="display:flex;justify-content:space-between;align-items:center;flex-wrap:wrap;gap:10px">
              <div>
                <div class="card-title" id="stmt-preview-title">Preview</div>
                <div style="font-size:11px;color:var(--muted);margin-top:2px" id="stmt-preview-sub"></div>
              </div>
              <div style="display:flex;gap:8px">
                <button onclick="stmtClosePreview()" style="background:#fff;border:1px solid var(--border);padding:6px 14px;border-radius:7px;font-size:12px;cursor:pointer">✕ Close Preview</button>
                <button onclick="stmtPrintSection()" style="background:#0284C7;color:#fff;border:none;padding:6px 14px;border-radius:7px;font-size:12px;cursor:pointer;font-weight:600">🖨️ Print This</button>
              </div>
            </div>
            <div class="card-body" style="padding:20px">
              <div id="stmt-preview-content" style="font-family:'Courier New',monospace;font-size:12px;line-height:1.6"></div>
            </div>
          </div>
        </div>

        <!-- Previously generated -->
        <div class="card">
          <div class="card-header"><div class="card-title">Previously Generated</div></div>
          <div id="stmt-history-list" style="padding:12px 16px">
            <div style="color:var(--muted);font-size:12px;text-align:center;padding:20px">No statements generated yet</div>
          </div>
        </div>

      </div>

`;

export default html;
