import { describe, expect, inject, it } from 'vitest'
import { databaseNameFor } from '../testing/database.ts'
import { connectDatabase } from './client.ts'

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
