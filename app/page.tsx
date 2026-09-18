import { env } from 'cloudflare:workers';
import VoltApp from '@/components/volt-app';
export const dynamic = 'force-dynamic';
export default function Home(){const settings=env as unknown as Record<string,string>;return <VoltApp supabaseUrl={settings.NEXT_PUBLIC_SUPABASE_URL||''} supabaseKey={settings.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY||''}/>;}
