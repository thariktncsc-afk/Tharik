// Daily Sales Entry
// Verbatim from TNCSC_CRS_Demo_19 (1).html lines 616-861.
const html = `
          <!-- ─── DAILY ENTRY ────────────────────── -->
      <div class="page" id="page-entry">
        <div class="page-header" style="display:flex;justify-content:space-between;align-items:flex-start;flex-wrap:wrap;gap:12px">
          <div>
            <div class="page-title">Daily Sales Entry</div>
            <div class="page-sub">தினசரி இறுப்பு / வேறுவாறு அறிக்கை &mdash; TNCSC Madurai Region</div>
          </div>
          <div style="display:flex;gap:10px;flex-shrink:0">
            <button onclick="loadSampleData()" id="btn-sample"
              style="background:linear-gradient(135deg,#D97706,#F59E0B);color:#fff;border:none;
                     padding:9px 18px;border-radius:8px;font-weight:700;font-size:13px;
                     cursor:pointer;display:flex;align-items:center;gap:6px">
              🧪 Sample Data
            </button>
            <button onclick="openInspectionEntry()" id="btn-inspection"
              style="background:linear-gradient(135deg,#7C3AED,#9333EA);color:#fff;border:none;
                     padding:9px 18px;border-radius:8px;font-weight:700;font-size:13px;
                     cursor:pointer;display:flex;align-items:center;gap:6px">
              🔍 Inspection
            </button>
            <button onclick="openDSSPreview()" id="btn-dss"
              style="background:linear-gradient(135deg,#0369A1,#0EA5E9);color:#fff;border:none;
                     padding:9px 18px;border-radius:8px;font-weight:700;font-size:13px;
                     cursor:pointer;display:flex;align-items:center;gap:6px">
              📄 DSS
            </button>
          </div>
        </div>

        <div class="card mb-4">
          <div class="card-body">
            <div style="display:grid;grid-template-columns:1fr 1fr 1fr;gap:16px;align-items:end">
              <div>
                <label class="form-label">CRS Shop (நியாயவிலைக்கடை)</label>
                <select id="entry-crs" onchange="onEntryChange()">
                  <option value="">Select CRS Shop...</option>
                </select>
              </div>
              <div>
                <label class="form-label">Entry Date (நாள்)</label>
                <input type="date" id="entry-date" onchange="onEntryChange()"/>
              </div>
              <div id="entry-date-badge" style="display:none;background:var(--bg);border-radius:10px;padding:10px 14px">
                <div style="font-size:10px;color:var(--muted);text-transform:uppercase;letter-spacing:.05em">Selected</div>
                <div id="entry-date-label" style="font-weight:700;color:#0369A1;font-size:13px;margin-top:2px"></div>
              </div>
            </div>
          </div>
        </div>

        <div id="entry-empty" style="text-align:center;padding:64px 24px;color:var(--muted)">
          <div style="font-size:52px;margin-bottom:14px">📋</div>
          <div style="font-weight:700;font-size:16px;color:var(--text);margin-bottom:6px">Select a CRS shop and date to begin</div>
          <div style="font-size:13px">The TNCSC daily sales form will appear automatically</div>
        </div>

        <div id="entry-form-wrap" style="display:none">
          <div id="entry-dup-warn" style="display:none;background:#FEF3C7;border:1px solid #F59E0B;border-radius:10px;padding:12px 16px;margin-bottom:14px;align-items:center;gap:10px">
            <span style="font-size:18px">&#9888;</span>
            <div><div style="font-weight:700;color:#92400E;font-size:13px">Duplicate Entry</div><div style="font-size:12px;color:#92400E">An entry already exists for this shop &amp; date. Saving will overwrite it.</div></div>
          </div>
          <div id="entry-success" style="display:none;background:#DCFCE7;border:1px solid #86EFAC;border-radius:10px;padding:12px 16px;margin-bottom:14px;color:#15803D;font-size:13px;font-weight:600;align-items:center;gap:8px">
            &#10003; Entry saved: <span id="entry-saved-for"></span>
          </div>

          <!-- Header bar -->
          <div style="background:linear-gradient(135deg,#0369A1,#0EA5E9);border-radius:12px 12px 0 0;padding:14px 20px;display:flex;justify-content:space-between;align-items:center">
            <div>
              <div id="ef-title" style="color:#fff;font-weight:800;font-size:15px"></div>
              <div id="ef-sub"   style="color:rgba(255,255,255,.65);font-size:11px;margin-top:2px"></div>
            </div>
            <div style="text-align:right">
              <div style="color:rgba(255,255,255,.6);font-size:10px;text-transform:uppercase;letter-spacing:.08em">Grand Total</div>
              <div id="ef-grand-hdr" style="color:#fff;font-weight:900;font-size:22px">&#8377;0.00</div>
            </div>
          </div>

          <!-- Inspection adjustments notice -->
          <div id="entry-insp-banner" style="display:none;margin:0 0 2px;padding:11px 16px;border:1px solid #FDE047;background:#FFFBEB;border-radius:0;align-items:center;gap:12px;flex-wrap:wrap">
            <span style="font-size:18px">&#128269;</span>
            <div style="flex:1;min-width:220px">
              <div style="font-weight:800;font-size:12px;color:#92400E">Inspection adjustments applied to this date</div>
              <div id="entry-insp-summary" style="font-size:11px;color:#A16207;margin-top:3px"></div>
            </div>
            <div style="font-size:11px;color:#A16207;font-weight:600">Total = Opening + Receipt + Excess &minus; Shortage &minus; Transfer</div>
          </div>

          <!-- SECTION A -->
          <div class="card" style="border-radius:0;border-top:none;border-bottom:none">
            <div style="background:#F0F9FF;padding:9px 16px;border-bottom:1px solid #BAE6FD;display:flex;align-items:center;gap:8px">
              <span style="background:#0369A1;color:#fff;font-size:10px;font-weight:800;padding:2px 8px;border-radius:4px">SECTION A</span>
              <span style="font-weight:700;font-size:12px;color:#0369A1">நியாய வகுப்பு / Main Ration Sales</span>
              <span style="margin-left:auto;font-size:11px;color:#0369A1">19 commodities</span>
            </div>
            <div style="overflow-x:auto">
              <table style="width:100%;border-collapse:collapse;min-width:900px">
                <thead>
                  <tr style="background:#F8FAFC">
                    <th style="padding:9px 8px;text-align:center;font-size:10px;font-weight:700;color:var(--muted);border-bottom:1px solid var(--border);white-space:nowrap">#</th>
                    <th style="padding:9px 12px;text-align:left;font-size:10px;font-weight:700;color:var(--muted);border-bottom:1px solid var(--border)">பொருட்கள் / Commodity</th>
                    <th style="padding:9px 8px;text-align:center;font-size:10px;font-weight:700;color:var(--muted);border-bottom:1px solid var(--border)">Unit</th>
                    <th style="padding:9px 8px;text-align:center;font-size:10px;font-weight:700;color:var(--muted);border-bottom:1px solid var(--border)">Rate<br>(&#8377;)</th>
                    <th style="padding:9px 8px;text-align:center;font-size:10px;font-weight:700;color:var(--muted);border-bottom:1px solid var(--border)">ஆரம்ப இருப்பு<br>Opening</th>
                    <th style="padding:9px 8px;text-align:center;font-size:10px;font-weight:700;color:var(--muted);border-bottom:1px solid var(--border)">வரவு<br>Receipt</th><th data-adjcol="excess" style="padding:9px 6px;text-align:center;font-size:10px;font-weight:700;color:#166534;border-bottom:1px solid var(--border);background:#F0FDF4;white-space:nowrap">கூடுதல்<br>Excess</th><th data-adjcol="shortage" style="padding:9px 6px;text-align:center;font-size:10px;font-weight:700;color:#B91C1C;border-bottom:1px solid var(--border);background:#FEF2F2;white-space:nowrap">போத்தாக்குறை<br>Shortage</th><th data-adjcol="transfer" style="padding:9px 6px;text-align:center;font-size:10px;font-weight:700;color:#92400E;border-bottom:1px solid var(--border);background:#FFFBEB;white-space:nowrap">மாற்றம்<br>Transfer</th>
                    <th style="padding:9px 8px;text-align:center;font-size:10px;font-weight:700;color:#0284C7;border-bottom:1px solid var(--border);background:#EFF6FF">மொத்தம்<br><span style="font-weight:500">Total</span></th>
                    <th style="padding:9px 8px;text-align:center;font-size:10px;font-weight:700;color:var(--muted);border-bottom:1px solid var(--border)">மொத்த விற்பனை<br>Total Sales</th>
                    <th style="padding:9px 8px;text-align:center;font-size:10px;font-weight:700;color:var(--muted);border-bottom:1px solid var(--border)">இறுதி இருப்பு<br>Closing</th>
                    <th style="padding:9px 8px;text-align:center;font-size:10px;font-weight:700;color:var(--muted);border-bottom:1px solid var(--border)">விற்பனை தொகை<br>Amount (&#8377;)</th>
                  </tr>
                </thead>
                <tbody id="et-tbody-a"></tbody>
                <tfoot>
                  <tr style="background:#EFF6FF;font-weight:800">
                    <td id="et-a-foot" colspan="4" style="padding:10px 12px;font-size:12px;color:#0369A1;border-top:2px solid #BAE6FD">Section A Total</td>
                    <td id="et-a-open"  style="padding:10px 6px;text-align:right;font-size:12px;color:#0369A1;border-top:2px solid #BAE6FD">0.000</td>
                    <td id="et-a-rec"   style="padding:10px 6px;text-align:right;font-size:12px;color:#0369A1;border-top:2px solid #BAE6FD">0.000</td>
                    <td id="et-a-ex" data-adjcol="excess"   style="padding:10px 6px;text-align:right;font-size:12px;color:#166534;border-top:2px solid #BAE6FD;background:#F0FDF4">0.000</td>
                    <td id="et-a-sh" data-adjcol="shortage" style="padding:10px 6px;text-align:right;font-size:12px;color:#B91C1C;border-top:2px solid #BAE6FD;background:#FEF2F2">0.000</td>
                    <td id="et-a-tr" data-adjcol="transfer" style="padding:10px 6px;text-align:right;font-size:12px;color:#92400E;border-top:2px solid #BAE6FD;background:#FFFBEB">0.000</td>
                    <td id="et-a-total" style="padding:10px 6px;text-align:right;font-size:12px;color:#0284C7;border-top:2px solid #BAE6FD;background:#EFF6FF">0.000</td>
                    <td id="et-a-sales" style="padding:10px 6px;text-align:right;font-size:12px;color:#0369A1;border-top:2px solid #BAE6FD">0.000</td>
                    <td id="et-a-close" style="padding:10px 6px;text-align:right;font-size:12px;color:#0369A1;border-top:2px solid #BAE6FD">0.000</td>
                    <td id="et-a-amt"   style="padding:10px 6px;text-align:right;font-size:12px;color:#0369A1;border-top:2px solid #BAE6FD">&#8377;0.00</td>
                  </tr>
                </tfoot>
              </table>
            </div>
          </div>

          <!-- SECTION B -->
          <div class="card" style="border-radius:0;border-top:none;border-bottom:none;margin-top:2px">
            <div style="background:#FFF7ED;padding:9px 16px;border-bottom:1px solid #FED7AA;border-top:1px solid #BAE6FD;display:flex;align-items:center;gap:8px">
              <span style="background:#C2410C;color:#fff;font-size:10px;font-weight:800;padding:2px 8px;border-radius:4px">SECTION B</span>
              <span style="font-weight:700;font-size:12px;color:#C2410C">காவலர் அட்டை / Police Ration Card</span>
              <span style="margin-left:auto;font-size:11px;color:#C2410C">5 commodities</span>
            </div>
            <div style="overflow-x:auto">
              <table style="width:100%;border-collapse:collapse;min-width:900px">
                <thead>
                  <tr style="background:#FFFBF5">
                    <th style="padding:9px 8px;text-align:center;font-size:10px;font-weight:700;color:var(--muted);border-bottom:1px solid #FED7AA;white-space:nowrap">#</th>
                    <th style="padding:9px 12px;text-align:left;font-size:10px;font-weight:700;color:var(--muted);border-bottom:1px solid #FED7AA">பொருட்கள் / Commodity</th>
                    <th style="padding:9px 8px;text-align:center;font-size:10px;font-weight:700;color:var(--muted);border-bottom:1px solid #FED7AA">Unit</th>
                    <th style="padding:9px 8px;text-align:center;font-size:10px;font-weight:700;color:var(--muted);border-bottom:1px solid #FED7AA">Rate<br>(&#8377;)</th>
                    <th style="padding:9px 8px;text-align:center;font-size:10px;font-weight:700;color:var(--muted);border-bottom:1px solid #FED7AA">Opening</th>
                    <th style="padding:9px 8px;text-align:center;font-size:10px;font-weight:700;color:var(--muted);border-bottom:1px solid #FED7AA">Receipt</th><th data-adjcol="excess" style="padding:9px 6px;text-align:center;font-size:10px;font-weight:700;color:#166534;border-bottom:1px solid #FED7AA;background:#F0FDF4;white-space:nowrap">கூடுதல்<br>Excess</th><th data-adjcol="shortage" style="padding:9px 6px;text-align:center;font-size:10px;font-weight:700;color:#B91C1C;border-bottom:1px solid #FED7AA;background:#FEF2F2;white-space:nowrap">போத்தாக்குறை<br>Shortage</th><th data-adjcol="transfer" style="padding:9px 6px;text-align:center;font-size:10px;font-weight:700;color:#92400E;border-bottom:1px solid #FED7AA;background:#FFFBEB;white-space:nowrap">மாற்றம்<br>Transfer</th>
                    <th style="padding:9px 8px;text-align:center;font-size:10px;font-weight:700;color:#0284C7;border-bottom:1px solid #FED7AA;background:#EFF6FF">Total</th>
                    <th style="padding:9px 8px;text-align:center;font-size:10px;font-weight:700;color:var(--muted);border-bottom:1px solid #FED7AA">Total Sales</th>
                    <th style="padding:9px 8px;text-align:center;font-size:10px;font-weight:700;color:var(--muted);border-bottom:1px solid #FED7AA">Closing</th>
                    <th style="padding:9px 8px;text-align:center;font-size:10px;font-weight:700;color:var(--muted);border-bottom:1px solid #FED7AA">Amount (&#8377;)</th>
                  </tr>
                </thead>
                <tbody id="et-tbody-b"></tbody>
                <tfoot>
                  <tr style="background:#FFF7ED;font-weight:800">
                    <td id="et-b-foot" colspan="4" style="padding:10px 12px;font-size:12px;color:#C2410C;border-top:2px solid #FED7AA">Section B Total</td>
                    <td id="et-b-open"  style="padding:10px 6px;text-align:right;font-size:12px;color:#C2410C;border-top:2px solid #FED7AA">0.000</td>
                    <td id="et-b-rec"   style="padding:10px 6px;text-align:right;font-size:12px;color:#C2410C;border-top:2px solid #FED7AA">0.000</td>
                    <td id="et-b-ex" data-adjcol="excess"   style="padding:10px 6px;text-align:right;font-size:12px;color:#166534;border-top:2px solid #FED7AA;background:#F0FDF4">0.000</td>
                    <td id="et-b-sh" data-adjcol="shortage" style="padding:10px 6px;text-align:right;font-size:12px;color:#B91C1C;border-top:2px solid #FED7AA;background:#FEF2F2">0.000</td>
                    <td id="et-b-tr" data-adjcol="transfer" style="padding:10px 6px;text-align:right;font-size:12px;color:#92400E;border-top:2px solid #FED7AA;background:#FFFBEB">0.000</td>
                    <td id="et-b-total" style="padding:10px 6px;text-align:right;font-size:12px;color:#0284C7;border-top:2px solid #FED7AA;background:#EFF6FF">0.000</td>
                    <td id="et-b-sales" style="padding:10px 6px;text-align:right;font-size:12px;color:#C2410C;border-top:2px solid #FED7AA">0.000</td>
                    <td id="et-b-close" style="padding:10px 6px;text-align:right;font-size:12px;color:#C2410C;border-top:2px solid #FED7AA">0.000</td>
                    <td id="et-b-amt"   style="padding:10px 6px;text-align:right;font-size:12px;color:#C2410C;border-top:2px solid #FED7AA">&#8377;0.00</td>
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
                  <div id="ef-sum-a" style="font-weight:800;font-size:16px;color:#0369A1">&#8377;0.00</div>
                </div>
                <div style="width:1px;height:32px;background:var(--border)"></div>
                <div style="text-align:center">
                  <div style="font-size:10px;color:var(--muted);text-transform:uppercase;letter-spacing:.05em">Section B</div>
                  <div id="ef-sum-b" style="font-weight:800;font-size:16px;color:#C2410C">&#8377;0.00</div>
                </div>
                <div style="width:1px;height:32px;background:var(--border)"></div>
                <div style="text-align:center">
                  <div style="font-size:10px;color:var(--muted);text-transform:uppercase;letter-spacing:.05em">Grand Total</div>
                  <div id="ef-sum-grand" style="font-weight:900;font-size:18px;color:#16A34A">&#8377;0.00</div>
                </div>
              </div>
              <!-- ── Remittance Details ─────────────────────────────── -->
              <div style="width:100%;border-top:1px solid var(--border);margin:14px 0 10px;padding-top:14px">
                <div style="font-size:10px;font-weight:800;color:var(--muted);text-transform:uppercase;letter-spacing:.06em;margin-bottom:10px">
                  &#127981; Remittance Details
                  <span style="font-weight:400;font-size:9px;color:var(--muted);margin-left:6px">(enter bank deposit amount &amp; date — may differ from sales total)</span>
                </div>
                <div style="display:grid;grid-template-columns:1fr 1fr;gap:14px">
                  <div>
                    <label style="display:block;font-size:11px;font-weight:700;color:var(--text);margin-bottom:5px">
                      Remittance Amount (&#8377;)
                    </label>
                    <div style="position:relative">
                      <span style="position:absolute;left:10px;top:50%;transform:translateY(-50%);font-size:13px;font-weight:700;color:#0369A1">&#8377;</span>
                      <input type="number" id="entry-remit-amount" min="0" step="0.01" placeholder="0.00"
                        style="width:100%;border:2px solid #BAE6FD;border-radius:8px;padding:9px 12px 9px 26px;
                               font-size:14px;font-weight:700;color:#0369A1;background:#F0F9FF;outline:none"
                        onfocus="this.style.borderColor='#0EA5E9'"
                        onblur="this.style.borderColor='#BAE6FD'"
                        oninput="if(this.value<0)this.value=''"/>
                      <div id="entry-remit-diff" style="font-size:10px;margin-top:3px;color:var(--muted)"></div>
                    </div>
                  </div>
                  <div>
                    <label style="display:block;font-size:11px;font-weight:700;color:var(--text);margin-bottom:5px">
                      Remittance Date &#128197;
                    </label>
                    <input type="date" id="entry-remit-date"
                      style="width:100%;border:2px solid #BAE6FD;border-radius:8px;padding:9px 12px;
                             font-size:13px;font-weight:600;color:#0369A1;background:#F0F9FF;outline:none"
                      onfocus="this.style.borderColor='#0EA5E9'"
                      onblur="this.style.borderColor='#BAE6FD'"
                      onchange="entryShowRemitNote()"/>
                    <div id="entry-remit-note" style="font-size:10px;margin-top:3px;color:#7C3AED"></div>
                  </div>
                </div>
              </div>
              <!-- ── Actions ───────────────────────────────────────────────── -->
              <div style="display:flex;align-items:center;gap:10px;flex-wrap:wrap">
                <span id="ef-val-msg" style="display:none;font-size:12px;color:#DC2626">&#9888; Complete required fields</span>
                <span id="entry-salesclose-badge" style="display:none;background:#FEF3C7;border:1px solid #FDE047;color:#92400E;font-size:11px;font-weight:700;padding:5px 10px;border-radius:7px"></span>
                <button class="btn btn-outline btn-sm" onclick="clearEntryForm()">&#128465; Clear</button>
                <button onclick="saveEntryForm()" style="background:linear-gradient(135deg,#0284C7,#0EA5E9);color:#fff;border:none;padding:10px 22px;border-radius:9px;font-weight:700;font-size:13px;cursor:pointer;box-shadow:0 2px 10px rgba(14,165,233,.3)">
                  &#128190; Save Entry
                </button>
                <button id="entry-salesclose-btn" onclick="markSalesClose()" title="Mark this date as the LAST SALES DAY of the month. Totals up to this date auto-fill Monthly Entry & Gunny Receipt." style="background:linear-gradient(135deg,#B45309,#F59E0B);color:#fff;border:none;padding:10px 18px;border-radius:9px;font-weight:700;font-size:13px;cursor:pointer;box-shadow:0 2px 10px rgba(245,158,11,.3)">
                  &#128274; Sales Close
                </button>
              </div>
            </div>
          </div>
        </div>
      </div>



      <!-- ─── MONTHLY ENTRY ────────────────────── -->
`;

export default html;
