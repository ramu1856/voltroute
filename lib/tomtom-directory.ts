import type { Point, Station } from './ev.ts';
import { miles } from './ev.ts';

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : null;
}

function asNumber(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

function asString(value: unknown): string | null {
  return typeof value === 'string' && value.trim() ? value.trim() : null;
}

function connectorFromTomTom(value: string): Station['connectors'][number] | null {
  const normalized = value.toLowerCase();
  if (normalized.includes('tesla')) return 'NACS';
  if (normalized.includes('ccs') || normalized.includes('type1ccs')) return 'CCS1';
  if (normalized.includes('chademo')) return 'CHAdeMO';
  if (normalized.includes('type1') || normalized.includes('j1772')) return 'J1772';
  return null;
}

export function normalizeTomTomDirectoryResults(results: unknown[], origin: Point): Station[] {
  const stations: Station[] = [];
  for (const item of results) {
    const source = asRecord(item);
    const position = asRecord(source?.position);
    const lat = asNumber(position?.lat);
    const lon = asNumber(position?.lon);
    if (lat === null || lon === null) continue;
    const poi = asRecord(source?.poi);
    const addressRecord = asRecord(source?.address);
    const chargingPark = asRecord(source?.chargingPark);
    const connectors = new Set<Station['connectors'][number]>();
    let maxPower: number | null = null;
    const connectorPower: Record<string, number | null> = {};
    for (const connector of Array.isArray(chargingPark?.connectors) ? chargingPark.connectors : []) {
      const connectorRecord = asRecord(connector);
      const rawType = asString(connectorRecord?.standardConnectorType) || asString(connectorRecord?.type) || asString(connectorRecord?.connectorType);
      if (!rawType) continue;
      const mapped = connectorFromTomTom(rawType);
      if (!mapped) continue;
      connectors.add(mapped);
      const connectorPowerKw = asNumber(connectorRecord?.maxPowerKW) ?? asNumber(connectorRecord?.powerKW);
      if (connectorPowerKw !== null && connectorPowerKw > 0) {
        connectorPower[mapped] = Math.max(connectorPower[mapped] || 0, connectorPowerKw);
        maxPower = maxPower === null ? connectorPowerKw : Math.max(maxPower, connectorPowerKw);
      } else if (!(mapped in connectorPower)) {
        connectorPower[mapped] = null;
      }
    }
    const id = asString(source?.id) || `${lat.toFixed(5)},${lon.toFixed(5)}`;
    const freeformAddress = asString(addressRecord?.freeformAddress);
    const address = freeformAddress || [asString(addressRecord?.streetNumber), asString(addressRecord?.streetName), asString(addressRecord?.municipality)].filter(Boolean).join(' ');
    const network = asString(poi?.name) || asString(poi?.brand) || 'TomTom listing';
    stations.push({
      id: `tomtom/${id}`,
      name: asString(poi?.name) || 'EV charging station',
      lat,
      lon,
      network,
      connectors: [...connectors],
      power: maxPower,
      connectorPower: Object.keys(connectorPower).length ? connectorPower : undefined,
      ports: null,
      fee: 'Price not listed',
      hours: 'Hours not listed',
      access: 'Access not listed',
      address,
      sourceUrl: 'https://www.tomtom.com/',
      updated: null,
      distance: miles(origin, { lat, lon }),
      toilets: 'unknown',
      website: null,
      status: 'unknown',
      timeZone: null,
      operatorObservation: null,
      operatorTariff: null,
    });
  }
  return [...new Map(stations.map(station => [station.id, station])).values()].sort((a, b) => a.distance - b.distance).slice(0, 250);
}
