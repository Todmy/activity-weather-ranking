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
    expect(forecast.days[0]?.activities[0]?.score).toBeTypeOf('number')
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
    const outdoor = forecast.days[0]?.activities[0]

    expect(outdoor?.activity).toBe('outdoorSightseeing')
    expect(outdoor?.factors.map((factor) => factor.name)).toEqual([
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
    const day = forecast.days[0]?.activities[0]

    expect(day?.score).toBe(55)
    expect(day?.factors[0]?.curveValue).toBe(0)
  })

  it('rejects a query nothing matched rather than inventing a location', async () => {
    await expect(
      getActivityForecast('Nowhereinparticular', deps({ search: async () => [] })),
    ).rejects.toThrow(LocationNotFound)
  })
})
