import { ServiceError } from './service-error.ts';

export type DirectorySnapshot<T> = { data: T; fetchedAt: string; stale: boolean; notice: string | null };
type CacheRow = { payload: string; expires: number };
type CacheIO<T> = {
  read: () => Promise<CacheRow | null>;
  write: (row: CacheRow) => Promise<unknown>;
  refresh: () => Promise<T>;
  now?: () => number;
};

// This fallback is for browsing directory listings only. Smart Stop continues
// to require its normal fresh directory lookup and never consumes stale data.
export async function loadDirectory<T>(io: CacheIO<T>): Promise<DirectorySnapshot<T>> {
  const now = io.now || Date.now;
  let saved: { data: T; fetchedAt: string } | null = null;
  try {
    const row = await io.read();
    if (row) {
      const parsed = JSON.parse(row.payload);
      const age = now() - Date.parse(parsed.fetchedAt);
      if (Array.isArray(parsed.data) && Number.isFinite(age) && age >= 0 && age <= 86400000) {
        saved = { data: parsed.data, fetchedAt: parsed.fetchedAt };
        if (row.expires > now() && age < 3600000) return { ...saved, stale: false, notice: null };
      }
    }
  } catch { /* A missing or unreadable cache must not block a valid lookup. */ }
  let data: T;
  try { data = await io.refresh(); }
  catch (error) {
    if (saved && error instanceof ServiceError && (error.status === 429 || error.status >= 500)) {
      return { ...saved, stale: true, notice: 'Using recently saved listings while live map data refreshes.' };
    }
    throw error;
  }
  const value = { data, fetchedAt: new Date(now()).toISOString() };
  try { await io.write({ payload: JSON.stringify(value), expires: now() + 3600000 }); }
  catch { /* Return successful provider data even if saving the cache failed. */ }
  return { ...value, stale: false, notice: null };
}
