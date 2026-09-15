'use client';

/**
 * Shell for the converted (React) routes: sidebar + topbar + content column.
 *
 * JSX port of src/markup/sidebar.ts + shellOpen.ts/shellClose.ts — same ids
 * (#sidebar, #main, #topbar, #content) and class names, so globals.css,
 * responsive.css and app-chrome.css style it exactly like the legacy shell.
 * Role-based nav visibility mirrors applyNavForRole() in 07-auth.js: ADMIN
 * sees everything, shop staff lose the admin-only entries.
 */
import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { useEffect, useState } from 'react';
import NavToggle from '@/components/NavToggle';
import { useAuth } from '@/lib/authClient';
import { crsData } from '@/lib/dataStore';
import NotificationBell from '@/components/NotificationBell';
import MessagePopup from '@/components/MessagePopup';
import { inbox } from '@/lib/notify/client';

const MENU = [
  { href: '/dashboard', icon: '📊', label: 'Dashboard' },
  { href: '/daily-entry', icon: '📋', label: 'Daily Entry' },
  { href: '/monthly-entry', icon: '📅', label: 'Monthly Entry' },
  { href: '/receipt', icon: '🧾', label: 'Receipt' },
  { href: '/crs', icon: '🏪', label: 'CRS Shops' },
  { href: '/commodities', icon: '📦', label: 'Commodities' },
  { href: '/statements', icon: '📄', label: 'Statements' },
  // Not admin-only: an admin sees the approval queue here, a shop user sees
  // their own download payments and can finish one they left half-done.
  { href: '/payments', icon: '💳', label: 'Payments' },
  { href: '/reports', icon: '📈', label: 'Reports' },
  // Not admin-only: an admin decides clear requests here, a shop user watches
  // its own and can withdraw one raised by mistake.
  { href: '/clear-requests', icon: '🔒', label: 'Clear Approvals' },
  // Everyone: an admin's approval traffic, a shop's messages and results.
  { href: '/notifications', icon: '🔔', label: 'Notifications' },
];
const ADMIN = [
  { href: '/messages', icon: '📣', label: 'Messages' },
  { href: '/pv-officers', icon: '🧑‍💼', label: 'PV Officers' },
  { href: '/users', icon: '👥', label: 'Users' },
  { href: '/settings', icon: '⚙️', label: 'Settings' },
  { href: '/audit', icon: '📜', label: 'Audit Logs' },
];
// Mirrors adminNavLabels in 07-auth.js — hidden from non-admin roles.
const ADMIN_ONLY = new Set(['CRS Shops', 'Commodities', 'Users', 'Settings', 'Audit Logs', 'Reports', 'PV Officers', 'Messages']);

function fmtDate(d: Date) {
  return d.toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' }).replace(/ /g, ' ');
}

export default function AppLayout({ children }: { children: React.ReactNode }) {
  const { status, user, logout } = useAuth();
  const pathname = usePathname();
  const router = useRouter();
  const [today, setToday] = useState('');

  useEffect(() => {
    setToday(fmtDate(new Date()));
  }, []);

  useEffect(() => {
    if (status === 'signedOut') router.replace('/login');
  }, [status, router]);

  // The data layer lives for as long as someone is signed in to the shell:
  // load everything once, then autosave dirty stores; flush on the way out.
  useEffect(() => {
    if (status !== 'signedIn') return;
    void crsData.load().then(() => crsData.start());
    return () => {
      void crsData.save({ keepalive: true });
      crsData.stop();
    };
  }, [status]);

  // Notifications poll for as long as someone is signed in — one timer for
  // the bell, the popup and the history page together. On the way out the
  // last person's inbox is forgotten, so whoever signs in next on the same
  // browser never sees somebody else's unread count for a moment.
  useEffect(() => {
    if (status !== 'signedIn') return;
    inbox.start();
    return () => {
      inbox.stop();
      inbox.reset();
    };
  }, [status]);

  if (status !== 'signedIn' || !user) {
    // Same look as the session-resume loader on the legacy page.
    return (
      <div
        style={{
          position: 'fixed',
          inset: 0,
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          justifyContent: 'center',
          gap: 18,
          background: 'linear-gradient(160deg,#0F2B52 0%,#123A6B 55%,#0B2545 100%)',
        }}
      >
        <div
          style={{
            width: 46,
            height: 46,
            borderRadius: '50%',
            border: '4px solid rgba(255,255,255,.18)',
            borderTopColor: '#7DD3FC',
            animation: 'crsResumeSpin .8s linear infinite',
          }}
        />
        <style>{'@keyframes crsResumeSpin{to{transform:rotate(360deg)}}'}</style>
        <div style={{ color: 'rgba(255,255,255,.85)', fontSize: 14, fontWeight: 600 }}>Signing you back in…</div>
      </div>
    );
  }

  const isAdmin = user.role === 'ADMIN';
  const visible = (label: string) => isAdmin || !ADMIN_ONLY.has(label);

  const navItem = (item: { href: string; icon: string; label: string }) => (
    <Link
      key={item.href}
      href={item.href}
      className={'nav-item' + (pathname.startsWith(item.href) ? ' active' : '')}
      style={{ display: visible(item.label) ? undefined : 'none', textDecoration: 'none' }}
    >
      <span className="nav-icon">{item.icon}</span> {item.label}
    </Link>
  );

  return (
    <>
      <div id="sidebar">
        <div className="sb-logo flex items-center">
          <div className="sb-logo-badge" style={{ background: '#fff', padding: 3 }}>
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src="/img/seal-of-tamil-nadu.svg"
              alt="Seal of Tamil Nadu"
              width={32}
              height={32}
              style={{ width: '100%', height: '100%', objectFit: 'contain', display: 'block' }}
            />
          </div>
          <div className="sb-logo-text">
            <p>TNCSC</p>
            <p>CRS Management</p>
          </div>
        </div>
        <nav className="sb-nav">
          <div className="sb-section">Menu</div>
          {MENU.map(navItem)}
          <div className="sb-section" style={{ display: isAdmin ? undefined : 'none' }}>
            Admin
          </div>
          {ADMIN.map(navItem)}
        </nav>
        <div className="sb-user">
          <div className="flex items-center gap-2">
            <div className="sb-avatar">{(user.fullName || 'U').charAt(0).toUpperCase()}</div>
            <div>
              <div className="sb-uname">{user.fullName}</div>
              <div className="sb-urole">{user.role}</div>
            </div>
          </div>
          <button
            className="sb-logout"
            onClick={() => {
              void logout().then(() => router.replace('/login'));
            }}
          >
            ⬡ Sign out
          </button>
        </div>
      </div>
      <NavToggle />
      <div id="main">
        <div id="topbar">
          <div>
            <div className="topbar-title">
              <strong>Tamil Nadu Civil Supplies Corporation</strong>
            </div>
            <div className="topbar-title" style={{ fontSize: 11 }}>
              CRS Statement Management System · Madurai Region
            </div>
          </div>
          <div className="topbar-right" style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <NotificationBell />
            <div className="tb-date">{today}</div>
          </div>
        </div>
        <div id="content">{children}</div>
      </div>
      {/* Important and urgent messages, in front of everything until acknowledged. */}
      <MessagePopup />
    </>
  );
}
