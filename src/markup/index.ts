// Assembles the full application markup.
//
// The chunks are concatenated back into ONE string before being injected, so
// the browser parses byte-for-byte the same document the original single-file
// build produced (including its few unbalanced tags).
import login from './login';
import sidebar from './sidebar';
import shellOpen from './shellOpen';
import pageDashboard from './pageDashboard';
import pageReceipt from './pageReceipt';
import pageCrs from './pageCrs';
import pageCommodity from './pageCommodity';
import pageEntry from './pageEntry';
import pageMonthly from './pageMonthly';
import pageStatement from './pageStatement';
import pageReports from './pageReports';
import pageUsers from './pageUsers';
import pageSettings from './pageSettings';
import pageAudit from './pageAudit';
import shellClose from './shellClose';
import modals from './modals';
import viewers from './viewers';

const APP_MARKUP = [
  login,
  sidebar,
  shellOpen,
  pageDashboard,
  pageReceipt,
  pageCrs,
  pageCommodity,
  pageEntry,
  pageMonthly,
  pageStatement,
  pageReports,
  pageUsers,
  pageSettings,
  pageAudit,
  shellClose,
  modals,
  viewers,
].join('\n');

export default APP_MARKUP;
