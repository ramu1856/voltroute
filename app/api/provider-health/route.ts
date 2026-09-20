import { env } from 'cloudflare:workers';
import { overpassEndpoints } from '@/lib/overpass';
import { type ProviderCheck, summarizeProviderHealth } from '@/lib/provider-health';
import { ServiceError } from '@/lib/service-error';
import { fetchTomTomWithRefererFallback } from '@/lib/tomtom-fetch';

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
  const overpassEndpointChecks: ProviderCheck[] = [];
  for (const endpoint of overpassEndpoints(settings)) {
    const probe = await probeJson(endpoint, {
      method: 'POST',
      body: new URLSearchParams({ data: query }),
    });
    overpassEndpointChecks.push(statusFromResponse(`overpass:${new URL(endpoint).hostname}`, `Charger directory (${new URL(endpoint).hostname})`, endpoint, probe.response, probe.latencyMs));
  }
  const overpassUp = overpassEndpointChecks.filter(check => check.state === 'up').length;
  const overpassDegraded = overpassEndpointChecks.filter(check => check.state === 'degraded').length;
  const overpassState = overpassUp > 0 ? 'up' : overpassDegraded > 0 ? 'degraded' : 'down';
  const overpassLatency = overpassEndpointChecks.filter(check => check.latencyMs !== null).map(check => check.latencyMs || 0);
  const overpassAverageLatency = overpassLatency.length ? Math.round(overpassLatency.reduce((sum, value) => sum + value, 0) / overpassLatency.length) : null;
  checks.push({
    key: 'overpass-pool',
    label: 'Charger directory (Overpass pool)',
    endpoint: 'https://overpass-api.de/api/interpreter',
    state: overpassState,
    latencyMs: overpassAverageLatency,
    detail: `${overpassUp}/${overpassEndpointChecks.length} directory endpoints are operational. Individual endpoint issues are handled by failover.`,
  });

  const tomtomKey = settings.TOMTOM_API_KEY?.trim();
  const tomtomEndpoint = 'https://api.tomtom.com/search/2/nearbySearch/.json';
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
    const startedAt = Date.now();
    try {
      const probe = await fetchTomTomWithRefererFallback(tomtom.href, settings);
      checks.push({
        key: 'tomtom',
        label: 'Live availability (TomTom)',
        endpoint: tomtomEndpoint,
        state: 'up',
        latencyMs: Date.now() - startedAt,
        detail: `Provider responded successfully (Referer accepted: ${new URL(probe.referer).hostname}).`,
      });
    } catch (error) {
      if (error instanceof ServiceError && error.status === 401) {
        checks.push({
          key: 'tomtom',
          label: 'Live availability (TomTom)',
          endpoint: tomtomEndpoint,
          state: 'degraded',
          latencyMs: Date.now() - startedAt,
          detail: 'TomTom key or allowed referrer rejected the request. Update TOMTOM_API_KEY or TOMTOM_REFERER settings.',
        });
      } else if (error instanceof ServiceError && error.status === 429) {
        checks.push({
          key: 'tomtom',
          label: 'Live availability (TomTom)',
          endpoint: tomtomEndpoint,
          state: 'degraded',
          latencyMs: Date.now() - startedAt,
          detail: 'TomTom provider is rate-limited right now. Retry shortly.',
        });
      } else {
        checks.push({
          key: 'tomtom',
          label: 'Live availability (TomTom)',
          endpoint: tomtomEndpoint,
          state: 'down',
          latencyMs: Date.now() - startedAt,
          detail: 'TomTom provider did not respond.',
        });
      }
    }
  } else {
    checks.push({
      key: 'tomtom',
      label: 'Live availability (TomTom)',
      endpoint: tomtomEndpoint,
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
