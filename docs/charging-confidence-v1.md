# Charging Confidence v1

First incremental implementation, using the existing normalized AvailabilityInfo passed into StationEvidence. No new data provider, fabricated score, live feed, community aggregate, route ranking or database migration is introduced. The existing source panel is retained.

## Rules

- High: normalized live positive availability within 5 minutes, consistent positive free-port counts.
- Medium: positive operational evidence within 30 minutes without sufficient live availability evidence.
- Low: busy or unavailable evidence within 30 minutes. Busy is not broken.
- Unknown: missing, stale, future-dated, invalid or conflicting evidence.

These thresholds are conservative product rules, not calibrated probabilities. Confidence describes current operational evidence only, not successful charging at arrival or historical reliability. Counts describe available ports, not working ports. Compatibility, reserve and backup reachability remain separate.

The UI rechecks observation age every 30 seconds and on visibility change. This is local expiry, not network polling. Until hydration it displays a neutral freshness-check message. A report considered recent by the existing 24-hour report policy can still be Unknown under this stricter 30-minute confidence policy.

## Validation before merge

Not executed by the authoring tool: no shell/browser runner was available.

On Node 22.13+ run:

```
node --experimental-strip-types --test tests/charging-confidence.test.mjs
pnpm exec tsc --noEmit
pnpm lint
pnpm build
```

Use the repository's existing installation/runtime setup. Review any pre-existing failures separately.

Browser checks: select a real station without operator data (Unknown); use isolated test fixtures for recent positive/busy/conflicting inputs; ensure status and source details remain visible on mobile; verify confidence downgrades at the five/thirty-minute boundaries and after returning to a backgrounded tab. Fixtures must never be presented as production station data.

## Deliberately deferred

Historical reliability, verified multi-driver reports, weighted numerical scoring, charger-speed reliability, wait prediction, live ingestion and trip-specific backup checks. Evaluate these separately once trustworthy data sources are connected. This change does not fix the www domain or deploy production.
