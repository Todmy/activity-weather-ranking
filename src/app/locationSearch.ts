import type { GeocodedLocation } from '../providers/openmeteo/geocoding.ts'

/**
 * The entry point for a caller who wants to choose rather than be chosen for.
 *
 * `activityForecast(query:)` resolves an ambiguous name to one place and always
 * says which. That is the right default and the wrong answer for someone who
 * meant Cambridge, Massachusetts, so this field returns the candidates and picks
 * none of them.
 *
 * It registers what it found. `activityForecastAt` takes an id and there is no
 * way to geocode an id, so without this every id handed out by a search would be
 * unusable until somebody happened to ask for that city by name.
 */
export type LocationSearchDeps = {
  search: (query: string, limit: number) => Promise<GeocodedLocation[]>
  register: (locations: GeocodedLocation[], now: Date) => Promise<void>
  now: () => Date
}

export const searchForLocations = async (
  query: string,
  limit: number,
  deps: LocationSearchDeps,
): Promise<GeocodedLocation[]> => {
  // Only the lower bound is ours. The upper one belongs to the geocoding API,
  // and letting it answer means a caller asking for too many gets a named
  // upstream error rather than a cap this service invented.
  if (limit < 1) throw new Error(`limit must be at least 1, got ${limit}`)

  const found = await deps.search(query, limit)
  if (found.length > 0) await deps.register(found, deps.now())

  return found
}
