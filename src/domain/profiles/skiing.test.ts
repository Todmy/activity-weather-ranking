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
/**
 * The base rows 1-5 assume, now that they have to say so.
 *
 * Exactly the [S10] threshold rather than a comfortable number above it: it is
 * the lowest depth consistent with what the table claims, so a row that passes
 * here passes at any deeper base. Before the gate existed this assumption was
 * unspoken in the table AND absent from these scenarios, which is the whole
 * reason a bare summer mountain scored 35.
 */
const ASSUMED_BASE_CM = 30

const skiRows: Row[] = [
  {
    row: 1,
    conditions: '-4 °C, 25 cm fresh over 3 days, wind 10 km/h, clear',
    expected: 'EXCELLENT',
    inputs: { temperatureMax: -4, snowfall3d: 25, windGustsMax: 10, rainSum: 0, snowDepth: ASSUMED_BASE_CM },
  },
  {
    row: 2,
    conditions: '-8 °C, no snowfall for 2 weeks, gusts 45 km/h, clear',
    expected: 'FAIR',
    // The row the table flags as arguable against GOOD. Lifts still run at 45.
    inputs: { temperatureMax: -8, snowfall3d: 0, windGustsMax: 45, rainSum: 0, snowDepth: ASSUMED_BASE_CM },
  },
  {
    row: 3,
    conditions: '+2 °C, 5 cm fresh, turning to rain during the day',
    expected: 'POOR',
    inputs: { temperatureMax: 2, snowfall3d: 5, windGustsMax: 15, rainSum: 6, snowDepth: ASSUMED_BASE_CM },
  },
  {
    row: 4,
    conditions: '-15 °C, 40 cm fresh, gusts 70 km/h',
    expected: 'POOR',
    // The veto row. Everything about the snow is exceptional and unreachable.
    inputs: { temperatureMax: -15, snowfall3d: 40, windGustsMax: 70, rainSum: 0, snowDepth: ASSUMED_BASE_CM },
  },
  {
    row: 5,
    conditions: '-2 °C, no fresh snow, a week cold and dry, sunny',
    expected: 'GOOD',
    inputs: { temperatureMax: -2, snowfall3d: 0, windGustsMax: 5, rainSum: 0, snowDepth: ASSUMED_BASE_CM },
  },
  {
    row: 6,
    conditions: '+14 °C, base 0 cm, no snowfall for a month',
    expected: 'POOR',
    // The reported bug. See the separate assertion below: POOR alone does not
    // catch it, because the shipped model already scored this 35.
    inputs: { temperatureMax: 14, snowfall3d: 0, windGustsMax: 8, rainSum: 0, snowDepth: 0 },
  },
  {
    row: 7,
    conditions: '-2 °C, base 120 cm, no fresh snow for 10 days, sunny',
    expected: 'GOOD',
    // Row 5 with the base spoken aloud, four times the threshold. It exists to
    // fail if the gate fires on a preserved base.
    inputs: { temperatureMax: -2, snowfall3d: 0, windGustsMax: 5, rainSum: 0, snowDepth: 120 },
  },
  {
    row: 8,
    conditions: '-6 °C, base 15 cm, 3 cm fresh',
    expected: 'POOR',
    // Half the threshold. The only row of the three the band alone can catch:
    // without the gate this scores 72 = GOOD.
    inputs: { temperatureMax: -6, snowfall3d: 3, windGustsMax: 10, rainSum: 0, snowDepth: 15 },
  },
]

describe('skiing, against the sanity table', () => {
  it.each(skiRows)('row $row — $conditions — $expected', ({ expected, inputs }) => {
    const result = scoreProfile(skiing, inputs)

    expect(result.score).not.toBeNull()
    expect(band(result.score!), `scored ${result.score}`).toBe(expected)
  })

  it('scores a bare mountain at zero, which the band alone cannot check', () => {
    // Sanity row 6 was added after an independent review found this. The row is
    // necessary and NOT sufficient: POOR spans 0-39 and the shipped model
    // scored a bare 14 °C summit at 35, so the row would have passed while the
    // service ranked a snowless mountain as the best ski day of the week.
    //
    // That is a finding about the table's resolution, not only about the model:
    // a band is too coarse to express "impossible", and the four factors cannot
    // either — zero temperature and zero fresh snow surrender their own weight
    // and leave wind and rain carrying 7 of 20. Only a gate multiplies.
    const bareMountain: WeatherInputs = {
      temperatureMax: 14,
      snowfall3d: 0,
      windGustsMax: 8,
      rainSum: 0,
      snowDepth: 0,
    }

    const result = scoreProfile(skiing, bareMountain)

    expect(result.score).toBe(0)
    // The factors still say what they said; the gate is what makes it nothing.
    expect(result.base).toBeCloseTo(35, 0)
    expect(result.gates.find((gate) => gate.name === 'snowPresent')?.multiplier).toBe(0)
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
      // Stated rather than left missing, so this isolates the wind gate. A
      // missing input leaves a gate open, and a test that relies on that is
      // measuring the absence of data instead of the presence of a gale.
      snowDepth: ASSUMED_BASE_CM,
    }
    const result = scoreProfile(skiing, powderInAGale)

    // The base is excellent and the gate is what makes the day POOR. This is
    // the distinction min() would have thrown away: 40 cm in a gale and 5 cm
    // in a gale are both unskiable, and they are not the same day.
    expect(result.base).toBeGreaterThan(70)
    // By name, not by position: skiing has two gates now and the order of a
    // list is not something a test should be asserting on by accident.
    const gate = (name: string) => result.gates.find((entry) => entry.name === name)
    expect(gate('liftsHeld')?.multiplier).toBeLessThan(0.2)
    expect(gate('snowPresent')?.multiplier).toBe(1)
  })

  it('carries a checkable provenance for every factor and every gate', () => {
    // `source.length > 20` was the old assertion, and prose with no
    // publication behind it passes that — which is how one uncited constant
    // survived a rule saying there are none. A source now has to carry a link,
    // or say NOT CITED and give its reasoning. Both are honest; only silence
    // is not.
    for (const entry of [...skiing.factors, ...(skiing.gates ?? [])]) {
      expect(entry.source).toMatch(/https?:\/\/|NOT CITED/)
      expect(entry.source.length).toBeGreaterThan(20)
    }
  })
})
