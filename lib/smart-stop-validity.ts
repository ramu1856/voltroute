import type { SmartStopResult } from './smart-stop.ts';
import { evaluateAvailability, evaluatePrice } from './station-evidence.ts';
import { evaluateStationHours } from './opening-hours.ts';

// Departure is still "now". An old arrival-hours check must not keep a route
// actionable as time passes, even before the ten-minute suggestion expires.
export function isSmartStopExpired(result:SmartStopResult,now:number):boolean{
  if(!Number.isFinite(now)||!Number.isFinite(Date.parse(result.validUntil))||now>=Date.parse(result.validUntil))return true;
  const main=result.selected;if(!main)return false;
  if(result.input.preference==='cheapest'&&result.selectedPrice){
    const price=evaluatePrice(main.station,result.input.enteredRates?.[main.station.id],now+(main.legs.toMinutes+(main.chargeMinutes??0))*60_000);
    if(price.rate!==result.selectedPrice.rate||price.confidence!==result.selectedPrice.confidence||price.source!==result.selectedPrice.source)return true;
  }
  const current=evaluateAvailability(main.station,main.personalReport||undefined,now);
  if(current.freshness!==main.availability.freshness||current.condition!==main.availability.condition)return true;
  const hours=evaluateStationHours(main.station,new Date(now+main.legs.toMinutes*60_000));
  if(hours.state==='closed'||hours.state==='unavailable')return true;
  const backup=main.backup;
  if(!backup)return result.input.noStranding;
  const backupEvidence=evaluateAvailability(backup.station,backup.personalReport||undefined,now);
  if(backupEvidence.freshness!==backup.availability.freshness||backupEvidence.condition!==backup.availability.condition)return true;
  const backupHours=evaluateStationHours(backup.station,new Date(now+(main.legs.toMinutes+backup.connection.minutes+result.input.failureDelayMinutes)*60_000));
  if(backupHours.state==='closed'||backupHours.state==='unavailable')return true;
  return result.input.noStranding&&(!backup.qualifiesForMode||backupHours.state!=='open'||!backup.route);
}
