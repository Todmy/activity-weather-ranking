import type { MongoClient } from 'mongodb'
import { describe, expect, inject, it } from 'vitest'
import { UPSTREAM_TIMEOUT_MS } from '../providers/openmeteo/forecast.ts'
import { databaseNameFor } from '../testing/database.ts'
import { MONGO_CALLS_INSIDE_LEASE, MONGO_TIMEOUT_MS, connectDatabase } from './client.ts'
import { LEASE_TTL_MS } from './leases.ts'

/**
 * This suite is about `connectDatabase` itself, so it takes the shared server's
 * URI rather than a ready-made handle. The database names are scoped to this
 * file for the same reason every other suite's is: one mongod now serves the
 * whole run.
 */
const uri = inject('mongoUri')
const scope = databaseNameFor(import.meta.url)

describe('connectDatabase', () => {
  it('connects, names the database from config, and closes cleanly', async () => {
    const store = await connectDatabase({ uri, database: `${scope}_named` })

    expect(store.db.databaseName).toBe(`${scope}_named`)
    await expect(store.close()).resolves.not.toThrow()
  })

  // Recon risk 8 says "lease TTL must exceed the hard request timeout" and
  // reasons only about the upstream call, silently assuming everything else
  // inside the lease is free. It is not. serverSelectionTimeoutMS bounds
  // finding a server and nothing after that: with no timeoutMS the driver runs
  // in legacy mode, where socket reads have no deadline and no maxTimeMS
  // reaches the wire. A mongod answering heartbeats but slow on one command —
  // or a pool checkout stalled under load, waitQueueTimeoutMS defaulting to 0 —
  // held the lease open past its own TTL, a second caller acquired it, and two
  // upstream fetches ran for one location. That is FR6 verbatim.
  //
  // Reproduced against a real mongod with a failCommand fail point blocking
  // insert for 35 s: two issuances written, one location.
  //
  // The numbers may move. The order may not, which is why this is a test.
  it('bounds the whole lease block inside the lease, not only its upstream call', async () => {
    const store = await connectDatabase({ uri, database: `${scope}_bounded` })
    const client = (store.db as unknown as { client: MongoClient }).client

    // The driver's own default is no operation deadline at all, so this asks
    // first whether there is one before asking whether it is the right size.
    expect(client.options.timeoutMS).toEqual(expect.any(Number))
    expect(client.options.timeoutMS).toBe(MONGO_TIMEOUT_MS)

    // One re-read, one insert, and the two the prune costs. The release runs
    // after the issuance is durable, so a second acquirer past this point finds
    // fresh data on its own re-read and never fetches.
    const worstCaseInsideLease =
      UPSTREAM_TIMEOUT_MS + MONGO_CALLS_INSIDE_LEASE * MONGO_TIMEOUT_MS

    expect(worstCaseInsideLease).toBeLessThan(LEASE_TTL_MS)

    await store.close()
  })

  it('creates the indexes the collections need, so startup never runs unindexed', async () => {
    const store = await connectDatabase({ uri, database: `${scope}_indexed` })

    const keysOf = async (collection: string) =>
      (await store.db.collection(collection).indexes()).map((index) => index.key)

    expect(await keysOf('locations')).toContainEqual({ lastRequestedAt: -1 })
    // The gateway's read is `locationId` equality plus a descending sort, and
    // both collections expire documents they no longer need.
    expect(await keysOf('forecasts')).toContainEqual({ locationId: 1, issuedAt: -1 })
    expect(await keysOf('forecasts')).toContainEqual({ expiresAt: 1 })
    expect(await keysOf('leases')).toContainEqual({ expiresAt: 1 })
    await store.close()
  })

  it('fails fast on an unreachable server rather than at the first query', async () => {
    // A service that starts happily and then answers every request with a
    // database error is worse than one that refuses to start.
    await expect(
      connectDatabase({
        uri: 'mongodb://127.0.0.1:1/',
        database: 'nope',
        serverSelectionTimeoutMS: 300,
      }),
    ).rejects.toThrow()
  }, 20_000)
})
