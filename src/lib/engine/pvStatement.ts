/**
 * Physical Verification (PV) statement — ported from 04-reports.js.
 *
 * Kept as an HTML-string builder on purpose: it is a printable government
 * form whose layout must not drift, and the print flow relies on the
 * #pv-print-area visibility trick. The React screen renders the string.
 *
 * Two data fixes over the legacy builder, both noted inline:
 *  - gunny rows read `opening` (the store's real field; the legacy `open`
 *    read undefined, so every PV printed gunny opening as 0);
 *  - receipt totals read `items[k].qty` (the legacy parseFloat(object) was
 *    always NaN, so period receipt totals were silently 0).
 */
import { DSS_A, DSS_B, type DayEntry } from '@/lib/engine/commodities';

export type PvCommRow = {
  name: string;
  unit: string;
  open: number;
  receipt: number;
  total: number;
  issues: number;
  closing: number;
  amount: number;
  free: boolean;
  _openSet?: boolean;
};
export type PvAggregate = {
  commMap: Record<string, PvCommRow>;
  totalSales: number;
  totalReceipts: number;
  days: number;
};

type Stores = {
  entryStore: Record<string, DayEntry>;
  receiptStore: { crsId: number; date: string; items?: Record<string, { qty: number }> }[];
  monthlyStore: Record<string, { a?: Record<string, { open?: number; receipt?: number }>; b?: Record<string, { open?: number; receipt?: number }> }>;
};

const pad2 = (n: number) => String(n).padStart(2, '0');
const allComms = () => [...DSS_A, ...DSS_B];

export function pvAggregatePeriod(crsIds: number[], months: { year: number; month: number }[], stores: Stores): PvAggregate {
  const commMap: Record<string, PvCommRow> = {};
  let totalSales = 0;
  let totalReceipts = 0;
  const daysSet = new Set<string>();

  for (const cid of crsIds) {
    for (const ym of months) {
      const daysInMo = new Date(ym.year, ym.month, 0).getDate();
      for (let d = 1; d <= daysInMo; d++) {
        const dk = `${cid}_${ym.year}-${pad2(ym.month)}-${pad2(d)}`;
        const e = stores.entryStore[dk];
        if (!e) continue;
        daysSet.add(dk);
        for (const sec of ['a', 'b'] as const) {
          for (const [commId, row] of Object.entries(e[sec] ?? {})) {
            const qty = Number(row.sales) || 0;
            const amt = Number(row.amount) || 0;
            totalSales += amt;
            if (!commMap[commId]) {
              const cm = allComms().find((x) => x.id === commId);
              commMap[commId] = {
                name: cm?.en ?? commId, unit: cm?.unit ?? 'KG',
                open: 0, receipt: 0, total: 0, issues: 0, closing: 0, amount: 0,
                free: !!cm?.free,
              };
            }
            commMap[commId].issues += qty;
            commMap[commId].amount += amt;
          }
        }
      }
      for (const r of stores.receiptStore) {
        if (!crsIds.includes(r.crsId)) continue;
        const [ry, rm] = r.date.split('-').map(Number);
        if (ry !== ym.year || rm !== ym.month) continue;
        for (const it of Object.values(r.items ?? {})) totalReceipts += Number(it?.qty) || 0;
      }
      for (const cid2 of crsIds) {
        const ms = stores.monthlyStore[`${cid2}_${ym.month}_${ym.year}`];
        if (!ms) continue;
        for (const sec of ['a', 'b'] as const) {
          for (const [commId, sv] of Object.entries(ms[sec] ?? {})) {
            const row = commMap[commId];
            if (!row) continue;
            if (!row._openSet) {
              row.open = Number(sv.open) || 0;
              row._openSet = true;
            }
            row.receipt += Number(sv.receipt) || 0;
          }
        }
      }
    }
  }

  for (const row of Object.values(commMap)) {
    row.total = row.open + row.receipt;
    row.closing = Math.max(0, row.total - row.issues);
  }
  return { commMap, totalSales, totalReceipts, days: daysSet.size };
}

type GunnyMonth = Record<string, { opening?: number; receipt?: number; total?: number; issues?: number; closing?: number }>;

