import { readFileSync } from 'node:fs'
import type { Db } from 'mongodb'
import { connectTestDatabase } from '../testing/database.ts'
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { forecastRepository } from '../persistence/forecasts.ts'
import type { NewIssuance } from '../persistence/forecasts.ts'
import { leaseKeyFor, leaseRepository } from '../persistence/leases.ts'
import { parseForecast } from '../providers/openmeteo/forecast.ts'
import type { Coordinates } from '../providers/openmeteo/forecast.ts'
import { parseMarine, toDailyMarine } from '../providers/openmeteo/marine.ts'
import { COLD_START_POLLS, FRESHNESS_MS, ensureFresh, isFresh } from './forecastGateway.ts'
import type { FetchPlan, GatewayDeps } from './forecastGateway.ts'

/**
 * The refresh gateway, against a real mongod and captured responses.
 *
 * Both halves matter. The lease and the sort order are database behaviour, so
 * faking them would test the fake — and no test may reach Open-Meteo, so the
 * upstream side is fixtures throughout. `sleep` is injected for the same
 * reason: the cold-start wait is 10 seconds in production and must be zero
 * here, without the branch under test knowing the difference.
 */
let store: Awaited<ReturnType<typeof connectTestDatabase>>
let db: Db

beforeAll(async () => {
  store = await connectTestDatabase(import.meta.url)
  db = store.db
})

afterAll(async () => {
  await store.close()
})

beforeEach(async () => {
  await db.collection('forecasts').drop().catch(() => undefined)
  await db.collection('leases').drop().catch(() => undefined)
})

const fixture = (name: string) =>
  JSON.parse(readFileSync(new URL(`../../docs/probes/${name}.json`, import.meta.url), 'utf8'))

const cityForecast = parseForecast(fixture('forecast-innsbruck-past3'))
const summitForecast = parseForecast(fixture('forecast-grenoble-summit-past3'))
const lisbonMarine = parseMarine(fixture('marine-lisbon-past3'))

const LOCATION = 'geoname:3014728'
const at = (iso: string) => new Date(iso)
const noon = at('2026-07-30T12:00:00Z')

const cityPoint: Coordinates = { latitude: 45.1885, longitude: 5.7245 }
const summitPoint: Coordinates = { latitude: 45.0088, longitude: 6.2343 }

const plan = (overrides: Partial<FetchPlan> = {}): FetchPlan => ({
  locationId: LOCATION,
  city: cityPoint,
  summit: { point: summitPoint },
  marine: { skip: { status: 'notApplicable', reason: 'noMarineCoverage' } },
  ...overrides,
})

const deps = (overrides: Partial<GatewayDeps> = {}): GatewayDeps => ({
  forecasts: forecastRepository(db),
  leases: leaseRepository(db),
  weather: async (coordinates) =>
    coordinates.latitude === summitPoint.latitude ? summitForecast : cityForecast,
  marine: async () => ({ coverage: 'present', days: toDailyMarine(lisbonMarine) }),
  instanceId: 'instance-a',
  now: () => noon,
  sleep: async () => undefined,
  ...overrides,
})

const storedIssuance = (issuedAt: Date): NewIssuance => ({
  locationId: LOCATION,
  issuedAt,
  modelRun: null,
  city: { status: 'ok', elevation: 214, days: [{ date: '2026-07-30', temperatureMax: 21 }] },
  summit: { status: 'notApplicable', reason: 'noTerrain' },
  marine: { status: 'notApplicable', reason: 'noMarineCoverage' },
})

describe('isFresh', () => {
  it('holds an issuance fresh for an hour and not a millisecond longer', async () => {
    const issuance = await forecastRepository(db).insert(storedIssuance(noon))

    expect(isFresh(issuance, new Date(noon.getTime() + FRESHNESS_MS - 1))).toBe(true)
    expect(isFresh(issuance, new Date(noon.getTime() + FRESHNESS_MS))).toBe(false)
    expect(FRESHNESS_MS).toBe(60 * 60 * 1000)
  })
})

