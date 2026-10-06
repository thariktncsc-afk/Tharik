/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  // Metadata here is entirely static (layout.tsx exports plain strings), but
  // Next 16 still streams it through a Suspense outlet at the end of <body> —
  // and in dev its own overlay <script> races React to that slot, which React
  // reports as a recoverable hydration mismatch on every load. Matching every
  // UA here opts all requests into blocking metadata, which this app loses
  // nothing by, and removes the outlet the overlay collides with.
  htmlLimitedBots: /.*/,
  // The statements PDF (/api/statements/pdf) runs headless Chrome. Neither
  // package may be bundled — @sparticuz/chromium reads its compressed Chrome
  // from its own folder at run time — and that folder must be shipped with
  // the function, which file tracing cannot see on its own.
  serverExternalPackages: ['@sparticuz/chromium', 'puppeteer-core'],
  outputFileTracingIncludes: {
    '/api/statements/pdf': ['./node_modules/@sparticuz/chromium/bin/**'],
    // The PV download (one shop's PV per call) draws with the same Chrome.
    '/api/pv/pdf': ['./node_modules/@sparticuz/chromium/bin/**', './node_modules/pdfjs-dist/standard_fonts/LiberationSans-*.ttf'],
  },
  // The legacy engine is served as classic scripts from /public/js and must not
  // be cached across a rebuild during development.
  async headers() {
    return [
      {
        source: '/js/:path*',
        headers: [
          { key: 'Cache-Control', value: 'no-cache, no-store, must-revalidate' },
        ],
      },
    ];
  },
};

export default nextConfig;
