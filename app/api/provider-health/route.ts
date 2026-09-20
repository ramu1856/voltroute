import { env } from 'cloudflare:workers';
import { overpassEndpoints } from '@/lib/overpass';
import { type ProviderCheck, summarizeProviderHealth } from '@/lib/provider-health';

async function probeJson(endpoint: string, init?: RequestInit, timeoutMs = 9000) {
  const started = Date.now();
  try {
    const response = await fetch(endpoint, { ...(init || {}), signal: AbortSignal.timeout(timeoutMs) });
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
  const osrm = new URL('/nearest/v1/driving/-87.6298,41.8781', osrmBase);
  osrm.search = 'number=1';
  const osrmProbe = await probeJson(osrm.href);
  checks.push(statusFromResponse('osrm', 'Road routing (OSRM)', osrm.href, osrmProbe.response, osrmProbe.latencyMs));

  const query = '[out:json][timeout:8];node(41.87810,-87.62980,41.87825,-87.62965);out ids 1;';
  for (const endpoint of overpassEndpoints(settings)) {
    const probe = await probeJson(endpoint, {
      method: 'POST',
      body: new URLSearchParams({ data: query }),
      headers: { Accept: 'application/json' },
    });
    checks.push(statusFromResponse(`overpass:${new URL(endpoint).hostname}`, `Charger directory (${new URL(endpoint).hostname})`, endpoint, probe.response, probe.latencyMs));
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
