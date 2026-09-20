import type { Metadata } from 'next';
import Script from 'next/script';
import { AuthProvider } from '@/lib/authClient';
import DialogHost from '@/components/dialog';
import SaveSuccessHost from '@/components/SaveSuccess';
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

// Microsoft Clarity. Off unless the project id is set, so local dev and any
// deploy without it load nothing.
const CLARITY_ID = process.env.NEXT_PUBLIC_CLARITY_ID?.trim();

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
    //
    // data-clarity-mask masks every piece of text and every input in Clarity's
    // recordings. The screens show stock figures, staff names, phone numbers
    // and payment UTRs, none of which should reach a third party; clicks,
    // scrolling and heatmaps still work with the text masked.
    <html lang="en">
      <body suppressHydrationWarning data-clarity-mask="True">
        <AuthProvider>{children}</AuthProvider>
        <DialogHost />
        <SaveSuccessHost />
        {CLARITY_ID && /^[a-z0-9]+$/i.test(CLARITY_ID) ? (
          <Script id="ms-clarity" strategy="afterInteractive">
            {`(function(c,l,a,r,i,t,y){c[a]=c[a]||function(){(c[a].q=c[a].q||[]).push(arguments)};t=l.createElement(r);t.async=1;t.src="https://www.clarity.ms/tag/"+i;y=l.getElementsByTagName(r)[0];y.parentNode.insertBefore(t,y);})(window,document,"clarity","script",${JSON.stringify(CLARITY_ID)});`}
          </Script>
        ) : null}
      </body>
    </html>
  );
}
