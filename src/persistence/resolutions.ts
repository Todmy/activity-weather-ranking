import type { Collection, Db } from 'mongodb'
import type { GeocodedLocation } from '../providers/openmeteo/geocoding.ts'
import { locationIdFor, toGeocoded } from './locations.ts'
import type { LocationRepository } from './locations.ts'

/**
 * The query-string binding: which city "cambridge" means here, pinned the first
 * time it is asked.
 *
 * A separate collection rather than an array on the location, because the
 * binding runs query → location and one location answers to several queries.
 * Its purpose is stability, not saving a call: Open-Meteo's relevance ranking
 * is upstream's to change, and risk 10 in recon.md is that changing it silently
 * changes what this service answers. This file is the whole of that mitigation.
 *
 * *Known limitation, stated rather than fixed:* the pin is global and
 * first-writer-wins, not per-caller. Someone who wants Cambridge, Massachusetts
 * goes through `searchLocations` and picks — which is what that pair exists for.
 */
const COLLECTION = 'resolutions'

export type ResolutionDocument = {
  _id: string
  locationId: string
  resolvedAt: Date
}

/** Case and spacing are typing, not intent. "  CAMBRIDGE " is not a second city. */
export const normaliseQuery = (query: string): string =>
  query.trim().toLowerCase().replace(/\s+/g, ' ')

export type ResolutionRepository = ReturnType<typeof resolutionRepository>

export const resolutionRepository = (db: Db) => {
  const resolutions = db.collection(COLLECTION) as unknown as Collection<ResolutionDocument>

  return {
    findByQuery: async (query: string): Promise<ResolutionDocument | null> =>
      await resolutions.findOne({ _id: normaliseQuery(query) }),

    /**
     * First writer wins. `$setOnInsert` rather than `$set`, because a pin that
     * moves is not a pin, and the second caller's ranking is no more
     * authoritative than the first's.
     */
    pin: async (query: string, locationId: string, now: Date): Promise<void> => {
      await resolutions.updateOne(
        { _id: normaliseQuery(query) },
        { $setOnInsert: { locationId, resolvedAt: now } },
        { upsert: true },
      )
    },
  }
}

export type Resolved = {
  location: GeocodedLocation
  alternatives: GeocodedLocation[]
}

const without = (candidates: GeocodedLocation[], chosen: GeocodedLocation): GeocodedLocation[] =>
  candidates.filter((candidate) => candidate.geonameId !== chosen.geonameId)

/**
 * Geocode, then let the pin — not upstream's ordering — decide which candidate
 * is the answer. Candidates still come back as alternatives in upstream's own
 * order, because the ranking is useful information even when it is not binding.
 */
export const resolveLocation = async (
  repos: { resolutions: ResolutionRepository; locations: LocationRepository },
  search: (query: string, limit: number) => Promise<GeocodedLocation[]>,
  query: string,
  now: Date,
): Promise<Resolved | null> => {
  const candidates = await search(query, 5)
  const first = candidates[0]
  if (!first) return null

  const pinned = await repos.resolutions.findByQuery(query)
  if (pinned === null) {
    await repos.resolutions.pin(query, locationIdFor(first.geonameId), now)
    return { location: first, alternatives: without(candidates, first) }
  }

  const stillListed = candidates.find(
    (candidate) => locationIdFor(candidate.geonameId) === pinned.locationId,
  )
  if (stillListed) {
    return { location: stillListed, alternatives: without(candidates, stillListed) }
  }

  // The pin is now the only thing that remembers this city, so the stored
  // document is what answers. If even that is missing — one process crash
  // between the pin and the location write — answering from upstream beats
  // failing, and the pin is left alone rather than rewritten to hide the gap.
  const stored = await repos.locations.findById(pinned.locationId)
  if (stored === null) return { location: first, alternatives: without(candidates, first) }

  const location = toGeocoded(stored)
  return { location, alternatives: without(candidates, location) }
}
