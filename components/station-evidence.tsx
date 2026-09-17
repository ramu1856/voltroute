import { Clock3, Database } from 'lucide-react';
import type { Station } from '@/lib/ev';
import { ageLabel, evidenceTime, type AvailabilityInfo } from '@/lib/station-evidence';

export function StationEvidence({ station, info, fetchedAt }: { station: Station; info: AvailabilityInfo; fetchedAt: string }) {
  return <section className="evidence-panel" aria-label="Data freshness">
    <h3><Database size={18}/> Charger status</h3>
    <strong className={`evidence-badge evidence-${info.freshness}`}>{info.freshness === 'unknown' ? 'Current status unconfirmed' : info.label}</strong>
    <p>{info.detail}</p>
    {info.freshness === 'unknown' && <p>Check this station in the charging network’s app before driving here. Unknown does not mean broken.</p>}
    <a className="station-source-link" href={station.sourceUrl} target="_blank" rel="noreferrer">View original station listing ↗</a>
    <details><summary>Observation and source dates</summary><dl className="evidence-facts">
      <div><dt>Operational source</dt><dd>{info.sourceUrl ? <a href={info.sourceUrl} target="_blank" rel="noreferrer">{info.source} ↗</a> : info.source}</dd></div>
      <div><dt>Last observation</dt><dd>{info.observedAt ? <><Clock3 size={13}/> {ageLabel(info.ageMs)}<small>{evidenceTime(info.observedAt)}</small></> : 'None available'}</dd></div>
      <div><dt>Directory retrieved</dt><dd>{evidenceTime(fetchedAt)}</dd></div>
      <div><dt>Map record edited</dt><dd>{evidenceTime(station.updated)}</dd></div>
    </dl></details>
    {station.status !== 'unknown' && <p>Mapped condition: {station.status === 'open' ? 'operational' : station.status}. This is not a live observation.</p>}
    <details><summary>How freshness is determined</summary><p>Live: operator observation up to 5 minutes old. Recent: operator observation up to 30 minutes old, or your report up to 24 hours old. Older, missing or invalid observations become Unknown.</p><p>Directory searches can reuse cached data for up to one hour. Downloading a listing again does not update its observation time. An opening-hours schedule is separate from charger operation.</p></details>
  </section>;
}
