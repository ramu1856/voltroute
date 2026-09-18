import type { AvailabilityInfo } from './station-evidence';

export type ChargingConfidence = {
  level: 'high' | 'medium' | 'low' | 'unknown';
  label: string;
  reason: string;
  ports: string | null;
};
const MINUTE = 60_000;
const unknown = (reason: string): ChargingConfidence => ({ level: 'unknown', label: 'Unknown confidence', reason, ports: null });

/** Conservative v1 evidence rules, not a calibrated probability or route safety score. */
export function chargingConfidence(info: AvailabilityInfo, now: number): ChargingConfidence {
  if (!Number.isFinite(now) || !info.observedAt) return unknown('Insufficient dated operational evidence. Unknown does not mean broken.');
  const observed = Date.parse(info.observedAt);
  const age = now - observed;
  if (!Number.isFinite(observed) || age < 0) return unknown('The observation time is invalid or in the future.');
  if (info.freshness === 'unknown' || age > 30 * MINUTE) return unknown('No operational evidence within the confidence window. Check the network app.');
  if (!info.source.trim()) return unknown('The operational source is missing.');
  const available = info.availablePorts;
  const total = info.totalPorts;
  const validCounts = typeof available === 'number' && typeof total === 'number'
    && Number.isInteger(available) && Number.isInteger(total)
    && available >= 0 && total > 0 && available <= total;
  const hasCounts = available !== null || total !== null;
  if (hasCounts && !validCounts) return unknown('Port counts are incomplete or inconsistent. Verify with the operator.');
  if (validCounts && ((info.condition === 'available' && available === 0)
    || ((info.condition === 'busy' || info.condition === 'unavailable') && available > 0))) {
    return unknown('Port counts conflict with the reported status. Verify with the operator.');
  }
  const live = info.freshness === 'live' && age <= 5 * MINUTE;
  const ports = validCounts ? `${available}/${total} ports reported available${live ? '' : ' at observation time'}` : null;
  if (info.condition === 'busy' || info.condition === 'unavailable') {
    return { level: 'low', label: 'Low confidence for an immediate stop', reason: info.condition === 'busy'
      ? 'The recent observation reports a busy station. Busy does not mean broken; no wait time can be inferred.'
      : 'The recent observation reports this station unavailable. Check another compatible stop.', ports };
  }
  if (info.condition !== 'available' && info.condition !== 'working') return unknown('The observation does not confirm operation.');
  if (validCounts && available === 0) return unknown('Operation was reported, but no free ports were reported. Verify before relying on this stop.');
  if (live && info.condition === 'available' && validCounts && available > 0) {
    return { level: 'high', label: 'High confidence in current availability', reason: 'A live operator observation within 5 minutes reports free ports. Availability may change before arrival.', ports };
  }
  return { level: 'medium', label: 'Medium confidence in current operation', reason: 'Positive operational evidence within 30 minutes, but not enough evidence to confirm a free port at arrival.', ports };
}
