import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { getActivityForecast, LocationNotFound, NoDataYet } from './activityForecast.ts'
import type { ActivityForecastDeps } from './activityForecast.ts'
import type { FetchPlan } from './forecastGateway.ts'
import { DEFAULT_ISSUED_AT, freshIssuance, issuanceFrom } from '../testing/issuance.ts'
import { parseForecast } from '../providers/openmeteo/forecast.ts'
import { parseGeocoding, toLocations } from '../providers/openmeteo/geocoding.ts'
import { parseMarine, toDailyMarine } from '../providers/openmeteo/marine.ts'
import type { MarineDay } from '../providers/openmeteo/marine.ts'

const fixture = (name: string): unknown =>
  JSON.parse(readFileSync(new URL(`../../docs/probes/${name}`, import.meta.url), 'utf8'))

const innsbruck = parseForecast(fixture('forecast-innsbruck-past3.json'))
const cambridge = toLocations(parseGeocoding(fixture('geocoding-cambridge.json')))

const summit = parseForecast(fixture('forecast-grenoble-summit-past3.json'))
const lisbonMarine = parseMarine(fixture('marine-lisbon-past3.json'))

const grenobleTerrain = {
  gridVersion: 'circ-50km-11x11',
  maxElevation: 3204,
  point: { latitude: 45.0088, longitude: 6.2343 },
  distanceKm: 44.7,
  sampledAt: new Date('2026-07-30T10:00:00.000Z'),
}

/** Records the plans the gateway was handed, so a skipped call is provable. */
const spyIssuance = (marineDays: MarineDay[] = toDailyMarine(lisbonMarine)) => {
  const plans: FetchPlan[] = []
  return {
    plans,
    issuance: async (plan: FetchPlan) => {
      plans.push(plan)
      return freshIssuance(plan, { city: innsbruck, summit, marine: marineDays })
    },
  }
}

const deps = (overrides: Partial<ActivityForecastDeps> = {}): ActivityForecastDeps => ({
  resolve: async () => ({ location: cambridge[0]!, alternatives: cambridge.slice(1) }),
  // Unassessed by default, which is what a geography sampling failure looks
  // like. The block below covers the assessed cases.
  geography: async () => ({}),
  issuance: async (plan) =>
    freshIssuance(plan, { city: innsbruck, summit, marine: toDailyMarine(lisbonMarine) }),
  now: () => DEFAULT_ISSUED_AT,
  ...overrides,
})

describe('getActivityForecast', () => {
  it('scores the seven forecast days and not the history behind them', async () => {
    const forecast = await getActivityForecast('Cambridge', deps())

    // The response carries ten days: three of history for the fresh-snow
    // window, then the seven a traveller is actually asking about.
    expect(forecast.days).toHaveLength(7)
    expect(forecast.days[0]?.date).toBe('2026-07-30')
    expect(forecast.days[6]?.date).toBe('2026-08-05')
    const first = forecast.days[0]?.activities[0]
    expect(first?.kind === 'scored' && first.score).toBeTypeOf('number')
  })

  it('derives the three-day snow window before scoring', async () => {
    const forecast = await getActivityForecast('Cambridge', deps())

    // Zero in a Tyrolean July, and present rather than absent, which is the
    // part that matters: the ski profile can read it.
    expect(forecast.days[0]?.inputs.snowfall3d).toBe(0)
  })

  it('names the place it scored and keeps the other candidates visible', async () => {
    const forecast = await getActivityForecast('Cambridge', deps())

    expect(forecast.location.countryCode).toBe('GB')
    expect(forecast.alternatives).toHaveLength(4)
  })

  it('takes its clock from outside, never from the domain', async () => {
    const forecast = await getActivityForecast('Cambridge', deps())

    expect(forecast.issuedAt).toBe('2026-07-29T12:00:00.000Z')
  })

  it('explains every score by factor', async () => {
    const forecast = await getActivityForecast('Cambridge', deps())
    const outdoor = forecast.days[0]?.activities.find(
      (result) => result.activity === 'outdoorSightseeing',
    )

    expect(outdoor?.kind).toBe('scored')
    expect(outdoor?.kind === 'scored' && outdoor.factors.map((factor) => factor.name)).toEqual([
      'thermalComfort',
      'precipitation',
      'wind',
      'sky',
    ])
  })

  it('scores a real Innsbruck heatwave day as merely walkable', async () => {
    // 2026-07-30 in the captured probe: 35.5 apparent, no rain, 9% cloud.
    // Hot enough that the comfort factor is the whole story.
    const forecast = await getActivityForecast('Innsbruck', deps())
    const outdoor = forecast.days[0]?.activities.find(
      (result) => result.activity === 'outdoorSightseeing',
    )

    expect(outdoor?.kind === 'scored' && outdoor.score).toBe(55)
    expect(outdoor?.kind === 'scored' && outdoor.factors[0]?.curveValue).toBe(0)
  })

  it('reports a fresh answer as fresh, with nothing to explain', async () => {
    const forecast = await getActivityForecast('Cambridge', deps())

    expect(forecast.stale).toBe(false)
    expect(forecast.staleReason).toBeNull()
  })

  it('flags a stale answer and names what made it stale', async () => {
    // stale-if-error, seen from the caller's side: the answer still arrives,
    // and it arrives labelled. An unlabelled stale answer is worse than none,
    // because nothing downstream can tell it apart from a current one.
    const forecast = await getActivityForecast(
      'Cambridge',
      deps({
        issuance: async (plan) => ({
          status: 'stale',
          issuance: issuanceFrom(plan, { city: innsbruck }),
          reason: 'Open-Meteo answered 503',
        }),
      }),
    )

    expect(forecast.stale).toBe(true)
    expect(forecast.staleReason).toBe('Open-Meteo answered 503')
    // Still a real answer, not a placeholder.
    expect(forecast.days).toHaveLength(7)
  })

  it('refuses by name when there is no issuance at all', async () => {
    // Cold start, someone else fetching, bounded wait exhausted. The one place
    // the service does not answer.
    await expect(
      getActivityForecast(
        'Cambridge',
        deps({
          issuance: async () => ({ status: 'noDataYet', reason: 'no issuance arrived within 10 s' }),
        }),
      ),
    ).rejects.toThrow(NoDataYet)
  })

  it('rejects a query nothing matched rather than inventing a location', async () => {
    await expect(
      getActivityForecast('Nowhereinparticular', deps({ resolve: async () => null })),
    ).rejects.toThrow(LocationNotFound)
  })
})

