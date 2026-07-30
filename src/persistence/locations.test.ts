import type { Db } from 'mongodb'
import { MongoClient } from 'mongodb'
import { MongoMemoryServer } from 'mongodb-memory-server'
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import type { GeocodedLocation } from '../providers/openmeteo/geocoding.ts'
import { ensureLocation, locationRepository } from './locations.ts'

/**
 * Against a real mongod, started by the test rather than by docker-compose.
 * Nothing here is a fake: the driver, the indexes and the queries are the ones
 * production runs. What the test owns is the server's lifetime, so `pnpm test`
 * needs no running service and neither does CI.
 */
let mongod: MongoMemoryServer
let client: MongoClient
let db: Db

beforeAll(async () => {
  mongod = await MongoMemoryServer.create()
  client = new MongoClient(mongod.getUri())
  await client.connect()
  db = client.db('test')
}, 120_000)

afterAll(async () => {
  await client.close()
  await mongod.stop()
})

beforeEach(async () => {
  await db.collection('locations').deleteMany({})
})

const grenoble: GeocodedLocation = {
  geonameId: 3014728,
  name: 'Grenoble',
  country: 'France',
  countryCode: 'FR',
  admin1: 'Auvergne-Rhône-Alpes',
  latitude: 45.1885,
  longitude: 5.7245,
  elevation: 214,
  timezone: 'Europe/Paris',
  population: 158552,
}

const terrain = {
  gridVersion: 'circ-50km-11x11',
  maxElevation: 3204,
  point: { latitude: 45.0088, longitude: 6.2343 },
  distanceKm: 44.7,
}

const at = (iso: string) => new Date(iso)

describe('locationRepository', () => {
  it('pins the document to the GeoNames id, not to the query that found it', async () => {
    // Upstream relevance ranking can reorder five Cambridges between calls. The
    // id cannot, which is why it is the _id.
    const repo = locationRepository(db)
    await repo.upsert(grenoble, at('2026-07-30T10:00:00Z'))

    const stored = await repo.findById('geoname:3014728')
    expect(stored?._id).toBe('geoname:3014728')
    expect(stored?.name).toBe('Grenoble')
    expect(stored?.coords).toEqual({ lat: 45.1885, lon: 5.7245 })
  })

  it('leaves geography unset until it is sampled', async () => {
    // "Not assessed" and "no mountain here" are different claims and the domain
    // keeps them apart, so the document has to be able to say the first one.
    const repo = locationRepository(db)
    await repo.upsert(grenoble, at('2026-07-30T10:00:00Z'))

    const stored = await repo.findById('geoname:3014728')
    // Asserted present first: `stored?.terrain` is undefined on a missing
    // document too, and that would pass without storing anything.
    expect(stored).not.toBeNull()
    expect(stored?.terrain).toBeUndefined()
    expect(stored?.marineCoverage).toBeUndefined()
  })

  it('does not overwrite sampled geography when the location is seen again', async () => {
    // The whole point of the collection: an 81-coordinate grid is paid once per
    // city, ever. A second upsert must not quietly clear it.
    const repo = locationRepository(db)
    await repo.upsert(grenoble, at('2026-07-30T10:00:00Z'))
    await repo.saveTerrain('geoname:3014728', terrain, at('2026-07-30T10:00:01Z'))
    await repo.saveMarineCoverage('geoname:3014728', 'none')

    await repo.upsert(grenoble, at('2026-07-31T09:00:00Z'))

    const stored = await repo.findById('geoname:3014728')
    expect(stored?.terrain?.maxElevation).toBe(3204)
    expect(stored?.marineCoverage).toBe('none')
  })

  it('moves lastRequestedAt forward on every request, because the refresher reads it', async () => {
    const repo = locationRepository(db)
    await repo.upsert(grenoble, at('2026-07-30T10:00:00Z'))
    await repo.upsert(grenoble, at('2026-07-31T09:00:00Z'))

    const stored = await repo.findById('geoname:3014728')
    expect(stored?.lastRequestedAt).toEqual(at('2026-07-31T09:00:00Z'))
  })

  it('indexes lastRequestedAt descending, which is the refresher’s only query', async () => {
    const repo = locationRepository(db)
    await repo.ensureIndexes()

    const indexes = await db.collection('locations').indexes()
    expect(indexes.map((index) => index.key)).toContainEqual({ lastRequestedAt: -1 })
  })

  it('creates its indexes idempotently, so startup can just call it', async () => {
    const repo = locationRepository(db)
    await repo.ensureIndexes()
    await expect(repo.ensureIndexes()).resolves.not.toThrow()
  })
})

