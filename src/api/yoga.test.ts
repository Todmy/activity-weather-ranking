import { readFileSync } from 'node:fs'
import { describe, expect, it, vi } from 'vitest'
import { createApp } from './yoga.ts'
import type { AppDeps } from '../app/deps.ts'
import { OpenMeteoError, parseForecast } from '../providers/openmeteo/forecast.ts'
import { parseGeocoding, toLocations } from '../providers/openmeteo/geocoding.ts'
import { DEFAULT_ISSUED_AT, freshIssuance, issuanceFrom } from '../testing/issuance.ts'

const fixture = (name: string): unknown =>
  JSON.parse(readFileSync(new URL(`../../docs/probes/${name}`, import.meta.url), 'utf8'))

const cambridge = toLocations(parseGeocoding(fixture('geocoding-cambridge.json')))
const innsbruck = parseForecast(fixture('forecast-innsbruck-past3.json'))

/** One stored issuance, for the history field to replay. */
const historyPlan = {
  locationId: 'geoname:2653941',
  city: { latitude: 52.2, longitude: 0.11667 },
  summit: { skip: { status: 'notApplicable' as const, reason: 'noTerrain' } },
  marine: { skip: { status: 'notApplicable' as const, reason: 'noMarineCoverage' } },
}

const deps = (overrides: Partial<AppDeps> = {}): AppDeps => ({
  resolve: async () => ({ location: cambridge[0]!, alternatives: cambridge.slice(1) }),
  search: async () => cambridge,
  register: async () => undefined,
  locationById: async () => cambridge[1]!,
  issuances: async () => [issuanceFrom(historyPlan, { city: innsbruck }, DEFAULT_ISSUED_AT)],
  geography: async () => ({}),
  issuance: async (plan) => freshIssuance(plan, { city: innsbruck }),
  now: () => DEFAULT_ISSUED_AT,
  ...overrides,
})

const post = async (app: ReturnType<typeof createApp>, query: string): Promise<any> => {
  const response = await app.fetch('http://localhost/graphql', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ query }),
  })

  return response.json()
}

/**
 * Over HTTP, through Yoga, because Yoga is where error masking happens and a
 * schema-level test cannot see it. The not-found case reached the deployed
 * service as "Unexpected error." while passing its schema test, which is what
 * this file exists to stop.
 */
