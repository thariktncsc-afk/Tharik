'use client';

/**
 * React port of the sign-in screen (src/markup/login.ts). Same markup
 * structure and class names, so globals.css styles it identically to the
 * legacy screen at `/`. Talks to /api/session through the auth context;
 * the multi-staff role picker renders inline exactly like the original.
 */
import { useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { useAuth, type EngineUser } from '@/lib/authClient';

export default function LoginPage() {
  const router = useRouter();
  const { status, login } = useAuth();

  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [showPwd, setShowPwd] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [candidates, setCandidates] = useState<EngineUser[] | null>(null);
  const passRef = useRef<HTMLInputElement>(null);

  // Middleware already bounces signed-in visitors, but the cookie can arrive
  // mid-visit (e.g. sign-in on the legacy tab) — follow the context too.
  useEffect(() => {
    if (status === 'signedIn') router.replace('/dashboard');
  }, [status, router]);

  const submit = async (userId?: number) => {
    if (!username.trim() || !password.trim()) {
      setError('Please enter your username/phone and password.');
      return;
    }
    setBusy(true);
    setError('');
    const res = await login(username.trim(), password.trim(), userId);
    setBusy(false);
    if (res.ok) {
      router.replace('/dashboard');
      return;
    }
    if ('needsRole' in res && res.needsRole) {
      setCandidates(res.candidates);
      return;
    }
    setError('error' in res ? res.error : 'Sign-in failed.');
  };

  const roleCrs = candidates?.[0]?.crsId;

  return (
    <div id="login-screen">
      <div className="login-gov">
        <h1>Government of Tamil Nadu</h1>
        <p>Tamil Nadu Civil Supplies Corporation</p>
      </div>
      <div className="login-card" style={{ marginTop: 16 }}>
        <div className="login-header">
          <div className="login-badge" style={{ background: '#fff', padding: 4 }}>
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src="/img/seal-of-tamil-nadu.svg"
              alt="Seal of Tamil Nadu"
              width={44}
              height={44}
              style={{ width: '100%', height: '100%', objectFit: 'contain', display: 'block' }}
            />
          </div>
          <h2>CRS Statement Management System</h2>
          <p>Enter username and password to login</p>
        </div>
        <div className="login-body">
          {!candidates ? (
            <div id="login-form-section">
              <div className="login-input-wrap">
                <span className="login-icon">👤</span>
                <input
                  className="login-input"
                  type="text"
                  placeholder="Username"
                  value={username}
                  autoFocus
                  onChange={(e) => setUsername(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') {
                      e.preventDefault();
                      passRef.current?.focus();
                    }
                  }}
                />
              </div>
              <div className="login-input-wrap">
                <span className="login-icon">🔒</span>
                <input
                  ref={passRef}
                  className="login-input"
                  type={showPwd ? 'text' : 'password'}
                  placeholder="Password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') {
                      e.preventDefault();
                      void submit();
                    }
                  }}
                />
                <button
                  type="button"
                  onClick={() => setShowPwd((v) => !v)}
                  style={{
                    position: 'absolute',
                    right: 12,
                    top: '50%',
                    transform: 'translateY(-50%)',
                    background: 'none',
                    border: 'none',
                    cursor: 'pointer',
                    fontSize: 14,
                    color: 'var(--muted)',
                  }}
                >
                  {showPwd ? '🙈' : '👁'}
                </button>
              </div>
              {error ? (
                <div
                  style={{
                    background: 'rgba(220,38,38,.12)',
                    border: '1px solid rgba(220,38,38,.3)',
                    borderRadius: 8,
                    padding: '9px 12px',
                    color: '#FCA5A5',
                    fontSize: 12,
                    marginBottom: 6,
                    textAlign: 'center',
                  }}
                >
                  {error}
                </div>
              ) : null}
              <button className="login-btn" onClick={() => void submit()} disabled={busy}>
                {busy ? 'Connecting…' : 'Sign In'}
              </button>
            </div>
          ) : (
            <div style={{ padding: '4px 0' }}>
              <div style={{ textAlign: 'center', marginBottom: 16 }}>
                <div style={{ fontSize: 12, color: 'rgba(255,255,255,.5)', marginBottom: 4 }}>
                  Multiple staff found for
                </div>
                <div style={{ fontWeight: 800, fontSize: 16, color: '#fff' }}>CRS {roleCrs}</div>
                <div style={{ fontSize: 11, color: 'rgba(255,255,255,.5)', marginTop: 3 }}>
                  Who are you? Select your role
                </div>
              </div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 10, marginBottom: 14 }}>
                {candidates.map((u) => {
                  const isBC = u.role === 'BC';
                  const roleColor = isBC ? '#0369A1' : '#C2410C';
                  const roleBg = isBC ? 'rgba(14,165,233,.12)' : 'rgba(194,65,12,.08)';
                  return (
                    <button
                      key={u.id}
                      onClick={() => void submit(u.id)}
                      disabled={busy}
                      style={{
                        display: 'flex',
                        alignItems: 'center',
                        gap: 12,
                        width: '100%',
                        border: `2px solid ${roleColor}`,
                        borderRadius: 12,
                        padding: '14px 16px',
                        background: roleBg,
                        cursor: 'pointer',
                        textAlign: 'left',
                      }}
                    >
                      <div style={{ fontSize: 22 }}>{isBC ? '🖊' : '📦'}</div>
                      <div>
                        <div style={{ fontWeight: 800, fontSize: 14, color: roleColor }}>
                          {u.role} — {u.fullName}
                        </div>
                        <div style={{ fontSize: 12, color: 'rgba(255,255,255,.6)', marginTop: 2 }}>{u.phone}</div>
                      </div>
                    </button>
                  );
                })}
              </div>
              <button
                onClick={() => {
                  setCandidates(null);
                  setUsername('');
                  setPassword('');
                  setError('');
                }}
                style={{
                  width: '100%',
                  padding: 10,
                  background: 'rgba(255,255,255,.08)',
                  border: '1px solid rgba(255,255,255,.2)',
                  color: 'rgba(255,255,255,.7)',
                  borderRadius: 10,
                  fontSize: 13,
                  cursor: 'pointer',
                  fontWeight: 600,
                }}
              >
                ← Back to Login
              </button>
            </div>
          )}
          <div className="login-forgot">Forgot your password?</div>
        </div>
      </div>
      <div className="login-footer">© 2026 Tamil Nadu Civil Supplies Corporation. All rights reserved.</div>
    </div>
  );
}
