import {test} from 'node:test';
import assert from 'node:assert/strict';
import {queueAllowance,estimateSession,sessionClock} from '../lib/charge-session.ts';
import {normalizeStation} from '../lib/ev.ts';
const now=Date.parse('2026-09-15T16:00:00Z');
const station=normalizeStation({id:1,type:'node',lat:41.88,lon:-87.63,tags:{amenity:'charging_station'}},{lat:41.88,lon:-87.63});
const input={capacity:75,from:20,target:80,averageKW:90,idleRate:null,graceMinutes:null};
test('manual queue allowance uses currently free slots before modeled charging waves',()=>{
 assert.equal(queueAllowance({ahead:0,ports:2,busy:1,minutes:30},now,now).minutes,0);
 assert.equal(queueAllowance({ahead:1,ports:2,busy:1,minutes:30},now,now).minutes,30);
 assert.equal(queueAllowance({ahead:3,ports:2,busy:2,minutes:30},now,now).minutes,60);
});
test('missing, fractional or contradictory queue counts never imply zero wait',()=>{
 for(const q of [{ahead:0,ports:0,busy:0,minutes:30},{ahead:0,ports:1,busy:2,minutes:30},{ahead:.5,ports:1,busy:1,minutes:30},{ahead:0,ports:1,busy:1,minutes:NaN}])assert.equal(queueAllowance(q,now,now),null);
});
test('queue observations expire after five minutes and cannot come from the future',()=>{
 const q={ahead:0,ports:1,busy:1,minutes:30};assert.ok(queueAllowance(q,now,now+299999));assert.equal(queueAllowance(q,now,now+300000),null);assert.equal(queueAllowance(q,now,now-1),null);
});
test('session energy and finish time use entered capacity and average power',()=>{
 const s=estimateSession(input,station,'',now);assert.equal(s.energyKwh,45);assert.equal(s.durationMs,30*60000);assert.equal(s.finishAt,now+30*60000);assert.equal(s.energyCost,null);
});
test('unknown capacity, zero power, reversed targets and unsupported durations are rejected',()=>{
 for(const changes of [{capacity:NaN},{averageKW:0},{target:10},{capacity:250,averageKW:.1},{graceMinutes:-1},{idleRate:-1}])assert.equal(estimateSession({...input,...changes},station,'',now),null);
});
test('explicit zero and known per-kWh prices are distinct from unavailable costs',()=>{
 assert.equal(estimateSession(input,station,'0',now).energyCost,0);assert.equal(estimateSession(input,station,'0.5',now).energyCost,22.5);assert.equal(estimateSession(input,station,'invalid',now).energyCost,null);
});
test('an operator quote expiring before the estimated finish cannot price the session',()=>{
 const s={...station,operatorTariff:{stationId:station.id,source:'operator',provider:'Test',sourceUrl:'https://example.com/rate',observedAt:new Date(now).toISOString(),validUntil:new Date(now+60000).toISOString(),currency:'USD',unit:'kWh',amount:.5,audience:'public'}};
 assert.equal(estimateSession(input,s,'',now).energyCost,null);
});
test('estimated completion prompts a check but never starts idle charges automatically',()=>{
 const s=estimateSession({...input,idleRate:1,graceMinutes:5},station,'',now),clock=sessionClock(s,null,now+60*60000);assert.equal(clock.checkTarget,true);assert.equal(clock.idleStartsAt,null);assert.equal(clock.idleCost,null);assert.equal(clock.idleDue,false);
});
test('idle reminder starts from manually confirmed finish, not predicted finish',()=>{
 const s=estimateSession({...input,idleRate:.5,graceMinutes:5},station,'',now),finished=now+10*60000;
 assert.equal(sessionClock(s,finished,finished+4*60000).idleDue,false);const c=sessionClock(s,finished,finished+7*60000);assert.equal(c.idleDue,true);assert.equal(c.idleCost,1);assert.equal(c.checkTarget,false);
});
test('missing idle timing or rate stays unavailable while a known grace period can remind',()=>{
 const s=estimateSession(input,station,'',now);assert.equal(sessionClock(s,now+60000,now+3600000).idleCost,null);
 const grace=estimateSession({...input,graceMinutes:0},station,'',now);assert.equal(sessionClock(grace,now+60000,now+60000).idleDue,true);assert.equal(sessionClock(grace,now+60000,now+60000).idleCost,null);
});
test('absolute timestamps recover elapsed time after a background tab resumes',()=>{
 const s=estimateSession(input,station,'',now);const c=sessionClock(s,null,now+35*60000);assert.equal(c.elapsedMs,35*60000);assert.equal(c.remainingMs,0);assert.equal(c.checkTarget,true);
});
test('invalid or future completion timestamps are rejected',()=>{
 const s=estimateSession(input,station,'',now);assert.equal(sessionClock(s,null,now-1),null);assert.equal(sessionClock(s,now-1,now+1),null);assert.equal(sessionClock(s,now+100,now+50),null);
});
