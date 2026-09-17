import { test } from 'node:test';
import assert from 'node:assert/strict';
import { normalizeStation } from '../lib/ev.ts';
import { evaluateAvailability, evaluatePrice, parseListedEnergyRate, estimateCharge, LIVE_WINDOW_MS, OPERATOR_RECENT_WINDOW_MS, REPORT_RECENT_WINDOW_MS, VERIFIED_PRICE_WINDOW_MS } from '../lib/station-evidence.ts';

const now = Date.parse('2026-09-15T16:00:00Z');
const iso = offset => new Date(now - offset).toISOString();
const station = normalizeStation({ id: 1, type: 'node', lat: 41.88, lon: -87.63, timestamp: iso(0), tags: { operational_status: 'open', opening_hours: '24/7' } }, { lat: 41.88, lon: -87.63 });
const observation = (overrides = {}) => ({ stationId: station.id, source: 'operator', provider: 'Test provider', sourceUrl: 'https://example.com/station/1', observedAt: iso(0), status: 'available', availablePorts: 2, totalPorts: 6, ...overrides });
const tariff = (overrides = {}) => ({ stationId: station.id, source: 'operator', provider: 'Test provider', sourceUrl: 'https://example.com/tariff/1', observedAt: iso(0), validUntil: iso(-3_600_000), amount: 0.42, currency: 'USD', unit: 'kWh', audience: 'public', ...overrides });
const report = (status, age) => ({ sourceId: station.id, status, reportedAt: now - age });