describe('all four activities', () => {
  it('answers for every activity, every day', async () => {
    const forecast = await getActivityForecast('Innsbruck', deps())

    // Sorted for the comparison: the array itself is ranked, not alphabetical,
    // and the next test is the one that cares about the order.
    expect(forecast.days[0]?.activities.map((result) => result.activity).sort()).toEqual([
      'indoorSightseeing',
      'outdoorSightseeing',
      'skiing',
      'surfing',
    ])
  })

  it('scores what it can and says why it cannot score the rest', async () => {
    const forecast = await getActivityForecast('Innsbruck', deps())
    const kinds = Object.fromEntries(
      forecast.days[0]!.activities.map((result) => [result.activity, result.kind]),
    )

    // Nothing has been assessed here, which is what a geography sampling
    // failure looks like. Skiing and surfing are unavailable with a reason,
    // which is not the same as scoring them zero, and the other two still
    // answer.
    expect(kinds).toEqual({
      skiing: 'unavailable',
      surfing: 'unavailable',
      outdoorSightseeing: 'scored',
      indoorSightseeing: 'scored',
    })
  })

  it('ranks the activities within each day, best first', async () => {
    const forecast = await getActivityForecast('Innsbruck', deps())
    const ranked = forecast.days[0]!.activities.filter((result) => result.kind === 'scored')

    expect(ranked.length).toBeGreaterThan(1)
    expect(ranked[0]!.kind === 'scored' && ranked[0]!.score).toBeGreaterThanOrEqual(
      (ranked[1]!.kind === 'scored' && ranked[1]!.score) || 0,
    )
  })

  it('ranks the days within each activity, best first', async () => {
    const forecast = await getActivityForecast('Innsbruck', deps())
    const outdoor = forecast.rankings.find((entry) => entry.activity === 'outdoorSightseeing')

    expect(outdoor?.days).toHaveLength(7)
    expect(outdoor!.days[0]!.score).toBeGreaterThanOrEqual(outdoor!.days[6]!.score)
  })

  it('has no ranked days for an activity it could not score anywhere', async () => {
    const forecast = await getActivityForecast('Innsbruck', deps())

    expect(forecast.rankings.find((entry) => entry.activity === 'skiing')?.days).toEqual([])
  })

  it('states the model version it scored with', async () => {
    const forecast = await getActivityForecast('Innsbruck', deps())

    expect(forecast.modelVersion).toMatch(/^\d+\.\d+\.\d+$/)
  })
})

