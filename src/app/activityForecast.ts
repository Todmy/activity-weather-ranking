import { outdoorSightseeing } from '../domain/profiles/outdoorSightseeing.ts'
import { scoreProfile } from '../domain/score.ts'
import type { ProfileScore } from '../domain/score.ts'
import type { DayWeather } from '../domain/weather.ts'
import { fetchForecast, toDailyWeather } from '../providers/openmeteo/forecast.ts'
import type { Coordinates, ForecastResponse } from '../providers/openmeteo/forecast.ts'
import { searchLocations } from '../providers/openmeteo/geocoding.ts'
import type { GeocodedLocation } from '../providers/openmeteo/geocoding.ts'

/**
 * The application service: resolve a name, get the weather, score every day.
 *
 * This is the seam the refresh gateway drops into in slice 4. Today `weather`
 * goes straight to the provider and nothing is persisted, which is exactly the
 * thing the brief says not to ship — the point of the tracer bullet is that the
 * whole path exists before any one part of it is finished.
 *
 * Dependencies are injected because a test must never call Open-Meteo, and
 * because `now` has to come from outside: `domain/` cannot reach a clock, and
 * this is the boundary where one is allowed.
 */
export type ActivityForecastDeps = {
  search: (query: string, limit: number) => Promise<GeocodedLocation[]>
  weather: (coordinates: Coordinates) => Promise<ForecastResponse>
  now: () => Date
}

const liveDeps: ActivityForecastDeps = {
  search: searchLocations,
  weather: fetchForecast,
  now: () => new Date(),
}

export type ScoredActivity = ProfileScore & { activity: string }

export type ScoredDay = {
  date: string
  activities: ScoredActivity[]
}

export type ActivityForecast = {
  /** The place actually scored, so a substitution is never silent. */
  location: GeocodedLocation
  /** Other candidates for an ambiguous name, in upstream's order. */
  alternatives: GeocodedLocation[]
  issuedAt: string
  days: ScoredDay[]
}

export class LocationNotFound extends Error {
  constructor(query: string) {
    super(`No location matched "${query}"`)
    this.name = 'LocationNotFound'
  }
}

/** Slice 1 scores one activity. The array shape is what slice 2 fills in. */
const scoreDay = (day: DayWeather): ScoredActivity[] => [
  { activity: 'outdoorSightseeing', ...scoreProfile(outdoorSightseeing, day) },
]

export const getActivityForecast = async (
  query: string,
  deps: ActivityForecastDeps = liveDeps,
): Promise<ActivityForecast> => {
  const [location, ...alternatives] = await deps.search(query, 5)

  if (!location) {
    throw new LocationNotFound(query)
  }

  const response = await deps.weather({
    latitude: location.latitude,
    longitude: location.longitude,
  })

  return {
    location,
    alternatives,
    issuedAt: deps.now().toISOString(),
    days: toDailyWeather(response).map((day) => ({
      date: day.date,
      activities: scoreDay(day),
    })),
  }
}
