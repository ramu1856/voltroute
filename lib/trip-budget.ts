import type { RankedStop, SmartStopInput, SmartStopResult } from './smart-stop.ts';
import { evaluatePrice, type PriceInfo } from './station-evidence.ts';
import { isSmartStopExpired } from './smart-stop-validity.ts';

export type StopBudget={stationId:string;stationName:string;arrivalBattery:number;targetBattery:number;destinationBattery:number;reachesDestination:boolean;energyKwh:number|null;chargeMinutes:number|null;driveChargeMinutes:number|null;price:PriceInfo;energyCost:number|null;missing:string[]};
export type TripBudget={state:'complete'|'partial'|'unavailable';total:number|null;knownSubtotal:number|null;energyKwh:number|null;stops:StopBudget[];message:string;missing:string[]};

export function projectStopEnergy(stop:RankedStop,input:SmartStopInput){
  const arrival=input.battery-stop.legs.toMiles/input.profile.range*100;
  const destination=stop.targetBattery-stop.legs.onwardMiles/input.profile.range*100;
  const delta=stop.targetBattery-arrival;
  const valid=[arrival,destination,delta,input.profile.range,stop.legs.toMiles,stop.legs.onwardMiles,stop.legs.toMinutes,stop.legs.onwardMinutes].every(Number.isFinite)&&Object.values(stop.legs).every(n=>n>=0)&&input.profile.range>=30&&input.profile.range<=600&&arrival>=0&&arrival<=100&&stop.targetBattery>arrival&&stop.targetBattery<=80;
  const reachesDestination=valid&&destination+1e-8>=input.reserve;
  return {arrival,destination,delta,valid,reachesDestination};
}

export function stopBudget(stop:RankedStop,input:SmartStopInput,now:number):StopBudget{
  const {arrival,destination,delta,valid,reachesDestination}=projectStopEnergy(stop,input);
  const capacity=input.batteryCapacity;
  const energyKwh=valid&&capacity!==null&&Number.isFinite(capacity)&&capacity>=10&&capacity<=250?capacity*delta/100:null;
  const listed=stop.station.connectorPower?.[input.profile.connector];
  const usable=typeof listed==='number'&&Number.isFinite(listed)&&listed>0&&input.vehicleMaxKW!==null&&Number.isFinite(input.vehicleMaxKW)&&input.vehicleMaxKW>0?Math.min(listed,input.vehicleMaxKW):null;
  const chargeMinutes=energyKwh!==null&&usable!==null?Math.ceil(energyKwh/usable*60*1.25):null;
  const driveChargeMinutes=chargeMinutes===null?null:stop.legs.toMinutes+stop.legs.onwardMinutes+chargeMinutes;
  const price=evaluatePrice(stop.station,input.enteredRates?.[stop.station.id],now+(stop.legs.toMinutes+(chargeMinutes??0))*60_000);
  const cost=energyKwh!==null&&price.rate!==null?energyKwh*price.rate:null;
  const energyCost=cost!==null&&Number.isFinite(cost)?cost:null;
  const missing:string[]=[];
  if(!valid)missing.push('The charging battery or road inputs are invalid.');
  if(energyKwh===null)missing.push('Enter usable battery capacity to estimate charging energy.');
  if(price.rate===null)missing.push(price.inputError||'A usable price for this station is missing.');
  if(!reachesDestination)missing.push('Further charging stops are required and have not been planned or priced.');
  return {stationId:stop.station.id,stationName:stop.station.name,arrivalBattery:arrival,targetBattery:stop.targetBattery,destinationBattery:destination,reachesDestination,energyKwh,chargeMinutes,driveChargeMinutes,price,energyCost,missing};
}

// "Complete" means all charging energy in the zero/one-stop budget is covered.
// It is conditional on the planned charge succeeding, not a final operator bill.
export function tripBudget(result:SmartStopResult,now:number):TripBudget{
  if(isSmartStopExpired(result,now))return {state:'unavailable',total:null,knownSubtotal:null,energyKwh:null,stops:[],message:'Recalculate this plan before using its charging budget.',missing:['The plan or its supporting evidence is no longer current.']};
  if(result.state==='no-charge-needed'&&result.input.battery-result.route.miles/result.input.profile.range*100+1e-8>=result.input.reserve){return {state:'complete',total:0,knownSubtotal:0,energyKwh:0,stops:[],message:'No additional charging is needed on this route under your entered range and reserve.',missing:[]};}
  if(result.state!=='suggested'||!result.selected)return {state:'unavailable',total:null,knownSubtotal:null,energyKwh:null,stops:[],message:'A charging plan is needed before a trip budget can be shown.',missing:['No charging stop is recommended under the current settings.']};
  const stop=stopBudget(result.selected,result.input,now),complete=stop.reachesDestination&&stop.energyCost!==null;
  return {state:complete?'complete':stop.energyCost!==null?'partial':'unavailable',total:complete?stop.energyCost:null,knownSubtotal:stop.energyCost,energyKwh:stop.energyKwh,stops:[stop],message:complete?'This one planned charging session can cover the route if you reach the stated target battery.':stop.reachesDestination?'One planned charge can cover the route, but a complete energy price estimate is not available.':'Only the next charging stop is budgeted. The rest of the trip still needs charging stops.',missing:stop.missing};
}