describe('geography decides what is answerable', () => {
  it('scores skiing against the summit series, not the city the traveller named', async () => {
    // Grenoble is the case the grid exists for: 214 m in the city, 3204 m within
    // 45 km. Scoring the city coordinate would confidently answer about a place
    // nobody skis.
    const { plans, issuance } = spyIssuance()

    const forecast = await getActivityForecast(
      'Grenoble',
      deps({ issuance, geography: async () => ({ terrain: grenobleTerrain }) }),
    )
    const skiing = forecast.days[0]?.activities.find((result) => result.activity === 'skiing')

    expect(skiing?.kind).toBe('scored')
    // The city and the high point, in one issuance. Coordinates read from the
    // geocoding fixture, not from the example document in design.md, which
    // rounds differently.
    expect(plans[0]?.city).toEqual({
      latitude: cambridge[0]!.latitude,
      longitude: cambridge[0]!.longitude,
    })
    expect(plans[0]?.summit).toEqual({ point: grenobleTerrain.point })
  })

  it('reports the assessment point, so a ski score cannot be read as a claim about the city', async () => {
    const forecast = await getActivityForecast(
      'Grenoble',
      deps({ geography: async () => ({ terrain: grenobleTerrain }) }),
    )

    expect(forecast.assessment?.terrain).toEqual({
      elevation: 3204,
      point: grenobleTerrain.point,
      distanceKm: 44.7,
      gridVersion: 'circ-50km-11x11',
    })
  })

  it('makes no second request when the terrain is below the cost gate', async () => {
    // Amsterdam, 51 m over the shipped grid. This is the whole purpose of the
    // 300 m gate: one forecast request instead of two, and an answer rather
    // than a score.
    const { plans, issuance } = spyIssuance()

    const forecast = await getActivityForecast(
      'Amsterdam',
      deps({
        issuance,
        geography: async () => ({ terrain: { ...grenobleTerrain, maxElevation: 51 } }),
      }),
    )
    const skiing = forecast.days[0]?.activities.find((result) => result.activity === 'skiing')

    expect(skiing).toEqual({
      kind: 'notApplicable',
      activity: 'skiing',
      reason: 'noTerrain',
    })
    expect(plans[0]?.summit).toEqual({ skip: { status: 'notApplicable', reason: 'noTerrain' } })
  })

  it('scores surfing from the marine series when the model has water there', async () => {
    const forecast = await getActivityForecast(
      'Lisbon',
      deps({ geography: async () => ({ marineCoverage: 'present' }) }),
    )
    const surfing = forecast.days[0]?.activities.find((result) => result.activity === 'surfing')

    expect(surfing?.kind).toBe('scored')
    // The wave inputs reached the profile rather than being dropped at the seam.
    expect(surfing?.kind === 'scored' && surfing.factors.map((f) => f.rawValue)).not.toContain(null)
  })

  it('asks the marine model nothing once it has answered "no water here"', async () => {
    // Vienna. Coverage is learned once and never re-asked, so an inland city
    // costs one forecast request per issuance and nothing else.
    const { plans, issuance } = spyIssuance()

    const forecast = await getActivityForecast(
      'Vienna',
      deps({ issuance, geography: async () => ({ marineCoverage: 'none' }) }),
    )
    const surfing = forecast.days[0]?.activities.find((result) => result.activity === 'surfing')

    expect(surfing).toEqual({
      kind: 'notApplicable',
      activity: 'surfing',
      reason: 'noMarineCoverage',
    })
    expect(plans[0]?.marine).toEqual({
      skip: { status: 'notApplicable', reason: 'noMarineCoverage' },
    })
  })

  it('refuses to merge marine days that do not line up with the forecast days', async () => {
    // The two requests carry the same past_days and forecast_days precisely so
    // this cannot happen. If it ever does, a silent index merge would score
    // Tuesday's waves against Friday's sky.
    await expect(
      getActivityForecast(
        'Lisbon',
        deps({
          geography: async () => ({ marineCoverage: 'present' }),
          issuance: spyIssuance(toDailyMarine(lisbonMarine).slice(2)).issuance,
        }),
      ),
    ).rejects.toThrow(/marine/i)
  })

  it('answers the other two activities when geography sampling failed entirely', async () => {
    const forecast = await getActivityForecast('Grenoble', deps())
    const kinds = Object.fromEntries(
      forecast.days[0]!.activities.map((result) => [result.activity, result.kind]),
    )

    expect(kinds.skiing).toBe('unavailable')
    expect(kinds.surfing).toBe('unavailable')
    expect(kinds.outdoorSightseeing).toBe('scored')
  })

  it('ranks ski days once the summit series exists', async () => {
    const forecast = await getActivityForecast(
      'Grenoble',
      deps({ geography: async () => ({ terrain: grenobleTerrain }) }),
    )
    const skiing = forecast.rankings.find((entry) => entry.activity === 'skiing')

    expect(skiing?.days).toHaveLength(7)
    expect(skiing!.days[0]!.score).toBeGreaterThanOrEqual(skiing!.days[6]!.score)
  })
})
