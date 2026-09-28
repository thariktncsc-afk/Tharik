/**
 * Sign-in: a sign-in the server accepted must either open the app or SAY why
 * it cannot (office, 2026-09-28).
 *
 *   node tools/verify-sign-in.mjs                              the rules, from the code
 *   node tools/verify-sign-in.mjs --base=http://localhost:3000 …and the flow in Chrome
 *
 * The case it guards: an administrator pressed Sign In 19 times in 33 seconds
 * and the server accepted every one (activity log) — but the browser kept no
 * session cookie, so each "yes" went to /dashboard, the route guard sent it
 * straight back to /login, and the page said nothing. The button flashed
 * "Connecting…" and returned to "Sign In".
 *
 * The browser part stubs the server's ANSWERS (no credentials, nothing reaches
 * the database) and runs on desktop and an emulated phone.
 */
import { readFileSync } from 'node:fs';
import { createRequire, register } from 'node:module';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const srcUrl = pathToFileURL(join(root, 'src') + '/').href;
register(
  `data:text/javascript,${encodeURIComponent(
    `export async function resolve(s,c,n){if(s.startsWith('@/'))return n(${JSON.stringify(srcUrl)}+s.slice(2)+(/\\.[a-z]+$/.test(s)?'':'.ts'),c);return n(s,c);}`,
  )}`,
  import.meta.url,
);
const imp = (p) => import(pathToFileURL(join(root, p)).href);
const read = (p) => readFileSync(join(root, p), 'utf8');
const code = (p) => read(p).replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '');

let failures = 0;
const check = (label, ok, detail = '') => {
  if (ok) console.log(`  ok    ${label}`);
  else {
    failures++;
    console.log(`  FAIL  ${label}${detail ? `\n        ${detail}` : ''}`);
  }
};

console.log('\n1. The marker: did the browser keep the sign-in?');
const M = await imp('src/lib/sessionMarker.ts');
const S = await imp('src/lib/session.ts');
{
  check('found among other cookies', M.hasSignedInMarker('_ga=1; crs_signed_in=1; theme=dark'));
  check('absent → false (and a look-alike name is not it)', !M.hasSignedInMarker('_ga=1; xcrs_signed_in=1') && !M.hasSignedInMarker(''));
  const s = S.cookieOptions(), m = S.markerCookieOptions();
  check('the marker has the session cookie\'s own path, SameSite, Secure and lifetime — refused together',
    m.path === s.path && m.sameSite === s.sameSite && m.secure === s.secure && m.maxAge === s.maxAge);
  check('…but the page can read it (not HttpOnly), and the session cookie still cannot', m.httpOnly === false && s.httpOnly === true);
  check('the message is plain words: what happened and what to do, nothing technical',
    /did not keep the sign-in/.test(M.SIGN_IN_NOT_KEPT) && /Cookies and site data/.test(M.SIGN_IN_NOT_KEPT) && !/cookie=|http|500|error/i.test(M.SIGN_IN_NOT_KEPT.replace(/Cookies and site data|cookie-blocking/g, '')));
}