test('a newly fetched map record, mapped open status, and 24/7 hours never create live availability', () => {
  const result = evaluateAvailability(station, undefined, now);
  assert.equal(result.freshness, 'unknown');
  assert.equal(result.availablePorts, null);
  assert.equal(result.observedAt, null);
  assert.equal(station.operatorObservation, undefined);
});
test('fresh operator observations expire from live to recent to unknown without another fetch', () => {
  const current = { ...station, operatorObservation: observation() };
  assert.equal(evaluateAvailability(current, undefined, now + LIVE_WINDOW_MS).freshness, 'live');
  const recent = evaluateAvailability(current, undefined, now + LIVE_WINDOW_MS + 1);
  assert.equal(recent.freshness, 'recent');
  assert.equal(recent.availablePorts, null);
  assert.equal(evaluateAvailability(current, undefined, now + OPERATOR_RECENT_WINDOW_MS + 1).freshness, 'unknown');
});
test('impossible port counts, future timestamps, wrong station and non-operator sources fail safely', () => {
  for (const invalid of [{ availablePorts: 7 }, { availablePorts: -1 }, { availablePorts: 1.5 }, { availablePorts: 0 }, { totalPorts: 0 }, { totalPorts: null }, { observedAt: iso(-1) }, { observedAt: 'yesterday' }, { observedAt: '2026-09-15' }, { stationId: 'node/2' }, { source: 'community' }, { sourceUrl: 'javascript:alert(1)' }]) {
    assert.equal(evaluateAvailability({ ...station, operatorObservation: observation(invalid) }, undefined, now).freshness, 'unknown', JSON.stringify(invalid));
  }
});
test('available status can have unknown counts; zero free ports cannot say available', () => {
  const noCounts = evaluateAvailability({ ...station, operatorObservation: observation({ availablePorts: null, totalPorts: null }) }, undefined, now);
  assert.equal(noCounts.condition, 'available');
  assert.equal(noCounts.availablePorts, null);
  const busy = evaluateAvailability({ ...station, operatorObservation: observation({ availablePorts: 0, status: 'busy' }) }, undefined, now);
  assert.equal(busy.condition, 'busy');
  assert.equal(busy.availablePorts, 0);
});
test('personal reports retain their source and expire after 24 hours; working never implies free ports', () => {
  const current = evaluateAvailability(station, report('working', 60_000), now);
  assert.equal(current.freshness, 'recent');
  assert.equal(current.condition, 'working');
  assert.equal(current.source, 'Your station report');
  assert.equal(current.availablePorts, null);
  assert.equal(evaluateAvailability(station, report('working', REPORT_RECENT_WINDOW_MS), now).freshness, 'recent');
  assert.equal(evaluateAvailability(station, report('working', REPORT_RECENT_WINDOW_MS + 1), now).freshness, 'unknown');
  assert.equal(evaluateAvailability(station, { ...report('working', 0), sourceId: 'node/2' }, now).freshness, 'unknown');
});
test('newer failure supersedes an earlier success and never inherits its live port count', () => {
  const current = { ...station, operatorObservation: observation({ observedAt: iso(120_000) }) };
  const result = evaluateAvailability(current, report('broken', 60_000), now);
  assert.equal(result.condition, 'unavailable');
  assert.equal(result.freshness, 'recent');
  assert.equal(result.availablePorts, null);
});
test('only single explicit USD per-kWh community prices can be estimated', () => {
  for (const [text, amount] of [['$0.40/kWh', 0.4], ['$.45 per kWh', 0.45], ['USD 0.3750/kWh', 0.375], ['0.44 USD/kWh', 0.44], ['US$0/kWh', 0], ['Listed as free', 0]]) assert.equal(parseListedEnergyRate(text), amount, text);
  for (const text of ['Price not listed', '$0.40/min', '$0.40/kWh + $2 session', '$0.40–$0.60/kWh', 'Members $0.30/kWh; others $0.50/kWh', '$0.40/kWh after 8 PM', '€0.40/kWh', 'CAD 0.40/kWh', '0.40', 'yes', '-$0.40/kWh']) assert.equal(parseListedEnergyRate(text), null, text);
});
test('community prices including free are estimated, never verified by a fresh map timestamp', () => {
  for (const fee of ['$0.40/kWh', 'Listed as free']) {
    const result = evaluatePrice({ ...station, fee }, '', now);
    assert.equal(result.confidence, 'estimated');
    assert.equal(result.observedAt, null);
    assert.equal(result.source, 'OpenStreetMap listing');
  }
});
test('missing or complex price leaves cost unavailable rather than using a default', () => {
  for (const fee of ['Price not listed', 'Fee applies; price not listed', '$1/hour', '$0.50/kWh + $1']) {
    const result = evaluatePrice({ ...station, fee }, '', now);
    assert.equal(result.confidence, 'unavailable');
    assert.equal(result.rate, null);
    assert.equal(estimateCharge(300, 20, 80, 150, result.rate).cost, null);
  }
});
test('verified price requires a current, applicable operator tariff for the exact station', () => {
  assert.equal(evaluatePrice({ ...station, operatorTariff: tariff() }, '', now).confidence, 'verified');
  for (const invalid of [{ observedAt: iso(VERIFIED_PRICE_WINDOW_MS + 1) }, { observedAt: iso(-1) }, { validUntil: iso(0) }, { validUntil: '' }, { amount: -1 }, { amount: Infinity }, { amount: NaN }, { amount: '0.42' }, { source: 'community' }, { sourceUrl: 'javascript:alert(1)' }, { stationId: 'node/2' }, { audience: 'members' }, { currency: 'CAD' }, { unit: 'minute' }]) {
    assert.equal(evaluatePrice({ ...station, operatorTariff: tariff(invalid) }, '', now).confidence, 'unavailable', JSON.stringify(invalid));
  }
});
test('user overrides remain estimated, including zero; clearing restores the source, invalid input does not silently fall back', () => {
  const current = { ...station, fee: '$0.50/kWh', operatorTariff: tariff() };
  assert.equal(evaluatePrice(current, '0', now).rate, 0);
  assert.equal(evaluatePrice(current, '0', now).confidence, 'estimated');
  assert.equal(evaluatePrice(current, '', now).rate, 0.42);
  for (const value of ['-0.4', 'NaN', 'Infinity', '1e3', '101', '0.12345', 'junk']) {
    const result = evaluatePrice(current, value, now);
    assert.equal(result.rate, null, value);
    assert.ok(result.inputError);
  }
});
test('invalid battery ranges cannot generate negative, zero-duration, or misleading free-session totals', () => {
  for (const args of [[300, 80, 20], [300, 20, 20], [300, -1, 80], [300, 20, 101], [NaN, 20, 80], [300, NaN, 80]]) assert.equal(estimateCharge(...args, 150, 0.4), null);
  assert.equal(estimateCharge(300, 20, 80, null, 0).cost, 0);
  assert.equal(estimateCharge(300, 20, 80, null, 0).minutes, null);
});
