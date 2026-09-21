import { env } from 'cloudflare:workers';
import { z } from 'zod';
import { cached, database, failure, fetchJson, limit, sameOrigin, ServiceError, LocalRateLimitError } from '@/lib/server-data';
import { getOptionalUser } from '@/lib/supabase-server';
import { chargingCheckpoints, normalizeStation, type Point, type RoadRoute, type Station } from '@/lib/ev';
import { fetchOverpass, overpassEndpoints } from '@/lib/overpass';
import { arrivalBattery, corridorQuery, rankStops, routeCoordinates, shortlistStations, smartStopSchema, type SmartStopResult } from '@/lib/smart-stop';
import { parseChargingRoadGraph, parseRoadResponse } from '@/lib/smart-stop-routing';
import { assignBackups, attachBackup, backupOptions, evaluateBackup, type BackupOption } from '@/lib/backup-charger';
import type { PersonalReport } from '@/lib/station-evidence';
import { preferStops, preferenceReason } from '@/lib/route-preferences';
import { stopBudget } from '@/lib/trip-budget';
import { buildMultiStopItinerary } from '@/lib/multi-stop-itinerary';
import { normalizeTomTomDirectoryResults } from '@/lib/tomtom-directory';
import { fetchTomTomWithRefererFallback } from '@/lib/tomtom-fetch';

async function key(prefix:string,value:string){const hash=await crypto.subtle.digest('SHA-256',new TextEncoder().encode(value));return `${prefix}:${Array.from(new Uint8Array(hash),v=>v.toString(16).padStart(2,'0')).join('')}`;}
async function providerCache<T>(cacheKey:string,provider:string,loader:()=>Promise<T>){
  // One bounded backoff honors the shared service rate limit between dependent
  // steps. Only raw provider data is cached; personalized rankings never are.
  try{return await cached(cacheKey,provider,3600,loader);}
  catch(error){if(!(error instanceof LocalRateLimitError))throw error;await new Promise(resolve=>setTimeout(resolve,3000));return cached(cacheKey,provider,3600,loader);}
}

