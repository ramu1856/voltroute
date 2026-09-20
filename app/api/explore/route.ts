import { env } from 'cloudflare:workers';
import { z } from 'zod';
import { cached, cachedDirectory, failure, fetchJson, ServiceError } from '@/lib/server-data';
import { miles, normalizeAmenities, normalizeStation, type Point, type Station } from '@/lib/ev';
import { chooseTomTomAvailabilitySource, TOMTOM_CONNECTOR, tomTomOperatorObservation } from '@/lib/tomtom-live';
import { fetchOverpass, overpassEndpoints } from '@/lib/overpass';
const coords=z.object({lat:z.coerce.number().min(-90).max(90),lon:z.coerce.number().min(-180).max(180)});
const tomTomHeaders = { Referer: 'https://voltroutes.com/' };

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
function normalizeTomTomDirectoryResults(results: unknown[], origin: Point): Station[] {
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
async function fetchTomTomStations(point: Point, radius: number, settings: Record<string, string | undefined>) {
  const apiKey = settings.TOMTOM_API_KEY?.trim();
  if (!apiKey) return [] as Station[];
  const searchRadius = Math.min(50000, Math.max(25000, Math.round(radius)));
  const nearby = await cached(`tomtom-explore:v2:${point.lat.toFixed(4)}:${point.lon.toFixed(4)}:${searchRadius}`, 'tomtom', 300, async () => {
    const url = new URL('/search/2/nearbySearch/.json', 'https://api.tomtom.com');
    url.search = new URLSearchParams({
      key: apiKey,
      lat: String(point.lat),
      lon: String(point.lon),
      radius: String(searchRadius),
      limit: '100',
      categorySet: '7309',
    }).toString();
    return fetchJson(url.href, { headers: tomTomHeaders }) as Promise<{ results?: unknown[] }>;
  });
  return normalizeTomTomDirectoryResults((nearby.data.results || []) as unknown[], point);
}

export async function GET(request:Request) {
 try {
  const q=new URL(request.url).searchParams;const action=q.get('action');
  const settings=env as unknown as Record<string,string>;
  if(action==='search') {
    const text=z.string().trim().min(2).max(160).parse(q.get('q'));
    const url=new URL('/api/',settings.PHOTON_URL || 'https://photon.komoot.io');url.search=new URLSearchParams({q:text,limit:'6',countrycode:'US',lang:'en'}).toString();
    const result=await cached(`photon:v1:${text.toLowerCase()}`,'photon',86400,async()=> {
      const json=await fetchJson(url.href) as {features:{geometry:{coordinates:number[]};properties:Record<string,string>}[]};
      return json.features.filter(f=>f.geometry?.coordinates?.length===2 && (f.properties.countrycode||'').toUpperCase()==='US').map(f=>({lat:f.geometry.coordinates[1],lon:f.geometry.coordinates[0],label:[f.properties.name,f.properties.city,f.properties.state,f.properties.postcode].filter((v,i,a)=>v&&a.indexOf(v)===i).join(', ')} satisfies Point));
    });return Response.json(result);
  }
  if(action==='live-station') {
    const point=coords.parse({lat:q.get('lat')??undefined,lon:q.get('lon')??undefined});
    const stationId=z.string().trim().min(1).max(120).parse(q.get('stationId'));
    const name=z.string().trim().min(1).max(160).parse(q.get('name'));
    const network=z.string().trim().min(1).max(160).parse(q.get('network')||'Network not listed');
    const connector=z.enum(['NACS','CCS1','J1772','CHAdeMO']).parse(q.get('connector'));
    const apiKey=settings.TOMTOM_API_KEY?.trim();
    if(!apiKey)return Response.json({data:null,notice:'Live operator status is not configured yet.'},{headers:{'Cache-Control':'private, no-store'}});
    const tomtomConnector=TOMTOM_CONNECTOR[connector];
    try{
      const nearbyUrl=new URL('/search/2/nearbySearch/.json','https://api.tomtom.com');
      nearbyUrl.search=new URLSearchParams({key:apiKey,lat:String(point.lat),lon:String(point.lon),radius:'650',limit:'12',connectorSet:tomtomConnector}).toString();
      const nearby=await cached(`tomtom-nearby:v1:${point.lat.toFixed(4)}:${point.lon.toFixed(4)}:${tomtomConnector}`,'tomtom-nearby',120,async()=>fetchJson(nearbyUrl.href,{headers:tomTomHeaders}) as Promise<{results:unknown[]}>);
      const source=chooseTomTomAvailabilitySource((nearby.data.results||[]) as Parameters<typeof chooseTomTomAvailabilitySource>[0],{...point,name,network});
      if(!source)return Response.json({data:null,notice:'No matching TomTom live-availability station was confirmed near this map listing.'},{headers:{'Cache-Control':'private, no-store'}});
      const availabilityUrl=new URL('/search/2/chargingAvailability.json','https://api.tomtom.com');
      availabilityUrl.search=new URLSearchParams({key:apiKey,chargingAvailability:source.id,connectorSet:tomtomConnector}).toString();
      const availability=await cached(`tomtom-live:v1:${source.id}:${tomtomConnector}`,'tomtom-live',60,async()=>fetchJson(availabilityUrl.href,{headers:tomTomHeaders}));
      const observation=tomTomOperatorObservation(stationId,availability.data as Parameters<typeof tomTomOperatorObservation>[1],availability.fetchedAt);
      return Response.json({data:observation,matched:{name:source.name,distanceMiles:source.distanceMiles},fetchedAt:availability.fetchedAt,notice:observation?null:'TomTom matched the station, but current connector availability was not usable.'},{headers:{'Cache-Control':'private, no-store'}});
    }catch(error){
      if(error instanceof ServiceError&&(error.status===429||error.status===503))return Response.json({data:null,notice:'Live operator availability is temporarily unavailable. Please retry shortly.'},{headers:{'Cache-Control':'private, no-store'}});
      return Response.json({data:null,notice:'TomTom live status could not be used with the current key or settings.'},{headers:{'Cache-Control':'private, no-store'}});
    }
  }
  if(action==='stations' || action==='amenities') {
    const point=coords.parse({lat:q.get('lat')??undefined,lon:q.get('lon')??undefined});
    const radius=action==='stations'?z.coerce.number().min(160934).max(402336).parse(q.get('radius')||'160934'):805;
    const lat=Number(point.lat.toFixed(4)),lon=Number(point.lon.toFixed(4));
    const area=`(around:${radius},${lat},${lon})`;
    const query=action==='stations'?`[out:json][timeout:12][maxsize:67108864];nwr[amenity=charging_station]${area};out center tags 300 qt;`:`[out:json][timeout:10];(nwr[amenity~"^(restaurant|cafe|fast_food|food_court|toilets)$"]${area};nwr[toilets=yes]${area};nwr[shop~"^(supermarket|convenience|mall|department_store)$"]${area};);out center tags qt;`;
    let usedTomTomFallback=false;
    const result=await cachedDirectory(`${action}:${action==='amenities'?'v6':'v7'}:${lat}:${lon}:${radius}`,async()=>{
      if(action==='stations'){
        let overpassError: unknown = null;
        try {
          const elements=await fetchOverpass(query,{endpoints:overpassEndpoints(settings)});
          const deduped=[...new Map(elements.map(e=>[`${e.type}/${e.id}`,e])).values()];
          const mapped=deduped.map(e=>normalizeStation(e,point)).filter(Boolean).sort((a,b)=>a!.distance-b!.distance).slice(0,250);
          if(mapped.length)return mapped;
          overpassError = new ServiceError('No charging stations were confirmed by directory providers for this area right now. Try again shortly.', 503);
        } catch (error) {
          overpassError=error;
        }
        try {
          const tomtomStations=await fetchTomTomStations(point,radius,settings);
          if(tomtomStations.length){usedTomTomFallback=true;return tomtomStations;}
        } catch { /* Keep the community directory path when fallback providers fail. */ }
        if(overpassError)throw overpassError;
        return [] as Station[];
      }
      const elements=await fetchOverpass(query,{endpoints:overpassEndpoints(settings)});
      return normalizeAmenities(elements,point);
    });
    if(action==='stations'&&usedTomTomFallback){
      const notice=[result.notice,'Community directory refresh was unavailable, so TomTom fallback station listings are shown.'].filter(Boolean).join(' ');
      return Response.json({...result,notice},{headers:{'Cache-Control':'private, no-store'}});
    }
    return Response.json(result,{headers:{'Cache-Control':'private, no-store'}});
  }
  if(action==='route') {
    const from=coords.parse({lat:q.get('lat')??undefined,lon:q.get('lon')??undefined});const to=coords.parse({lat:q.get('toLat')??undefined,lon:q.get('toLon')??undefined});
    const pair=`${from.lon.toFixed(4)},${from.lat.toFixed(4)};${to.lon.toFixed(4)},${to.lat.toFixed(4)}`;
    const result=await cached(`road:v1:${pair}`,'osrm',3600,async()=>{
      const url=new URL(`/route/v1/driving/${pair}`,settings.OSRM_URL || 'https://router.project-osrm.org');url.search='overview=full&geometries=geojson&steps=false';
      const json=await fetchJson(url.href) as {code:string;routes:{distance:number;duration:number;geometry:{coordinates:number[][]}}[]};
      if(json.code!=='Ok'||!json.routes?.length)throw new ServiceError('No driving route was found between these locations.',404);
      const r=json.routes[0];return {coordinates:r.geometry.coordinates,miles:r.distance/1609.344,minutes:r.duration/60};
    });return Response.json(result);
  }
  throw new ServiceError('Unknown action.',400);
 }catch(error){return failure(error instanceof z.ZodError?new ServiceError('Please check the location or search input.',400):error);}
}