describe('ensureFresh', () => {
  it('serves a fresh issuance from storage and calls nobody', async () => {
    // The whole point of the milestone: weather is read from storage, not
    // re-fetched per request.
    await forecastRepository(db).insert(storedIssuance(at('2026-07-30T11:50:00Z')))
    const weather = vi.fn(async () => cityForecast)

    const result = await ensureFresh(deps({ weather }), plan())

    expect(result.status).toBe('fresh')
    expect(weather).not.toHaveBeenCalled()
    expect(result.status === 'fresh' && result.issuance.issuedAt).toEqual(
      at('2026-07-30T11:50:00Z'),
    )
  })

  it('refetches past the freshness window and writes a new issuance', async () => {
    await forecastRepository(db).insert(storedIssuance(at('2026-07-30T10:00:00Z')))
    const weather = vi.fn(async () => cityForecast)

    const result = await ensureFresh(deps({ weather }), plan({ summit: { skip: { status: 'notApplicable', reason: 'noTerrain' } } }))

    expect(result.status).toBe('fresh')
    expect(weather).toHaveBeenCalledTimes(1)
    expect(await db.collection('forecasts').countDocuments({ locationId: LOCATION })).toBe(2)
    expect(result.status === 'fresh' && result.issuance.issuedAt).toEqual(noon)
  })

  it('fetches the city, the summit and the waves as one issuance', async () => {
    const result = await ensureFresh(
      deps(),
      plan({ marine: { point: cityPoint } }),
    )

    expect(result.status).toBe('fresh')
    const issuance = result.status === 'fresh' ? result.issuance : null
    expect(issuance?.city.status).toBe('ok')
    // The free cross-check from slice 3: the model reports the summit's own
    // ground elevation, so the second series is provably about the high point.
    expect(issuance?.summit.elevation).toBe(3204)
    expect(issuance?.marine.status).toBe('ok')
    expect(issuance?.marine.days?.length).toBeGreaterThan(0)
  })

  it('records a skipped series with its reason and pays for no call', async () => {
    const weather = vi.fn(async () => cityForecast)

    const result = await ensureFresh(deps({ weather }), plan({
      summit: { skip: { status: 'notApplicable', reason: 'noTerrain' } },
    }))

    expect(weather).toHaveBeenCalledTimes(1)
    expect(result.status === 'fresh' && result.issuance.summit).toEqual({
      status: 'notApplicable',
      reason: 'noTerrain',
    })
  })

  it('keeps the city series when the summit fetch fails, and says so', async () => {
    // A second forecast failing must not cost the caller the first one.
    const weather = vi.fn(async (coordinates: Coordinates) => {
      if (coordinates.latitude === summitPoint.latitude) throw new Error('Open-Meteo answered 503')
      return cityForecast
    })

    const result = await ensureFresh(deps({ weather }), plan())

    expect(result.status).toBe('fresh')
    const issuance = result.status === 'fresh' ? result.issuance : null
    expect(issuance?.city.status).toBe('ok')
    expect(issuance?.summit.status).toBe('unavailable')
    expect(issuance?.summit.reason).toContain('503')
  })

  it('gives every upstream call an 8-second abort signal', async () => {
    // The other half of the lease margin: 30 s of lease against a hard 8 s cap
    // on the call it guards. A lease shorter than its fetch admits a second
    // fetcher — risk 8 in recon.md.
    const weather = vi.fn(async (_coordinates: Coordinates, _signal?: AbortSignal) => cityForecast)

    await ensureFresh(deps({ weather }), plan({ summit: { skip: { status: 'notApplicable', reason: 'noTerrain' } } }))

    expect(weather.mock.calls[0]?.[1]).toBeInstanceOf(AbortSignal)
  })

  it('produces exactly one upstream fetch for two concurrent cold callers', async () => {
    // The done-condition of this slice.
    const weather = vi.fn(async () => cityForecast)
    const shared = { weather, sleep: () => new Promise<void>((resolve) => setTimeout(resolve, 0)) }

    const [first, second] = await Promise.all([
      ensureFresh(deps({ ...shared, instanceId: 'instance-a' }), plan({ summit: { skip: { status: 'notApplicable', reason: 'noTerrain' } } })),
      ensureFresh(deps({ ...shared, instanceId: 'instance-b' }), plan({ summit: { skip: { status: 'notApplicable', reason: 'noTerrain' } } })),
    ])

    expect(weather).toHaveBeenCalledTimes(1)
    expect(await db.collection('forecasts').countDocuments({ locationId: LOCATION })).toBe(1)
    expect([first.status, second.status]).toEqual(['fresh', 'fresh'])
  })

  it('returns stale data at once rather than queueing behind another refresh', async () => {
    // Someone else is already fetching, and a slightly old answer beats a slow
    // one. This branch does not wait and does not fetch.
    await forecastRepository(db).insert(storedIssuance(at('2026-07-30T10:00:00Z')))
    await leaseRepository(db).acquire(leaseKeyFor(LOCATION), 'instance-b', noon)
    const weather = vi.fn(async () => cityForecast)
    const sleep = vi.fn(async () => undefined)

    const result = await ensureFresh(deps({ weather, sleep }), plan())

    expect(result.status).toBe('stale')
    expect(weather).not.toHaveBeenCalled()
    expect(sleep).not.toHaveBeenCalled()
  })

  it('serves the stale issuance with the upstream error named when the fetch fails', async () => {
    // stale-if-error: an upstream outage degrades the answer instead of
    // removing it.
    await forecastRepository(db).insert(storedIssuance(at('2026-07-30T10:00:00Z')))
    const weather = vi.fn(async () => {
      throw new Error('Open-Meteo answered 503')
    })

    const result = await ensureFresh(deps({ weather }), plan())

    expect(result.status).toBe('stale')
    expect(result.status === 'stale' && result.reason).toContain('503')
    expect(result.status === 'stale' && result.issuance.issuedAt).toEqual(at('2026-07-30T10:00:00Z'))
  })

  it('releases the lease after a failed fetch, so the next caller may try', async () => {
    // A failure that keeps the lease blocks every refresh for 30 seconds.
    await forecastRepository(db).insert(storedIssuance(at('2026-07-30T10:00:00Z')))
    const weather = async () => {
      throw new Error('Open-Meteo answered 503')
    }

    await ensureFresh(deps({ weather }), plan())

    expect(await leaseRepository(db).acquire(leaseKeyFor(LOCATION), 'instance-b', noon)).toBe(true)
  })

  it('releases the lease after a successful fetch', async () => {
    await ensureFresh(deps(), plan({ summit: { skip: { status: 'notApplicable', reason: 'noTerrain' } } }))

    expect(await leaseRepository(db).acquire(leaseKeyFor(LOCATION), 'instance-b', noon)).toBe(true)
  })

  it('refuses with a named state rather than a 500 when there is nothing at all', async () => {
    // Cold start, lease won, upstream down. Refusing with a name beats
    // inventing an answer — the one place the service does not answer.
    const weather = async () => {
      throw new Error('Open-Meteo answered 503')
    }

    const result = await ensureFresh(deps({ weather }), plan())

    expect(result.status).toBe('noDataYet')
    expect(result.status === 'noDataYet' && result.reason).toContain('503')
  })

  it('waits out the winner on a cold start and returns what the winner wrote', async () => {
    await leaseRepository(db).acquire(leaseKeyFor(LOCATION), 'instance-b', noon)
    const repo = forecastRepository(db)
    let polls = 0
    const sleep = async () => {
      polls += 1
      if (polls === 3) await repo.insert(storedIssuance(noon))
    }

    const result = await ensureFresh(deps({ sleep }), plan())

    expect(result.status).toBe('fresh')
    expect(polls).toBe(3)
  })

  it('gives up the cold-start wait after a bounded number of polls', async () => {
    // Bounded, because an unbounded wait turns one slow location into a stuck
    // request queue.
    await leaseRepository(db).acquire(leaseKeyFor(LOCATION), 'instance-b', noon)
    const sleep = vi.fn(async () => undefined)

    const result = await ensureFresh(deps({ sleep }), plan())

    expect(result.status).toBe('noDataYet')
    expect(sleep).toHaveBeenCalledTimes(COLD_START_POLLS)
    expect(COLD_START_POLLS).toBe(100)
  })
})
