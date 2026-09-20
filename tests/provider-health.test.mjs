import { test } from 'node:test';
import assert from 'node:assert/strict';
import { summarizeProviderHealth, healthStateLabel } from '../lib/provider-health.ts';

test('summarizeProviderHealth marks all-up checks as healthy', () => {
  const overall = summarizeProviderHealth([
    { key: 'a', label: 'A', endpoint: 'https://a', state: 'up', latencyMs: 120, detail: '' },
    { key: 'b', label: 'B', endpoint: 'https://b', state: 'up', latencyMs: 80, detail: '' },
  ]);
  assert.equal(overall, 'healthy');
});

test('summarizeProviderHealth marks mixed checks as degraded', () => {
  const overall = summarizeProviderHealth([
    { key: 'a', label: 'A', endpoint: 'https://a', state: 'up', latencyMs: 120, detail: '' },
    { key: 'b', label: 'B', endpoint: 'https://b', state: 'down', latencyMs: 80, detail: '' },
  ]);
  assert.equal(overall, 'degraded');
});

test('summarizeProviderHealth marks all-down checks as outage', () => {
  const overall = summarizeProviderHealth([
    { key: 'a', label: 'A', endpoint: 'https://a', state: 'down', latencyMs: 120, detail: '' },
  ]);
  assert.equal(overall, 'outage');
  assert.equal(healthStateLabel('up'), 'Operational');
  assert.equal(healthStateLabel('degraded'), 'Degraded');
  assert.equal(healthStateLabel('down'), 'Unavailable');
});
