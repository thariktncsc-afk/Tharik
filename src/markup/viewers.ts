// Inspection & DSS full-screen viewers
// Verbatim from TNCSC_CRS_Demo_19 (1).html lines 10075-10122.
const html = `



<!-- ─── INSPECTION / DSS FULL-SCREEN VIEWER ─── -->
<div id="fullscreen-viewer" style="display:none;position:fixed;inset:0;z-index:9000;background:#fff;overflow-y:auto;flex-direction:column">
  <div id="fsv-toolbar" style="position:sticky;top:0;background:#1E40AF;color:#fff;padding:10px 16px;display:flex;justify-content:space-between;align-items:center;z-index:9001;flex-shrink:0;gap:10px">
    <div>
      <div id="fsv-title" style="font-weight:800;font-size:14px"></div>
      <div id="fsv-sub"   style="font-size:11px;opacity:.75;margin-top:1px"></div>
    </div>
    <div style="display:flex;gap:8px;flex-shrink:0">
      <button onclick="fsvPrint()" style="background:#fff;color:#1E40AF;border:none;padding:7px 16px;border-radius:6px;cursor:pointer;font-weight:700;font-size:12px">🖨️ Print</button>
      <button onclick="closeFSV()" style="background:rgba(255,255,255,.15);color:#fff;border:1px solid rgba(255,255,255,.3);padding:7px 14px;border-radius:6px;cursor:pointer;font-size:12px;font-weight:600">✕ Close</button>
    </div>
  </div>
  <div id="fsv-content" style="padding:20px;flex:1"></div>
</div>


<!-- ─── INSPECTION / DSS FULL-SCREEN VIEWER ─── -->
<div id="fullscreen-viewer" style="display:none;position:fixed;inset:0;z-index:9000;background:#fff;overflow-y:auto;flex-direction:column">
  <div id="fsv-toolbar" style="position:sticky;top:0;background:#1E40AF;color:#fff;padding:10px 16px;display:flex;justify-content:space-between;align-items:center;z-index:9001;flex-shrink:0;gap:10px">
    <div>
      <div id="fsv-title" style="font-weight:800;font-size:14px"></div>
      <div id="fsv-sub"   style="font-size:11px;opacity:.75;margin-top:1px"></div>
    </div>
    <div style="display:flex;gap:8px;flex-shrink:0">
      <button onclick="fsvPrint()" style="background:#fff;color:#1E40AF;border:none;padding:7px 16px;border-radius:6px;cursor:pointer;font-weight:700;font-size:12px">🖨️ Print</button>
      <button onclick="closeFSV()" style="background:rgba(255,255,255,.15);color:#fff;border:1px solid rgba(255,255,255,.3);padding:7px 14px;border-radius:6px;cursor:pointer;font-size:12px;font-weight:600">✕ Close</button>
    </div>
  </div>
  <div id="fsv-content" style="padding:20px;flex:1"></div>
</div>

<!-- ─── INSPECTION / DSS FULL-SCREEN VIEWER ─── -->
<div id="fullscreen-viewer" style="display:none;position:fixed;inset:0;z-index:9000;background:#fff;overflow-y:auto;flex-direction:column">
  <div id="fsv-toolbar" style="position:sticky;top:0;background:#1E40AF;color:#fff;padding:10px 16px;display:flex;justify-content:space-between;align-items:center;z-index:9001;flex-shrink:0;gap:10px">
    <div>
      <div id="fsv-title" style="font-weight:800;font-size:14px"></div>
      <div id="fsv-sub"   style="font-size:11px;opacity:.75;margin-top:1px"></div>
    </div>
    <div style="display:flex;gap:8px;flex-shrink:0">
      <button onclick="fsvPrint()" style="background:#fff;color:#1E40AF;border:none;padding:7px 16px;border-radius:6px;cursor:pointer;font-weight:700;font-size:12px">🖨️ Print</button>
      <button onclick="closeFSV()" style="background:rgba(255,255,255,.15);color:#fff;border:1px solid rgba(255,255,255,.3);padding:7px 14px;border-radius:6px;cursor:pointer;font-size:12px;font-weight:600">✕ Close</button>
    </div>
  </div>
  <div id="fsv-content" style="padding:20px;flex:1"></div>
</div>
`;

export default html;
