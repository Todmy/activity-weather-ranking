import type { Db } from 'mongodb'
import { MongoClient } from 'mongodb'
import { MongoMemoryServer } from 'mongodb-memory-server'
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import type { GeocodedLocation } from '../providers/openmeteo/geocoding.ts'
import { locationRepository } from './locations.ts'
import { normaliseQuery, resolutionRepository, resolveLocation } from './resolutions.ts'

/**
 * The pin, tested against a real mongod because first-writer-wins is a
 * `$setOnInsert`, and "the second write does nothing" is exactly the behaviour
 * a fake would get wrong.
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
  await db.collection('resolutions').drop().catch(() => undefined)
  await db.collection('locations').drop().catch(() => undefined)
})

const at = (iso: string) => new Date(iso)
const noon = at('2026-07-30T12:00:00Z')

const cambridgeUK: GeocodedLocation = {
  geonameId: 2653941,
  name: 'Cambridge',
  country: 'United Kingdom',
  countryCode: 'GB',
  admin1: 'England',
  latitude: 52.2,
  longitude: 0.11667,
  elevation: 12,
  timezone: 'Europe/London',
  population: 158434,
}

const cambridgeMA: GeocodedLocation = {
  ...cambridgeUK,
  geonameId: 4931972,
  country: 'United States',
  countryCode: 'US',
  admin1: 'Massachusetts',
  latitude: 42.3751,
  longitude: -71.10561,
  timezone: 'America/New_York',
  population: 118403,
}

const repos = () => ({ resolutions: resolutionRepository(db), locations: locationRepository(db) })
const searching = (...found: GeocodedLocation[]) => async () => found

describe('normaliseQuery', () => {
  it('folds case and surrounding space, so one city is not two pins', async () => {
    expect(normaliseQuery('  CAMBRIDGE ')).toBe('cambridge')
  })

  it('collapses inner whitespace, because "new  york" is not a second city', async () => {
    expect(normaliseQuery('New   York')).toBe('new york')
  })
})

describe('resolveLocation', () => {
  it('takes upstream at its word the first time, and records what it took', async () => {
    const { resolutions, locations } = repos()

    const resolved = await resolveLocation(
      { resolutions, locations },
      searching(cambridgeUK, cambridgeMA),
      'Cambridge',
      noon,
    )

    expect(resolved?.location.geonameId).toBe(2653941)
    expect(await resolutions.findByQuery('cambridge')).toMatchObject({
      locationId: 'geoname:2653941',
      resolvedAt: noon,
    })
  })

  it('answers with the pinned city after upstream reorders its candidates', async () => {
    // Risk 10 in recon.md, and the whole of its mitigation: relevance ranking
    // is upstream's to change, and it must not silently change our answer.
    const { resolutions, locations } = repos()
    await resolveLocation({ resolutions, locations }, searching(cambridgeUK, cambridgeMA), 'Cambridge', noon)

    const later = await resolveLocation(
      { resolutions, locations },
      searching(cambridgeMA, cambridgeUK),
      'Cambridge',
      at('2026-07-31T12:00:00Z'),
    )

    expect(later?.location.geonameId).toBe(2653941)
    expect(later?.alternatives.map((option) => option.geonameId)).toEqual([4931972])
  })

  it('never moves a pin once it exists, whatever the second call resolves to', async () => {
    const { resolutions, locations } = repos()
    await resolveLocation({ resolutions, locations }, searching(cambridgeUK), 'Cambridge', noon)

    await resolveLocation(
      { resolutions, locations },
      searching(cambridgeMA),
      'Cambridge',
      at('2026-07-31T12:00:00Z'),
    )

    expect(await resolutions.findByQuery('cambridge')).toMatchObject({
      locationId: 'geoname:2653941',
      resolvedAt: noon,
    })
  })

  it('holds the pin even when the city drops out of the candidates entirely', async () => {
    // The case the pin exists for is precisely the one where upstream stops
    // returning it, so the stored location is the fallback rather than the
    // candidate list.
    const { resolutions, locations } = repos()
    await locations.upsert(cambridgeUK, noon)
    await resolutions.pin('cambridge', 'geoname:2653941', noon)

    const resolved = await resolveLocation(
      { resolutions, locations },
      searching(cambridgeMA),
      'Cambridge',
      at('2026-07-31T12:00:00Z'),
    )

    expect(resolved?.location.geonameId).toBe(2653941)
    expect(resolved?.location.timezone).toBe('Europe/London')
    expect(resolved?.alternatives.map((option) => option.geonameId)).toEqual([4931972])
  })

  it('falls back to upstream when a pin points at a location never stored', async () => {
    // One process crash between the pin and the location write leaves a pin to
    // a document that does not exist. Answering is better than failing, and the
    // pin is left alone rather than rewritten to hide the gap.
    const { resolutions, locations } = repos()
    await resolutions.pin('cambridge', 'geoname:2653941', noon)

    const resolved = await resolveLocation(
      { resolutions, locations },
      searching(cambridgeMA),
      'Cambridge',
      at('2026-07-31T12:00:00Z'),
    )

    expect(resolved?.location.geonameId).toBe(4931972)
    expect(await resolutions.findByQuery('cambridge')).toMatchObject({
      locationId: 'geoname:2653941',
    })
  })

  it('returns null when upstream matched nothing at all', async () => {
    const { resolutions, locations } = repos()

    expect(
      await resolveLocation({ resolutions, locations }, searching(), 'Nowhereinparticular', noon),
    ).toBeNull()
  })
})
