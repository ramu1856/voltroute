import test from 'node:test';
import assert from 'node:assert/strict';
import { chargingConfidence } from '../lib/charging-confidence.ts';

const now = Date.parse('2026-01-01T12:00:00Z');
const observation = (overrides = {}) => ({ freshness: 'live', condition: 'available', label: 'Available', detail: '', source: 'Test operator', sourceUrl: 'https://example.com', observedAt: new Date(now - 60_000).toISOString(), ageMs: 60_000, availablePorts: 2, totalPorts: 8, ...overrides });
const level = (overrides = {}, clock = now) => chargingConfidence(observation(overrides), clock).level;

test('live consistent positive counts produce high confidence, not a probability', () => {
  const result = chargingConfidence(observation(), now);
  assert.equal(result.level, 'high'); assert.equal(result.ports, '2/8 ports reported available'); assert.equal('score' in result, false);
});
test('unknown evidence remains unknown', () => assert.equal(level({ freshness: 'unknown' }), 'unknown'));
test('missing timestamps stay unknown', () => assert.equal(level({ observedAt: null }), 'unknown'));
test('invalid timestamps stay unknown', () => assert.equal(level({ observedAt: 'invalid' }), 'unknown'));
test('future timestamps stay unknown', () => assert.equal(level({ observedAt: new Date(now + 1).toISOString() }), 'unknown'));
test('invalid clock stays unknown', () => assert.equal(level({}, NaN), 'unknown'));
test('live ages into medium after five minutes', () => assert.equal(level({}, now + 5 * 60_000), 'medium'));
test('positive evidence expires after thirty minutes', () => assert.equal(level({}, now + 30 * 60_000), 'unknown'));
test('exact age boundaries', () => {
  assert.equal(level({}, now + 4 * 60_000), 'high');
  assert.equal(level({}, now + 29 * 60_000), 'medium');
});
test('personal working report is medium without port counts', () => assert.equal(level({ freshness: 'recent', condition: 'working', availablePorts: null, totalPorts: null }), 'medium'));
test('busy is low, not a failure prediction', () => assert.equal(level({ condition: 'busy', availablePorts: 0 }), 'low'));
test('unavailable is low', () => assert.equal(level({ condition: 'unavailable', availablePorts: 0 }), 'low'));
test('available with zero ports is conflicting', () => assert.equal(level({ availablePorts: 0 }), 'unknown'));
test('busy with free ports is conflicting', () => assert.equal(level({ condition: 'busy' }), 'unknown'));
test('bad or partial counts stay unknown', () => {
  for (const availablePorts of [-1, 9, 1.5, NaN, Infinity, null]) assert.equal(level({ availablePorts }), 'unknown');
});
test('missing counts never produce high', () => assert.equal(level({ availablePorts: null, totalPorts: null }), 'medium'));
test('no source never produces high', () => assert.equal(level({ source: ' ' }), 'unknown'));
test('a stale negative observation is unknown, not permanently low', () => assert.equal(level({ condition: 'unavailable', availablePorts: 0 }, now + 30 * 60_000), 'unknown'));
