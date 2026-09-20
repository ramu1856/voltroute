import type { AvailabilityInfo } from './station-evidence.ts';

export type WaitForecast = {
  state: 'predicted' | 'uncertain' | 'unavailable';
  confidence: 'higher' | 'moderate' | 'low';
  minMinutes: number | null;
  maxMinutes: number | null;
  label: string;
  detail: string;
};

const DEFAULT_SESSION_MINUTES = 35;

function range(
  state: WaitForecast['state'],
  confidence: WaitForecast['confidence'],
  minMinutes: number | null,
  maxMinutes: number | null,
  label: string,
  detail: string,
): WaitForecast {
  return { state, confidence, minMinutes, maxMinutes, label, detail };
}

export function waitWindowLabel(forecast: WaitForecast) {
  if (forecast.minMinutes === null || forecast.maxMinutes === null) return 'Wait time unavailable';
  return forecast.minMinutes === forecast.maxMinutes
    ? `~${forecast.minMinutes} min`
    : `~${forecast.minMinutes}–${forecast.maxMinutes} min`;
}

export function predictWaitForecast(availability: AvailabilityInfo | null | undefined): WaitForecast {
  if (!availability) {
    return range(
      'unavailable',
      'low',
      null,
      null,
      'No queue estimate',
      'No station observation is available, so queue time cannot be estimated.',
    );
  }

  if (availability.condition === 'unavailable') {
    return range(
      'unavailable',
      'low',
      null,
      null,
      'Station unavailable',
      'Latest observation marks the station unavailable, so a queue forecast is not shown.',
    );
  }

  if (
    availability.freshness === 'live' &&
    availability.availablePorts !== null &&
    availability.totalPorts !== null &&
    availability.totalPorts > 0
  ) {
    if (availability.availablePorts > 0) {
      const upper = Math.max(4, Math.ceil(12 / availability.availablePorts));
      return range(
        'predicted',
        'higher',
        0,
        upper,
        'Likely immediate charging',
        'Live free-port count suggests a low queue now. New arrivals before you get there are not modeled.',
      );
    }
    const throughput = Math.max(1, availability.totalPorts);
    const lower = Math.max(8, Math.ceil(DEFAULT_SESSION_MINUTES / (throughput * 1.5)));
    const upper = Math.max(lower + 10, Math.ceil(DEFAULT_SESSION_MINUTES * 1.6));
    return range(
      'predicted',
      'moderate',
      lower,
      upper,
      'Likely queue',
      'All matching ports are occupied in the latest live feed. Estimate assumes no outages and average session turnover.',
    );
  }

  if (availability.freshness === 'recent' && ['available', 'working'].includes(availability.condition)) {
    return range(
      'uncertain',
      'low',
      5,
      30,
      'Recent status only',
      'Recent working status is not a live queue feed. Treat this as a rough allowance and verify near arrival.',
    );
  }

  if (availability.freshness === 'recent' && availability.condition === 'busy') {
    return range(
      'uncertain',
      'low',
      15,
      45,
      'Likely queue (recent report)',
      'Recent busy status suggests a queue, but live queue depth is unknown.',
    );
  }

  return range(
    'unavailable',
    'low',
    null,
    null,
    'No queue estimate',
    'A live queue or free-port feed is not available for this station right now.',
  );
}

export function predictWaitAtEta(
  availability: AvailabilityInfo | null | undefined,
  etaMinutes: number,
): WaitForecast {
  const base = predictWaitForecast(availability);
  if (base.minMinutes === null || base.maxMinutes === null) return base;
  if (!Number.isFinite(etaMinutes) || etaMinutes <= 0) return base;

  if (etaMinutes <= 15) {
    return {
      ...base,
      maxMinutes: base.maxMinutes + 5,
      detail: `${base.detail} Arrival in ~${Math.round(etaMinutes)} minutes adds small uncertainty.`,
    };
  }
  if (etaMinutes <= 45) {
    return {
      ...base,
      confidence: base.confidence === 'higher' ? 'moderate' : 'low',
      minMinutes: Math.max(0, base.minMinutes - 3),
      maxMinutes: base.maxMinutes + 12,
      label: 'Arrival-time queue estimate',
      detail: `${base.detail} Arrival in ~${Math.round(etaMinutes)} minutes increases queue uncertainty.`,
    };
  }
  if (etaMinutes <= 120) {
    return {
      state: 'uncertain',
      confidence: 'low',
      minMinutes: Math.max(5, base.minMinutes),
      maxMinutes: base.maxMinutes + 20,
      label: 'Long-horizon queue allowance',
      detail: 'Arrival is more than 45 minutes away, so this queue window is a rough allowance only.',
    };
  }

  return {
    state: 'unavailable',
    confidence: 'low',
    minMinutes: null,
    maxMinutes: null,
    label: 'Queue estimate unavailable',
    detail: 'Arrival is too far out for a meaningful queue estimate from current observations.',
  };
}
