import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { getActivityForecast, LocationNotFound } from './activityForecast.ts'
import type { ActivityForecastDeps } from './activityForecast.ts'
import { parseForecast } from '../providers/openmeteo/forecast.ts'
import { parseGeocoding, toLocations } from '../providers/openmeteo/geocoding.ts'

const fixture = (name: string): unknown =>
  JSON.parse(readFileSync(new URL(`../../docs/probes/${name}`, import.meta.url), 'utf8'))

const innsbruck = parseForecast(fixture('forecast-innsbruck-past3.json'))
const cambridge = toLocations(parseGeocoding(fixture('geocoding-cambridge.json')))

const deps = (overrides: Partial<ActivityForecastDeps> = {}): ActivityForecastDeps => ({
  search: async () => cambridge,
  weather: async () => innsbruck,
  now: () => new Date('2026-07-29T12:00:00.000Z'),
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

  it('rejects a query nothing matched rather than inventing a location', async () => {
    await expect(
      getActivityForecast('Nowhereinparticular', deps({ search: async () => [] })),
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

    // Geography arrives in slice 3. Until then skiing and surfing are
    // unavailable with a reason, which is not the same as scoring them zero.
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
