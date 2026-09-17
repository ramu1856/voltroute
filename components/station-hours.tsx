import { Clock3 } from 'lucide-react';
import { readableHours, type HoursInfo } from '@/lib/opening-hours';

export function StationHours({ hours, info, checkedAt, sourceUrl }: { hours: string; info?: HoursInfo; checkedAt: number | null; sourceUrl: string }) {
  const localTime = info?.timeZone && checkedAt !== null
    ? new Intl.DateTimeFormat('en-US', { timeZone: info.timeZone, weekday: 'short', hour: 'numeric', minute: '2-digit', timeZoneName: 'short' }).format(checkedAt)
    : null;
  return <section className="station-hours" aria-label="Station opening hours">
    <h3><Clock3 size={18}/> Opening hours</h3>
    <strong className={`hours-badge hours-${info?.state || 'unknown'}`}>{info?.label || 'Checking listed hours…'}</strong>
    <p className="hours-schedule">{readableHours(hours)}</p>
    {localTime && <p className="hours-local-time">Station time: {localTime}<br/>{info?.timeZone}{info?.timeZoneEstimated ? ' (estimated from location)' : ''}</p>}
    <p className="muted-small">{info?.explanation}</p>
    {info?.state === 'unknown' && <p className="muted-small">Confirm opening hours and parking access with the charging network or location before you go.</p>}
    <a className="station-source-link" href={sourceUrl} target="_blank" rel="noreferrer">Check listed schedule ↗</a>
  </section>;
}
