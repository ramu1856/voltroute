"use client";
import {
  AlertTriangle,
  BadgeDollarSign,
  BatteryCharging,
  CheckCircle2,
  Clock3,
  Map,
  Navigation,
  Route,
  ShieldCheck,
  Zap,
} from 'lucide-react';
import type { SmartStopResult } from '@/lib/smart-stop';
import { arrivalBattery } from '@/lib/smart-stop';
import type { TripAssessment } from '@/lib/trip-assessment';
import { evaluateAvailability, ageLabel } from '@/lib/station-evidence';
import { tripBudget } from '@/lib/trip-budget';
import { predictWaitForecast, waitWindowLabel } from '@/lib/wait-forecast';
import { CompetitiveBenchmark } from './competitive-benchmark';

type Props = {
  result: SmartStopResult;
  assessment: TripAssessment | null;
  now: number;
};

function duration(minutes: number | null) {
  if (minutes === null || !Number.isFinite(minutes)) return 'Unavailable';
  const rounded = Math.max(0, Math.round(minutes));
  const hours = Math.floor(rounded / 60);
  const mins = rounded % 60;
  return hours ? `${hours}h ${mins}m` : `${mins} min`;
}

function dollars(value: number | null) {
  return value === null
    ? 'Unavailable'
    : value.toLocaleString('en-US', { style: 'currency', currency: 'USD' });
}

