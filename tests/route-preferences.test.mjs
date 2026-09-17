import { test } from 'node:test';
import assert from 'node:assert/strict';
import { normalizeStation } from '../lib/ev.ts';
import { rankStops, smartStopSchema } from '../lib/smart-stop.ts';
import { attachBackup, evaluateBackup } from '../lib/backup-charger.ts';
import { evaluateAvailability } from '../lib/station-evidence.ts';
import { preferStops } from '../lib/route-preferences.ts';
import { projectStopEnergy, stopBudget, tripBudget } from '../lib/trip-budget.ts';
import { isSmartStopExpired } from '../lib/smart-stop-validity.ts';

const now=Date.parse('2026-09-15T16:00:00Z');
const input=smartStopSchema.parse({origin:{lat:41.88,lon:-87.63,label:'Start'},destination:{lat:42.33,lon:-83.05,label:'End'},profile:{name:'Test EV',connector:'CCS1',range:250},battery:80,reserve:15,maxDetourMinutes:20,batteryCapacity:75,vehicleMaxKW:150});
const road={coordinates:[[-87.63,41.88],[-85.5,42],[-83.05,42.33]],miles:250,minutes:250,fetchedAt:new Date(now).toISOString()};
function station(id=1,rate='$0.40/kWh',power=150){return normalizeStation({id,type:'node',lat:42,lon:-85.5+(id-1)*.02,tags:{name:`Test ${id}`,network:`Test network ${id}`,amenity:'charging_station',access:'yes',opening_hours:'24/7',timezone:'America/Chicago',charge:rate,'socket:type1_combo':'2','socket:type1_combo:output':`${power} kW`}},input.origin);}
function stop(id=1,rate='$0.40/kWh',power=150,legs={}){
  const main=rankStops([{station:station(id,rate,power),legs:{toMiles:100,toMinutes:100,onwardMiles:150,onwardMinutes:150,snapMeters:5,...legs}}],input,road,{},now).ranked[0];assert.ok(main);
  const other={...station(id+100,'$9.00/kWh'),lon:main.station.lon+.02};
  const backup=evaluateBackup(main,other,{miles:5,minutes:8,fromSnapMeters:5,toSnapMeters:5},input,undefined,now);assert.notEqual(typeof backup,'string');
  backup.route={...road,miles:5,minutes:8,coordinates:[[main.station.lon,42],[other.lon,42]]};return attachBackup(main,backup,input);
}
function plan(main=stop(),settings=input){return {input:settings,state:'suggested',message:'',selected:main,route:{...road,miles:main.legs.toMiles+main.legs.onwardMiles,minutes:main.legs.toMinutes+main.legs.onwardMinutes},baseRoute:road,candidates:[main],excluded:{},mappedCount:2,roadCheckedCount:2,searchLimited:false,directoryFetchedAt:new Date(now).toISOString(),calculatedAt:new Date(now).toISOString(),validUntil:new Date(now+600000).toISOString()};}
const near=(a,b)=>assert.ok(Math.abs(a-b)<1e-8,`${a} differs from ${b}`);

