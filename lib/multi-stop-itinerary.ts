import type { RoadConnection } from './backup-charger.ts';
import type { SmartStopInput, RankedStop, RoadLegs } from './smart-stop.ts';
import type { Station } from './ev.ts';
import { connectorKW } from './smart-stop.ts';
import { evaluateAvailability, type PersonalReport } from './station-evidence.ts';
import { evaluateStationHours } from './opening-hours.ts';
import { predictWaitAtEta, type WaitForecast } from './wait-forecast.ts';

export type ItineraryStop = {
  order: number;
  station: Station;
  from: 'origin' | string;
  legMiles: number;
  legMinutes: number;
  arrivalBattery: number;
  targetBattery: number;
  chargeMinutes: number | null;
  energyKwh: number | null;
  destinationReachableAfterCharge: boolean;
  destinationMilesAfterStop: number;
  etaAtArrival: string;
  waitForecast: WaitForecast;
  confidence: 'strong' | 'moderate' | 'weak';
  assumptions: string[];
};

export type MultiStopItinerary = {
  status: 'complete' | 'partial' | 'unavailable';
  projectedScore: number | null;
  totalDriveMiles: number;
  totalDriveMinutes: number;
  totalChargeMinutes: number | null;
  totalWaitMinutes: number | null;
  remainingMiles: number;
  stops: ItineraryStop[];
  notes: string[];
};

type Args = {
  input: SmartStopInput;
  selected: RankedStop;
  shortlist: Station[];
  legs: (RoadLegs | null)[];
  connections: (RoadConnection | null)[][];
  baseRouteMiles: number;
  baseRouteMinutes: number;
  reports: Record<string, PersonalReport>;
  now: number;
  maxStops?: number;
};

type CandidateStop = {
  index: number;
  station: Station;
  legMiles: number;
  legMinutes: number;
  destinationMiles: number;
  destinationMinutes: number;
  arrivalBattery: number;
  targetBattery: number;
  chargeMinutes: number | null;
  energyKwh: number | null;
  waitForecast: WaitForecast;
  confidence: ItineraryStop['confidence'];
  score: number;
  destinationReachableAfterCharge: boolean;
  assumptions: string[];
};

const clamp = (n: number, min = 0, max = 100) => Math.max(min, Math.min(max, n));

function estimateCharge(input: SmartStopInput, station: Station, arrivalBattery: number, targetBattery: number) {
  const listedKW = connectorKW(station, input.profile.connector);
  const usableKW =
    listedKW !== null && input.vehicleMaxKW !== null ? Math.min(listedKW, input.vehicleMaxKW) : null;
  const energyKwh =
    input.batteryCapacity !== null ? input.batteryCapacity * ((targetBattery - arrivalBattery) / 100) : null;
  const chargeMinutes =
    energyKwh !== null && usableKW !== null ? Math.ceil((energyKwh / usableKW) * 60 * 1.25) : null;
  return { energyKwh, chargeMinutes };
}

function confidenceFor(station: Station, input: SmartStopInput, now: number, report: PersonalReport | undefined, arrivalEtaMinutes: number) {
  const availability = evaluateAvailability(station, report, now);
  const hours = evaluateStationHours(station, new Date(now + arrivalEtaMinutes * 60_000));
  if (hours.state === 'closed' || hours.state === 'unavailable') return { blocked: true, confidence: 'weak' as const };
  if (availability.condition === 'unavailable') return { blocked: true, confidence: 'weak' as const };
  if (availability.freshness === 'live' && availability.condition === 'available' && ['yes', 'permissive'].includes(station.access)) {
    return { blocked: false, confidence: 'strong' as const };
  }
  if (availability.freshness !== 'unknown' || hours.state === 'open') return { blocked: false, confidence: 'moderate' as const };
  return { blocked: false, confidence: 'weak' as const };
}

function confidencePenalty(confidence: ItineraryStop['confidence']) {
  if (confidence === 'strong') return 0;
  if (confidence === 'moderate') return 8;
  return 16;
}

function waitMidpoint(wait: WaitForecast) {
  if (wait.minMinutes === null || wait.maxMinutes === null) return null;
  return Math.round((wait.minMinutes + wait.maxMinutes) / 2);
}

