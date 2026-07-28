/* Forgot-password lookup on the login screen  [+]
   Added after the port; not part of TNCSC_CRS_Demo_19 (1).html, so
   tools/verify-parity.mjs skips this file (see NEW_ENGINE there).

   The port rendered "Forgot your password?" as inert text. It now opens a
   dialog that takes a registered mobile number, looks it up in userStore --
   the same record the Users page and doLogin() read -- and shows that user's
   sign-in details, or "No account found with this mobile number." if the
   number is not registered.

   SECURITY NOTE. Handing a password back to anyone who knows a mobile number
   is not a pattern that survives contact with real credentials: possession of
   a phone NUMBER is not possession of the phone. It is safe in this build only
   because every account shares the same demo password, which is a literal in
   06-users.js and therefore already in the client bundle -- so this screen
   discloses nothing that devtools would not. Before this app talks to a real
   user table, this flow must become send-a-reset-link/OTP-to-the-device rather
   than show-the-password, and the lookup must move server-side.

   WHY THE DIALOG IS BUILT HERE rather than in src/markup/login.ts: it is a
   whole new screen, so building it in JS keeps the ported markup file free of
   another redesign block. It is appended to <body> once, on first open.

   Z-INDEX. .modal-bg (globals.css) sits at 500 but #login-screen sits at 1000,
   so the app's usual modal shell would render UNDER the login card. This one
   carries its own overlay above both. */

var FP_Z = 1600;

function fpDigits(v) {
  // Compare on digits only, last 10, so "+91 98765 43210", "098765 43210" and
  // "9876543210" are the same number rather than three different ones.
  var d = String(v == null ? '' : v).replace(/[^0-9]/g, '');
  return d.length > 10 ? d.slice(-10) : d;
}

function fpRoleLabel(role) {
  if (role === 'BC') return 'BC (Bill Clerk)';
  if (role === 'ADMIN') return 'Admin (Administrator)';
  return role || '—';
}

function fpShopLabel(user) {
  if (!user.crsId) return 'All shops (Administrator)';
  var num = 'CRS ' + (user.crsId < 10 ? '0' + user.crsId : user.crsId);
  var shop = (typeof CRS_LIST !== 'undefined')
    ? CRS_LIST.find(function (c) { return c.id === user.crsId; })
    : null;
  return shop && shop.name ? num + ' — ' + shop.name : num;
}

function fpEnsureModal() {
  if (document.getElementById('fp-overlay')) return;

  var wrap = document.createElement('div');
  wrap.id = 'fp-overlay';
  wrap.setAttribute('role', 'dialog');
  wrap.setAttribute('aria-modal', 'true');
  wrap.setAttribute('aria-labelledby', 'fp-title');
  wrap.style.cssText =
    'display:none;position:fixed;inset:0;background:rgba(0,0,0,.5);z-index:' + FP_Z + ';' +
    'align-items:center;justify-content:center;padding:20px';

  wrap.innerHTML =
    '<div class="modal" style="width:440px;max-width:100%;max-height:90vh;overflow-y:auto">' +
      '<div class="modal-head" style="display:flex;align-items:flex-start;justify-content:space-between;gap:12px">' +
        '<div>' +
          '<h3 id="fp-title">&#128273; Forgot Password</h3>' +
          '<div style="color:rgba(255,255,255,.65);font-size:11px;margin-top:2px">' +
            'Look up your sign-in details with your registered mobile number' +
          '</div>' +
        '</div>' +
        '<button type="button" onclick="closeForgotPassword()" aria-label="Close"' +
          ' style="background:none;border:none;color:rgba(255,255,255,.8);font-size:18px;cursor:pointer;line-height:1;padding:0">' +
          '&#10005;' +
        '</button>' +
      '</div>' +
      '<div class="modal-body">' +
        '<label for="fp-phone" style="display:block;font-size:12px;font-weight:700;color:var(--text);margin-bottom:6px">' +
          'Registered Mobile Number' +
        '</label>' +
        '<input id="fp-phone" type="tel" inputmode="numeric" autocomplete="tel" placeholder="10-digit mobile number"' +
          ' style="width:100%;border:1px solid var(--border);border-radius:8px;padding:10px 12px;font-size:14px"/>' +
        '<div id="fp-msg" style="display:none;margin-top:12px;border-radius:8px;padding:10px 12px;font-size:12px;font-weight:600"></div>' +
        '<div id="fp-result" style="display:none;margin-top:14px"></div>' +
      '</div>' +
      '<div class="modal-foot">' +
        '<button type="button" class="btn btn-outline btn-sm" onclick="closeForgotPassword()">Close</button>' +
        '<button type="button" class="btn btn-sm" onclick="fpLookup()"' +
          ' style="background:var(--navy);color:#fff">Find My Account</button>' +
      '</div>' +
    '</div>';

  // Backdrop click closes; clicks inside the card must not bubble out to it.
  wrap.addEventListener('click', function (e) {
    if (e.target === wrap) closeForgotPassword();
  });

  document.body.appendChild(wrap);

  var input = document.getElementById('fp-phone');
  input.addEventListener('keydown', function (e) {
    if (e.key === 'Enter') { e.preventDefault(); fpLookup(); }
  });
  // Re-typing after a miss should clear the previous verdict rather than leave
  // a stale "no account found" sitting under a number that has since changed.
  input.addEventListener('input', function () {
    document.getElementById('fp-msg').style.display = 'none';
    document.getElementById('fp-result').style.display = 'none';
  });
}

