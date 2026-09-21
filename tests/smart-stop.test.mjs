import { test } from 'node:test';
import assert from 'node:assert/strict';
import { normalizeStation } from '../lib/ev.ts';
import { arrivalBattery, connectorKW, rankStops, reachableMiles, routeSamples, shortlistStations, smartStopSchema } from '../lib/smart-stop.ts';
import { parseMatrixResponse, parseRoadResponse } from '../lib/smart-stop-routing.ts';

const now=Date.parse('2026-09-15T16:00:00Z');
const input=smartStopSchema.parse({origin:{lat:41.88,lon:-87.63,label:'Start'},destination:{lat:42.33,lon:-83.05,label:'End'},profile:{name:'Example EV',connector:'CCS1',range:250},battery:80,reserve:15,maxDetourMinutes:20,batteryCapacity:75,vehicleMaxKW:120});
const road={coordinates:[[-87.63,41.88],[-86.5,42],[-85,42.1],[-83.05,42.33]],miles:280,minutes:280,fetchedAt:new Date(now).toISOString()};
function station(id=1,tags={}){return normalizeStation({id,type:'node',lat:42,lon:-85.5,tags:{name:`Test ${id}`,amenity:'charging_station',access:'yes',opening_hours:'24/7','socket:type1_combo':'2','socket:type1_combo:output':'150 kW',...tags}},input.origin);}
function candidate(s=station(),overrides={}){return {station:s,legs:{toMiles:150,toMinutes:150,onwardMiles:135,onwardMinutes:135,snapMeters:10,...overrides}};}
function ranked(candidates,options=input,reports={}){return rankStops(candidates,options,road,reports,now);}

test('smart stop uses road distance for reserve, including exact boundaries',()=>{
  assert.equal(reachableMiles(input),162.5);
  assert.equal(arrivalBattery(input,150),20);
  assert.equal(ranked([candidate()]).ranked[0].arrivalBattery,20);
  assert.equal(ranked([candidate(station(),{toMiles:162.5,onwardMiles:122.5})]).ranked.length,1);
  assert.equal(ranked([candidate(station(),{toMiles:163,onwardMiles:122})]).excluded.reserve,1);
});
test('short straight-line separation does not bypass an unreachable road leg',()=>{
  const close={...station(),lat:input.origin.lat,lon:input.origin.lon};
  assert.equal(ranked([candidate(close,{toMiles:200,onwardMiles:85})]).ranked.length,0);
});
test('known failures, connector mismatches and restricted access are excluded while unknown connectors are provisional',()=>{
  for(const [s,why] of [[station(1,{status:'closed'}),'unavailable'],[station(2,{status:'planned'}),'unavailable'],[station(3,{'socket:type1_combo':'0','socket:type1':'1'}),'connector'],[station(4,{access:'permit'}),'access']])assert.equal(ranked([candidate(s)]).excluded[why],1);
  const unknown=ranked([candidate({...station(5),connectors:[]})]).ranked[0];
  assert.equal(unknown.station.id,'node/5');
  assert.ok(unknown.warnings.some(w=>w.includes('compatibility')));
  const report={sourceId:'node/1',status:'broken',reportedAt:now-60000};
  assert.equal(ranked([candidate()],input,{'node/1':report}).excluded.unavailable,1);
});
test('unknown availability remains a provisional suggestion with a visible reason, never a working-port claim',()=>{
  const result=ranked([candidate()]).ranked[0];
  assert.equal(result.availability.freshness,'unknown');
  assert.match(result.warnings[0],/not confirmed/);
  assert.ok(result.reasons.some(reason=>reason.includes('Unknown')));
  assert.ok(result.warnings.some(reason=>reason.includes('if the target battery is reached')));
  assert.equal(result.backup,null);
});
test('extra driving and missing or badly snapped roads fail safely',()=>{
  assert.equal(ranked([candidate(station(),{onwardMinutes:151})]).excluded.detour,1);
  assert.equal(ranked([{station:station(),legs:null}]).excluded.road,1);
  assert.equal(ranked([candidate(station(),{snapMeters:151})]).excluded.road,1);
  assert.equal(ranked([candidate(station(),{onwardMinutes:NaN})]).excluded.road,1);
  assert.equal(ranked([candidate(station(),{onwardMiles:100,onwardMinutes:100})]).excluded.road,1);
});
test('station-local hours are checked at arrival and during the estimated charging session',()=>{
  // Depart 11:00 Chicago, arrive 13:30; arrival is inside the short window,
  // but the estimated session extends beyond its 13:40 closing time.
  const closing=station(1,{opening_hours:'Tu 12:00-13:40',timezone:'America/Chicago'});
  assert.equal(ranked([candidate(closing)]).excluded.hours,1);
  const closed=station(2,{opening_hours:'Tu 08:00-12:00',timezone:'America/Chicago'});
  assert.equal(ranked([candidate(closed)]).excluded.hours,1);
});
test('connector power never inherits a different socket or station maximum',()=>{
  const mixed=station(1,{'socket:type1':'2','socket:type1:output':'7 kW','socket:type1_combo:output':'350 kW'});
  assert.equal(connectorKW(mixed,'J1772'),7);
  assert.equal(connectorKW(mixed,'CCS1'),350);
  assert.equal(connectorKW({...mixed,connectorPower:undefined},'CCS1'),null);
  const noOutput=station(2,{'socket:type1_combo:output':'unknown','charging_station:output':'350 kW'});
  assert.equal(connectorKW(noOutput,'CCS1'),null);
});
test('vehicle limits cap charge estimates and missing inputs leave charge time unavailable',()=>{
  const result=ranked([candidate()]).ranked[0];
  assert.equal(result.usableKW,120);
  assert.equal(result.targetBattery,69);
  assert.equal(result.energyKwh,36.75);
  assert.equal(result.chargeMinutes,23);
  assert.equal(ranked([candidate()],{...input,vehicleMaxKW:null}).ranked[0].chargeMinutes,null);
  assert.equal(ranked([candidate()],{...input,batteryCapacity:null}).ranked[0].chargeMinutes,null);
});
test('ranking responds to detour, speed and evidence with explainable adjustments',()=>{
  const fast=station(1),slow=station(2,{'socket:type1_combo:output':'7 kW'});
  assert.equal(ranked([candidate(slow),candidate(fast)]).ranked[0].station.id,fast.id);
  const fasterDetour=candidate(station(3),{onwardMinutes:149});
  assert.equal(ranked([fasterDetour,candidate(fast)]).ranked[0].station.id,fast.id);
  const goodReport={sourceId:'node/2',status:'working',reportedAt:now-60000};
  const same=station(2);
  const result=ranked([candidate(fast),candidate(same)],input,{'node/2':goodReport});
  assert.equal(result.ranked[0].station.id,'node/2');
  for(const item of result.ranked)assert.equal(item.rankPoints,item.adjustments.reduce((sum,part)=>sum+part.points,0));
});
test('route corridor ends at the reachable range and sampling stays bounded',()=>{
  const samples=routeSamples(road,162.5);
  assert.equal(samples[0].mile,0);
  assert.equal(samples.at(-1).mile,162.5);
  assert.ok(samples.length<301);
  assert.deepEqual(routeSamples({...road,coordinates:[]},100),[]);
  assert.ok(routeSamples({...road,miles:8000},7000).length<=302);
});
test('shortlist is deterministic, deduplicated and bounded before road calls',()=>{
  const list=Array.from({length:40},(_,i)=>station(i+1));
  assert.equal(shortlistStations([...list,list[0]],input,road,{},now).length,16);
  assert.deepEqual(shortlistStations(list,input,road,{},now),shortlistStations([...list].reverse(),input,road,{},now));
});
test('invalid inputs reject before external services are called',()=>{
  for(const patch of [{reserve:0},{maxDetourMinutes:1000},{battery:101},{batteryCapacity:0},{vehicleMaxKW:0},{batteryCapacity:NaN},{noStranding:'false'},{failureAllowance:0},{failureAllowance:11},{failureDelayMinutes:-1},{failureDelayMinutes:61}])assert.equal(smartStopSchema.safeParse({...input,...patch}).success,false);
});

