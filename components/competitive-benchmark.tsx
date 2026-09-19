"use client";

import { CheckCircle2, CircleDashed, XCircle } from "lucide-react";
import type { SmartStopResult } from "@/lib/smart-stop";
import type { TripAssessment } from "@/lib/trip-assessment";
import { evaluateAvailability } from "@/lib/station-evidence";
import { tripBudget } from "@/lib/trip-budget";

type Props = {
  result: SmartStopResult;
  assessment: TripAssessment | null;
  now: number;
};

type Row = {
  area: string;
  voltRoute: string;
  typicalApps: string;
  state: "strong" | "partial" | "missing";
};

const StateIcon = ({ state }: { state: Row["state"] }) => {
  if (state === "strong") return <CheckCircle2 size={16} aria-hidden="true" />;
  if (state === "partial") return <CircleDashed size={16} aria-hidden="true" />;
  return <XCircle size={16} aria-hidden="true" />;
};

function coverageState(coveragePercent: number | undefined): Row["state"] {
  if (coveragePercent === undefined) return "missing";
  if (coveragePercent >= 99.9) return "strong";
  if (coveragePercent >= 45) return "partial";
  return "missing";
}

function stateClass(state: Row["state"]) {
  if (state === "strong") return "text-[#9ff3b1]";
  if (state === "partial") return "text-[#f0da89]";
  return "text-[#f2a3a3]";
}

