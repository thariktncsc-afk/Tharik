'use client';

import { useEffect, useState } from 'react';

/**
 * Off-canvas navigation for the drawer breakpoint (<=900px).
 *
 * The sidebar itself is ported markup owned by the engine, so this component
 * does not touch it — it only renders the toggle and the backdrop, and puts a
 * `nav-open` class on <body> for responsive.css to react to.
 *
 * The toggle stays hidden until someone is signed in. Login state lives in the
 * engine, which marks the login screen with a `hidden` class, so a
 * MutationObserver on that class is the way to read it from React.
 */
export default function MobileNav() {
  const [open, setOpen] = useState(false);
  const [signedIn, setSignedIn] = useState(false);

  useEffect(() => {
    document.body.classList.toggle('nav-open', open);
  }, [open]);

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
    // Picking a destination (or signing out) should dismiss the drawer. The nav
    // items carry inline onclick handlers, so this listens rather than binds.
    const onClick = (e: MouseEvent) => {
      const target = e.target as HTMLElement | null;
      if (target?.closest('#sidebar .nav-item, #sidebar .sb-logout')) setOpen(false);
    };
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpen(false);
    };
    // Back on a wide screen the sidebar is permanent again; a stale open state
    // would leave the backdrop armed.
    const onResize = () => {
      if (window.innerWidth > 900) setOpen(false);
    };

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

  return (
    <>
      <button
        type="button"
        className="mnav-toggle"
        aria-label={open ? 'Close navigation' : 'Open navigation'}
        aria-expanded={open}
        aria-controls="sidebar"
        onClick={() => setOpen((v) => !v)}
      >
        {open ? '✕' : '☰'}
      </button>
      <div className="mnav-backdrop" onClick={() => setOpen(false)} />
    </>
  );
}