export function TripIntelligencePanel({ result, assessment, now }: Props) {
  const stop = result.selected;
  const backup = stop?.backup ?? null;
  const availability = stop
    ? evaluateAvailability(stop.station, stop.personalReport || undefined, now)
    : null;
  const budget = tripBudget(result, now);
  const budgetStop = budget.stops[0] ?? null;
  const noChargeNeeded = result.state === 'no-charge-needed';
  const routeItinerary = result.itinerary;
  const destinationBattery = noChargeNeeded
    ? arrivalBattery(result.input, result.route.miles)
    : budgetStop?.reachesDestination
      ? budgetStop.destinationBattery
      : null;
  const arrival = stop ? stop.arrivalBattery : destinationBattery;
  const tripEta = noChargeNeeded
    ? result.route.minutes
    : routeItinerary?.status === 'complete'
      ? routeItinerary.totalDriveMinutes + (routeItinerary.totalChargeMinutes ?? 0)
      : budgetStop?.reachesDestination && budgetStop.driveChargeMinutes !== null
        ? budgetStop.driveChargeMinutes
        : null;
  const price = budgetStop?.price ?? result.selectedPrice ?? null;
  const gapCount = assessment?.sections.filter((section) => section.level === 'gap').length ?? 0;
  const reviewCount =
    assessment?.sections.filter((section) => section.level === 'review').length ?? 0;
  const dataAge = availability?.ageMs ?? null;
  const waitForecast = predictWaitForecast(availability);
  const itinerary = assessment?.itinerary ?? null;

  return (
    <>
      <section className="trip-intelligence" aria-label="VoltRoute trip intelligence">
        <div className="trip-intelligence-heading">
          <div>
            <p className="eyebrow">VoltRoute trip intelligence</p>
            <h2>13 trip checks in one place</h2>
          </div>
          <span className="trip-intelligence-state">
            {result.state === 'suggested' ? (
              <>
                <CheckCircle2 size={16} />
                Plan calculated
              </>
            ) : (
              <>
                <AlertTriangle size={16} />
                Review result
              </>
            )}
          </span>
        </div>
        <p className="trip-intelligence-note">
          These cards use the current Smart Stop result. Unknown operator, price or vehicle data
          stays unknown instead of being filled with guesses.
        </p>

        <div className="trip-intelligence-grid">
          <article>
            <Zap />
            <span>1. Live charger availability</span>
            <strong>{noChargeNeeded ? 'Not needed' : availability?.label ?? 'Unknown'}</strong>
            <small>
              {noChargeNeeded
                ? 'No charging stop is required for this route.'
                : availability?.freshness === 'live' && availability.availablePorts !== null
                  ? `${availability.availablePorts} of ${availability.totalPorts} matching ports reported free now`
                  : availability?.detail ?? 'No operational source connected for this stop.'}
            </small>
            {!noChargeNeeded && (
              <small>
                {waitForecast.minMinutes === null
                  ? 'Queue estimate unavailable for this stop.'
                  : `Estimated queue window ${waitWindowLabel(waitForecast)} (${waitForecast.confidence} confidence).`}
              </small>
            )}
          </article>

          <article>
            <BatteryCharging />
            <span>2. Arrival battery</span>
            <strong>
              {arrival === null || arrival === undefined ? 'Unavailable' : `~${arrival.toFixed(1)}%`}
            </strong>
            <small>
              {stop
                ? `${stop.station.name} arrival${destinationBattery !== null ? ` · destination after planned charge ~${destinationBattery.toFixed(1)}%` : ' · destination battery needs more route planning'}`
                : noChargeNeeded
                  ? 'Estimated at destination'
                  : 'Calculate a valid charging stop to estimate arrival battery.'}
            </small>
          </article>

          <article>
            <Clock3 />
            <span>3. Charging time</span>
            <strong>{noChargeNeeded ? '0 min' : duration(stop?.chargeMinutes ?? null)}</strong>
            <small>
              {noChargeNeeded
                ? 'No charging session planned.'
                : stop?.chargeMinutes !== null && stop?.chargeMinutes !== undefined
                  ? 'Uses entered battery capacity, vehicle limit and listed connector power.'
                  : 'Enter usable battery capacity and vehicle charging limit to calculate.'}
            </small>
          </article>

          <article>
            <Route />
            <span>4. Actual road distance</span>
            <strong>{stop ? `${stop.legs.toMiles.toFixed(1)} mi` : `${result.route.miles.toFixed(1)} mi`}</strong>
            <small>
              {stop
                ? `${stop.detourMiles.toFixed(1)} mi extra driving · ${stop.detourMinutes.toFixed(0)} min detour`
                : 'Road-route distance from origin to destination.'}
            </small>
          </article>

          <article>
            <Navigation />
            <span>5. Backup charger</span>
            <strong>{backup ? backup.station.name : noChargeNeeded ? 'Not needed' : 'Not confirmed'}</strong>
            <small>
              {backup
                ? `${backup.connection.miles.toFixed(1)} road mi from main · ~${backup.arrivalBattery.toFixed(1)}% arrival`
                : noChargeNeeded
                  ? 'Trip does not require a planned charging stop.'
                  : 'No separate reachable backup is currently confirmed.'}
            </small>
          </article>

          <article>
            <ShieldCheck />
            <span>6. No-Stranding Mode</span>
            <strong>{result.input.noStranding ? 'ON' : 'OFF'}</strong>
            <small>
              {result.input.noStranding
                ? backup?.qualifiesForMode
                  ? 'Main stop has a checked backup that meets current reserve, road, access and hours rules.'
                  : 'A qualifying backup is required before a charging stop can be recommended.'
                : 'A main stop may be shown without a confirmed backup.'}
            </small>
          </article>

          <article>
            <Clock3 />
            <span>7. Data freshness</span>
            <strong>
              {noChargeNeeded
                ? 'Not needed'
                : availability?.freshness === 'live'
                  ? 'LIVE'
                  : availability?.freshness === 'recent'
                    ? 'Recent'
                    : 'Unknown'}
            </strong>
            <small>
              {noChargeNeeded
                ? 'No charger observation is needed.'
                : availability?.observedAt
                  ? `${ageLabel(dataAge)} · ${availability.source}`
                  : 'No recent operational timestamp is available.'}
            </small>
          </article>

          <article>
            <BadgeDollarSign />
            <span>8. Price confidence</span>
            <strong>{noChargeNeeded ? 'Not needed' : price?.label ?? 'Unavailable'}</strong>
            <small>
              {noChargeNeeded
                ? 'No in-trip charging cost.'
                : price
                  ? `${price.rate === null ? 'No usable $/kWh rate' : `$${price.rate.toFixed(4)}/kWh`} · ${price.source}`
                  : 'No usable price source for this stop.'}
            </small>
          </article>

          <article>
            <ShieldCheck />
            <span>9. Trip Safety Score</span>
            <strong>
              {assessment?.score === null || assessment?.score === undefined
                ? 'Unavailable'
                : `${assessment.score}/100`}
            </strong>
            <small>
              {assessment?.summary ??
                'Recalculate the Smart Stop plan to create a current planning-confidence score.'}
            </small>
          </article>

          <article>
            <Map />
            <span>10. Route Risk Map</span>
            <strong>{assessment?.sections.length ? `${assessment.sections.length} sections` : 'Unavailable'}</strong>
            <small>
              {assessment?.sections.length
                ? `${gapCount} reserve-gap · ${reviewCount} review section${reviewCount === 1 ? '' : 's'}`
                : 'No current route sections are available to assess.'}
            </small>
          </article>

          <article>
            <Clock3 />
            <span>11. Total trip ETA</span>
            <strong>{duration(tripEta)}</strong>
            <small>
              {tripEta !== null
                ? noChargeNeeded
                  ? 'Driving time only. Traffic is not included.'
                  : routeItinerary?.status === 'complete'
                    ? 'Driving + all planned charging sessions in the current itinerary. Queue changes and traffic are not included.'
                    : 'Driving + planned charging time. Traffic and queue time are not included.'
                : 'Complete ETA needs a route that this plan can cover plus charging-time inputs.'}
            </small>
          </article>

          <article>
            <BadgeDollarSign />
            <span>12. Total charging cost</span>
            <strong>{noChargeNeeded ? '$0.00' : dollars(budget.total)}</strong>
            <small>
              {noChargeNeeded
                ? 'No additional charging is planned.'
                : budget.total !== null
                  ? 'Estimated charging energy for the complete planned trip.'
                  : budget.knownSubtotal !== null
                    ? `Known next-stop subtotal: ${dollars(budget.knownSubtotal)}. Full trip cost is not available yet.`
                    : budget.message}
            </small>
          </article>

          <article>
            <Map />
            <span>13. Full-itinerary projection score</span>
            <strong>
              {itinerary?.score === null || itinerary === null ? 'Unavailable' : `${itinerary.score}/100`}
            </strong>
            <small>
              {itinerary?.label ??
                'Recalculate Smart Stop to project additional charging legs.'}
            </small>
            <small>
              {itinerary?.projectedStops
                ? `${itinerary?.projectedStops} estimated additional charging stop${itinerary?.projectedStops === 1 ? '' : 's'} after this stop.`
                : itinerary?.status === 'not-needed'
                  ? 'No extra charging stops projected.'
                  : 'Projection is limited by current battery assumptions.'}
            </small>
          </article>
        </div>
      </section>

      <CompetitiveBenchmark result={result} assessment={assessment} now={now} />
    </>
  );
}
