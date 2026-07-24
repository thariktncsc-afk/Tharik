// Commodity Master
// Verbatim from TNCSC_CRS_Demo_19 (1).html lines 592-615.
const html = `
    <!-- ─── COMMODITY ──────────────────────── -->
    <div class="page" id="page-commodity">
      <div class="page-header flex justify-between items-center">
        <div><div class="page-title">Commodity Master</div><div class="page-sub">Manage commodity list and statement column order</div></div>
        <button class="btn btn-primary" onclick="openModal('modal-comm')">+ Add Commodity</button>
      </div>
      <div class="card">
        <div class="table-wrap">
          <table>
            <thead><tr><th>Order</th><th>Code</th><th>Name (EN)</th><th>Name (Tamil)</th><th>Unit</th><th>Category</th><th>Status</th><th>Actions</th></tr></thead>
            <tbody>
              <tr><td style="text-align:center;font-family:monospace">1</td><td><span style="font-family:monospace;font-weight:700;color:var(--navy)">RICE</span></td><td>Rice</td><td>அரிசி</td><td><span class="badge badge-blue">KG</span></td><td>RICE</td><td><span class="badge badge-green">Active</span></td><td><button class="btn btn-outline btn-sm">Edit</button></td></tr>
              <tr><td style="text-align:center;font-family:monospace">2</td><td><span style="font-family:monospace;font-weight:700;color:var(--navy)">WHEAT</span></td><td>Wheat</td><td>கோதுமை</td><td><span class="badge badge-blue">KG</span></td><td>WHEAT</td><td><span class="badge badge-green">Active</span></td><td><button class="btn btn-outline btn-sm">Edit</button></td></tr>
              <tr><td style="text-align:center;font-family:monospace">3</td><td><span style="font-family:monospace;font-weight:700;color:var(--navy)">SUGAR</span></td><td>Sugar</td><td>சர்க்கரை</td><td><span class="badge badge-blue">KG</span></td><td>SUGAR</td><td><span class="badge badge-green">Active</span></td><td><button class="btn btn-outline btn-sm">Edit</button></td></tr>
              <tr><td style="text-align:center;font-family:monospace">4</td><td><span style="font-family:monospace;font-weight:700;color:var(--navy)">TOOR</span></td><td>Toor Dal</td><td>துவரம் பருப்பு</td><td><span class="badge badge-blue">KG</span></td><td>PULSES</td><td><span class="badge badge-green">Active</span></td><td><button class="btn btn-outline btn-sm">Edit</button></td></tr>
              <tr><td style="text-align:center;font-family:monospace">5</td><td><span style="font-family:monospace;font-weight:700;color:var(--navy)">PALM</span></td><td>Palm Oil</td><td>பாமாயில்</td><td><span class="badge badge-blue">LTR</span></td><td>OIL</td><td><span class="badge badge-green">Active</span></td><td><button class="btn btn-outline btn-sm">Edit</button></td></tr>
              <tr><td style="text-align:center;font-family:monospace">6</td><td><span style="font-family:monospace;font-weight:700;color:var(--navy)">KERO</span></td><td>Kerosene</td><td>மண்ணெண்ணெய்</td><td><span class="badge badge-blue">LTR</span></td><td>KEROSENE</td><td><span class="badge badge-green">Active</span></td><td><button class="btn btn-outline btn-sm">Edit</button></td></tr>
              <tr><td style="text-align:center;font-family:monospace">7</td><td><span style="font-family:monospace;font-weight:700;color:var(--navy)">SALT</span></td><td>Salt</td><td>உப்பு</td><td><span class="badge badge-blue">KG</span></td><td>OTHER</td><td><span class="badge badge-green">Active</span></td><td><button class="btn btn-outline btn-sm">Edit</button></td></tr>
            </tbody>
          </table>
        </div>
      </div>
    </div>

`;

export default html;