function itineraryScore(status: MultiStopItinerary['status'], coveredMiles: number, totalMiles: number, stops: number, unknowns: number) {
  const coverage = totalMiles > 0 ? coveredMiles / totalMiles : 0;
  const base = 38 + coverage * 52 - stops * 3 - unknowns * 4;
  const rounded = Math.round(Math.max(0, Math.min(100, base)));
  if (status === 'partial') return Math.min(49, rounded);
  return rounded;
}

export function buildMultiStopItinerary({
  input,
  selected,
  shortlist,
  legs,
  connections,
  baseRouteMiles,
  baseRouteMinutes,
  reports,
  now,
  maxStops = 5,
}: Args): MultiStopItinerary {
  const indexById = new Map(shortlist.map((station, index) => [station.id, index]));
  const firstIndex = indexById.get(selected.station.id);
  if (firstIndex === undefined) {
    return {
      status: 'unavailable',
      projectedScore: null,
      totalDriveMiles: 0,
      totalDriveMinutes: 0,
      totalChargeMinutes: null,
      totalWaitMinutes: null,
      remainingMiles: baseRouteMiles,
      stops: [],
      notes: ['The selected stop is not in the current road-comparison shortlist. Recalculate Smart Stop.'],
    };
  }

  const used = new Set<string>();
  const stops: ItineraryStop[] = [];
  let currentIndex: number | null = null;
  let currentBattery = input.battery;
  let totalDriveMiles = 0;
  let totalDriveMinutes = 0;
  let totalChargeMinutes = 0;
  let unknownCharge = false;
  let unknownWait = false;
  let coveredMiles = 0;
  let destinationLegMiles = baseRouteMiles;
  let destinationLegMinutes = baseRouteMinutes;
  let completed = false;

  const chooseCandidate = (forcedIndex: number | null): CandidateStop | null => {
    const candidates: CandidateStop[] = [];
    const indices = forcedIndex === null ? shortlist.map((_, index) => index) : [forcedIndex];
    for (const index of indices) {
      const station = shortlist[index];
      if (used.has(station.id)) continue;

      let legMiles: number;
      let legMinutes: number;
      if (currentIndex === null) {
        const edge = legs[index];
        if (!edge) continue;
        legMiles = edge.toMiles;
        legMinutes = edge.toMinutes;
      } else {
        const edge = connections[currentIndex][index];
        if (!edge) continue;
        legMiles = edge.miles;
        legMinutes = edge.minutes;
      }

      const destination = legs[index];
      if (!destination) continue;
      const destinationMiles = destination.onwardMiles;
      const destinationMinutes = destination.onwardMinutes;

      const arrivalBattery = currentBattery - (legMiles / input.profile.range) * 100;
      if (!Number.isFinite(arrivalBattery) || arrivalBattery + 1e-8 < input.reserve) continue;

      const etaMinutes = totalDriveMinutes + legMinutes;
      const confidenceState = confidenceFor(station, input, now, reports[station.id], etaMinutes);
      if (confidenceState.blocked) continue;

      const neededForDestination = input.reserve + (destinationMiles / input.profile.range) * 100;
      const targetBattery = clamp(
        Math.min(80, Math.max(arrivalBattery + 1, neededForDestination <= 80 ? neededForDestination : 80)),
      );
      if (targetBattery <= arrivalBattery + 1e-8) continue;

      const destinationReachableAfterCharge =
        targetBattery - (destinationMiles / input.profile.range) * 100 + 1e-8 >= input.reserve;
      const { energyKwh, chargeMinutes } = estimateCharge(input, station, arrivalBattery, targetBattery);
      const availability = evaluateAvailability(station, reports[station.id], now);
      const waitForecast = predictWaitAtEta(availability, etaMinutes);
      const waitMid = waitMidpoint(waitForecast);
      const assumptions: string[] = [];
      assumptions.push('Assumes successful charging at this stop before continuing.');
      if (chargeMinutes === null) assumptions.push('Charging duration is unknown without full vehicle or power inputs.');
      if (waitForecast.minMinutes === null) assumptions.push('Queue timing is uncertain due limited live feed.');
      if (!destinationReachableAfterCharge) assumptions.push('Another charging stop will likely be needed after this leg.');

      const score =
        legMinutes +
        (chargeMinutes ?? 35) +
        (waitMid ?? 12) +
        confidencePenalty(confidenceState.confidence) +
        (destinationReachableAfterCharge ? -12 : Math.min(18, destinationMiles / 25));
      candidates.push({
        index,
        station,
        legMiles,
        legMinutes,
        destinationMiles,
        destinationMinutes,
        arrivalBattery,
        targetBattery,
        chargeMinutes,
        energyKwh,
        waitForecast,
        confidence: confidenceState.confidence,
        score,
        destinationReachableAfterCharge,
        assumptions,
      });
    }
    if (!candidates.length) return null;
    candidates.sort((a, b) => a.score - b.score || a.station.id.localeCompare(b.station.id));
    return candidates[0];
  };

  for (let order = 0; order < maxStops; order++) {
    if (currentBattery - (destinationLegMiles / input.profile.range) * 100 + 1e-8 >= input.reserve) {
      completed = true;
      break;
    }
    const forced = order === 0 ? firstIndex : null;
    const next = chooseCandidate(forced);
    if (!next) break;

    const waitMid = waitMidpoint(next.waitForecast);
    const stop: ItineraryStop = {
      order: order + 1,
      station: next.station,
      from: currentIndex === null ? 'origin' : shortlist[currentIndex].id,
      legMiles: next.legMiles,
      legMinutes: next.legMinutes,
      arrivalBattery: next.arrivalBattery,
      targetBattery: next.targetBattery,
      chargeMinutes: next.chargeMinutes,
      energyKwh: next.energyKwh,
      destinationReachableAfterCharge: next.destinationReachableAfterCharge,
      destinationMilesAfterStop: next.destinationMiles,
      etaAtArrival: new Date(now + (totalDriveMinutes + next.legMinutes) * 60_000).toISOString(),
      waitForecast: next.waitForecast,
      confidence: next.confidence,
      assumptions: next.assumptions,
    };
    stops.push(stop);
    used.add(next.station.id);
    currentIndex = next.index;
    currentBattery = next.targetBattery;
    totalDriveMiles += next.legMiles;
    coveredMiles += next.legMiles;
    totalDriveMinutes += next.legMinutes;
    destinationLegMiles = next.destinationMiles;
    destinationLegMinutes = next.destinationMinutes;
    if (next.chargeMinutes === null) unknownCharge = true;
    else totalChargeMinutes += next.chargeMinutes;
    if (waitMid === null) unknownWait = true;
    if (next.destinationReachableAfterCharge) {
      completed = true;
      totalDriveMiles += destinationLegMiles;
      coveredMiles += destinationLegMiles;
      totalDriveMinutes += destinationLegMinutes;
      destinationLegMiles = 0;
      destinationLegMinutes = 0;
      break;
    }
  }

  const status: MultiStopItinerary['status'] =
    completed && stops.length > 0 ? 'complete' : stops.length > 0 ? 'partial' : 'unavailable';
  const remainingMiles = Math.max(0, destinationLegMiles);
  const notes: string[] = [];
  if (status === 'complete') {
    notes.push('This itinerary is charger-by-charger and assumes each planned stop can charge successfully.');
  } else if (status === 'partial') {
    notes.push('A full stop chain was not completed within current search coverage and assumptions.');
  } else {
    notes.push('No feasible next stop chain was identified from the current shortlisted stations.');
  }
  if (unknownCharge) notes.push('Some stop charging durations are unknown due missing power or vehicle limits.');
  if (unknownWait) notes.push('Some queue forecasts are unavailable; wait times can vary at arrival.');

  const projectedScore =
    status === 'unavailable'
      ? null
      : itineraryScore(status, coveredMiles, baseRouteMiles, stops.length, Number(unknownCharge) + Number(unknownWait));

  return {
    status,
    projectedScore,
    totalDriveMiles,
    totalDriveMinutes,
    totalChargeMinutes: unknownCharge ? null : totalChargeMinutes,
    totalWaitMinutes: null,
    remainingMiles,
    stops,
    notes,
  };
}

