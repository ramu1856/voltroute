"use client";
import { useEffect, useRef, useState } from 'react';
import { AlertTriangle, ArrowRight, BatteryCharging, Clock3, Navigation, Route, ShieldCheck, Zap } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Switch } from '@/components/ui/switch';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { smartStopSchema, type SmartStopResult } from '@/lib/smart-stop';
import { evaluateAvailability, evidenceTime } from '@/lib/station-evidence';
import { evaluateStationHours } from '@/lib/opening-hours';
import { isSmartStopExpired } from '@/lib/smart-stop-validity';
import { routePreferences, type RoutePreference } from '@/lib/route-preferences';
import { projectStopEnergy } from '@/lib/trip-budget';
import type { Point, Profile } from '@/lib/ev';
import { predictWaitForecast, waitWindowLabel } from '@/lib/wait-forecast';
import { TripRecovery } from './trip-recovery';
import { RouteComparison } from './route-comparison';

type Props={origin:Point;destination:Point;profile:Profile;battery:number;now:number|null;reportsVersion:string;enteredRates:Record<string,string>;accessToken?:string;onResult:(result:SmartStopResult)=>void;onClear:()=>void;onView:(result:SmartStopResult,stop:'main'|'backup')=>void};
const exclusionLabels:Record<string,string>={connector:'Connector does not match',unavailable:'Reported unavailable',access:'Restricted access',road:'Road connection unconfirmed',reserve:'Below battery reserve',detour:'Over extra-driving limit',hours:'Closed at arrival or during estimated session','no-charge':'No useful charge at this stop',backup:'No backup meets No-Stranding requirements'};

