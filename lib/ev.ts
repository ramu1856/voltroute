import { z } from 'zod';
import type { OperatorObservation, OperatorTariff } from './station-evidence';
export const pointSchema = z.object({ lat: z.number().min(-90).max(90), lon: z.number().min(-180).max(180), label: z.string().min(1).max(200) });
export const profileSchema = z.object({ name: z.string().trim().min(1).max(80), connector: z.enum(['NACS', 'CCS1', 'J1772', 'CHAdeMO']), range: z.number().min(30).max(600) });
export const tripSchema = z.object({ origin: pointSchema, destination: pointSchema, profile: profileSchema, battery: z.number().min(1).max(100) });
export type Point = z.infer<typeof pointSchema>;
export type Profile = z.infer<typeof profileSchema>;
export type TripInput = z.infer<typeof tripSchema>;
export type StationStatus = 'open' | 'temporarily unavailable' | 'planned' | 'unknown';
export type Station = { id: string; name: string; lat: number; lon: number; network: string; connectors: string[]; power: number | null; connectorPower?: Record<string,number|null>; ports: string | null; fee: string; hours: string; access: string; address: string; sourceUrl: string; updated: string | null; distance: number; toilets: string; website: string | null; status: StationStatus; timeZone?: string | null; operatorObservation?: OperatorObservation | null; operatorTariff?: OperatorTariff | null };
export type Amenity = { id: string; name: string; lat: number; lon: number; kind: 'food' | 'restroom' | 'shopping'; category?: 'meal' | 'coffee' | 'restroom' | 'shopping'; distance: number; hours: string; access: string; fee: string; wheelchair: string; sourceUrl: string };
export type RoadRoute = { coordinates: [number,number][]; miles: number; minutes: number; fetchedAt: string };
export type OSMElement = { id: number; type: string; lat?: number; lon?: number; center?: {lat:number;lon:number}; timestamp?: string; tags?: Record<string,string> };
export const defaultProfile: Profile = { name: 'Tesla Model Y', connector: 'NACS', range: 337 };
export const chicago: Point = {lat:41.8781,lon:-87.6298,label:'Chicago, IL'};
export const detroit: Point = {lat:42.3314,lon:-83.0458,label:'Detroit, MI'};
export function miles(a: {lat:number;lon:number}, b: {lat:number;lon:number}) {
  const rad = Math.PI / 180;
  const h = Math.sin((b.lat-a.lat)*rad/2)**2 + Math.cos(a.lat*rad)*Math.cos(b.lat*rad)*Math.sin((b.lon-a.lon)*rad/2)**2;
  return 3958.7613*2*Math.asin(Math.sqrt(Math.min(1,h)));
}
export function safeWeb(value?: string): string | null { try { const u = new URL(value || ''); return u.protocol === 'https:' || u.protocol === 'http:' ? u.href : null; } catch { return null; } }
export function powerKW(value: string): number | null {
  const matches = [...value.matchAll(/(\d+(?:\.\d+)?)\s*(kW|W)\b/gi)].map(m => Number(m[1]) / (m[2].toLowerCase()==='w'?1000:1));
  return matches.length ? Math.max(...matches) : null;
}
export function normalizeStation(e: OSMElement, origin: {lat:number;lon:number}): Station | null {
  const t = e.tags || {}; const lat=e.lat ?? e.center?.lat; const lon=e.lon ?? e.center?.lon;
  if (lat === undefined || lon === undefined || ['private','no'].includes(t.access)) return null;
  const sockets: Record<string,string> = { 'socket:type1_combo':'CCS1', 'socket:type1':'J1772', 'socket:tesla_supercharger':'NACS', 'socket:tesla_destination':'NACS', 'socket:nacs':'NACS', 'socket:chademo':'CHAdeMO' };
  const connectors = [...new Set(Object.entries(sockets).filter(([key]) => t[key] && t[key] !== '0' && t[key] !== 'no').map(([,name])=>name))];
  const connectorPower:Record<string,number|null>={};
  for(const [key,name] of Object.entries(sockets)) if(t[key]&&t[key]!=='0'&&t[key]!=='no') {
    const power=powerKW(t[`${key}:output`]||'');
    connectorPower[name]=power!==null&&power>0?Math.max(connectorPower[name]||0,power):connectorPower[name]??null;
  }
  const powers = Object.entries(t).filter(([k]) => k.endsWith(':output') || k === 'charging_station:output').map(([,v])=>powerKW(v)).filter((v):v is number=>v!==null);
  const rawStatus=(t.operational_status || t.status || '').toLowerCase();
  const status:StationStatus=rawStatus.includes('temporary')||rawStatus==='closed'?'temporarily unavailable':rawStatus.includes('planned')||rawStatus.includes('construction')?'planned':['operational','open','active','working'].includes(rawStatus)?'open':'unknown';
  return { id:`${e.type}/${e.id}`,name:t.name || t.operator || t.network || 'EV charging station',lat,lon,network:t.network || t.operator || 'Network not listed',connectors,connectorPower,power:powers.length?Math.max(...powers):null,ports:t.capacity || null,fee:t['charge'] || (t.fee==='no'?'Listed as free':t.fee==='yes'?'Fee applies; price not listed':'Price not listed'),hours:t.opening_hours || 'Hours not listed',access:t.access || 'Access not listed',address:[t['addr:housenumber'],t['addr:street'],t['addr:city']].filter(Boolean).join(' '),sourceUrl:`https://www.openstreetmap.org/${e.type}/${e.id}`,updated:e.timestamp||null,distance:miles(origin,{lat,lon}),toilets:t.toilets || 'unknown',website:safeWeb(t.website || t['contact:website']),status,timeZone:t.timezone || null };
}
export function normalizeAmenities(elements: OSMElement[], origin:{lat:number;lon:number}): Amenity[] {
  const result: Amenity[]=[];
  for (const e of elements) {
    const t=e.tags || {}, lat=e.lat ?? e.center?.lat, lon=e.lon ?? e.center?.lon;
    if(lat===undefined || lon===undefined || ['private','no'].includes(t.access)) continue;
    const common={lat,lon,distance:miles(origin,{lat,lon}),hours:t.opening_hours || 'Hours not listed',fee:t.fee || 'unknown',wheelchair:t.wheelchair || 'unknown',sourceUrl:`https://www.openstreetmap.org/${e.type}/${e.id}`};
    if(['restaurant','cafe','fast_food','food_court'].includes(t.amenity)) result.push({...common,id:`${e.type}/${e.id}/food`,name:t.name || t.amenity.replaceAll('_',' '),kind:'food',category:t.amenity==='cafe'?'coffee':'meal',access:t.access || 'Access not listed'});
    if(['supermarket','convenience','mall','department_store'].includes(t.shop)) result.push({...common,id:`${e.type}/${e.id}/shopping`,name:t.name || t.shop.replaceAll('_',' '),kind:'shopping',category:'shopping',access:t.access || 'Access not listed'});
    if(t.amenity==='toilets' || t.toilets==='yes') {
      const access=t['toilets:access'] || t.access || 'Access not listed';
      if(!['private','no'].includes(access)) result.push({...common,id:`${e.type}/${e.id}/restroom`,name:t.amenity==='toilets'?(t.name || 'Mapped restroom'):`Restroom at ${t.name || t.amenity || 'venue'}`,kind:'restroom',access,fee:t['toilets:fee'] || t.fee || 'unknown'});
    }
  }
  return result.filter(p=>p.distance<=.51).sort((a,b)=>a.distance-b.distance);
}
export function chargingCheckpoints(route:RoadRoute,profile:Profile,battery:number) {
  const first = Math.max(0,profile.range*(battery-15)/100);
  const interval=profile.range*.65;
  const stops:number[]=[];
  if(route.miles>first) for(let d=first;d<route.miles && stops.length<30;d+=interval) stops.push(d);
  let cumulative=0,index=0; const points:{mile:number;lat:number;lon:number}[]=[];
  const segments=route.coordinates.map((c,i)=>i?miles({lat:route.coordinates[i-1][1],lon:route.coordinates[i-1][0]},{lat:c[1],lon:c[0]}):0);
  const total=segments.reduce((a,b)=>a+b,0) || 1;
  for(let i=0;i<route.coordinates.length && index<stops.length;i++) {
    cumulative+=segments[i];
    while(index<stops.length && cumulative/total*route.miles>=stops[index]) {points.push({mile:Math.round(stops[index]),lat:route.coordinates[i][1],lon:route.coordinates[i][0]});index++;}
  }
  return points;
}
