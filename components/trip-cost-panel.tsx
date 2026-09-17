"use client";
import { BadgeDollarSign } from 'lucide-react';
import type { SmartStopResult } from '@/lib/smart-stop';
import { tripBudget } from '@/lib/trip-budget';

const dollars=(amount:number)=>amount.toLocaleString('en-US',{style:'currency',currency:'USD'});
export function TripCostPanel({result,now}:{result:SmartStopResult;now:number}){
  const budget=tripBudget(result,now);
  return <section className="trip-cost-panel" aria-label="Trip charging cost">
    <div className="trip-cost-heading"><h2><BadgeDollarSign size={20}/>Trip charging cost</h2><span className={`cost-state cost-${budget.state}`}>{budget.state==='complete'?'Energy budget complete':budget.state==='partial'?'Partial budget':'Data missing'}</span></div>
    <div className="trip-cost-total"><strong>{budget.total===null?'Total unavailable':dollars(budget.total)}</strong><span>{budget.total===null?'Missing prices or charging stops are not filled with guesses.':'Estimated in-trip charging energy only'}</span></div>
    <p>{budget.message}</p>
    {budget.total===null&&budget.knownSubtotal!==null&&<p className="known-subtotal">Known next-stop subtotal: <strong>{dollars(budget.knownSubtotal)}</strong>. This is not the full trip total.</p>}
    {budget.stops.map(stop=><details className="trip-cost-stop" key={stop.stationId}><summary>{stop.stationName} · {stop.energyCost===null?'Cost unavailable':dollars(stop.energyCost)}</summary>
      <dl><div><dt>Planned charge</dt><dd>{stop.arrivalBattery.toFixed(1)}% → {stop.targetBattery.toFixed(1)}%</dd></div><div><dt>Energy added</dt><dd>{stop.energyKwh===null?'Battery capacity needed':`${stop.energyKwh.toFixed(1)} kWh`}</dd></div><div><dt>Energy rate</dt><dd>{stop.price.rate===null?'Unavailable':`${stop.price.rate.toLocaleString('en-US',{style:'currency',currency:'USD',minimumFractionDigits:2,maximumFractionDigits:4})}/kWh`} · {stop.price.label}</dd></div><div><dt>Price source</dt><dd>{stop.price.sourceUrl?<a href={stop.price.sourceUrl} target="_blank" rel="noreferrer">{stop.price.source} ↗</a>:stop.price.source}</dd></div><div><dt>Battery at destination</dt><dd>{stop.reachesDestination?`~${stop.destinationBattery.toFixed(1)}%, if this charge succeeds`:'More charging stops needed'}</dd></div></dl>
      <p>{stop.price.detail}</p><p>Energy uses your entered usable battery capacity. No default battery capacity or electricity price is used for this trip budget.</p>
    </details>)}
    {budget.missing.length>0&&<ul className="trip-cost-missing">{budget.missing.map(reason=><li key={reason}>{reason}</li>)}</ul>}
    <p className="trip-cost-note">Excludes energy already in the battery, charging losses, taxes, tolls, parking, session and idle fees. The backup is an alternative and is not added to the normal trip bill. Actual charges may differ.</p>
  </section>;
}
