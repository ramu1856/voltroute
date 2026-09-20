import { ServiceError } from './service-error.ts';
import { WORKER_SITE_URL } from './site-config.ts';

export function tomtomReferers(settings: Record<string, string | undefined>) {
  return [...new Set([
    settings.TOMTOM_REFERER?.trim(),
    WORKER_SITE_URL,
    'https://voltroutes.com/',
  ].filter(Boolean) as string[])];
}

export async function fetchTomTomWithRefererFallback<T>(
  url: string,
  settings: Record<string, string | undefined>,
  init: RequestInit = {},
): Promise<{ data: T; referer: string }> {
  const referers = tomtomReferers(settings);
  let sawAuthError = false;
  let lastError: unknown = null;
  for (const referer of referers) {
    try {
      const headers = new Headers(init.headers);
      if (!headers.has('Accept')) headers.set('Accept', 'application/json');
      if (!headers.has('User-Agent')) headers.set('User-Agent', `VoltRoute/2.0 (+${WORKER_SITE_URL})`);
      headers.set('Referer', referer);
      const response = await fetch(url, { ...init, headers, signal: init.signal ?? AbortSignal.timeout(22000) });
      if (response.status === 401 || response.status === 403) {
        sawAuthError = true;
        continue;
      }
      if (response.status === 429) throw new ServiceError('TomTom provider is busy. Please retry shortly.', 429);
      if (!response.ok) throw new ServiceError(`TomTom provider is unavailable (${response.status}).`, 503);
      return { data: await response.json() as T, referer };
    } catch (error) {
      if (error instanceof ServiceError && error.status === 429) throw error;
      lastError = error;
    }
  }
  if (sawAuthError) throw new ServiceError('TomTom credentials or allowed referer are not accepted in this environment.', 401);
  if (lastError instanceof ServiceError) throw lastError;
  throw new ServiceError('TomTom provider did not respond. Please retry later.');
}
