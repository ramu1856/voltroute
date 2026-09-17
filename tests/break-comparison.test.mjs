import {test} from 'node:test';
import assert from 'node:assert/strict';
import {normalizeStation,normalizeAmenities} from '../lib/ev.ts';
import {planBreak} from '../lib/charging-break.ts';
import {smartStopSchema,rankStops} from '../lib/smart-stop.ts';
import {evaluateBackup,attachBackup} from '../lib/backup-charger.ts';
import {stopBudget} from '../lib/trip-budget.ts';
import {compareCheckedRoutes,selectCheckedRoute} from '../lib/route-comparison.ts';
const now=Date.parse('2026-09-15T16:00:00Z'),origin={lat:41.88,lon:-87.63};
const place={id:'node/1/food',name:'Test cafe',...origin,kind:'food',category:'coffee',distance:.1,hours:'24/7',access:'yes',fee:'unknown',wheelchair:'unknown',sourceUrl:'https://www.openstreetmap.org/node/1'};
test('break duration includes both walks, the chosen activity and return buffer',()=>{
 const option=planBreak([place],'coffee',10,25,now)[0];assert.equal(option.walkingMinutes,6);assert.equal(option.totalMinutes,21);assert.equal(option.state,'possible');
 assert.equal(planBreak([place],'coffee',10,20,now)[0].state,'too-short');
});
test('missing charging time does not create a default break window',()=>{assert.equal(planBreak([place],'coffee',10,null,now)[0].state,'review');});
test('hours are checked throughout a visit including a closure between open endpoints',()=>{
 const p={...place,distance:0,hours:'Tu 11:00-11:05,11:07-12:00'};
 const option=planBreak([p],'coffee',10,30,now)[0];assert.equal(option.hours,'closed');assert.equal(option.state,'closed');
});
test('unknown schedules, customer-only access and stale directory data require review',()=>{
 assert.equal(planBreak([{...place,hours:'Hours not listed'}],'coffee',10,30,now)[0].state,'review');
 assert.equal(planBreak([{...place,access:'customers'}],'coffee',10,30,now)[0].state,'review');
 assert.equal(planBreak([place],'coffee',10,30,now,true)[0].state,'review');
 assert.equal(planBreak([place],'coffee',10,30,NaN)[0].hours,'unknown');
});
test('unknown or out-of-area distances and invalid activity allowances cannot fit',()=>{
 assert.deepEqual(planBreak([{...place,distance:NaN},{...place,distance:1}],'coffee',10,30,now),[]);
 assert.deepEqual(planBreak([place],'coffee',0,30,now),[]);
});
test('coffee, shopping and explicitly mapped restrooms remain distinct',()=>{
 const amenities=normalizeAmenities([{id:1,type:'node',...origin,tags:{amenity:'cafe'}},{id:2,type:'node',...origin,tags:{shop:'supermarket'}},{id:3,type:'node',...origin,tags:{amenity:'toilets'}}],origin);
 assert.equal(planBreak(amenities,'coffee',10,30,now).length,1);assert.equal(planBreak(amenities,'shopping',20,30,now).length,1);assert.equal(planBreak(amenities,'restroom',5,30,now).length,1);
 assert.equal(amenities.filter(p=>p.kind==='restroom').length,1);
});

