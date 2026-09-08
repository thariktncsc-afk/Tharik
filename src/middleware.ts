/**
 * Route guard for the converted (React) pages.
 *
 * Presence-only check: the HttpOnly session cookie cannot be validated here
 * (its HMAC uses node:crypto, unavailable in the edge runtime), and does not
 * need to be — every API route re-validates it. This just keeps the UX right:
 * signed-out users land on /login, signed-in users skip it.
 *
 * The legacy single-page app at `/` is deliberately not matched — it has its
 * own login flow and stays fully usable during the conversion.
 */
import { NextResponse, type NextRequest } from 'next/server';

const APP_PATHS = [
  '/dashboard',
  '/daily-entry',
  '/monthly-entry',
  '/receipt',
  '/crs',
  '/commodities',
  '/statements',
  '/payments',
  '/reports',
  '/clear-requests',
  '/users',
  '/settings',
  '/audit',
];

export function middleware(req: NextRequest) {
  const signedIn = req.cookies.has('crs_session');
  const { pathname } = req.nextUrl;

  if (!signedIn && APP_PATHS.some((p) => pathname === p || pathname.startsWith(p + '/'))) {
    const url = req.nextUrl.clone();
    url.pathname = '/login';
    return NextResponse.redirect(url);
  }
  if (signedIn && pathname === '/login') {
    const url = req.nextUrl.clone();
    url.pathname = '/dashboard';
    return NextResponse.redirect(url);
  }
  return NextResponse.next();
}

export const config = {
  matcher: [
    '/login',
    '/dashboard/:path*',
    '/daily-entry/:path*',
    '/monthly-entry/:path*',
    '/receipt/:path*',
    '/crs/:path*',
    '/commodities/:path*',
    '/statements/:path*',
    '/payments/:path*',
    '/reports/:path*',
    '/clear-requests/:path*',
    '/users/:path*',
    '/settings/:path*',
    '/audit/:path*',
  ],
};
