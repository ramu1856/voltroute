import {test} from 'node:test';
import assert from 'node:assert/strict';
import {positionFresh,recoveryInput,watchDue} from '../lib/trip-watch.ts';
import {smartStopSchema,shortlistStations} from '../lib/smart-stop.ts';
import {normalizeStation} from '../lib/ev.ts';
const base=smartStopSchema.parse({origin:{lat:41,lon:-87,label:'Start'},destination:{lat:42,lon:-87,label:'End'},profile:{name:'Test',connector:'CCS1',range:250},battery:50});
test('rescue rejects empty coordinates and impossible battery or location',()=>{
 for(const vals of [['','0','20'],['0','','20'],['0','0',''],['91','0','20'],['0','0','0'],['0','0','101']])assert.equal(recoveryInput(base,...vals,null),null);
});
test('rescue keeps reserve, backup requirement and previously excluded stations',()=>{
 const input=recoveryInput({...base,excludedStationIds:['node/1']},'41.5','-87','20','node/2');assert.equal(input.battery,20);assert.equal(input.reserve,15);assert.equal(input.noStranding,true);assert.deepEqual(input.excludedStationIds,['node/1','node/2']);assert.equal(input.origin.lat,41.5);
});
test('failed charger cannot enter road shortlist or be considered as backup',()=>{
 const input=recoveryInput(base,'41','-87','50','node/1');const station=normalizeStation({id:1,type:'node',lat:41.01,lon:-87,tags:{amenity:'charging_station','socket:type1_combo':'2'}},base.origin);
 const route={coordinates:[[-87,41],[-87,42]],miles:70,minutes:90};assert.equal(shortlistStations([station],input,route,{},Date.now()).length,0);
});
test('position expires at five minutes and future timestamps are invalid',()=>{assert.equal(positionFresh(1000,300999),true);assert.equal(positionFresh(1000,301000),false);assert.equal(positionFresh(1000,999),false);});
test('watch never runs hidden, overlapping, too early or with stale position',()=>{
 assert.equal(watchDue(121000,1000,1000,true,false),true);
 for(const args of [[121000,1000,1000,false,false],[121000,1000,1000,true,true],[120999,1000,1000,true,false],[301000,1000,1000,true,false]])assert.equal(watchDue(...args),false);
});
