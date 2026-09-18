'use client';

import { useEffect, useState } from 'react';
import type { AvailabilityInfo } from '@/lib/station-evidence';
import { evidenceTime } from '@/lib/station-evidence';
import { chargingConfidence } from '@/lib/charging-confidence';

export function ChargingConfidencePanel({ info }: { info: AvailabilityInfo }) {
  // Start identically on server and client; evaluate the clock after hydration.
  const [now, setNow] = useState<number | null>(null);
  useEffect(() => {
    const tick = () => setNow(Date.now());
    tick();
    const timer = window.setInterval(tick, 30_000);
    document.addEventListener('visibilitychange', tick);
    return () => { window.clearInterval(timer); document.removeEventListener('visibilitychange', tick); };
  }, []);
  const result = now === null ? null : chargingConfidence(info, now);
  return <section aria-label="Charging confidence" style={{ border: '1px solid currentColor', borderRadius: 12, padding: 16, marginBottom: 16 }}>
    <h3>Charging Confidence <small>Beta</small></h3>
    <strong>{result?.label ?? 'Checking evidence freshness...'}</strong>
    <p>{result?.reason ?? 'Evaluating the observation time, not the directory download time.'}</p>
    {result?.ports && <p>{result.ports}</p>}
    <p>Source: {info.source || 'Not available'}<br />Last operational observation: {info.observedAt ? evidenceTime(info.observedAt) : 'None available'}</p>
    <details><summary>What this confidence means</summary>
      <p>This is an evidence-based assessment of current operation, not a percentage chance of successful charging, a historical reliability rating, or a guarantee.</p>
      <ul>
        <li>High: operator availability within 5 minutes with consistent, positive port counts.</li>
        <li>Medium: positive operational evidence within 30 minutes without sufficient live port evidence.</li>
        <li>Low: a recent busy or unavailable observation.</li>
        <li>Unknown: missing, older, invalid, or conflicting evidence.</li>
      </ul>
      <p>The confidence window is deliberately stricter than the personal-report freshness window. Directory edits and listed opening hours do not increase confidence. Age is rechecked every 30 seconds while this panel is open; this does not fetch live operator data.</p>
      <p>Vehicle compatibility, adapter access, arrival battery and reachable backups must be checked separately. Charging speed history, independent driver success counts and predicted waits are not included in this version.</p>
    </details>
    <p><strong>Before driving:</strong> verify this stop in the charging network app and keep a reachable backup.</p>
  </section>;
}
