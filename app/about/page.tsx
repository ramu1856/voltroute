import Link from 'next/link';
export const metadata={title:'About VoltRoutes'};
export default function About(){
 return <main className="legal-page"><div className="legal-shell"><Link href="/">← Back to VoltRoutes</Link><h1>About VoltRoutes</h1>
 <p>VoltRoutes is an EV trip planner focused on reducing charging uncertainty. The product combines road routing, charger discovery, battery estimates, backup-stop planning, and clear data-confidence labels.</p>
 <h2>What makes it different</h2><p>No-Stranding Mode checks a separate backup when possible. Trip Safety Score and Route Risk Map explain what is known, what needs review, and where the plan still has gaps. VoltRoutes keeps unknown availability and prices unknown instead of filling them with guesses.</p>
 <h2>Beta status</h2><p>VoltRoutes is still in beta. Coverage and live operator integrations are expanding, and results should be confirmed with the charging network before travel.</p>
 <h2>Contact</h2><p>For product, partnership, data-provider, or support questions, use the official VoltRoutes business contact channel published with the service.</p>
 </div></main>;
}