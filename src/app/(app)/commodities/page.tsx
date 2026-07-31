/**
 * Commodity Master — React port of src/markup/pageCommodity.ts.
 * The legacy screen is a reference table (its Edit buttons and Add modal were
 * demo leftovers with no behaviour); ported as-is, same classes and rows.
 */
const ROWS = [
  { order: 1, code: 'RICE', en: 'Rice', ta: 'அரிசி', unit: 'KG', cat: 'RICE' },
  { order: 2, code: 'WHEAT', en: 'Wheat', ta: 'கோதுமை', unit: 'KG', cat: 'WHEAT' },
  { order: 3, code: 'SUGAR', en: 'Sugar', ta: 'சர்க்கரை', unit: 'KG', cat: 'SUGAR' },
  { order: 4, code: 'TOOR', en: 'Toor Dal', ta: 'துவரம் பருப்பு', unit: 'KG', cat: 'PULSES' },
  { order: 5, code: 'PALM', en: 'Palm Oil', ta: 'பாமாயில்', unit: 'LTR', cat: 'OIL' },
  { order: 6, code: 'KERO', en: 'Kerosene', ta: 'மண்ணெண்ணெய்', unit: 'LTR', cat: 'KEROSENE' },
  { order: 7, code: 'SALT', en: 'Salt', ta: 'உப்பு', unit: 'KG', cat: 'OTHER' },
];

export default function CommoditiesPage() {
  return (
    <div className="page active" id="page-commodity">
      <div className="page-header flex justify-between items-center">
        <div>
          <div className="page-title">Commodity Master</div>
          <div className="page-sub">Manage commodity list and statement column order</div>
        </div>
        <button className="btn btn-primary" disabled title="Commodity editing arrives with the modal conversion">
          + Add Commodity
        </button>
      </div>
      <div className="card">
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>Order</th>
                <th>Code</th>
                <th>Name (EN)</th>
                <th>Name (Tamil)</th>
                <th>Unit</th>
                <th>Category</th>
                <th>Status</th>
                <th>Actions</th>
              </tr>
            </thead>
            <tbody>
              {ROWS.map((r) => (
                <tr key={r.code}>
                  <td style={{ textAlign: 'center', fontFamily: 'monospace' }}>{r.order}</td>
                  <td>
                    <span style={{ fontFamily: 'monospace', fontWeight: 700, color: 'var(--navy)' }}>{r.code}</span>
                  </td>
                  <td>{r.en}</td>
                  <td>{r.ta}</td>
                  <td>
                    <span className="badge badge-blue">{r.unit}</span>
                  </td>
                  <td>{r.cat}</td>
                  <td>
                    <span className="badge badge-green">Active</span>
                  </td>
                  <td>
                    <button className="btn btn-outline btn-sm">Edit</button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
