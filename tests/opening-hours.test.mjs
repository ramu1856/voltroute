import { test } from 'node:test';
import assert from 'node:assert/strict';
import { evaluateStationHours, matchesHoursFilter, readableHours } from '../lib/opening-hours.ts';

const chicago = { lat: 41.8781, lon: -87.6298, hours: 'Mo-Fr 08:00-17:00' };
const evaluate = (hours, instant, overrides = {}) => evaluateStationHours({ ...chicago, hours, ...overrides }, new Date(instant));

test('opening and closing boundaries use the station time zone', () => {
  const before = evaluate(chicago.hours, '2026-09-15T12:59:59Z');
  assert.equal(before.timeZone, 'America/Chicago');
  assert.equal(before.state, 'closed');
  assert.equal(evaluate(chicago.hours, '2026-09-15T13:00:00Z').state, 'open');
  assert.equal(evaluate(chicago.hours, '2026-09-15T22:00:00Z').state, 'closed');
});

test('the same instant gives different results for Chicago and Los Angeles', () => {
  const instant = '2026-09-15T14:00:00Z';
  assert.equal(evaluate(chicago.hours, instant).state, 'open');
  const west = evaluate(chicago.hours, instant, { lat: 34.0522, lon: -118.2437 });
  assert.equal(west.timeZone, 'America/Los_Angeles');
  assert.equal(west.state, 'closed');
});

test('spring-forward, fall-back, and Arizona clocks follow IANA time', () => {
  assert.equal(evaluate('Su 03:00-04:00', '2026-03-08T07:59:00Z').state, 'closed');
  assert.equal(evaluate('Su 03:00-04:00', '2026-03-08T08:00:00Z').state, 'open');
  for (const instant of ['2026-11-01T06:30:00Z', '2026-11-01T07:30:00Z']) {
    assert.equal(evaluate('Su 01:00-02:00', instant).state, 'open');
  }
  for (const instant of ['2026-01-15T14:30:00Z', '2026-07-15T14:30:00Z']) {
    assert.equal(evaluate('08:00-17:00', instant, { lat: 33.4484, lon: -112.0740 }).state, 'closed');
  }
});

test('station-local weekday is used even when UTC is already the next day', () => {
  assert.equal(evaluate('Mo 18:00-23:00', '2026-09-15T03:00:00Z').state, 'open');
  assert.equal(evaluate('Tu 18:00-23:00', '2026-09-15T03:00:00Z').state, 'closed');
});

test('overnight windows continue into Saturday and across the week boundary', () => {
  assert.equal(evaluate('Fr 22:00-02:00', '2026-09-19T06:30:00Z').state, 'open');
  assert.equal(evaluate('Fr 22:00-02:00', '2026-09-19T07:00:00Z').state, 'closed');
  assert.equal(evaluate('Su 22:00-26:00', '2026-09-21T06:30:00Z').state, 'open');
  assert.equal(evaluate('Fr,Sa 22:00-02:00', '2026-09-20T06:30:00Z').state, 'open');
});

test('split shifts, weekend hours and later weekday overrides are respected', () => {
  assert.equal(evaluate('Mo-Fr 08:00-12:00,13:00-17:00', '2026-09-15T17:30:00Z').state, 'closed');
  assert.equal(evaluate('Mo-Fr 08:00-12:00,13:00-17:00', '2026-09-15T18:00:00Z').state, 'open');
  const hours = 'Mo-Fr 08:00-17:00; We 10:00-12:00; Sa 09:00-14:00; Su off';
  assert.equal(evaluate(hours, '2026-09-16T18:00:00Z').state, 'closed');
  assert.equal(evaluate(hours, '2026-09-19T15:00:00Z').state, 'open');
  assert.equal(evaluate(hours, '2026-09-20T15:00:00Z').state, 'closed');
});

test('24/7 requires a complete unqualified all-week schedule', () => {
  for (const hours of ['24/7', '00:00-24:00', 'Mo-Su 00:00-24:00']) {
    const info = evaluate(hours, '2026-09-20T15:00:00Z');
    assert.equal(info.is24Hours, true);
    assert.equal(matchesHoursFilter(info, true, true), true);
  }
  for (const hours of ['Mo-Fr 00:00-24:00', '24/7; Su off', 'Mo-Sa 00:00-24:00; Su 00:00-23:59']) {
    assert.equal(evaluate(hours, '2026-09-15T15:00:00Z').is24Hours, false);
  }
});

test('missing, malformed and conditional schedules never pass hours filters', () => {
  for (const hours of ['', 'Hours not listed', 'Mo-Fr 08:00-17:00; PH off', '24/7 "customers only"', '24/7; PH off', 'sunrise-sunset', 'Mo-Fr 08:00+', 'Mo-Fr 25:00-27:00', 'Mo-Fr 08:99-17:00', 'Mo-Fr-Su 08:00-17:00', '08:00-08:00', '24/7;']) {
    const info = evaluate(hours, '2026-09-15T15:00:00Z');
    assert.equal(info.state, 'unknown', hours);
    assert.equal(matchesHoursFilter(info, true, false), false, hours);
    assert.equal(matchesHoursFilter(info, false, true), false, hours);
    assert.equal(matchesHoursFilter(info, false, false), true, hours);
  }
});

test('planned and unavailable stations are excluded even if listed as 24/7', () => {
  for (const status of ['planned', 'temporarily unavailable']) {
    const info = evaluate('24/7', '2026-09-15T15:00:00Z', { status });
    assert.equal(info.state, 'unavailable');
    assert.equal(matchesHoursFilter(info, true, true), false);
  }
});

test('explicit valid time zone is honored, invalid time zones fail safely', () => {
  const explicit = evaluate(chicago.hours, '2026-09-15T14:00:00Z', { timeZone: 'America/Los_Angeles' });
  assert.equal(explicit.timeZoneEstimated, false);
  assert.equal(explicit.state, 'closed');
  assert.equal(evaluate(chicago.hours, '2026-09-15T14:00:00Z', { timeZone: 'Invalid/Timezone' }).state, 'unknown');
  assert.equal(evaluate(chicago.hours, '2026-09-15T14:00:00Z', { lat: NaN }).state, 'unknown');
});

test('closed stations remain visible when hours filters are cleared', () => {
  const closed = evaluate(chicago.hours, '2026-09-15T03:00:00Z');
  assert.equal(matchesHoursFilter(closed, true, false), false);
  assert.equal(matchesHoursFilter(closed, false, false), true);
});

test('readable schedule retains unrecognized exception text', () => {
  assert.equal(readableHours('24/7'), '24 hours, every day');
  assert.equal(readableHours('Mo-Fr 08:00-17:00;PH off'), 'Mon-Fri 08:00-17:00; PH off');
});
