import type { Collection, Db, ObjectId } from 'mongodb'
import type { DayWeather } from '../domain/weather.ts'
import type { MarineDay } from '../providers/openmeteo/marine.ts'

/**
 * Forecasts, one document per **issuance** rather than one per (location, date).
 *
 * An upsert per date answers "what is the forecast for Friday" and destroys
 * "what did we think on Tuesday that Friday would be". Forecasts are revisions,
 * not facts, and the brief names modelling as part of the problem — so the
 * revision is the thing that gets stored. See design.md §2.
 *
 * All three series live in one document because the issuance is the unit of
 * consistency. Split across documents with independent lifetimes, a ranking
 * could compare indoor sightseeing from one fetch against skiing from another
 * with nothing flagging it.
 */
const COLLECTION = 'forecasts'

/** Retention is the application's job; see `insert` and the note below. */
export const KEEP_ISSUANCES = 24
export const EXPIRY_DAYS = 30

export type SeriesStatus = 'ok' | 'notApplicable' | 'unavailable'

/**
 * `notApplicable` is a measurement — no terrain here, no water here.
 * `unavailable` is our own failure to look. Keeping them apart is what lets a
 * later reader tell a permanent answer from a transient one.
 */
export type StoredSeries = {
  status: SeriesStatus
  reason?: string
  /** What the model says the ground is at, which is how the summit fetch is checkable. */
  elevation?: number
  days?: DayWeather[]
}

export type StoredMarineSeries = {
  status: SeriesStatus
  reason?: string
  days?: MarineDay[]
}

export type IssuanceDocument = {
  _id: ObjectId
  locationId: string
  /** When WE fetched it — the second axis, and the one freshness is measured on. */
  issuedAt: Date
  /** Upstream's own generation time, when it reports one. Open-Meteo does not. */
  modelRun: Date | null
  city: StoredSeries
  summit: StoredSeries
  marine: StoredMarineSeries
  /** TTL backstop only. Never the retention policy — see `insert`. */
  expiresAt: Date
}

export type NewIssuance = Omit<IssuanceDocument, '_id' | 'expiresAt'>

export type ForecastRepository = ReturnType<typeof forecastRepository>

const DAY_MS = 24 * 60 * 60 * 1000

export const forecastRepository = (db: Db) => {
  const forecasts = db.collection(COLLECTION) as unknown as Collection<IssuanceDocument>

  /**
   * Ties on `issuedAt` are possible — two fetches inside one millisecond — and
   * an ambiguous sort would make "the newest" and "what gets pruned" disagree
   * with each other. ObjectId breaks the tie in insertion order.
   */
  const newestFirst = { issuedAt: -1, _id: -1 } as const

  /**
   * Deletes what falls past the newest 24 for this location.
   *
   * A TTL index cannot express "keep at least one", so it cannot be the
   * retention policy: expiring the last surviving issuance during an upstream
   * outage would leave stale-if-error nothing to serve, at exactly the moment
   * the mechanism exists for. Risk 7 in recon.md.
   */
  const prune = async (locationId: string): Promise<void> => {
    const doomed = await forecasts
      .find({ locationId }, { projection: { _id: 1 }, sort: newestFirst, skip: KEEP_ISSUANCES })
      .toArray()

    if (doomed.length === 0) return
    await forecasts.deleteMany({ _id: { $in: doomed.map((issuance) => issuance._id) } })
  }

  return {
    /** Idempotent, so startup can call it unconditionally. */
    ensureIndexes: async (): Promise<void> => {
      await forecasts.createIndex({ locationId: 1, issuedAt: -1 })
      await forecasts.createIndex({ expiresAt: 1 }, { expireAfterSeconds: 0 })
    },

    newestFor: async (locationId: string): Promise<IssuanceDocument | null> =>
      await forecasts.findOne({ locationId }, { sort: newestFirst }),

    /**
     * Every surviving issuance, newest first — at most 24 by the prune above,
     * so this is bounded without a limit clause. It is what makes the "keep the
     * revisions" decision observable: a caller can watch Friday's forecast
     * change as Friday approaches.
     */
    allFor: async (locationId: string): Promise<IssuanceDocument[]> =>
      await forecasts.find({ locationId }, { sort: newestFirst }).toArray(),

    /**
     * Writes the issuance and prunes in the same call, because an unpruned
     * write is a growing collection that nothing else is watching.
     */
    insert: async (issuance: NewIssuance): Promise<IssuanceDocument> => {
      const document = {
        ...issuance,
        expiresAt: new Date(issuance.issuedAt.getTime() + EXPIRY_DAYS * DAY_MS),
      }

      const { insertedId } = await forecasts.insertOne(document as IssuanceDocument)
      await prune(issuance.locationId)

      return { ...document, _id: insertedId }
    },
  }
}
