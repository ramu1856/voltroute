import { test } from 'node:test';
import assert from 'node:assert/strict';
import { normalizeStation } from '../lib/ev.ts';
import { rankStops, smartStopSchema } from '../lib/smart-stop.ts';
import { assignBackups, attachBackup, backupOptions, distinctChargingSites, evaluateBackup } from '../lib/backup-charger.ts';
import { parseChargingRoadGraph } from '../lib/smart-stop-routing.ts';
import { isSmartStopExpired } from '../lib/smart-stop-validity.ts';

const now=Date.parse('2026-09-15T16:00:00Z');
const input=smartStopSchema.parse({origin:{lat:41.88,lon:-87.63,label:'Start'},destination:{lat:42.33,lon:-83.05,label:'End'},profile:{name:'Example EV',connector:'CCS1',range:250},battery:80,reserve:15,maxDetourMinutes:20});
const road={coordinates:[[-87.63,41.88],[-85.5,42],[-83.05,42.33]],miles:280,minutes:280,fetchedAt:new Date(now).toISOString()};
function station(id=1,tags={}){return normalizeStation({id,type:'node',lat:42,lon:-85.5+(id-1)*.02,tags:{name:`Example ${id}`,amenity:'charging_station',access:'yes',opening_hours:'24/7',timezone:'America/Chicago','socket:type1_combo':'2','socket:type1_combo:output':'150 kW',...tags}},input.origin);}
const mainStation=station(),other=station(2),connection={miles:5,minutes:8,fromSnapMeters:5,toSnapMeters:8};
function main(overrides={}){return rankStops([{station:mainStation,legs:{toMiles:150,toMinutes:150,onwardMiles:135,onwardMinutes:135,snapMeters:10,...overrides}}],input,road,{},now).ranked[0];}
function evaluate(s=other,c=connection,options=input,report,at=now){return evaluateBackup(main(),s,c,options,report,at);}
function confirmedBackup(s=other,report){const backup=evaluate(s,connection,input,report);assert.notEqual(typeof backup,'string');return {...backup,route:{coordinates:[[mainStation.lon,mainStation.lat],[s.lon,s.lat]],miles:5,minutes:8,fetchedAt:new Date(now).toISOString()}};}
function result(backup=confirmedBackup(),options=input){return {input:options,selected:attachBackup(main(),backup,options),validUntil:new Date(now+600000).toISOString()};}

test('failure scenario preserves reserve without any charge from the main stop',()=>{
  const b=evaluate();assert.notEqual(typeof b,'string');
  assert.equal(input.noStranding,true);assert.equal(input.failureAllowance,3);assert.equal(input.failureDelayMinutes,10);
  assert.equal(b.arrivalBattery,15);assert.equal(b.totalDriveMiles,155);
  assert.equal(b.arrivalAt,'2026-09-15T18:48:00.000Z');
  assert.equal(evaluate(other,{...connection,miles:5.01}),'reserve');
  assert.equal(evaluate(other,connection,{...input,failureAllowance:4}),'reserve');
  // A target of 80% at the main charger must not feed the failure calculation.
  assert.equal(evaluateBackup({...main(),targetBattery:100},other,connection,input,undefined,now).arrivalBattery,15);
});
test('same pin, same parking area and duplicate address cannot become independent backups',()=>{
  assert.equal(distinctChargingSites(mainStation,mainStation),false);
  assert.equal(distinctChargingSites(mainStation,{...other,lon:mainStation.lon+.001}),false);
  assert.equal(distinctChargingSites({...mainStation,address:'123 Main St.'},{...other,address:'123 MAIN ST'}),false);
  assert.equal(evaluate(mainStation),'same-site');assert.equal(distinctChargingSites(mainStation,other),true);
});
test('connector mismatch, mapped closure and restricted access reject backups',()=>{
  assert.equal(evaluate({...other,connectors:['NACS']}),'connector');
  for(const status of ['planned','temporarily unavailable'])assert.equal(evaluate({...other,status}),'unavailable');
  for(const access of ['private','no','permit','delivery'])assert.equal(evaluate({...other,access}),'access');
});
test('a recent busy or broken observation cannot qualify as a backup',()=>{
  for(const status of ['busy','broken'])assert.equal(evaluate(other,connection,input,{sourceId:other.id,status,reportedAt:now-60000}),'unavailable');
  const b=evaluate(other,connection,input,{sourceId:other.id,status:'working',reportedAt:now-60000});
  assert.equal(b.availability.condition,'working');assert.equal(b.availability.availablePorts,null);
  assert.ok(b.warnings.some(s=>s.includes('free port')&&s.includes('not confirmed')));
});
test('missing, malformed and implausible road connections do not get substituted',()=>{
  for(const c of [null,{...connection,miles:NaN},{...connection,minutes:-1},{...connection,fromSnapMeters:151},{...connection,toSnapMeters:151},{...connection,miles:0}])assert.equal(evaluate(other,c),'road');
});
test('failure delay is included when checking station-local arrival hours',()=>{
  const closing=station(2,{opening_hours:'Tu 12:00-13:45'});
  assert.equal(evaluate(closing),'hours');
  assert.equal(evaluate(closing,connection,{...input,failureDelayMinutes:0}).hours.state,'open');
});
test('unknown hours and access remain provisional and cannot satisfy No-Stranding Mode',()=>{
  const edges=[[null,connection],[connection,null]];
  for(const s of [{...other,hours:'Hours not listed'},{...other,access:'Access not listed'},{...other,access:'customers'}]){
    assert.equal(evaluate(s).qualifiesForMode,false);
    assert.equal(backupOptions(main(),[mainStation,s],edges,input,{},now).length,0);
    assert.equal(backupOptions(main(),[mainStation,s],edges,{...input,noStranding:false},{},now).length,1);
  }
});
test('strict mode removes an unbacked main and never silently turns itself off',()=>{
  const strict=assignBackups([main()],[mainStation,other],[[null,null],[connection,null]],input,{},now);
  assert.equal(strict.candidates.length,0);assert.equal(strict.excluded,1);assert.equal(input.noStranding,true);
  const relaxed=assignBackups([main()],[mainStation,other],[[null,null],[connection,null]],{...input,noStranding:false},{},now);
  assert.equal(relaxed.candidates.length,1);assert.equal(relaxed.candidates[0].backup,null);
  assert.throws(()=>attachBackup(main(),null,input));assert.throws(()=>attachBackup(main(),evaluate(),input));
  assert.ok(attachBackup(main(),null,{...input,noStranding:false}).warnings.some(s=>s.includes('Mode is off')));
});
test('a longer final main or backup route invalidates the preliminary matrix choice',()=>{
  const edges=[[null,connection],[connection,null]];
  assert.equal(backupOptions(main(),[mainStation,other],edges,input,{},now).length,1);
  assert.equal(backupOptions(main({toMiles:151}),[mainStation,other],edges,input,{},now).length,0);
  assert.equal(evaluate(other,{...connection,miles:6}),'reserve');
});
test('No-Stranding selection prefers another main with a reachable backup',()=>{
  const later={...main({toMiles:151}),station:station(3)},earlier=main();
  const assigned=assignBackups([later,earlier],[mainStation,other,later.station],[[null,connection,null],[connection,null,null],[null,connection,null]],input,{},now);
  assert.equal(assigned.excluded,1);assert.equal(assigned.candidates[0].station.id,mainStation.id);
  const attached=attachBackup(earlier,confirmedBackup(),input);
  assert.ok(attached.reasons.some(s=>s.includes('no charge at the main stop')));
});
test('same network risk is explicit and unknown operation never becomes live evidence',()=>{
  const m={...main(),station:{...mainStation,network:'Example network'}};
  const b=evaluateBackup(m,{...other,network:'Example network'},connection,input,undefined,now);
  assert.equal(b.sameNetwork,true);assert.equal(b.qualifiesForMode,true);assert.equal(b.availability.freshness,'unknown');
  assert.ok(b.warnings.some(s=>s.includes('network-wide')));
});

