"use client";
import { Info, Map, ShieldCheck } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Switch } from '@/components/ui/switch';
import { riskStyles, type TripAssessment } from '@/lib/trip-assessment';

type Props={assessment:TripAssessment;showRisk:boolean;focusedId:string|null;onShowRisk:(show:boolean)=>void;onFocus:(id:string|null)=>void};
const distance=(n:number)=>n.toLocaleString('en-US',{maximumFractionDigits:1});

export function TripAssessmentPanel({assessment,showRisk,focusedId,onShowRisk,onFocus}:Props){
  const selected=assessment.sections.find(section=>section.id===focusedId);
  const mainSections=assessment.sections.filter(section=>section.path==='main');
  const itinerary=assessment.itinerary;
  return <section className="trip-assessment" aria-label="Trip confidence and route risks">
    <div className="trip-score-row"><div className="trip-score-number" aria-label={assessment.score===null?'Score unavailable':`Planning confidence ${assessment.score} out of 100`}><strong>{assessment.score??'—'}</strong><span>/100</span></div><div className="trip-score-copy"><h2><ShieldCheck size={18}/>Trip Safety Score</h2><p className="trip-score-label">Planning confidence · {assessment.label}</p><p>{assessment.summary}</p></div></div>
    <p className="trip-score-disclaimer"><Info size={16}/>A checklist score, not a probability of safety or a guarantee that chargers will work.</p>
    {assessment.score!==null&&<>
      <p className="trip-coverage"><strong>{distance(assessment.assessedMiles)} / {distance(assessment.totalMiles)} mi</strong> assessed for the charging plan ({Math.round(assessment.coveragePercent)}%).{assessment.unassessedMiles>.01&&<span>{distance(assessment.unassessedMiles)} mi remain unassessed.</span>}</p>
      <details className="score-details"><summary>Full-itinerary projection (beta)</summary>
        <p>{itinerary.label}{itinerary.score===null?'':` · Projected score ${itinerary.score}/100`}</p>
        {itinerary.projectedStops>0&&<p>Estimated additional charging stops: <strong>{itinerary.projectedStops}</strong></p>}
        <p>{distance(itinerary.projectedCoveredMiles)} / {distance(assessment.totalMiles)} mi can be followed in this projection.{itinerary.remainingMiles>.01&&` ${distance(itinerary.remainingMiles)} mi still have no battery projection.`}</p>
        {itinerary.legs.length>0&&<ul>{itinerary.legs.map(leg=><li key={leg.id}><strong>{distance(leg.fromMile)}–{distance(leg.toMile)} mi</strong> · ~{leg.batteryFrom.toFixed(1)}% → ~{leg.batteryTo.toFixed(1)}%{leg.requiresChargeStop&&' · charging stop assumed'}<small className="block text-[0.81rem] leading-relaxed text-[#b5cabd]">{leg.assumption}</small></li>)}</ul>}
        <ul>{itinerary.notes.map(note=><li key={note}>{note}</li>)}</ul>
      </details>
      <details className="score-details"><summary>Why this score?</summary>
        <p>Add earned points, divide by applicable points, then apply the limits below. Checks marked “Not needed” are excluded from both totals. These weights are product rules, not measured failure probabilities.</p>
        <div className="score-table-wrap"><table><thead><tr><th scope="col">Check</th><th scope="col">Points</th></tr></thead><tbody>{assessment.factors.map(factor=><tr key={factor.key}><th scope="row">{factor.label}<span>{factor.reason}</span></th><td>{factor.applicable?`${factor.earned.toFixed(1)} / ${factor.possible}`:'Not needed'}</td></tr>)}</tbody></table></div>
        <p>Before limits: {assessment.rawScore}/100. Displayed score: {assessment.score}/100.</p><ul>{assessment.limits.map(limit=><li key={limit.maximum}>{limit.reason}</li>)}</ul>
        {assessment.issues.length>0&&<><h3>What still needs attention</h3><ul>{assessment.issues.map(issue=><li key={issue}>{issue}</li>)}</ul></>}
      </details>
      <div className="risk-heading"><h3><Map size={17}/>Route Risk Map</h3><label htmlFor="route-risk-overlay">Show colors<Switch id="route-risk-overlay" checked={showRisk} onCheckedChange={onShowRisk}/></label></div>
      <div className="risk-legend">{Object.entries(riskStyles).map(([level,style])=><span key={level}><i style={{backgroundColor:style.color}}/>{style.label}</span>)}</div>
      <div className="risk-distance-strip" aria-label="Route sections by driving distance">{mainSections.map(section=><button type="button" key={section.id} style={{flexGrow:section.distanceMiles,backgroundColor:riskStyles[section.level].color}} aria-label={`${section.title}: mile ${distance(section.fromMile)} to ${distance(section.toMile)}`} aria-pressed={focusedId===section.id} onClick={()=>{onShowRisk(true);onFocus(focusedId===section.id?null:section.id);}}><span className="sr-only">{riskStyles[section.level].label}</span></button>)}</div>
      <p className="risk-help">Colors describe charging-plan checks. Dashed paths are the backup after a failed main stop. Section boundaries are approximate.</p>
      {selected&&<div className={`risk-selected risk-${selected.level}`} role="status"><strong>{selected.path==='backup'?'Backup from main':'Main route'} · {selected.title}</strong><p>{distance(selected.fromMile)}–{distance(selected.toMile)} mi · {distance(selected.distanceMiles)} road miles</p><p>{selected.reason}</p>{selected.assumption&&<p className="charge-assumption">{selected.assumption}</p>}<p>{selected.batteryTo===null?'Battery after this stop has not been assessed.':`Estimated battery: ${selected.batteryFrom!.toFixed(1)}% → ${selected.batteryTo.toFixed(1)}%${selected.path==='backup'?' after the failure allowance':''}.`}</p><Button type="button" variant="outline" onClick={()=>onFocus(null)}>Show entire route</Button></div>}
      <details className="risk-sections"><summary>Inspect {assessment.sections.length} route sections</summary><ul>{assessment.sections.map(section=><li key={section.id}><button type="button" aria-pressed={focusedId===section.id} onClick={()=>{onShowRisk(true);onFocus(focusedId===section.id?null:section.id);}}><i style={{backgroundColor:riskStyles[section.level].color}}/><span><strong>{section.path==='backup'?'Backup from main':'Main route'} · {distance(section.fromMile)}–{distance(section.toMile)} mi</strong><span>{riskStyles[section.level].label} · {section.title}</span></span></button></li>)}</ul></details>
    </>}
  </section>;
}