const wp=(distance=0)=>({distance,location:[-87,42]});
function matrix(){return {code:'Ok',sources:[wp(),wp(),wp()],destinations:[wp(),wp(),wp()],distances:[[0,241401.6,450616.32],[241401.6,0,217261.44],[450616.32,217261.44,0]],durations:[[0,9000,16800],[9000,0,8100],[16800,8100,0]]};}
test('directed matrix distances and durations are converted to miles/minutes without straight-line fallbacks',()=>{
  assert.deepEqual(parseMatrixResponse(matrix(),1),[{toMiles:150,toMinutes:150,onwardMiles:135,onwardMinutes:135,snapMeters:0}]);
  const missing=matrix();missing.distances[1][2]=null;
  assert.deepEqual(parseMatrixResponse(missing,1),[null]);
  assert.deepEqual(parseMatrixResponse({...matrix(),fallback_speed_cells:[[0,1]]},1),[null]);
  const malformed=matrix();malformed.durations[1].pop();assert.throws(()=>parseMatrixResponse(malformed,1));
  const far=matrix();far.sources[0].distance=5001;assert.throws(()=>parseMatrixResponse(far,1));
});
test('route geometry, waypoint order and leg totals must agree',()=>{
  const response={code:'Ok',waypoints:[wp(),wp(),wp()],routes:[{distance:3000,duration:300,legs:[{distance:1000,duration:100},{distance:2000,duration:200}],geometry:{coordinates:[[-87,42],[-86.9,42],[-86.8,42]]}}]};
  const parsed=parseRoadResponse(response,3);assert.equal(parsed.legs.length,2);assert.equal(parsed.road.minutes,5);
  assert.throws(()=>parseRoadResponse({...response,waypoints:[wp(),wp()]},3));
  response.routes[0].legs[0].distance=500;assert.throws(()=>parseRoadResponse(response,3));
});
