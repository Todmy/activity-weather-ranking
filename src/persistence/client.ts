import type { Db } from 'mongodb'
import { MongoClient } from 'mongodb'
import { locationRepository } from './locations.ts'

export type Store = { db: Db; close: () => Promise<void> }

/**
 * One connection for the process, opened before the socket is bound.
 *
 * Deliberately fails fast. A service that starts happily and then answers every
 * request with a database error is worse than one that refuses to start: the
 * first looks healthy to a load balancer and the second does not.
 *
 * Indexes are created here rather than by a migration step, because they are
 * idempotent and there is no schema to migrate — Mongo will happily serve an
 * unindexed collection, and the only symptom is a query that gets slower as the
 * data grows.
 */
export const connectDatabase = async ({
  uri,
  database,
  serverSelectionTimeoutMS = 5_000,
}: {
  uri: string
  database: string
  serverSelectionTimeoutMS?: number
}): Promise<Store> => {
  const client = new MongoClient(uri, { serverSelectionTimeoutMS })

  try {
    await client.connect()
    const db = client.db(database)
    // Proves the server is actually there. `connect()` alone can resolve
    // against a driver that has not reached a node yet.
    await db.command({ ping: 1 })
    await locationRepository(db).ensureIndexes()
    return { db, close: () => client.close() }
  } catch (error) {
    await client.close().catch(() => undefined)
    throw error
  }
}
