import { WORKER_SITE_URL } from '@/lib/site-config';
export const metadata={title:'Privacy Policy | VoltRoutes'};
export default function Privacy(){
 return <main className="legal-page"><div className="legal-shell"><a href={WORKER_SITE_URL}>← Back to VoltRoutes</a><h1>Privacy Policy</h1><p>Last updated: September 19, 2026</p>
 <h2>What VoltRoutes collects</h2><p>VoltRoutes may process location searches, trip inputs, EV profile details, saved chargers and trips, account information, and station reports you choose to submit.</p>
 <h2>Location</h2><p>Your precise device location is used only when you choose a location feature such as Near me. Search locations and route coordinates may be sent to map, routing, charging-data, or place providers needed to answer your request.</p>
 <h2>Accounts and saved data</h2><p>If you create an account, saved items and reports are associated with your account so they can be available across sessions. Public or shared community observations are clearly identified before you submit them.</p>
 <h2>Third-party services</h2><p>VoltRoutes may use services such as OpenStreetMap, Photon, OSRM, TomTom, Supabase, and hosting infrastructure to provide maps, routes, charging data, authentication, and storage. Their own privacy terms may also apply.</p>
 <h2>Data accuracy</h2><p>Charging availability, pricing, hours, and station details can be delayed, incomplete, or unavailable. VoltRoutes does not treat a map listing as proof that a charger is working or free.</p>
 <h2>Your choices</h2><p>You can use many planning features without saving an account item. Signed-in users can remove saved items and private reports through the app where those controls are available.</p>
 <h2>Contact</h2><p>For privacy questions, use the contact information published on the VoltRoutes About page.</p>
 </div></main>;
}