describe('the app over HTTP', () => {
  it('reports the commit it is running, so an incident starts against the right code', async () => {
    // Factor V of the twelve: a release has to be identifiable from outside.
    // "Which code is on the box" is the first question of every incident and the
    // deploy log is not an answer — it says what was sent, not what is running.
    const body = await post(createApp({ deps: deps(), release: 'a1b2c3d' }), '{ release }')

    expect(body.errors).toBeUndefined()
    expect(body.data.release).toBe('a1b2c3d')
  })

  it('says "unknown" rather than guessing when nothing stamped the build', async () => {
    // `pnpm dev` has no image and no build argument. An empty string or a
    // plausible-looking default would both read as a real answer.
    const body = await post(createApp({ deps: deps() }), '{ release }')

    expect(body.data.release).toBe('unknown')
  })

  it('logs one line per request, with the operation and how long it took', async () => {
    // Factor XI. The mechanism was already right — stdout, no files, no rotation
    // — but there was nothing on it: five console calls in the whole service and
    // none per request. "What happened at 14:03" had no answer.
    const lines: string[] = []
    const app = createApp({ deps: deps(), log: (line) => lines.push(line) })

    await post(app, 'query WhoAmI { release }')

    expect(lines).toHaveLength(1)
    const entry = JSON.parse(lines[0] as string)
    expect(entry).toMatchObject({ msg: 'request', operation: 'WhoAmI', status: 200, errors: 0 })
    expect(entry.durationMs).toBeGreaterThanOrEqual(0)
  })

  it('counts the errors in a response rather than calling a 200 a success', async () => {
    // GraphQL answers 200 with an `errors` array, so status alone would report
    // every failure this service has as a success.
    const lines: string[] = []
    const app = createApp({
      deps: deps({ resolve: async () => null }),
      log: (line) => lines.push(line),
    })

    await post(app, 'query Missing { activityForecast(query: "Nowhere") { issuedAt } }')

    expect(JSON.parse(lines[0] as string)).toMatchObject({ operation: 'Missing', errors: 1 })
  })

  it('answers a forecast', async () => {
    const body = await post(
      createApp({ deps: deps() }),
      '{ activityForecast(query: "Innsbruck") { days { date activities { ... on ScoredActivity { score } } } } }',
    )

    expect(body.errors).toBeUndefined()
    expect(body.data.activityForecast.days).toHaveLength(7)
  })

  it('names the query in a not-found error instead of masking it as a 500', async () => {
    const body = await post(
      createApp({ deps: deps({ resolve: async () => null }) }),
      '{ activityForecast(query: "Nowhereinparticular") { location { name } } }',
    )

    expect(body.errors[0].message).toContain('Nowhereinparticular')
    expect(body.errors[0].extensions.code).toBe('LOCATION_NOT_FOUND')
  })

  it('says so when Open-Meteo itself is failing, with the status it returned', async () => {
    const body = await post(
      createApp({
        deps: deps({
          // Geocoding, not the forecast: since the gateway landed, a forecast
          // outage becomes a stale answer rather than an error. Resolving a name
          // has nothing stored to fall back to.
          resolve: async () => {
            throw new OpenMeteoError(503, '{"error":true,"reason":"The service is overloaded"}')
          },
        }),
      }),
      '{ activityForecast(query: "Innsbruck") { issuedAt } }',
    )

    // A reviewer who hits a bad five minutes upstream should be told that,
    // not handed a blank 500 that looks like a bug in this service.
    expect(body.errors[0].extensions.code).toBe('UPSTREAM_UNAVAILABLE')
    expect(body.errors[0].message).toContain('503')
    expect(body.errors[0].extensions.upstreamStatus).toBe(503)
  })

  it('serves a stale forecast over HTTP with the reason attached', async () => {
    // The brief's own case: the service still answers with Open-Meteo
    // unreachable, and the answer says so.
    const body = await post(
      createApp({
        deps: deps({
          issuance: async (plan) => ({
            status: 'stale',
            issuance: issuanceFrom(plan, { city: innsbruck }),
            reason: 'Open-Meteo answered 503',
          }),
        }),
      }),
      '{ activityForecast(query: "Innsbruck") { stale staleReason days { date } } }',
    )

    expect(body.errors).toBeUndefined()
    expect(body.data.activityForecast.stale).toBe(true)
    expect(body.data.activityForecast.staleReason).toContain('503')
    expect(body.data.activityForecast.days).toHaveLength(7)
  })

  it('names the cold-start refusal rather than returning a blank 500', async () => {
    const body = await post(
      createApp({
        deps: deps({
          issuance: async () => ({
            status: 'noDataYet',
            reason: 'no issuance arrived within 10 s',
          }),
        }),
      }),
      '{ activityForecast(query: "Innsbruck") { issuedAt } }',
    )

    expect(body.errors[0].extensions.code).toBe('NO_DATA_YET')
    // The fixture resolves every query to Cambridge; the name in the message is
    // the place, not the query, which is the point of naming it at all.
    expect(body.errors[0].message).toContain('Cambridge')
  })

  it('reports a fresh answer as fresh', async () => {
    const body = await post(
      createApp({ deps: deps() }),
      '{ activityForecast(query: "Innsbruck") { stale staleReason } }',
    )

    expect(body.data.activityForecast).toEqual({ stale: false, staleReason: null })
  })

  it('still masks a genuinely unexpected upstream failure', async () => {
    const body = await post(
      createApp({
        deps: deps({
          resolve: async () => {
            throw new Error('connect ECONNREFUSED 10.0.0.1:443')
          },
        }),
      }),
      '{ activityForecast(query: "Innsbruck") { issuedAt } }',
    )

    // Deliberate: an infrastructure detail is not a caller's business.
    expect(body.errors[0].message).toBe('Unexpected error.')
  })
})

describe('searchLocations', () => {
  it('returns every candidate for an ambiguous name, choosing none', async () => {
    const body = await post(
      createApp({ deps: deps() }),
      '{ searchLocations(query: "Cambridge") { geonameId name countryCode admin1 population } }',
    )

    expect(body.errors).toBeUndefined()
    expect(body.data.searchLocations).toHaveLength(5)
    expect(body.data.searchLocations[0].countryCode).toBe('GB')
    expect(body.data.searchLocations.map((l: { admin1: string }) => l.admin1)).toContain(
      'Massachusetts',
    )
    // Population is what upstream ranks by, so a caller choosing between five
    // Cambridges can see the reason the first one is first.
    expect(body.data.searchLocations[0].population).toBeGreaterThan(0)
  })

  it('passes the caller\'s limit upstream and defaults it to five', async () => {
    const search = vi.fn(async (_query: string, _limit: number) => cambridge)
    const app = createApp({ deps: deps({ search }) })

    await post(app, '{ searchLocations(query: "Cambridge") { geonameId } }')
    await post(app, '{ searchLocations(query: "Cambridge", limit: 2) { geonameId } }')

    expect(search.mock.calls.map((call) => call[1])).toEqual([5, 2])
  })

  it('answers an unmatched search with an empty list, not an error', async () => {
    const body = await post(
      createApp({ deps: deps({ search: async () => [] }) }),
      '{ searchLocations(query: "Nowhereinparticular") { geonameId } }',
    )

    expect(body.errors).toBeUndefined()
    expect(body.data.searchLocations).toEqual([])
  })
})

