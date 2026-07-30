import { describe, expect, it } from 'vitest'
import { scoreProfile } from '../score.ts'
import type { WeatherInputs } from '../weather.ts'
import { outdoorSightseeing } from './outdoorSightseeing.ts'

/**
 * The five outdoor-sightseeing rows of `docs/sanity-table.md`, which were
 * written before any curve existed. The curves in the profile are fitted to
 * reproduce these bands; when they all pass, the profile is done and tuning
 * stops. That is the whole stopping rule, and it is the reason the table came
 * first.
 *
 * Two things the table does not give and this file has to supply:
 *
 *   - **Apparent temperature.** The table states air temperature; the profile
 *     scores apparent temperature, because that is what the comfort scale it
 *     cites is defined over. Each row's apparent value is stated below with the
 *     reason it differs from the air value.
 *   - **Cloud cover as a number.** "Sunny" and "overcast" become 5% and 100%.
 */
const band = (score: number): string => {
  if (score >= 80) return 'EXCELLENT'
  if (score >= 60) return 'GOOD'
  if (score >= 40) return 'FAIR'
  return 'POOR'
}

type Row = {
  row: number
  conditions: string
  expected: string
  inputs: WeatherInputs
}

const rows: Row[] = [
  {
    row: 1,
    conditions: '22 °C, sunny, wind 8 km/h, no rain',
    expected: 'EXCELLENT',
    // Sunny and calm at 22 °C feels a degree warmer than the air.
    inputs: {
      apparentTemperatureMax: 23,
      precipitationSum: 0,
      windSpeedMax: 8,
      cloudCoverMean: 5,
    },
  },
  {
    row: 2,
    conditions: '15 °C, overcast, dry, wind 12 km/h',
    expected: 'GOOD',
    // No sun and a light breeze take a degree off.
    inputs: {
      apparentTemperatureMax: 14,
      precipitationSum: 0,
      windSpeedMax: 12,
      cloudCoverMean: 100,
    },
  },
  {
    row: 3,
    conditions: '8 °C, rain 12 mm all day, wind 25 km/h',
    expected: 'POOR',
    // Wet and windy at 8 °C: apparent temperature drops well below the air.
    inputs: {
      apparentTemperatureMax: 5,
      precipitationSum: 12,
      windSpeedMax: 25,
      cloudCoverMean: 100,
    },
  },
  {
    row: 4,
    conditions: '31 °C, sunny, UV 9, still',
    expected: 'FAIR',
    // Full sun with no wind to carry the heat away reads hotter than the air.
    inputs: {
      apparentTemperatureMax: 33,
      precipitationSum: 0,
      windSpeedMax: 0,
      cloudCoverMean: 5,
      uvIndexMax: 9,
    },
  },
  {
    row: 5,
    conditions: '3 °C, clear, still, dry',
    expected: 'GOOD',
    // Clear and still: radiative loss makes it feel a degree colder.
    inputs: {
      apparentTemperatureMax: 2,
      precipitationSum: 0,
      windSpeedMax: 2,
      cloudCoverMean: 0,
    },
  },
]

describe('outdoor sightseeing, against the sanity table', () => {
  it.each(rows)('row $row — $conditions — $expected', ({ expected, inputs }) => {
    const result = scoreProfile(outdoorSightseeing, inputs)

    expect(result.score).not.toBeNull()
    expect(band(result.score!), `scored ${result.score}`).toBe(expected)
  })

  it('explains itself: every factor reports the value that produced it', () => {
    const result = scoreProfile(outdoorSightseeing, rows[3]!.inputs)

    expect(result.factors.map((factor) => factor.name)).toEqual([
      'thermalComfort',
      'precipitation',
      'wind',
      'sky',
    ])
    // Row 4 is FAIR because of heat alone: everything else is perfect.
    expect(result.factors[0]!.curveValue).toBe(0)
    expect(result.factors.slice(1).every((factor) => factor.curveValue === 1)).toBe(true)
  })

  it('carries a checkable provenance for every factor and every gate', () => {
    // `source.length > 20` was the old assertion, and prose with no
    // publication behind it passes that — which is how one uncited constant
    // survived a rule saying there are none. A source now has to carry a link,
    // or say NOT CITED and give its reasoning. Both are honest; only silence
    // is not.
    for (const entry of [...outdoorSightseeing.factors, ...(outdoorSightseeing.gates ?? [])]) {
      expect(entry.source).toMatch(/https?:\/\/|NOT CITED/)
      expect(entry.source.length).toBeGreaterThan(20)
    }
  })
})
