import { z } from 'zod';
import type { RoadLegs } from './smart-stop.ts';
import type { RoadRoute } from './ev.ts';
import type { RoadConnection } from './backup-charger.ts';

const endpointSnapToleranceMeters=5000;

const number=z.number().finite().nonnegative();
const waypoint=z.object({distance:number,location:z.tuple([z.number().min(-180).max(180),z.number().min(-90).max(90)])});
const routeResponse=z.object({code:z.literal('Ok'),waypoints:z.array(waypoint),routes:z.array(z.object({
  distance:number,duration:number,legs:z.array(z.object({distance:number,duration:number})),
  geometry:z.object({coordinates:z.array(z.tuple([z.number().min(-180).max(180),z.number().min(-90).max(90)])).min(2).max(80000)}),
})).min(1)});
const matrixResponse=z.object({code:z.literal('Ok'),sources:z.array(waypoint),destinations:z.array(waypoint),
  distances:z.array(z.array(number.nullable())),durations:z.array(z.array(number.nullable())),
  fallback_speed_cells:z.array(z.tuple([z.number().int().nonnegative(),z.number().int().nonnegative()])).optional(),
});

export function parseRoadResponse(value:unknown,points:number) {
  const data=routeResponse.parse(value),route=data.routes[0];
  if(data.waypoints.length!==points||route.legs.length!==points-1||data.waypoints[0].distance>endpointSnapToleranceMeters||data.waypoints.at(-1)!.distance>endpointSnapToleranceMeters)throw new Error('Road endpoints could not be matched closely enough. Choose a more precise start and destination.');
  if(Math.abs(route.legs.reduce((sum,leg)=>sum+leg.distance,0)-route.distance)>2||Math.abs(route.legs.reduce((sum,leg)=>sum+leg.duration,0)-route.duration)>2)throw new Error('The road response was inconsistent. Try the route again.');
  return {road:{coordinates:route.geometry.coordinates,miles:route.distance/1609.344,minutes:route.duration/60} as Omit<RoadRoute,'fetchedAt'>,
    legs:route.legs.map(leg=>({miles:leg.distance/1609.344,minutes:leg.duration/60})),snaps:data.waypoints.map(point=>point.distance)};
}

export type ChargingRoadGraph={legs:(RoadLegs|null)[];connections:(RoadConnection|null)[][]};

export function parseChargingRoadGraph(value:unknown,stationCount:number):ChargingRoadGraph {
  const data=matrixResponse.parse(value),count=stationCount+2,last=count-1;
  if(data.sources.length!==count||data.destinations.length!==count||data.distances.length!==count||data.durations.length!==count||data.distances.some(row=>row.length!==count)||data.durations.some(row=>row.length!==count))throw new Error('The road comparison was incomplete. Try again.');
  if([data.sources[0],data.destinations[0],data.sources[last],data.destinations[last]].some(point=>point.distance>endpointSnapToleranceMeters))throw new Error('Road endpoints could not be matched closely enough. Choose more precise locations.');
  const fallback=new Set((data.fallback_speed_cells||[]).map(([i,j])=>`${i}:${j}`));
  const legs=Array.from({length:stationCount},(_,index)=>{
    const j=index+1,distances=[data.distances[0][j],data.distances[j][last]],durations=[data.durations[0][j],data.durations[j][last]];
    if([...distances,...durations].some(value=>value===null)||fallback.has(`0:${j}`)||fallback.has(`${j}:${last}`))return null;
    return {toMiles:distances[0]!/1609.344,onwardMiles:distances[1]!/1609.344,toMinutes:durations[0]!/60,onwardMinutes:durations[1]!/60,snapMeters:Math.max(data.sources[j].distance,data.destinations[j].distance)};
  });
  const connections=Array.from({length:stationCount},(_,from)=>Array.from({length:stationCount},(_,to)=>{
    const i=from+1,j=to+1,distance=data.distances[i][j],duration=data.durations[i][j];
    if(from===to||distance===null||duration===null||fallback.has(`${i}:${j}`))return null;
    return {miles:distance/1609.344,minutes:duration/60,fromSnapMeters:Math.max(data.sources[i].distance,data.destinations[i].distance),toSnapMeters:Math.max(data.sources[j].distance,data.destinations[j].distance)};
  }));
  return {legs,connections};
}

export function parseMatrixResponse(value:unknown,stationCount:number): (RoadLegs|null)[] {
  return parseChargingRoadGraph(value,stationCount).legs;
}
