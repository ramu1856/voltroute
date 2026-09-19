import { test } from 'node:test';
import assert from 'node:assert/strict';
import { smartStopSchema } from '../lib/smart-stop.ts';
import { projectMultiStopItinerary, scoreProjectedItinerary } from '../lib/itinerary-forecast.ts';

const input = smartStopSchema.parse({
  origin: { lat: 41.88, lon: -87.63, label: 'Start' },
  destination: { lat: 34.05, lon: -118.24, label: 'End' },
  profile: { name: 'Example EV', connector: 'CCS1', range: 300 },
  battery: 80,
  reserve: 15,
  maxDetourMinutes: 20,
});

test('multi-stop projection creates additional legs with charging assumptions', () => {
  const projection = projectMultiStopItinerary(input, 620, 120, 70);
  assert.ok(projection.legs.length >= 2);
  assert.ok(projection.projectedStops >= 1);
  assert.ok(projection.projectedCoveredMiles <= 620);
  assert.ok(projection.legs.every((leg) => leg.toMile > leg.fromMile));
  assert.ok(projection.legs.some((leg) => leg.requiresChargeStop));
});

test('projection stops when reserve cannot support another leg', () => {
  const projection = projectMultiStopItinerary(input, 620, 120, 16, 6);
  assert.equal(projection.projectedStops, 0);
  assert.ok(projection.remainingMiles > 0);
});

test('projected itinerary score rewards more coverage but penalizes many assumptions', () => {
  const fuller = scoreProjectedItinerary(59, 500, 500, 2, 0);
  const partial = scoreProjectedItinerary(59, 500, 260, 4, 240);
  assert.ok(fuller > partial);
  assert.ok(partial <= 49);
});
