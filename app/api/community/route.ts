import { z } from 'zod';
import { database,failure,limit,requireUser,sameOrigin,ServiceError } from '@/lib/server-data';
import { communitySchema,stationIdSchema,reportIdSchema,historySQL } from '@/lib/community-history';
const headers={'Cache-Control':'private, no-store'};
export async function GET(request:Request){try{
 const user=await requireUser(request),station=stationIdSchema.parse(new URL(request.url).searchParams.get('stationId')),db=database(),now=Date.now();
 const [personal,community]=await Promise.all([
  db.prepare(historySQL.privateList).bind(user.userId,station).all(),
  db.prepare(historySQL.sharedList).bind(user.userId,station,now-30*86400000,now,user.userId).all(),
 ]);
 return Response.json({personal:personal.results,community:community.results.map(r=>({...r,mine:!!r.mine})),asOf:now},{headers});
 }catch(e){return failure(e instanceof z.ZodError?new ServiceError('Check the station ID.',400):e);}}
export async function POST(request:Request){try{
 sameOrigin(request);const user=await requireUser(request);await limit(`community:${user.userId}`,5000);
 const raw=await request.text();if(raw.length>2000)throw new ServiceError('Observation is too large.',400);
 const input=communitySchema.parse(JSON.parse(raw)),now=Date.now(),db=database();
 const result=await db.prepare(historySQL.share).bind(crypto.randomUUID(),user.userId,input.stationId,input.status,new Date(now).toISOString().slice(0,10),now).run();
 if(!result.meta.changes)throw new ServiceError('This daily observation was hidden after a flag and cannot be shared again today.',409);
 return Response.json({shared:true},{headers});
 }catch(e){return failure(e instanceof z.ZodError||e instanceof SyntaxError?new ServiceError('Confirm your own observation and explicit sharing consent.',400):e);}}
export async function DELETE(request:Request){try{
 sameOrigin(request);const user=await requireUser(request),query=new URL(request.url).searchParams;
 if(query.get('scope')==='private'){
  const station=stationIdSchema.parse(query.get('stationId')),db=database();
  await db.batch([db.prepare('DELETE FROM station_history WHERE owner=? AND station=?').bind(user.userId,station),db.prepare("DELETE FROM saved_items WHERE owner=? AND id=? AND kind='report'").bind(user.userId,`report:${station}`)]);
  return Response.json({cleared:true},{headers});
 }
 const id=reportIdSchema.parse(query.get('id'));
 const result=await database().prepare(historySQL.withdraw).bind(id,user.userId).run();
 if(!result.meta.changes)throw new ServiceError('Your shared observation was not found.',404);
 return Response.json({withdrawn:true},{headers});
 }catch(e){return failure(e instanceof z.ZodError?new ServiceError('Check the observation ID.',400):e);}}
export async function PATCH(request:Request){try{
 sameOrigin(request);const user=await requireUser(request);await limit(`community-flag:${user.userId}`,5000);
 const raw=await request.text();if(raw.length>300)throw new ServiceError('Flag is too large.',400);
 const {id}=z.object({id:reportIdSchema}).strict().parse(JSON.parse(raw)),db=database();
 const results=await db.batch([db.prepare(historySQL.flag).bind(user.userId,Date.now(),id,user.userId),db.prepare(historySQL.hide).bind(id,user.userId)]);
 if(!results[0].meta.changes)throw new ServiceError('That shared observation cannot be flagged by this account.',404);
 return Response.json({hidden:true},{headers});
 }catch(e){return failure(e instanceof z.ZodError||e instanceof SyntaxError?new ServiceError('Check the observation ID.',400):e);}}
