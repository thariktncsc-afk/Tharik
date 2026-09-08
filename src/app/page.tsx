import { redirect } from 'next/navigation';

/**
 * The classic single-page app used to be served here, alongside the React
 * routes, during the conversion. Every screen now has a React implementation
 * under src/app/(app)/, so `/` is just the way in.
 *
 * Signed-out visitors are bounced on to /login by middleware.ts, which does not
 * match `/` itself — so this redirect is what puts them in front of it.
 */
export default function Home() {
  redirect('/dashboard');
}
