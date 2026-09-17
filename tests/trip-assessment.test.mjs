import { test } from 'node:test';
import assert from 'node:assert/strict';
import { normalizeStation } from '../lib/ev.ts';
import { smartStopSchema, rankStops } from '../lib/smart-stop.ts';
import { attachBackup, evaluateBackup } from '../lib/backup-charger.ts';
import { evaluateAvailability } from '../lib/station-evidence.ts';
import { assessTrip, sliceRoadCoordinates } from '../lib/trip-assessment.ts';

const now=Date.parse('2026-09-15T16:00:00Z');
const input=smartStopSchema.parse({origin:{lat:41.88,lon:-87.63,label:'Start'},destination:{lat:42,lon:-85.5,label:'End'},profile:{name:'Example EV',connector:'CCS1',range:200},battery:80,reserve:15,maxDetourMinutes:20});
const road={coordinates:[[-87.63,41.88],[-87.1,42],[-86.5,42.1],[-85.5,42]],miles:185,minutes:185,fetchedAt:new Date(now).toISOString()};
function station(id=1){return normalizeStation({id,type:'node',lat:42,lon:-87.1+(id-1)*.02,tags:{name:`Test ${id}`,amenity:'charging_station',access:'yes',opening_hours:'24/7',timezone:'America/Chicago',network:`Network ${id}`,'socket:type1_combo':'2','socket:type1_combo:output':'150 kW'}},input.origin);}
function plan(){
  const main=rankStops([{station:station(),legs:{toMiles:50,toMinutes:50,onwardMiles:135,onwardMinutes:135,snapMeters:5}}],input,road,{},now).ranked[0];
  const backup=evaluateBackup(main,station(2),{miles:5,minutes:8,fromSnapMeters:5,toSnapMeters:5},input,undefined,now);
  assert.notEqual(typeof backup,'string');
  backup.route={coordinates:[[-87.1,42],[-87.095,42.005],[-87.08,42]],miles:5,minutes:8,fetchedAt:new Date(now).toISOString()};
  return {input:{...input,profile:{...input.profile}},state:'suggested',message:'',baseRoute:road,route:road,selected:attachBackup(main,backup,input),candidates:[],excluded:{},mappedCount:2,roadCheckedCount:2,searchLimited:false,directoryFetchedAt:new Date(now).toISOString(),calculatedAt:new Date(now).toISOString(),validUntil:new Date(now+600000).toISOString()};
}
function direct(distance=50,state='no-charge-needed') {return {...plan(),state,selected:null,route:{...road,miles:distance,minutes:distance}};}
function live(stop){stop.station.operatorObservation={stationId:stop.station.id,source:'operator',provider:'Test operator',sourceUrl:'https://example.com/charger',observedAt:new Date(now-30000).toISOString(),status:'available',availablePorts:1,totalPorts:2};stop.availability=evaluateAvailability(stop.station,undefined,now);}
const near=(a,b,tolerance=1e-7)=>assert.ok(Math.abs(a-b)<tolerance,`${a} differs from ${b}`);