export function SmartStopPlanner({origin,destination,profile,battery,now,reportsVersion,enteredRates,accessToken,onResult,onClear,onView}:Props){
  const [reserve,setReserve]=useState('15'),[detour,setDetour]=useState('20'),[capacity,setCapacity]=useState(''),[maxKW,setMaxKW]=useState('');
  const [noStranding,setNoStranding]=useState(true),[failureAllowance,setFailureAllowance]=useState('3'),[failureDelay,setFailureDelay]=useState('10');
  const [preference,setPreference]=useState<RoutePreference>('balanced');
  const [result,setResult]=useState<SmartStopResult|null>(null),[busy,setBusy]=useState(false),[error,setError]=useState('');
  const request=useRef<AbortController|null>(null),clear=useRef(onClear);
  useEffect(()=>{clear.current=onClear;},[onClear]);
  useEffect(()=>{let cancelled=false;queueMicrotask(()=>{if(!cancelled){setCapacity('');setMaxKW('');}});return()=>{cancelled=true;};},[profile.name,profile.connector]);
  const input={origin,destination,profile,battery,reserve:Number(reserve),maxDetourMinutes:Number(detour),batteryCapacity:capacity.trim()===''?null:Number(capacity),vehicleMaxKW:maxKW.trim()===''?null:Number(maxKW),noStranding,failureAllowance:Number(failureAllowance),failureDelayMinutes:failureDelay.trim()===''?NaN:Number(failureDelay),preference,enteredRates:Object.fromEntries(Object.entries(enteredRates).filter(([,rate])=>rate.trim()!=='').sort(([a],[b])=>a.localeCompare(b)))};
  const inputKey=JSON.stringify(input),valid=smartStopSchema.safeParse(input).success;
  useEffect(()=>{request.current?.abort();let cancelled=false;queueMicrotask(()=>{if(!cancelled){setResult(null);setBusy(false);setError('');clear.current();}});return()=>{cancelled=true;};},[inputKey,reportsVersion]);
  useEffect(()=>()=>request.current?.abort(),[]);
  async function calculate(){
    if(!valid)return;
    request.current?.abort();const controller=new AbortController();request.current=controller;
    setBusy(true);setResult(null);setError('');onClear();
    try{
      const response=await fetch('/api/smart-stop',{method:'POST',headers:{'Content-Type':'application/json',...(accessToken?{Authorization:`Bearer ${accessToken}`}:{})},body:JSON.stringify(input),signal:controller.signal});
      const data=await response.json() as SmartStopResult&{error?:string};
      if(!response.ok)throw new Error(data.error||'Could not compare charging stops. Please try again.');
      if(controller.signal.aborted)return;
      setResult(data);onResult(data);
    }catch(error){if(!controller.signal.aborted)setError((error as Error).message);}
    finally{if(!controller.signal.aborted)setBusy(false);}
  }
  const currentTime=now??0;
  const selected=result?.selected;
  const backup=selected?.backup;
  const currentAvailability=selected?evaluateAvailability(selected.station,selected.personalReport||undefined,currentTime):null;
  const backupAvailability=backup?evaluateAvailability(backup.station,backup.personalReport||undefined,currentTime):null;
  const mainWait=currentAvailability?predictWaitForecast(currentAvailability):null;
  const backupWait=backupAvailability?predictWaitForecast(backupAvailability):null;
  const backupHours=backup?evaluateStationHours(backup.station,new Date(currentTime+(backup.totalDriveMinutes+backup.failureDelayMinutes)*60_000)):null;
  const expired=!!result&&isSmartStopExpired(result,currentTime);
  useEffect(()=>{if(expired)clear.current();},[expired]);
  return <section className="smart-planner" aria-label="Smart Stop planner">
    <div className="smart-title"><span><Zap size={19}/></span><div><h2>Smart Stop</h2><p>Find your next charging stop. Departing now.</p></div></div>
    <label className="preference-label">Route preference<Select value={preference} onValueChange={(value:RoutePreference)=>setPreference(value)}><SelectTrigger><SelectValue/></SelectTrigger><SelectContent>{Object.entries(routePreferences).map(([value,option])=><SelectItem key={value} value={value}>{option.label}</SelectItem>)}</SelectContent></Select></label>
    <p className="smart-note">{routePreferences[preference].description}</p>
    {(preference==='cheapest'||preference==='fastest')&&<p className="preference-hint">{preference==='cheapest'?'Add usable battery capacity below. Only supported station prices or rates you enter in charger details can be compared.':'Add usable battery capacity and the vehicle charging limit below. Unknown charging times cannot be compared.'} These modes need a trip that one planned charge can cover.</p>}
    <div className="smart-inputs"><label>Arrival reserve (%)<input type="number" min="10" max="30" value={reserve} onChange={e=>setReserve(e.target.value)}/></label><label>Extra driving limit (min)<input type="number" min="5" max="60" value={detour} onChange={e=>setDetour(e.target.value)}/></label></div>
    <div className="backup-settings"><div className="backup-toggle"><label htmlFor="no-stranding"><ShieldCheck size={18}/>No-Stranding Mode</label><Switch id="no-stranding" checked={noStranding} onCheckedChange={setNoStranding}/></div><p className="smart-note">{noStranding?'Require a separate backup reachable without charging at the main stop, with listed public access and hours covering arrival.':'Off: a main stop may be suggested without a confirmed backup.'} This is a planning check; charger operation is not guaranteed.</p><details><summary>Plan for a failed charging attempt</summary><div className="smart-inputs"><label>Extra battery allowance (%)<input type="number" min="1" max="10" step="0.5" value={failureAllowance} onChange={e=>setFailureAllowance(e.target.value)}/></label><label>Time lost at main (min)<input type="number" min="0" max="60" value={failureDelay} onChange={e=>setFailureDelay(e.target.value)}/></label></div><p>Deduct {failureAllowance||'—'} percentage points in addition to driving energy, while keeping your {reserve||'—'}% reserve at the backup. Add {failureDelay||'—'} minutes before checking its arrival hours. Adjust these assumptions for your trip.</p></details></div>
    <details className="smart-vehicle-details" open={preference==='cheapest'||preference==='fastest'}><summary>Vehicle charging inputs</summary><p>Capacity is needed for trip energy cost. Capacity and your vehicle power limit are needed for charging time. Leave unknown values blank.</p><label>Usable battery capacity (kWh)<input type="number" min="10" max="250" step="0.1" value={capacity} placeholder="Unknown" onChange={e=>setCapacity(e.target.value)}/></label><label>Vehicle charging limit (kW)<input type="number" min="1" max="500" step="0.1" value={maxKW} placeholder="Unknown" onChange={e=>setMaxKW(e.target.value)}/></label></details>
    {!valid&&<p className="error-text">Use a 10–30% reserve, 5–60 minute detour limit, 1–10% failure allowance, 0–60 minute delay and valid vehicle inputs.</p>}
    <Button type="button" className="full smart-submit" disabled={busy||!valid} onClick={calculate}><Route/>{busy?'Checking route & charging stops…':result?'Recalculate Smart Stop':'Find my next charging stop'}</Button>
    {busy&&<p className="smart-note" role="status">Checking main and backup road routes, battery reserve, access and arrival hours. This can take a little while.</p>}
    {error&&<p className="error-text" role="alert">{error}</p>}
    {result&&<div className="smart-result" aria-live="polite">
      {expired&&<p className="smart-warning"><AlertTriangle size={17}/>This suggestion or its supporting evidence has expired. Recalculate before using it.</p>}
      {result.preferenceSummary&&<details className="preference-result"><summary>{routePreferences[result.preferenceSummary.mode].label} · {result.preferenceSummary.comparable} comparable options</summary><p>{result.preferenceSummary.explanation}</p>{['fastest','cheapest'].includes(result.preferenceSummary.mode)&&<p>Among {result.preferenceSummary.evaluated} eligible main stops: {result.preferenceSummary.missingEnergy} lack energy inputs, {result.preferenceSummary.missingPrice} lack a price, {result.preferenceSummary.missingTime} lack a charge-time estimate, and {result.preferenceSummary.needsMoreStops} need further charging. These groups can overlap.</p>}</details>}
      {selected?<>
        <p className="eyebrow">{result.userSelectedRoute?'Your selected charging stop':'Suggested next stop'}</p><h3>{selected.station.name}</h3><p className="smart-network">{selected.station.network} · {selected.station.connectors.join(' / ')}</p>
        <p className="smart-note">{selected.station.address||`${selected.station.lat.toFixed(4)}, ${selected.station.lon.toFixed(4)}`}</p>
        <span className={`evidence-badge evidence-${currentAvailability!.freshness}`}>{currentAvailability!.label}</span>
        <div className="smart-metrics">
          <div><BatteryCharging size={18}/><strong>~{selected.arrivalBattery.toFixed(1)}%</strong><span>Arrival battery</span></div>
          <div><Route size={18}/><strong>{selected.legs.toMiles.toFixed(1)} mi</strong><span>Road to charger</span></div>
          <div><Clock3 size={18}/><strong>+{selected.detourMinutes.toFixed(1)} min</strong><span>Extra driving</span></div>
          <div><Zap size={18}/><strong>{selected.listedKW!==null?`${selected.listedKW} kW`:'Not supplied'}</strong><span>Your connector</span></div>
        </div>
        <p className="smart-session">Target: ~{selected.targetBattery.toFixed(0)}% battery{selected.chargeMinutes!==null?` · roughly ${selected.chargeMinutes} min charging`:'. Charge time unavailable.'}</p>
        {selected.chargeMinutes!==null&&<p className="smart-note">Uses your entered capacity and power limit, listed connector power and a 25% time allowance. Actual charging speed and tapering vary.</p>}
        {mainWait&&<p className="smart-note">{mainWait.minMinutes===null?'Wait prediction unavailable.':`Estimated queue window ${waitWindowLabel(mainWait)} (${mainWait.confidence} confidence).`} {mainWait.detail}</p>}
        <p className="smart-warning"><AlertTriangle size={17}/>{selected.availability.freshness==='live'&&selected.availability.condition==='available'?'Port availability can change before arrival.':'A working, free port is not confirmed. Check the operator before driving.'}</p>
        <div className="smart-actions"><Button type="button" variant="secondary" className="full" disabled={expired} onClick={()=>onView(result,'main')}><ArrowRight/>View charger & nearby places</Button>{!expired&&<a href={`https://www.google.com/maps/dir/?api=1&origin=${origin.lat},${origin.lon}&destination=${selected.station.lat},${selected.station.lon}&travelmode=driving`} target="_blank" rel="noreferrer"><Navigation size={17}/>Open directions to charger ↗</a>}</div>
        <section className="backup-card" aria-label="Backup charging stop"><p className="eyebrow">If the main charger fails</p>{backup?<>
          <h4>{backup.station.name}</h4><p className="smart-network">{backup.station.network} · {backup.station.connectors.join(' / ')}</p>
          <p className="smart-note">{backup.station.address||`${backup.station.lat.toFixed(4)}, ${backup.station.lon.toFixed(4)}`}</p>
          <span className={`evidence-badge evidence-${backupAvailability!.freshness}`}>{backupAvailability!.label}</span>
          <p className="smart-note">{backupAvailability?.freshness==='live'&&backupAvailability.condition==='available'?'A free port is reported now; availability can change before arrival.':'A working, free port at the backup is not confirmed.'}</p>
          {backupWait&&<p className="smart-note">{backupWait.minMinutes===null?'Backup wait prediction unavailable.':`Estimated backup queue window ${waitWindowLabel(backupWait)} (${backupWait.confidence} confidence).`} {backupWait.detail}</p>}
          <div className="smart-metrics"><div><BatteryCharging size={18}/><strong>~{backup.arrivalBattery.toFixed(1)}%</strong><span>Battery at backup</span></div><div><Route size={18}/><strong>{backup.connection.miles.toFixed(1)} mi</strong><span>From main · {backup.connection.minutes.toFixed(0)} min</span></div></div>
          <p className="smart-session">Assumes no charge at the main stop and deducts a {backup.failureAllowance}% battery allowance. Your {result.input.reserve}% arrival reserve is retained.</p>
          <dl className="backup-facts"><div><dt>Hours at estimated arrival</dt><dd>{backupHours?.state==='open'?'Listed schedule covers arrival':backupHours?.state==='closed'?'Closed — recalculate':'Unconfirmed'}</dd></div><div><dt>Listed opening hours</dt><dd>{backup.station.hours}</dd></div><div><dt>Public access</dt><dd>{['yes','permissive'].includes(backup.station.access)?'Listed as public':`Unconfirmed (${backup.station.access})`}</dd></div></dl>
          <p className="smart-note">{expired?'Recalculate the backup before using this suggestion.':backup.qualifiesForMode?'Meets the backup road, battery, access and hours checks.':'Provisional backup. Access or hours do not meet No-Stranding Mode requirements.'}</p>
          <div className="smart-actions"><Button type="button" variant="secondary" className="full" disabled={expired} onClick={()=>onView(result,'backup')}><ArrowRight/>View backup & nearby places</Button>{!expired&&<a href={`https://www.google.com/maps/dir/?api=1&origin=${selected.station.lat},${selected.station.lon}&destination=${backup.station.lat},${backup.station.lon}&travelmode=driving`} target="_blank" rel="noreferrer"><Navigation size={17}/>Directions from main to backup ↗</a>}</div>
          <details className="smart-assumptions"><summary>Backup evidence & limits</summary><ul>{backup.warnings.map(warning=><li key={warning}>{warning}</li>)}</ul><p>Arrival hours include {backup.failureDelayMinutes} minutes for the failed attempt. {backup.hours.timeZone&&`Station time zone: ${backup.hours.timeZone}${backup.hours.timeZoneEstimated?' (estimated)':''}.`}</p><a href={backup.station.sourceUrl} target="_blank" rel="noreferrer">View backup source ↗</a></details>
        </>:<p className="smart-warning"><AlertTriangle size={17}/>No reachable backup confirmed. No-Stranding Mode is off; this stop has no checked fallback.</p>}</section>
        <section className="why-stop"><h4>Why this charger?</h4><ul>{selected.reasons.map(reason=><li key={reason}>{reason}</li>)}</ul><details><summary>How the choice was compared</summary><p>Lower combined planning points are preferred. These are ranking adjustments, not a safety or reliability score.</p><dl>{selected.adjustments.map(item=><div key={item.label}><dt>{item.label}</dt><dd>+{item.points.toFixed(1)}</dd></div>)}</dl><p>Extra driving, early charging, speed, availability evidence, hours and access contribute to the result. Price is shown in the charger details and is not used to claim the cheapest route.</p></details></section>
        <details className="smart-assumptions"><summary>Before using this stop</summary><ul>{selected.warnings.map(warning=><li key={warning}>{warning}</li>)}</ul></details>
        <p className="smart-note">{projectStopEnergy(selected,result.input).reachesDestination?'One planned charge can cover the remaining route if its target is reached. The backup is a separate failure scenario.':'Next stop only. Further charging stops and the trip after the backup have not been planned.'}</p>
      </>:<div className={`smart-outcome ${result.state==='no-charge-needed'?'no-charge':'needs-review'}`}><strong>{result.state==='no-charge-needed'?'No charging stop needed under these assumptions':result.state==='reserve-too-low'?'Charge before driving':result.state==='no-backup-confirmed'?'No backup confirmed: suggestion withheld':result.state==='preference-unavailable'?'Comparison unavailable for this preference':'No suitable stop confirmed'}</strong><p>{result.message}</p>{result.state==='no-charge-needed'&&<p>Your entered range may change with weather, elevation, traffic and battery condition.</p>}</div>}
      {result.itinerary&&result.itinerary.status!=='unavailable'&&<details className="smart-coverage"><summary>Full trip itinerary (beta)</summary>
        <p>{result.itinerary.status==='complete'?`Planned ${result.itinerary.stops.length} charging stop${result.itinerary.stops.length===1?'':'s'} to cover this trip.`:`Partial chain with ${result.itinerary.stops.length} stop${result.itinerary.stops.length===1?'':'s'} identified.`}</p>
        <p>{result.itinerary.totalDriveMiles.toFixed(1)} road miles covered in the current chain. {result.itinerary.remainingMiles>0.01?`${result.itinerary.remainingMiles.toFixed(1)} miles still need additional validated stops.`:'Destination is covered in the current chain.'}</p>
        <ul>{result.itinerary.stops.map(stop=><li key={`${stop.order}:${stop.station.id}`}><strong>Stop {stop.order}: {stop.station.name}</strong><br/>{stop.legMiles.toFixed(1)} mi · arrival ~{stop.arrivalBattery.toFixed(1)}% · target {stop.targetBattery.toFixed(0)}%{stop.chargeMinutes!==null?` · ~${stop.chargeMinutes} min charge`:' · charge time unavailable'}{stop.waitForecast.minMinutes!==null?` · queue ${stop.waitForecast.minMinutes===stop.waitForecast.maxMinutes?`~${stop.waitForecast.minMinutes}`:`~${stop.waitForecast.minMinutes}-${stop.waitForecast.maxMinutes}`} min`:''}</li>)}</ul>
        <ul>{result.itinerary.notes.map(note=><li key={note}>{note}</li>)}</ul>
      </details>}
      <RouteComparison result={result} now={currentTime} onSelect={next=>{setResult(next);onResult(next);}}/>
      {result.roadCheckedCount>0&&<details className="smart-coverage"><summary>Search coverage & excluded stops</summary><p>{result.mappedCount} mapped stations returned; {result.roadCheckedCount} shortlisted for road-distance checks. The search covers approximately a 10-mile corridor along the reachable first part of the route, up to 400 records and 16 road comparisons. Coverage is incomplete.</p>{Object.entries(result.excluded).length>0&&<ul>{Object.entries(result.excluded).map(([reason,count])=><li key={reason}>{exclusionLabels[reason]||reason}: {count}</li>)}</ul>}</details>}
      <p className="smart-timestamp">Calculated {evidenceTime(result.calculatedAt)}{result.directoryFetchedAt&&<><br/>Directory retrieved {evidenceTime(result.directoryFetchedAt)}</>}</p>
    </div>}
    {result&&<TripRecovery key={JSON.stringify(result.input)+result.calculatedAt} plan={result}/>}
  </section>;
}
