import { evaluateActivity } from '../domain/activityResult.ts'
import type { ActivityResult } from '../domain/activityResult.ts'
import { withDerivedInputs } from '../domain/derive.ts'
import { geographyFrom } from '../domain/geography.ts'
import { MODEL_VERSION, PROFILES } from '../domain/modelVersion.ts'
import { rankActivitiesWithinDay, rankDaysWithinActivity } from '../domain/rank.ts'
import type { RankedDay } from '../domain/rank.ts'
import type { DayWeather } from '../domain/weather.ts'
import { locationIdFor } from '../persistence/locations.ts'
import type { Resolved } from '../persistence/resolutions.ts'
import { FORECAST_DAYS } from '../providers/openmeteo/forecast.ts'
import type { Coordinates } from '../providers/openmeteo/forecast.ts'
import type { GeocodedLocation } from '../providers/openmeteo/geocoding.ts'
import type { MarineCoverage, MarineDay } from '../providers/openmeteo/marine.ts'
import type { EnsureFreshResult, FetchPlan, SeriesPlan } from './forecastGateway.ts'

/**
 * The application service: resolve a name, read the stored weather, score every
 * day.
 *
 * Weather now arrives as an issuance from the refresh gateway rather than as a
 * fetch, and this layer cannot tell whether answering it cost an upstream call.
 * That is the point: the brief asks for weather that is stored and refreshed
 * rather than re-fetched, and the only way to keep that true is for the caller
 * of the gateway to have no way of bypassing it.
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
  /**
   * Geocoding plus the resolution pin, so upstream reordering five Cambridges
   * cannot change which one this service answers about.
   */
  resolve: (query: string, now: Date) => Promise<Resolved | null>
  /**
   * The other way in: a caller who has already chosen from `searchLocations`
   * passes the id, and is deliberately not re-resolved — re-resolving is exactly
   * where a silent substitution would creep back in.
   */
  locationById: (locationId: string) => Promise<GeocodedLocation | null>
  /**
   * Read-through over the `locations` collection. Injected rather than imported
   * so this layer never learns what a database is, and so a test can assess a
   * city without one.
   */
  geography: (location: GeocodedLocation, now: Date) => Promise<GeographySample>
  /**
   * The refresh gateway. Weather arrives as a stored issuance rather than a
   * fetch, which is the whole of M5: this layer asks for the newest issuance and
   * has no idea whether one was fetched to answer it.
   */
  issuance: (plan: FetchPlan) => Promise<EnsureFreshResult>
  now: () => Date
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
  /**
   * True when this answer is served from an issuance the gateway could not
   * refresh. The answer still arrives — an unlabelled stale answer would be
   * worse than none, because nothing downstream could tell it from a current
   * one.
   */
  stale: boolean
  /** What stopped the refresh, or null when nothing did. */
  staleReason: string | null
  /** Pinned, so an identical issuance and version reproduce this exactly. */
  modelVersion: string
  days: ScoredDay[]
  rankings: ActivityRanking[]
}

export class LocationNotFound extends Error {
  constructor(what: string, message = `No location matched "${what}"`) {
    super(message)
    this.name = 'LocationNotFound'
  }
}

/**
 * Cold start, someone else fetching, and the wait ran out. The one place the
 * service does not answer — and it says so by name rather than inventing a
 * forecast or returning a 500.
 */
export class NoDataYet extends Error {
  constructor(place: string, reason: string) {
    super(`No forecast stored for ${place} yet: ${reason}`)
    this.name = 'NoDataYet'
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

/**
 * The geography verdict turned into an instruction for the gateway.
 *
 * `false` is a measurement — no mountain, no water — and skipping the call is
 * the cost gate working. `null` is our own failure to look, and recording that
 * as `notApplicable` would turn a transient outage into a permanent claim about
 * the place.
 */
const seriesPlanFor = (
  verdict: boolean | null,
  point: Coordinates | undefined,
  reason: string,
): SeriesPlan => {
  if (verdict === true && point !== undefined) return { point }
  if (verdict === null) return { skip: { status: 'unavailable', reason: 'geographyNotAssessed' } }
  return { skip: { status: 'notApplicable', reason } }
}

/**
 * One pipeline, two ways in. Keeping the scoring here rather than in each entry
 * point is what makes "the id entry answers exactly what the name entry would"
 * a property of the code rather than a claim about it.
 */
const forecastFor = async (
  location: GeocodedLocation,
  alternatives: GeocodedLocation[],
  deps: ActivityForecastDeps,
  now: Date,
): Promise<ActivityForecast> => {
  const coordinates = { latitude: location.latitude, longitude: location.longitude }
  const sample = await deps.geography(location, now)
  const geography = geographyFrom(sample.terrain, sample.marineCoverage)

  // The cost gate. A second forecast is worth fetching only where there is
  // terrain to make it about; below 300 m skiing is answered rather than
  // scored, and Amsterdam costs one request instead of two.
  const result = await deps.issuance({
    locationId: locationIdFor(location.geonameId),
    city: coordinates,
    summit: seriesPlanFor(geography.hasTerrain, sample.terrain?.point, 'noTerrain'),
    // Nothing is asked of the marine model once it has answered "no water
    // here". Coverage is learned once and kept, so an inland city stops paying.
    marine: seriesPlanFor(geography.hasMarineCoverage, coordinates, 'noMarineCoverage'),
  })

  if (result.status === 'noDataYet') {
    throw new NoDataYet(location.name, result.reason)
  }

  const { issuance } = result
  const marineDays = issuance.marine.status === 'ok' ? (issuance.marine.days ?? null) : null

  // Derive across the whole issuance, history included, then score only the
  // days a traveller asked about. The three past days exist to give the first
  // forecast day a real fresh-snow window, not to be ranked.
  const cityDays = issuance.city.days ?? []
  const city = withDerivedInputs(
    marineDays === null ? cityDays : mergeMarine(cityDays, marineDays),
  ).slice(-FORECAST_DAYS)

  // Skiing is the one profile that does not score the city it was asked about.
  const summit =
    issuance.summit.status === 'ok'
      ? withDerivedInputs(issuance.summit.days ?? []).slice(-FORECAST_DAYS)
      : null

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
    issuedAt: issuance.issuedAt.toISOString(),
    stale: result.status === 'stale',
    staleReason: result.status === 'stale' ? result.reason : null,
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

export const getActivityForecast = async (
  query: string,
  deps: ActivityForecastDeps,
): Promise<ActivityForecast> => {
  const now = deps.now()
  const resolved = await deps.resolve(query, now)

  if (resolved === null) throw new LocationNotFound(query)

  return await forecastFor(resolved.location, resolved.alternatives, deps, now)
}

export const getActivityForecastAt = async (
  locationId: string,
  deps: ActivityForecastDeps,
): Promise<ActivityForecast> => {
  const now = deps.now()
  const location = await deps.locationById(locationId)

  if (location === null) {
    throw new LocationNotFound(
      locationId,
      `No location is stored under "${locationId}". Use searchLocations to get an id this ` +
        'service knows.',
    )
  }

  // No alternatives: the caller already chose, and offering them again would
  // suggest the choice is still open.
  return await forecastFor(location, [], deps, now)
}
