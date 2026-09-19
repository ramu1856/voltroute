import { test } from 'node:test';
import assert from 'node:assert/strict';
import { chooseTomTomAvailabilitySource, tomTomOperatorObservation } from '../lib/tomtom-live.ts';

test('chooses a nearby TomTom charging source with matching name evidence',()=>{
  const result=chooseTomTomAvailabilitySource([
    {position:{lat:41.88,lon:-87.63},poi:{name:'Example Fast Charge'},dataSources:{chargingAvailability:{id:'near'}}},
    {position:{lat:41.90,lon:-87.65},poi:{name:'Other Charger'},dataSources:{chargingAvailability:{id:'far'}}},
  ],{lat:41.88,lon:-87.63,name:'Example Fast Charge',network:'Example'});
  assert.equal(result?.id,'near');
});

test('rejects weak unmatched sources that are not extremely close',()=>{
  const result=chooseTomTomAvailabilitySource([
    {position:{lat:41.881,lon:-87.63},poi:{name:'Different Station'},dataSources:{chargingAvailability:{id:'wrong'}}},
  ],{lat:41.88,lon:-87.63,name:'Example Charge',network:'Example'});
  assert.equal(result,null);
});

test('normalizes current port counts into a live operator observation',()=>{
  const result=tomTomOperatorObservation('node/1',{
    connectors:[
      {type:'IEC62196Type1CCS',total:4,availability:{current:{available:2,occupied:1,reserved:0,unknown:0,outOfService:1}}},
      {type:'IEC62196Type1CCS',total:2,availability:{current:{available:0,occupied:2,reserved:0,unknown:0,outOfService:0}}},
    ],
  },'2026-09-19T08:00:00Z');
  assert.equal(result?.status,'available');
  assert.equal(result?.availablePorts,2);
  assert.equal(result?.totalPorts,6);
});

test('does not invent availability when all ports are unknown',()=>{
  const result=tomTomOperatorObservation('node/1',{
    connectors:[{type:'Tesla',total:3,availability:{current:{available:0,occupied:0,reserved:0,unknown:3,outOfService:0}}}],
  },'2026-09-19T08:00:00Z');
  assert.equal(result,null);
});

test('marks all out-of-service ports unavailable',()=>{
  const result=tomTomOperatorObservation('node/1',{
    connectors:[{type:'Chademo',total:2,availability:{current:{available:0,occupied:0,reserved:0,unknown:0,outOfService:2}}}],
  },'2026-09-19T08:00:00Z');
  assert.equal(result?.status,'unavailable');
  assert.equal(result?.availablePorts,0);
});
