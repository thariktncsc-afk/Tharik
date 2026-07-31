'use client';

import { useEffect, useState } from 'react';

/**
 * Sidebar toggle for the converted (React) routes — same behaviour and CSS
 * hooks as SidebarToggle.tsx on the legacy page (app-chrome.css positions
 * it), minus the login-screen MutationObserver: inside the (app) layout the
 * user is signed in by definition, so the button always renders.
 *
 *  - <=900px: off-canvas drawer (body.nav-open + backdrop)
 *  - >900px:  permanent column collapsing in place (body.sidebar-collapsed)
 */
export default function NavToggle() {
  const [mobileOpen, setMobileOpen] = useState(false);
  const [desktopCollapsed, setDesktopCollapsed] = useState(true);
  const [isDesktop, setIsDesktop] = useState(false);

  useEffect(() => {
    document.body.classList.toggle('nav-open', mobileOpen);
  }, [mobileOpen]);

  useEffect(() => {
    document.body.classList.toggle('sidebar-collapsed', desktopCollapsed);
  }, [desktopCollapsed]);

  // Leaving the (app) layout (e.g. signing out to /login) must not strand the
  // body classes — the login screen has no sidebar to un-collapse.
  useEffect(() => {
    return () => {
      document.body.classList.remove('nav-open', 'sidebar-collapsed');
    };
  }, []);

  useEffect(() => {
    const onClick = (e: MouseEvent) => {
      const target = e.target as HTMLElement | null;
      if (target?.closest('#sidebar .nav-item, #sidebar .sb-logout')) setMobileOpen(false);
    };
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setMobileOpen(false);
    };
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

  const toggle = () => {
    if (isDesktop) setDesktopCollapsed((v) => !v);
    else setMobileOpen((v) => !v);
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
