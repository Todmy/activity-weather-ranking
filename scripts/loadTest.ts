/**
 * How many concurrent callers this service answers, measured rather than
 * asserted.
 *
 * It asks for a city that is already stored, on purpose. A warm read is one
 * indexed MongoDB query plus the scoring arithmetic and costs **no** upstream
 * call, so this measures the service rather than Open-Meteo — and running it
 * cannot spend the free tier. The script refuses to continue if `issuedAt` moves
 * during the run, because that would mean a fetch happened and the numbers
 * describe something else.
 *
 * Not a benchmark suite and not run in CI. It exists so that "how many clients
 * can this take" has an answer with conditions attached instead of a shrug.
 *
 *   node scripts/loadTest.ts http://2.28.24.132:4000/graphql Ljubljana
 */
const [
  endpoint = 'http://localhost:4000/graphql',
  city = 'Ljubljana',
  levels = '1,10,50',
] = process.argv.slice(2)

const LEVELS = levels.split(',').map(Number)
const SECONDS = 10

const QUERY = `{ activityForecast(query: "${city}") { issuedAt rankings { activity days { date score } } } }`

const ask = async (): Promise<{ ms: number; issuedAt: string; ok: boolean }> => {
  const started = performance.now()
  const response = await fetch(endpoint, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ query: QUERY }),
  })
  const body = (await response.json()) as {
    data?: { activityForecast?: { issuedAt: string } }
    errors?: unknown[]
  }

  return {
    ms: performance.now() - started,
    issuedAt: body.data?.activityForecast?.issuedAt ?? 'missing',
    ok: response.ok && body.errors === undefined,
  }
}

const percentile = (sorted: number[], p: number): number =>
  sorted[Math.min(sorted.length - 1, Math.floor((sorted.length * p) / 100))] ?? 0

const level = async (concurrency: number) => {
  const latencies: number[] = []
  const issuances = new Set<string>()
  let failures = 0

  const until = performance.now() + SECONDS * 1000
  const worker = async () => {
    while (performance.now() < until) {
      const result = await ask()
      latencies.push(result.ms)
      issuances.add(result.issuedAt)
      if (!result.ok) failures += 1
    }
  }

  const started = performance.now()
  await Promise.all(Array.from({ length: concurrency }, worker))
  const elapsed = (performance.now() - started) / 1000
  const sorted = [...latencies].sort((a, b) => a - b)

  return {
    concurrency,
    requests: latencies.length,
    perSecond: Math.round(latencies.length / elapsed),
    p50: Math.round(percentile(sorted, 50)),
    p95: Math.round(percentile(sorted, 95)),
    max: Math.round(sorted.at(-1) ?? 0),
    failures,
    issuances: [...issuances],
  }
}

console.log(`${endpoint} — ${city}, ${SECONDS}s per level\n`)
console.log('concurrency  req/s    p50     p95     max   failures')

for (const concurrency of LEVELS) {
  const result = await level(concurrency)

  if (result.issuances.length !== 1) {
    console.error(`\nissuedAt moved during the run: ${result.issuances.join(', ')}`)
    console.error('That means an upstream fetch happened, so these numbers are not a warm read.')
    process.exit(1)
  }

  console.log(
    `${String(result.concurrency).padStart(11)}  ${String(result.perSecond).padStart(5)}  ` +
      `${String(result.p50).padStart(5)}ms  ${String(result.p95).padStart(5)}ms  ` +
      `${String(result.max).padStart(5)}ms  ${String(result.failures).padStart(8)}`,
  )
}