test('score covers the whole trip and cannot turn a first stop into a complete plan',()=>{
  const p=plan(),a=assessTrip(p,now);
  near(a.coveragePercent,50/185*100);assert.equal(a.assessedMiles,50);assert.equal(a.unassessedMiles,135);
  assert.ok(a.score<=59);assert.equal(a.label,'Partial charging plan');
  const beyond=a.sections.find(s=>s.level==='unassessed');assert.equal(beyond.distanceMiles,135);assert.equal(beyond.batteryTo,null);
  p.selected.targetBattery=100;const changed=assessTrip(p,now);
  assert.deepEqual(changed.sections,a.sections);assert.equal(changed.score,a.score);
});
test('strong observations cannot remove the cap when another charging stop is required',()=>{
  const p=plan();p.input.profile.range=500;p.route={...road,miles:610,minutes:610};
  p.selected.legs={toMiles:280,toMinutes:280,onwardMiles:330,onwardMinutes:330,snapMeters:5};
  live(p.selected);live(p.selected.backup);
  const a=assessTrip(p,now);assert.ok(a.rawScore>59);assert.equal(a.score,59);near(a.coveragePercent,280/610*100);
});
test('a supported one-stop trip labels the successful-charge assumption and projects the final leg',()=>{
  const p=plan();p.route={...road,miles:175,minutes:175};p.selected.legs.onwardMiles=125;p.selected.legs.onwardMinutes=125;
  const a=assessTrip(p,now);assert.equal(a.coveragePercent,100);assert.equal(a.unassessedMiles,0);assert.equal(a.label,'Conditional one-stop plan');
  const final=a.sections.filter(s=>s.path==='main'&&s.assumption);
  assert.ok(final.length>0);assert.match(final[0].assumption,/Assumes successful charging/);near(final[0].batteryFrom,80);near(final.at(-1).batteryTo,17.5);
  const failure=a.sections.filter(s=>s.path==='backup');near(failure[0].batteryFrom,52);near(failure.at(-1).batteryTo,49.5);
});
test('unknown directory status earns no live credit and no green charging sections',()=>{
  const p=plan(),a=assessTrip(p,now);
  assert.equal(a.factors.find(f=>f.key==='evidence').earned,0);
  assert.ok(a.sections.filter(s=>s.level!=='unassessed').every(s=>s.level==='review'));
  p.directoryFetchedAt=new Date(now).toISOString();p.selected.station.status='open';p.selected.station.updated=new Date(now).toISOString();
  assert.equal(assessTrip(p,now).score,a.score);
});
test('score responds to actual observation evidence rather than listed power or invented prices',()=>{
  const p=plan(),unknown=assessTrip(p,now);live(p.selected);live(p.selected.backup);
  const observed=assessTrip(p,now);assert.equal(observed.factors.find(f=>f.key==='evidence').earned,15);
  assert.ok(observed.score>=unknown.score);assert.ok(observed.sections.some(s=>s.level==='covered'));
  p.selected.station.fee='$0.01/kWh';p.selected.station.power=1000;
  assert.equal(assessTrip(p,now).score,observed.score);
});
test('recent private successes receive only partial observation credit and no live-port claim',()=>{
  const p=plan();
  for(const stop of [p.selected,p.selected.backup]){stop.personalReport={sourceId:stop.station.id,status:'working',reportedAt:now-60000};stop.availability=evaluateAvailability(stop.station,stop.personalReport,now);}
  const a=assessTrip(p,now);assert.equal(a.factors.find(f=>f.key==='evidence').earned,6);
  assert.ok(a.sections.every(s=>s.level!=='covered'));
});
test('less battery reduces buffer credit; failure allowance is deducted before the backup drive',()=>{
  const p=plan(),normal=assessTrip(p,now);p.input.battery=47;
  const low=assessTrip(p,now);assert.ok(low.factors.find(f=>f.key==='battery').earned<normal.factors.find(f=>f.key==='battery').earned);
  const backup=low.sections.filter(s=>s.path==='backup');near(backup[0].batteryFrom,19);near(backup.at(-1).batteryTo,16.5);
  assert.ok(low.score<=normal.score);p.input.failureAllowance=5;
  const under=assessTrip(p,now);assert.ok(under.sections.some(s=>s.path==='backup'&&s.level==='gap'));
  assert.ok(under.score<=39);
});
test('turning off strict mode does not create backup points or a stronger score',()=>{
  const p=plan(),backed=assessTrip(p,now);p.input.noStranding=false;p.selected.backup=null;
  const unbacked=assessTrip(p,now);assert.equal(unbacked.factors.find(f=>f.key==='backup').earned,0);
  assert.ok(unbacked.score<=39);assert.ok(unbacked.score<=backed.score);assert.ok(unbacked.sections.every(s=>s.path==='main'));
});
test('same-network backup earns fewer independence points and unknown hours earn none',()=>{
  const p=plan(),normal=assessTrip(p,now);p.selected.backup.station.network=p.selected.station.network;p.selected.backup.sameNetwork=true;
  assert.equal(assessTrip(p,now).factors.find(f=>f.key==='backup').earned,5);
  p.input.noStranding=false;p.selected.backup.station.hours='Hours not listed';p.selected.backup.qualifiesForMode=false;
  const unknown=assessTrip(p,now);assert.equal(unknown.factors.find(f=>f.key==='backup').earned,0);assert.ok(unknown.score<normal.score);
});
test('no-charge routes exclude unnecessary charger checks instead of inventing operator data',()=>{
  const a=assessTrip(direct(),now);assert.equal(a.score,85);assert.equal(a.rawScore,100);assert.equal(a.coveragePercent,100);
  assert.ok(a.factors.filter(f=>['evidence','access','backup'].includes(f.key)).every(f=>!f.applicable));
  assert.ok(a.sections.every(s=>s.level==='covered'));assert.equal(a.unassessedMiles,0);
});
test('battery reserve boundary is amber at the end and red only beyond the reserve range',()=>{
  const exact=assessTrip(direct(130),now);assert.deepEqual(exact.sections.map(s=>s.level),['covered','review']);
  near(exact.sections.at(-1).batteryTo,15);near(exact.sections.at(-1).toMile,130);
  const missing=assessTrip(direct(180,'no-suitable-stop'),now);const gap=missing.sections.find(s=>s.level==='gap');
  near(gap.fromMile,130);near(gap.toMile,180);assert.ok(missing.score<=24);assert.equal(missing.coveragePercent,0);
  assert.match(missing.issues.join(' '),/not proof that chargers do not exist/);
});
test('starting below reserve makes the entire road red without negative battery percentages',()=>{
  const p=direct(180,'reserve-too-low');p.input.battery=10;
  const a=assessTrip(p,now);assert.ok(a.sections.every(s=>s.level==='gap'));
  assert.ok(a.sections.every(s=>s.batteryFrom>=0&&s.batteryTo>=0));assert.equal(a.score,0);
});
test('expired plans and aging evidence withdraw the score and risk overlays',()=>{
  const p=plan();assert.equal(assessTrip(p,now+600000).score,null);assert.equal(assessTrip(p,now+600000).sections.length,0);
  live(p.selected);live(p.selected.backup);
  assert.equal(assessTrip(p,now+5*60000).score,null);
  p.selected.backup=null;assert.equal(assessTrip(p,now).score,null);
});
test('unusable roads and invalid range cannot produce a confident score or colored route',()=>{
  for(const route of [{...road,miles:0},{...road,miles:NaN},{...road,coordinates:[]},{...road,coordinates:[[-87,42],[-87,42]]},{...road,coordinates:[[-87,42],[NaN,42]]}]){
    const a=assessTrip({...direct(),route},now);assert.equal(a.score,null);assert.deepEqual(a.sections,[]);
  }
  const p=plan();p.input.profile.range=0;assert.equal(assessTrip(p,now).score,null);
});
test('sliced sections retain road bends, join continuously and never replace a road with a chord',()=>{
  const bent={...road,miles:100,coordinates:[[0,0],[1,0],[1,1]]};
  const first=sliceRoadCoordinates(bent,0,75),second=sliceRoadCoordinates(bent,75,100);
  assert.deepEqual(first[0],[0,0]);assert.ok(first.some(p=>p[0]===1&&p[1]===0));
  assert.deepEqual(first.at(-1),second[0]);assert.deepEqual(second.at(-1),[1,1]);near(first.at(-1)[1],.5);
  assert.deepEqual(sliceRoadCoordinates(bent,50,50),[]);assert.deepEqual(sliceRoadCoordinates(bent,NaN,100),[]);
});
test('main risk sections partition the complete road while the backup remains a separate branch',()=>{
  const p=plan(),a=assessTrip(p,now),main=a.sections.filter(s=>s.path==='main'),backup=a.sections.filter(s=>s.path==='backup');
  near(main.reduce((sum,s)=>sum+s.distanceMiles,0),p.route.miles);near(backup.reduce((sum,s)=>sum+s.distanceMiles,0),5);
  assert.deepEqual(main[0].coordinates[0],p.route.coordinates[0]);assert.deepEqual(main.at(-1).coordinates.at(-1),p.route.coordinates.at(-1));
  for(let i=1;i<main.length;i++){near(main[i-1].toMile,main[i].fromMile);assert.deepEqual(main[i-1].coordinates.at(-1),main[i].coordinates[0]);}
  assert.equal(backup[0].fromMile,0);assert.equal(backup.at(-1).toMile,5);
});
test('score arithmetic and caps are visible and finite across success and failure states',()=>{
  for(const p of [plan(),direct(),direct(130),direct(180,'no-backup-confirmed')]){
    const a=assessTrip(p,now),factors=a.factors.filter(f=>f.applicable);
    const raw=Math.round(factors.reduce((s,f)=>s+f.earned,0)/factors.reduce((s,f)=>s+f.possible,0)*100);
    assert.equal(a.rawScore,raw);assert.equal(a.score,Math.min(raw,...a.limits.map(l=>l.maximum)));assert.ok(a.score>=0&&a.score<=100);
  }
});
