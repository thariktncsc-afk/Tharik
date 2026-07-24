import type { Metadata } from 'next';
import './globals.css';
import './responsive.css';

export const metadata: Metadata = {
  title: 'TNCSC CRS Statement Management System',
  description:
    'Tamil Nadu Civil Supplies Corporation — CRS daily/monthly entry, statement generation and reporting.',
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
