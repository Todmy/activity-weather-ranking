import type { Db } from 'mongodb'
import { ensureLocation, locationRepository } from '../persistence/locations.ts'
import { fetchForecast } from '../providers/openmeteo/forecast.ts'
import { searchLocations } from '../providers/openmeteo/geocoding.ts'
import { fetchTerrain } from '../providers/openmeteo/elevation.ts'
import { fetchMarine } from '../providers/openmeteo/marine.ts'
import type { ActivityForecastDeps } from './activityForecast.ts'

/**
 * The production wiring, in one place a reader can check against the diagram in
 * design.md §1. Everything above this file takes its collaborators as arguments,
 * which is what lets the whole path be exercised on fixtures.
 */
export const liveDepsFor = (db: Db): ActivityForecastDeps => {
  const locations = locationRepository(db)

  return {
    search: searchLocations,
    weather: fetchForecast,
    marine: fetchMarine,
    geography: async (location, now) => {
      const stored = await ensureLocation(
        locations,
        {
          sampleTerrain: fetchTerrain,
          // Costs one duplicated marine request on the very first sighting of a
          // coastal city, because the per-issuance fetch below asks again. One
          // request, once per city ever, against a 10,000-a-day allowance — the
          // alternative is threading the first response through the read-through
          // and that is more machinery than the call is worth.
          sampleMarineCoverage: async (latitude, longitude) =>
            (await fetchMarine({ latitude, longitude })).coverage,
        },
        location,
        now,
      )

      return {
        ...(stored.terrain === undefined ? {} : { terrain: stored.terrain }),
        ...(stored.marineCoverage === undefined
          ? {}
          : { marineCoverage: stored.marineCoverage }),
      }
    },
    now: () => new Date(),
  }
}
