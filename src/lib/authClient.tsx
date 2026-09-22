'use client';

/**
 * Client-side auth state for the converted (React) routes.
 *
 * The server is the authority: sign-in is POST /api/session (which sets the
 * HttpOnly cookie), resume is GET /api/session, sign-out is DELETE. This
 * context only mirrors that state so layouts and pages can render without
 * each doing their own fetch. The legacy app at `/` keeps its own flow — the
 * two share the cookie, so a sign-in on either side is a sign-in on both.
 */
import { createContext, useCallback, useContext, useEffect, useState } from 'react';

export type EngineUser = {
  id: number;
  fullName: string;
  username: string;
  phone: string;
  email: string;
  role: string;
  crsId: number | null;
  active: boolean;
};

export type LoginResult =
  | { ok: true; user: EngineUser }
  | { ok: false; needsRole: true; candidates: EngineUser[] }
  | { ok: false; error: string };

type AuthState = {
  /** 'checking' until GET /api/session answers once. */
  status: 'checking' | 'signedIn' | 'signedOut';
  user: EngineUser | null;
  login: (username: string, password: string, userId?: number) => Promise<LoginResult>;
  logout: () => Promise<void>;
};

const AuthContext = createContext<AuthState | null>(null);

/**
 * How long a sign-in waits for the server before saying so. Generous: a
 * phone on a weak signal reaching a server that was idle can take several
 * seconds, and a real answer that arrives late is still better than none.
 */
export const SIGN_IN_TIMEOUT_MS = 20_000;

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [status, setStatus] = useState<AuthState['status']>('checking');
  const [user, setUser] = useState<EngineUser | null>(null);

  useEffect(() => {
    let alive = true;
    fetch('/api/session', { headers: { Accept: 'application/json' } })
      .then((r) => (r.ok ? r.json() : null))
      .then((body) => {
        if (!alive) return;
        if (body?.user) {
          setUser(body.user);
          setStatus('signedIn');
        } else {
          setStatus('signedOut');
        }
      })
      .catch(() => {
        if (alive) setStatus('signedOut');
      });
    return () => {
      alive = false;
    };
  }, []);

  const login = useCallback(async (username: string, password: string, userId?: number): Promise<LoginResult> => {
    // A sign-in that gets no answer must not leave the button on "Connecting…"
    // for ever (a CRS 17 clerk on a phone, 2026-09-22, gave up and closed the
    // tab). The request is abandoned after SIGN_IN_TIMEOUT_MS and the person
    // is told to try again — nothing is half-done by abandoning it: the server
    // issues its cookie only in the answer, which never reached this page.
    const ctl = new AbortController();
    const timer = setTimeout(() => ctl.abort(), SIGN_IN_TIMEOUT_MS);
    let r: Response;
    let body: Record<string, unknown> & { user?: EngineUser; candidates?: EngineUser[]; needsRole?: boolean; error?: string };
    try {
      r = await fetch('/api/session', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(userId != null ? { username, password, userId } : { username, password }),
        signal: ctl.signal,
      });
      body = await r.json().catch(() => ({}));
    } catch {
      return {
        ok: false,
        error: ctl.signal.aborted
          ? 'The server is taking too long to answer. Please check your connection and press Sign In again.'
          : 'Could not reach the server — sign-in needs the database.',
      };
    } finally {
      clearTimeout(timer);
    }
    if (r.ok && body?.needsRole) {
      return { ok: false, needsRole: true, candidates: body.candidates ?? [] };
    }
    if (r.ok && body?.user) {
      setUser(body.user);
      setStatus('signedIn');
      return { ok: true, user: body.user };
    }
    return { ok: false, error: body?.error || `Sign-in failed (${r.status}).` };
  }, []);

  const logout = useCallback(async () => {
    try {
      await fetch('/api/session', { method: 'DELETE', keepalive: true });
    } catch {
      /* the cookie may outlive a network blip; the middleware still guards */
    }
    setUser(null);
    setStatus('signedOut');
  }, []);

  return <AuthContext.Provider value={{ status, user, login, logout }}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthState {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used inside <AuthProvider>');
  return ctx;
}
