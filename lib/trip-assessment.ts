import { miles, type RoadRoute, type Station } from './ev.ts';
import { arrivalBattery, smartStopSchema, type SmartStopResult } from './smart-stop.ts';
import { evaluateAvailability, type AvailabilityInfo } from './station-evidence.ts';
import { evaluateStationHours } from './opening-hours.ts';
import { isSmartStopExpired } from './smart-stop-validity.ts';
import { projectStopEnergy } from './trip-budget.ts';

export type RiskLevel='covered'|'review'|'gap'|'unassessed';
export const riskStyles:Record<RiskLevel,{label:string;color:string}>={
  covered:{label:'Checks covered',color:'#74db93'},
  review:{label:'Needs review',color:'#ffd166'},
  gap:{label:'Reserve shortfall',color:'#fb827d'},
  unassessed:{label:'Not assessed',color:'#9ca9b1'},
};
export type RiskSection={
  id:string;path:'main'|'backup';level:RiskLevel;title:string;reason:string;
  fromMile:number;toMile:number;distanceMiles:number;
  batteryFrom:number|null;batteryTo:number|null;coordinates:[number,number][];
  assumption:string|null;
};
export type ConfidenceFactor={key:string;label:string;earned:number;possible:number;applicable:boolean;reason:string};
export type TripAssessment={
  score:number|null;rawScore:number|null;label:string;summary:string;
  assessedMiles:number;totalMiles:number;unassessedMiles:number;coveragePercent:number;
  factors:ConfidenceFactor[];limits:{maximum:number;reason:string}[];issues:string[];sections:RiskSection[];
};

const clamp=(n:number,min=0,max=1)=>Math.max(min,Math.min(max,n));
const publicAccess=(station:Station)=>['yes','permissive'].includes(station.access);
const networkKnown=(station:Station)=>!!station.network.trim()&&station.network!=='Network not listed';

function measureRoad(road:RoadRoute):number[]|null{
  if(!Number.isFinite(road.miles)||road.miles<=0||!Number.isFinite(road.minutes)||road.minutes<0||road.coordinates.length<2)return null;
  if(road.coordinates.some(p=>p.length!==2||!p.every(Number.isFinite)||Math.abs(p[0])>180||Math.abs(p[1])>90))return null;
  const distances=[0];
  for(let i=1;i<road.coordinates.length;i++){
    const a=road.coordinates[i-1],b=road.coordinates[i];
    distances.push(distances[i-1]+miles({lon:a[0],lat:a[1]},{lon:b[0],lat:b[1]}));
  }
  const length=distances.at(-1)!;
  return length>0?distances.map(d=>d/length*road.miles):null;
}

// Retain every intervening road vertex. Only section boundaries are interpolated
// along the returned road geometry; no origin-to-charger straight line is drawn.
export function sliceRoadCoordinates(road:RoadRoute,from:number,to:number):[number,number][]{
  const distances=measureRoad(road);
  if(!distances||!Number.isFinite(from)||!Number.isFinite(to))return [];
  const start=clamp(from,0,road.miles),end=clamp(to,0,road.miles);
  if(end<=start)return [];
  const pointAt=(target:number):[number,number]=>{
    if(target<=0)return [...road.coordinates[0]];
    if(target>=road.miles)return [...road.coordinates.at(-1)!];
    const i=distances.findIndex(d=>d>=target),a=road.coordinates[i-1],b=road.coordinates[i];
    const fraction=(target-distances[i-1])/(distances[i]-distances[i-1]);
    const longitudeDelta=((b[0]-a[0]+540)%360)-180;
    return [((a[0]+longitudeDelta*fraction+540)%360)-180,a[1]+(b[1]-a[1])*fraction];
  };
  return [pointAt(start),...road.coordinates.filter((_,i)=>distances[i]>start&&distances[i]<end),pointAt(end)];
}

function evidenceCredit(info:AvailabilityInfo):number{
  if(info.freshness==='live'&&info.condition==='available')return 1;
  if(info.freshness==='recent'&&['working','available'].includes(info.condition))return .4;
  return 0;
}

