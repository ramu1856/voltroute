import type { OperatorObservation } from './station-evidence.ts';
import { miles } from './ev.ts';

export const TOMTOM_CONNECTOR:Record<string,string>={
  NACS:'Tesla',
  CCS1:'IEC62196Type1CCS',
  J1772:'IEC62196Type1',
  CHAdeMO:'Chademo',
};

type NearbyResult={
  position?:{lat?:number;lon?:number};
  poi?:{name?:string};
  dataSources?:{chargingAvailability?:{id?:string}};
};

type AvailabilityCurrent={
  available?:number;occupied?:number;reserved?:number;unknown?:number;outOfService?:number;
};
type AvailabilityConnector={
  type?:string;total?:number;availability?:{current?:AvailabilityCurrent};
};
type AvailabilityResponse={connectors?:AvailabilityConnector[];chargingAvailability?:string};

const validCount=(value:unknown):value is number=>Number.isInteger(value)&&Number(value)>=0;
const normalizedWords=(value:string)=>new Set(value.toLowerCase().replace(/[^a-z0-9]+/g,' ').trim().split(/\s+/).filter(word=>word.length>2));
function nameOverlap(a:string,b:string){
  const left=normalizedWords(a),right=normalizedWords(b);
  let matches=0;
  for(const word of left)if(right.has(word))matches++;
  return matches;
}

export function chooseTomTomAvailabilitySource(
  results:NearbyResult[],
  station:{lat:number;lon:number;name:string;network:string},
  maxDistanceMiles=.25,
){
  const candidates=results.flatMap(result=>{
    const lat=result.position?.lat,lon=result.position?.lon,id=result.dataSources?.chargingAvailability?.id;
    if(!Number.isFinite(lat)||!Number.isFinite(lon)||typeof id!=='string'||!id.trim())return [];
    const distance=miles(station,{lat:Number(lat),lon:Number(lon)});
    if(distance>maxDistanceMiles)return [];
    const name=result.poi?.name||'';
    const overlap=Math.max(nameOverlap(name,station.name),nameOverlap(name,station.network));
    return [{id:id.trim(),name:name||'TomTom EV charging station',distanceMiles:distance,overlap}];
  });
  candidates.sort((a,b)=>b.overlap-a.overlap||a.distanceMiles-b.distanceMiles);
  if(!candidates.length)return null;
  const best=candidates[0];
  // For a weak name match, only trust a very close location. This avoids
  // attaching another station's live data in dense charging areas.
  if(best.overlap===0&&best.distanceMiles>.08)return null;
  return best;
}

export function tomTomOperatorObservation(
  stationId:string,
  response:AvailabilityResponse,
  observedAt=new Date().toISOString(),
):OperatorObservation|null{
  if(!stationId||!Array.isArray(response.connectors)||!response.connectors.length)return null;
  let total=0,available=0,occupied=0,reserved=0,outOfService=0,usable=0;
  for(const connector of response.connectors){
    if(!validCount(connector.total))continue;
    const current=connector.availability?.current;
    if(!current)continue;
    const counts=[current.available,current.occupied,current.reserved,current.unknown,current.outOfService];
    if(!counts.every(validCount))continue;
    const sum=counts.reduce((a,b)=>a+Number(b),0);
    if(sum>connector.total)continue;
    usable++;
    total+=connector.total;
    available+=current.available!;
    occupied+=current.occupied!;
    reserved+=current.reserved!;
    outOfService+=current.outOfService!;
  }
  if(!usable||total<1)return null;
  let status:OperatorObservation['status']|null=null;
  if(available>0)status='available';
  else if(outOfService>=total)status='unavailable';
  else if(occupied+reserved>0)status='busy';
  // If every connector is simply unknown, do not invent a current condition.
  if(!status)return null;
  return {
    stationId,
    source:'operator',
    provider:'TomTom EV Charging Availability',
    sourceUrl:'https://www.tomtom.com/',
    observedAt,
    status,
    availablePorts:available,
    totalPorts:total,
  };
}
