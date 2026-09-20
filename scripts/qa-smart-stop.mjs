const baseUrl = process.env.SMART_STOP_BASE_URL || 'http://localhost:43125';
const endpoint = `${baseUrl.replace(/\/$/, '')}/api/smart-stop`;
const originHeader = process.env.SMART_STOP_ORIGIN || baseUrl;
const scenarioCooldownMs = Number(process.env.SMART_STOP_COOLDOWN_MS || 5200);

const scenarios = [
  {
    name: 'LA to Las Vegas',
    origin: { lat: 34.0522, lon: -118.2437, label: 'Los Angeles, CA' },
    destination: { lat: 36.1699, lon: -115.1398, label: 'Las Vegas, NV' },
    battery: 52,
  },
  {
    name: 'Chicago to Detroit',
    origin: { lat: 41.8781, lon: -87.6298, label: 'Chicago, IL' },
    destination: { lat: 42.3314, lon: -83.0458, label: 'Detroit, MI' },
    battery: 48,
  },
  {
    name: 'Phoenix to Tucson',
    origin: { lat: 33.4484, lon: -112.074, label: 'Phoenix, AZ' },
    destination: { lat: 32.2226, lon: -110.9747, label: 'Tucson, AZ' },
    battery: 42,
  },
  {
    name: 'San Francisco to Fresno',
    origin: { lat: 37.7749, lon: -122.4194, label: 'San Francisco, CA' },
    destination: { lat: 36.7378, lon: -119.7871, label: 'Fresno, CA' },
    battery: 45,
  },
  {
    name: 'Dallas to Austin',
    origin: { lat: 32.7767, lon: -96.797, label: 'Dallas, TX' },
    destination: { lat: 30.2672, lon: -97.7431, label: 'Austin, TX' },
    battery: 46,
  },
];

const inputBase = {
  profile: { name: 'QA EV', connector: 'CCS1', range: 220 },
  reserve: 12,
  maxDetourMinutes: 35,
  batteryCapacity: 75,
  vehicleMaxKW: 170,
  noStranding: false,
  failureAllowance: 2,
  failureDelayMinutes: 8,
  preference: 'balanced',
  enteredRates: {},
};

const results = [];
const delay = ms => new Promise(resolve => setTimeout(resolve, ms));

async function requestScenario(payload) {
  let attempts = 0;
  while (attempts < 3) {
    attempts += 1;
    const response = await fetch(endpoint, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        origin: originHeader,
        referer: `${originHeader.replace(/\/$/, '')}/`,
      },
      body: JSON.stringify(payload),
    });
    const text = await response.text();
    let body;
    try {
      body = JSON.parse(text);
    } catch {
      body = { parseError: true, raw: text.slice(0, 160) };
    }
    if (response.status !== 429 || attempts === 3) return { response, body, attempts };
    await delay(Math.max(scenarioCooldownMs, 1200 * attempts));
  }
  throw new Error('unreachable');
}

for (const scenario of scenarios) {
  const started = Date.now();
  const payload = { ...inputBase, origin: scenario.origin, destination: scenario.destination, battery: scenario.battery };
  try {
    const { response, body, attempts } = await requestScenario(payload);
    const latencyMs = Date.now() - started;
    const itineraryStops = body?.itinerary?.stops?.length ?? 0;
    results.push({
      scenario: scenario.name,
      status: response.status,
      state: body?.state ?? 'unknown',
      itinerary: body?.itinerary?.status ?? '-',
      stops: itineraryStops,
      score: body?.itinerary?.projectedScore ?? '-',
      latencyMs,
      attempts,
      message: (body?.message || body?.error || body?.raw || '').replace(/\s+/g, ' ').slice(0, 90),
      pass:
        response.status === 200 &&
        (body?.state === 'no-charge-needed' ||
          body?.state === 'no-backup-confirmed' ||
          body?.state === 'preference-unavailable' ||
          (body?.state === 'suggested' && itineraryStops > 0)),
    });
  } catch (error) {
    results.push({
      scenario: scenario.name,
      status: 'ERR',
      state: 'error',
      itinerary: '-',
      stops: 0,
      score: '-',
      latencyMs: Date.now() - started,
      attempts: 0,
      message: String(error),
      pass: false,
    });
  }
  await delay(scenarioCooldownMs);
}

console.log('Smart Stop QA');
console.log(`Endpoint: ${endpoint}`);
console.log('');
console.table(
  results.map(result => ({
    scenario: result.scenario,
    status: result.status,
    state: result.state,
    itinerary: result.itinerary,
    stops: result.stops,
    score: result.score,
    latencyMs: result.latencyMs,
    attempts: result.attempts,
    pass: result.pass ? 'yes' : 'no',
  })),
);

const failed = results.filter(result => !result.pass);
if (failed.length) {
  console.log('\nFailed scenarios:');
  for (const result of failed) {
    console.log(`- ${result.scenario}: ${result.status} ${result.state} (${result.message})`);
  }
  process.exitCode = 1;
} else {
  console.log('\nAll scenarios passed baseline expectations.');
}
