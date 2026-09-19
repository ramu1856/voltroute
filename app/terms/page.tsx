import Link from 'next/link';
export const metadata={title:'Terms of Use | VoltRoutes'};
export default function Terms(){
 return <main className="legal-page"><div className="legal-shell"><Link href="/">← Back to VoltRoutes</Link><h1>Terms of Use</h1><p>Last updated: September 19, 2026</p>
 <h2>Planning tool, not a guarantee</h2><p>VoltRoutes is a trip-planning and charging-discovery tool. Routes, battery estimates, charger status, prices, hours, queue estimates, and safety checks are planning information only and are not guarantees.</p>
 <h2>Driver responsibility</h2><p>You are responsible for confirming charger compatibility, access, opening hours, payment requirements, road conditions, and enough battery reserve before driving. Follow your vehicle manufacturer guidance and applicable traffic laws.</p>
 <h2>Emergency use</h2><p>Do not rely on VoltRoutes as an emergency or roadside-assistance service. If you cannot safely continue, contact your vehicle manufacturer, charging network, insurer, or roadside-assistance provider.</p>
 <h2>Third-party data</h2><p>VoltRoutes uses third-party map, routing, charging, and place data. Coverage can be incomplete and providers can change or become unavailable without notice.</p>
 <h2>Community reports</h2><p>Community observations are user-submitted reports about past conditions. They are not operator verification and do not prove current charger operation or port availability.</p>
 <h2>Acceptable use</h2><p>Do not misuse the service, attempt unauthorized access, overload providers, submit knowingly false reports, or use VoltRoutes in a way that violates law or another person's rights.</p>
 </div></main>;
}