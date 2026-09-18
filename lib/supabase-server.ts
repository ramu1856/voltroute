import { createClient } from '@supabase/supabase-js';
import { env } from 'cloudflare:workers';
import { ServiceError } from './service-error.ts';

export type VoltUser = { userId: string; displayName: string; email: string };

export async function getOptionalUser(request: Request): Promise<VoltUser | null> {
  const authorization = request.headers.get('authorization');
  if (!authorization?.startsWith('Bearer ')) return null;
  const token = authorization.slice(7).trim();
  if (!token) return null;
  const settings = env as unknown as Record<string,string>;
  const url = settings.NEXT_PUBLIC_SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = settings.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY || process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;
  if (!url || !key) throw new ServiceError('Account sign-in is temporarily unavailable.', 503);
  const client = createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } });
  const { data, error } = await client.auth.getUser(token);
  if (error || !data.user) return null;
  const email = data.user.email || '';
  const phone = data.user.phone || '';
  return { userId: data.user.id, displayName: email || phone || 'VoltRoute user', email };
}

export async function requireSupabaseUser(request: Request) {
  const user = await getOptionalUser(request);
  if (!user) throw new ServiceError('Sign in to save vehicles, trips and station reports.', 401);
  return user;
}
