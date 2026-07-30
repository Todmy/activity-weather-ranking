import { MongoMemoryServer } from 'mongodb-memory-server'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { connectDatabase } from './client.ts'

let mongod: MongoMemoryServer

beforeAll(async () => {
  mongod = await MongoMemoryServer.create()
}, 120_000)

afterAll(async () => {
  await mongod.stop()
})

describe('connectDatabase', () => {
  it('connects, names the database from config, and closes cleanly', async () => {
    const store = await connectDatabase({ uri: mongod.getUri(), database: 'activity_weather' })

    expect(store.db.databaseName).toBe('activity_weather')
    await expect(store.close()).resolves.not.toThrow()
  })

  it('creates the indexes the collections need, so startup never runs unindexed', async () => {
    const store = await connectDatabase({ uri: mongod.getUri(), database: 'indexed' })

    const indexes = await store.db.collection('locations').indexes()
    expect(indexes.map((index) => index.key)).toContainEqual({ lastRequestedAt: -1 })
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
