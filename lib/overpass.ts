import type { OSMElement } from './ev.ts';
import { ServiceError } from './service-error.ts';

// Both operators publish global OSM coverage and allow use by small projects.
// Keep these independent: alternate hostnames of one service are not a backup.
export const directoryProviders = [
  'https://overpass-api.de/api/interpreter',
  'https://overpass.osm.ch/api/interpreter',
] as const;

export function overpassEndpoints(settings: Record<string, string | undefined>) {
  const first = settings.OVERPASS_URL || directoryProviders[0];
  const second = settings.OVERPASS_FALLBACK_URL || directoryProviders.find(url => url !== first)!;
  return [...new Set([first, second])];
}

type OverpassOptions = { endpoints?: string[]; fetcher?: typeof fetch; timeoutMs?: number };
function parseElements(value: unknown): OSMElement[] {
  const json = value as { elements?: OSMElement[]; remark?: unknown } | null;
  if (!json || json.remark || !Array.isArray(json.elements) || !json.elements.every(e =>
    e && ['node', 'way', 'relation'].includes(e.type) && Number.isSafeInteger(e.id) && e.id > 0 &&
    (e.lat === undefined || (Number.isFinite(e.lat) && e.lat >= -90 && e.lat <= 90)) &&
    (e.lon === undefined || (Number.isFinite(e.lon) && e.lon >= -180 && e.lon <= 180)) &&
    (!e.center || (Number.isFinite(e.center.lat) && Math.abs(e.center.lat) <= 90 && Number.isFinite(e.center.lon) && Math.abs(e.center.lon) <= 180)) &&
    (!e.tags || (typeof e.tags === 'object' && !Array.isArray(e.tags) && Object.values(e.tags).every(v => typeof v === 'string')))
  )) throw new Error('Incomplete map response');
  return json.elements;
}

export async function fetchOverpass(query: string, options: OverpassOptions = {}): Promise<OSMElement[]> {
  const endpoints = [...new Set(options.endpoints || directoryProviders)].slice(0, 2);
  for (const endpoint of endpoints) {
    try {
      const response = await (options.fetcher || fetch)(endpoint, {
        method: 'POST', body: new URLSearchParams({ data: query }),
        headers: { Accept: 'application/json', 'User-Agent': 'VoltRoute/2.0 (+https://voltroutes.com)' },
        signal: AbortSignal.timeout(options.timeoutMs ?? 24000),
      });
      // Do not rotate providers to work around access restrictions or quotas.
      if (response.status === 429 || response.status === 406) throw new ServiceError('The directory service is busy. Please wait at least 30 seconds before retrying.', 429);
      if (!response.ok && response.status !== 408 && response.status < 500) throw new ServiceError('The directory connection could not be used. Please try again later.', 502);
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      return parseElements(await response.json());
    } catch (error) {
      if (error instanceof ServiceError) throw error;
      // No coordinates, query text, credentials or provider response bodies in logs.
      console.warn('Directory provider unavailable', { host: new URL(endpoint).hostname, reason: error instanceof Error && /^HTTP \d{3}$/.test(error.message) ? error.message : 'timeout, network or incomplete response' });
    }
  }
  throw new ServiceError('Charging map listings could not be loaded from either directory connection. Please retry shortly. This does not mean there are no chargers in this area.');
}
