import { randomUUID } from 'node:crypto'
import type { Db } from 'mongodb'
import { forecastRepository } from '../persistence/forecasts.ts'
import { leaseRepository } from '../persistence/leases.ts'
import { ensureLocation, locationRepository, toGeocoded } from '../persistence/locations.ts'
import { resolutionRepository, resolveLocation } from '../persistence/resolutions.ts'
import { fetchForecast } from '../providers/openmeteo/forecast.ts'
import { searchLocations } from '../providers/openmeteo/geocoding.ts'
import { fetchTerrain } from '../providers/openmeteo/elevation.ts'
import { fetchMarine } from '../providers/openmeteo/marine.ts'
import type { AppDeps } from './deps.ts'
import { ensureFresh } from './forecastGateway.ts'

/**
 * The production wiring, in one place a reader can check against the diagram in
 * design.md §1. Everything above this file takes its collaborators as arguments,
 * which is what lets the whole path be exercised on fixtures.
 */
export const liveDepsFor = (db: Db, instanceId: string = randomUUID()): AppDeps => {
  const locations = locationRepository(db)
  const resolutions = resolutionRepository(db)
  const forecasts = forecastRepository(db)
  const leases = leaseRepository(db)
  const now = () => new Date()

  return {
    resolve: async (query, at) =>
      await resolveLocation({ resolutions, locations }, searchLocations, query, at),

    search: searchLocations,

    locationById: async (locationId) => {
      const stored = await locations.findById(locationId)
      return stored === null ? null : toGeocoded(stored)
    },

    // Registration, not a request: `activityForecastAt` takes an id and nothing
    // can geocode an id, so a search that did not write its candidates would
    // hand out ids that cannot be used. `lastRequestedAt` moves as a side
    // effect, which is harmless — the background refresher only refreshes
    // locations that already have an issuance, and a searched-but-never-scored
    // city has none.
    register: async (found, at) => {
      await Promise.all(found.map(async (location) => await locations.upsert(location, at)))
    },

    geography: async (location, at) => {
      const stored = await ensureLocation(
        locations,
        {
          sampleTerrain: fetchTerrain,
          // Costs one duplicated marine request on the very first sighting of a
          // coastal city, because the issuance below asks again. One request,
          // once per city ever, against a 10,000-a-day allowance — the
          // alternative is threading the first response through the read-through
          // and that is more machinery than the call is worth.
          sampleMarineCoverage: async (latitude, longitude) =>
            (await fetchMarine({ latitude, longitude })).coverage,
        },
        location,
        at,
      )

      return {
        ...(stored.terrain === undefined ? {} : { terrain: stored.terrain }),
        ...(stored.marineCoverage === undefined
          ? {}
          : { marineCoverage: stored.marineCoverage }),
      }
    },

    issuances: async (locationId) => await forecasts.allFor(locationId),

    issuance: async (plan) =>
      await ensureFresh(
        {
          forecasts,
          leases,
          weather: fetchForecast,
          marine: fetchMarine,
          // Identifies this process as a lease holder. A restart gets a new id,
          // which is correct: the old process's lease should expire rather than
          // be inherited by whatever starts next.
          instanceId,
          now,
          sleep: async (ms) => await new Promise((wake) => setTimeout(wake, ms)),
        },
        plan,
      ),

    now,
  }
}
