import { z } from 'zod';
import { miles, tripSchema, type Station, type RoadRoute, type Point } from './ev.ts';
import { evaluateAvailability, type PersonalReport, type AvailabilityInfo } from './station-evidence.ts';
import { evaluateStationHours, type HoursInfo } from './opening-hours.ts';
import type { BackupOption } from './backup-charger.ts';
import type { PreferenceSummary } from './route-preferences.ts';
import type { PriceInfo } from './station-evidence.ts';
import type { MultiStopItinerary } from './multi-stop-itinerary.ts';

export const smartStopSchema = tripSchema.extend({
  excludedStationIds: z.array(z.string().regex(/^(node|way|relation)\/\d+$/)).max(20).optional(),
  reserve: z.number().min(10).max(30).default(15),
  maxDetourMinutes: z.number().min(5).max(60).default(20),
  batteryCapacity: z.number().min(10).max(250).nullable().default(null),
  vehicleMaxKW: z.number().min(1).max(500).nullable().default(null),
  noStranding: z.boolean().default(true),
  failureAllowance: z.number().min(1).max(10).default(3),
  failureDelayMinutes: z.number().min(0).max(60).default(10),
  preference: z.enum(['balanced','fastest','cheapest','safest']).default('balanced'),
  enteredRates: z.record(z.string().regex(/^(node|way|relation)\/\d+$/),z.string().max(12)).refine(rates=>Object.keys(rates).length<=50,'Use at most 50 station rates per plan.').default({}),
});
export type SmartStopInput = z.infer<typeof smartStopSchema>;
export type RoadLegs = { toMiles: number; toMinutes: number; onwardMiles: number; onwardMinutes: number; snapMeters: number };
export type CandidateInput = { station: Station; legs: RoadLegs | null };
export type RankedStop = {
  station: Station; legs: RoadLegs; arrivalBattery: number; arrivalAt: string;
  detourMinutes: number; detourMiles: number; targetBattery: number;
  listedKW: number | null; usableKW: number | null; chargeMinutes: number | null; energyKwh: number | null;
  availability: AvailabilityInfo; personalReport: PersonalReport | null; hours: HoursInfo; reasons: string[]; warnings: string[];
  rankPoints: number; adjustments: { label: string; points: number }[];
  backup: BackupOption | null;
};
export type Exclusion = 'connector' | 'unavailable' | 'access' | 'road' | 'reserve' | 'detour' | 'hours' | 'no-charge' | 'backup';
export type SmartStopResult = {
  input: SmartStopInput;
  state: 'suggested' | 'no-charge-needed' | 'reserve-too-low' | 'no-suitable-stop' | 'no-backup-confirmed' | 'preference-unavailable';
  message: string; baseRoute: RoadRoute; route: RoadRoute;
  selected: RankedStop | null; candidates: RankedStop[];
  excluded: Partial<Record<Exclusion,number>>;
  mappedCount: number; roadCheckedCount: number; searchLimited: boolean;
  directoryFetchedAt: string | null; calculatedAt: string; validUntil: string;
  preferenceSummary?: PreferenceSummary;
  selectedPrice?: PriceInfo;
  routeOptions?: { stop: RankedStop; route: RoadRoute; price: PriceInfo }[];
  comparisonNote?: string;
  userSelectedRoute?: boolean;
  itinerary?: MultiStopItinerary;
};

export function reachableMiles(input: SmartStopInput) { return Math.max(0, input.profile.range * (input.battery - input.reserve) / 100); }
export function arrivalBattery(input: SmartStopInput, distance: number) { return input.battery - distance / input.profile.range * 100; }
export function connectorKW(station: Station, connector: string): number | null {
  const power = station.connectorPower?.[connector];
  return typeof power === 'number' && Number.isFinite(power) && power > 0 ? power : null;
}

// Approximate route progress is used only to search and shortlist. Reachability
// and extra driving are always checked against directed road distances later.
export function routeSamples(route: RoadRoute, maxMiles: number, gapMiles = 2): { lat: number; lon: number; mile: number }[] {
  if (route.coordinates.length < 2 || !Number.isFinite(route.miles) || route.miles <= 0) return [];
  const segments = route.coordinates.map((p,i) => i ? miles({ lat: route.coordinates[i-1][1], lon: route.coordinates[i-1][0] }, { lat: p[1], lon: p[0] }) : 0);
  const geometryMiles = segments.reduce((sum,n)=>sum+n,0);
  if (!geometryMiles) return [];
  const limit = Math.min(maxMiles, route.miles), step = Math.max(gapMiles, limit / 300);
  const result = [{ lon: route.coordinates[0][0], lat: route.coordinates[0][1], mile: 0 }];
  let cumulative = 0, next = step;
  for (let i=1;i<route.coordinates.length;i++) {
    const end = cumulative + segments[i] / geometryMiles * route.miles;
    while (next <= Math.min(end, limit) + 1e-8) {
      const fraction = end > cumulative ? (next-cumulative)/(end-cumulative) : 0;
      result.push({ lon: route.coordinates[i-1][0] + (route.coordinates[i][0]-route.coordinates[i-1][0])*fraction,
        lat: route.coordinates[i-1][1] + (route.coordinates[i][1]-route.coordinates[i-1][1])*fraction, mile: next });
      next += step;
    }
    if (end >= limit) {
      const fraction = end > cumulative ? (limit-cumulative)/(end-cumulative) : 0;
      if (limit > result.at(-1)!.mile + 0.01) result.push({ lon: route.coordinates[i-1][0] + (route.coordinates[i][0]-route.coordinates[i-1][0])*fraction,
        lat: route.coordinates[i-1][1] + (route.coordinates[i][1]-route.coordinates[i-1][1])*fraction, mile: limit });
      break;
    }
    cumulative = end;
  }
  return result;
}

