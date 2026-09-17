"use client";
import {useEffect,useRef,useState} from 'react';
import {Button} from '@/components/ui/button';
import {Switch} from '@/components/ui/switch';
import {positionFresh,recoveryInput,watchDue} from '@/lib/trip-watch';
import {isSmartStopExpired} from '@/lib/smart-stop-validity';
import {evidenceTime} from '@/lib/station-evidence';
import type {SmartStopInput,SmartStopResult} from '@/lib/smart-stop';

export function TripRecovery({plan}:{plan:SmartStopResult}){
 const [lat,setLat]=useState(''),[lon,setLon]=useState(''),[battery,setBattery]=useState('');
 const [failed,setFailed]=useState(false),[watch,setWatch]=useState(false),[busy,setBusy]=useState(false),[error,setError]=useState('');
 const [snapshot,setSnapshot]=useState<{input:SmartStopInput;at:number}|null>(null),[result,setResult]=useState<SmartStopResult|null>(null),[now,setNow]=useState(Date.now());
 const request=useRef<AbortController|null>(null),lastStarted=useRef(0),locating=useRef(0);
 const input=recoveryInput(plan.input,lat,lon,battery,failed?plan.selected?.station.id??null:null);
 function invalidate(){request.current?.abort();request.current=null;locating.current++;setSnapshot(null);setResult(null);setBusy(false);setWatch(false);setError('');}
 async function check(s:{input:SmartStopInput;at:number}){
  if(!positionFresh(s.at,Date.now())){setWatch(false);return;}
  request.current?.abort();const controller=new AbortController();request.current=controller;lastStarted.current=Date.now();setBusy(true);setResult(null);setError('');
  const timeout=setTimeout(()=>controller.abort(),90000);
  try{
   const response=await fetch('/api/smart-stop',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(s.input),signal:controller.signal});
   const data=await response.json() as SmartStopResult&{error?:string};if(!response.ok)throw new Error(data.error||'Trip check unavailable.');
   if(controller.signal.aborted||!positionFresh(s.at,Date.now()))return;
   setResult(data);
  }catch(e){if(request.current===controller){setError(controller.signal.aborted?'Check stopped or timed out. Confirm your position and retry.':(e as Error).message);setWatch(false);}}
  finally{clearTimeout(timeout);if(request.current===controller){setBusy(false);setNow(Date.now());}}
 }
 useEffect(()=>{const timer=setInterval(()=>setNow(Date.now()),1000);return()=>{clearInterval(timer);request.current?.abort();locating.current++;};},[]);
 useEffect(()=>{
  if(!watch||!snapshot)return;
  if(!positionFresh(snapshot.at,now)){setWatch(false);request.current?.abort();return;}
  if(watchDue(now,snapshot.at,lastStarted.current,document.visibilityState==='visible',busy))void check(snapshot);
 },[now,watch,snapshot,busy]);
 const fresh=!!snapshot&&positionFresh(snapshot.at,now);
 const usable=!!result&&fresh&&!isSmartStopExpired(result,now)&&!busy;
 function locate(){
  invalidate();const id=++locating.current;
  if(!navigator.geolocation){setError('Location is unavailable. Enter coordinates instead.');return;}
  navigator.geolocation.getCurrentPosition(p=>{if(id!==locating.current)return;setLat(p.coords.latitude.toFixed(6));setLon(p.coords.longitude.toFixed(6));setError(`Location accuracy approximately ${Math.round(p.coords.accuracy)} meters. Confirm your position before checking.`);},()=>{if(id===locating.current)setError('Location could not be read. Enter coordinates instead.');},{enableHighAccuracy:true,timeout:15000,maximumAge:0});
 }
 const stop=result?.selected;
 return <section className="trip-recovery" aria-label="Trip Rescue and Road Trip Watch">
 <h3>Trip Rescue</h3><p>Charger failed or battery dropped? Stop somewhere safe, then enter your current position and battery. Keep your existing reserve and backup requirements.</p>
 <Button type="button" variant="secondary" onClick={locate}>Use my current location</Button>
 <div className="session-fields"><label>Current latitude<input type="number" min="-90" max="90" step="any" value={lat} onChange={e=>{invalidate();setLat(e.target.value);}}/></label><label>Current longitude<input type="number" min="-180" max="180" step="any" value={lon} onChange={e=>{invalidate();setLon(e.target.value);}}/></label><label>Current battery (%)<input type="number" min="1" max="100" value={battery} onChange={e=>{invalidate();setBattery(e.target.value);}}/></label></div>
 {plan.selected&&<label className="session-confirm"><input type="checkbox" checked={failed} onChange={e=>{invalidate();setFailed(e.target.checked);}}/>Exclude {plan.selected.station.name}: this charger failed</label>}
 <p>Destination: {plan.input.destination.label}. Reserve: {plan.input.reserve}%. No-Stranding Mode: {plan.input.noStranding?'on':'off'}. Exclusions apply to main and backup stops for this check.</p>
 <Button type="button" disabled={!input||busy} onClick={()=>{if(!input)return;const s={input,at:Date.now()};setSnapshot(s);setNow(s.at);void check(s);}}>Confirm position & battery, find a stop</Button>
 <h3>Road Trip Watch</h3><label className="watch-toggle"><Switch aria-label="Road Trip Watch" checked={watch} disabled={!fresh||busy} onCheckedChange={setWatch}/>Recheck every two minutes while this page is visible</label>
 <p>Checks the next stop and backup using available directory data and your private reports. Directory records may be cached for up to one hour. No live port feed, vehicle telemetry, background tracking or push alerts are connected.</p>
 <p role="status">{busy?'Checking road routes, battery and charger evidence…':watch?'Watch is on. Refresh position and battery as you move.':snapshot&&!fresh?'Watch paused: position and battery are over five minutes old. Confirm updated values.':'Watch is off.'} Reloading ends Watch. Hidden pages pause automatic checks.</p>
 {error&&<p className="error-text" role="status">{error}</p>}
 {result&&<div className="recovery-result" aria-live="polite"><h4>{stop?(stop.station.id===plan.selected?.station.id?'Same stop still suggested':'Alternative stop found'):'No charging stop suggested'}</h4><p>{result.message}</p>
 {!usable&&<p className="error-text">This check has expired. Update position and battery before using a route.</p>}
 {stop&&<><strong>{stop.station.name}</strong><p>{stop.legs.toMiles.toFixed(1)} road miles · estimated arrival {stop.arrivalBattery.toFixed(1)}% · {stop.availability.label}</p><p>Backup: {stop.backup?`${stop.backup.station.name}, estimated arrival ${stop.backup.arrivalBattery.toFixed(1)}% after a failed main stop`:'No checked backup'}</p><p>A working, free port is not guaranteed. Confirm connector, network access and opening hours with the operator.</p>{usable&&<a href={`https://www.google.com/maps/dir/?api=1&origin=${result.input.origin.lat},${result.input.origin.lon}&destination=${stop.station.lat},${stop.station.lon}&travelmode=driving`} target="_blank" rel="noreferrer">Review directions to this stop ↗</a>}</>}
 {!stop&&result.state!=='no-charge-needed'&&<p>No reachable option was confirmed. Contact your vehicle or insurance roadside-assistance service if you cannot continue. This app does not dispatch help.</p>}
 <p>Checked {evidenceTime(result.calculatedAt)}. Directory retrieved {result.directoryFetchedAt?evidenceTime(result.directoryFetchedAt):'not used'}. This result does not change your original map route.</p></div>}
 </section>;
}
