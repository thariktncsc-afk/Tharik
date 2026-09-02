/**
 * Audit Logs — React port of src/markup/pageAudit.ts.
 * The legacy screen shows reference rows (no live audit trail exists yet in
 * the engine either); ported as-is so the design carries over. A real audit
 * feed becomes possible once server-side logging lands.
 */
const ROWS = [
  { ts: '12 Jul 2026, 10:42:31', user: 'System Admin', handle: '@admin', action: 'BULK_ENTRY', badge: 'badge-blue', module: 'DAILY_SALES', ip: '192.168.1.10' },
  { ts: '12 Jul 2026, 10:30:15', user: 'System Admin', handle: '@admin', action: 'GENERATE', badge: 'badge-purple', module: 'STATEMENT', ip: '192.168.1.10' },
  { ts: '12 Jul 2026, 09:45:02', user: 'Alagarsami', handle: '@crs_user_9', action: 'LOGIN', badge: 'badge-green', module: 'AUTH', ip: '192.168.1.22' },
  { ts: '11 Jul 2026, 08:30:44', user: 'Area Supervisor', handle: '@supervisor1', action: 'LOGIN', badge: 'badge-green', module: 'AUTH', ip: '192.168.1.5' },
  { ts: '11 Jul 2026, 03:15:30', user: 'Supervisor1', handle: '@supervisor1', action: 'UPDATE', badge: 'badge-amber', module: 'CRS', ip: '192.168.1.5' },
];

export default function AuditPage() {
  return (
    <div className="page active" id="page-audit">
      <div className="page-header">
        <div className="page-title">Audit Logs</div>
        <div className="page-sub">Complete history of all user actions</div>
      </div>
      <div className="card mb-4">
        <div className="card-body flex gap-3">
          <span style={{ fontSize: 18, color: 'var(--muted)' }}>🔍</span>
          <select style={{ width: 160, fontSize: 12, padding: '6px 10px' }} defaultValue="All Modules">
            <option>All Modules</option>
            <option>AUTH</option>
            <option>CRS</option>
            <option>DAILY_SALES</option>
            <option>STATEMENT</option>
          </select>
          <select style={{ width: 160, fontSize: 12, padding: '6px 10px' }} defaultValue="All Actions">
            <option>All Actions</option>
            <option>LOGIN</option>
            <option>CREATE</option>
            <option>UPDATE</option>
            <option>GENERATE</option>
            <option>BULK_ENTRY</option>
          </select>
          <span className="text-muted text-sm" style={{ marginLeft: 'auto', alignSelf: 'center' }}>247 records</span>
        </div>
      </div>
      <div className="card">
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>Timestamp</th>
                <th>User</th>
                <th>Action</th>
                <th>Module</th>
                <th>IP Address</th>
              </tr>
            </thead>
            <tbody>
              {ROWS.map((r, i) => (
                <tr key={i}>
                  <td className="text-sm text-muted">{r.ts}</td>
                  <td>
                    <strong>{r.user}</strong>
                    <br />
                    <span className="text-muted text-sm">{r.handle}</span>
                  </td>
                  <td>
                    <span className={`badge ${r.badge}`}>{r.action}</span>
                  </td>
                  <td>
                    <span className="tag">{r.module}</span>
                  </td>
                  <td className="text-sm text-muted font-mono">{r.ip}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
