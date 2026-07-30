import { leaseKeyFor } from '../persistence/leases.ts'
import type { LeaseRepository } from '../persistence/leases.ts'
import type {
  ForecastRepository,
  IssuanceDocument,
  NewIssuance,
  StoredMarineSeries,
  StoredSeries,
} from '../persistence/forecasts.ts'
import { toDailyWeather, UPSTREAM_TIMEOUT_MS } from '../providers/openmeteo/forecast.ts'
import type { Coordinates, ForecastResponse } from '../providers/openmeteo/forecast.ts'
import type { MarineCoverage, MarineDay } from '../providers/openmeteo/marine.ts'

/**
 * The refresh gateway: cache-aside read, single-flight refresh, stale-if-error.
 *
 * Three mechanisms rather than three features — they are facets of one read
 * path, and separating them would mean three answers to the question of what a
 * caller gets when the stored data is old. See design.md §3.
 *
 * Nothing here reaches a clock, a socket or a database directly. The clock and
 * the sleep are injected so the cold-start branch can be exercised in
 * milliseconds instead of ten seconds, and the repositories are injected so the
 * same code runs against the mongod a test starts and the one docker-compose
 * does.
 */
export const FRESHNESS_MS = 60 * 60 * 1000

/**
 * Hard cap on any single upstream call, against a 30-second lease. Risk 8 in
 * recon.md is a lease shorter than the fetch it guards, which silently admits a
 * second fetcher; the margin between these two numbers is the mitigation.
 */

/** Cold start only: 100 polls of 100 ms, so the wait is bounded at 10 seconds. */
export const COLD_START_POLL_MS = 100
export const COLD_START_POLLS = 100

export type SkippedSeries = { status: 'notApplicable' | 'unavailable'; reason: string }

/**
 * What to fetch, or why not. The caller owns the "why not" because it is a
 * geography verdict, and this layer must not have to guess whether an absent
 * summit means "no mountain" or "nobody looked".
 */
export type SeriesPlan = { point: Coordinates } | { skip: SkippedSeries }

export type FetchPlan = {
  locationId: string
  city: Coordinates
  summit: SeriesPlan
  marine: SeriesPlan
}

export type GatewayDeps = {
  forecasts: ForecastRepository
  leases: LeaseRepository
  weather: (coordinates: Coordinates, signal?: AbortSignal) => Promise<ForecastResponse>
  marine: (
    coordinates: Coordinates,
    signal?: AbortSignal,
  ) => Promise<{ coverage: MarineCoverage; days: MarineDay[] }>
  /** Identifies the lease holder, so a release cannot free someone else's lease. */
  instanceId: string
  now: () => Date
  sleep: (ms: number) => Promise<void>
}

export type EnsureFreshResult =
  | { status: 'fresh'; issuance: IssuanceDocument }
  | { status: 'stale'; issuance: IssuanceDocument; reason: string }
  | { status: 'noDataYet'; reason: string }

export const isFresh = (issuance: IssuanceDocument, now: Date): boolean =>
  now.getTime() - issuance.issuedAt.getTime() < FRESHNESS_MS

const messageOf = (error: unknown): string =>
  error instanceof Error ? error.message : String(error)

/** Assignable to either series shape, because "we failed to look" carries no days. */
const unavailable = (error: unknown): { status: 'unavailable'; reason: string } => ({
  status: 'unavailable',
  reason: messageOf(error),
})

/**
 * The model's own ground elevation travels with the series. For the summit that
 * is a free cross-check — it should equal what the Elevation API said about the
 * same coordinate — and for the city it is what the answer reports as "here".
 */
const seriesFrom = (response: ForecastResponse): StoredSeries => ({
  status: 'ok',
  elevation: response.elevation,
  days: toDailyWeather(response),
})

/**
 * One issuance, three calls, in parallel because they are independent and the
 * lease is held for all of them.
 *
 * The city series is the issuance: if it fails there is nothing worth storing
 * and the failure propagates to stale-if-error. The other two degrade instead —
 * a summit forecast failing must not cost the caller the city they asked about,
 * and the reason is kept so a later reader can tell a failure from a measured
 * absence.
 */
