// Dashboard
// Verbatim from TNCSC_CRS_Demo_19 (1).html lines 281-514.
const html = `
    <div     <div class="page active" id="page-dashboard">
      <!-- ── HERO HEADER ──────────────────────────────────────────────────── -->
      <div style="background:linear-gradient(135deg,#1B3A6B 0%,#1e4d9b 45%,#1565C0 100%);border-radius:18px;padding:26px 28px 22px;margin-bottom:20px;position:relative;overflow:hidden">
        <!-- Decorative circles -->
        <div style="position:absolute;top:-40px;right:-40px;width:200px;height:200px;border-radius:50%;background:rgba(255,255,255,.05)"></div>
        <div style="position:absolute;bottom:-60px;right:120px;width:160px;height:160px;border-radius:50%;background:rgba(255,255,255,.04)"></div>
        <div style="position:absolute;top:10px;left:50%;width:80px;height:80px;border-radius:50%;background:rgba(255,255,255,.03)"></div>
        <div style="display:flex;justify-content:space-between;align-items:flex-start;flex-wrap:wrap;gap:16px;position:relative;z-index:1">
          <!-- Left: Title + subtitle -->
          <div>
            <div style="display:flex;align-items:center;gap:10px;margin-bottom:6px">
              <div style="background:rgba(255,255,255,.18);border-radius:10px;padding:8px 11px;font-size:22px;line-height:1">📊</div>
              <div>
                <div id="dash-title" style="color:#fff;font-weight:900;font-size:22px;letter-spacing:-.3px">Dashboard</div>
                <div id="dash-sub" style="color:rgba(255,255,255,.7);font-size:12px;margin-top:2px">Loading…</div>
              </div>
            </div>
            <div style="display:flex;align-items:center;gap:8px;margin-top:10px">
              <div id="dash-day-type" onclick="openHolidayCalendar()" style="cursor:pointer;font-size:11px"></div>
            </div>
          </div>
          <!-- Right: Clock + Date picker -->
          <div style="display:flex;flex-direction:column;align-items:flex-end;gap:8px">
            <div style="background:rgba(255,255,255,.14);backdrop-filter:blur(6px);border:1px solid rgba(255,255,255,.22);border-radius:12px;padding:10px 16px;text-align:center;min-width:170px">
              <div style="font-size:9px;color:rgba(255,255,255,.6);text-transform:uppercase;letter-spacing:.1em;margin-bottom:3px">CURRENT TIME</div>
              <div style="display:flex;align-items:baseline;justify-content:center;gap:4px">
                <div id="dash-clock" style="font-weight:900;font-size:22px;color:#fff;font-family:monospace;letter-spacing:.06em">--:--:--</div>
                <div id="dash-ampm" style="font-size:11px;font-weight:800;color:#93C5FD;letter-spacing:.05em">--</div>
              </div>
              <div style="font-size:10px;color:rgba(255,255,255,.5);margin-top:2px" id="dash-today"></div>
            </div>
            <div style="background:rgba(255,255,255,.14);backdrop-filter:blur(6px);border:1px solid rgba(255,255,255,.22);border-radius:12px;padding:8px 14px;display:flex;align-items:center;gap:8px;min-width:170px">
              <span style="font-size:16px">📅</span>
              <div style="flex:1">
                <div style="font-size:9px;color:rgba(255,255,255,.6);text-transform:uppercase;letter-spacing:.09em;margin-bottom:2px">VIEW DATE</div>
                <input type="date" id="dash-date-picker" onchange="onDashDateChange(this.value)"
                  style="border:none;outline:none;font-weight:700;font-size:12px;color:#fff;background:transparent;width:100%;cursor:pointer;font-family:inherit;padding:0;color-scheme:dark"/>
              </div>
            </div>
          </div>
        </div>
      </div>

      <!-- Holiday notice -->
      <div id="dash-holiday-notice" style="display:none;margin-bottom:16px;background:#FFF7ED;border:1px solid #FED7AA;border-radius:12px;padding:12px 18px;align-items:center;gap:10px">
        <span style="font-size:22px">🏪</span>
        <div>
          <div style="font-weight:700;color:#C2410C;font-size:13px" id="dash-holiday-text"></div>
          <div style="font-size:11px;color:#9A3412">1st &amp; 2nd Fridays holiday · 3rd &amp; 4th Sundays holiday</div>
        </div>
      </div>

      <!-- CRS Staff Info (shown for CRS users) -->
      <!-- [+redesign-start] The shop card now carries the whole CRS Master record — shop
           name and code, COLL / police requirement and usage status alongside the staff —
           and every field is filled from CRS_MASTER rather than the demo user list. The
           port's own text for this block is held in REDESIGNED in tools/verify-parity.mjs
           and spliced back before the byte comparison. -->
      <div id="dash-crs-info" style="display:none;margin-bottom:16px">
        <div style="background:linear-gradient(135deg,#0369A1,#0EA5E9);border-radius:14px;padding:18px 22px">
          <div style="display:flex;justify-content:space-between;align-items:center;gap:12px;flex-wrap:wrap;margin-bottom:10px">
            <div style="color:rgba(255,255,255,.6);font-size:10px;font-weight:700;text-transform:uppercase;letter-spacing:.08em">Your Civil Ration Shop</div>
            <div id="dash-crs-flags" style="display:flex;gap:6px;flex-wrap:wrap"></div>
          </div>
          <div style="display:grid;grid-template-columns:auto 1fr 1fr;gap:16px;align-items:center">
            <div style="text-align:center;min-width:150px">
              <div style="color:rgba(255,255,255,.6);font-size:10px">CRS No.</div>
              <div id="dash-crs-num" style="color:#fff;font-weight:900;font-size:28px;line-height:1;margin-top:2px"></div>
              <div id="dash-crs-name" style="color:#fff;font-weight:700;font-size:13px;margin-top:5px"></div>
              <div id="dash-crs-code" style="color:#BAE6FD;font-size:11px;font-family:monospace;margin-top:2px"></div>
            </div>
            <div id="dash-bc-block" style="display:none;background:rgba(255,255,255,.12);border-radius:10px;padding:10px 14px">
              <div style="color:rgba(255,255,255,.6);font-size:10px;text-transform:uppercase;letter-spacing:.05em">Bill Clerk (BC)</div>
              <div id="dash-bc-name" style="color:#fff;font-weight:800;font-size:14px;margin-top:3px"></div>
              <div id="dash-bc-phone" style="color:#67E8F9;font-size:12px;margin-top:2px"></div>
            </div>
            <div id="dash-packer-block" style="display:none;background:rgba(255,255,255,.12);border-radius:10px;padding:10px 14px">
              <div style="color:rgba(255,255,255,.6);font-size:10px;text-transform:uppercase;letter-spacing:.05em">Packer</div>
              <div id="dash-packer-name" style="color:#fff;font-weight:800;font-size:14px;margin-top:3px"></div>
              <div id="dash-packer-phone" style="color:#67E8F9;font-size:12px;margin-top:2px"></div>
            </div>
          </div>
        </div>
      </div>
      <!-- [+redesign-end] -->

      <!-- ── KPI CARDS ─────────────────────────────────────────────────────── -->
      <div style="display:grid;grid-template-columns:repeat(3,1fr);gap:14px;margin-bottom:20px">
        <!-- Entries This Month -->
        <div style="background:#fff;border-radius:16px;padding:20px 22px;border:1px solid #E2E8F0;box-shadow:0 1px 8px rgba(0,0,0,.06);display:flex;align-items:center;gap:16px;transition:.2s"
             onmouseover="this.style.boxShadow='0 4px 20px rgba(0,0,0,.10)'" onmouseout="this.style.boxShadow='0 1px 8px rgba(0,0,0,.06)'">
          <div style="width:56px;height:56px;border-radius:14px;background:linear-gradient(135deg,#D1FAE5,#A7F3D0);display:flex;align-items:center;justify-content:center;font-size:26px;flex-shrink:0">📋</div>
          <div>
            <div id="kpi-entries" style="font-weight:900;font-size:32px;line-height:1;color:#059669">0</div>
            <div style="font-weight:700;font-size:13px;color:#1E293B;margin-top:3px">Entries This Month</div>
            <div style="font-size:11px;color:#94A3B8;margin-top:1px">Working days entered</div>
          </div>
        </div>
        <!-- Days Without Entry -->
        <div style="background:#fff;border-radius:16px;padding:20px 22px;border:1px solid #E2E8F0;box-shadow:0 1px 8px rgba(0,0,0,.06);display:flex;align-items:center;gap:16px;transition:.2s"
             onmouseover="this.style.boxShadow='0 4px 20px rgba(0,0,0,.10)'" onmouseout="this.style.boxShadow='0 1px 8px rgba(0,0,0,.06)'">
          <div style="width:56px;height:56px;border-radius:14px;background:linear-gradient(135deg,#FEE2E2,#FECACA);display:flex;align-items:center;justify-content:center;font-size:26px;flex-shrink:0">📅</div>
          <div>
            <div id="kpi-noentry" style="font-weight:900;font-size:32px;line-height:1;color:#DC2626">0</div>
            <div style="font-weight:700;font-size:13px;color:#1E293B;margin-top:3px">Days Without Entry</div>
            <div style="font-size:11px;color:#94A3B8;margin-top:1px">Working days missed</div>
          </div>
        </div>
        <!-- Receipt Count -->
        <div onclick="navTo('receipt')" style="background:#fff;border-radius:16px;padding:20px 22px;border:1px solid #E2E8F0;box-shadow:0 1px 8px rgba(0,0,0,.06);display:flex;align-items:center;gap:16px;cursor:pointer;transition:.2s"
             onmouseover="this.style.boxShadow='0 4px 20px rgba(0,0,0,.10)';this.style.borderColor='#BAE6FD'" onmouseout="this.style.boxShadow='0 1px 8px rgba(0,0,0,.06)';this.style.borderColor='#E2E8F0'">
          <div style="width:56px;height:56px;border-radius:14px;background:linear-gradient(135deg,#E0F2FE,#BAE6FD);display:flex;align-items:center;justify-content:center;font-size:26px;flex-shrink:0">🧾</div>
          <div>
            <div id="kpi-receipts" style="font-weight:900;font-size:32px;line-height:1;color:#0369A1">0</div>
            <div style="font-weight:700;font-size:13px;color:#1E293B;margin-top:3px">Receipt Dates</div>
            <div id="kpi-receipt-sub" style="font-size:11px;color:#0284C7;font-weight:600;margin-top:1px">Click to view →</div>
          </div>
        </div>
      </div>

      <!-- ── QUICK ACTIONS ─────────────────────────────────────────────────── -->
      <div style="background:#fff;border-radius:16px;border:1px solid #E2E8F0;box-shadow:0 1px 8px rgba(0,0,0,.06);padding:20px 22px;margin-bottom:20px">
        <div style="font-weight:800;font-size:14px;color:#1E293B;margin-bottom:14px;display:flex;align-items:center;gap:8px">
          <span style="width:5px;height:18px;background:linear-gradient(180deg,#1B3A6B,#2563EB);border-radius:3px;display:inline-block"></span>
          Quick Actions
        </div>
        <div style="display:grid;grid-template-columns:repeat(4,1fr);gap:12px">
          <div onclick="navTo('entry')" style="background:linear-gradient(135deg,#EFF6FF,#DBEAFE);border:1px solid #BAE6FD;border-radius:14px;padding:18px 12px;text-align:center;cursor:pointer;transition:.2s"
               onmouseover="this.style.transform='translateY(-2px)';this.style.boxShadow='0 6px 18px rgba(14,165,233,.25)'" onmouseout="this.style.transform='';this.style.boxShadow=''">
            <div style="font-size:28px;margin-bottom:8px">📝</div>
            <div style="font-weight:700;font-size:12px;color:#1D4ED8">Daily Entry</div>
            <div style="font-size:10px;color:#60A5FA;margin-top:3px">Record today's sales</div>
          </div>
          <div onclick="navTo('monthly')" style="background:linear-gradient(135deg,#F0FDF4,#DCFCE7);border:1px solid #86EFAC;border-radius:14px;padding:18px 12px;text-align:center;cursor:pointer;transition:.2s"
               onmouseover="this.style.transform='translateY(-2px)';this.style.boxShadow='0 6px 18px rgba(22,163,74,.25)'" onmouseout="this.style.transform='';this.style.boxShadow=''">
            <div style="font-size:28px;margin-bottom:8px">📅</div>
            <div style="font-weight:700;font-size:12px;color:#15803D">Monthly Entry</div>
            <div style="font-size:10px;color:#4ADE80;margin-top:3px">Monthly totals &amp; remittance</div>
          </div>
          <div onclick="navTo('receipt')" style="background:linear-gradient(135deg,#FFFBEB,#FEF3C7);border:1px solid #FDE68A;border-radius:14px;padding:18px 12px;text-align:center;cursor:pointer;transition:.2s"
               onmouseover="this.style.transform='translateY(-2px)';this.style.boxShadow='0 6px 18px rgba(245,158,11,.25)'" onmouseout="this.style.transform='';this.style.boxShadow=''">
            <div style="font-size:28px;margin-bottom:8px">🧾</div>
            <div style="font-weight:700;font-size:12px;color:#B45309">Receipt</div>
            <div style="font-size:10px;color:#FCD34D;margin-top:3px">Godown receipts</div>
          </div>
          <div onclick="navTo('statement')" style="background:linear-gradient(135deg,#FDF4FF,#FAE8FF);border:1px solid #E879F9;border-radius:14px;padding:18px 12px;text-align:center;cursor:pointer;transition:.2s"
               onmouseover="this.style.transform='translateY(-2px)';this.style.boxShadow='0 6px 18px rgba(168,85,247,.25)'" onmouseout="this.style.transform='';this.style.boxShadow=''">
            <div style="font-size:28px;margin-bottom:8px">📄</div>
            <div style="font-weight:700;font-size:12px;color:#7E22CE">Statement</div>
            <div style="font-size:10px;color:#C084FC;margin-top:3px">Generate reports</div>
          </div>
        </div>

        <!-- Admin-only extra actions (second row) -->
        <div id="dash-admin-actions" style="display:none;grid-template-columns:repeat(4,1fr);gap:12px;margin-top:12px">
          <div onclick="navTo('crs')" style="background:linear-gradient(135deg,#F8FAFC,#F1F5F9);border:1px solid #CBD5E1;border-radius:14px;padding:14px 12px;text-align:center;cursor:pointer;transition:.2s"
               onmouseover="this.style.transform='translateY(-2px)';this.style.boxShadow='0 4px 14px rgba(0,0,0,.12)'" onmouseout="this.style.transform='';this.style.boxShadow=''">
            <div style="font-size:22px;margin-bottom:6px">🏪</div>
            <div style="font-weight:700;font-size:11px;color:#475569">CRS Shops</div>
          </div>
          <div onclick="navTo('commodity')" style="background:linear-gradient(135deg,#F8FAFC,#F1F5F9);border:1px solid #CBD5E1;border-radius:14px;padding:14px 12px;text-align:center;cursor:pointer;transition:.2s"
               onmouseover="this.style.transform='translateY(-2px)';this.style.boxShadow='0 4px 14px rgba(0,0,0,.12)'" onmouseout="this.style.transform='';this.style.boxShadow=''">
            <div style="font-size:22px;margin-bottom:6px">🧺</div>
            <div style="font-weight:700;font-size:11px;color:#475569">Commodities</div>
          </div>
          <div onclick="navTo('users')" style="background:linear-gradient(135deg,#F8FAFC,#F1F5F9);border:1px solid #CBD5E1;border-radius:14px;padding:14px 12px;text-align:center;cursor:pointer;transition:.2s"
               onmouseover="this.style.transform='translateY(-2px)';this.style.boxShadow='0 4px 14px rgba(0,0,0,.12)'" onmouseout="this.style.transform='';this.style.boxShadow=''">
            <div style="font-size:22px;margin-bottom:6px">👥</div>
            <div style="font-weight:700;font-size:11px;color:#475569">Users</div>
          </div>
          <div onclick="navTo('reports')" style="background:linear-gradient(135deg,#F8FAFC,#F1F5F9);border:1px solid #CBD5E1;border-radius:14px;padding:14px 12px;text-align:center;cursor:pointer;transition:.2s"
               onmouseover="this.style.transform='translateY(-2px)';this.style.boxShadow='0 4px 14px rgba(0,0,0,.12)'" onmouseout="this.style.transform='';this.style.boxShadow=''">
            <div style="font-size:22px;margin-bottom:6px">📈</div>
            <div style="font-weight:700;font-size:11px;color:#475569">Reports</div>
          </div>
        </div>
      </div>

      <!-- ── MAIN CONTENT GRID ──────────────────────────────────────────────── -->
      <div style="display:grid;grid-template-columns:2fr 1fr;gap:16px;margin-bottom:16px">
        <!-- Monthly Sales Chart -->
        <div style="background:#fff;border-radius:16px;border:1px solid #E2E8F0;box-shadow:0 1px 8px rgba(0,0,0,.06);overflow:hidden">
          <div style="padding:16px 20px 12px;display:flex;justify-content:space-between;align-items:flex-start;border-bottom:1px solid #F1F5F9">
            <div>
              <div style="font-weight:800;font-size:14px;color:#1E293B;display:flex;align-items:center;gap:8px">
                <span style="width:5px;height:18px;background:linear-gradient(180deg,#0EA5E9,#38BDF8);border-radius:3px;display:inline-block"></span>
                Current Month Sales — Quantity
              </div>
              <div id="dash-month-label" style="font-size:11px;color:#94A3B8;margin-top:3px"></div>
            </div>
            <div style="text-align:right">
              <div style="font-size:10px;color:#94A3B8;text-transform:uppercase;letter-spacing:.05em" id="dash-sale-date-lbl">Today</div>
              <div id="dash-sale-total" style="font-weight:900;font-size:20px;color:#16A34A;line-height:1.1">₹0.00</div>
              <div id="dash-sale-qty" style="font-size:11px;color:#94A3B8">0 kg total</div>
            </div>
          </div>
          <div style="padding:14px 18px 6px">
            <div style="overflow-x:auto">
              <div style="display:flex;align-items:flex-end;gap:3px;height:100px;min-width:560px" id="dash-day-bars"></div>
              <div style="display:flex;gap:3px;min-width:560px;margin-top:3px" id="dash-day-labels"></div>
            </div>
            <div style="display:flex;gap:14px;margin-top:10px;font-size:11px;color:#94A3B8">
              <span style="display:flex;align-items:center;gap:4px"><span style="width:11px;height:11px;border-radius:3px;background:#0EA5E9;display:inline-block"></span>Entry done</span>
              <span style="display:flex;align-items:center;gap:4px"><span style="width:11px;height:11px;border-radius:3px;background:#FEE2E2;border:1px dashed #FCA5A5;display:inline-block"></span>No entry</span>
              <span style="display:flex;align-items:center;gap:4px"><span style="width:11px;height:11px;border-radius:3px;background:#F1F5F9;border:1px dashed #CBD5E1;display:inline-block"></span>Holiday</span>
            </div>
          </div>
          <!-- Breakdown -->
          <div style="border-top:1px solid #F1F5F9;padding:12px 18px">
            <div style="font-size:10px;font-weight:700;color:#94A3B8;text-transform:uppercase;letter-spacing:.05em;margin-bottom:8px" id="dash-breakdown-label">Selected Date Breakdown</div>
            <div id="dash-commodity-breakdown" style="max-height:200px;overflow-y:auto">
              <div style="color:#94A3B8;font-size:12px;text-align:center;padding:14px">Select a date with entry data to see breakdown</div>
            </div>
          </div>
        </div>

        <!-- Closing Stock -->
        <div style="background:#fff;border-radius:16px;border:1px solid #E2E8F0;box-shadow:0 1px 8px rgba(0,0,0,.06);overflow:hidden">
          <div style="padding:16px 20px 12px;display:flex;justify-content:space-between;align-items:center;border-bottom:1px solid #F1F5F9">
            <div style="font-weight:800;font-size:14px;color:#1E293B;display:flex;align-items:center;gap:8px">
              <span style="width:5px;height:18px;background:linear-gradient(180deg,#F59E0B,#FBBF24);border-radius:3px;display:inline-block"></span>
              Closing Stock
            </div>
            <span style="font-size:20px">📦</span>
          </div>
          <div style="font-size:10px;color:#94A3B8;padding:8px 18px 0;font-style:italic" id="dash-closing-date-label"></div>
          <div id="dash-closing-list" style="padding:10px 18px 16px;max-height:460px;overflow-y:auto">
            <div style="color:#94A3B8;font-size:12px;text-align:center;padding:24px">No entry data yet</div>
          </div>
        </div>
      </div>

      <!-- ── RECENT ACTIVITY ───────────────────────────────────────────────── -->
      <div style="background:#fff;border-radius:16px;border:1px solid #E2E8F0;box-shadow:0 1px 8px rgba(0,0,0,.06);overflow:hidden">
        <div style="padding:16px 20px;border-bottom:1px solid #F1F5F9;display:flex;justify-content:space-between;align-items:center">
          <div style="font-weight:800;font-size:14px;color:#1E293B;display:flex;align-items:center;gap:8px">
            <span style="width:5px;height:18px;background:linear-gradient(180deg,#8B5CF6,#A78BFA);border-radius:3px;display:inline-block"></span>
            Recent Activity
          </div>
          <span style="font-size:20px">🕐</span>
        </div>
        <div style="padding:12px 18px" id="dash-activity-list">
          <div class="activity-item"><div class="activity-dot"></div><div><div class="activity-text"><strong>admin</strong> — BULK_ENTRY · DAILY_SALES</div><div class="activity-time">Today, 10:42 AM</div></div></div>
          <div class="activity-item"><div class="activity-dot"></div><div><div class="activity-text"><strong>crs_user_9</strong> — Daily entry saved</div><div class="activity-time">Today, 09:15 AM</div></div></div>
        </div>
      </div>
    </div>

`;

export default html;
