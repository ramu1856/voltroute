import { env } from 'cloudflare:workers';
import { overpassEndpoints } from '@/lib/overpass';
import { type ProviderCheck, summarizeProviderHealth } from '@/lib/provider-health';
import { WORKER_SITE_URL } from '@/lib/site-config';

async function probeJson(endpoint: string, init?: RequestInit, timeoutMs = 9000) {
  const started = Date.now();
  const headers = new Headers(init?.headers);
  if (!headers.has('Accept')) headers.set('Accept', 'application/json');
  if (!headers.has('User-Agent')) headers.set('User-Agent', 'VoltRoute/2.0 (+https://site-creator-vinext-starter.voltroutes.workers.dev)');
  try {
    const response = await fetch(endpoint, { ...(init || {}), headers, signal: AbortSignal.timeout(timeoutMs) });
    const latencyMs = Date.now() - started;
    return { response, latencyMs };
  } catch {
    return { response: null, latencyMs: Date.now() - started };
  }
}

function statusFromResponse(
  key: string,
  label: string,
  endpoint: string,
  response: Response | null,
  latencyMs: number,
): ProviderCheck {
  if (!response) {
    return {
      key,
      label,
      endpoint,
      state: 'down',
      latencyMs,
      detail: 'No response received before timeout.',
    };
  }
  if (response.ok) {
    return {
      key,
      label,
      endpoint,
      state: 'up',
      latencyMs,
      detail: 'Provider responded successfully.',
    };
  }
  if (response.status === 429 || response.status === 406 || response.status === 408) {
    return {
      key,
      label,
      endpoint,
      state: 'degraded',
      latencyMs,
      detail: `Provider is reachable but currently rate-limited or delayed (HTTP ${response.status}).`,
    };
  }
  return {
    key,
    label,
    endpoint,
    state: 'down',
    latencyMs,
    detail: `Provider returned HTTP ${response.status}.`,
  };
}

export async function GET() {
  const settings = env as unknown as Record<string, string | undefined>;
  const checks: ProviderCheck[] = [];

  const osrmBase = settings.OSRM_URL || 'https://router.project-osrm.org';
  const osrm = new URL('/route/v1/driving/-87.6298,41.8781;-87.6200,41.8850', osrmBase);
  osrm.search = 'overview=false&steps=false';
  const osrmProbe = await probeJson(osrm.href);
  checks.push(statusFromResponse('osrm', 'Road routing (OSRM)', osrm.href, osrmProbe.response, osrmProbe.latencyMs));

  const query = '[out:json][timeout:8];node(41.87810,-87.62980,41.87825,-87.62965);out ids 1;';
  for (const endpoint of overpassEndpoints(settings)) {
    const probe = await probeJson(endpoint, {
      method: 'POST',
      body: new URLSearchParams({ data: query }),
    });
    checks.push(statusFromResponse(`overpass:${new URL(endpoint).hostname}`, `Charger directory (${new URL(endpoint).hostname})`, endpoint, probe.response, probe.latencyMs));
  }
  const tomtomKey = settings.TOMTOM_API_KEY?.trim();
  if (tomtomKey) {
    const tomtom = new URL('/search/2/nearbySearch/.json', 'https://api.tomtom.com');
    tomtom.search = new URLSearchParams({
      key: tomtomKey,
      lat: '41.8781',
      lon: '-87.6298',
      radius: '2000',
      limit: '1',
      categorySet: '7309',
    }).toString();
    const tomtomProbe = await probeJson(tomtom.href, { headers: { Referer: settings.TOMTOM_REFERER?.trim() || WORKER_SITE_URL } });
    checks.push(statusFromResponse('tomtom', 'Live availability (TomTom)', tomtom.href, tomtomProbe.response, tomtomProbe.latencyMs));
  } else {
    checks.push({
      key: 'tomtom',
      label: 'Live availability (TomTom)',
      endpoint: 'https://api.tomtom.com/search/2/nearbySearch/.json',
      state: 'degraded',
      latencyMs: null,
      detail: 'TOMTOM_API_KEY is not configured.',
    });
  }

  return Response.json(
    {
      generatedAt: new Date().toISOString(),
      overall: summarizeProviderHealth(checks),
      checks,
    },
    { headers: { 'Cache-Control': 'private, no-store' } },
  );
}
