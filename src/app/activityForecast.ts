import { evaluateActivity } from '../domain/activityResult.ts'
import type { ActivityResult } from '../domain/activityResult.ts'
import { withDerivedInputs } from '../domain/derive.ts'
import { geographyFrom } from '../domain/geography.ts'
import { MODEL_VERSION, PROFILES } from '../domain/modelVersion.ts'
import { rankActivitiesWithinDay, rankDaysWithinActivity } from '../domain/rank.ts'
import type { RankedDay } from '../domain/rank.ts'
import type { DayWeather } from '../domain/weather.ts'
import { FORECAST_DAYS, fetchForecast, toDailyWeather } from '../providers/openmeteo/forecast.ts'
import type { Coordinates, ForecastResponse } from '../providers/openmeteo/forecast.ts'
import { searchLocations } from '../providers/openmeteo/geocoding.ts'
import type { GeocodedLocation } from '../providers/openmeteo/geocoding.ts'
import { fetchMarine } from '../providers/openmeteo/marine.ts'
import type { MarineCoverage, MarineDay } from '../providers/openmeteo/marine.ts'

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
export type SampledTerrain = {
  gridVersion: string
  maxElevation: number
  point: { latitude: number; longitude: number }
  distanceKm: number
}

/** What is known about this location's geography. Absent means not assessed. */
export type GeographySample = {
  terrain?: SampledTerrain
  marineCoverage?: MarineCoverage
}

export type ActivityForecastDeps = {
  search: (query: string, limit: number) => Promise<GeocodedLocation[]>
  weather: (coordinates: Coordinates) => Promise<ForecastResponse>
  marine: (coordinates: Coordinates) => Promise<{ coverage: MarineCoverage; days: MarineDay[] }>
  /**
   * Read-through over the `locations` collection. Injected rather than imported
   * so this layer never learns what a database is, and so a test can assess a
   * city without one.
   */
  geography: (location: GeocodedLocation, now: Date) => Promise<GeographySample>
  now: () => Date
}

/** Geography with nowhere to persist it would be re-sampled per request. */
const unassessed = async (): Promise<GeographySample> => ({})

const liveDeps: ActivityForecastDeps = {
  search: searchLocations,
  weather: fetchForecast,
  marine: fetchMarine,
  geography: unassessed,
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

/**
 * What was measured about this place, reported alongside the scores.
 *
 * The ski assessment point is the part that matters: "Grenoble 78" must not be
 * readable as a claim about central Grenoble, so the elevation it was assessed
 * at and how far away that is travel with the answer (principle 5).
 */
export type Assessment = {
  terrain?: {
    elevation: number
    point: { latitude: number; longitude: number }
    distanceKm: number
    gridVersion: string
  }
  marineCoverage?: MarineCoverage
}

export type ActivityForecast = {
  /** The place actually scored, so a substitution is never silent. */
  location: GeocodedLocation
  /** Other candidates for an ambiguous name, in upstream's order. */
  alternatives: GeocodedLocation[]
  assessment: Assessment
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
 * Waves are measured at the city coordinate and the sky is measured there too,
 * so the two series merge by index — which is only safe because both requests
 * carry the same `past_days` and `forecast_days`. If they ever stop lining up,
 * a silent merge would score Tuesday's waves against Friday's sky, so the
 * alignment is checked rather than assumed.
 */
const mergeMarine = (days: DayWeather[], marine: MarineDay[]): DayWeather[] => {
  if (marine.length !== days.length) {
    throw new Error(
      `marine: ${marine.length} days against ${days.length} forecast days; they must align`,
    )
  }

  return days.map((day, index) => {
    const waves = marine[index] as MarineDay
    if (waves.date !== day.date) {
      throw new Error(`marine: ${waves.date} aligned against forecast day ${day.date}`)
    }
    const { date: _date, ...inputs } = waves
    return { ...day, ...inputs }
  })
}

export const getActivityForecast = async (
  query: string,
  deps: ActivityForecastDeps = liveDeps,
): Promise<ActivityForecast> => {
  const now = deps.now()
  const [location, ...alternatives] = await deps.search(query, 5)

  if (!location) {
    throw new LocationNotFound(query)
  }

  const coordinates = { latitude: location.latitude, longitude: location.longitude }
  const sample = await deps.geography(location, now)
  const geography = geographyFrom(sample.terrain, sample.marineCoverage)

  const cityResponse = await deps.weather(coordinates)

  // The cost gate. A second forecast request is worth making only where there is
  // terrain to make it about; below 300 m skiing is answered rather than scored,
  // and Amsterdam costs one request instead of two.
  const summitResponse =
    geography.hasTerrain === true && sample.terrain !== undefined
      ? await deps.weather(sample.terrain.point)
      : null

  // Nothing is asked of the marine model once it has answered "no water here".
  // Coverage is learned once and kept, so an inland city stops paying for it.
  const marine = geography.hasMarineCoverage === true ? await deps.marine(coordinates) : null

  // Derive across the whole issuance, history included, then score only the
  // days a traveller asked about. The three past days exist to give the first
  // forecast day a real fresh-snow window, not to be ranked.
  const cityDays = toDailyWeather(cityResponse)
  const city = withDerivedInputs(
    marine === null ? cityDays : mergeMarine(cityDays, marine.days),
  ).slice(-FORECAST_DAYS)

  // Skiing is the one profile that does not score the city it was asked about.
  const summit =
    summitResponse === null
      ? null
      : withDerivedInputs(toDailyWeather(summitResponse)).slice(-FORECAST_DAYS)

  const evaluateDay = (dayIndex: number): ActivityResult[] =>
    rankActivitiesWithinDay(
      PROFILES.map((profile) => {
        const series = profile.series === 'summit' ? summit : city
        // No series means the geography verdict is the answer — notApplicable
        // where there is no terrain, unavailable where nobody has looked. Empty
        // inputs let `evaluateActivity` say which, instead of this layer
        // guessing, and scoring the city series here would be the one
        // confidently wrong answer available.
        return evaluateActivity(profile, series?.[dayIndex] ?? {}, { dayIndex, geography })
      }),
    )

  const scored: ScoredDay[] = city.map((day, index) => ({
    date: day.date,
    inputs: day,
    activities: evaluateDay(index),
  }))

  return {
    location,
    alternatives,
    assessment: {
      ...(sample.terrain === undefined
        ? {}
        : {
            terrain: {
              elevation: sample.terrain.maxElevation,
              point: sample.terrain.point,
              distanceKm: sample.terrain.distanceKm,
              gridVersion: sample.terrain.gridVersion,
            },
          }),
      ...(sample.marineCoverage === undefined ? {} : { marineCoverage: sample.marineCoverage }),
    },
    issuedAt: now.toISOString(),
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
