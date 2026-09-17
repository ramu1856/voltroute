import {smartStopSchema, type SmartStopInput} from './smart-stop.ts';
export const positionLifetime=5*60_000;
export function positionFresh(at:number,now:number){return Number.isFinite(at)&&Number.isFinite(now)&&now>=at&&now-at<positionLifetime;}
export function recoveryInput(base:SmartStopInput,lat:string,lon:string,battery:string,failed:string|null){
 if([lat,lon,battery].some(v=>v.trim()===''))return null;
 const parsed=smartStopSchema.safeParse({...base,origin:{lat:Number(lat),lon:Number(lon),label:'Updated trip position'},battery:Number(battery),excludedStationIds:[...new Set([...(base.excludedStationIds??[]),...(failed?[failed]:[])])]});
 return parsed.success?parsed.data:null;
}
export function watchDue(now:number,observedAt:number,lastStarted:number,visible:boolean,busy:boolean){return visible&&!busy&&positionFresh(observedAt,now)&&now-lastStarted>=120_000;}
