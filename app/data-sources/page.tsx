import Link from 'next/link';
import { ProviderHealthPanel } from '@/components/provider-health-panel';
export const metadata={title:'Data Sources | VoltRoutes'};
export default function DataSources(){
 return <main className="legal-page"><div className="legal-shell"><Link href="/">← Back to VoltRoutes</Link><h1>Data Sources</h1>
 <p>VoltRoutes separates directory data from operational evidence so users can see what each value actually means.</p>
 <h2>Charging station directory</h2><p>OpenStreetMap community data may be used for charger location, connectors, listed power, access, hours, and community-listed pricing. A recent directory download does not mean a charger was recently tested.</p>
 <h2>Road routing</h2><p>OSRM may be used for driving routes, road distance, and travel-time estimates. Traffic conditions may not be included.</p>
 <h2>Place search</h2><p>Photon and OpenStreetMap-based services may be used to find cities, addresses, food, restrooms, and nearby places.</p>
 <h2>Live charging availability</h2><p>When a compatible TomTom charging-availability record can be matched to a station, VoltRoutes may display recent operator availability such as free, occupied, reserved, or out-of-service port counts. If no reliable match or current observation exists, the status remains unconfirmed.</p>
 <h2>User observations</h2><p>Signed-in users may save private reports or choose to share community observations. These describe what a driver observed at a point in time and are not equivalent to operator telemetry.</p>
 <h2>Price labels</h2><p>Prices are labeled Verified, Estimated, or Unavailable based on source quality and freshness. VoltRoutes does not invent a default price when a usable rate is missing.</p>
 <p><strong>Operations checks:</strong> <a href="/api/health" target="_blank" rel="noreferrer">/api/health</a> for runtime + D1 status, and <a href="/api/provider-health" target="_blank" rel="noreferrer">/api/provider-health</a> for provider reachability.</p>
 <ProviderHealthPanel/>
 </div></main>;
}