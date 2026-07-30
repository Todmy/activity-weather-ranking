import { evaluateActivity } from '../domain/activityResult.ts'
import type { ActivityResult, Geography } from '../domain/activityResult.ts'
import { withDerivedInputs } from '../domain/derive.ts'
import { MODEL_VERSION, PROFILES } from '../domain/modelVersion.ts'
import { rankActivitiesWithinDay, rankDaysWithinActivity } from '../domain/rank.ts'
import type { RankedDay } from '../domain/rank.ts'
import type { DayWeather } from '../domain/weather.ts'
import { FORECAST_DAYS, fetchForecast, toDailyWeather } from '../providers/openmeteo/forecast.ts'
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

export type ScoredDay = {
  date: string
  /** The weather the scores were computed from, derived inputs included. */
  inputs: DayWeather
  /** Every activity, ranked best first within this day. */
  activities: ActivityResult[]
}

/** One activity's days, ranked best first. The other reading of "ranks". */
export type ActivityRanking = {
  activity: string
  days: RankedDay[]
}

export type ActivityForecast = {
  /** The place actually scored, so a substitution is never silent. */
  location: GeocodedLocation
  /** Other candidates for an ambiguous name, in upstream's order. */
  alternatives: GeocodedLocation[]
  issuedAt: string
  /** Pinned, so an identical issuance and version reproduce this exactly. */
  modelVersion: string
  days: ScoredDay[]
  rankings: ActivityRanking[]
}

export class LocationNotFound extends Error {
  constructor(query: string) {
    super(`No location matched "${query}"`)
    this.name = 'LocationNotFound'
  }
}

/**
 * Geography is not weather and is not fetched yet: slice 3 samples the terrain
 * around a city and asks the Marine API what it covers. Until then both are
 * null, which reads as `unavailable` with a reason rather than as an absence
 * this service has established.
 */
const UNASSESSED: Geography = { hasTerrain: null, hasMarineCoverage: null }

const evaluateDay = (day: DayWeather, dayIndex: number): ActivityResult[] =>
  rankActivitiesWithinDay(
    PROFILES.map((profile) => evaluateActivity(profile, day, { dayIndex, geography: UNASSESSED })),
  )

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

  // Derive across the whole issuance, history included, then score only the
  // days a traveller asked about. The three past days exist to give the first
  // forecast day a real fresh-snow window, not to be ranked.
  const days = withDerivedInputs(toDailyWeather(response)).slice(-FORECAST_DAYS)

  const scored: ScoredDay[] = days.map((day, index) => ({
    date: day.date,
    inputs: day,
    activities: evaluateDay(day, index),
  }))

  return {
    location,
    alternatives,
    issuedAt: deps.now().toISOString(),
    modelVersion: MODEL_VERSION,
    days: scored,
    // Both readings of the brief's "ranks", from the same computation. Neither
    // re-scores anything.
    rankings: PROFILES.map((profile) => ({
      activity: profile.activity,
      days: rankDaysWithinActivity(scored, profile.activity),
    })),
  }
}
