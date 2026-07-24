// User Management
// Verbatim from TNCSC_CRS_Demo_19 (1).html lines 1408-1446.
const html = `
    <!-- ─── USERS ──────────────────────────── -->
      <div class="page" id="page-users">
        <div class="page-header" style="display:flex;justify-content:space-between;align-items:flex-start">
          <div>
            <div class="page-title">User Management</div>
            <div class="page-sub" id="users-count-sub">Loading...</div>
          </div>
          <button onclick="muOpenAdd()" style="background:linear-gradient(135deg,#0284C7,#0EA5E9);color:#fff;border:none;padding:9px 18px;border-radius:8px;font-weight:700;font-size:13px;cursor:pointer;box-shadow:0 2px 10px rgba(14,165,233,.3)">
            + Add User
          </button>
        </div>

        <!-- Success / Error banners -->
        <div id="users-success" style="display:none;background:#DCFCE7;border:1px solid #86EFAC;border-radius:10px;padding:11px 16px;color:#15803D;font-size:13px;font-weight:600;margin-bottom:14px"></div>

        <!-- Filters -->
        <div class="card" style="margin-bottom:14px">
          <div style="padding:12px 16px;display:flex;gap:12px;align-items:center;flex-wrap:wrap">
            <input type="text" id="users-search" placeholder="Search by name, CRS..." oninput="renderUsersTable()"
              style="flex:1;min-width:180px;border:1px solid var(--border);border-radius:8px;padding:8px 12px;font-size:13px;outline:none"/>
            <select id="users-filter-crs" onchange="renderUsersTable()"
              style="border:1px solid var(--border);border-radius:8px;padding:8px 12px;font-size:13px;outline:none">
              <option value="">All CRS Shops</option>
            </select>
            <select id="users-filter-role" onchange="renderUsersTable()"
              style="border:1px solid var(--border);border-radius:8px;padding:8px 12px;font-size:13px;outline:none">
              <option value="">All Roles</option>
              <option value="BC">Bill Clerk (BC)</option>
              <option value="Packer">Packer</option>
            </select>
          </div>
        </div>

        <!-- CRS-grouped user table -->
        <div id="users-table-wrap">
          <div style="text-align:center;padding:40px;color:var(--muted)">Loading users...</div>
        </div>
      </div>

`;

export default html;
