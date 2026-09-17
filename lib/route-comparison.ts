import type { SmartStopResult } from './smart-stop.ts';
import { isSmartStopExpired } from './smart-stop-validity.ts';
import { assessTrip } from './trip-assessment.ts';
import { tripBudget, projectStopEnergy } from './trip-budget.ts';

export function selectCheckedRoute(result:SmartStopResult,stationId:string,now:number):SmartStopResult|null{
 const option=result.routeOptions?.find(o=>o.stop.station.id===stationId);
 if(!option||!option.route.coordinates.length)return null;
 const selected={...option.stop,reasons:[...option.stop.reasons.filter(r=>r!=='You selected this checked alternative.'),'You selected this checked alternative.']};
 const next={...result,selected,route:option.route,selectedPrice:option.price,userSelectedRoute:true,candidates:[selected,...result.candidates.filter(s=>s.station.id!==stationId)].slice(0,3)};
 // Preserve the original calculation clock and every candidate's evidence.
 if(isSmartStopExpired(next,now))return null;
 return next;
}

export function compareCheckedRoutes(result:SmartStopResult,now:number){
 return (result.routeOptions||[]).slice(0,2).map(option=>{
  const next=selectCheckedRoute(result,option.stop.station.id,now);
  const budget=next?tripBudget(next,now):null;
  const complete=next?projectStopEnergy(option.stop,result.input).reachesDestination:false;
  const chargeMinutes=next?budget?.stops[0]?.chargeMinutes??null:null;
  return {id:option.stop.station.id,name:option.stop.station.name,selected:option.stop.station.id===result.selected?.station.id,expired:!next,miles:option.route.miles,driveMinutes:option.route.minutes,chargeMinutes,totalMinutes:complete&&chargeMinutes!==null?option.route.minutes+chargeMinutes:null,cost:budget?.total??null,priceLabel:budget?.stops[0]?.price.label||'Unavailable',subtotal:budget?.knownSubtotal??null,score:next?assessTrip(next,now).score:null,complete,backup:!!option.stop.backup?.qualifiesForMode};
 });
}
