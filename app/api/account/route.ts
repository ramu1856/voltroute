import { z } from 'zod';
import { database, failure, limit, requireUser, sameOrigin, ServiceError } from '@/lib/server-data';
import { pointSchema, profileSchema, tripSchema } from '@/lib/ev';
const stationSchema=pointSchema.extend({sourceId:z.string().regex(/^(node|way|relation)\/\d+$/)});
const reportSchema=z.object({sourceId:z.string().regex(/^(node|way|relation)\/\d+$/),stationName:z.string().trim().min(1).max(160),status:z.enum(['working','busy','broken']),note:z.string().trim().max(240).default('')});
const saveSchema=z.discriminatedUnion('kind',[
 z.object({kind:z.literal('profile'),payload:profileSchema}),
 z.object({kind:z.literal('station'),payload:stationSchema}),
 z.object({kind:z.literal('trip'),payload:tripSchema}),
 z.object({kind:z.literal('report'),payload:reportSchema}),
]);
export async function GET(request:Request) {try{const user=await requireUser(request);const result=await database().prepare('SELECT id,kind,payload,updated FROM saved_items WHERE owner=? ORDER BY updated DESC LIMIT 200').bind(user.userId).all<{id:string;kind:string;payload:string;updated:number}>();return Response.json({user:{name:user.displayName,email:user.email},items:result.results.map(i=>({...i,payload:JSON.parse(i.payload)}))},{headers:{'Cache-Control':'private, no-store'}});}catch(e){return failure(e);}}
export async function POST(request:Request) {try{
 sameOrigin(request);const user=await requireUser(request);await limit(`save:${user.userId}`,500);
 if(Number(request.headers.get('content-length')||0)>8000)throw new ServiceError('Saved item is too large.',400);
 const raw=await request.text();if(raw.length>8000)throw new ServiceError('Saved item is too large.',400);
 const item=saveSchema.parse(JSON.parse(raw));const db=database();
 const count=await db.prepare('SELECT COUNT(*) AS n FROM saved_items WHERE owner=?').bind(user.userId).first<{n:number}>();
 if((count?.n||0)>=200 && item.kind!=='profile')throw new ServiceError('You have 200 saved items. Remove one before saving another.',400);
 const id=item.kind==='profile'?'profile':item.kind==='station'?`station:${item.payload.sourceId}`:item.kind==='report'?`report:${item.payload.sourceId}`:`trip:${crypto.randomUUID()}`;
 const updated=Date.now();
 const writes=[db.prepare('INSERT INTO saved_items(owner,id,kind,payload,updated) VALUES(?,?,?,?,?) ON CONFLICT(owner,id) DO UPDATE SET payload=excluded.payload,updated=excluded.updated').bind(user.userId,id,item.kind,JSON.stringify(item.payload),updated)];
 if(item.kind==='report'){
  writes.push(db.prepare('INSERT INTO station_history(id,owner,station,status,reported_at) VALUES(?,?,?,?,?)').bind(crypto.randomUUID(),user.userId,item.payload.sourceId,item.payload.status,updated));
  writes.push(db.prepare('DELETE FROM station_history WHERE owner=? AND id NOT IN (SELECT id FROM station_history WHERE owner=? ORDER BY reported_at DESC LIMIT 500)').bind(user.userId,user.userId));
 }
 await db.batch(writes);
 return Response.json({id,saved:true,updated});
 }catch(e){return failure(e instanceof z.ZodError || e instanceof SyntaxError ?new ServiceError('Please check the saved item details.',400):e);}}
export async function DELETE(request:Request) {try{sameOrigin(request);const user=await requireUser(request);const id=z.string().min(1).max(100).parse(new URL(request.url).searchParams.get('id'));await database().prepare('DELETE FROM saved_items WHERE owner=? AND id=?').bind(user.userId,id).run();return Response.json({deleted:true});}catch(e){return failure(e);}}
