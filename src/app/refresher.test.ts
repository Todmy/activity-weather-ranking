import { ObjectId } from 'mongodb'
import { describe, expect, it, vi } from 'vitest'
import type { IssuanceDocument } from '../persistence/forecasts.ts'
import type { LocationDocument } from '../persistence/locations.ts'
import type { EnsureFreshResult, FetchPlan } from './forecastGateway.ts'
import { FRESHNESS_MS } from './forecastGateway.ts'
import { MAX_PER_TICK, REFRESH_WINDOW_MS, describeEvent, tick } from './refresher.ts'
import type { RefresherEvent } from './refresher.ts'

/**
 * The background refresher, exercised by calling its tick directly.
 *
 * No test here waits on a timer, and no test here starts one: the clock is an
 * argument and the schedule is somebody else's job (`schedule.test.ts`). What
 * this file is about is the decision — which locations are due, which are
 * deliberately left alone, and what the log says about both.
 */
const NOW = new Date('2026-07-30T12:00:00.000Z')

const locationAt = (geonameId: number, extra: Partial<LocationDocument> = {}): LocationDocument => ({
  _id: `geoname:${geonameId}`,
  geonameId,
  name: `city-${geonameId}`,
  country: 'France',
  countryCode: 'FR',
  admin1: null,
  coords: { lat: 45.1885, lon: 5.7245 },
  elevation: 214,
  timezone: 'Europe/Paris',
  population: 158552,
  lastRequestedAt: new Date(NOW.getTime() - 60 * 60 * 1000),
  ...extra,
})

const issuedAt = (when: Date): IssuanceDocument =>
  ({ _id: new ObjectId(), issuedAt: when }) as IssuanceDocument

const stale = issuedAt(new Date(NOW.getTime() - FRESHNESS_MS - 1))
const fresh = issuedAt(new Date(NOW.getTime() - 60 * 1000))

type Overrides = {
  due?: LocationDocument[]
  newest?: (locationId: string) => IssuanceDocument | null
  issuance?: (plan: FetchPlan) => Promise<EnsureFreshResult>
}

const depsFor = (overrides: Overrides = {}) => {
  const events: RefresherEvent[] = []
  const due = vi.fn(async (_cutoff: Date, _limit: number) => overrides.due ?? [])
  const newestFor = vi.fn(async (locationId: string) => overrides.newest?.(locationId) ?? null)
  const issuance = vi.fn(
    async (plan: FetchPlan): Promise<EnsureFreshResult> =>
      (await overrides.issuance?.(plan)) ?? { status: 'fresh', issuance: fresh },
  )

  const markConsidered = vi.fn(async (_locationId: string, _now: Date) => undefined)

  return {
    events,
    markConsidered,
    deps: {
      due,
      newestFor,
      issuance,
      markConsidered,
      now: () => NOW,
      log: (e: RefresherEvent) => events.push(e),
    },
  }
}

