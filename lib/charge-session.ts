import { z } from 'zod';
import type { Station } from './ev.ts';
import { evaluatePrice } from './station-evidence.ts';
export const queueSchema=z.object({ahead:z.number().int().min(0).max(100),ports:z.number().int().min(1).max(100),busy:z.number().int().min(0).max(100),minutes:z.number().min(1).max(180)}).refine(q=>q.busy<=q.ports,'Busy ports cannot exceed usable ports.');
export function queueAllowance(input:unknown,observedAt:number,now:number){
 const parsed=queueSchema.safeParse(input);
 if(!parsed.success||!Number.isFinite(now)||!Number.isFinite(observedAt)||now<observedAt||now-observedAt>=300000)return null;
 const q=parsed.data,free=q.ports-q.busy,waiting=Math.max(0,q.ahead+1-free);
 return {minutes:Math.ceil(waiting/q.ports)*q.minutes,expiresAt:observedAt+300000};
}
export const sessionSchema=z.object({capacity:z.number().min(10).max(250),from:z.number().min(0).max(99),target:z.number().min(1).max(100),averageKW:z.number().min(.1).max(500),idleRate:z.number().min(0).max(100).nullable(),graceMinutes:z.number().int().min(0).max(180).nullable()}).refine(v=>v.target>v.from,'Target battery must exceed starting battery.');
export type SessionInput=z.infer<typeof sessionSchema>;
export function estimateSession(raw:unknown,station:Station,enteredRate:string,startedAt:number){
 const parsed=sessionSchema.safeParse(raw);if(!parsed.success||!Number.isFinite(startedAt))return null;
 const input=parsed.data,energyKwh=input.capacity*(input.target-input.from)/100,durationMs=energyKwh/input.averageKW*3600000;
 const finishAt=startedAt+durationMs;
 if(!Number.isFinite(finishAt)||durationMs>48*3600000)return null;
 const price=evaluatePrice(station,enteredRate,finishAt);
 return {input,energyKwh,durationMs,startedAt,finishAt,price,energyCost:price.rate===null?null:energyKwh*price.rate};
}
export type SessionEstimate=NonNullable<ReturnType<typeof estimateSession>>;
export function sessionClock(session:SessionEstimate,finishedAt:number|null,now:number){
 if(!Number.isFinite(now)||now<session.startedAt||finishedAt!==null&&(!Number.isFinite(finishedAt)||finishedAt<session.startedAt||finishedAt>now))return null;
 const remainingMs=Math.max(0,session.finishAt-now),elapsedMs=(finishedAt??now)-session.startedAt;
 const grace=session.input.graceMinutes;
 const idleStartsAt=finishedAt!==null&&grace!==null?finishedAt+grace*60000:null;
 const idleMs=idleStartsAt===null?null:Math.max(0,now-idleStartsAt);
 return {remainingMs,elapsedMs,checkTarget:finishedAt===null&&now>=session.finishAt,idleStartsAt,idleDue:idleStartsAt!==null&&now>=idleStartsAt,idleCost:idleMs===null||session.input.idleRate===null?null:idleMs/60000*session.input.idleRate};
}
