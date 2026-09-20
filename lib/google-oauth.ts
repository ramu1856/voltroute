import { supabaseBrowser } from './supabase-client';
import { WORKER_AUTH_CALLBACK_URL, WORKER_SITE_ORIGIN, isLocalhostOrigin } from './site-config';

type GoogleOAuthConfig = { supabaseUrl: string; supabaseKey: string };

export async function startGoogleOAuthSignIn({ supabaseUrl, supabaseKey }: GoogleOAuthConfig) {
  const currentOrigin = typeof window !== 'undefined' ? window.location.origin : '';
  const localNotice = currentOrigin && isLocalhostOrigin(currentOrigin)
    ? `Localhost testing detected. Production users should sign in from ${WORKER_SITE_ORIGIN}.`
    : null;
  const client = supabaseBrowser({ url: supabaseUrl, key: supabaseKey });
  const { data, error } = await client.auth.signInWithOAuth({
    provider: 'google',
    options: {
      redirectTo: WORKER_AUTH_CALLBACK_URL,
      scopes: 'openid email profile',
      queryParams: { prompt: 'consent select_account', access_type: 'offline' },
      skipBrowserRedirect: true,
    },
  });
  if (error) throw error;
  if (!data?.url) throw new Error('Google sign-in could not be started. Please retry.');
  window.location.assign(data.url);
  return { localNotice };
}
