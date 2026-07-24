// CRS Shops
// Verbatim from TNCSC_CRS_Demo_19 (1).html lines 571-591.
const html = `
<div class="page" id="page-crs">
      <div class="page-header flex justify-between items-center">
        <div><div class="page-title">CRS Shops</div><div class="page-sub">30 shops registered in Madurai Region</div></div>
        <button class="btn btn-primary" onclick="openModal('modal-crs')">+ Add CRS Shop</button>
      </div>
      <div class="card">
        <div class="card-header">
          <div class="search-box" style="width:280px"><span class="search-icon">🔍</span><input class="search-input" type="text" placeholder="Search by code or name…" oninput="filterTable(this,'crs-table')"/></div>
          <div class="flex gap-2">
            <select style="width:auto;font-size:12px;padding:6px 10px"><option>All Status</option><option>Active</option><option>Inactive</option></select>
          </div>
        </div>
        <div class="table-wrap">
          <table id="crs-table">
            <thead><tr><th>Code</th><th>Shop Name</th><th>District</th><th>Taluk</th><th>Card Holders</th><th>Status</th><th>Actions</th></tr></thead>
            <tbody id="crs-tbody"></tbody>
          </table>
        </div>
      </div>
    </div>

`;

export default html;
