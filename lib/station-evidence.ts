import type { Station } from './ev';

// Product freshness windows, not a guarantee of charger operation.
export const LIVE_WINDOW_MS = 5 * 60_000;
export const OPERATOR_RECENT_WINDOW_MS = 30 * 60_000;
export const REPORT_RECENT_WINDOW_MS = 24 * 60 * 60_000;
export const VERIFIED_PRICE_WINDOW_MS = 24 * 60 * 60_000;

export type OperatorObservation = {
  stationId: string;
  source: 'operator';
  provider: string;
  sourceUrl: string;
  observedAt: string;
  status: 'available' | 'busy' | 'unavailable';
  availablePorts?: number | null;
  totalPorts?: number | null;
};
export type OperatorTariff = {
  stationId: string;
  source: 'operator';
  provider: string;
  sourceUrl: string;
  observedAt: string;
  validUntil: string;
  currency: 'USD';
  unit: 'kWh';
  amount: number;
  audience: 'public';
};
export type PersonalReport = {
  sourceId: string;
  status: 'working' | 'busy' | 'broken';
  reportedAt: number;
};
type Condition = 'available' | 'working' | 'busy' | 'unavailable' | 'unknown';
export type AvailabilityInfo = {
  freshness: 'live' | 'recent' | 'unknown';
  condition: Condition;
  label: string;
  detail: string;
  source: string;
  sourceUrl: string | null;
  observedAt: string | null;
  ageMs: number | null;
  availablePorts: number | null;
  totalPorts: number | null;
};
export type PriceInfo = {
  confidence: 'verified' | 'estimated' | 'unavailable';
  label: 'Verified' | 'Estimated' | 'Unavailable';
  rate: number | null;
  source: string;
  sourceUrl: string | null;
  observedAt: string | null;
  detail: string;
  inputError: string | null;
};

function webUrl(value: string): string | null {
  try { const url = new URL(value); return ['https:', 'http:'].includes(url.protocol) ? url.href : null; }
  catch { return null; }
}
function time(value: string | number | null | undefined): number | null {
  if (value === null || value === undefined || value === '') return null;
  if (typeof value === 'string' && !/^\d{4}-\d{2}-\d{2}T.+(?:Z|[+-]\d{2}:\d{2})$/.test(value)) return null;
  const result = typeof value === 'number' ? value : Date.parse(value);
  return Number.isFinite(result) && result > 0 ? result : null;
}
function observationAge(value: string | number, now: number): number | null {
  const observed = time(value);
  return observed !== null && Number.isFinite(now) && now >= observed ? now - observed : null;
}
function validPortCount(count: number | null | undefined): count is number {
  return Number.isInteger(count) && Number(count) >= 0;
}
function operatorObservation(station: Station, now: number) {
  const observation = station.operatorObservation;
  if (!observation || observation.stationId !== station.id || observation.source !== 'operator' || !observation.provider?.trim()) return null;
  const sourceUrl = webUrl(observation.sourceUrl);
  const ageMs = observationAge(observation.observedAt, now);
  if (!sourceUrl || ageMs === null || !['available', 'busy', 'unavailable'].includes(observation.status)) return null;
  const { availablePorts, totalPorts } = observation;
  const hasCounts = availablePorts !== null && availablePorts !== undefined || totalPorts !== null && totalPorts !== undefined;
  if (hasCounts && (!validPortCount(availablePorts) || !validPortCount(totalPorts) || totalPorts < 1 || availablePorts > totalPorts)) return null;
  if (hasCounts && (observation.status === 'available' ? availablePorts === 0 : availablePorts !== 0)) return null;
  return { ...observation, sourceUrl, ageMs, availablePorts: hasCounts ? availablePorts! : null, totalPorts: hasCounts ? totalPorts! : null };
}

