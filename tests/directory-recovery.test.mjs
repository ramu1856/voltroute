import { test, mock } from 'node:test';
import assert from 'node:assert/strict';
import { fetchOverpass, overpassEndpoints, directoryProviders } from '../lib/overpass.ts';
import { loadDirectory } from '../lib/directory-cache.ts';
import { ServiceError } from '../lib/service-error.ts';
import { normalizeStation, normalizeAmenities } from '../lib/ev.ts';

const origin={lat:41.8781,lon:-87.6298};
const station={type:'node',id:1,...origin,tags:{amenity:'charging_station'}};
const endpoints=['https://primary.example/api/interpreter','https://backup.example/api/interpreter'];
const query='[out:json];nwr[amenity=charging_station](around:160934,41.8781,-87.6298);out center meta 300;';
const ok=elements=>Response.json({elements});
function stub(responses){const calls=[];return {calls,fetcher:async(url,options)=>{calls.push({url,options});const next=responses.shift();if(next instanceof Error)throw next;assert.ok(next,'No extra requests');return next;}};}
mock.method(console,'warn',()=>{});

test('Chicago 521 recovers through a separate connection with the same query, no invented metadata',async()=>{
 const s=stub([new Response('origin down',{status:521}),ok([station])]);
 const records=await fetchOverpass(query,{endpoints,fetcher:s.fetcher});
 assert.deepEqual(s.calls.map(c=>c.url),endpoints);
 assert.ok(s.calls.every(c=>c.options.method==='POST'&&c.options.body.get('data')===query));
 const normalized=normalizeStation(records[0],origin);
 assert.equal(normalized.id,'node/1');assert.equal(normalized.status,'unknown');assert.equal(normalized.power,null);assert.equal(normalized.fee,'Price not listed');
});
test('a successful or genuinely empty result does not trigger a second query',async()=>{
 for(const rows of [[station],[]]){const s=stub([ok(rows)]);assert.deepEqual(await fetchOverpass(query,{endpoints,fetcher:s.fetcher}),rows);assert.equal(s.calls.length,1);}
});
test('timeouts, invalid JSON, missing elements and partial Overpass results try the backup',async()=>{
 for(const first of [new DOMException('timeout','TimeoutError'),new Response('<html>unavailable</html>'),Response.json({}),Response.json({elements:[{...station,lat:999}]}),Response.json({remark:'runtime error: timed out',elements:[station]})]){
  const s=stub([first,ok([station])]);assert.deepEqual(await fetchOverpass(query,{endpoints,fetcher:s.fetcher}),[station]);assert.equal(s.calls.length,2);
 }
});
test('both connections failing reject instead of returning an empty station array',async()=>{
 const s=stub([new Response('',{status:521}),new Response('',{status:503})]);
 await assert.rejects(fetchOverpass(query,{endpoints,fetcher:s.fetcher}),e=>e instanceof ServiceError&&e.status===503&&e.message.includes('does not mean there are no chargers'));
 assert.equal(s.calls.length,2);
});
test('quota, access and invalid request responses are not bypassed by provider rotation',async()=>{
 for(const status of [429,406,401,403,400]){const s=stub([new Response('',{status})]);await assert.rejects(fetchOverpass(query,{endpoints,fetcher:s.fetcher}),ServiceError);assert.equal(s.calls.length,1);}
});
test('an unresponsive request is bounded and the fallback can still complete',async()=>{
 let calls=0;const keepAlive=setTimeout(()=>{},1000);
 try{const result=await fetchOverpass(query,{endpoints,timeoutMs:10,fetcher:async(_url,options)=>{
  if(++calls===2)return ok([station]);
  return new Promise((_resolve,reject)=>options.signal.addEventListener('abort',()=>reject(options.signal.reason),{once:true}));
 }});assert.deepEqual(result,[station]);assert.equal(calls,2);}finally{clearTimeout(keepAlive);}
});
test('configured endpoints are honored and duplicate providers are contacted only once',async()=>{
 assert.deepEqual(overpassEndpoints({}),directoryProviders);
 assert.deepEqual(overpassEndpoints({OVERPASS_URL:endpoints[0],OVERPASS_FALLBACK_URL:endpoints[1]}),endpoints);
 const s=stub([new Response('',{status:521})]);await assert.rejects(fetchOverpass(query,{endpoints:[endpoints[0],endpoints[0]],fetcher:s.fetcher}));assert.equal(s.calls.length,1);
});
test('the same recovery path loads mapped food and restrooms without inferring facilities',async()=>{
 const cafe={...station,id:2,tags:{amenity:'cafe',name:'Cafe'}},restroom={...station,id:3,tags:{amenity:'toilets'}};
 const s=stub([new Response('',{status:502}),ok([cafe,restroom])]);
 const amenities=normalizeAmenities(await fetchOverpass('amenity query',{endpoints,fetcher:s.fetcher}),origin);
 assert.deepEqual(amenities.map(a=>a.kind),['food','restroom']);assert.equal(amenities[0].hours,'Hours not listed');
});

