import { describe, expect, it } from 'vitest'
import { rampDown, rampUp } from './curves.ts'
import { scoreProfile } from './score.ts'
import type { Profile } from './score.ts'

/**
 * The engine, tested against a synthetic two-factor profile rather than a real
 * one. Calibration is a separate concern with a separate test file: a change to
 * the outdoor-sightseeing weights should not be able to break the arithmetic.
 */
const twoFactor: Profile = {
  activity: 'test',
  requires: null,
  series: 'city',
  factors: [
    {
      name: 'warmth',
      weight: 3,
      input: 'apparentTemperatureMax',
      curve: rampUp(0, 10),
      source: 'synthetic, for the engine test only',
    },
    {
      name: 'dryness',
      weight: 1,
      input: 'precipitationSum',
      curve: rampDown(0, 10),
      source: 'synthetic, for the engine test only',
    },
  ],
}

describe('scoreProfile', () => {
  it('is the weighted mean of the curve values, on a 0-100 scale', () => {
    // warmth 1.0 × 3, dryness 0.5 × 1  ->  3.5 / 4
    const result = scoreProfile(twoFactor, { apparentTemperatureMax: 10, precipitationSum: 5 })

    expect(result.score).toBe(88)
  })

  it('rounds once, at the end', () => {
    // warmth 0.5 × 3, dryness 0.3 × 1  ->  1.8 / 4 = 0.45
    const result = scoreProfile(twoFactor, { apparentTemperatureMax: 5, precipitationSum: 7 })

    expect(result.score).toBe(45)
  })

  it('reports every factor with the number that produced it', () => {
    const result = scoreProfile(twoFactor, { apparentTemperatureMax: 10, precipitationSum: 5 })

    expect(result.factors).toEqual([
      { name: 'warmth', weight: 3, rawValue: 10, curveValue: 1, contribution: 75 },
      { name: 'dryness', weight: 1, rawValue: 5, curveValue: 0.5, contribution: 12.5 },
    ])
  })

  it('has contributions that add up to the unrounded score', () => {
    const result = scoreProfile(twoFactor, { apparentTemperatureMax: 3, precipitationSum: 8 })
    const total = result.factors.reduce((sum, factor) => sum + factor.contribution, 0)

    expect(Math.round(total)).toBe(result.score)
  })

  it('drops a missing input from both sides of the mean rather than scoring it zero', () => {
    const result = scoreProfile(twoFactor, { apparentTemperatureMax: 10, precipitationSum: null })

    // Not 75: the absent factor leaves the weighted mean alone instead of
    // dragging it down, because "we do not know" is not "it rained".
    expect(result.score).toBe(100)
    expect(result.completeness).toBe(0.75)
    expect(result.factors[1]).toEqual({
      name: 'dryness',
      weight: 1,
      rawValue: null,
      curveValue: null,
      contribution: 0,
    })
  })

  it('is fully complete when every input is present', () => {
    const result = scoreProfile(twoFactor, { apparentTemperatureMax: 1, precipitationSum: 1 })

    expect(result.completeness).toBe(1)
  })

  it('has no score at all when no input is present', () => {
    const result = scoreProfile(twoFactor, { apparentTemperatureMax: null, precipitationSum: null })

    expect(result.score).toBeNull()
    expect(result.completeness).toBe(0)
  })
})

describe('gates', () => {
  const gated: Profile = {
    ...twoFactor,
    gates: [
      {
        name: 'liftsHeld',
        input: 'windGustsMax',
        curve: rampDown(56, 72),
        source: 'synthetic, for the engine test only',
      },
    ],
  }

  it('leaves the score alone while the gate is open', () => {
    const result = scoreProfile(gated, {
      apparentTemperatureMax: 10,
      precipitationSum: 5,
      windGustsMax: 20,
    })

    expect(result.score).toBe(88)
    expect(result.gates[0]?.multiplier).toBe(1)
  })

  it('scales the whole score down as the gate closes', () => {
    // 0.875 weighted mean, gate at 70 km/h -> 0.125, so 11 rather than 88.
    const result = scoreProfile(gated, {
      apparentTemperatureMax: 10,
      precipitationSum: 5,
      windGustsMax: 70,
    })

    expect(result.score).toBe(11)
    expect(result.gates[0]).toEqual({
      name: 'liftsHeld',
      rawValue: 70,
      multiplier: 0.125,
    })
  })

  it('multiplies gates together rather than taking the worst', () => {
    const twoGates: Profile = {
      ...twoFactor,
      gates: [
        { name: 'a', input: 'windGustsMax', curve: rampDown(0, 100), source: 'synthetic test gate' },
        { name: 'b', input: 'windSpeedMax', curve: rampDown(0, 100), source: 'synthetic test gate' },
      ],
    }

    const result = scoreProfile(twoGates, {
      apparentTemperatureMax: 10,
      precipitationSum: 0,
      windGustsMax: 50,
      windSpeedMax: 50,
    })

    // Two half-open gates: 100 x 0.5 x 0.5, not 100 x 0.5.
    expect(result.score).toBe(25)
  })

  it('holds the gate open when its input is missing, rather than vetoing on ignorance', () => {
    const result = scoreProfile(gated, { apparentTemperatureMax: 10, precipitationSum: 5 })

    expect(result.score).toBe(88)
    expect(result.gates[0]?.multiplier).toBe(1)
    expect(result.gates[0]?.rawValue).toBeNull()
  })
})

describe('floor', () => {
  const floored: Profile = { ...twoFactor, floor: 0.55 }

  it('lifts a weighted mean of zero to the floor', () => {
    const result = scoreProfile(floored, { apparentTemperatureMax: 0, precipitationSum: 100 })

    expect(result.score).toBe(55)
  })

  it('still reaches 100 when everything is ideal', () => {
    const result = scoreProfile(floored, { apparentTemperatureMax: 10, precipitationSum: 0 })

    expect(result.score).toBe(100)
  })

  it('compresses the range in between, rather than shifting it', () => {
    // mean 0.5 -> 0.55 + 0.45 x 0.5
    const result = scoreProfile(floored, { apparentTemperatureMax: 5, precipitationSum: 5 })

    expect(result.score).toBe(78)
  })

  it('is closed by a gate even at the floor, because open is not reachable', () => {
    const flooredAndGated: Profile = {
      ...floored,
      gates: [
        {
          name: 'travelDisruption',
          input: 'windGustsMax',
          curve: rampDown(64, 90),
          source: 'synthetic, for the engine test only',
        },
      ],
    }

    const result = scoreProfile(flooredAndGated, {
      apparentTemperatureMax: 0,
      precipitationSum: 100,
      windGustsMax: 95,
    })

    expect(result.score).toBe(0)
  })
})