export function corridorQuery(input: SmartStopInput, route: RoadRoute): string {
  const samples=routeSamples(route,reachableMiles(input));
  if(!samples.length)throw new Error('The route geometry could not be used to search for chargers.');
  const socketTags:Record<string,string[]>={CCS1:['socket:type1_combo'],J1772:['socket:type1'],NACS:['socket:nacs','socket:tesla_supercharger','socket:tesla_destination'],CHAdeMO:['socket:chademo']};
  const latitudePadding=10/69;
  const longitudePadding=10/(69*Math.max(0.1,Math.cos(Math.max(...samples.map(p=>Math.abs(p.lat)))*Math.PI/180)));
  const bounds=[Math.max(-90,Math.min(...samples.map(p=>p.lat))-latitudePadding),Math.max(-180,Math.min(...samples.map(p=>p.lon))-longitudePadding),Math.min(90,Math.max(...samples.map(p=>p.lat))+latitudePadding),Math.min(180,Math.max(...samples.map(p=>p.lon))+longitudePadding)].map(n=>n.toFixed(5)).join(',');
  const selectors=socketTags[input.profile.connector].map(tag=>`nwr.route_chargers["${tag}"]["${tag}"!~"^(0|no)$"];`).join('');
  return `[out:json][timeout:12][maxsize:67108864];nwr[amenity=charging_station](${bounds})->.route_chargers;(${selectors});out center meta 401;`;
}

export function shortlistStations(stations: Station[], input: SmartStopInput, route: RoadRoute, reports: Record<string,PersonalReport>, now: number, count = 16): Station[] {
  const reach = reachableMiles(input), samples = routeSamples(route, reach);
  const goal = Math.max(0, reach - input.profile.range * 0.1);
  const seen = new Set<string>();
  return stations.filter(station => {
    if (input.excludedStationIds?.includes(station.id)) return false;
    if (seen.has(station.id)) return false; seen.add(station.id);
    return station.connectors.includes(input.profile.connector) && !['planned','temporarily unavailable'].includes(station.status)
      && !['no','private','permit','delivery'].includes(station.access) && miles(input.origin, station) <= reach
      && evaluateAvailability(station, reports[station.id], now).condition !== 'unavailable';
  }).map(station => {
    let nearest:{mile:number;off:number}|null=null;
    for(const p of samples){const off=miles(p,station);if(!nearest||off<nearest.off)nearest={mile:p.mile,off};}
    return {station,off:nearest?.off??Infinity,approx:nearest ? nearest.off*4 + Math.abs(nearest.mile-goal)*0.15 + (connectorKW(station,input.profile.connector) === null ? 10 : 0) : Infinity};
  }).filter(item=>item.off<=10).sort((a,b)=>a.approx-b.approx || a.station.id.localeCompare(b.station.id)).slice(0,count).map(item=>item.station);
}

