import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { buildForecastUrl, parseForecast, toDailyWeather } from './forecast.ts'

/**
 * Every test here runs against a response captured from the live API on
 * 2026-07-29 and committed as a fixture. Nothing in this suite touches the
 * network: the free tier is 10,000 calls a day, and a test suite that spends
 * quota is a test suite people stop running.
 */
const innsbruck = JSON.parse(
  readFileSync(new URL('../../../docs/probes/forecast-innsbruck.json', import.meta.url), 'utf8'),
) as unknown

describe('parseForecast', () => {
  it('accepts the captured Innsbruck response', () => {
    const parsed = parseForecast(innsbruck)

    expect(parsed.timezone).toBe('Europe/Vienna')
    expect(parsed.elevation).toBe(580)
    expect(parsed.daily.time).toHaveLength(7)
  })

  it('rejects a response whose daily arrays disagree in length', () => {
    const misaligned = structuredClone(innsbruck) as {
      daily: { temperature_2m_max: unknown[] }
    }
    misaligned.daily.temperature_2m_max.pop()

    // A short array would silently shift every value onto the wrong date, and
    // the result would look like weather rather than like a bug.
    expect(() => parseForecast(misaligned)).toThrow(/same length/i)
  })

  it('keeps a null value null instead of reading it as zero', () => {
    const withGap = structuredClone(innsbruck) as {
      daily: { precipitation_sum: (number | null)[] }
    }
    withGap.daily.precipitation_sum[2] = null

    expect(parseForecast(withGap).daily.precipitation_sum[2]).toBeNull()
  })
})

describe('toDailyWeather', () => {
  it('maps the response onto seven days of the domain record', () => {
    const days = toDailyWeather(parseForecast(innsbruck))

    expect(days).toHaveLength(7)
    expect(days[0]).toMatchObject({
      date: '2026-07-29',
      temperatureMax: 33.3,
      apparentTemperatureMax: 33.9,
      precipitationSum: 0.3,
      snowfallSum: 0,
      windSpeedMax: 12.3,
      windGustsMax: 34.2,
      cloudCoverMean: 41,
      uvIndexMax: 6.9,
    })
  })

  it('carries local dates, not UTC instants', () => {
    const days = toDailyWeather(parseForecast(innsbruck))

    expect(days.map((day) => day.date)).toEqual([
      '2026-07-29',
      '2026-07-30',
      '2026-07-31',
      '2026-08-01',
      '2026-08-02',
      '2026-08-03',
      '2026-08-04',
    ])
  })
})

describe('buildForecastUrl', () => {
  const url = buildForecastUrl({ latitude: 47.26, longitude: 11.39 })

  it('asks for exactly the variables the fixture was captured with', () => {
    const requested = new URL(url).searchParams.get('daily')?.split(',')
    const captured = Object.keys((innsbruck as { daily: Record<string, unknown> }).daily).filter(
      (key) => key !== 'time',
    )

    // The fixture is only evidence about the live API while the request that
    // produced it still matches the request the service makes.
    expect(requested).toEqual(captured)
  })

  it('asks the API to resolve the timezone, so the dates come back local', () => {
    expect(new URL(url).searchParams.get('timezone')).toBe('auto')
    expect(new URL(url).searchParams.get('forecast_days')).toBe('7')
  })
})
