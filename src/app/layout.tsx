import type { Metadata } from 'next';
import './globals.css';
import './responsive.css';
import './dashboard-marquee.css';
import './app-chrome.css';

export const metadata: Metadata = {
  title: 'TNCSC CRS Statement Management System',
  description:
    'Tamil Nadu Civil Supplies Corporation — CRS daily/monthly entry, statement generation and reporting.',
  // Favicon: the Seal of Tamil Nadu, rasterized from the 681 KB source SVG
  // into per-size PNGs (a vector that heavy must not be fetched per tab).
  // src/app/favicon.ico (16+32+48) is also served automatically at
  // /favicon.ico for bookmarks, history and anything that requests the
  // classic path directly.
  icons: {
    icon: [
      { url: '/img/favicons/favicon-16.png', sizes: '16x16', type: 'image/png' },
      { url: '/img/favicons/favicon-32.png', sizes: '32x32', type: 'image/png' },
      { url: '/img/favicons/favicon-48.png', sizes: '48x48', type: 'image/png' },
    ],
    apple: [{ url: '/img/favicons/apple-touch-icon.png', sizes: '180x180', type: 'image/png' }],
    shortcut: ['/favicon.ico'],
  },
  other: {
    'Cache-Control': 'no-cache, no-store, must-revalidate',
    Pragma: 'no-cache',
    Expires: '0',
  },
};

export const viewport = {
  width: 'device-width',
  initialScale: 1,
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    // suppressHydrationWarning covers attributes browser extensions write onto
    // <body> before React loads (Grammarly, ColorZilla's cz-shortcut-listen and
    // friends). It applies to this element's own attributes only, so genuine
    // mismatches inside the app are still reported.
    <html lang="en">
      <body suppressHydrationWarning>{children}</body>
    </html>
  );
}