function fpShowMessage(kind, text) {
  var el = document.getElementById('fp-msg');
  var tone = kind === 'error'
    ? 'background:#FEF2F2;border:1px solid #FECACA;color:#B91C1C'
    : 'background:#FFFBEB;border:1px solid #FDE68A;color:#92400E';
  el.style.cssText =
    'margin-top:12px;border-radius:8px;padding:10px 12px;font-size:12px;font-weight:600;display:block;' + tone;
  el.textContent = text;
  document.getElementById('fp-result').style.display = 'none';
}

function openForgotPassword() {
  fpEnsureModal();
  var overlay = document.getElementById('fp-overlay');
  document.getElementById('fp-phone').value = '';
  document.getElementById('fp-msg').style.display = 'none';
  document.getElementById('fp-result').style.display = 'none';
  overlay.style.display = 'flex';
  setTimeout(function () {
    var el = document.getElementById('fp-phone');
    if (el) el.focus();
  }, 0);
}

function closeForgotPassword() {
  var overlay = document.getElementById('fp-overlay');
  if (overlay) overlay.style.display = 'none';
}

function fpLookup() {
  var raw = (document.getElementById('fp-phone').value || '').trim();
  if (!raw) {
    fpShowMessage('warn', 'Please enter your registered mobile number.');
    return;
  }

  var wanted = fpDigits(raw);
  if (wanted.length < 10) {
    fpShowMessage('warn', 'Please enter the full 10-digit mobile number.');
    return;
  }

  var matches = (typeof userStore !== 'undefined' ? userStore : []).filter(function (u) {
    return fpDigits(u.phone) === wanted;
  });

  // A deactivated account is still a registered one, but it cannot sign in, so
  // handing its password out would only mislead — say why instead.
  var active = matches.filter(function (u) { return u.active; });
  if (!active.length) {
    if (matches.length) {
      fpShowMessage('warn', 'This account is deactivated. Please contact your administrator.');
    } else {
      fpShowMessage('error', 'No account found with this mobile number.');
    }
    return;
  }

  document.getElementById('fp-msg').style.display = 'none';
  fpRenderAccounts(active);
}

function fpRenderAccounts(users) {
  function row(label, value, strong) {
    return '<div style="display:flex;gap:10px;padding:7px 0;border-bottom:1px solid #E2E8F0">' +
      '<div style="flex:0 0 108px;font-size:11px;color:var(--muted);font-weight:600">' + label + '</div>' +
      '<div style="flex:1;font-size:' + (strong ? '13' : '12') + 'px;color:var(--text);font-weight:' +
        (strong ? '800' : '600') + ';word-break:break-word">' + value + '</div>' +
    '</div>';
  }
  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"]/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c];
    });
  }

  var html = users.map(function (u) {
    return '<div style="border:1px solid #BBF7D0;background:#F0FDF4;border-radius:10px;padding:12px 14px;margin-bottom:10px">' +
      '<div style="font-size:11px;font-weight:800;color:#15803D;margin-bottom:8px">&#10003; Account found</div>' +
      row('Name', esc(u.fullName)) +
      row('Username', esc(u.username), true) +
      row('Mobile', esc(u.phone)) +
      row('Role', esc(fpRoleLabel(u.role))) +
      row('Assigned Shop', esc(fpShopLabel(u))) +
      '<div style="display:flex;gap:10px;padding:9px 0 2px">' +
        '<div style="flex:0 0 108px;font-size:11px;color:var(--muted);font-weight:600">Password</div>' +
        '<div style="flex:1"><code style="background:#DCFCE7;border:1px solid #86EFAC;color:#166534;' +
          'padding:3px 9px;border-radius:6px;font-size:13px;font-weight:800">' + esc(u.password) + '</code></div>' +
      '</div>' +
    '</div>';
  }).join('');

  // One number, two staff records (a BC and a Packer sharing a phone) is not in
  // the seed data but is not prevented by it either, so say which is which
  // rather than silently showing only the first.
  if (users.length > 1) {
    html = '<div style="font-size:11px;color:var(--muted);font-weight:600;margin-bottom:8px">' +
      users.length + ' accounts are registered to this mobile number.</div>' + html;
  }

  html += '<div style="font-size:11px;color:var(--muted);line-height:1.5">' +
    'Sign in with the <b>Username</b> above. The first letter may be capitalised ' +
    '(<code>Crs7</code> or <code>crs7</code>); the rest must stay lowercase.</div>';

  var el = document.getElementById('fp-result');
  el.innerHTML = html;
  el.style.display = 'block';
}

/* The "Forgot your password?" line is ported markup with no handler of its own,
   and it is painted by React after this script runs, so binding directly to the
   node here would race the render. A delegated listener does not care when the
   node appears. */
document.addEventListener('click', function (e) {
  var t = e.target;
  if (t && t.closest && t.closest('.login-forgot')) {
    e.preventDefault();
    openForgotPassword();
  }
});

document.addEventListener('keydown', function (e) {
  if (e.key !== 'Escape') return;
  var overlay = document.getElementById('fp-overlay');
  if (overlay && overlay.style.display === 'flex') closeForgotPassword();
});