const input=smartStopSchema.parse({origin:{...origin,label:'Start'},destination:{lat:42.33,lon:-83.05,label:'End'},profile:{name:'Test EV',connector:'CCS1',range:250},battery:80,batteryCapacity:75,vehicleMaxKW:150});
const road={coordinates:[[-87.63,41.88],[-85.5,42],[-83.05,42.33]],miles:250,minutes:250,fetchedAt:new Date(now).toISOString()};
function station(id,price='Price not listed'){return normalizeStation({id,type:'node',lat:42,lon:-85.5+id*.02,tags:{name:`Test ${id}`,amenity:'charging_station',access:'yes',opening_hours:'24/7',timezone:'America/Chicago',charge:price,'socket:type1_combo':'2','socket:type1_combo:output':'150 kW'}},origin);}
function option(id,price='Price not listed'){
 const main=rankStops([{station:station(id,price),legs:{toMiles:100+id,toMinutes:100+id,onwardMiles:150,onwardMinutes:150,snapMeters:5}}],input,road,{},now).ranked[0];assert.ok(main);
 const backup=evaluateBackup(main,{...station(id+100),lon:main.station.lon+.02},{miles:5,minutes:8,fromSnapMeters:5,toSnapMeters:5},input,undefined,now);assert.notEqual(typeof backup,'string');
 backup.route={...road,coordinates:[[main.station.lon,42],[backup.station.lon,42]],miles:5,minutes:8};
 const stop=attachBackup(main,backup,input),route={...road,miles:250+id,minutes:250+id,coordinates:[road.coordinates[0],[stop.station.lon,42],road.coordinates[2]]};
 return {stop,route,price:stopBudget(stop,input,now).price};
}
function plan(){const options=[option(1),option(2,'$0.50/kWh')];return {input,state:'suggested',message:'',selected:options[0].stop,route:options[0].route,baseRoute:road,candidates:options.map(o=>o.stop),routeOptions:options,excluded:{},mappedCount:2,roadCheckedCount:2,searchLimited:false,directoryFetchedAt:road.fetchedAt,calculatedAt:road.fetchedAt,validUntil:new Date(now+600000).toISOString()};}
test('only fully checked options are compared; unvalidated candidates never become routes',()=>{
 const p=plan();p.candidates.push(option(3).stop);const rows=compareCheckedRoutes(p,now);assert.equal(rows.length,2);assert.equal(selectCheckedRoute(p,'node/3',now),null);
});
test('route selection switches road, charger, backup and price as one plan without extending expiry',()=>{
 const p=plan(),next=selectCheckedRoute(p,'node/2',now);assert.ok(next);assert.equal(next.selected.station.id,'node/2');assert.equal(next.selected.backup.station.id,'node/102');assert.deepEqual(next.route,p.routeOptions[1].route);assert.deepEqual(next.selectedPrice,p.routeOptions[1].price);assert.equal(next.validUntil,p.validUntil);assert.equal(next.calculatedAt,p.calculatedAt);assert.equal(p.selected.station.id,'node/1');
});
test('unknown prices remain blank while supported costs and charge durations can compare',()=>{
 const rows=compareCheckedRoutes(plan(),now);assert.equal(rows[0].cost,null);assert.ok(rows[1].cost>0);assert.ok(rows[0].chargeMinutes>0);assert.equal(rows[0].totalMinutes,rows[0].driveMinutes+rows[0].chargeMinutes);
});
test('missing vehicle capacity keeps charging and complete trip time unavailable',()=>{
 const p=plan();p.input={...input,batteryCapacity:null};const rows=compareCheckedRoutes(p,now);assert.equal(rows[0].chargeMinutes,null);assert.equal(rows[0].totalMinutes,null);assert.equal(rows[1].cost,null);
});
test('incomplete charging plans expose only next-stop subtotal, never a full trip cost or time',()=>{
 const p=plan();const o=p.routeOptions[1];o.stop.legs.onwardMiles=200;o.route.miles=o.stop.legs.toMiles+200;
 const row=compareCheckedRoutes(p,now)[1];assert.equal(row.complete,false);assert.equal(row.cost,null);assert.ok(row.subtotal>0);assert.equal(row.totalMinutes,null);
});
test('expired routes cannot be selected or show actionable confidence and cost',()=>{
 const p=plan(),later=now+600001;assert.equal(selectCheckedRoute(p,'node/2',later),null);const row=compareCheckedRoutes(p,later)[1];assert.equal(row.expired,true);assert.equal(row.score,null);assert.equal(row.cost,null);
});
test('a backup losing required opening hours blocks only the affected option',()=>{
 const p=plan();p.routeOptions[1].stop.backup.station.hours='off';assert.equal(selectCheckedRoute(p,'node/2',now),null);assert.ok(selectCheckedRoute(p,'node/1',now));
});
