"use client";
import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { queueAllowance,queueSchema } from '@/lib/charge-session';
export function ExpectedWait({now}:{now:number|null}){
 const [values,setValues]=useState({ahead:'',ports:'',busy:'',minutes:''});
 const [snapshot,setSnapshot]=useState<{input:unknown;at:number}|null>(null);
 const input=Object.fromEntries(Object.entries(values).map(([k,v])=>[k,v.trim()===''?NaN:Number(v)]));
 const valid=queueSchema.safeParse(input).success,result=snapshot?queueAllowance(snapshot.input,snapshot.at,Math.max(now??0,Date.now())):null;
 const fields=[['ahead','Vehicles ahead of you'],['ports','Usable matching ports'],['busy','Currently occupied matching ports'],['minutes','Assumed minutes per session']] as const;
 return <section className="expected-wait"><h2>Expected wait</h2><p><strong>Live wait prediction unavailable.</strong> No operator queue or arrival-time feed is connected.</p><details><summary>Calculate a manual queue allowance</summary><p>Enter what you observe at this station now. This is a planning model, not a forecast for arrival later.</p><div className="session-fields">{fields.map(([key,label])=><label key={key}>{label}<input type="number" min={key==='ports'||key==='minutes'?1:0} max={key==='minutes'?180:100} value={values[key]} placeholder="Unknown" onChange={e=>{setValues(v=>({...v,[key]:e.target.value}));setSnapshot(null);}}/></label>)}</div><Button type="button" variant="outline" disabled={!valid} onClick={()=>setSnapshot({input,at:Date.now()})}>Calculate allowance</Button>
 {snapshot&&<p role="status">{result?`Manual queue allowance: ~${result.minutes} minutes. Valid for five minutes from your observation.`:'This queue observation has expired. Recheck the queue and calculate again.'}</p>}
 <p className="muted-small">Assumes first-come-first-served, no new arrivals, equal charging durations, and one full assumed session remaining on occupied ports. Reservations, faults, adapters and uneven release times can change the wait. No queue data is inferred from community report counts.</p></details></section>;
}