export function evaluateAvailability(station: Station, report: PersonalReport | undefined, now: number): AvailabilityInfo {
  const unknown: AvailabilityInfo = { freshness: 'unknown', condition: 'unknown', label: 'Unknown', detail: 'No recent operational observation. A map listing or its download time does not confirm a working charger or a free port.', source: 'No operational source', sourceUrl: null, observedAt: null, ageMs: null, availablePorts: null, totalPorts: null };
  const operator = operatorObservation(station, now);
  const reportAge = report && report.sourceId === station.id && ['working', 'busy', 'broken'].includes(report.status) ? observationAge(report.reportedAt, now) : null;
  // Prefer the newest observation; an older success cannot hide a later failure.
  if (report && reportAge !== null && (!operator || reportAge < operator.ageMs)) {
    const base = { ...unknown, source: 'Your station report', observedAt: new Date(report.reportedAt).toISOString(), ageMs: reportAge };
    if (reportAge > REPORT_RECENT_WINDOW_MS) return { ...base, detail: 'Your last report is older than 24 hours. Current operation and port availability are unknown.' };
    return { ...base, freshness: 'recent', condition: report.status === 'broken' ? 'unavailable' : report.status,
      label: `Recent report · ${report.status}`, detail: 'Your own observation from the last 24 hours. It is not a live port count or a community-wide verification.' };
  }
  if (!operator) return unknown;
  const base = { ...unknown, source: operator.provider, sourceUrl: operator.sourceUrl, observedAt: operator.observedAt, ageMs: operator.ageMs };
  if (operator.ageMs > OPERATOR_RECENT_WINDOW_MS) return { ...base, detail: 'The last operator observation is older than 30 minutes. Current availability is unknown.' };
  const live = operator.ageMs <= LIVE_WINDOW_MS;
  const condition = operator.status;
  const conditionText = live && operator.availablePorts !== null ? `${operator.availablePorts}/${operator.totalPorts} ports free` : condition;
  return { ...base, freshness: live ? 'live' : 'recent', condition,
    label: `${live ? 'Live' : 'Recent operator update'} · ${conditionText}`,
    detail: live ? 'Operator observation from the last 5 minutes. Availability can change before you arrive.' : 'Operator observation from 5–30 minutes ago. This is a last-known condition, not current port availability.',
    availablePorts: live ? operator.availablePorts : null, totalPorts: live ? operator.totalPorts : null };
}

// Only a single, explicit USD energy rate is usable. Ranges, membership prices,
// per-minute/session charges and combined tariffs must be confirmed separately.
export function parseListedEnergyRate(text: string): number | null {
  const value = text.trim();
  if (value === 'Listed as free') return 0;
  const number = '(\\d+(?:\\.\\d{1,4})?|\\.\\d{1,4})';
  const before = value.match(new RegExp(`^(?:US\\s*\\$|USD|\\$)\\s*${number}\\s*(?:/|per)\\s*kWh$`, 'i'));
  const after = value.match(new RegExp(`^${number}\\s*USD\\s*(?:/|per)\\s*kWh$`, 'i'));
  const match = before || after;
  return match ? Number(match[1]) : null;
}

type PriceEstimate = { rate: number; source: string; detail: string };
function estimatedNetworkRate(station: Station): PriceEstimate {
  const text = `${station.network} ${station.name}`.toLowerCase();
  const fromKnownNetwork = (rate: number, source: string, range: string): PriceEstimate => ({
    rate,
    source,
    detail: `Estimated from typical ${source} public pricing (${range}) because this station listing has no usable per-kWh tariff. Verify in the operator app before travel.`,
  });
  if (text.includes('tesla') || text.includes('supercharger')) return fromKnownNetwork(0.44, 'Tesla network estimate', '$0.36-$0.56/kWh');
  if (text.includes('electrify america')) return fromKnownNetwork(0.48, 'Electrify America estimate', '$0.42-$0.64/kWh');
  if (text.includes('evgo')) return fromKnownNetwork(0.52, 'EVgo estimate', '$0.45-$0.69/kWh');
  if (text.includes('chargepoint')) return fromKnownNetwork(0.40, 'ChargePoint estimate', '$0.25-$0.55/kWh');
  if (text.includes('blink')) return fromKnownNetwork(0.49, 'Blink estimate', '$0.35-$0.65/kWh');
  if (text.includes('shell recharge') || text.includes('greenlots')) return fromKnownNetwork(0.46, 'Shell Recharge estimate', '$0.35-$0.62/kWh');
  if (text.includes('bp pulse')) return fromKnownNetwork(0.45, 'BP Pulse estimate', '$0.34-$0.60/kWh');
  if (text.includes('ev connect')) return fromKnownNetwork(0.43, 'EV Connect estimate', '$0.30-$0.58/kWh');
  if (text.includes('francis energy')) return fromKnownNetwork(0.47, 'Francis Energy estimate', '$0.36-$0.62/kWh');
  if ((station.power ?? 0) >= 100) {
    return {
      rate: 0.46,
      source: 'Fast charging market estimate',
      detail: 'Estimated from common US DC fast-charging public rates because this listing has no usable tariff. Typical range is about $0.34-$0.64 per kWh; verify before travel.',
    };
  }
  return {
    rate: 0.30,
    source: 'Public charging market estimate',
    detail: 'Estimated from common US public charging rates because this listing has no usable tariff. Typical range is about $0.18-$0.45 per kWh; verify before travel.',
  };
}