export async function POST(request:Request){
  try{
    sameOrigin(request);const user=await getOptionalUser(request);const visitor=user?.userId||request.headers.get('cf-connecting-ip')||'anonymous';await limit(await key('smart-stop',visitor),5000);
    if(Number(request.headers.get('content-length')||0)>8000)throw new ServiceError('Trip input is too large.',400);
    const text=await request.text();if(text.length>8000)throw new ServiceError('Trip input is too large.',400);
    const input=smartStopSchema.parse(JSON.parse(text));
    const settings=env as unknown as Record<string,string>;
    async function roadFor(points:Pick<Point,'lat'|'lon'>[]){
      const coordinates=routeCoordinates(points);
      const result=await providerCache(`smart-road:v1:${coordinates}`,'osrm',async()=>{
        const url=new URL(`/route/v1/driving/${coordinates}`,settings.OSRM_URL||'https://router.project-osrm.org');
        url.search='overview=full&geometries=geojson&steps=false&continue_straight=false';
        try{return parseRoadResponse(await fetchJson(url.href),points.length);}
        catch(error){
          if(error instanceof ServiceError)throw error;
          if(error instanceof Error&&error.message)throw new ServiceError(error.message,400);
          throw new ServiceError('A complete driving route could not be confirmed. Try more precise locations.');
        }
      });return {...result.data,fetchedAt:result.fetchedAt};
    }
    const initial=await roadFor([input.origin,input.destination]);
    const baseRoute:RoadRoute={...initial.road,fetchedAt:initial.fetchedAt};
    const created=Date.now();
    const result:SmartStopResult={input,state:'no-suitable-stop',message:'No mapped stop passed the road, battery and access checks. Try a different route or check a charging operator.',baseRoute,route:baseRoute,selected:null,candidates:[],excluded:{},mappedCount:0,roadCheckedCount:0,searchLimited:false,directoryFetchedAt:null,calculatedAt:new Date(created).toISOString(),validUntil:new Date(created+10*60_000).toISOString()};
    const respond=()=>Response.json(result,{headers:{'Cache-Control':'private, no-store'}});
    if(arrivalBattery(input,baseRoute.miles)>=input.reserve){result.state='no-charge-needed';result.message=`Your entered range suggests arrival with ${arrivalBattery(input,baseRoute.miles).toFixed(1)}% battery, above your ${input.reserve}% reserve. No charging stop is needed under these assumptions.`;return respond();}
    if(input.battery<=input.reserve){result.state='reserve-too-low';result.message=`Your starting battery is at or below your ${input.reserve}% reserve. No driving recommendation can preserve that reserve. Charge before leaving or use a roadside-assistance service.`;return respond();}
    const query=corridorQuery(input,baseRoute);
    async function tomtomFallbackStations(route: RoadRoute) {
      const apiKey=settings.TOMTOM_API_KEY?.trim();
      if(!apiKey)return [] as Station[];
      const samples=[
        input.origin,
        ...chargingCheckpoints(route,input.profile,input.battery).slice(0,2).map(point=>({lat:point.lat,lon:point.lon,label:'Route checkpoint'})),
        input.destination,
      ];
      const deduped=[...new Map(samples.map(sample=>[`${sample.lat.toFixed(3)}:${sample.lon.toFixed(3)}`,sample])).values()];
      const collected: Station[]=[];
      for(const sample of deduped){
        try{
          const nearby=await providerCache(await key('smart-tomtom:v2',`${sample.lat.toFixed(3)}:${sample.lon.toFixed(3)}`),'tomtom',async()=>{
            const url=new URL('/search/2/nearbySearch/.json','https://api.tomtom.com');
            url.search=new URLSearchParams({
              key:apiKey,
              lat:String(sample.lat),
              lon:String(sample.lon),
              radius:'50000',
              limit:'100',
              categorySet:'7309',
            }).toString();
            const response = await fetchTomTomWithRefererFallback<{results?:unknown[]}>(url.href, settings);
            return response.data;
          });
          collected.push(...normalizeTomTomDirectoryResults((nearby.data.results || []) as unknown[], input.origin));
          if(collected.length>=300)break;
        }catch{/* Keep trying alternative route samples. */}
      }
      return [...new Map(collected.map(station=>[station.id,station])).values()].slice(0,400);
    }
    let mapped:{stations:Station[];limited:boolean}={stations:[],limited:false};
    let mappedFetchedAt:string|null=null;
    let usedTomTomFallback=false;
    let directoryError:unknown=null;
    try{
      const directory=await providerCache(await key('smart-corridor:v1',query),'overpass',async()=>{
        const elements=await fetchOverpass(query,{endpoints:overpassEndpoints(settings)});
        return {stations:elements.slice(0,400).map(e=>normalizeStation(e,input.origin)).filter((station):station is Station=>station!==null),limited:elements.length>400};
      });
      mapped=directory.data;
      mappedFetchedAt=directory.fetchedAt;
    }catch(error){
      directoryError=error;
    }
    if(!mapped.stations.length && !directoryError){
      try{
        // Cached empty station lists can occur during short provider outages.
        // Retry once directly so a stale empty cache does not block planning.
        const recoveryElements=await fetchOverpass(query,{endpoints:overpassEndpoints(settings)});
        const recoveryStations=recoveryElements.slice(0,400).map(e=>normalizeStation(e,input.origin)).filter((station):station is Station=>station!==null);
        if(recoveryStations.length){mapped={stations:recoveryStations,limited:recoveryElements.length>400};mappedFetchedAt=new Date().toISOString();}
      }catch{/* Keep the cached snapshot if recovery cannot refresh. */}
    }
    if(!mapped.stations.length){
      const tomtomStations=await tomtomFallbackStations(baseRoute);
      if(tomtomStations.length){
        mapped={stations:tomtomStations,limited:false};
        mappedFetchedAt=new Date().toISOString();
        usedTomTomFallback=true;
      }
    }
    result.mappedCount=mapped.stations.length;result.directoryFetchedAt=mappedFetchedAt;result.searchLimited=mapped.limited;
    if(!mapped.stations.length&&directoryError instanceof ServiceError&&(directoryError.status===429||directoryError.status>=500)){
      result.message='Charging directory providers are temporarily unavailable for this corridor. No recommendation was made. Please retry shortly.';
      result.comparisonNote='Resilience mode: community directory queries failed and TomTom fallback did not return a usable charger shortlist.';
      return respond();
    }
    if(!mapped.stations.length&&directoryError)throw directoryError;
    const records=user?await database().prepare("SELECT payload,updated FROM saved_items WHERE owner=? AND kind='report' ORDER BY updated DESC LIMIT 200").bind(user.userId).all<{payload:string;updated:number}>():{results:[] as {payload:string;updated:number}[]};
    const reports:Record<string,PersonalReport>={};
    for(const row of records.results){try{const value=JSON.parse(row.payload);if(typeof value.sourceId==='string'&&!reports[value.sourceId]&&['working','busy','broken'].includes(value.status))reports[value.sourceId]={sourceId:value.sourceId,status:value.status,reportedAt:row.updated};}catch{/* Ignore an unreadable old personal report. */}}
    const shortlist=shortlistStations(mapped.stations.filter(station=>!input.excludedStationIds?.includes(station.id)),input,baseRoute,reports,Date.now());
    result.searchLimited ||= mapped.stations.length>shortlist.length;
    if(!shortlist.length){
      if(usedTomTomFallback)result.message='Community directory results were unavailable on this corridor. TomTom fallback listings were checked, but none passed connector, reserve, and access filters.';
      return respond();
    }
    const points=[input.origin,...shortlist,input.destination];
    const coordinates=routeCoordinates(points);
    const matrix=await providerCache(await key('smart-matrix:v2',coordinates),'osrm',async()=>{
      const url=new URL(`/table/v1/driving/${coordinates}`,settings.OSRM_URL||'https://router.project-osrm.org');url.search='annotations=distance,duration';
      try{return parseChargingRoadGraph(await fetchJson(url.href),shortlist.length);}
      catch(error){if(error instanceof ServiceError)throw error;throw new ServiceError('Road distances for the chargers could not be confirmed. No straight-line route has been substituted.');}
    });
    result.roadCheckedCount=shortlist.length;
    const now=Date.now();
    const ranked=rankStops(shortlist.map((station,index)=>({station,legs:matrix.data.legs[index]})),input,baseRoute,reports,now);
    result.excluded=ranked.excluded;
    if(!ranked.ranked.length)return respond();
    const backed=assignBackups(ranked.ranked,shortlist,matrix.data.connections,input,reports,now);
    if(backed.excluded)result.excluded.backup=backed.excluded;
    const fallbackCandidates=ranked.ranked.slice(0,3);
    const noBackup=()=>{result.state='no-backup-confirmed';result.candidates=fallbackCandidates;result.message='No-Stranding Mode could not confirm a separate reachable backup with listed public access and arrival hours. Turn off No-Stranding Mode to view the best available stop without backup, or keep strict mode and review your route assumptions.';};
    if(!backed.candidates.length){noBackup();return respond();}
    const preferred=preferStops(backed.candidates,input,Date.now());result.preferenceSummary=preferred.summary;
    result.candidates=backed.candidates.slice(0,3);
    if(!preferred.ranked.length){result.state='preference-unavailable';result.message=input.preference==='cheapest'?'No comparable priced one-stop trips are available. Add battery capacity and any known station rates, or choose another preference. Stations shown are candidates, not recommendations.':'No comparable one-stop driving and charging times are available. Add battery capacity and vehicle charging power, or choose another preference. Some routes need more charging stops.';return respond();}
    // Only a bounded number of final road routes are fetched. Recheck the
    // failure scenario using the actual displayed main and backup geometry.
    const confirmed:{stop:ReturnType<typeof attachBackup>;route:RoadRoute}[]=[];
    for(const first of preferred.ranked.slice(0,2)){
     try {
      const via=await roadFor([input.origin,first.station,input.destination]);
      const checked=rankStops([{station:first.station,legs:{toMiles:via.legs[0].miles,toMinutes:via.legs[0].minutes,onwardMiles:via.legs[1].miles,onwardMinutes:via.legs[1].minutes,snapMeters:via.snaps[1]}}],input,baseRoute,reports,Date.now());
      const main=checked.ranked[0];if(!main)continue;
      let backup:BackupOption|null=null;
      const options=backupOptions(main,shortlist,matrix.data.connections,input,reports,Date.now());
      for(const option of options.slice(0,2)){
        const diversion=await roadFor([main.station,option.station]);
        const evaluated=evaluateBackup(main,option.station,{miles:diversion.legs[0].miles,minutes:diversion.legs[0].minutes,fromSnapMeters:diversion.snaps[0],toSnapMeters:diversion.snaps[1]},input,reports[option.station.id],Date.now());
        if(typeof evaluated==='string'||(input.noStranding&&!evaluated.qualifiesForMode))continue;
        backup={...evaluated,route:{...diversion.road,fetchedAt:diversion.fetchedAt}};break;
      }
      if(input.noStranding&&!backup)continue;
      const stop=attachBackup(main,backup,input);
      if(!preferStops([stop],input,Date.now()).ranked.length)continue;
      confirmed.push({stop,route:{...via.road,fetchedAt:via.fetchedAt}});
     } catch(error) {
      if(error instanceof ServiceError&&error.status===404)continue;
      if(error instanceof ServiceError&&(error.status>=500||error.status===429)){
       if(!confirmed.length)throw error;
       result.comparisonNote='Some route checks could not finish. Only completed checks are shown; other routes have not been substituted.';break;
      }
      throw error;
     }
    }
    const final=preferStops(confirmed.map(c=>c.stop),input,Date.now()).ranked[0];
    if(final){
      result.routeOptions=confirmed.map(c=>({...c,price:stopBudget(c.stop,input,Date.now()).price}));
      result.comparisonNote ||= confirmed.length<2?'Only one charging route passed the final checks. No second route is available to compare.':'Two checked routes via different charging stops. This is a limited shortlist, not all possible road routes.';
      final.reasons.push(preferenceReason(final,input,Date.now()));
      result.selected=final;result.selectedPrice=stopBudget(final,input,Date.now()).price;
      result.candidates=[final,...preferred.ranked.filter(stop=>stop.station.id!==final.station.id)].slice(0,3);
      result.route=confirmed.find(c=>c.stop.station.id===final.station.id)!.route;result.state='suggested';
      result.itinerary=buildMultiStopItinerary({
        input,
        selected: final,
        shortlist,
        legs: matrix.data.legs,
        connections: matrix.data.connections,
        baseRouteMiles: result.route.miles,
        baseRouteMinutes: result.route.minutes,
        reports,
        now: Date.now(),
      });
      result.preferenceSummary.explanation+=` Final road validation compared ${confirmed.length} of the top two candidates.`;
      if(usedTomTomFallback)result.comparisonNote=[result.comparisonNote,'Directory fallback mode: TomTom listings were used because community corridor data was unavailable during this calculation.'].filter(Boolean).join(' ');
      result.message='Suggested charging stop using your selected preference. Check operator access and availability before departure.';
      result.calculatedAt=new Date().toISOString();result.validUntil=new Date(Date.now()+10*60_000).toISOString();return respond();
    }
    if(input.preference!=='balanced'){result.state='preference-unavailable';result.message='The final road checks could not confirm a comparable trip for this preference. No other mode has been substituted. Recalculate or review the vehicle and station data.';}
    else if(input.noStranding)noBackup();else result.message='The final road routes did not pass the battery or access checks. Recalculate or choose another route.';
    return respond();
  }catch(error){return failure(error instanceof z.ZodError||error instanceof SyntaxError?new ServiceError('Check the locations, battery, reserve and vehicle details.',400):error);}
}
