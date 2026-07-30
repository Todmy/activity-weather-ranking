import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { getActivityForecast, LocationNotFound } from './activityForecast.ts'
import type { ActivityForecastDeps } from './activityForecast.ts'
import { parseForecast } from '../providers/openmeteo/forecast.ts'
import { parseGeocoding, toLocations } from '../providers/openmeteo/geocoding.ts'

const fixture = (name: string): unknown =>
  JSON.parse(readFileSync(new URL(`../../docs/probes/${name}`, import.meta.url), 'utf8'))

const innsbruck = parseForecast(fixture('forecast-innsbruck.json'))
const cambridge = toLocations(parseGeocoding(fixture('geocoding-cambridge.json')))

const deps = (overrides: Partial<ActivityForecastDeps> = {}): ActivityForecastDeps => ({
  search: async () => cambridge,
  weather: async () => innsbruck,
  now: () => new Date('2026-07-29T12:00:00.000Z'),
  ...overrides,
})

describe('getActivityForecast', () => {
  it('scores all seven days of the issuance', async () => {
    const forecast = await getActivityForecast('Cambridge', deps())

    expect(forecast.days).toHaveLength(7)
    expect(forecast.days[0]?.date).toBe('2026-07-29')
    expect(forecast.days[0]?.activities[0]?.score).toBeTypeOf('number')
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
    // 2026-07-30 in the captured probe: 35.7 °C air, 36.0 apparent, no rain,
    // 5% cloud. Hot enough that the comfort factor is the whole story.
    const forecast = await getActivityForecast('Innsbruck', deps())
    const day = forecast.days[1]?.activities[0]

    expect(day?.score).toBe(55)
    expect(day?.factors[0]?.curveValue).toBe(0)
  })

  it('rejects a query nothing matched rather than inventing a location', async () => {
    await expect(
      getActivityForecast('Nowhereinparticular', deps({ search: async () => [] })),
    ).rejects.toThrow(LocationNotFound)
  })
})
