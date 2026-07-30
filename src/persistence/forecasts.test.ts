import type { Db } from 'mongodb'
import { MongoClient } from 'mongodb'
import { MongoMemoryServer } from 'mongodb-memory-server'
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import {
  EXPIRY_DAYS,
  KEEP_ISSUANCES,
  forecastRepository,
  type NewIssuance,
} from './forecasts.ts'

/**
 * Against a real mongod, for the same reason `locations.test.ts` uses one: the
 * sort order, the index and the delete are the behaviour under test, and a fake
 * repository would only assert that the fake behaves like the fake.
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
  await db.collection('forecasts').drop().catch(() => undefined)
})

const at = (iso: string) => new Date(iso)

/** Hourly from 2026-07-30T00:00Z, by arithmetic rather than by string, so that
 *  the twenty-fifth issuance is a real instant and not `T24:00:00Z`. */
const hourly = (index: number) =>
  new Date(Date.UTC(2026, 6, 30) + index * 60 * 60 * 1000).toISOString()

const issuance = (locationId: string, issuedAt: string): NewIssuance => ({
  locationId,
  issuedAt: at(issuedAt),
  modelRun: null,
  city: {
    status: 'ok',
    elevation: 214,
    days: [{ date: '2026-07-30', temperatureMax: 28.4, snowfallSum: 0 }],
  },
  summit: { status: 'notApplicable', reason: 'noTerrain' },
  marine: { status: 'unavailable', reason: 'Open-Meteo answered 503' },
})

describe('forecastRepository', () => {
  it('reads back the three series and their statuses, not just the city one', async () => {
    // The issuance is the unit of consistency (design.md §2). If the summit's
    // "why not" is lost on the way to storage, a later reader cannot tell
    // "no mountain here" from "we never looked".
    const repo = forecastRepository(db)
    await repo.insert(issuance('geoname:3014728', '2026-07-30T09:00:00Z'))

    const stored = await repo.newestFor('geoname:3014728')

    expect(stored?.city.status).toBe('ok')
    expect(stored?.city.elevation).toBe(214)
    expect(stored?.city.days).toHaveLength(1)
    expect(stored?.summit).toEqual({ status: 'notApplicable', reason: 'noTerrain' })
    expect(stored?.marine.status).toBe('unavailable')
    expect(stored?.marine.reason).toBe('Open-Meteo answered 503')
  })

  it('returns null for a location nothing has ever been stored for', async () => {
    // The cold-start branch of the gateway keys off this exact answer, so it is
    // null rather than a throw.
    expect(await forecastRepository(db).newestFor('geoname:99')).toBeNull()
  })

  it('returns the newest issuance, not the one written first', async () => {
    const repo = forecastRepository(db)
    await repo.insert(issuance('geoname:3014728', '2026-07-30T09:00:00Z'))
    await repo.insert(issuance('geoname:3014728', '2026-07-30T11:00:00Z'))
    await repo.insert(issuance('geoname:3014728', '2026-07-30T10:00:00Z'))

    expect((await repo.newestFor('geoname:3014728'))?.issuedAt).toEqual(
      at('2026-07-30T11:00:00Z'),
    )
  })

  it('sets expiresAt 30 days past the issuance, as a backstop and not as the policy', async () => {
    // Retention is the application's job (design.md §2). This date only ever
    // fires for a location nobody asks about any more.
    const stored = await forecastRepository(db).insert(
      issuance('geoname:3014728', '2026-07-30T09:00:00Z'),
    )

    expect(EXPIRY_DAYS).toBe(30)
    expect(stored.expiresAt.getTime() - stored.issuedAt.getTime()).toBe(
      EXPIRY_DAYS * 24 * 60 * 60 * 1000,
    )
  })

  it('keeps the newest 24 issuances and prunes what falls past them', async () => {
    // A TTL index cannot express "keep at least one", so it cannot be the
    // retention policy either — risk 7 in recon.md.
    const repo = forecastRepository(db)
    for (let hour = 0; hour < KEEP_ISSUANCES + 6; hour += 1) {
      await repo.insert(issuance('geoname:3014728', hourly(hour)))
    }

    const kept = await db
      .collection('forecasts')
      .find({ locationId: 'geoname:3014728' })
      .sort({ issuedAt: 1 })
      .toArray()

    expect(KEEP_ISSUANCES).toBe(24)
    expect(kept).toHaveLength(KEEP_ISSUANCES)
    // The six oldest went, not six arbitrary ones.
    expect(kept[0]?.issuedAt).toEqual(at(hourly(6)))
  })

  it('prunes one location without touching another', async () => {
    const repo = forecastRepository(db)
    await repo.insert(issuance('geoname:2759794', '2026-07-30T00:00:00Z'))
    for (let hour = 0; hour < KEEP_ISSUANCES + 3; hour += 1) {
      await repo.insert(issuance('geoname:3014728', hourly(hour)))
    }

    expect(
      await db.collection('forecasts').countDocuments({ locationId: 'geoname:2759794' }),
    ).toBe(1)
  })

  it('indexes the read the gateway actually performs, and can be called twice', async () => {
    // newestFor is `locationId` equality plus a descending sort on issuedAt.
    const repo = forecastRepository(db)
    await repo.ensureIndexes()
    await repo.ensureIndexes()

    const indexes = await db.collection('forecasts').indexes()
    const keys = indexes.map((index) => JSON.stringify(index.key))

    expect(keys).toContain(JSON.stringify({ locationId: 1, issuedAt: -1 }))
    expect(indexes.find((index) => 'expiresAt' in index.key)?.expireAfterSeconds).toBe(0)
  })
})
