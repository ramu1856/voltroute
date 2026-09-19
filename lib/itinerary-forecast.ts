import type { SmartStopInput } from './smart-stop.ts';

export type ItineraryLeg = {
  id: string;
  fromMile: number;
  toMile: number;
  distanceMiles: number;
  batteryFrom: number;
  batteryTo: number;
  requiresChargeStop: boolean;
  assumption: string;
};

export type ItineraryProjection = {
  status: 'not-needed' | 'projected' | 'incomplete' | 'unavailable';
  score: number | null;
  label: string;
  projectedStops: number;
  projectedCoveredMiles: number;
  remainingMiles: number;
  legs: ItineraryLeg[];
  notes: string[];
};

const clamp = (value: number, min = 0, max = 100) => Math.max(min, Math.min(max, value));

function segmentAssumption(leg: ItineraryLeg) {
  return leg.requiresChargeStop
    ? `Assumes successful charging to 80% at about mile ${Math.round(leg.toMile)} before the next leg.`
    : 'Estimated final leg without another modeled charging stop.';
}

export function projectMultiStopItinerary(
  input: SmartStopInput,
  totalMiles: number,
  fromMile: number,
  fromBattery: number,
  maxProjectedStops = 6,
) {
  const total = Number.isFinite(totalMiles) ? Math.max(0, totalMiles) : 0;
  const start = clamp(fromMile, 0, total);
  let cursor = start;
  let battery = clamp(fromBattery, 0, 100);
  let projectedStops = 0;
  const legs: ItineraryLeg[] = [];

  for (let index = 0; index < maxProjectedStops + 1 && cursor + 1e-6 < total; index++) {
    const reachable =
      Number.isFinite(input.profile.range) && input.profile.range > 0
        ? (input.profile.range * (battery - input.reserve)) / 100
        : 0;
    if (!Number.isFinite(reachable) || reachable <= 0.25) break;

    const segment = Math.min(total - cursor, reachable);
    const next = cursor + segment;
    const batteryTo = clamp(battery - (segment / input.profile.range) * 100, 0, 100);
    const requiresChargeStop = next + 1e-6 < total;
    const leg: ItineraryLeg = {
      id: `projection-${index}`,
      fromMile: cursor,
      toMile: next,
      distanceMiles: segment,
      batteryFrom: battery,
      batteryTo,
      requiresChargeStop,
      assumption: '',
    };
    leg.assumption = segmentAssumption(leg);
    legs.push(leg);
    cursor = next;

    if (requiresChargeStop) {
      projectedStops += 1;
      battery = 80;
    } else battery = batteryTo;
  }

  const remainingMiles = Math.max(0, total - cursor);
  return {
    projectedStops,
    projectedCoveredMiles: cursor,
    remainingMiles,
    legs,
  };
}

export function scoreProjectedItinerary(
  verifiedScore: number | null,
  totalMiles: number,
  projectedCoveredMiles: number,
  projectedStops: number,
  remainingMiles: number,
) {
  if (!Number.isFinite(totalMiles) || totalMiles <= 0 || verifiedScore === null) return null;
  const coverage = clamp(projectedCoveredMiles / totalMiles, 0, 1);
  const stopPenalty = Math.min(30, projectedStops * 6);
  const remainderPenalty = remainingMiles > 0.01 ? 18 : 0;
  const blended = verifiedScore * 0.6 + coverage * 40 - stopPenalty - remainderPenalty;
  const score = Math.round(clamp(blended, 0, 100));
  return remainingMiles > 0.01 ? Math.min(score, 49) : score;
}
