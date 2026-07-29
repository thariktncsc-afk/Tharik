/**
 * Server-side Supabase client.
 *
 * Uses the secret / service_role key, which bypasses Row Level Security. It must
 * never reach the browser — importing this file from a client component is a
 * security bug, not a build error, so keep the import list short and obvious.
 *
 * Only route handlers under src/app/api/ should import this.
 */
import { createClient, type SupabaseClient } from '@supabase/supabase-js';

let client: SupabaseClient | null = null;

export function supabaseAdmin(): SupabaseClient {
  if (client) return client;

  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (!url || !key) {
    throw new Error(
      'Supabase is not configured. Copy .env.local.example to .env.local and fill in ' +
        'NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY (and set both in Vercel).',
    );
  }

  client = createClient(url, key, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  return client;
}

/** True when the env vars are present, so routes can fail with a clear message. */
export function supabaseConfigured(): boolean {
  return Boolean(process.env.NEXT_PUBLIC_SUPABASE_URL && process.env.SUPABASE_SERVICE_ROLE_KEY);
}