const fetchIssuance = async (
  deps: GatewayDeps,
  plan: FetchPlan,
  issuedAt: Date,
): Promise<NewIssuance> => {
  const capped = () => AbortSignal.timeout(UPSTREAM_TIMEOUT_MS)

  const city = deps.weather(plan.city, capped())

  const summit: Promise<StoredSeries> =
    'point' in plan.summit
      ? deps.weather(plan.summit.point, capped()).then(seriesFrom).catch(unavailable)
      : Promise.resolve(plan.summit.skip)

  const marine: Promise<StoredMarineSeries> =
    'point' in plan.marine
      ? deps
          .marine(plan.marine.point, capped())
          // The coverage verdict travels beside the days precisely so an empty
          // week can be told apart from a calm one, and wrapping it as `ok`
          // threw that away — storing a series that is present and empty at
          // once, which is the one shape scoring cannot read. The location
          // keeps its coverage: one blank hour is not a finding about the sea,
          // so the next issuance recovers on its own.
          .then(
            ({ coverage, days }): StoredMarineSeries =>
              days.length === 0
                ? {
                    status: 'unavailable',
                    reason: `the wave model returned no usable days (coverage: ${coverage})`,
                  }
                : { status: 'ok', days },
          )
          .catch(unavailable)
      : Promise.resolve(plan.marine.skip)

  const [cityResponse, summitSeries, marineSeries] = await Promise.all([city, summit, marine])

  return {
    locationId: plan.locationId,
    issuedAt,
    // Open-Meteo reports no generation time for the model run itself, only for
    // the request. Recorded as null rather than filled with something close.
    modelRun: null,
    city: seriesFrom(cityResponse),
    summit: summitSeries,
    marine: marineSeries,
  }
}

export const ensureFresh = async (
  deps: GatewayDeps,
  plan: FetchPlan,
): Promise<EnsureFreshResult> => {
  const now = deps.now()
  const newest = await deps.forecasts.newestFor(plan.locationId)

  if (newest !== null && isFresh(newest, now)) return { status: 'fresh', issuance: newest }

  const key = leaseKeyFor(plan.locationId)

  if (await deps.leases.acquire(key, deps.instanceId, now)) {
    try {
      // Read again now the lease is held. Someone may have written and released
      // between the first read and here, and refetching what already arrived
      // would defeat the single flight for exactly the callers it exists for.
      const latest = (await deps.forecasts.newestFor(plan.locationId)) ?? newest
      if (latest !== null && isFresh(latest, now)) return { status: 'fresh', issuance: latest }

      const issuance = await deps.forecasts.insert(await fetchIssuance(deps, plan, now))
      return { status: 'fresh', issuance }
    } catch (error) {
      // stale-if-error: an upstream outage degrades the answer rather than
      // removing it. With nothing stored there is nothing to degrade to, and
      // saying so beats inventing one.
      const reason = messageOf(error)
      return newest === null
        ? { status: 'noDataYet', reason }
        : { status: 'stale', issuance: newest, reason }
    } finally {
      // Always, and never at the cost of the answer. A failure that keeps the
      // lease blocks every refresh of this location for the next thirty
      // seconds — but a throw here would replace the staged return value, so a
      // forecast already on disk would reach the caller as a request error
      // with stale-if-error unable to cover for it. The lease expires on its
      // own; a lost answer does not come back.
      await deps.leases.release(key, deps.instanceId).catch(() => undefined)
    }
  }

  // Someone else is already fetching. A slightly old answer beats a slow one,
  // so this branch neither waits nor fetches.
  if (newest !== null) {
    return { status: 'stale', issuance: newest, reason: 'a refresh is already in flight' }
  }

  // Cold start with the lease lost: the only case where there is genuinely
  // nothing to return, so wait for the winner — but bounded, because an
  // unbounded wait turns one slow location into a stuck request queue.
  for (let poll = 0; poll < COLD_START_POLLS; poll += 1) {
    await deps.sleep(COLD_START_POLL_MS)
    const arrived = await deps.forecasts.newestFor(plan.locationId)
    if (arrived !== null) return { status: 'fresh', issuance: arrived }
  }

  return {
    status: 'noDataYet',
    reason: `no issuance arrived within ${(COLD_START_POLLS * COLD_START_POLL_MS) / 1000} s`,
  }
}
