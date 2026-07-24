// Audit Logs
// Verbatim from TNCSC_CRS_Demo_19 (1).html lines 1505-1531.
const html = `
    <!-- ─── AUDIT ──────────────────────────── -->
    <div class="page" id="page-audit">
      <div class="page-header"><div class="page-title">Audit Logs</div><div class="page-sub">Complete history of all user actions</div></div>
      <div class="card mb-4">
        <div class="card-body flex gap-3">
          <span style="font-size:18px;color:var(--muted)">🔍</span>
          <select style="width:160px;font-size:12px;padding:6px 10px"><option>All Modules</option><option>AUTH</option><option>CRS</option><option>DAILY_SALES</option><option>STATEMENT</option></select>
          <select style="width:160px;font-size:12px;padding:6px 10px"><option>All Actions</option><option>LOGIN</option><option>CREATE</option><option>UPDATE</option><option>GENERATE</option><option>BULK_ENTRY</option></select>
          <span class="text-muted text-sm" style="margin-left:auto;align-self:center">247 records</span>
        </div>
      </div>
      <div class="card">
        <div class="table-wrap">
          <table>
            <thead><tr><th>Timestamp</th><th>User</th><th>Action</th><th>Module</th><th>IP Address</th></tr></thead>
            <tbody>
              <tr><td class="text-sm text-muted">12 Jul 2026, 10:42:31</td><td><strong>System Admin</strong><br><span class="text-muted text-sm">@admin</span></td><td><span class="badge badge-blue">BULK_ENTRY</span></td><td><span class="tag">DAILY_SALES</span></td><td class="text-sm text-muted font-mono">192.168.1.10</td></tr>
              <tr><td class="text-sm text-muted">12 Jul 2026, 10:30:15</td><td><strong>System Admin</strong><br><span class="text-muted text-sm">@admin</span></td><td><span class="badge badge-purple">GENERATE</span></td><td><span class="tag">STATEMENT</span></td><td class="text-sm text-muted font-mono">192.168.1.10</td></tr>
              <tr><td class="text-sm text-muted">12 Jul 2026, 09:45:02</td><td><strong>Alagarsami</strong><br><span class="text-muted text-sm">@crs_user_9</span></td><td><span class="badge badge-green">LOGIN</span></td><td><span class="tag">AUTH</span></td><td class="text-sm text-muted font-mono">192.168.1.22</td></tr>
              <tr><td class="text-sm text-muted">11 Jul 2026, 08:30:44</td><td><strong>Area Supervisor</strong><br><span class="text-muted text-sm">@supervisor1</span></td><td><span class="badge badge-green">LOGIN</span></td><td><span class="tag">AUTH</span></td><td class="text-sm text-muted font-mono">192.168.1.5</td></tr>
              <tr><td class="text-sm text-muted">11 Jul 2026, 03:15:30</td><td><strong>Supervisor1</strong><br><span class="text-muted text-sm">@supervisor1</span></td><td><span class="badge badge-amber">UPDATE</span></td><td><span class="tag">CRS</span></td><td class="text-sm text-muted font-mono">192.168.1.5</td></tr>
            </tbody>
          </table>
        </div>
      </div>
    </div>

`;

export default html;
