import { test } from 'node:test';
import assert from 'node:assert/strict';
import { predictWaitForecast, waitWindowLabel } from '../lib/wait-forecast.ts';

test('live free ports produce a low wait prediction', () => {
  const forecast = predictWaitForecast({
    freshness: 'live',
    condition: 'available',
    label: 'Live',
    detail: '',
    source: 'Operator',
    sourceUrl: null,
    observedAt: null,
    ageMs: 1000,
    availablePorts: 2,
    totalPorts: 4,
  });
  assert.equal(forecast.state, 'predicted');
  assert.equal(forecast.minMinutes, 0);
  assert.ok(forecast.maxMinutes > 0);
  assert.match(waitWindowLabel(forecast), /min/);
});

test('live busy ports produce a queue estimate', () => {
  const forecast = predictWaitForecast({
    freshness: 'live',
    condition: 'busy',
    label: 'Live busy',
    detail: '',
    source: 'Operator',
    sourceUrl: null,
    observedAt: null,
    ageMs: 120000,
    availablePorts: 0,
    totalPorts: 6,
  });
  assert.equal(forecast.state, 'predicted');
  assert.ok(forecast.minMinutes >= 5);
  assert.ok(forecast.maxMinutes > forecast.minMinutes);
});

test('recent status stays uncertain and unknown data stays unavailable', () => {
  const recent = predictWaitForecast({
    freshness: 'recent',
    condition: 'working',
    label: 'Recent',
    detail: '',
    source: 'Operator',
    sourceUrl: null,
    observedAt: null,
    ageMs: 1200000,
    availablePorts: null,
    totalPorts: null,
  });
  assert.equal(recent.state, 'uncertain');
  const unknown = predictWaitForecast({
    freshness: 'unknown',
    condition: 'unknown',
    label: 'Unknown',
    detail: '',
    source: 'None',
    sourceUrl: null,
    observedAt: null,
    ageMs: null,
    availablePorts: null,
    totalPorts: null,
  });
  assert.equal(unknown.state, 'unavailable');
  assert.equal(waitWindowLabel(unknown), 'Wait time unavailable');
});
