const baseUrl = (process.env.D1_HEALTH_BASE_URL || 'https://site-creator-vinext-starter.voltroutes.workers.dev').replace(/\/$/, '');

async function deepHealth() {
  const response = await fetch(`${baseUrl}/api/health?deep=1`, { signal: AbortSignal.timeout(20000) });
  const body = await response.json();
  if (!response.ok) throw new Error(body?.error || `Health endpoint returned ${response.status}`);
  return body;
}

const first = await deepHealth();
await new Promise(resolve => setTimeout(resolve, 1200));
const second = await deepHealth();

const firstCounter = Number(first?.d1?.persistenceCounter || 0);
const secondCounter = Number(second?.d1?.persistenceCounter || 0);
const pass =
  first?.d1?.bound === true &&
  first?.d1?.readable === true &&
  first?.d1?.writable === true &&
  second?.d1?.bound === true &&
  second?.d1?.readable === true &&
  second?.d1?.writable === true &&
  secondCounter === firstCounter + 1;

console.log('D1 persistence verification');
console.log(`Base URL: ${baseUrl}`);
console.log(`First counter: ${firstCounter}`);
console.log(`Second counter: ${secondCounter}`);
console.log(`Pass: ${pass ? 'yes' : 'no'}`);
if (!pass) {
  console.log(JSON.stringify({ first, second }, null, 2));
  process.exitCode = 1;
}
