import type { OSMElement } from './ev.ts';
import { ServiceError } from './service-error.ts';
import { WORKER_SITE_URL } from './site-config.ts';

// Both operators publish global OSM coverage and allow use by small projects.
// Keep these independent: alternate hostnames of one service are not a backup.
export const directoryProviders = [
  'https://overpass-api.de/api/interpreter',
  'https://overpass.osm.ch/api/interpreter',
  'https://overpass.private.coffee/api/interpreter',
] as const;

export function overpassEndpoints(settings: Record<string, string | undefined>) {
  const first = settings.OVERPASS_URL?.trim() || directoryProviders[0];
  const secondConfigured = settings.OVERPASS_FALLBACK_URL?.trim();
  const thirdConfigured = settings.OVERPASS_SECONDARY_FALLBACK_URL?.trim();
  if (secondConfigured) {
    return [...new Set([first, secondConfigured, thirdConfigured].filter(Boolean) as string[])];
  }
  const second = directoryProviders.find(url => url !== first) || directoryProviders[0];
  const third = thirdConfigured || directoryProviders.find(url => url !== first && url !== second);
  return [...new Set([first, second, third].filter(Boolean) as string[])];
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
  const endpoints = [...new Set(options.endpoints || directoryProviders)].slice(0, 3);
  const canRetry = (error: unknown) => error instanceof TypeError || (error instanceof DOMException && error.name === 'TimeoutError');
  let sawBusyStatus = false;
  let sawSuccessfulEmptyResponse = false;
  for (const endpoint of endpoints) {
    for (let attempt = 0; attempt < 2; attempt++) {
      try {
        const response = await (options.fetcher || fetch)(endpoint, {
          method: 'POST', body: new URLSearchParams({ data: query }),
                headers: { Accept: 'application/json', 'User-Agent': `VoltRoute/2.0 (+${WORKER_SITE_URL})` },
          signal: AbortSignal.timeout(options.timeoutMs ?? 24000),
        });
        if (response.status === 429 || response.status === 406) {
          sawBusyStatus = true;
          break;
        }
        if (!response.ok && response.status !== 408 && response.status < 500) break;
        if (!response.ok) throw new Error(`HTTP ${response.status}`);
        const elements = parseElements(await response.json());
        if (elements.length > 0) return elements;
        sawSuccessfulEmptyResponse = true;
        break;
      } catch (error) {
        if (error instanceof ServiceError) {
          if (error.status === 429) sawBusyStatus = true;
          break;
        }
        if (attempt === 0 && canRetry(error)) continue;
        // No coordinates, query text, credentials or provider response bodies in logs.
        console.warn('Directory provider unavailable', { host: new URL(endpoint).hostname, reason: error instanceof Error && /^HTTP \d{3}$/.test(error.message) ? error.message : 'timeout, network or incomplete response' });
        break;
      }
    }
  }
  if (sawBusyStatus) throw new ServiceError('The charging directory is currently busy. Please retry in about 30 seconds.', 429);
  if (sawSuccessfulEmptyResponse) throw new ServiceError('No charging stations were confirmed by directory providers for this area right now. Try again shortly.', 503);
  throw new ServiceError('Charging map listings could not be loaded from any directory connection. Please retry shortly. This does not mean there are no chargers in this area.');
}
