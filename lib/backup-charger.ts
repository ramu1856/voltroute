import { miles, type RoadRoute, type Station } from './ev.ts';
import { evaluateAvailability, type AvailabilityInfo, type PersonalReport } from './station-evidence.ts';
import { evaluateStationHours, type HoursInfo } from './opening-hours.ts';
import type { RankedStop, SmartStopInput } from './smart-stop.ts';

export type RoadConnection={miles:number;minutes:number;fromSnapMeters:number;toSnapMeters:number};
export type BackupOption={
  station:Station;connection:RoadConnection;route:RoadRoute|null;
  arrivalBattery:number;arrivalAt:string;totalDriveMiles:number;totalDriveMinutes:number;
  failureAllowance:number;failureDelayMinutes:number;qualifiesForMode:boolean;
  availability:AvailabilityInfo;personalReport:PersonalReport|null;hours:HoursInfo;
  sameNetwork:boolean;warnings:string[];
};
export type BackupRejection='same-site'|'connector'|'unavailable'|'access'|'road'|'reserve'|'hours';

export function distinctChargingSites(main:Station,backup:Station):boolean{
  if(main.id===backup.id||miles(main,backup)<0.25)return false;
  const address=(value:string)=>value.toLowerCase().replace(/[^a-z0-9]/g,'');
  // Be conservative about duplicate pins and a second charger in the same lot.
  return !main.address||!backup.address||address(main.address)!==address(backup.address);
}

export function evaluateBackup(main:RankedStop,station:Station,connection:RoadConnection|null,input:SmartStopInput,report:PersonalReport|undefined,now:number):BackupOption|BackupRejection{
  if(!distinctChargingSites(main.station,station))return 'same-site';
  if(!station.connectors.includes(input.profile.connector))return 'connector';
  if(['planned','temporarily unavailable'].includes(station.status))return 'unavailable';
  const availability=evaluateAvailability(station,report,now);
  if(['unavailable','busy'].includes(availability.condition))return 'unavailable';
  if(['no','private','permit','delivery'].includes(station.access))return 'access';
  if(!connection||!Object.values(connection).every(n=>Number.isFinite(n)&&n>=0)||connection.fromSnapMeters>150||connection.toSnapMeters>150||connection.miles+0.2<miles(main.station,station))return 'road';
  const totalDriveMiles=main.legs.toMiles+connection.miles;
  // No energy from the main stop is included. The failure allowance is deducted
  // in addition to both driving legs, while the chosen arrival reserve remains.
  const arrivalBattery=input.battery-totalDriveMiles/input.profile.range*100-input.failureAllowance;
  if(arrivalBattery+1e-8<input.reserve)return 'reserve';
  const totalDriveMinutes=main.legs.toMinutes+connection.minutes;
  const arrivalAt=new Date(now+(totalDriveMinutes+input.failureDelayMinutes)*60_000).toISOString();
  const hours=evaluateStationHours(station,new Date(arrivalAt));
  if(hours.state==='closed'||hours.state==='unavailable')return 'hours';
  const qualifiesForMode=['yes','permissive'].includes(station.access)&&hours.state==='open';
  const knownNetwork=(value:string)=>value.trim()!==''&&value!=='Network not listed';
  const sameNetwork=knownNetwork(main.station.network)&&knownNetwork(station.network)&&main.station.network.trim().toLowerCase()===station.network.trim().toLowerCase();
  const warnings=[
    'Road reachability is an estimate, not a guarantee of a working charger. Confirm adapter, network access and the entrance.',
    'Check your actual remaining battery before diverting. The failure allowance does not model all weather, traffic or waiting losses.',
  ];
  if(availability.freshness!=='live'||availability.condition!=='available')warnings.unshift('A working, free port at the backup is not confirmed.');
  if(hours.state==='unknown')warnings.push('Backup opening hours at arrival are unconfirmed. This backup does not qualify for No-Stranding Mode.');
  if(!['yes','permissive'].includes(station.access))warnings.push('Public access at the backup is not listed. This backup does not qualify for No-Stranding Mode.');
  if(sameNetwork)warnings.push('The main and backup use the same listed network. A network-wide problem could affect both.');
  return {station,connection,route:null,arrivalBattery,arrivalAt,totalDriveMiles,totalDriveMinutes,failureAllowance:input.failureAllowance,failureDelayMinutes:input.failureDelayMinutes,qualifiesForMode,availability,personalReport:report||null,hours,sameNetwork,warnings};
}

export function backupOptions(main:RankedStop,stations:Station[],connections:(RoadConnection|null)[][],input:SmartStopInput,reports:Record<string,PersonalReport>,now:number):BackupOption[]{
  const index=stations.findIndex(station=>station.id===main.station.id);
  if(index<0)return [];
  const options:BackupOption[]=[];
  for(let j=0;j<stations.length;j++){
    const evaluated=evaluateBackup(main,stations[j],connections[index]?.[j]??null,input,reports[stations[j].id],now);
    if(typeof evaluated!=='string'&&(!input.noStranding||evaluated.qualifiesForMode))options.push(evaluated);
  }
  const preference=(backup:BackupOption)=>backup.connection.minutes+(backup.qualifiesForMode?0:30)+(backup.sameNetwork?5:0)+(backup.availability.freshness==='unknown'?10:0);
  return options.sort((a,b)=>preference(a)-preference(b)||a.station.id.localeCompare(b.station.id));
}

export function assignBackups(ranked:RankedStop[],stations:Station[],connections:(RoadConnection|null)[][],input:SmartStopInput,reports:Record<string,PersonalReport>,now:number){
  let excluded=0;const candidates:RankedStop[]=[];
  for(const main of ranked){
    const backup=backupOptions(main,stations,connections,input,reports,now)[0]||null;
    if(input.noStranding&&!backup){excluded++;continue;}
    candidates.push({...main,backup});
  }
  return {candidates,excluded};
}

export function attachBackup(main:RankedStop,backup:BackupOption|null,input:SmartStopInput):RankedStop{
  if(input.noStranding&&(!backup?.qualifiesForMode||!backup.route))throw new Error('No-Stranding Mode requires a qualifying backup with a confirmed road route.');
  return {...main,backup,reasons:[...main.reasons,...(backup?[
    `Separate backup site: ${backup.station.name}, ${backup.connection.miles.toFixed(1)} road miles after the main stop. Estimated arrival ${backup.arrivalBattery.toFixed(1)}% after no charge at the main stop and a ${input.failureAllowance}% failure allowance.`,
    ...(input.noStranding?['No-Stranding Mode required a reachable backup with listed public access and opening hours covering arrival.']:[]),
  ]:[])],warnings:[...main.warnings,...(!backup?['No reachable backup was confirmed. No-Stranding Mode is off.']:[]),...(backup?['Backup reachability is based on the entered range and allowance. Neither charger operation nor a free port is guaranteed.']:[])]};
}
