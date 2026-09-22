import { env } from 'cloudflare:workers';
import { WORKER_SITE_ORIGIN } from '@/lib/site-config';

type D1State = {
  bound: boolean;
  readable: boolean;
  writable: boolean;
  detail: string;
  persistenceCounter?: number;
};

async function checkD1(db: D1Database | undefined, deep: boolean): Promise<D1State> {
  if (!db) {
    return { bound: false, readable: false, writable: false, detail: 'D1 binding is missing.' };
  }
  try {
    await db.prepare('SELECT 1 AS ok').first();
  } catch (error) {
    return {
      bound: true,
      readable: false,
      writable: false,
      detail: `D1 read probe failed: ${error instanceof Error ? error.message : 'unknown error'}`,
    };
  }
  if (!deep) {
    return { bound: true, readable: true, writable: false, detail: 'D1 read probe passed. Add ?deep=1 for write/read persistence probe.' };
  }
  const probeKey = 'health:persistence-probe';
  const probeTtlMs = 30 * 24 * 60 * 60 * 1000;
  try {
    const previous = await db.prepare('SELECT payload FROM provider_cache WHERE key=?').bind(probeKey).first<{ payload: string }>();
    let previousCount = 0;
    if (previous?.payload) {
      try {
        const parsed = JSON.parse(previous.payload) as { count?: unknown };
        previousCount = typeof parsed.count === 'number' && Number.isFinite(parsed.count) ? parsed.count : 0;
      } catch {
        previousCount = 0;
      }
    }
    const nextCount = previousCount + 1;
    const payload = JSON.stringify({ count: nextCount, checkedAt: new Date().toISOString(), source: 'api-health' });
    await db.prepare(
      'INSERT INTO provider_cache(key,payload,expires) VALUES(?,?,?) ON CONFLICT(key) DO UPDATE SET payload=excluded.payload,expires=excluded.expires',
    ).bind(probeKey, payload, Date.now() + probeTtlMs).run();
    const readback = await db.prepare('SELECT payload FROM provider_cache WHERE key=?').bind(probeKey).first<{ payload: string }>();
    const writable = readback?.payload === payload;
    return {
      bound: true,
      readable: true,
      writable,
      persistenceCounter: nextCount,
      detail: writable
        ? `D1 write/read probe passed. Persistent counter is now ${nextCount}.`
        : 'D1 write/read probe did not return the expected payload.',
    };
  } catch (error) {
    return {
      bound: true,
      readable: true,
      writable: false,
      detail: `D1 deep probe failed: ${error instanceof Error ? error.message : 'unknown error'}`,
    };
  }
}

export async function GET(request: Request) {
  const startedAt = Date.now();
  const query = new URL(request.url).searchParams;
  const deep = query.get('deep') === '1';
  const settings = env as unknown as Record<string, string | undefined> & { DB?: D1Database };
  const d1 = await checkD1(settings.DB, deep);
  const supabaseConfigured = Boolean(settings.NEXT_PUBLIC_SUPABASE_URL?.trim() && settings.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY?.trim());
  const tomtomConfigured = Boolean(settings.TOMTOM_API_KEY?.trim());

  const healthy = d1.bound && d1.readable && (deep ? d1.writable : true);
  return Response.json({
    status: healthy ? 'ok' : 'degraded',
    generatedAt: new Date().toISOString(),
    latencyMs: Date.now() - startedAt,
    siteOrigin: WORKER_SITE_ORIGIN,
    runtime: {
      worker: 'site-creator-vinext-starter',
      mode: deep ? 'deep' : 'basic',
    },
    config: {
      supabaseConfigured,
      tomtomConfigured,
    },
    d1,
  }, { headers: { 'Cache-Control': 'private, no-store' } });
}
