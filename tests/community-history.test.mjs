import {test} from 'node:test';
import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import {readFileSync} from 'node:fs';
import {communitySchema,historySQL,historySummary} from '../lib/community-history.ts';
const now=Date.parse('2026-09-15T16:00:00Z'),station='node/123';
function db(){const d=new DatabaseSync(':memory:');d.exec(readFileSync(new URL('../drizzle/0000_square_songbird.sql',import.meta.url),'utf8'));d.exec(readFileSync(new URL('../drizzle/0001_station_history.sql',import.meta.url),'utf8'));return d;}
function share(d,owner='alice',day='2026-09-15',status='charged',time=now){return d.prepare(historySQL.share).run(crypto.randomUUID(),owner,station,status,day,time);}
function list(d,owner='bob'){return d.prepare(historySQL.sharedList).all(owner,station,now-30*86400000,now,owner);}
test('migration preserves the last private report timestamp and never publishes existing notes',()=>{
 const d=new DatabaseSync(':memory:');d.exec(readFileSync(new URL('../drizzle/0000_square_songbird.sql',import.meta.url),'utf8'));
 d.prepare('INSERT INTO saved_items VALUES(?,?,?,?,?)').run('alice','report:node/123','report',JSON.stringify({sourceId:station,status:'working',note:'private note'}),1000);
 d.prepare('INSERT INTO saved_items VALUES(?,?,?,?,?)').run('alice','invalid','report','invalid JSON',1000);
 d.exec(readFileSync(new URL('../drizzle/0001_station_history.sql',import.meta.url),'utf8'));
 const rows=d.prepare(historySQL.privateList).all('alice',station);assert.equal(rows.length,1);assert.equal(rows[0].reportedAt,1000);assert.equal(rows[0].status,'working');assert.equal(list(d).length,0);d.close();
});
test('sharing requires explicit consent and a current personal observation; forged identity or dates are rejected',()=>{
 const input={stationId:station,status:'charged',consent:true,observedNow:true};assert.ok(communitySchema.safeParse(input).success);
 for(const changes of [{consent:false},{observedNow:false},{owner:'victim'},{reportedAt:now},{status:'verified'},{note:'name/email'},{stationId:'node/0'}])assert.equal(communitySchema.safeParse({...input,...changes}).success,false);
});
test('private histories are isolated by owner and charger',()=>{
 const d=db();d.prepare('INSERT INTO station_history VALUES(?,?,?,?,?)').run('private-id','alice',station,'busy',now);
 assert.equal(d.prepare(historySQL.privateList).all('bob',station).length,0);assert.equal(d.prepare(historySQL.privateList).all('alice','node/456').length,0);assert.equal(d.prepare(historySQL.privateList).all('alice',station).length,1);assert.equal(list(d).length,0);d.close();
});
test('daily observations update one entry without inflating successful-session counts',()=>{
 const d=db();share(d);share(d,'alice','2026-09-15','busy');const rows=list(d);assert.equal(rows.length,1);assert.equal(rows[0].status,'busy');assert.deepEqual(historySummary(rows),{total:1,charged:0,busy:1,problem:0});d.close();
});
test('different drivers and UTC days remain distinct observations',()=>{
 const d=db();share(d);share(d,'bob');share(d,'alice','2026-09-14','charged',now-86400000);assert.equal(list(d).length,3);d.close();
});
test('shared responses omit author identity and personal notes',()=>{
 const d=db();share(d);const row=list(d)[0];assert.deepEqual(Object.keys(row).sort(),['id','mine','reportedAt','status','visibility'].sort());assert.equal(row.mine,0);assert.equal(list(d,'alice')[0].mine,1);d.close();
});
test('withdrawal requires ownership and removes an entry from other viewers',()=>{
 const d=db();share(d);const id=list(d)[0].id;assert.equal(d.prepare(historySQL.withdraw).run(id,'bob').changes,0);assert.equal(list(d).length,1);
 d.prepare(historySQL.withdraw).run(id,'alice');assert.equal(list(d).length,0);assert.equal(list(d,'alice')[0].visibility,'withdrawn');d.close();
});
test('flags cannot target your own observation; another driver can hide an inaccurate entry',()=>{
 const d=db();share(d);const id=list(d)[0].id;assert.equal(d.prepare(historySQL.flag).run('alice',now,id,'alice').changes,0);
 assert.equal(d.prepare(historySQL.flag).run('bob',now,id,'bob').changes,1);d.prepare(historySQL.hide).run(id,'bob');assert.equal(list(d).length,0);assert.equal(list(d,'alice')[0].visibility,'hidden');d.close();
});
test('withdraw-and-reshare cannot bypass a flag on the same daily entry',()=>{
 const d=db();share(d);const id=list(d)[0].id;d.prepare(historySQL.flag).run('bob',now,id,'bob');d.prepare(historySQL.hide).run(id,'bob');d.prepare(historySQL.withdraw).run(id,'alice');assert.equal(share(d).changes,0);assert.equal(list(d).length,0);d.close();
});
test('ordinary withdrawn entries can be explicitly shared again without duplication',()=>{
 const d=db();share(d);d.prepare(historySQL.withdraw).run(list(d)[0].id,'alice');assert.equal(share(d).changes,1);assert.equal(list(d).length,1);d.close();
});
test('community history excludes future and older-than-30-day entries',()=>{
 const d=db();share(d,'past','2026-01-01','charged',now-31*86400000);share(d,'future','2026-10-01','charged',now+1);share(d);assert.equal(list(d).length,1);d.close();
});
test('counts exclude hidden and withdrawn reports and do not claim reliability or live availability',()=>{
 assert.deepEqual(historySummary([{status:'charged',visibility:'shared'},{status:'busy',visibility:'hidden'},{status:'problem',visibility:'withdrawn'}]),{total:1,charged:1,busy:0,problem:0});
});
test('history responses are bounded to the newest 100 observations',()=>{
 const d=db();for(let i=0;i<105;i++)share(d,`driver${i}`,'2026-09-15','charged',now-i);const rows=list(d);assert.equal(rows.length,100);assert.equal(rows[0].reportedAt,now);assert.equal(rows.at(-1).reportedAt,now-99);d.close();
});