export function evaluatePrice(station: Station, enteredRate: string | undefined, now: number): PriceInfo {
  const unavailable: PriceInfo = { confidence: 'unavailable', label: 'Unavailable', rate: null, source: 'No usable energy rate', sourceUrl: null, observedAt: null, detail: 'No single per-kWh price is supplied. Leave the estimate blank until you have a rate.', inputError: null };
  if (enteredRate !== undefined && enteredRate.trim() !== '') {
    if (!/^(?:\d+(?:\.\d{1,4})?|\.\d{1,4})$/.test(enteredRate.trim()) || Number(enteredRate) > 100) {
      return { ...unavailable, source: 'Your input', inputError: 'Enter a rate from $0 to $100 per kWh, with up to 4 decimal places.' };
    }
    return { confidence: 'estimated', label: 'Estimated', rate: Number(enteredRate), source: 'Your entered rate', sourceUrl: null, observedAt: null, detail: 'Applies only to this station in this session. VoltRoute has not verified this rate.', inputError: null };
  }
  const quote = station.operatorTariff;
  if (quote && quote.source === 'operator' && quote.stationId === station.id && quote.provider?.trim() && quote.currency === 'USD' && quote.unit === 'kWh' && quote.audience === 'public') {
    const age = observationAge(quote.observedAt, now), expiry = time(quote.validUntil), url = webUrl(quote.sourceUrl);
    if (age !== null && age <= VERIFIED_PRICE_WINDOW_MS && expiry !== null && expiry > now && url && Number.isFinite(quote.amount) && quote.amount >= 0) {
      return { confidence: 'verified', label: 'Verified', rate: quote.amount, source: quote.provider, sourceUrl: url, observedAt: quote.observedAt, detail: 'Public energy rate received from the operator within 24 hours and inside its validity period. Taxes, parking, session and idle fees may be additional.', inputError: null };
    }
  }
  const rate = parseListedEnergyRate(station.fee);
  if (rate !== null) return { confidence: 'estimated', label: 'Estimated', rate, source: 'OpenStreetMap listing', sourceUrl: webUrl(station.sourceUrl), observedAt: null,
    detail: rate === 0 ? 'Listed as free by the community. Confirm charging and parking charges with the operator.' : 'Community-listed rate. Its tariff verification date is unknown and it may be outdated. Confirm with the operator.', inputError: null };
  const estimated = estimatedNetworkRate(station);
  return { confidence: 'estimated', label: 'Estimated', rate: estimated.rate, source: estimated.source, sourceUrl: webUrl(station.sourceUrl), observedAt: null,
    detail: station.fee === 'Price not listed' ? estimated.detail : `Original tariff text could not be converted to one USD per-kWh value. ${estimated.detail}`, inputError: null };
}

export function estimateCharge(range: number, from: number, to: number, power: number | null, rate: number | null) {
  if (![range, from, to].every(Number.isFinite) || range < 30 || range > 600 || from < 0 || to > 100 || to <= from) return null;
  const capacity = Math.max(30, Math.min(150, range / 3.2));
  const energy = capacity * (to - from) / 100;
  return { energy, minutes: power !== null && Number.isFinite(power) && power > 0 ? Math.ceil(energy / Math.min(power, 150) * 60 * 1.15) : null,
    cost: rate !== null && Number.isFinite(rate) && rate >= 0 ? energy * rate : null };
}

export function ageLabel(ageMs: number | null): string {
  if (ageMs === null) return 'Time unknown';
  if (ageMs < 60_000) return 'Just now';
  if (ageMs < 3_600_000) return `${Math.floor(ageMs / 60_000)} min ago`;
  if (ageMs < 86_400_000) return `${Math.floor(ageMs / 3_600_000)} hr ago`;
  return `${Math.floor(ageMs / 86_400_000)} days ago`;
}
export function evidenceTime(value: string | number | null | undefined): string {
  const timestamp = time(value);
  return timestamp === null ? 'Not supplied' : new Intl.DateTimeFormat('en-US', { timeZone: 'UTC', year: 'numeric', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' }).format(timestamp) + ' UTC';
}
