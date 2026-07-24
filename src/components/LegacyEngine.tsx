'use client';

import { useEffect } from 'react';

/** Built from src/legacy/*.js by tools/bundle-engine.mjs (predev / prebuild). */
const ENGINE_SRC = '/js/tncsc-engine.js';

declare global {
  interface Window {
    __TNCSC_ENGINE_LOADED__?: boolean;
  }
}

/**
 * Boots the application engine.
 *
 * It is loaded as a classic script rather than an ES module on purpose: every
 * function and `var` in it is a global that the markup's inline on* handlers
 * call by name, and the code hoists across its whole length. A module scope, or
 * splitting it across several scripts, breaks both.
 *
 * It is appended from an effect so the markup is already in the DOM when the
 * script's own init code runs (the Daily Entry CRS dropdown, the topbar date and
 * `buildCrsTable()` all reach for elements immediately).
 *
 * It goes into <head>, NOT <body>: in the App Router <body> is React's hydration
 * container, and with streaming, hydration is not necessarily finished when this
 * effect runs. Appending a node to <body> then drops it among children React is
 * still walking, which it reports as a hydration mismatch (it expects the
 * metadata Suspense boundary and finds this <script>). <head> is untouched by
 * that walk, and a script there behaves identically.
 */
export default function LegacyEngine() {
  useEffect(() => {
    // React Strict Mode runs effects twice in development; the engine is not
    // idempotent, so only ever boot it once per page load.
    if (window.__TNCSC_ENGINE_LOADED__) return;
    window.__TNCSC_ENGINE_LOADED__ = true;

    const el = document.createElement('script');
    el.src = ENGINE_SRC;
    el.async = false;
    document.head.appendChild(el);
  }, []);

  return null;
}
