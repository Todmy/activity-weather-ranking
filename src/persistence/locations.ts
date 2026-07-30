import type { Collection, Db } from 'mongodb'
import type { GeocodedLocation } from '../providers/openmeteo/geocoding.ts'

/**
 * Locations, the effectively immutable collection.
 *
 * It exists for one reason: terrain sampling costs 81 coordinates and the
 * Elevation API meters per coordinate, so 10,000 a day caps the service at
 * roughly 123 cities it has never seen. A coastline does not move on the
 * timescale of this service, so the answer is derived once and kept — which
 * turns the expensive operation into a one-off rather than a per-request cost.
 *
 * There is no gateway, no lease and no TTL here. Those belong to `forecasts`,
 * whose lifetime is an hour rather than forever, and keeping the two apart is
 * what lets one retention policy serve one rate of change.
 */
const COLLECTION = 'locations'

export type StoredTerrain = {
  gridVersion: string
  maxElevation: number
  point: { latitude: number; longitude: number }
  distanceKm: number
  /** When, separately from `gridVersion`'s what. Together they make a resample traceable. */
  sampledAt: Date
}

export type LocationDocument = {
  /** `geoname:<id>`. Pinned, because upstream relevance ranking can reorder five Cambridges. */
  _id: string
  geonameId: number
  name: string
  country: string | null
  countryCode: string | null
  admin1: string | null
  coords: { lat: number; lon: number }
  elevation: number | null
  timezone: string
  population: number | null
  /** Absent until sampled. "Not assessed" and "no mountain here" are different claims. */
  terrain?: StoredTerrain
  marineCoverage?: 'present' | 'none'
  lastRequestedAt: Date
}

export const locationIdFor = (geonameId: number): string => `geoname:${geonameId}`

/**
 * Back the way it came, for the one caller that needs it: a pinned query whose
 * city has dropped out of upstream's candidates. The stored document is then
 * the only remaining description of the place we promised to answer about.
 */
export const toGeocoded = (document: LocationDocument): GeocodedLocation => ({
  geonameId: document.geonameId,
  name: document.name,
  country: document.country,
  countryCode: document.countryCode,
  admin1: document.admin1,
  latitude: document.coords.lat,
  longitude: document.coords.lon,
  elevation: document.elevation,
  timezone: document.timezone,
  population: document.population,
})

export type LocationRepository = ReturnType<typeof locationRepository>

export const locationRepository = (db: Db) => {
  const locations = db.collection(COLLECTION) as unknown as Collection<LocationDocument>

  return {
    /** Idempotent, so startup can call it unconditionally. */
    ensureIndexes: async (): Promise<void> => {
      await locations.createIndex({ lastRequestedAt: -1 })
    },

    findById: async (id: string): Promise<LocationDocument | null> =>
      await locations.findOne({ _id: id }),

    /**
     * The background refresher's only query, and the reason for the
     * `{ lastRequestedAt: -1 }` index.
     *
     * The cutoff is what stops the warm set growing without bound: a city
     * nobody has asked about since yesterday stops being refreshed, so the
     * quota is spent on places somebody is actually going to. The limit is the
     * per-tick request budget — each location can cost three upstream calls,
     * and 600 a minute is the free tier.
     */
    requestedSince: async (cutoff: Date, limit: number): Promise<LocationDocument[]> =>
      await locations
        .find({ lastRequestedAt: { $gte: cutoff } })
        .sort({ lastRequestedAt: -1 })
        .limit(limit)
        .toArray(),

    /**
     * Writes the geocoding fields and moves `lastRequestedAt` forward. Geography
     * is deliberately not in `$set`: a second sighting of a city must not clear
     * an 81-coordinate sample that was already paid for.
     */
    upsert: async (geocoded: GeocodedLocation, now: Date): Promise<void> => {
      await locations.updateOne(
        { _id: locationIdFor(geocoded.geonameId) },
        {
          $set: {
            geonameId: geocoded.geonameId,
            name: geocoded.name,
            country: geocoded.country,
            countryCode: geocoded.countryCode,
            admin1: geocoded.admin1,
            coords: { lat: geocoded.latitude, lon: geocoded.longitude },
            elevation: geocoded.elevation,
            timezone: geocoded.timezone,
            population: geocoded.population,
            lastRequestedAt: now,
          },
        },
        { upsert: true },
      )
    },

    saveTerrain: async (
      id: string,
      terrain: Omit<StoredTerrain, 'sampledAt'>,
      sampledAt: Date,
    ): Promise<void> => {
      await locations.updateOne({ _id: id }, { $set: { terrain: { ...terrain, sampledAt } } })
    },

    saveMarineCoverage: async (id: string, coverage: 'present' | 'none'): Promise<void> => {
      await locations.updateOne({ _id: id }, { $set: { marineCoverage: coverage } })
    },
  }
}

export type GeographySamplers = {
  sampleTerrain: (
    latitude: number,
    longitude: number,
  ) => Promise<Omit<StoredTerrain, 'sampledAt'>>
  sampleMarineCoverage: (latitude: number, longitude: number) => Promise<'present' | 'none'>
}

/**
 * Read-through. A cold location is sampled once; a warm one costs a single
 * document read and no upstream call at all.
 *
 * Sampling failure is deliberately not fatal and deliberately not recorded as
 * an absence of terrain. A geography failure must not cost the caller their
 * forecast, and a city permanently marked "no mountain here" because one call
 * failed once is worse than retrying — a false `notApplicable` is permanent
 * where a false "applicable" costs one request.
 *
 * The two samples are also independent rather than one transaction, because
 * their costs are not comparable: terrain is 81 metered coordinates and marine
 * is one request. Discarding a successful grid because the cheap call failed
 * would re-spend the most expensive thing the service does.
 */
export const ensureLocation = async (
  repo: LocationRepository,
  providers: GeographySamplers,
  geocoded: GeocodedLocation,
  now: Date,
): Promise<LocationDocument> => {
  const id = locationIdFor(geocoded.geonameId)
  await repo.upsert(geocoded, now)

  const stored = await repo.findById(id)
  if (stored === null) throw new Error(`locations: ${id} vanished immediately after upsert`)

  const wanted: Promise<void>[] = []
  if (stored.terrain === undefined) {
    wanted.push(
      providers
        .sampleTerrain(geocoded.latitude, geocoded.longitude)
        .then((terrain) => repo.saveTerrain(id, terrain, now))
        .catch(() => undefined),
    )
  }
  if (stored.marineCoverage === undefined) {
    wanted.push(
      providers
        .sampleMarineCoverage(geocoded.latitude, geocoded.longitude)
        .then((coverage) => repo.saveMarineCoverage(id, coverage))
        .catch(() => undefined),
    )
  }

  if (wanted.length === 0) return stored
  await Promise.all(wanted)
  return (await repo.findById(id)) ?? stored
}
