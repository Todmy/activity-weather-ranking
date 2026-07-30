import { readFileSync } from 'node:fs'
import { describe, expect, it, vi } from 'vitest'
import { getForecastHistory } from './forecastHistory.ts'
import type { ForecastHistoryDeps } from './forecastHistory.ts'
import { LocationNotFound } from './activityForecast.ts'
import { issuanceFrom } from '../testing/issuance.ts'
import type { IssuanceDocument } from '../persistence/forecasts.ts'
import { parseForecast } from '../providers/openmeteo/forecast.ts'
import { parseGeocoding, toLocations } from '../providers/openmeteo/geocoding.ts'

const fixture = (name: string): unknown =>
  JSON.parse(readFileSync(new URL(`../../docs/probes/${name}`, import.meta.url), 'utf8'))

const innsbruck = parseForecast(fixture('forecast-innsbruck-past3.json'))
const cambridge = toLocations(parseGeocoding(fixture('geocoding-cambridge.json')))

const LOCATION = 'geoname:2653941'

/** The plan every stored issuance in these tests was fetched under. */
const plan = {
  locationId: LOCATION,
  city: { latitude: 52.2, longitude: 0.11667 },
  summit: { skip: { status: 'notApplicable' as const, reason: 'noTerrain' } },
  marine: { skip: { status: 'notApplicable' as const, reason: 'noMarineCoverage' } },
}

const issuedAtDaily = (index: number) =>
  new Date(Date.UTC(2026, 6, 27) + index * 24 * 60 * 60 * 1000)

const addDays = (date: string, days: number) =>
  new Date(new Date(`${date}T00:00:00Z`).getTime() + days * 24 * 60 * 60 * 1000)
    .toISOString()
    .slice(0, 10)

/**
 * An older issuance covers an earlier window, so the same date sits further out
 * in it. Re-dating the fixture is what makes the horizon vary — without it every
 * issuance would report the same horizon and the test would prove nothing.
 */
const shiftedBack = (document: IssuanceDocument, days: number): IssuanceDocument => ({
  ...document,
  city: {
    ...document.city,
    days: (document.city.days ?? []).map((day) => ({ ...day, date: addDays(day.date, -days) })),
  },
})

/** Three issuances, one a day apart, each covering its own seven days. */
const threeIssuances: IssuanceDocument[] = [0, 1, 2].map((age) =>
  shiftedBack(issuanceFrom(plan, { city: innsbruck }, issuedAtDaily(2 - age)), age),
)

const deps = (overrides: Partial<ForecastHistoryDeps> = {}): ForecastHistoryDeps => ({
  locationById: async () => cambridge[0]!,
  geography: async () => ({}),
  issuances: async () => threeIssuances,
  now: () => new Date('2026-07-30T12:00:00.000Z'),
  ...overrides,
})

describe('getForecastHistory', () => {
  it('shows one date as every issuance saw it, newest first', async () => {
    // The whole reason issuances are kept rather than upserted. An upsert
    // answers "what is the forecast for Friday" and destroys "what did we think
    // on Tuesday that Friday would be".
    const history = await getForecastHistory(LOCATION, '2026-08-02', deps())

    expect(history).toHaveLength(3)
    expect(history.map((entry) => entry.issuedAt)).toEqual([
      issuedAtDaily(2).toISOString(),
      issuedAtDaily(1).toISOString(),
      issuedAtDaily(0).toISOString(),
    ])
    expect(history.every((entry) => entry.day.date === '2026-08-02')).toBe(true)
  })

  it('says how far ahead that date was in each issuance', async () => {
    // The point of the comparison: the same date is a different question at a
    // six-day horizon than at a one-day horizon, and confidence says so.
    const history = await getForecastHistory(LOCATION, '2026-08-02', deps())

    // Each issuance is a day older, so its window starts a day earlier and the
    // same date sits a day further out in it.
    expect(history.map((entry) => entry.horizonDays)).toEqual([3, 4, 5])

    const confidenceAt = (index: number) => {
      const scored = history[index]!.day.activities.find((result) => result.kind === 'scored')
      return scored?.kind === 'scored' ? scored.confidence : 0
    }
    // The reason the horizon is worth reporting: a six-day-out answer is a
    // weaker claim than a three-day-out one, and the numbers say so.
    expect(confidenceAt(0)).toBeGreaterThan(confidenceAt(2))
  })

  it('scores a replayed issuance exactly as it was scored when it was current', async () => {
    // Principle 9: the same stored issuance and the same model version give the
    // same numbers a week later. If replay scored differently, the stored bytes
    // would not be the record they are claimed to be.
    const once = await getForecastHistory(LOCATION, '2026-08-02', deps())
    const again = await getForecastHistory(LOCATION, '2026-08-02', deps())

    expect(again).toEqual(once)
    expect(once.every((entry) => entry.modelVersion === once[0]!.modelVersion)).toBe(true)
  })

  it('skips issuances that never covered the date, rather than padding them', async () => {
    const history = await getForecastHistory(LOCATION, '2027-01-01', deps())

    expect(history).toEqual([])
  })

  it('refuses an id it has never stored', async () => {
    await expect(
      getForecastHistory('geoname:1', '2026-08-02', deps({ locationById: async () => null })),
    ).rejects.toThrow(LocationNotFound)
  })

  it('returns nothing for a known location with no issuances', async () => {
    const history = await getForecastHistory(
      LOCATION,
      '2026-08-02',
      deps({ issuances: async () => [] }),
    )

    expect(history).toEqual([])
  })

  it('asks for the geography once, not once per issuance', async () => {
    // Geography is a property of the place, not of the fetch. Asking per
    // issuance would multiply a read-through by 24.
    const geography = vi.fn(async () => ({}))

    await getForecastHistory(LOCATION, '2026-08-02', deps({ geography }))

    expect(geography).toHaveBeenCalledTimes(1)
  })
})