test('balanced preserves the existing ranking with no default price inputs',()=>{
  const a=stop(1,'Price not listed',20),b=stop(2,'Price not listed',150,{toMiles:130,toMinutes:130,onwardMiles:135,onwardMinutes:135});
  const ranked=preferStops([a,b],input,now);
  assert.equal(input.preference,'balanced');assert.deepEqual(input.enteredRates,{});
  assert.equal(ranked.ranked[0].station.id,[a,b].sort((a,b)=>a.rankPoints-b.rankPoints)[0].station.id);
});
test('fastest compares total driving plus charging, not distance or listed power alone',()=>{
  const closer=stop(1,'$0.40/kWh',20),farther=stop(2,'$0.40/kWh',150,{toMiles:130,toMinutes:130,onwardMiles:135,onwardMinutes:135});
  const ranked=preferStops([closer,farther],{...input,preference:'fastest'},now);
  assert.equal(ranked.ranked[0].station.id,farther.station.id);
  assert.ok(stopBudget(farther,input,now).driveChargeMinutes<stopBudget(closer,input,now).driveChargeMinutes);
});
test('cheapest compares session energy cost rather than just the per-kWh rate',()=>{
  const a=stop(),b=stop(2,'$0.36/kWh',150,{toMiles:130,toMinutes:130,onwardMiles:135,onwardMinutes:135});
  near(stopBudget(a,input,now).energyCost,10.5);near(stopBudget(b,input,now).energyCost,11.07);
  assert.equal(preferStops([b,a],{...input,preference:'cheapest'},now).ranked[0].station.id,a.station.id);
});
test('unknown and mixed tariffs never become a free option or trigger a silent mode change',()=>{
  for(const rate of ['Price not listed','$0.30–$0.60/kWh','$0.40/kWh + $2/session','€0.40/kWh']){
    const s=stop(1,rate),ranked=preferStops([s],{...input,preference:'cheapest'},now);
    assert.equal(ranked.ranked.length,0);assert.equal(ranked.summary.mode,'cheapest');assert.equal(ranked.summary.missingPrice,1);
    assert.equal(stopBudget(s,input,now).energyCost,null);
  }
});
test('a genuinely listed zero energy rate stays zero and is still labeled estimated',()=>{
  const free=stop(1,'Listed as free'),paid=stop(2);
  const chosen=preferStops([paid,free],{...input,preference:'cheapest'},now).ranked[0];assert.equal(chosen.station.id,free.station.id);
  const budget=tripBudget(plan(free),now);assert.equal(budget.total,0);assert.equal(budget.stops[0].price.confidence,'estimated');assert.ok(budget.energyKwh>0);
});
test('station-specific manual rates remain estimated and never leak to another station',()=>{
  const a=stop(1,'Price not listed'),b=stop(2,'Price not listed'),settings={...input,preference:'cheapest',enteredRates:{[b.station.id]:'0.3215'}};
  assert.equal(stopBudget(a,settings,now).energyCost,null);const quoted=stopBudget(b,settings,now);assert.equal(quoted.price.rate,.3215);assert.equal(quoted.price.source,'Your entered rate');
  assert.equal(preferStops([a,b],settings,now).ranked[0].station.id,b.station.id);
});
test('invalid overrides do not fall back to a published price',()=>{
  const a=stop();const options={...input,enteredRates:{[a.station.id]:'oops'}};
  assert.equal(stopBudget(a,options,now).price.rate,null);assert.equal(tripBudget(plan(a,options),now).total,null);
});
test('missing battery capacity or power prevents unsupported comparisons',()=>{
  const a=stop();assert.equal(preferStops([a],{...input,preference:'cheapest',batteryCapacity:null},now).ranked.length,0);
  assert.equal(preferStops([a],{...input,preference:'fastest',vehicleMaxKW:null},now).ranked.length,0);
  const unpowered={...a,station:{...a.station,connectorPower:{CCS1:null}}};
  assert.equal(preferStops([unpowered],{...input,preference:'fastest'},now).ranked.length,0);
  assert.equal(stopBudget(a,{...input,batteryCapacity:null},now).energyKwh,null);
});
test('safest prioritizes a supported backup before detour and stronger observations before buffer',()=>{
  const a=stop(),b=stop(2,'$0.40/kWh',150,{toMiles:130,toMinutes:130,onwardMiles:135,onwardMinutes:135});
  for(const s of [b,b.backup]){s.personalReport={sourceId:s.station.id,status:'working',reportedAt:now-60000};s.availability=evaluateAvailability(s.station,s.personalReport,now);}
  const mode={...input,preference:'safest'};assert.equal(preferStops([a,b],mode,now).ranked[0].station.id,b.station.id);
  const unbacked={...a,backup:null,rankPoints:0};assert.equal(preferStops([unbacked,b],{...mode,noStranding:false},now).ranked[0].station.id,b.station.id);
});
test('safest uses the weaker arrival battery when evidence is tied',()=>{
  const a=stop(),b=stop(2,'$0.40/kWh',150,{toMiles:130,toMinutes:130,onwardMiles:135,onwardMinutes:135});
  assert.equal(preferStops([b,a],{...input,preference:'safest'},now).ranked[0].station.id,a.station.id);
});
test('a further required stop blocks total-cost and full-trip time comparisons',()=>{
  const s=stop(1,'$0.40/kWh',150,{toMiles:100,toMinutes:50,onwardMiles:200,onwardMinutes:200});
  assert.equal(projectStopEnergy(s,input).reachesDestination,false);
  for(const preference of ['fastest','cheapest']){const ranked=preferStops([s],{...input,preference},now);assert.equal(ranked.ranked.length,0);assert.equal(ranked.summary.needsMoreStops,1);}
  const budget=tripBudget(plan(s),now);assert.equal(budget.state,'partial');assert.equal(budget.total,null);near(budget.knownSubtotal,12);
});
test('a zero known subtotal on an incomplete itinerary is not a free whole trip',()=>{
  const s=stop(1,'Listed as free',150,{toMiles:100,toMinutes:50,onwardMiles:200,onwardMinutes:200});
  const b=tripBudget(plan(s),now);assert.equal(b.knownSubtotal,0);assert.equal(b.total,null);assert.equal(b.state,'partial');
});
test('the complete budget includes only the normal charging stop, not the backup',()=>{
  const p=plan(),b=tripBudget(p,now);assert.equal(b.state,'complete');assert.equal(b.stops.length,1);near(b.total,10.5);near(b.energyKwh,26.25);
  assert.equal(b.stops[0].price.confidence,'estimated');assert.match(b.message,/if you reach/);
});
test('no-charge route means zero additional purchases without claiming starting energy was free',()=>{
  const p=plan();p.state='no-charge-needed';p.selected=null;p.route={...road,miles:100};p.input={...input,batteryCapacity:null};
  const b=tripBudget(p,now);assert.equal(b.total,0);assert.equal(b.stops.length,0);assert.match(b.message,/additional charging/);
});
test('operator tariffs must remain applicable through arrival and estimated charging',()=>{
  const s=stop(1,'Price not listed');s.station.operatorTariff={stationId:s.station.id,source:'operator',provider:'Test operator',sourceUrl:'https://example.com/tariff',observedAt:new Date(now-60000).toISOString(),validUntil:new Date(now+60000).toISOString(),currency:'USD',unit:'kWh',amount:.4,audience:'public'};
  assert.equal(stopBudget(s,input,now).energyCost,null);
  s.station.operatorTariff.validUntil=new Date(now+12*3600000).toISOString();assert.equal(stopBudget(s,input,now).price.confidence,'verified');
});
test('a cheapest suggestion expires as its arrival-valid tariff expires',()=>{
  const s=stop(1,'Price not listed'),end=(s.legs.toMinutes+s.chargeMinutes)*60000;
  s.station.operatorTariff={stationId:s.station.id,source:'operator',provider:'Test operator',sourceUrl:'https://example.com/tariff',observedAt:new Date(now-60000).toISOString(),validUntil:new Date(now+end+5000).toISOString(),currency:'USD',unit:'kWh',amount:.4,audience:'public'};
  const p=plan(s,{...input,preference:'cheapest'});p.selectedPrice=stopBudget(s,p.input,now).price;
  assert.equal(p.selectedPrice.confidence,'verified');assert.equal(isSmartStopExpired(p,now),false);assert.equal(isSmartStopExpired(p,now+6000),true);assert.equal(tripBudget(p,now+6000).total,null);
});
test('final road distance changes can reorder a cheapest comparison',()=>{
  const a=stop(),b=stop(2,'$0.41/kWh');const settings={...input,preference:'cheapest'};
  assert.equal(preferStops([b,a],settings,now).ranked[0].station.id,a.station.id);
  const changed=stop(1,'$0.40/kWh',150,{onwardMiles:165,onwardMinutes:165});
  assert.equal(preferStops([changed,b],settings,now).ranked[0].station.id,b.station.id);
});
test('input limits reject unknown modes, unrelated rate keys and oversized overrides',()=>{
  for(const change of [{preference:'magic'},{enteredRates:{'other':'0.4'}},{enteredRates:{'node/1':'1234567890123'}},{enteredRates:Object.fromEntries(Array.from({length:51},(_,i)=>[`node/${i}`,'0.4']))}])assert.equal(smartStopSchema.safeParse({...input,...change}).success,false);
});