const wp=(distance=0)=>({distance,location:[-85.5,42]});
function matrix(){const distances=Array.from({length:4},(_,i)=>Array.from({length:4},(_,j)=>i===j?0:1609.344*5));const durations=Array.from({length:4},(_,i)=>Array.from({length:4},(_,j)=>i===j?0:480));distances[2][1]=1609.344*40;durations[2][1]=3000;return {code:'Ok',sources:Array.from({length:4},()=>wp()),destinations:Array.from({length:4},()=>wp()),distances,durations};}
test('station-to-station matrices preserve directed roads rather than mirroring the reverse',()=>{
  const graph=parseChargingRoadGraph(matrix(),2);
  assert.equal(graph.connections[0][1].miles,5);assert.equal(graph.connections[1][0].miles,40);
  assert.equal(graph.connections[0][1].minutes,8);assert.equal(graph.connections[1][0].minutes,50);
  assert.equal(graph.connections[0][0],null);
});
test('unroutable and fallback matrix cells stay missing; endpoint snaps are retained',()=>{
  const missing=matrix();missing.distances[1][2]=null;assert.equal(parseChargingRoadGraph(missing,2).connections[0][1],null);
  const fallback=matrix();fallback.fallback_speed_cells=[[1,2]];assert.equal(parseChargingRoadGraph(fallback,2).connections[0][1],null);
  const snapped=matrix();snapped.sources[1].distance=151;
  assert.equal(evaluate(other,parseChargingRoadGraph(snapped,2).connections[0][1]),'road');
});
test('suggestions expire when backup evidence ages or its arrival hours close',()=>{
  const old={sourceId:other.id,status:'working',reportedAt:now-24*60*60000+60000};
  const recent=result(confirmedBackup(other,old));
  assert.equal(isSmartStopExpired(recent,now),false);assert.equal(isSmartStopExpired(recent,now+61000),true);
  const closing=result(confirmedBackup(station(2,{opening_hours:'Tu 12:00-13:49'})));
  assert.equal(isSmartStopExpired(closing,now),false);assert.equal(isSmartStopExpired(closing,now+60000),true);
  assert.equal(isSmartStopExpired(result(),now+600000),true);
});
test('strict stale or missing backups cannot restore an actionable map route',()=>{
  const planned=result();planned.selected.backup=null;assert.equal(isSmartStopExpired(planned,now),true);
  const missingRoute=result();missingRoute.selected.backup.route=null;assert.equal(isSmartStopExpired(missingRoute,now),true);
  const unqualified=result();unqualified.selected.backup.qualifiesForMode=false;assert.equal(isSmartStopExpired(unqualified,now),true);
  const relaxed=result(null,{...input,noStranding:false});assert.equal(isSmartStopExpired(relaxed,now),false);
});
