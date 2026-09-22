export const WORKER_SITE_ORIGIN = 'https://site-creator-vinext-starter.voltroutes.workers.dev';
export const WORKER_SITE_URL = `${WORKER_SITE_ORIGIN}/`;
// Use the homepage as OAuth return target to avoid callback-route conflicts.
export const WORKER_AUTH_CALLBACK_URL = WORKER_SITE_URL;

export function isLocalhostOrigin(origin: string) {
  return /^https?:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/i.test(origin);
}