function evaluateCandidate(candidate: CandidateInput, input: SmartStopInput, base: RoadRoute, report: PersonalReport | undefined, now: number): RankedStop | Exclusion {
  const {station,legs} = candidate;
  if (!station.connectors.includes(input.profile.connector)) return 'connector';
  const availability = evaluateAvailability(station,report,now);
  if (['planned','temporarily unavailable'].includes(station.status) || availability.condition === 'unavailable') return 'unavailable';
  if (['no','private','permit','delivery'].includes(station.access)) return 'access';
  if (!legs || !Object.values(legs).every(n=>Number.isFinite(n)&&n>=0) || legs.snapMeters>150) return 'road';
  const battery = arrivalBattery(input,legs.toMiles);
  if (battery + 1e-8 < input.reserve) return 'reserve';
  const rawDetour = legs.toMinutes + legs.onwardMinutes - base.minutes;
  if (rawDetour < -1 || legs.toMiles + legs.onwardMiles + 0.5 < base.miles) return 'road';
  const detourMinutes = Math.max(0,rawDetour), detourMiles=Math.max(0,legs.toMiles+legs.onwardMiles-base.miles);
  if (detourMinutes > input.maxDetourMinutes + 1e-8) return 'detour';
  const arrivalAt = new Date(now + legs.toMinutes * 60_000).toISOString();
  const hours = evaluateStationHours(station,new Date(arrivalAt));
  if (hours.state==='closed'||hours.state==='unavailable') return 'hours';
  const targetBattery = Math.min(80,Math.max(input.reserve + legs.onwardMiles/input.profile.range*100, battery + 1));
  if (targetBattery <= battery) return 'no-charge';
  const listedKW=connectorKW(station,input.profile.connector), usableKW=listedKW!==null&&input.vehicleMaxKW!==null?Math.min(listedKW,input.vehicleMaxKW):null;
  const energyKwh=input.batteryCapacity!==null?input.batteryCapacity*(targetBattery-battery)/100:null;
  // A visible planning allowance for tapering, not a measured charging curve.
  const chargeMinutes=energyKwh!==null&&usableKW!==null?Math.ceil(energyKwh/usableKW*60*1.25):null;
  if(chargeMinutes!==null) {
    // Reject a known closure during the estimated session, not just at arrival.
    for(let minute=15;minute<chargeMinutes;minute+=15) if(evaluateStationHours(station,new Date(Date.parse(arrivalAt)+minute*60_000)).state==='closed') return 'hours';
    if(evaluateStationHours(station,new Date(Date.parse(arrivalAt)+chargeMinutes*60_000)).state==='closed') return 'hours';
  }
  const speedBasis=usableKW??listedKW;
  const adjustments=[
    {label:'Extra driving minutes',points:detourMinutes},
    {label:'Stopping early',points:Math.max(0,battery-input.reserve-10)*0.75},
    {label:'Charging speed',points:speedBasis===null?25:25*(1-Math.min(speedBasis,150)/150)},
    {label:'Availability uncertainty',points:availability.freshness==='live'&&availability.condition==='available'?0:availability.condition==='working'?5:availability.condition==='busy'?25:15},
    {label:'Opening-hours uncertainty',points:hours.state==='unknown'?10:0},
    {label:'Access uncertainty',points:['yes','permissive'].includes(station.access)?0:10},
  ];
  const reasons=[
    `${legs.toMiles.toFixed(1)} road miles from your start; estimated arrival battery ${battery.toFixed(1)}%, above your ${input.reserve}% reserve.`,
    `${detourMinutes.toFixed(1)} extra driving minutes (${detourMiles.toFixed(1)} miles), within your ${input.maxDetourMinutes}-minute limit.`,
    `The listing includes your selected ${input.profile.connector} connector.`,
    listedKW!==null?`${listedKW} kW is listed for that connector${usableKW!==null?`; capped at ${usableKW} kW for this estimate`:'; your vehicle speed limit is not supplied'}.`:'Power for your connector is not supplied; speed received an uncertainty adjustment.',
    hours.state==='open'?'Listed opening hours cover the estimated arrival time.':'Opening hours at arrival could not be confirmed.',
    `Availability evidence: ${availability.label}.`,
  ];
  const warnings=[
    'Confirm adapter, model-year and network access before driving to this station.',
    targetBattery-legs.onwardMiles/input.profile.range*100+1e-8>=input.reserve?'This one planned charge can cover the remaining road under your entered range, if the target battery is reached.':'The remaining charging itinerary has not been planned. This is a next-stop suggestion.',
    'Arrival battery uses your entered full-battery range. Weather, elevation, traffic and battery condition are not modeled.',
  ];
  if(availability.freshness!=='live'||availability.condition!=='available')warnings.unshift('A working, free port is not confirmed. Check the operator before departure.');
  if(availability.condition==='busy')warnings.unshift('The latest observation says busy. No waiting-time forecast is available.');
  if(!['yes','permissive'].includes(station.access))warnings.push(`Access is ${station.access==='Access not listed'?'not confirmed':`listed as ${station.access}`}. Check entry restrictions.`);
  if(hours.state==='unknown')warnings.push('Check station opening hours for your arrival.');
  if(chargeMinutes===null)warnings.push('Charge time is unavailable without connector power, battery capacity and your vehicle charging limit.');
  if(legs.snapMeters>25)warnings.push(`The routed road endpoint is ${Math.round(legs.snapMeters)} meters from the mapped charger. Confirm the entrance.`);
  return {station,legs,arrivalBattery:battery,arrivalAt,detourMinutes,detourMiles,targetBattery,listedKW,usableKW,chargeMinutes,energyKwh,availability,personalReport:report||null,hours,reasons,warnings,rankPoints:adjustments.reduce((sum,item)=>sum+item.points,0),adjustments,backup:null};
}

export function rankStops(candidates: CandidateInput[], input: SmartStopInput, base: RoadRoute, reports: Record<string,PersonalReport>, now: number) {
  const ranked:RankedStop[]=[], excluded:Partial<Record<Exclusion,number>>={};
  for(const candidate of candidates){const result=evaluateCandidate(candidate,input,base,reports[candidate.station.id],now);if(typeof result==='string')excluded[result]=(excluded[result]||0)+1;else ranked.push(result);}
  ranked.sort((a,b)=>a.rankPoints-b.rankPoints || a.detourMinutes-b.detourMinutes || a.station.id.localeCompare(b.station.id));
  return {ranked,excluded};
}

export function routeCoordinates(points: Pick<Point,'lat'|'lon'>[]): string { return points.map(p=>`${p.lon.toFixed(5)},${p.lat.toFixed(5)}`).join(';'); }
