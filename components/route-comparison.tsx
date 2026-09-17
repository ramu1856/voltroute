"use client";
import type { SmartStopResult } from '@/lib/smart-stop';
import { compareCheckedRoutes, selectCheckedRoute } from '@/lib/route-comparison';
import { Button } from '@/components/ui/button';

export function RouteComparison({result,now,onSelect}:{result:SmartStopResult;now:number;onSelect:(r:SmartStopResult)=>void}){
 const options=compareCheckedRoutes(result,now);
 if(!options.length)return null;
 const minutes=(value:number|null)=>value===null?'Unavailable':`${Math.round(value)} min`;
 return <details className="route-comparison"><summary>Compare charging routes ({options.length})</summary><p>{result.comparisonNote}</p>
 <p>Same origin, destination and vehicle inputs. Time excludes traffic and waiting. Costs cover charging energy only. Confidence is a planning checklist, not a safety guarantee.</p>
 {result.userSelectedRoute&&<p>Your choice overrides the original recommendation. The same checks and expiry still apply.</p>}
 {options.map(o=><article key={o.id} className={o.selected?'comparison-option is-selected':'comparison-option'}><h4>Via {o.name}</h4><p>{o.selected?'Selected route · ':''}{o.expired?'Expired: recalculate':o.complete?'Conditional one-stop trip':'Partial charging plan'}</p><dl><div><dt>Driving</dt><dd>{o.miles.toFixed(1)} mi · {minutes(o.driveMinutes)}</dd></div><div><dt>Charging</dt><dd>{minutes(o.chargeMinutes)}</dd></div><div><dt>Driving + charging</dt><dd>{minutes(o.totalMinutes)}</dd></div><div><dt>Trip charging energy cost</dt><dd>{o.cost===null?'Unavailable':`~$${o.cost.toFixed(2)} · ${o.priceLabel}`}</dd></div>{o.cost===null&&o.subtotal!==null&&<div><dt>Next-stop subtotal only</dt><dd>~${o.subtotal.toFixed(2)}</dd></div>}<div><dt>Planning confidence</dt><dd>{o.score===null?'Unavailable':`${o.score}/100`}</dd></div><div><dt>Checked backup</dt><dd>{o.backup?'Included':'Not confirmed'}</dd></div></dl><Button type="button" variant="outline" disabled={o.expired||o.selected} onClick={()=>{const next=selectCheckedRoute(result,o.id,Date.now());if(next)onSelect(next);}}>{o.selected?'Selected':'Use this charging route'}</Button></article>)}
 </details>;
}
