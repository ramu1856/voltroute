import { createClient } from '@supabase/supabase-js';

let browserClient: ReturnType<typeof createClient> | null = null;

export function supabaseBrowser(config?: { url?: string; key?: string }) {
  if (browserClient) return browserClient;
  const url = config?.url || process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = config?.key || process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;
  if (!url || !key) throw new Error('Account sign-in is not configured yet.');
  browserClient = createClient(url, key, {
    auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true },
  });
  return browserClient;
}
