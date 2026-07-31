import type { Db } from 'mongodb'
import { MongoClient } from 'mongodb'
import { forecastRepository } from './forecasts.ts'
import { leaseRepository } from './leases.ts'
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
/**
 * A deadline on the operation, not only on finding a server.
 *
 * `serverSelectionTimeoutMS` bounds `selectServer` and nothing after it. With
 * no `timeoutMS` the driver runs in legacy timeout mode: no socket read
 * deadline, no `maxTimeMS` on the wire, `socketTimeoutMS` and
 * `waitQueueTimeoutMS` both defaulting to 0. A mongod that answers heartbeats
 * but is slow on one command — or a pool checkout stalled under load — blocks
 * its caller indefinitely.
 *
 * Inside the refresh lease that meant the holder could outlive its own thirty
 * seconds, a second caller could acquire, and two upstream fetches ran for one
 * location: FR6, and the failure the lease exists to prevent. Recon risk 8
 * bounded the upstream call and assumed the database calls around it were free.
 *
 * Five seconds rather than ten, so the margin is provable in one line — see
 * the ordering test in `client.test.ts`. It is client-wide, so `ensureIndexes`
 * at startup is governed too, and a cold index build on a slow box now fails
 * startup instead of hanging it. That is what this file already asks for.
 */
export const MONGO_TIMEOUT_MS = 5_000

/**
 * Calls between acquiring the lease and the issuance being durable: the re-read
 * after acquire, the insert, and the find and delete the prune costs. The
 * release runs after, so a caller acquiring past this point finds fresh data on
 * its own re-read and never fetches.
 */
export const MONGO_CALLS_INSIDE_LEASE = 4

export const connectDatabase = async ({
  uri,
  database,
  serverSelectionTimeoutMS = 5_000,
  timeoutMS = MONGO_TIMEOUT_MS,
}: {
  uri: string
  database: string
  serverSelectionTimeoutMS?: number
  timeoutMS?: number
}): Promise<Store> => {
  const client = new MongoClient(uri, { serverSelectionTimeoutMS, timeoutMS })

  try {
    await client.connect()
    const db = client.db(database)
    // Proves the server is actually there. `connect()` alone can resolve
    // against a driver that has not reached a node yet.
    await db.command({ ping: 1 })
    await Promise.all([
      locationRepository(db).ensureIndexes(),
      forecastRepository(db).ensureIndexes(),
      leaseRepository(db).ensureIndexes(),
    ])
    return { db, close: () => client.close() }
  } catch (error) {
    await client.close().catch(() => undefined)
    throw error
  }
}
