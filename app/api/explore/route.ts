import { env } from 'cloudflare:workers';
import { z } from 'zod';
import { cached, cachedDirectory, failure, fetchJson, ServiceError } from '@/lib/server-data';
import { normalizeAmenities, normalizeStation, type Point } from '@/lib/ev';
import { fetchOverpass, overpassEndpoints } from '@/lib/overpass';
const coords=z.object({lat:z.coerce.number().min(-90).max(90),lon:z.coerce.number().min(-180).max(180)});
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
  if(action==='stations' || action==='amenities') {
    const point=coords.parse({lat:q.get('lat')??undefined,lon:q.get('lon')??undefined});
    const radius=action==='stations'?z.coerce.number().min(160934).max(402336).parse(q.get('radius')||'160934'):805;
    const lat=Number(point.lat.toFixed(4)),lon=Number(point.lon.toFixed(4));
    const area=`(around:${radius},${lat},${lon})`;
    const query=action==='stations'?`[out:json][timeout:12][maxsize:67108864];nwr[amenity=charging_station]${area};out center tags 300 qt;`:`[out:json][timeout:10];(nwr[amenity~"^(restaurant|cafe|fast_food|food_court|toilets)$"]${area};nwr[toilets=yes]${area};nwr[shop~"^(supermarket|convenience|mall|department_store)$"]${area};);out center tags qt;`;
    const result=await cachedDirectory(`${action}:${action==='amenities'?'v6':'v5'}:${lat}:${lon}:${radius}`,async()=>{
      const elements=await fetchOverpass(query,{endpoints:overpassEndpoints(settings)});
      return action==='stations'?elements.map(e=>normalizeStation(e,point)).filter(Boolean).sort((a,b)=>a!.distance-b!.distance).slice(0,250):normalizeAmenities(elements,point);
    });return Response.json(result,{headers:{'Cache-Control':'private, no-store'}});
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
