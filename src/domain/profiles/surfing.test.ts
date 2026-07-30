import { describe, expect, it } from 'vitest'
import { scoreProfile } from '../score.ts'
import type { WeatherInputs } from '../weather.ts'
import { surfing } from './surfing.ts'

const band = (score: number): string => {
  if (score >= 80) return 'EXCELLENT'
  if (score >= 60) return 'GOOD'
  if (score >= 40) return 'FAIR'
  return 'POOR'
}

type Row = { row: number; conditions: string; expected: string; inputs: WeatherInputs }

/**
 * The five surfing rows of `docs/sanity-table.md`, modelled for a competent
 * general traveller rather than an expert (decision #33). That assumption is
 * what caps row 3 at GOOD, and it is the single most consequential judgement in
 * this profile.
 */
const surfRows: Row[] = [
  {
    row: 1,
    conditions: 'wave 1.2 m, period 14 s, wind 8 km/h',
    expected: 'EXCELLENT',
    inputs: { waveHeightMax: 1.2, wavePeriodMax: 14, windSpeedMax: 8 },
  },
  {
    row: 2,
    conditions: 'wave 0.3 m, period 4.5 s, wind 15 km/h',
    expected: 'POOR',
    inputs: { waveHeightMax: 0.3, wavePeriodMax: 4.5, windSpeedMax: 15 },
  },
  {
    row: 3,
    conditions: 'wave 2.5 m, period 15 s, wind 10 km/h',
    expected: 'GOOD',
    // Clean, powerful, and beyond most people. EXCELLENT under an expert
    // reading; the general-traveller assumption is what caps it.
    inputs: { waveHeightMax: 2.5, wavePeriodMax: 15, windSpeedMax: 10 },
  },
  {
    row: 4,
    conditions: 'wave 1.0 m, period 7 s, wind 30 km/h',
    expected: 'POOR',
    inputs: { waveHeightMax: 1.0, wavePeriodMax: 7, windSpeedMax: 30 },
  },
  {
    row: 5,
    conditions: 'wave 1.0 m, period 11 s, wind 5 km/h',
    expected: 'EXCELLENT',
    inputs: { waveHeightMax: 1.0, wavePeriodMax: 11, windSpeedMax: 5 },
  },
]

describe('surfing, against the sanity table', () => {
  it.each(surfRows)('row $row — $conditions — $expected', ({ expected, inputs }) => {
    const result = scoreProfile(surfing, inputs)

    expect(result.score).not.toBeNull()
    expect(band(result.score!), `scored ${result.score}`).toBe(expected)
  })

  it('needs marine coverage before a score means anything', () => {
    expect(surfing.requires).toBe('marine')
  })

  it('separates surfable days from surfable places, using period', () => {
    // The recon finding, in one assertion. Chicago on Lake Michigan measured
    // 0.88 m at 4.60 s and Lisbon measured 0.44 m at 6.90 s: the lake had the
    // bigger wave. Both are windswell and both score near zero, and neither is
    // ruled out by a list of places.
    const chicago = scoreProfile(surfing, {
      waveHeightMax: 0.88,
      wavePeriodMax: 4.6,
      windSpeedMax: 10,
    })
    const lisbonFlatDay = scoreProfile(surfing, {
      waveHeightMax: 0.44,
      wavePeriodMax: 6.9,
      windSpeedMax: 10,
    })

    expect(chicago.score).toBeLessThan(40)
    expect(lisbonFlatDay.score).toBeLessThan(40)
    // And the size that fooled the first design is visibly not what did it:
    // Chicago's base is the higher of the two, the gate is what closes.
    expect(chicago.base).toBeGreaterThan(lisbonFlatDay.base!)
  })

  it('blows out on wind rather than out-weighting the swell', () => {
    const cleanSwellInAGale = scoreProfile(surfing, {
      waveHeightMax: 1.2,
      wavePeriodMax: 14,
      windSpeedMax: 45,
    })

    expect(cleanSwellInAGale.base).toBe(100)
    expect(cleanSwellInAGale.gates.map((gate) => gate.name)).toEqual(['swellPresent', 'blownOut'])
    expect(cleanSwellInAGale.score).toBe(0)
  })

  it('cites a source for every factor and every gate', () => {
    for (const entry of [...surfing.factors, ...(surfing.gates ?? [])]) {
      expect(entry.source.length).toBeGreaterThan(20)
    }
  })
})