export function buildPVTable(opts: {
  commMap: Record<string, PvCommRow>;
  periodLabel: string;
  crsId: number;
  crsName: string;
  gunny: GunnyMonth;
  billClerk: string;
  pvOfficer?: string;
}): string {
  const { commMap, periodLabel, crsId, crsName, gunny, billClerk, pvOfficer } = opts;
  const fmtN = (v: number | undefined | null) => {
    if (v === undefined || v === null || v === 0) return '0';
    const n = Number(v);
    return Number.isInteger(n) ? String(n) : n.toFixed(3);
  };
  const fmtB = (kgs: number, div: number) => (!kgs ? '0' : String(Math.floor(kgs / (div || 50))));

  const mainComms = DSS_A.filter((c) => commMap[c.id]).map((c) => c.id);
  const policeComms = DSS_B.filter((c) => commMap[c.id]).map((c) => c.id);

  const C = (v: string | number | undefined, span?: number) =>
    `<td style="border:1px solid #000;padding:2px 4px;text-align:center;font-size:8.5px;white-space:nowrap"${span ? ` colspan="${span}"` : ''}>${v === undefined || v === null ? '' : v}</td>`;
  const L = (v: string) => `<td style="border:1px solid #000;padding:2px 6px;font-size:8.5px;font-weight:600">${v}</td>`;
  const dataRow = (
    sl: number, label: string, unit: string,
    bagsOb: string, kgsOb: string, bagsRec: string, kgsRec: string, kgsTransfer: string,
    bagsTot: string, kgsTot: string, bagsIss: string, kgsIss: string, bagsBal: string, kgsBal: string,
  ) =>
    '<tr>' +
    C(sl) + L(label) + C(unit) + C('') +
    C('') + C('') +
    C(bagsOb || '0') + C(kgsOb || '0') + C('') + C('') +
    C('') + C('') +
    C(bagsRec || '0') + C(kgsRec || '0') +
    C(kgsTransfer || '') +
    C(bagsTot || '0') + C(kgsTot || '0') +
    C(bagsIss || '0') + C(kgsIss || '0') +
    C('') + C('') +
    C('') + C('') + C('') + C('') + C('') +
    C(bagsBal || '0') + C(kgsBal || '0') +
    C('') + C('') +
    C('') + C('') + C('') + C('') + C('') + C('') +
    '</tr>';
  const sectionLabel = (text: string) =>
    `<tr><td colspan="39" style="border:1px solid #000;padding:3px 8px;font-weight:700;font-size:9px;background:#F5F5F5">${text}</td></tr>`;

  let rows = '';
  let sl = 1;
  for (const cid of mainComms) {
    const r = commMap[cid];
    const div = cid === 'PALM' ? 10 : cid === 'SALT_CIS' || cid === 'SALT_RFFS' ? 25 : 50;
    rows += dataRow(sl++, r.name, r.unit, fmtB(r.open, div), fmtN(r.open), fmtB(r.receipt, div), fmtN(r.receipt), '', fmtB(r.total, div), fmtN(r.total), fmtB(r.issues, div), fmtN(r.issues), fmtB(r.closing, div), fmtN(r.closing));
  }
  rows += sectionLabel('Gunny');
  for (const [label, key] of [
    ['50 kg SS GUNNY', 'ss50'],
    ['POLYTHENE', 'poly'],
    ['C.BOX', 'cbox'],
  ] as const) {
    const g = gunny[key];
    rows += dataRow(sl++, label, 'NOS', g ? fmtN(g.opening) : '0', '', g ? fmtN(g.receipt) : '0', '', '', g ? fmtN(g.total) : '0', '', g ? fmtN(g.issues) : '0', '', g ? fmtN(g.closing) : '0', '');
  }
  if (policeComms.length) {
    rows += sectionLabel('Police');
    for (const cid of policeComms) {
      const r = commMap[cid];
      rows += dataRow(sl++, r.name, r.unit, '0', fmtN(r.open), '0', fmtN(r.receipt), '', '0', fmtN(r.total), '0', fmtN(r.issues), '0', fmtN(r.closing));
    }
  }

  const th7 = 'style="border:1px solid #000;text-align:center;font-size:7px;padding:2px"';
  const th8 = 'style="border:1px solid #000;text-align:center;font-size:8px;font-weight:700;padding:2px"';
  const hdr =
    '<thead>' +
    '<tr><td colspan="39" style="border:1px solid #000;text-align:center;font-weight:800;font-size:11px;padding:5px">TAMIL NADU CIVIL SUPPLIES CORPORATION MADURAI REGION</td></tr>' +
    `<tr><td colspan="20" style="border:1px solid #000;padding:4px 8px;font-size:9px"><b>NAME OF THE CRS :</b> ${crsId}${crsName ? ' — ' + crsName : ''}</td>` +
    `<td colspan="19" style="border:1px solid #000;padding:4px 8px;font-size:9px"><b>NAME AND DESIGNATION OF THE P.V.OFFICER :</b> ${pvOfficer || '____________'}</td></tr>` +
    `<tr><td colspan="20" style="border:1px solid #000;padding:4px 8px;font-size:9px"><b>NAME OF THE BILL CLERK :</b> ${billClerk}</td>` +
    '<td colspan="19" style="border:1px solid #000;padding:4px 8px;font-size:9px"><b>DATE OF P.V. :</b> ____________</td></tr>' +
    `<tr><td colspan="39" style="border:1px solid #000;text-align:center;font-weight:700;font-size:10px;padding:4px">PHYSICAL VERIFICATION REPORT OF COMMODITIES AS ON ${periodLabel}</td></tr>` +
    '<tr style="background:#F5F5F5">' +
    `<td rowspan="4" ${th8}>Sl.<br>No.</td><td rowspan="4" ${th8}>Commodity</td><td rowspan="4" ${th8}>Unit</td><td rowspan="4" ${th8}>Stack<br>No.</td>` +
    `<td colspan="2" ${th8}>Period</td><td colspan="6" ${th8}>As on Start Date</td><td colspan="2" ${th8}>Receipt</td><td colspan="1" ${th8}>TRANSFER</td>` +
    `<td colspan="2" ${th8}>TOTAL</td><td colspan="4" ${th8}>Issues [Excl. Shortage]</td><td colspan="5" ${th8}>Qty Expunged</td>` +
    `<td colspan="2" ${th8}>Balance per Stack Card</td><td colspan="2" ${th8}>Shortage</td><td colspan="6" ${th8}>Physical Verification (End Date)</td>` +
    '</tr>' +
    '<tr style="background:#F5F5F5">' +
    `<td rowspan="3" ${th7}>From</td><td rowspan="3" ${th7}>To</td>` +
    `<td colspan="2" ${th7}>Stack card</td><td colspan="2" ${th7}>Physical</td><td colspan="2" ${th7}>Shortage</td><td colspan="2" ${th7}></td>` +
    `<td ${th7}>KGS</td><td colspan="2" ${th7}></td><td colspan="2" ${th7}></td><td colspan="2" ${th7}></td>` +
    `<td ${th7}>RM ref</td><td ${th7}>Date</td><td ${th7}>Issue</td><td ${th7}>Date</td><td ${th7}>Qty</td>` +
    `<td colspan="2" ${th7}></td><td colspan="2" ${th7}></td><td colspan="2" ${th7}>By Counting</td><td colspan="2" ${th7}>By 100%</td><td colspan="2" ${th7}></td>` +
    '</tr>' +
    '<tr style="background:#F5F5F5">' +
    `<td colspan="2" ${th7}>Bags&nbsp;&nbsp;Kgs</td><td colspan="2" ${th7}>Bags&nbsp;&nbsp;Kgs</td><td colspan="2" ${th7}>Bags&nbsp;&nbsp;Kgs</td><td colspan="2" ${th7}>Bags&nbsp;&nbsp;Kgs</td>` +
    `<td ${th7}></td><td colspan="2" ${th7}>Bags&nbsp;&nbsp;Kgs</td><td colspan="2" ${th7}>Bags&nbsp;&nbsp;Kgs</td><td colspan="2" ${th7}>Bags&nbsp;&nbsp;Kgs</td>` +
    `<td colspan="5" ${th7}></td><td colspan="2" ${th7}>Bags&nbsp;&nbsp;Kgs</td><td colspan="2" ${th7}>Bags&nbsp;&nbsp;Kgs</td>` +
    `<td colspan="2" ${th7}>Bags&nbsp;&nbsp;Kgs</td><td colspan="2" ${th7}>Bags&nbsp;&nbsp;Kgs</td><td colspan="2" ${th7}>Excess&nbsp;&nbsp;Short</td>` +
    '</tr>' +
    '<tr style="background:#F5F5F5">' +
    Array.from({ length: 35 }, (_, i) => `<td style="border:1px solid #000;text-align:center;font-size:7px;padding:1px">${i + 4}</td>`).join('') +
    '</tr>' +
    '</thead>';

  const footer =
    '<tfoot>' +
    '<tr><td colspan="39" style="border:1px solid #000;padding:6px 10px;font-size:9px;font-weight:600">NOTE:</td></tr>' +
    '<tr><td colspan="20" style="border:1px solid #000;padding:6px 10px;font-size:9px">' +
    '1. Certified that the details were verified with connected records and found correct.<br>' +
    '2. Certified that the result of the physical verification have been recorded in the stock ledger, stack register and stack card.' +
    '</td>' +
    '<td colspan="19" style="border:1px solid #000;padding:6px 10px;font-size:9px;text-align:center">' +
    '<br><br><b>SIGNATURE OF THE PHYSICAL VERIFICATION OFFICER</b></td></tr>' +
    '<tr><td colspan="20" style="border:1px solid #000;padding:16px 10px 6px;font-size:9px;text-align:center"><b>SIGNATURE OF BILL CLERK WITH SEAL</b></td>' +
    '<td colspan="19" style="border:1px solid #000;padding:6px 10px;font-size:9px"></td></tr>' +
    '</tfoot>';

  return (
    '<div id="pv-print-area">' +
    '<style>@media print{body *{visibility:hidden}#pv-print-area,#pv-print-area *{visibility:visible}#pv-print-area{position:fixed;top:0;left:0;width:100%;z-index:9999;padding:8px}}</style>' +
    '<div style="overflow-x:auto">' +
    '<table id="pv-tbl" style="border-collapse:collapse;font-family:Arial,sans-serif;width:100%;min-width:1400px">' +
    hdr + '<tbody>' + rows + '</tbody>' + footer + '</table></div></div>'
  );
}