describe('activityForecastAt', () => {
  it('forecasts the id it was given, without re-resolving anything', async () => {
    const resolve = vi.fn(async () => null)

    const body = await post(
      createApp({ deps: deps({ resolve }) }),
      '{ activityForecastAt(locationId: "geoname:4931972") { location { geonameId admin1 } alternatives { geonameId } days { date } } }',
    )

    expect(body.errors).toBeUndefined()
    expect(body.data.activityForecastAt.location.admin1).toBe('Massachusetts')
    expect(body.data.activityForecastAt.alternatives).toEqual([])
    expect(body.data.activityForecastAt.days).toHaveLength(7)
    expect(resolve).not.toHaveBeenCalled()
  })

  it('refuses an unknown id with LOCATION_NOT_FOUND and a way forward', async () => {
    const body = await post(
      createApp({ deps: deps({ locationById: async () => null }) }),
      '{ activityForecastAt(locationId: "geoname:1") { issuedAt } }',
    )

    expect(body.errors[0].extensions.code).toBe('LOCATION_NOT_FOUND')
    expect(body.errors[0].message).toContain('searchLocations')
  })
})

describe('forecastHistory', () => {
  it('shows one date as each stored issuance saw it', async () => {
    const body = await post(
      createApp({ deps: deps() }),
      '{ forecastHistory(locationId: "geoname:2653941", date: "2026-08-02") { issuedAt horizonDays modelVersion day { date activities { ... on ScoredActivity { activity score confidence } } } } }',
    )

    expect(body.errors).toBeUndefined()
    expect(body.data.forecastHistory).toHaveLength(1)
    expect(body.data.forecastHistory[0].day.date).toBe('2026-08-02')
    expect(body.data.forecastHistory[0].horizonDays).toBe(3)
  })

  it('answers a date no issuance covered with an empty list', async () => {
    const body = await post(
      createApp({ deps: deps() }),
      '{ forecastHistory(locationId: "geoname:2653941", date: "2027-01-01") { issuedAt } }',
    )

    expect(body.errors).toBeUndefined()
    expect(body.data.forecastHistory).toEqual([])
  })

  it('refuses an unknown id the same way the forecast fields do', async () => {
    const body = await post(
      createApp({ deps: deps({ locationById: async () => null }) }),
      '{ forecastHistory(locationId: "geoname:1", date: "2026-08-02") { issuedAt } }',
    )

    expect(body.errors[0].extensions.code).toBe('LOCATION_NOT_FOUND')
  })
})

describe('the assessment behind an applicability answer', () => {
  const grenobleTerrain = {
    gridVersion: 'circ-50km-11x11',
    maxElevation: 3204,
    point: { latitude: 45.0088, longitude: 6.2343 },
    distanceKm: 44.7,
  }

  it('reports where skiing was assessed, over HTTP', async () => {
    const app = createApp({
      deps: deps({
        geography: async () => ({ terrain: grenobleTerrain, marineCoverage: 'none' }),
      }),
    })

    const body = await post(
      app,
      '{ activityForecast(query: "Grenoble") { assessment { marineCoverage terrain { elevation distanceKm gridVersion latitude longitude } } } }',
    )

    expect(body.errors).toBeUndefined()
    expect(body.data.activityForecast.assessment).toEqual({
      marineCoverage: 'none',
      terrain: {
        elevation: 3204,
        distanceKm: 44.7,
        gridVersion: 'circ-50km-11x11',
        latitude: 45.0088,
        longitude: 6.2343,
      },
    })
  })

  it('says null rather than zero when nothing has been assessed', async () => {
    // A reviewer has to be able to tell "not looked at" from "no mountain", and
    // an elevation of 0 would read as the second.
    const app = createApp({ deps: deps() })

    const body = await post(
      app,
      '{ activityForecast(query: "Cambridge") { assessment { terrain { elevation } marineCoverage } } }',
    )

    expect(body.data.activityForecast.assessment).toEqual({
      terrain: null,
      marineCoverage: null,
    })
  })

  it('gives notApplicable a reason a caller can act on', async () => {
    const app = createApp({
      deps: deps({
        geography: async () => ({
          terrain: { ...grenobleTerrain, maxElevation: 51 },
          marineCoverage: 'none',
        }),
      }),
    })

    const body = await post(
      app,
      '{ activityForecast(query: "Amsterdam") { days { activities { ... on NotApplicableActivity { activity reason } } } } }',
    )

    const first = body.data.activityForecast.days[0].activities.filter(
      (entry: { activity?: string }) => entry.activity,
    )
    expect(first).toEqual(
      expect.arrayContaining([
        { activity: 'skiing', reason: 'noTerrain' },
        { activity: 'surfing', reason: 'noMarineCoverage' },
      ]),
    )
  })
})