console.log('\n2. The server sets it with the session, and clears both');
{
  const route = code('src/app/api/session/route.ts');
  const post = route.slice(route.indexOf('export async function POST'), route.indexOf('export async function DELETE'));
  const del = route.slice(route.indexOf('export async function DELETE'));
  check('a successful sign-in sets the session and the marker', /res\.cookies\.set\(\s*SESSION_COOKIE/.test(post) && /res\.cookies\.set\(SIGNED_IN_MARKER, '1', markerCookieOptions\(\)\)/.test(post));
  check('…and only on success: the role picker and refusals carry neither', post.indexOf('SIGNED_IN_MARKER') > post.indexOf('const chosen'));
  check('sign-out clears both', /SESSION_COOKIE, '', cookieOptions\(0\)/.test(del) && /SIGNED_IN_MARKER, '', markerCookieOptions\(0\)/.test(del));
}

console.log('\n3. The page acts on it');
{
  const auth = code('src/lib/authClient.tsx');
  const login = auth.slice(auth.indexOf('const login = useCallback'), auth.indexOf('const logout = useCallback'));
  check('after the server\'s yes, the marker is looked for before the app is opened', login.indexOf('hasSignedInMarker(document.cookie)') > -1 && login.indexOf('hasSignedInMarker') < login.indexOf("setStatus('signedIn')"));
  check('no marker → ONE question to the server before anyone is told anything', /fetch\('\/api\/session', \{ headers: \{ Accept: 'application\/json' \}, signal: ctl\.signal \}\)/.test(login) && /if \(!kept\) return \{ ok: false, error: SIGN_IN_NOT_KEPT \}/.test(login));
  check('no waiting added: no timer between the answer and the dashboard', !/setTimeout\((?!\(\) => ctl\.abort)/.test(login));
  check('a late first "who is signed in?" cannot undo a sign-in or sign-out made since (epoch)',
    /const at = epoch\.current/.test(auth) && /epoch\.current !== at/.test(auth) && (auth.match(/epoch\.current\+\+/g) ?? []).length === 2);
  const page = read('src/app/login/page.tsx');
  check('the error is readable on the white card: dark red on light red, announced', /role="alert"/.test(page) && /color: '#B91C1C'/.test(page) && !/color: '#FCA5A5'/.test(page));
}

// ── 4. In Chrome ─────────────────────────────────────────────────────────
const base = process.argv.find((a) => a.startsWith('--base='))?.slice(7);
console.log('\n4. The flow in Chrome, desktop and phone');
if (!base) console.log('  skip  pass --base=http://localhost:3000 with the dev server running');
else {
  const puppeteer = createRequire(join(root, 'package.json'))('puppeteer-core');
  const chrome = [process.env.CHROME_PATH, 'C:/Program Files/Google/Chrome/Application/chrome.exe', '/usr/bin/google-chrome', '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'].find((p) => { try { return p && readFileSync(p) && true; } catch { return false; } });
  const ADMIN = { id: 1, fullName: 'Test Admin', username: 'admin', phone: '', email: '', role: 'ADMIN', crsId: null, active: true };
  const BC = { id: 9001, fullName: 'Test BC', username: 'crs7', phone: '', email: '', role: 'BC', crsId: 7, active: true };
  const PK = { id: 9002, fullName: 'Test Packer', username: 'crs7', phone: '', email: '', role: 'Packer', crsId: 7, active: true };
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const browser = await puppeteer.launch({ executablePath: chrome, headless: true });
  const run = async ({ mobile, keep = true, marker = true, slowCheckMs = 0, answer = 'ok' }) => {
    const ctx = await browser.createBrowserContext();
    const page = await ctx.newPage();
    if (mobile) await page.emulate(puppeteer.KnownDevices['Pixel 5']);
    const log = [];
    const navs = [];
    let first = true;
    await page.setRequestInterception(true);
    page.on('request', async (req) => {
      const u = new URL(req.url());
      if (u.pathname === '/api/session') {
        if (req.method() === 'POST') {
          const b = JSON.parse(req.postData() || '{}');
          log.push('POST');
          if (answer === 'wrong') return req.respond({ status: 401, contentType: 'application/json', body: '{"error":"Incorrect username or password."}' });
          if (answer === 'pick' && !b.userId) return req.respond({ status: 200, contentType: 'application/json', body: JSON.stringify({ ok: false, needsRole: true, candidates: [BC, PK] }) });
          const user = answer === 'pick' ? [BC, PK].find((x) => x.id === b.userId) : ADMIN;
          const set = [];
          if (keep) set.push(`crs_session=stub.${user.id}; Path=/; HttpOnly; SameSite=Lax; Max-Age=600`);
          if (keep && marker) set.push('crs_signed_in=1; Path=/; SameSite=Lax; Max-Age=600');
          return req.respond({ status: 200, contentType: 'application/json', headers: set.length ? { 'set-cookie': set } : {}, body: JSON.stringify({ ok: true, user }) });
        }
        const m = /crs_session=stub\.(\d+)/.exec(req.headers().cookie ?? '');
        log.push(m ? 'GET(signed in)' : 'GET');
        if (first && slowCheckMs) { first = false; await sleep(slowCheckMs); return req.respond({ status: 401, contentType: 'application/json', body: '{}' }).catch(() => {}); }
        first = false;
        const user = m ? [ADMIN, BC, PK].find((x) => x.id === Number(m[1])) : null;
        return req.respond(user ? { status: 200, contentType: 'application/json', body: JSON.stringify({ ok: true, user }) } : { status: 401, contentType: 'application/json', body: '{}' });
      }
      if (u.pathname.startsWith('/api/')) return req.respond({ status: 200, contentType: 'application/json', body: '{}' }).catch(() => {});
      req.continue();
    });
    page.on('framenavigated', (f) => { if (f === page.mainFrame()) navs.push(new URL(f.url()).pathname); });
    await page.goto(base + '/login', { waitUntil: 'networkidle2' });
    await page.type('input[placeholder="Username"]', 'test-user');
    await page.type('input[placeholder="Password"]', 'test-pass');
    const t0 = Date.now();
    await page.click('.login-btn');
    const state = () => page.evaluate(() => ({ path: location.pathname, alert: document.querySelector('[role="alert"]')?.textContent ?? '', picker: /Select your role/.test(document.body.innerText), button: document.querySelector('.login-btn')?.textContent ?? '' }));
    let st;
    for (let i = 0; i < 100; i++) { st = await state(); if (st.path !== '/login' || st.alert || st.picker) break; await sleep(50); }
    return { page, ctx, log, navs, st: { ...st, ms: Date.now() - t0 }, state };
  };
  for (const mobile of [false, true]) {
    const dev = mobile ? 'phone' : 'desktop';
    let r = await run({ mobile });
    const after = r.log.slice(r.log.indexOf('POST') + 1);
    check(`${dev}: accepted → the dashboard at once (${r.st.ms} ms), no second request`, r.st.path === '/dashboard' && !after.some((x) => x === 'GET'), r.log.join(' → '));
    await r.ctx.close();
    r = await run({ mobile, keep: false });
    check(`${dev}: accepted but not kept (the video) → says so (${r.st.ms} ms), never a silent bounce`, r.st.path === '/login' && /did not keep the sign-in/.test(r.st.alert) && r.st.button === 'Sign In' && !r.navs.includes('/dashboard'), JSON.stringify(r.st) + ' ' + r.navs.join(' → '));
    await r.ctx.close();
    r = await run({ mobile, marker: false });
    check(`${dev}: kept, marker hidden → one check, then the dashboard`, r.st.path === '/dashboard', r.log.join(' → '));
    await r.ctx.close();
    r = await run({ mobile, slowCheckMs: 4000 });
    await sleep(5000);
    check(`${dev}: a late first check (cold server) does not undo the sign-in`, (await r.state()).path === '/dashboard' && r.navs.lastIndexOf('/login') < r.navs.indexOf('/dashboard'), r.navs.join(' → '));
    await r.ctx.close();
    r = await run({ mobile, answer: 'wrong' });
    check(`${dev}: a wrong password is said`, r.st.path === '/login' && /Incorrect username or password/.test(r.st.alert), JSON.stringify(r.st));
    await r.ctx.close();
    r = await run({ mobile, answer: 'pick' });
    check(`${dev}: a shared shop login still offers the role picker`, r.st.picker, JSON.stringify(r.st));
    await r.page.$$eval('button', (bs) => bs.find((b) => /Test Packer/.test(b.textContent || ''))?.click());
    for (let i = 0; i < 60 && (await r.state()).path === '/login'; i++) await sleep(50);
    check(`${dev}: …and the chosen person is signed in`, (await r.state()).path === '/dashboard');
    await r.ctx.close();
  }
  await browser.close();
}

console.log(failures ? `\n${failures} FAILED\n` : '\nall passed\n');
process.exit(failures ? 1 : 0);
