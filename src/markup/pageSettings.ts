// Application Settings
// Verbatim from TNCSC_CRS_Demo_19 (1).html lines 1447-1504.
const html = `
<!-- ─── SETTINGS ───────────────────────── -->
    <div class="page" id="page-settings">
      <div class="page-header"><div class="page-title">Application Settings</div><div class="page-sub">Configure system-wide settings</div></div>
      <div class="card">
        <div id="settings-saved" class="success-banner" style="display:none;margin:16px 16px 0">✅ Settings saved successfully.</div>
        <div style="padding:0 20px">
          <div class="stat-row"><div><div style="font-weight:600">Application Name</div><div class="text-sm text-muted font-mono">app_name</div></div><div style="width:300px"><input value="TNCSC CRS Statement Management System"/></div></div>
          <div class="stat-row"><div><div style="font-weight:600">Organisation Name</div><div class="text-sm text-muted font-mono">org_name</div></div><div style="width:300px"><input value="Tamil Nadu Civil Supplies Corporation"/></div></div>
          <div class="stat-row"><div><div style="font-weight:600">Financial Year Start Month</div><div class="text-sm text-muted font-mono">financial_year_start_month</div></div><div style="width:300px"><input value="4" type="number" min="1" max="12"/></div></div>
          <div class="stat-row"><div><div style="font-weight:600">Max Login Attempts</div><div class="text-sm text-muted font-mono">max_login_attempts</div></div><div style="width:300px"><input value="3" type="number"/></div></div>
          <div class="stat-row"><div><div style="font-weight:600">Account Lock Duration (Minutes)</div><div class="text-sm text-muted font-mono">account_lock_minutes</div></div><div style="width:300px"><input value="30" type="number"/></div></div>
          <!-- [M3] cereal account number, was hardcoded in the DSS render code -->
          <div class="stat-row"><div><div style="font-weight:600">Cereal Account Number</div><div class="text-sm text-muted font-mono">cereal_account_no</div></div><div style="width:300px"><input id="cfg-cereal-acct" value="10828605763" oninput="APP_CONFIG.cerealAccountNo=this.value.trim()"/></div></div>
        </div>
        <div style="padding:14px 20px;border-top:1px solid var(--border);display:flex;justify-content:flex-end">
          <button class="btn btn-primary" onclick="saveSettings()">💾 Save Settings</button>
        </div>
      </div>

      <!-- ─── [S4] BACKUP & RESTORE ─────────────────────────────────────── -->
      <div class="card">
        <div class="card-body">
          <div style="font-weight:700;font-size:15px;margin-bottom:4px">Backup &amp; Restore</div>
          <div class="text-sm text-muted" style="margin-bottom:14px">
            All data lives in memory only — closing or reloading this page loses it.
            Export a backup at the end of every session and keep the file safe.
          </div>

          <div style="display:flex;gap:10px;flex-wrap:wrap;align-items:center">
            <button class="btn btn-primary" onclick="exportBackup()">⬇ Export Backup (.json)</button>
            <button class="btn" style="background:#F1F5F9;color:#334155;border:1px solid #CBD5E1"
                    onclick="document.getElementById('backup-file').click()">⬆ Restore from File</button>
            <input type="file" id="backup-file" accept="application/json,.json"
                   style="display:none" onchange="importBackupFile(this)"/>
            <button class="btn" style="background:#F1F5F9;color:#334155;border:1px solid #CBD5E1"
                    onclick="var w=document.getElementById('backup-raw-wrap');w.style.display=w.style.display==='none'?'block':'none'">
              ⌨ Paste / Copy JSON
            </button>
          </div>

          <div id="backup-status" style="display:none;margin-top:12px;padding:9px 13px;border-radius:8px;font-size:12.5px;font-weight:600"></div>

          <div id="backup-raw-wrap" style="display:none;margin-top:12px">
            <div class="text-sm text-muted" style="margin-bottom:6px">
              Use this when file download or upload is blocked (for example inside a preview frame).
            </div>
            <textarea id="backup-raw" spellcheck="false"
                      style="width:100%;height:150px;font-family:ui-monospace,Menlo,Consolas,monospace;font-size:11px;border:1px solid var(--border);border-radius:8px;padding:9px"
                      placeholder="Paste backup JSON here to restore, or press Export to fill this box."></textarea>
            <div style="display:flex;gap:10px;margin-top:8px">
              <button class="btn" style="background:#F1F5F9;color:#334155;border:1px solid #CBD5E1" onclick="backupCopyRaw()">📋 Copy</button>
              <button class="btn btn-primary" onclick="importBackupText()">Restore from pasted text</button>
            </div>
          </div>
        </div>
      </div>
    </div>

`;

export default html;
