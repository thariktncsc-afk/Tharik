'use client';

import { useEffect, useState } from 'react';

/**
 * The one hamburger control for both sidebar behaviors, collapsed/closed by
 * default in both:
 *  - <=900px (drawer breakpoint): off-canvas overlay.
 *  - >900px (desktop): permanent column that collapses to width 0 in place.
 *
 * It renders as a body-level sibling rather than living inside #sidebar
 * itself, which is what lets it keep working after a desktop collapse — a
 * button nested inside #sidebar would disappear along with the rest of the
 * sidebar once that box hits width:0, leaving no way back in.
 * app-chrome.css positions it near the sidebar logo when the sidebar is open
 * and shifts it to the left edge of the top bar once collapsed.
 *
 * The toggle stays hidden until someone is signed in. Login state lives in
 * the engine, which marks the login screen with a `hidden` class, so a
 * MutationObserver on that class is the way to read it from React.
 */
export default function SidebarToggle() {
  const [mobileOpen, setMobileOpen] = useState(false);
  const [desktopCollapsed, setDesktopCollapsed] = useState(true);
  const [isDesktop, setIsDesktop] = useState(false);
  const [signedIn, setSignedIn] = useState(false);

  useEffect(() => {
    document.body.classList.toggle('nav-open', mobileOpen);
  }, [mobileOpen]);

  useEffect(() => {
    document.body.classList.toggle('sidebar-collapsed', desktopCollapsed);
  }, [desktopCollapsed]);

  useEffect(() => {
    const loginScreen = document.getElementById('login-screen');
    if (!loginScreen) return;

    const read = () => setSignedIn(loginScreen.classList.contains('hidden'));
    read();

    const observer = new MutationObserver(read);
    observer.observe(loginScreen, { attributes: true, attributeFilter: ['class'] });
    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    // Picking a destination (or signing out) should dismiss the drawer. The
    // nav items carry inline onclick handlers, so this listens rather than
    // binds. Desktop collapse is untouched here — only the mobile spec asks
    // for a nav click to close the sidebar.
    const onClick = (e: MouseEvent) => {
      const target = e.target as HTMLElement | null;
      if (target?.closest('#sidebar .nav-item, #sidebar .sb-logout')) setMobileOpen(false);
    };
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setMobileOpen(false);
    };
    // Crossing the breakpoint should drop whichever state belongs to the side
    // just left back to ITS OWN default (collapsed/closed) — a stale nav-open
    // drawer would leave the backdrop armed on a wide screen, and a stale
    // expanded desktop state would contradict "collapsed by default" the next
    // time the screen is wide again.
    const onResize = () => {
      const desktop = window.innerWidth > 900;
      setIsDesktop(desktop);
      if (desktop) setMobileOpen(false);
      else setDesktopCollapsed(true);
    };

    onResize();
    document.addEventListener('click', onClick);
    document.addEventListener('keydown', onKeyDown);
    window.addEventListener('resize', onResize);
    return () => {
      document.removeEventListener('click', onClick);
      document.removeEventListener('keydown', onKeyDown);
      window.removeEventListener('resize', onResize);
    };
  }, []);

  if (!signedIn) return null;

  const toggle = () => {
    if (isDesktop) {
      setDesktopCollapsed((v) => !v);
    } else {
      setMobileOpen((v) => !v);
    }
  };
  const sidebarVisible = isDesktop ? !desktopCollapsed : mobileOpen;

  return (
    <>
      <button
        type="button"
        className="mnav-toggle"
        aria-label={sidebarVisible ? 'Collapse navigation' : 'Expand navigation'}
        aria-expanded={sidebarVisible}
        aria-controls="sidebar"
        onClick={toggle}
      >
        {mobileOpen ? '✕' : '☰'}
      </button>
      <div className="mnav-backdrop" onClick={() => setMobileOpen(false)} />
    </>
  );
}
