import { describe, expect, it } from 'vitest'
import { scoreProfile } from '../score.ts'
import type { WeatherInputs } from '../weather.ts'
import { skiing } from './skiing.ts'

const band = (score: number): string => {
  if (score >= 80) return 'EXCELLENT'
  if (score >= 60) return 'GOOD'
  if (score >= 40) return 'FAIR'
  return 'POOR'
}

type Row = { row: number; conditions: string; expected: string; inputs: WeatherInputs }

/**
 * The five skiing rows of `docs/sanity-table.md`, written before any curve.
 *
 * Assessed at the sampled high point rather than at the city, which is what
 * `series: 'summit'` means; slice 3 supplies that series, and until then these
 * tests hand the profile the numbers directly.
 *
 * The table gives air temperature and describes wind as gusts, so that is what
 * these scenarios carry. Where a row is silent — cloud, rain on a clear day —
 * the scenario states the benign value and says so.
 */
const skiRows: Row[] = [
  {
    row: 1,
    conditions: '-4 °C, 25 cm fresh over 3 days, wind 10 km/h, clear',
    expected: 'EXCELLENT',
    inputs: { temperatureMax: -4, snowfall3d: 25, windGustsMax: 10, rainSum: 0 },
  },
  {
    row: 2,
    conditions: '-8 °C, no snowfall for 2 weeks, gusts 45 km/h, clear',
    expected: 'FAIR',
    // The row the table flags as arguable against GOOD. Lifts still run at 45.
    inputs: { temperatureMax: -8, snowfall3d: 0, windGustsMax: 45, rainSum: 0 },
  },
  {
    row: 3,
    conditions: '+2 °C, 5 cm fresh, turning to rain during the day',
    expected: 'POOR',
    inputs: { temperatureMax: 2, snowfall3d: 5, windGustsMax: 15, rainSum: 6 },
  },
  {
    row: 4,
    conditions: '-15 °C, 40 cm fresh, gusts 70 km/h',
    expected: 'POOR',
    // The veto row. Everything about the snow is exceptional and unreachable.
    inputs: { temperatureMax: -15, snowfall3d: 40, windGustsMax: 70, rainSum: 0 },
  },
  {
    row: 5,
    conditions: '-2 °C, no fresh snow, a week cold and dry, sunny',
    expected: 'GOOD',
    inputs: { temperatureMax: -2, snowfall3d: 0, windGustsMax: 5, rainSum: 0 },
  },
]

describe('skiing, against the sanity table', () => {
  it.each(skiRows)('row $row — $conditions — $expected', ({ expected, inputs }) => {
    const result = scoreProfile(skiing, inputs)

    expect(result.score).not.toBeNull()
    expect(band(result.score!), `scored ${result.score}`).toBe(expected)
  })

  it('needs terrain before a score means anything', () => {
    expect(skiing.requires).toBe('terrain')
    expect(skiing.series).toBe('summit')
  })

  it('vetoes on held lifts rather than out-weighting the snow', () => {
    const powderInAGale: WeatherInputs = {
      temperatureMax: -15,
      snowfall3d: 40,
      windGustsMax: 70,
      rainSum: 0,
    }
    const result = scoreProfile(skiing, powderInAGale)

    // The base is excellent and the gate is what makes the day POOR. This is
    // the distinction min() would have thrown away: 40 cm in a gale and 5 cm
    // in a gale are both unskiable, and they are not the same day.
    expect(result.base).toBeGreaterThan(70)
    expect(result.gates[0]?.name).toBe('liftsHeld')
    expect(result.gates[0]?.multiplier).toBeLessThan(0.2)
  })

  it('cites a source for every factor and every gate', () => {
    for (const entry of [...skiing.factors, ...(skiing.gates ?? [])]) {
      expect(entry.source.length).toBeGreaterThan(20)
    }
  })
})