describe('tick', () => {
  it('asks only for the locations somebody wanted in the last 24 hours', async () => {
    // The window is what stops the warm set growing without bound: every city
    // ever searched would otherwise be refreshed forever, on a 10,000-a-day
    // allowance.
    const { deps } = depsFor()

    await tick(deps)

    expect(deps.due).toHaveBeenCalledWith(new Date(NOW.getTime() - REFRESH_WINDOW_MS), MAX_PER_TICK)
  })

  it('refreshes a location whose newest issuance has aged out', async () => {
    const { deps } = depsFor({ due: [locationAt(1)], newest: () => stale })

    const report = await tick(deps)

    expect(deps.issuance).toHaveBeenCalledTimes(1)
    expect(deps.issuance.mock.calls[0]?.[0].locationId).toBe('geoname:1')
    expect(report).toMatchObject({ considered: 1, refreshed: 1, skipped: 0, failed: 0 })
  })

  it('leaves a location alone while its issuance is still fresh', async () => {
    // The gateway would answer "fresh" without fetching anyway. Deciding it here
    // keeps the reason in the log instead of hiding it inside a no-op call.
    const { deps } = depsFor({ due: [locationAt(1)], newest: () => fresh })

    const report = await tick(deps)

    expect(deps.issuance).not.toHaveBeenCalled()
    expect(report).toMatchObject({ considered: 1, refreshed: 0, skipped: 1 })
  })

  it('never fetches for a location that has no issuance at all', async () => {
    // `searchLocations` registers every candidate it returns, so five Cambridges
    // land in `locations` the moment somebody types the name. Refreshing them
    // would spend the quota on four cities nobody asked for a forecast about.
    const { deps, events } = depsFor({ due: [locationAt(1)], newest: () => null })

    const report = await tick(deps)

    expect(deps.issuance).not.toHaveBeenCalled()
    expect(report).toMatchObject({ considered: 1, refreshed: 0, skipped: 1 })
    expect(events).toContainEqual(
      expect.objectContaining({ event: 'location', outcome: 'neverScored' }),
    )
  })

  it('plans the same series the read path would, from the stored geography', async () => {
    // Read from the document rather than through the geography read-through,
    // which upserts and would drag `lastRequestedAt` forward on every tick —
    // every city warm forever, the window silently dead. And the plan has to
    // match the read path's, or the refresher stores an issuance without the
    // summit series a skier's request then finds "fresh".
    const summit = { latitude: 45.0088, longitude: 6.2343 }
    const { deps } = depsFor({
      due: [
        locationAt(1, {
          terrain: {
            gridVersion: 'circ-50km-11x11',
            maxElevation: 3204,
            point: summit,
            distanceKm: 44.7,
            sampledAt: NOW,
          },
          marineCoverage: 'none',
        }),
      ],
      newest: () => stale,
    })

    await tick(deps)

    const plan = deps.issuance.mock.calls[0]?.[0] as FetchPlan
    expect(plan.city).toEqual({ latitude: 45.1885, longitude: 5.7245 })
    expect(plan.summit).toEqual({ point: summit })
    expect(plan.marine).toEqual({ skip: { status: 'notApplicable', reason: 'noMarineCoverage' } })
  })

  it('carries on when one location fails, and counts it', async () => {
    // One unreachable city must not cost the other nineteen their refresh.
    const { deps } = depsFor({
      due: [locationAt(1), locationAt(2)],
      newest: () => stale,
      issuance: async (plan) => {
        if (plan.locationId === 'geoname:1') throw new Error('upstream said no')
        return { status: 'fresh', issuance: fresh }
      },
    })

    const report = await tick(deps)

    expect(report).toMatchObject({ considered: 2, refreshed: 1, failed: 1 })
  })

  it('counts a refresh the gateway declined as neither refreshed nor failed', async () => {
    // The read path holding the lease is the single-flight mechanism working,
    // not an error. Same for stale-if-error: the caller still got an answer.
    const { deps, events } = depsFor({
      due: [locationAt(1)],
      newest: () => stale,
      issuance: async () => ({ status: 'stale', issuance: stale, reason: 'in flight' }),
    })

    const report = await tick(deps)

    expect(report).toMatchObject({ considered: 1, refreshed: 0, skipped: 1, failed: 0 })
    expect(events).toContainEqual(
      expect.objectContaining({ event: 'location', outcome: 'notRefreshed', reason: 'in flight' }),
    )
  })

  it('logs waking, what it selected, and what it did with each one', async () => {
    // M7's done-condition is the log, not the return value: a reviewer watching
    // `docker compose logs` has to be able to see the thing work.
    const { deps, events } = depsFor({ due: [locationAt(1)], newest: () => stale })

    await tick(deps)

    expect(events).toEqual([
      { event: 'woke', at: NOW, considered: 1 },
      { event: 'location', locationId: 'geoname:1', name: 'city-1', outcome: 'refreshed' },
      { event: 'slept', refreshed: 1, skipped: 0, failed: 0 },
    ])
  })
})

describe('the rotation', () => {
  it('marks every location it considered, whatever it decided about them', async () => {
    // The per-tick limit is a window over the warm set, not a cap on how much
    // of it is ever reached, and `lastConsideredAt` is what turns the window.
    // Marking only the successful refreshes would park a never-scored candidate
    // or an unreachable city at the head of the queue forever, so the tick
    // would keep re-considering the same twenty and the twenty-first would
    // never be refreshed at all. One mark per location, whatever the verdict.
    const { deps, markConsidered } = depsFor({
      due: [locationAt(1), locationAt(2), locationAt(3)],
      newest: (locationId) =>
        locationId === 'geoname:1' ? null : locationId === 'geoname:2' ? fresh : stale,
    })

    const report = await tick(deps)

    // neverScored, stillFresh, refreshed — one of each, and all three marked.
    expect(report).toMatchObject({ considered: 3, refreshed: 1, skipped: 2, failed: 0 })
    expect(markConsidered.mock.calls.map(([id]) => id)).toEqual([
      'geoname:1',
      'geoname:2',
      'geoname:3',
    ])
    expect(markConsidered.mock.calls.every(([, when]) => when === NOW)).toBe(true)
  })

  it('marks a location whose refresh threw, so one dead city cannot block the queue', async () => {
    const { deps, markConsidered } = depsFor({
      due: [locationAt(1)],
      newest: () => stale,
      issuance: async () => {
        throw new Error('upstream is having a day')
      },
    })

    const report = await tick(deps)

    expect(report.failed).toBe(1)
    expect(markConsidered).toHaveBeenCalledWith('geoname:1', NOW)
  })
})

describe('describeEvent', () => {
  it('renders a line a human reading container logs can act on', async () => {
    expect(describeEvent({ event: 'woke', at: NOW, considered: 3 })).toBe(
      'refresher: woke at 2026-07-30T12:00:00.000Z, 3 locations requested in the last 24h',
    )
    expect(
      describeEvent({
        event: 'location',
        locationId: 'geoname:1',
        name: 'Grenoble',
        outcome: 'refreshed',
      }),
    ).toBe('refresher: Grenoble (geoname:1) refreshed')
    expect(describeEvent({ event: 'slept', refreshed: 1, skipped: 2, failed: 0 })).toBe(
      'refresher: done — 1 refreshed, 2 skipped, 0 failed',
    )
  })
})
