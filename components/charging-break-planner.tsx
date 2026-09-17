"use client";
import { useState } from 'react';
import type { Amenity, Station } from '@/lib/ev';
import type { SmartStopResult } from '@/lib/smart-stop';
import { isSmartStopExpired } from '@/lib/smart-stop-validity';
import { breakActivities, planBreak, type BreakActivity } from '@/lib/charging-break';

export function ChargingBreakPlanner({station,places,plan,now,loading,error,stale}:{station:Station;places:Amenity[];plan:SmartStopResult|null;now:number|null;loading:boolean;error:string;stale:boolean}){
 const [activity,setActivity]=useState<BreakActivity>('coffee'),[visit,setVisit]=useState('10'),[manual,setManual]=useState('');
 const current=plan?.selected?.station.id===station.id&&!isSmartStopExpired(plan,now??Date.now())?plan:null;
 const estimate=current?.selected?.chargeMinutes??null;
 const window=manual.trim()===''?estimate:Number(manual);
 const arrival=current&&now!==null?now+current.selected!.legs.toMinutes*60000:now??NaN;
 const valid=Number.isFinite(Number(visit))&&Number(visit)>=1&&Number(visit)<=180&&(window===null||(Number.isFinite(window)&&window>=1&&window<=240));
 const options=valid?planBreak(places,activity,Number(visit),window,arrival,stale):[];
 return <section className="break-planner" aria-label="Charging Break Planner"><p className="eyebrow">Make time for a break</p><h2>Charging Break Planner</h2>
  <p>{current?'Plan for your estimated arrival at this charger.':'Plan a break starting now at this charger.'} {estimate!==null?`Estimated charging window: ~${estimate} minutes.`:'Charging duration is unknown. Enter your own break window.'}</p>
  <div className="break-fields"><label>Activity<select value={activity} onChange={e=>{const a=e.target.value as BreakActivity;setActivity(a);setVisit(String(breakActivities[a].minutes));}}>{Object.entries(breakActivities).map(([key,a])=><option value={key} key={key}>{a.label}</option>)}</select></label><label>Your activity allowance (min)<input type="number" min="1" max="180" value={visit} onChange={e=>setVisit(e.target.value)}/></label><label>Your break window (min)<input type="number" min="1" max="240" placeholder={estimate!==null?`Use ~${estimate} min`:'Unknown'} value={manual} onChange={e=>setManual(e.target.value)}/></label></div>
  <p className="muted-small">Activity defaults are editable assumptions. Walking uses straight-line distance at 2.5 mph, plus a five-minute buffer. Paths, crossings, queues and actual walking times are unverified. Hours use listed schedules and estimated local time zones. Up to eight suggestions from the nearest 40 mapped places for this activity.</p>
  {estimate!==null&&window!==null&&window>estimate&&<p className="break-warning">Your break exceeds the estimated charging time. Check the operator’s idle-fee rules and return before charging finishes.</p>}
  {!valid&&<p className="error-text">Use a 1–180 minute activity allowance and a 1–240 minute break window.</p>}
  {loading?<p role="status">Loading nearby places…</p>:error?<p>Nearby places could not be loaded. Use the nearby-search Retry below.</p>:<>
   {valid&&!options.length&&<p>No {breakActivities[activity].label.toLowerCase()} places are mapped in this search. Coverage may be incomplete.</p>}
   {options.slice(0,8).map(o=><article className="break-option" key={o.place.id}><h3>{o.place.name}</h3><strong>{o.state==='possible'?'May fit your break':o.state==='closed'?'Listed as closed during visit':o.state==='too-short'?'Needs a longer break':'Check before visiting'}</strong><p>~{o.totalMinutes} min allowance: {o.walkingMinutes} walking + {visit} activity + 5 buffer.</p><p>{o.place.distance.toFixed(2)} mi straight-line · Hours {o.hours==='open'?'cover the planned visit':o.hours==='closed'?'do not cover the visit':'unconfirmed'} · Access: {o.place.access}</p><p>{o.reason}</p><div><a href={`https://www.google.com/maps/dir/?api=1&origin=${station.lat},${station.lon}&destination=${o.place.lat},${o.place.lon}&travelmode=walking`} target="_blank" rel="noreferrer">Check walking directions ↗</a><a href={o.place.sourceUrl} target="_blank" rel="noreferrer">Place source ↗</a></div></article>)}
  </>}
 </section>;
}
