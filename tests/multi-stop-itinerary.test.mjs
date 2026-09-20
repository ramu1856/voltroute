import { test } from 'node:test';
import assert from 'node:assert/strict';
import { normalizeStation } from '../lib/ev.ts';
import { smartStopSchema, rankStops } from '../lib/smart-stop.ts';
import { buildMultiStopItinerary } from '../lib/multi-stop-itinerary.ts';

const now = Date.parse('2026-09-20T00:00:00Z');
const input = smartStopSchema.parse({
  origin: { lat: 41.88, lon: -87.63, label: 'Start' },
  destination: { lat: 40.7, lon: -74.0, label: 'End' },
  profile: { name: 'Example EV', connector: 'CCS1', range: 260 },
  battery: 72,
  reserve: 15,
  maxDetourMinutes: 25,
  batteryCapacity: 75,
  vehicleMaxKW: 150,
});
const road = {
  coordinates: [[-87.63, 41.88], [-84.0, 41.4], [-79.5, 40.9], [-74.0, 40.7]],
  miles: 710,
  minutes: 710,
  fetchedAt: new Date(now).toISOString(),
};
const station = (id, lon) =>
  normalizeStation(
    {
      id,
      type: 'node',
      lat: 41.5,
      lon,
      tags: {
        name: `Stop ${id}`,
        amenity: 'charging_station',
        access: 'yes',
        opening_hours: '24/7',
        timezone: 'America/Chicago',
        network: `Network ${id}`,
        'socket:type1_combo': '2',
        'socket:type1_combo:output': '150 kW',
      },
    },
    input.origin,
  );

test('builds a charger-by-charger itinerary chain when one-stop is insufficient', () => {
  const shortlist = [station(1, -86.0), station(2, -83.5), station(3, -80.5), station(4, -77.0)];
  const legs = [
    { toMiles: 180, toMinutes: 180, onwardMiles: 530, onwardMinutes: 530, snapMeters: 5 },
    { toMiles: 260, toMinutes: 260, onwardMiles: 450, onwardMinutes: 450, snapMeters: 5 },
    { toMiles: 390, toMinutes: 390, onwardMiles: 320, onwardMinutes: 320, snapMeters: 5 },
    { toMiles: 520, toMinutes: 520, onwardMiles: 190, onwardMinutes: 190, snapMeters: 5 },
  ];
  const connections = [
    [null, { miles: 85, minutes: 82, fromSnapMeters: 5, toSnapMeters: 5 }, { miles: 205, minutes: 198, fromSnapMeters: 5, toSnapMeters: 5 }, { miles: 340, minutes: 330, fromSnapMeters: 5, toSnapMeters: 5 }],
    [{ miles: 85, minutes: 82, fromSnapMeters: 5, toSnapMeters: 5 }, null, { miles: 122, minutes: 118, fromSnapMeters: 5, toSnapMeters: 5 }, { miles: 255, minutes: 246, fromSnapMeters: 5, toSnapMeters: 5 }],
    [{ miles: 205, minutes: 198, fromSnapMeters: 5, toSnapMeters: 5 }, { miles: 122, minutes: 118, fromSnapMeters: 5, toSnapMeters: 5 }, null, { miles: 136, minutes: 132, fromSnapMeters: 5, toSnapMeters: 5 }],
    [{ miles: 340, minutes: 330, fromSnapMeters: 5, toSnapMeters: 5 }, { miles: 255, minutes: 246, fromSnapMeters: 5, toSnapMeters: 5 }, { miles: 136, minutes: 132, fromSnapMeters: 5, toSnapMeters: 5 }, null],
  ];
  const selected = rankStops([{ station: shortlist[0], legs: legs[0] }], input, road, {}, now).ranked[0];
  const itinerary = buildMultiStopItinerary({
    input,
    selected,
    shortlist,
    legs,
    connections,
    baseRouteMiles: road.miles,
    baseRouteMinutes: road.minutes,
    reports: {},
    now,
  });
  assert.ok(['complete', 'partial'].includes(itinerary.status));
  assert.ok(itinerary.stops.length >= 1);
  assert.equal(itinerary.stops[0].station.id, selected.station.id);
  assert.ok(itinerary.totalDriveMiles > 0);
});

test('returns unavailable itinerary when selected stop is outside shortlist', () => {
  const shortlist = [station(1, -86.0)];
  const selected = rankStops([{ station: station(9, -85.2), legs: { toMiles: 150, toMinutes: 150, onwardMiles: 560, onwardMinutes: 560, snapMeters: 5 } }], input, road, {}, now).ranked[0];
  const itinerary = buildMultiStopItinerary({
    input,
    selected,
    shortlist,
    legs: [{ toMiles: 180, toMinutes: 180, onwardMiles: 530, onwardMinutes: 530, snapMeters: 5 }],
    connections: [[null]],
    baseRouteMiles: road.miles,
    baseRouteMinutes: road.minutes,
    reports: {},
    now,
  });
  assert.equal(itinerary.status, 'unavailable');
  assert.equal(itinerary.stops.length, 0);
});