const now=Date.parse('2026-09-15T17:00:00Z');
const rows=[normalizeStation(station,origin)];
function cache(age=0,data=rows){return {payload:JSON.stringify({data,fetchedAt:new Date(now-age).toISOString()}),expires:now-age+3600000};}
function ioFor(saved,refresh){const writes=[];return {writes,io:{now:()=>now,read:async()=>saved,write:async row=>{writes.push(row);},refresh}};}
const unavailable=()=>Promise.reject(new ServiceError('provider unavailable'));
test('a fresh directory cache avoids another provider call',async()=>{
 const {io,writes}=ioFor(cache(),()=>{assert.fail('Cache should satisfy lookup');});
 const result=await loadDirectory(io);assert.deepEqual(result.data,rows);assert.equal(result.stale,false);assert.equal(result.notice,null);assert.equal(writes.length,0);
});
test('failed refresh returns a labeled same-query snapshot without changing its retrieval time',async()=>{
 const saved=cache(2*3600000);const {io,writes}=ioFor(saved,unavailable);
 const result=await loadDirectory(io);assert.equal(result.stale,true);assert.deepEqual(result.data,rows);assert.equal(result.fetchedAt,JSON.parse(saved.payload).fetchedAt);assert.match(result.notice,/previously retrieved/);assert.equal(writes.length,0);
});
test('expired, future, malformed and absent snapshots never create fake zero results',async()=>{
 for(const saved of [cache(86400001),cache(-1000),{payload:'invalid',expires:now+100},null])await assert.rejects(loadDirectory(ioFor(saved,unavailable).io),ServiceError);
});
test('valid empty cached results retain the stale warning during an outage',async()=>{
 const result=await loadDirectory(ioFor(cache(7200000,[]),unavailable).io);assert.deepEqual(result.data,[]);assert.equal(result.stale,true);assert.ok(result.notice);
});
test('provider recovery replaces the old data and clears its warning',async()=>{
 const fresh=[{...rows[0],id:'node/2'}];const {io,writes}=ioFor(cache(7200000),async()=>fresh);
 const result=await loadDirectory(io);assert.deepEqual(result.data,fresh);assert.equal(result.stale,false);assert.equal(result.notice,null);assert.equal(result.fetchedAt,new Date(now).toISOString());assert.equal(writes.length,1);assert.deepEqual(JSON.parse(writes[0].payload).data,fresh);
});
test('successful provider data survives an unreadable or unwritable cache',async()=>{
 const result=await loadDirectory({now:()=>now,read:async()=>{throw new Error('read failed');},write:async()=>{throw new Error('write failed');},refresh:async()=>rows});assert.deepEqual(result.data,rows);assert.equal(result.stale,false);
});
test('authentication errors are propagated even when a cached snapshot exists',async()=>{
 await assert.rejects(loadDirectory(ioFor(cache(7200000),()=>Promise.reject(new ServiceError('Sign in',401))).io),e=>e.status===401);
});
