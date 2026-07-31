import { randomUUID } from 'node:crypto'
import type { Collection, Db } from 'mongodb'

/**
 * The single-flight lease: one upstream fetch per location, however many
 * callers arrive at once.
 *
 * The whole mechanism is one atomic `findOneAndUpdate` with an upsert. If the
 * document exists and has not expired, the filter misses, the upsert tries to
 * insert, and the unique `_id` rejects it. That duplicate-key error IS the
 * "someone else is fetching" answer — not an error to log loudly.
 *
 * See design.md §3.
 */
const COLLECTION = 'leases'

/**
 * Thirty seconds against a hard 8-second cap on the upstream call. Risk 8 in
 * recon.md is a lease shorter than the fetch it guards, which silently admits a
 * second fetcher; the margin is deliberate rather than round.
 */
export const LEASE_TTL_MS = 30_000

const DUPLICATE_KEY = 11000

export type LeaseDocument = {
  _id: string
  /** Which process holds it. For reading the collection, not for releasing. */
  holder: string
  /**
   * Which *acquisition* holds it, fresh on every grant.
   *
   * The holder cannot do this job. `instanceId` is one uuid per process, so a
   * request that overran its lease and the request that took the lease from it
   * are the same holder, and a delete scoped to the holder frees the successor.
   */
  token: string
  acquiredAt: Date
  expiresAt: Date
}

export const leaseKeyFor = (locationId: string): string => `refresh:${locationId}`

export type LeaseRepository = ReturnType<typeof leaseRepository>

export const leaseRepository = (db: Db) => {
  const leases = db.collection(COLLECTION) as unknown as Collection<LeaseDocument>

  return {
    /** Idempotent, so startup can call it unconditionally. */
    ensureIndexes: async (): Promise<void> => {
      // Housekeeping only. Mongo's TTL monitor runs roughly every 60 s, so an
      // expired lease can outlive its expiry by a minute — which is why
      // `acquire` tests the expiry itself and never trusts this deletion.
      await leases.createIndex({ expiresAt: 1 }, { expireAfterSeconds: 0 })
    },

    /** The token on success, which `release` needs. Null means someone else has it. */
    acquire: async (key: string, holder: string, now: Date): Promise<string | null> => {
      const token = randomUUID()

      try {
        await leases.updateOne(
          { _id: key, expiresAt: { $lt: now } },
          {
            $set: {
              holder,
              token,
              acquiredAt: now,
              expiresAt: new Date(now.getTime() + LEASE_TTL_MS),
            },
          },
          { upsert: true },
        )
        return token
      } catch (error) {
        if ((error as { code?: number }).code === DUPLICATE_KEY) return null
        throw error
      }
    },

    /**
     * Scoped to the acquisition. A fetch that overran its lease must not free
     * the lease its successor now holds, or two fetchers run with one lease
     * between them — which is the failure the lease exists to prevent.
     *
     * A token the caller cannot forge or reuse is what makes that structural.
     * Scoping it to the holder read as the same guarantee and was not one.
     */
    release: async (key: string, token: string): Promise<void> => {
      await leases.deleteOne({ _id: key, token })
    },
  }
}
