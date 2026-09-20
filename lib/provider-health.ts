export type ProviderState = 'up' | 'degraded' | 'down';

export type ProviderCheck = {
  key: string;
  label: string;
  endpoint: string;
  state: ProviderState;
  latencyMs: number | null;
  detail: string;
};

export type ProviderHealthSnapshot = {
  generatedAt: string;
  overall: 'healthy' | 'degraded' | 'outage';
  checks: ProviderCheck[];
};

export function healthStateLabel(state: ProviderState) {
  if (state === 'up') return 'Operational';
  if (state === 'degraded') return 'Degraded';
  return 'Unavailable';
}

export function summarizeProviderHealth(checks: ProviderCheck[]): ProviderHealthSnapshot['overall'] {
  if (!checks.length) return 'outage';
  const operational = checks.filter(check => check.state === 'up').length;
  if (operational === checks.length) return 'healthy';
  if (operational > 0) return 'degraded';
  return 'outage';
}
