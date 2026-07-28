// Login screen + role picker
// Verbatim from TNCSC_CRS_Demo_19 (1).html lines 182-233.
const html = `

<!-- ─── LOGIN ──────────────────────────────────────── -->
<div id="login-screen">
  <div class="login-gov">
    <h1>Government of Tamil Nadu</h1>
    <p>Tamil Nadu Civil Supplies Corporation</p>
  </div>
  <div class="login-card" style="margin-top:16px">
    <div class="login-header">
      <!-- [+redesign-start] The "TN" lettering is replaced by the Seal of Tamil Nadu. The
           port's own text for this line is held in REDESIGNED in tools/verify-parity.mjs. -->
      <div class="login-badge" style="background:#fff;padding:4px">
        <img src="/img/seal-of-tamil-nadu.svg" alt="Seal of Tamil Nadu" width="44" height="44"
             style="width:100%;height:100%;object-fit:contain;display:block"/>
      </div>
      <!-- [+redesign-end] -->
      <h2>CRS Statement Management System</h2>
      <!-- [+redesign-start] The subtitle no longer spells the accepted username formats out
           ("Enter phone number or shop code (crs1...crs30)") — it just says what to do. The
           port's own text for this line is held in REDESIGNED in tools/verify-parity.mjs and
           spliced back before the byte comparison. -->
      <p>Enter username and password to login</p>
      <!-- [+redesign-end] -->
    </div>
    <div class="login-body">
      <div id="login-form-section">
      <div class="login-input-wrap">
        <span class="login-icon">👤</span>
        <!-- [+redesign-start] The placeholder is just the field name now; the port spelled the
             accepted formats out here ("Phone number or crs1, crs2..."), which the subtitle
             above the form already says. The port's own text for this line is held in
             REDESIGNED in tools/verify-parity.mjs and spliced back before the byte comparison. -->
        <input class="login-input" type="text" placeholder="Username" id="login-user" value="" onkeydown="if(event.key==='Enter'){event.preventDefault();document.getElementById('login-pass').focus();}"/>
        <!-- [+redesign-end] -->
      </div>
      <div class="login-input-wrap">
        <span class="login-icon">🔒</span>
        <!-- [+redesign-start] The placeholder is just the field name now; the port carried the
             demo password in it ("Password (pds123)"), which does not belong on a sign-in form.
             The port's own text for this line is held in REDESIGNED in tools/verify-parity.mjs
             and spliced back before the byte comparison. -->
        <input class="login-input" type="password" placeholder="Password" id="login-pass" value="" onkeydown="if(event.key==='Enter'){event.preventDefault();doLogin();}"/>
        <!-- [+redesign-end] -->
        <button type="button" onclick="toggleLoginPwd()" style="position:absolute;right:12px;top:50%;transform:translateY(-50%);background:none;border:none;cursor:pointer;font-size:14px;color:var(--muted)" id="login-eye-btn">👁</button>
      </div>
      <div id="login-err" style="display:none;background:rgba(220,38,38,.12);border:1px solid rgba(220,38,38,.3);border-radius:8px;padding:9px 12px;color:#FCA5A5;font-size:12px;margin-bottom:6px;text-align:center"></div>
      <button class="login-btn" onclick="doLogin()" id="login-submit-btn">Sign In</button></div>
      <!-- Role picker — shown inline when CRS has BC+Packer -->
      <div id="login-role-section" style="display:none;padding:4px 0">
        <div style="text-align:center;margin-bottom:16px">
          <div style="font-size:12px;color:rgba(255,255,255,.5);margin-bottom:4px">Multiple staff found for</div>
          <div id="login-role-crs-label" style="font-weight:800;font-size:16px;color:#fff"></div>
          <div style="font-size:11px;color:rgba(255,255,255,.5);margin-top:3px">Who are you? Select your role</div>
        </div>
        <div id="login-role-options" style="display:flex;flex-direction:column;gap:10px;margin-bottom:14px"></div>
        <button onclick="cancelRoleSelect()" style="width:100%;padding:10px;background:rgba(255,255,255,.08);border:1px solid rgba(255,255,255,.2);color:rgba(255,255,255,.7);border-radius:10px;font-size:13px;cursor:pointer;font-weight:600">
          &#8592; Back to Login
        </button>
      </div>
      <div class="login-forgot">Forgot your password?</div>
      <!-- [+redesign-start] The port's "Quick Login" row of one-click demo sign-ins was
           removed: it put working credentials on the sign-in screen. The port's own text
           for this block is held in REDESIGNED in tools/verify-parity.mjs and spliced
           back before the byte comparison. -->
      <!-- [+redesign-end] -->
    </div>
  </div>
  <div class="login-footer">© 2026 Tamil Nadu Civil Supplies Corporation. All rights reserved.</div>
</div>

`;

export default html;
