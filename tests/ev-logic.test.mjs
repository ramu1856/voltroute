import { test } from 'node:test';
import assert from 'node:assert/strict';
import { miles, normalizeStation, normalizeAmenities, chargingCheckpoints, powerKW, safeWeb, tripSchema } from '../lib/ev.ts';
import { vehicleCatalog, vehicleMakes, vehicleTypes } from '../lib/vehicles.ts';
const origin={lat:41.88,lon:-87.63};
test('distances and supported power units',()=>{assert.equal(miles(origin,origin),0);assert.ok(miles(origin,{lat:42.33,lon:-83.05})>200);assert.equal(powerKW('150 kW; 350 kW'),350);assert.equal(powerKW('22000 W'),22);assert.equal(powerKW('unknown'),null);});
test('station metadata never fabricates connector, price or access',()=>{
 const s=normalizeStation({id:1,type:'node',...origin,tags:{amenity:'charging_station'}},origin);
 assert.deepEqual(s.connectors,[]);assert.equal(s.power,null);assert.equal(s.fee,'Price not listed');assert.equal(s.toilets,'unknown');assert.equal(normalizeStation({id:1,type:'node',...origin,tags:{access:'private'}},origin),null);
});
test('known socket tags map to connectors without treating zero ports as support',()=>{
 const s=normalizeStation({id:1,type:'node',...origin,tags:{'socket:type1_combo':'2','socket:nacs':'0','socket:type1_combo:output':'150 kW'}},origin);
 assert.deepEqual(s.connectors,['CCS1']);assert.equal(s.power,150);
});
test('food is not evidence of a restroom',()=>{const r=normalizeAmenities([{id:2,type:'node',...origin,tags:{amenity:'restaurant',name:'Test restaurant'}}],origin);assert.equal(r.length,1);assert.equal(r[0].kind,'food');});
test('customer restroom is separate and private restrooms excluded',()=>{const result=normalizeAmenities([{id:1,type:'node',...origin,tags:{amenity:'restaurant',name:'Cafe',toilets:'yes','toilets:access':'customers'}},{id:2,type:'node',...origin,tags:{amenity:'toilets',access:'private'}}],origin);assert.equal(result.length,2);assert.equal(result[1].kind,'restroom');assert.equal(result[1].access,'customers');});
test('amenities outside half-mile search excluded',()=>{assert.equal(normalizeAmenities([{id:1,type:'node',lat:42.5,lon:-87.6,tags:{amenity:'toilets'}}],origin).length,0);});
test('unsafe operator links rejected',()=>{assert.equal(safeWeb('javascript:alert(1)'),null);assert.equal(safeWeb('https://example.com'),'https://example.com/');});
test('route checks react to distance and battery, never invent a charger',()=>{const r={coordinates:[[-87.63,41.88],[-86,42],[-83.05,42.33]],miles:280,minutes:290,fetchedAt:''};const p={name:'EV',connector:'CCS1',range:250};assert.ok(chargingCheckpoints(r,p,80).length>=1);assert.ok(chargingCheckpoints(r,p,10)[0].mile===0);assert.equal(chargingCheckpoints({...r,miles:20},p,80).length,0);});
test('trip inputs reject invalid coordinates, battery, connectors and range',()=>{const v={origin:{...origin,label:'Start'},destination:{lat:42.33,lon:-83.05,label:'End'},profile:{name:'Car',connector:'CCS1',range:250},battery:80};assert.equal(tripSchema.safeParse(v).success,true);assert.equal(tripSchema.safeParse({...v,battery:101}).success,false);assert.equal(tripSchema.safeParse({...v,profile:{...v.profile,range:0}}).success,false);});
test('vehicle catalog has valid unique selectable models across every displayed type',()=>{const keys=vehicleCatalog.map(v=>`${v.make}|${v.model}|${v.type}`);assert.equal(new Set(keys).size,keys.length);assert.ok(vehicleMakes.length>=20);for(const type of vehicleTypes)assert.ok(vehicleCatalog.some(v=>v.type===type));for(const v of vehicleCatalog){assert.ok(v.range>=30&&v.range<=600);assert.ok(['NACS','CCS1','J1772','CHAdeMO'].includes(v.connector));assert.equal(v.name,`${v.make} ${v.model}`);}});