export function assessTrip(result:SmartStopResult,now:number):TripAssessment{
  const empty:TripAssessment={score:null,rawScore:null,label:'Recalculate',summary:'A current road and battery assessment is needed.',assessedMiles:0,totalMiles:0,unassessedMiles:0,coveragePercent:0,factors:[],limits:[],issues:[],sections:[]};
  if(!smartStopSchema.safeParse(result.input).success||!measureRoad(result.route))return {...empty,label:'Score unavailable',summary:'There is no usable driving route to score. Choose different locations and recalculate.'};
  if(isSmartStopExpired(result,now))return {...empty,summary:'The plan or its supporting evidence is no longer current. Recalculate before using the score or map.'};
  const {input,selected:main}=result,road=result.route,backup=main?.backup;
  const noCharge=result.state==='no-charge-needed'&&!main&&arrivalBattery(input,road.miles)>=input.reserve;
  const hasStop=result.state==='suggested'&&!!main;
  if(main&&(!hasStop||!Object.values(main.legs).every(n=>Number.isFinite(n)&&n>=0)||Math.abs(main.legs.toMiles+main.legs.onwardMiles-road.miles)>.5))return empty;
  if(backup&&!Object.values(backup.connection).every(n=>Number.isFinite(n)&&n>=0))return empty;
  const mainArrival=hasStop?arrivalBattery(input,main!.legs.toMiles):arrivalBattery(input,road.miles);
  const energyPlan=hasStop?projectStopEnergy(main!,input):null;
  const oneStopComplete=!!energyPlan?.reachesDestination&&mainArrival+1e-8>=input.reserve;
  const backupArrival=backup?input.battery-(main!.legs.toMiles+backup.connection.miles)/input.profile.range*100-input.failureAllowance:null;
  const backupRoad=backup?.route&&measureRoad(backup.route)&&Math.abs(backup.route.miles-backup.connection.miles)<=.1?backup.route:null;
  const backed=!!backup&&!!backupRoad&&backup.qualifiesForMode&&backupArrival!==null&&backupArrival+1e-8>=input.reserve;
  const coveredMiles=noCharge||oneStopComplete?road.miles:hasStop&&mainArrival+1e-8>=input.reserve?clamp(main!.legs.toMiles,0,road.miles):0;
  const unassessedMiles=Math.max(0,road.miles-coveredMiles),coverage=coveredMiles/road.miles;
  const currentMain=hasStop?evaluateAvailability(main!.station,main!.personalReport||undefined,now):null;
  const currentBackup=backup?evaluateAvailability(backup.station,backup.personalReport||undefined,now):null;
  const mainHours=hasStop?evaluateStationHours(main!.station,new Date(now+main!.legs.toMinutes*60_000)):null;
  const backupHours=backup?evaluateStationHours(backup.station,new Date(now+(main!.legs.toMinutes+backup.connection.minutes+input.failureDelayMinutes)*60_000)):null;
  const mainAccess=hasStop&&publicAccess(main!.station),backupAccess=!!backup&&publicAccess(backup.station);
  const mainOpen=mainHours?.state==='open',backupOpen=backupHours?.state==='open';
  const margin=(noCharge?mainArrival:hasStop?Math.min(mainArrival,backupArrival??mainArrival,oneStopComplete?energyPlan!.destination:Infinity):-Infinity)-input.reserve;
  const batteryCredit=margin>=-1e-8?5+20*clamp(margin/10):0;
  const dataCredit=currentMain?(currentBackup?Math.min(evidenceCredit(currentMain),evidenceCredit(currentBackup)):evidenceCredit(currentMain)*.5):0;
  const accessCredit=(mainAccess?2.5:0)+(mainOpen?2.5:0)+(backupAccess?2.5:0)+(backupOpen?2.5:0);
  const differentNetwork=backed&&networkKnown(main!.station)&&networkKnown(backup!.station)&&!backup!.sameNetwork;
  const factors:ConfidenceFactor[]=[
    {key:'coverage',label:'Charging plan coverage',earned:40*coverage,possible:40,applicable:true,reason:noCharge?'The entered range covers the complete road route without charging.':oneStopComplete?`One planned charge to ${main!.targetBattery.toFixed(1)}% supports the road to the destination with ${energyPlan!.destination.toFixed(1)}% remaining. Successful charging is an explicit assumption.`:hasStop?`${coveredMiles.toFixed(1)} of ${road.miles.toFixed(1)} road miles assessed to the next stop. Later charging is not planned.`:'No charging stop has been confirmed for the route.'},
    {key:'battery',label:'Battery above your reserve',earned:batteryCredit,possible:25,applicable:true,reason:Number.isFinite(margin)?`${Math.max(0,margin).toFixed(1)} percentage points above your ${input.reserve}% reserve at the weakest checked arrival${margin<0?'; the reserve is not met':''}. 5 points for meeting reserve, plus up to 20 for a 10-point buffer.`:'No supported charging arrival to assess.'},
    {key:'evidence',label:'Current charger observations',earned:15*dataCredit,possible:15,applicable:!noCharge,reason:noCharge?'No charging stop is required under your range assumption.':`Main: ${currentMain?.label||'not selected'}. Backup: ${currentBackup?.label||'not confirmed'}. Use the weaker observation: live available earns 100%, recent available or working 40%, otherwise 0%. Without a backup, halve the main's credit. Arrival availability is not forecast.`},
    {key:'access',label:'Arrival hours and public access',earned:accessCredit,possible:10,applicable:!noCharge,reason:noCharge?'No charging access is needed.':'2.5 points each for listed public access and hours covering arrival at the main and backup stops. Missing information earns no points.'},
    {key:'backup',label:'Independent backup',earned:backed?(differentNetwork?10:5):0,possible:10,applicable:!noCharge,reason:noCharge?'A charging backup is not required.':backed?(differentNetwork?'Separate reachable site with a different listed network.':'Separate reachable site, but different network independence is not established.'):'No backup passes the road, reserve, hours and public-access checks.'},
  ];
  const applicable=factors.filter(f=>f.applicable);
  const rawScore=Math.round(applicable.reduce((sum,f)=>sum+f.earned,0)/applicable.reduce((sum,f)=>sum+f.possible,0)*100);
  const limits=[{maximum:85,reason:'Maximum 85: range is entered manually; weather, elevation, traffic and future port availability are not modeled.'}];
  if(unassessedMiles>.01)limits.push({maximum:59,reason:'Maximum 59: the complete charging itinerary has not been assessed.'});
  if(!noCharge&&!hasStop)limits.push({maximum:24,reason:'Maximum 24: charging is needed but no main stop is recommended.'});
  if(hasStop&&(!backed||margin<0))limits.push({maximum:39,reason:'Maximum 39: a qualifying backup or the arrival reserve is missing.'});
  const score=clamp(Math.min(rawScore,...limits.map(rule=>rule.maximum)),0,100);
  const issues:string[]=[];
  if(oneStopComplete)issues.push(`The final leg assumes successful charging to ${main!.targetBattery.toFixed(1)}% at the main stop. A failed charge still uses the separate backup scenario.`);
  if(hasStop&&unassessedMiles>.01)issues.push(`${unassessedMiles.toFixed(1)} miles after the next stop are not assessed. No further charging or battery gain is assumed on the map.`);
  if(!noCharge&&!hasStop)issues.push('Charging is required, but no stop passed the current planning requirements. Red sections show a reserve shortfall in this plan, not proof that chargers do not exist.');
  if(currentMain&&(currentMain.freshness!=='live'||currentMain.condition!=='available'))issues.push('A working, free port at the main stop is unconfirmed.');
  if(backup&&(currentBackup?.freshness!=='live'||currentBackup.condition!=='available'))issues.push('A working, free port at the backup is unconfirmed.');
  if(hasStop&&!backed)issues.push('No qualifying backup supports this main stop.');
  if(Number.isFinite(margin)&&margin<10)issues.push(`The weakest arrival has ${Math.max(0,margin).toFixed(1)} battery percentage points above reserve. A 10-point buffer is used for full scoring credit.`);

  const sections:RiskSection[]=[];
  const addSection=(path:'main'|'backup',route:RoadRoute,from:number,to:number,level:RiskLevel,title:string,reason:string,startBattery:number|null,batteryOriginMile=0,assumption:string|null=null)=>{
    if(to-from<.000001)return;
    const coordinates=sliceRoadCoordinates(route,from,to);if(coordinates.length<2)return;
    sections.push({id:`${path}-${sections.length}`,path,level,title,reason,fromMile:from,toMile:to,distanceMiles:to-from,batteryFrom:startBattery===null?null:clamp(startBattery-(from-batteryOriginMile)/input.profile.range*100,0,100),batteryTo:startBattery===null?null:clamp(startBattery-(to-batteryOriginMile)/input.profile.range*100,0,100),coordinates,assumption});
  };
  const addDriving=(path:'main'|'backup',route:RoadRoute,end:number,startBattery:number,checksCovered:boolean,uncertainty:string,offset=0,assumption:string|null=null)=>{
    const reserveAt=offset+input.profile.range*(startBattery-input.reserve)/100,bufferAt=reserveAt-input.profile.range*.1;
    const boundaries=[offset,...[bufferAt,reserveAt].filter(d=>d>offset&&d<end),end].sort((a,b)=>a-b);
    for(let i=1;i<boundaries.length;i++){
      const from=boundaries[i-1],to=boundaries[i],mid=(from+to)/2,remaining=startBattery-(mid-offset)/input.profile.range*100;
      let level:RiskLevel,title:string,reason:string;
      if(remaining<input.reserve){level='gap';title='Reserve shortfall';reason=`Battery falls below your ${input.reserve}% reserve on this part of the current plan. A charging stop is needed before this section.`;}
      else if(!checksCovered){level='review';title='Charging evidence needs review';reason=uncertainty+(remaining<input.reserve+10?' Battery also has less than 10 percentage points above reserve.':'');}
      else if(remaining<input.reserve+10){level='review';title='Battery buffer narrows';reason=`Estimated battery remains above your ${input.reserve}% reserve, with less than 10 extra percentage points of buffer.`;}
      else{level='covered';title='Current planning checks covered';reason=noCharge?'Your entered range covers this section with at least 10 battery percentage points above reserve. No charging stop is needed.':'Road, reserve, listed access, arrival hours and current main/backup observations support this section. Port availability may change before arrival.';}
      addSection(path,route,from,to,level,assumption?`After planned charge: ${title}`:title,reason,startBattery,offset,assumption);
    }
  };
  if(noCharge)addDriving('main',road,road.miles,input.battery,true,'');
  else if(hasStop){
    const currentPorts=currentMain?.freshness==='live'&&currentMain.condition==='available'&&currentBackup?.freshness==='live'&&currentBackup.condition==='available';
    const ready=backed&&mainAccess&&mainOpen&&backupOpen&&currentPorts;
    const explanation=[!currentPorts?'Working, free ports at both stops are not confirmed.':'',!mainAccess||!mainOpen?'Main-stop access or arrival hours need confirmation.':'',!backed?'A qualifying backup is missing.':''].filter(Boolean).join(' ');
    addDriving('main',road,clamp(main!.legs.toMiles,0,road.miles),input.battery,ready,explanation);
    if(oneStopComplete)addDriving('main',road,road.miles,main!.targetBattery,ready,explanation,main!.legs.toMiles,`Assumes successful charging to ${main!.targetBattery.toFixed(1)}% at ${main!.station.name}.`);
    else addSection('main',road,clamp(main!.legs.toMiles,0,road.miles),road.miles,'unassessed','After the next charging stop','The rest of the charging itinerary has not been planned. Battery is not projected past this stop.',null);
    if(backupRoad)addDriving('backup',backupRoad,backupRoad.miles,mainArrival-input.failureAllowance,backed&&backupOpen&&currentBackup?.freshness==='live'&&currentBackup.condition==='available','The backup road is checked, but current operation, public access or arrival hours still need confirmation.');
  }else addDriving('main',road,road.miles,input.battery,false,'No charging stop is recommended under the current requirements. Remaining battery here does not confirm a place to charge ahead.');
  return {score,rawScore,label:noCharge?(score>=75?'Covered by entered range':'Review battery buffer'):oneStopComplete?'Conditional one-stop plan':hasStop?'Partial charging plan':'Charging plan incomplete',summary:noCharge?'The road route fits your entered range and reserve. Actual conditions can change consumption.':oneStopComplete?'One planned charge can cover this road route if its target battery is reached. Operation and future port availability remain uncertain.':hasStop?'The score includes the unplanned remainder of your trip. A good first stop does not confirm the whole journey.':'Resolve the charging gap before relying on this route.',assessedMiles:coveredMiles,totalMiles:road.miles,unassessedMiles,coveragePercent:coverage*100,factors,limits,issues,sections};
}
