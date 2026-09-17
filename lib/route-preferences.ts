import type { RankedStop, SmartStopInput } from './smart-stop.ts';
import { stopBudget } from './trip-budget.ts';
import type { AvailabilityInfo } from './station-evidence.ts';

export const routePreferences={
  balanced:{label:'Balanced',description:'Balance detour, charging speed and uncertainty for the next stop.'},
  fastest:{label:'Fastest',description:'Compare driving plus charging time for supported one-stop trips. Waits and traffic are not predicted.'},
  cheapest:{label:'Cheapest',description:'Compare total charging energy cost for priced one-stop trips. Unpriced options cannot be called cheaper.'},
  safest:{label:'Safest',description:'Prioritize a qualifying backup, stronger observations, access and hours, then battery buffer. This is not a safety guarantee.'},
} as const;
export type RoutePreference=keyof typeof routePreferences;
export type PreferenceSummary={mode:RoutePreference;evaluated:number;comparable:number;missingPrice:number;missingEnergy:number;missingTime:number;needsMoreStops:number;explanation:string};

const evidenceRisk=(info:AvailabilityInfo|undefined)=>!info?3:info.condition==='unavailable'?4:info.condition==='busy'?3:info.freshness==='live'&&info.condition==='available'?0:info.freshness==='recent'&&['working','available'].includes(info.condition)?1:2;
function safeguards(stop:RankedStop,input:SmartStopInput):number[]{
  const b=stop.backup;
  const mainBattery=input.battery-stop.legs.toMiles/input.profile.range*100;
  const backupBattery=b?input.battery-(stop.legs.toMiles+b.connection.miles)/input.profile.range*100-input.failureAllowance:mainBattery;
  const uncertain=[!['yes','permissive'].includes(stop.station.access),stop.hours.state!=='open',!b||!['yes','permissive'].includes(b.station.access),!b||b.hours.state!=='open'].filter(Boolean).length;
  return [b?.qualifiesForMode?0:1,evidenceRisk(stop.availability)+evidenceRisk(b?.availability),uncertain,-Math.min(mainBattery,backupBattery),stop.rankPoints];
}
export function preferStops(stops:RankedStop[],input:SmartStopInput,now:number):{ranked:RankedStop[];summary:PreferenceSummary}{
  const mode=input.preference||'balanced';
  const choices=stops.map(stop=>({stop,budget:stopBudget(stop,input,now),checks:safeguards(stop,input)}));
  const summary:PreferenceSummary={mode,evaluated:stops.length,comparable:0,missingPrice:choices.filter(c=>c.budget.price.rate===null).length,missingEnergy:choices.filter(c=>c.budget.energyKwh===null).length,missingTime:choices.filter(c=>c.budget.driveChargeMinutes===null).length,needsMoreStops:choices.filter(c=>!c.budget.reachesDestination).length,explanation:''};
  const eligible=choices.filter(c=>mode==='cheapest'?c.budget.reachesDestination&&c.budget.energyCost!==null:mode==='fastest'?c.budget.reachesDestination&&c.budget.driveChargeMinutes!==null:true);
  eligible.sort((a,b)=>{
    if(mode==='fastest'){const delta=a.budget.driveChargeMinutes!-b.budget.driveChargeMinutes!;if(delta)return delta;}
    if(mode==='cheapest'){const delta=a.budget.energyCost!-b.budget.energyCost!;if(Math.abs(delta)>1e-8)return delta;}
    if(mode==='safest'){for(let i=0;i<a.checks.length;i++){const delta=a.checks[i]-b.checks[i];if(delta)return delta;}}
    return a.stop.rankPoints-b.stop.rankPoints||a.stop.station.id.localeCompare(b.stop.station.id);
  });
  summary.comparable=eligible.length;
  summary.explanation=mode==='balanced'?'Balanced ranks next stops by extra driving, charging speed and explicit uncertainty adjustments.':mode==='safest'?'Safest first requires the strongest backup support, then prioritizes observations, known access/hours and battery buffer. It does not certify physical safety.':mode==='fastest'?`Fastest compares estimated driving plus charging time for ${eligible.length} supported one-stop options. Charging uses your capacity, power limit and a 25% time allowance. Waits, traffic and later charging stops are not predicted.`:`Cheapest compares charging energy costs for ${eligible.length} priced one-stop options. A lower per-kWh rate alone does not determine the cheapest plan. Unpriced options, fees and starting battery energy are excluded.`;
  return {ranked:eligible.map(c=>c.stop),summary};
}

export function preferenceReason(stop:RankedStop,input:SmartStopInput,now:number):string{
  const budget=stopBudget(stop,input,now);
  if(input.preference==='fastest'&&budget.driveChargeMinutes!==null)return `Fastest estimate: ${(budget.driveChargeMinutes/60).toFixed(2)} hours driving plus charging, including ${budget.chargeMinutes} charging minutes. Waiting and traffic are not included.`;
  if(input.preference==='cheapest'&&budget.energyCost!==null)return `Cheapest among the compared priced one-stop options: about $${budget.energyCost.toFixed(2)} for ${budget.energyKwh!.toFixed(1)} kWh of planned charging energy. Rate confidence: ${budget.price.label}.`;
  if(input.preference==='safest')return 'Safest preference prioritizes backup support, current observations, listed access/hours and remaining battery before detour or speed.';
  return 'Balanced preference weighs extra driving, charging speed and uncertainty for this next stop.';
}
