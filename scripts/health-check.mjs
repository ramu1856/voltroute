const baseUrl = (process.env.HEALTH_BASE_URL || 'https://site-creator-vinext-starter.voltroutes.workers.dev').replace(/\/$/, '');

const checks = [
  {
    name: 'homepage',
    path: '/',
    expect: (status, body) => status === 200 && body.includes('VoltRoute'),
  },
  {
    name: 'health-basic',
    path: '/api/system-health',
    expect: (status, body) => status === 200 && body.status && ['ok', 'degraded'].includes(body.status),
  },
  {
    name: 'health-d1-deep',
    path: '/api/system-health?deep=1',
    expect: (status, body) => status === 200 && body.d1?.bound === true && body.d1?.readable === true && body.d1?.writable === true,
  },
  {
    name: 'provider-health',
    path: '/api/provider-status',
    expect: (status, body) => status === 200 && Array.isArray(body.checks) && body.checks.length >= 2,
  },
  {
    name: 'route-api',
    path: '/api/explore?action=route&lat=41.8781&lon=-87.6298&toLat=42.3314&toLon=-83.0458',
    expect: (status, body) => status === 200 && body.data?.miles > 0 && body.data?.minutes > 0,
  },
  {
    name: 'stations-api',
    path: '/api/explore?action=stations&lat=41.8781&lon=-87.6298&radius=160934',
    expect: (status, body) => status === 200 && Array.isArray(body.data) && typeof body.fetchedAt === 'string',
  },
];

function pretty(value) {
  if (typeof value === 'string') return value;
  try {
    return JSON.stringify(value);
  } catch {
    return String(value);
  }
}

const results = [];
for (const check of checks) {
  const url = `${baseUrl}${check.path}`;
  const started = Date.now();
  try {
    const response = await fetch(url, { signal: AbortSignal.timeout(20000) });
    const raw = await response.text();
    let body = raw;
    try {
      body = JSON.parse(raw);
    } catch {
      body = raw;
    }
    const pass = check.expect(response.status, body);
    results.push({
      check: check.name,
      status: response.status,
      latencyMs: Date.now() - started,
      pass: pass ? 'yes' : 'no',
      detail: pass ? 'ok' : pretty(typeof body === 'string' ? body.slice(0, 120) : body.error || body.detail || body.status || 'validation failed'),
    });
  } catch (error) {
    results.push({
      check: check.name,
      status: 'ERR',
      latencyMs: Date.now() - started,
      pass: 'no',
      detail: error instanceof Error ? error.message : String(error),
    });
  }
}

console.log(`Health checks for ${baseUrl}`);
console.table(results);
if (results.some(result => result.pass !== 'yes')) {
  process.exitCode = 1;
}