describe('ensureLocation', () => {
  const samplers = () => {
    const calls = { terrain: 0, marine: 0 }
    return {
      calls,
      sampleTerrain: async () => {
        calls.terrain += 1
        return terrain
      },
      sampleMarineCoverage: async () => {
        calls.marine += 1
        return 'none' as const
      },
    }
  }

  it('samples a cold location once and returns it with its geography', async () => {
    const repo = locationRepository(db)
    const { calls, ...providers } = samplers()

    const location = await ensureLocation(repo, providers, grenoble, at('2026-07-30T10:00:00Z'))

    expect(location.terrain?.maxElevation).toBe(3204)
    expect(location.marineCoverage).toBe('none')
    expect(calls).toEqual({ terrain: 1, marine: 1 })
  })

  it('performs no sampling at all the second time, which is what pays for the grid', async () => {
    // 81 coordinates metered per coordinate caps the service at ~123 cold
    // cities a day. This assertion is the reason the collection exists.
    const repo = locationRepository(db)
    const { calls, ...providers } = samplers()

    await ensureLocation(repo, providers, grenoble, at('2026-07-30T10:00:00Z'))
    await ensureLocation(repo, providers, grenoble, at('2026-07-30T10:05:00Z'))

    expect(calls).toEqual({ terrain: 1, marine: 1 })
  })

  it('still records the request on a warm hit', async () => {
    const repo = locationRepository(db)
    const { ...providers } = samplers()

    await ensureLocation(repo, providers, grenoble, at('2026-07-30T10:00:00Z'))
    const warm = await ensureLocation(repo, providers, grenoble, at('2026-08-01T08:00:00Z'))

    expect(warm.lastRequestedAt).toEqual(at('2026-08-01T08:00:00Z'))
  })

  it('records the sampling time separately from the request time', async () => {
    // gridVersion says which parameters were used; sampledAt says when. An
    // unversioned change to either would alter historical answers with no trace.
    const repo = locationRepository(db)
    const { ...providers } = samplers()

    const location = await ensureLocation(repo, providers, grenoble, at('2026-07-30T10:00:00Z'))

    expect(location.terrain?.sampledAt).toEqual(at('2026-07-30T10:00:00Z'))
    expect(location.terrain?.gridVersion).toBe('circ-50km-11x11')
  })

  it('leaves the location usable when sampling fails, rather than losing the city', async () => {
    // A geography failure must not cost the caller their forecast. Skiing and
    // surfing stay unavailable and everything else still answers.
    const repo = locationRepository(db)
    const failing = {
      sampleTerrain: async () => {
        throw new Error('elevation upstream is down')
      },
      sampleMarineCoverage: async () => 'none' as const,
    }

    const location = await ensureLocation(repo, failing, grenoble, at('2026-07-30T10:00:00Z'))

    expect(location.terrain).toBeUndefined()
    expect(location.name).toBe('Grenoble')
  })

  it('keeps the expensive terrain sample when the cheap marine call fails', async () => {
    // The two are not one transaction. Terrain is 81 metered coordinates and
    // marine is one request, so discarding a successful grid because the cheap
    // call failed would re-spend the most expensive thing the service does.
    const repo = locationRepository(db)
    const { calls, ...providers } = samplers()
    const marineDown = {
      sampleTerrain: providers.sampleTerrain,
      sampleMarineCoverage: async (): Promise<'present' | 'none'> => {
        throw new Error('marine upstream is down')
      },
    }

    const first = await ensureLocation(repo, marineDown, grenoble, at('2026-07-30T10:00:00Z'))
    expect(first.terrain?.maxElevation).toBe(3204)
    expect(first.marineCoverage).toBeUndefined()

    // ...and the marine question is still open, so it is asked again, while the
    // grid is not.
    const second = await ensureLocation(repo, providers, grenoble, at('2026-07-30T10:05:00Z'))
    expect(second.marineCoverage).toBe('none')
    expect(calls).toEqual({ terrain: 1, marine: 1 })
  })

  it('retries sampling on the next request after a failure', async () => {
    // The alternative is a city permanently marked as having no terrain because
    // one call failed once, and a false notApplicable is permanent.
    const repo = locationRepository(db)
    const { calls, ...providers } = samplers()
    const failing = {
      sampleTerrain: async () => {
        throw new Error('elevation upstream is down')
      },
      sampleMarineCoverage: providers.sampleMarineCoverage,
    }

    await ensureLocation(repo, failing, grenoble, at('2026-07-30T10:00:00Z'))
    const second = await ensureLocation(repo, providers, grenoble, at('2026-07-30T10:05:00Z'))

    expect(second.terrain?.maxElevation).toBe(3204)
    expect(calls.terrain).toBe(1)
  })
})
