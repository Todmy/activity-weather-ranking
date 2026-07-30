import type { IssuanceDocument } from '../persistence/forecasts.ts'
import { toGeocoded } from '../persistence/locations.ts'
import type { LocationDocument } from '../persistence/locations.ts'
import { fetchPlanFor, sampleFrom } from './activityForecast.ts'
import { isFresh } from './forecastGateway.ts'
import type { EnsureFreshResult, FetchPlan } from './forecastGateway.ts'

/**
 * The background refresher: one pass over the places somebody has asked about
 * recently, refreshing the ones whose weather has aged out.
 *
 * It is the fourth answer to "how does the data get refreshed", after the TTL,
 * the single flight and stale-if-error — and it was challenged twice on exactly
 * that basis before it was built (`cut.md`). It survives because those three are
 * all *pull*: they refresh a city because somebody asked for it, at the moment
 * they asked, which means the first traveller after an hour pays for the fetch.
 * This one keeps the warm set warm so that traveller does not.
 *
 * Nothing new is invented to do it. The tick calls the same `ensureFresh` the
 * read path calls and takes the same lease, so the two cannot race — the single
 * flight already covers both, and a refresher with its own fetch path would be
 * a second way for this service to be wrong about the weather.
 *
 * The clock is an argument and the schedule is elsewhere (`schedule.ts`), which
 * is what lets every decision below be tested by calling one function.
 */
export const REFRESH_WINDOW_MS = 24 * 60 * 60 * 1000

/**
 * Per-tick cap. Each location costs up to three upstream calls, so twenty is
 * sixty requests against a 600-a-minute ceiling — enough headroom that the
 * refresher can never be the reason a real request is throttled.
 */
export const MAX_PER_TICK = 20

export type RefreshOutcome =
  | 'refreshed'
  /** Somebody asked recently enough that the read path already refreshed it. */
  | 'stillFresh'
  /** Registered by a search but never scored. Nothing to keep warm yet. */
  | 'neverScored'
  /** The gateway declined: another flight in progress, or stale-if-error. */
  | 'notRefreshed'
  | 'failed'

export type RefresherEvent =
  | { event: 'woke'; at: Date; considered: number }
  | {
      event: 'location'
      locationId: string
      name: string
      outcome: RefreshOutcome
      reason?: string
    }
  | { event: 'slept'; refreshed: number; skipped: number; failed: number }

export type RefresherDeps = {
  due: (cutoff: Date, limit: number) => Promise<LocationDocument[]>
  newestFor: (locationId: string) => Promise<IssuanceDocument | null>
  /** The read path's gateway, unchanged and unbypassed. */
  issuance: (plan: FetchPlan) => Promise<EnsureFreshResult>
  now: () => Date
  log: (event: RefresherEvent) => void
}

export type TickReport = {
  considered: number
  refreshed: number
  skipped: number
  failed: number
}

const messageOf = (error: unknown): string =>
  error instanceof Error ? error.message : String(error)

type Verdict = { outcome: RefreshOutcome; reason?: string }

const refreshOne = async (
  deps: RefresherDeps,
  location: LocationDocument,
  now: Date,
): Promise<Verdict> => {
  const newest = await deps.newestFor(location._id)

  // `searchLocations` registers every candidate it returns, so five Cambridges
  // are in `locations` the moment somebody types the name. Fetching for a city
  // nobody has ever asked for a forecast about is exactly the wrong place to
  // spend a metered request.
  if (newest === null) return { outcome: 'neverScored' }
  if (isFresh(newest, now)) return { outcome: 'stillFresh' }

  try {
    const result = await deps.issuance(fetchPlanFor(toGeocoded(location), sampleFrom(location)))

    // `stale` here is the single flight working, not a failure: the read path is
    // already fetching this city and the lease said so.
    return result.status === 'fresh'
      ? { outcome: 'refreshed' }
      : { outcome: 'notRefreshed', reason: result.reason }
  } catch (error) {
    // One unreachable city must not cost the other nineteen their refresh.
    return { outcome: 'failed', reason: messageOf(error) }
  }
}

export const tick = async (deps: RefresherDeps): Promise<TickReport> => {
  const now = deps.now()
  const due = await deps.due(new Date(now.getTime() - REFRESH_WINDOW_MS), MAX_PER_TICK)

  deps.log({ event: 'woke', at: now, considered: due.length })

  const report: TickReport = { considered: due.length, refreshed: 0, skipped: 0, failed: 0 }

  // Sequential on purpose. Twenty locations in parallel is a sixty-request burst
  // that would compete with the requests this exists to make faster.
  for (const location of due) {
    const { outcome, reason } = await refreshOne(deps, location, now)

    if (outcome === 'refreshed') report.refreshed += 1
    else if (outcome === 'failed') report.failed += 1
    else report.skipped += 1

    deps.log({
      event: 'location',
      locationId: location._id,
      name: location.name,
      outcome,
      ...(reason === undefined ? {} : { reason }),
    })
  }

  const { refreshed, skipped, failed } = report
  deps.log({ event: 'slept', refreshed, skipped, failed })

  return report
}

/**
 * M7's done-condition is the log rather than a return value: a reviewer running
 * `docker compose logs -f api` has to be able to watch this work. These are the
 * lines they read.
 */
export const describeEvent = (event: RefresherEvent): string => {
  const hours = REFRESH_WINDOW_MS / (60 * 60 * 1000)

  switch (event.event) {
    case 'woke':
      return `refresher: woke at ${event.at.toISOString()}, ${event.considered} locations requested in the last ${hours}h`
    case 'location':
      return `refresher: ${event.name} (${event.locationId}) ${event.outcome}${
        event.reason === undefined ? '' : ` — ${event.reason}`
      }`
    case 'slept':
      return `refresher: done — ${event.refreshed} refreshed, ${event.skipped} skipped, ${event.failed} failed`
  }
}