export function CompetitiveBenchmark({ result, assessment, now }: Props) {
  const stop = result.selected;
  const backup = stop?.backup ?? null;
  const availability = stop
    ? evaluateAvailability(stop.station, stop.personalReport || undefined, now)
    : null;
  const budget = tripBudget(result, now);
  const budgetStop = budget.stops[0] ?? null;
  const noChargeNeeded = result.state === "no-charge-needed";
  const liveEvidence = availability?.freshness === "live";
  const hasBackup = !!backup?.qualifiesForMode;
  const hasChargeTime = stop?.chargeMinutes !== null && stop?.chargeMinutes !== undefined;
  const hasPriceConfidence =
    noChargeNeeded ||
    ((budgetStop?.price?.rate ?? result.selectedPrice?.rate ?? null) !== null &&
      (budgetStop?.price?.rate ?? result.selectedPrice?.rate ?? null) !== undefined);
  const hasRiskMap = (assessment?.sections.length ?? 0) > 0;
  const coverage = assessment?.coveragePercent;

  const rows: Row[] = [
    {
      area: "Battery-reserve route validation",
      voltRoute: noChargeNeeded
        ? "Reserve checked end-to-end without a charging stop."
        : stop
          ? `Reserve checked to main stop at ~${stop.arrivalBattery.toFixed(1)}% arrival.`
          : "Charging-needed route has no current valid stop.",
      typicalApps: "Often show chargers on map, without reserve proof for your route.",
      state: noChargeNeeded || !!stop ? "strong" : "missing",
    },
    {
      area: "Failover backup charger",
      voltRoute: hasBackup
        ? "Reachable fallback validated for battery, access and hours."
        : "No qualifying fallback currently confirmed.",
      typicalApps: "Usually do not enforce explicit backup checks.",
      state: noChargeNeeded ? "strong" : hasBackup ? "strong" : "missing",
    },
    {
      area: "Live operational evidence",
      voltRoute: noChargeNeeded
        ? "Not required for this route."
        : liveEvidence
          ? "Live operator observation connected for selected stop."
          : "Live evidence not confirmed; plan remains reviewable.",
      typicalApps: "Many directories rely on static listings or stale status.",
      state: noChargeNeeded ? "strong" : liveEvidence ? "strong" : "partial",
    },
    {
      area: "Charge-time and price confidence",
      voltRoute: noChargeNeeded
        ? "No in-trip charging session required."
        : hasChargeTime && hasPriceConfidence
          ? "Charge minutes and price confidence available for current stop."
          : hasChargeTime || hasPriceConfidence
            ? "Partial economics or timing confidence available."
            : "Timing and price confidence still missing for this stop.",
      typicalApps: "Usually show station price or speed, not combined trip confidence.",
      state: noChargeNeeded
        ? "strong"
        : hasChargeTime && hasPriceConfidence
          ? "strong"
          : hasChargeTime || hasPriceConfidence
            ? "partial"
            : "missing",
    },
    {
      area: "Risk map + section-level review",
      voltRoute: hasRiskMap
        ? `${assessment?.sections.length ?? 0} route sections with covered/review/gap labeling.`
        : "No section-level assessment available yet.",
      typicalApps: "Most route views do not mark confidence by road segment.",
      state: hasRiskMap ? coverageState(coverage) : "missing",
    },
  ];

  const nextActions: string[] = [];
  if (!noChargeNeeded && !hasBackup) {
    nextActions.push("Try a different route preference or lower reserve slightly to surface a qualifying backup.");
  }
  if (!noChargeNeeded && !liveEvidence) {
    nextActions.push("Use Refresh live status for the selected stop before departure.");
  }
  if (!noChargeNeeded && !hasChargeTime) {
    nextActions.push("Enter battery capacity and vehicle charging limit to unlock charging-time confidence.");
  }
  if (!noChargeNeeded && !hasPriceConfidence) {
    nextActions.push("Enter a stop rate ($/kWh) if operator pricing is missing to compare cost more reliably.");
  }
  if ((assessment?.coveragePercent ?? 0) < 99.9 && !noChargeNeeded) {
    nextActions.push("Current plan does not assess the full trip yet; treat this as next-stop guidance, not a complete itinerary.");
  }

  return (
    <section
      aria-label="VoltRoute competitive benchmark"
      className="min-w-0 break-words border-b border-[#46614f] bg-[#0f2218] px-5 py-5 max-[560px]:px-3"
    >
      <div>
        <p className="eyebrow">Competitive benchmark</p>
        <h2 className="mt-0.5 text-xl">Why this plan is stronger than map-only EV tools</h2>
      </div>

      <p className="mb-3 mt-3 text-sm leading-relaxed text-[#bdd0c3]">
        This comparison uses your current trip calculation. It highlights where VoltRoute adds
        evidence-based checks beyond a typical charger list.
      </p>

      <div className="overflow-auto rounded-xl border border-[#405b49] bg-[#142a1f]">
        <table className="min-w-[720px] w-full border-collapse">
          <thead>
            <tr>
              <th className="bg-[#193224] px-3 py-2 text-left text-xs uppercase tracking-wide text-[#aec5b6]">Planning area</th>
              <th className="bg-[#193224] px-3 py-2 text-left text-xs uppercase tracking-wide text-[#aec5b6]">VoltRoute (current trip)</th>
              <th className="bg-[#193224] px-3 py-2 text-left text-xs uppercase tracking-wide text-[#aec5b6]">Typical apps</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => (
              <tr key={row.area} className="border-t border-[#2f4a3a] align-top text-sm leading-relaxed text-[#d7e4dc]">
                <td className="px-3 py-2">
                  <span className={`inline-flex items-center gap-2 font-semibold ${stateClass(row.state)}`}>
                    <StateIcon state={row.state} />
                    {row.area}
                  </span>
                </td>
                <td className="px-3 py-2">{row.voltRoute}</td>
                <td className="px-3 py-2">{row.typicalApps}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <div className="mt-3 rounded-xl border border-[#43604d] bg-[#162d21] p-3">
        <h3 className="mb-1 text-sm font-semibold text-[#e4f2e9]">Make this trip even stronger</h3>
        {nextActions.length ? (
          <ul className="grid gap-1 pl-4 text-[0.82rem] leading-relaxed text-[#c7d8ce]">
            {nextActions.map((action) => (
              <li key={action}>{action}</li>
            ))}
          </ul>
        ) : (
          <p className="text-[0.82rem] leading-relaxed text-[#c7d8ce]">
            Core confidence checks are covered for this plan. Re-run right before departure to
            refresh evidence.
          </p>
        )}
      </div>
    </section>
  );
}
