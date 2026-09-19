import Link from 'next/link';
export const metadata={title:'About VoltRoutes'};
export default function About(){
 return <main className="legal-page"><div className="legal-shell"><Link href="/">← Back to VoltRoutes</Link><h1>About VoltRoutes</h1>
 <p>VoltRoutes is an EV trip planner focused on reducing charging uncertainty. The product combines road routing, charger discovery, battery estimates, backup-stop planning, and clear data-confidence labels.</p>
 <h2>What makes it different</h2><p>No-Stranding Mode checks a separate backup when possible. Trip Safety Score and Route Risk Map explain what is known, what needs review, and where the plan still has gaps. VoltRoutes keeps unknown availability and prices unknown instead of filling them with guesses.</p>
 <h2>How VoltRoutes compares to common EV tools</h2>
 <p>Many apps are excellent at listing chargers, but confidence checks are often split across several screens and assumptions are hidden. VoltRoutes keeps those checks visible in one planning flow.</p>
 <ul>
  <li><strong>Backup-first planning:</strong> No-Stranding Mode can require a separate reachable fallback instead of accepting a single suggested stop.</li>
  <li><strong>Section-level risk map:</strong> Route segments are marked covered, review, reserve-gap, or unassessed so you can see where confidence drops.</li>
  <li><strong>Evidence freshness labels:</strong> Availability and pricing show confidence and age instead of presenting uncertain data as facts.</li>
  <li><strong>Transparent limits:</strong> Trip Safety Score explains why the score is capped and what assumptions remain.</li>
  <li><strong>Trip-recovery workflow:</strong> If a stop fails, the app highlights fallback assumptions instead of forcing a full restart.</li>
 </ul>
 <h2>Beta status</h2><p>VoltRoutes is still in beta. Coverage and live operator integrations are expanding, and results should be confirmed with the charging network before travel.</p>
 <h2>Contact</h2><p>For product, partnership, data-provider, or support questions, use the official VoltRoutes business contact channel published with the service.</p>
 </div></main>;
}
