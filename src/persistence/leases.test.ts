import type { Db } from 'mongodb'
import { MongoClient } from 'mongodb'
import { MongoMemoryServer } from 'mongodb-memory-server'
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import type { LeaseDocument } from './leases.ts'
import { LEASE_TTL_MS, leaseKeyFor, leaseRepository } from './leases.ts'

/**
 * The single-flight mechanism, tested against a real mongod because the whole
 * mechanism *is* one atomic `findOneAndUpdate`. A fake would test the fake.
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
  await db.collection('leases').drop().catch(() => undefined)
})

const key = leaseKeyFor('geoname:3014728')
const at = (iso: string) => new Date(iso)
const noon = at('2026-07-30T12:00:00Z')

describe('leaseRepository', () => {
  it('grants a lease nobody holds', async () => {
    expect(await leaseRepository(db).acquire(key, 'instance-a', noon)).toBe(true)
  })

  it('refuses a lease someone else already holds', async () => {
    // This is the "lease lost" branch of the read path, not an error.
    const repo = leaseRepository(db)
    await repo.acquire(key, 'instance-a', noon)

    expect(await repo.acquire(key, 'instance-b', at('2026-07-30T12:00:10Z'))).toBe(false)
  })

  it('grants a lease that has expired, without waiting for Mongo to delete it', async () => {
    // The trap this test exists for: Mongo's TTL monitor runs roughly every 60 s,
    // so an expired lease document can outlive its own expiry by a minute. The
    // filter tests `expiresAt < now` itself and never relies on the deletion.
    const repo = leaseRepository(db)
    await repo.acquire(key, 'instance-a', noon)

    const afterExpiry = new Date(noon.getTime() + LEASE_TTL_MS + 1)
    expect(await repo.acquire(key, 'instance-b', afterExpiry)).toBe(true)
    // Still there — nothing deleted it, and the lease was granted anyway.
    expect(await db.collection<LeaseDocument>('leases').countDocuments({ _id: key })).toBe(1)
  })

  it('holds for 30 seconds, comfortably longer than the 8-second fetch it guards', async () => {
    // Risk 8 in recon.md is a lease shorter than the fetch it guards, which
    // silently admits a second fetcher. The margin is deliberate, not round.
    const repo = leaseRepository(db)
    await repo.acquire(key, 'instance-a', noon)

    const stored = await db.collection<LeaseDocument>('leases').findOne({ _id: key })

    expect(LEASE_TTL_MS).toBe(30_000)
    expect(stored!.expiresAt.getTime() - noon.getTime()).toBe(LEASE_TTL_MS)
    expect(stored?.holder).toBe('instance-a')
  })

  it('lets the next caller in once the holder releases', async () => {
    const repo = leaseRepository(db)
    await repo.acquire(key, 'instance-a', noon)
    await repo.release(key, 'instance-a')

    expect(await repo.acquire(key, 'instance-b', at('2026-07-30T12:00:01Z'))).toBe(true)
  })

  it('ignores a release from an instance that no longer holds the lease', async () => {
    // A fetch that overran its lease must not free the lease its successor now
    // holds, or two fetchers run with one lease between them.
    const repo = leaseRepository(db)
    await repo.acquire(key, 'instance-a', noon)
    await repo.acquire(key, 'instance-b', new Date(noon.getTime() + LEASE_TTL_MS + 1))

    await repo.release(key, 'instance-a')

    expect(await db.collection<LeaseDocument>('leases').countDocuments({ _id: key })).toBe(1)
  })

  it('admits exactly one of five callers racing for the same lease', async () => {
    // The done-condition of this slice, at the level where it is actually
    // decided: everything above it only has to trust this answer.
    const repo = leaseRepository(db)

    const results = await Promise.all(
      ['a', 'b', 'c', 'd', 'e'].map((instance) => repo.acquire(key, instance, noon)),
    )

    expect(results.filter(Boolean)).toHaveLength(1)
  })

  it('indexes expiresAt for housekeeping, and can be called twice', async () => {
    const repo = leaseRepository(db)
    await repo.ensureIndexes()
    await repo.ensureIndexes()

    const indexes = await db.collection('leases').indexes()

    expect(indexes.find((index) => 'expiresAt' in index.key)?.expireAfterSeconds).toBe(0)
  })
})
