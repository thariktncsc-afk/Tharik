// CRS Shops
// Verbatim from TNCSC_CRS_Demo_19 (1).html lines 571-591.
const html = `
<!-- [+redesign-start] CRS Master Configuration, redesigned after the port: the demo
     district/taluk/card columns are replaced by the master the office works from
     (shop code, BC and packer with mobiles, COLL, police, usage status). The port's own
     text for this block is held in REDESIGNED in tools/verify-parity.mjs and spliced
     back before the byte comparison. -->
<div class="page" id="page-crs">
      <div class="page-header flex justify-between items-center">
        <div><div class="page-title">CRS Master Configuration</div><div class="page-sub">30 shops in Madurai Region — codes, staff, COLL / police requirement and usage status</div></div>
        <button class="btn btn-primary" onclick="openModal('modal-crs')">+ Add CRS Shop</button>
      </div>
      <div class="card">
        <div class="card-header">
          <div class="search-box" style="width:280px"><span class="search-icon">🔍</span><input class="search-input" type="text" placeholder="Search by code, shop or staff…" oninput="filterTable(this,'crs-table')"/></div>
          <div class="flex gap-2">
            <select id="crs-master-filter" onchange="buildCrsTable()" style="width:auto;font-size:12px;padding:6px 10px">
              <option value="all">All Status</option>
              <option value="active">Active</option>
              <option value="no_usage">No Usage</option>
            </select>
          </div>
        </div>
        <div id="crs-master-summary" style="padding:8px 20px 0;font-size:11px;color:var(--muted)"></div>
        <div class="table-wrap">
          <table id="crs-table" style="min-width:1120px">
            <thead><tr><th>Shop Code</th><th>CRS Name</th><th>BC Name</th><th>BC Mobile</th><th>Packer Name</th><th>Packer Mobile</th><th style="text-align:center">COLL</th><th style="text-align:center">Police</th><th style="text-align:center">Usage</th><th style="text-align:center">Actions</th></tr></thead>
            <tbody id="crs-tbody"></tbody>
          </table>
        </div>
      </div>
    </div>
    <!-- [+redesign-end] -->

`;

export default html;
