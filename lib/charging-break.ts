import type { Amenity } from './ev.ts';
import { evaluateStationHours } from './opening-hours.ts';

export const breakActivities={meal:{label:'Food',minutes:30},coffee:{label:'Coffee',minutes:10},restroom:{label:'Restroom',minutes:5},shopping:{label:'Shopping',minutes:25}};
export type BreakActivity=keyof typeof breakActivities;
export type BreakOption={place:Amenity;walkingMinutes:number;totalMinutes:number;hours:'open'|'closed'|'unknown';state:'possible'|'review'|'too-short'|'closed';reason:string};
export function planBreak(places:Amenity[],activity:BreakActivity,visitMinutes:number,windowMinutes:number|null,arrival:number,stale=false):BreakOption[]{
  if(!Number.isFinite(visitMinutes)||visitMinutes<1||visitMinutes>180)return [];
  const validWindow=windowMinutes!==null&&Number.isFinite(windowMinutes)&&windowMinutes>=1&&windowMinutes<=240;
  const options=places.filter(p=>(p.category||(p.kind==='food'?'meal':p.kind))===activity&&Number.isFinite(p.distance)&&p.distance>=0&&p.distance<=.51).sort((a,b)=>a.distance-b.distance).slice(0,40).map(place=>{
    // Planning assumption only: straight-line distance at 2.5 mph. No walking
    // route, road crossing, doorway access or queue has been verified.
    const oneWay=Math.ceil(place.distance/2.5*60),walkingMinutes=oneWay*2;
    const totalMinutes=walkingMinutes+visitMinutes+5;
    let hours:BreakOption['hours']='unknown';
    if(Number.isFinite(arrival)){
      const states=Array.from({length:Math.ceil(visitMinutes)+1},(_,minute)=>evaluateStationHours(place,new Date(arrival+(oneWay+2+Math.min(minute,visitMinutes))*60000)).state);
      hours=states.includes('closed')||states.includes('unavailable')?'closed':states.every(s=>s==='open')?'open':'unknown';
    }
    const accessKnown=['yes','permissive'].includes(place.access);
    let state:BreakOption['state']='review',reason='Confirm hours, access and the walking route before leaving the charger.';
    if(hours==='closed'){state='closed';reason='The listed schedule closes during the planned visit.';}
    else if(validWindow&&totalMinutes>windowMinutes!){state='too-short';reason='Walking, your activity allowance and the five-minute buffer exceed this break.';}
    else if(!validWindow)reason='Enter a break window or calculate a charging time to compare duration.';
    else if(stale)reason='These are saved directory listings. Refresh or confirm the place before relying on this plan.';
    else if(hours==='open'&&accessKnown){state='possible';reason='May fit under the walking assumption; listed hours cover the visit. Confirm the walking route.';}
    else if(place.access==='customers')reason='Customer access is listed. Confirm purchase requirements, hours and walking access.';
    return {place,walkingMinutes,totalMinutes,hours,state,reason};
  });
  const order={possible:0,review:1,'too-short':2,closed:3};
  return options.sort((a,b)=>order[a.state]-order[b.state]||a.totalMinutes-b.totalMinutes||a.place.id.localeCompare(b.place.id));
}
