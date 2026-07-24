// Left navigation rail
// Verbatim from TNCSC_CRS_Demo_19 (1).html lines 234-266.
const html = `
<!-- ─── APP SHELL ──────────────────────────────────── -->
<div id="sidebar">
  <div class="sb-logo flex items-center">
    <div class="sb-logo-badge">TN</div>
    <div class="sb-logo-text">
      <p>TNCSC</p>
      <p>CRS Management</p>
    </div>
  </div>
  <nav class="sb-nav">
    <div class="sb-section">Menu</div>
    <div class="nav-item active" onclick="showPage('dashboard',this)"><span class="nav-icon">📊</span> Dashboard</div>
    <div class="nav-item" onclick="showPage('entry',this)"><span class="nav-icon">📋</span> Daily Entry</div>
    <div class="nav-item" onclick="showPage('monthly',this)"><span class="nav-icon">📅</span> Monthly Entry</div>
    <div class="nav-item" onclick="showPage('receipt',this)"><span class="nav-icon">&#129534;</span> Receipt</div>
    <div class="nav-item" onclick="showPage('crs',this)"><span class="nav-icon">🏪</span> CRS Shops</div>
    <div class="nav-item" onclick="showPage('commodity',this)"><span class="nav-icon">📦</span> Commodities</div>
    <div class="nav-item" onclick="showPage('statement',this)"><span class="nav-icon">📄</span> Statements</div>
    <div class="nav-item" onclick="showPage('reports',this)"><span class="nav-icon">📈</span> Reports</div>
    <div class="sb-section">Admin</div>
    <div class="nav-item" onclick="showPage('users',this)"><span class="nav-icon">👥</span> Users</div>
    <div class="nav-item" onclick="showPage('settings',this)"><span class="nav-icon">⚙️</span> Settings</div>
    <div class="nav-item" onclick="showPage('audit',this)"><span class="nav-icon">📜</span> Audit Logs</div>
  </nav>
  <div class="sb-user">
    <div class="flex items-center gap-2">
      <div class="sb-avatar">A</div>
      <div><div class="sb-uname">System Administrator</div><div class="sb-urole">ADMIN</div></div>
    </div>
    <button class="sb-logout" onclick="doLogout()">⬡ Sign out</button>
  </div>
</div>

`;

export default html;
