import { describe, expect, it } from 'vitest'
import { confidenceFor, horizonSkill } from './confidence.ts'

/**
 * Confidence is not a second opinion about the weather. It says how much of the
 * profile's evidence was actually present, and how far out the forecast is —
 * both of which the caller can otherwise only guess at.
 */
describe('horizonSkill', () => {
  it('anchors on the published accuracy figures', () => {
    // NOAA: five days is right about 90% of the time, seven about 80%, ten
    // about half. Day 0 is today.
    expect(horizonSkill(4)).toBeCloseTo(0.9)
    expect(horizonSkill(6)).toBeCloseTo(0.8)
    expect(horizonSkill(9)).toBeCloseTo(0.5)
  })

  it('interpolates between the anchors rather than stepping', () => {
    expect(horizonSkill(5)).toBeCloseTo(0.85)
    expect(horizonSkill(0)).toBeGreaterThan(horizonSkill(1))
    expect(horizonSkill(1)).toBeGreaterThan(horizonSkill(4))
  })

  it('never claims certainty, even for today', () => {
    expect(horizonSkill(0)).toBeLessThan(1)
    expect(horizonSkill(0)).toBeGreaterThan(0.9)
  })

  it('keeps falling past the last anchor instead of flattening out', () => {
    expect(horizonSkill(14)).toBeLessThan(0.5)
    expect(horizonSkill(60)).toBeGreaterThanOrEqual(0)
  })
})

describe('confidenceFor', () => {
  it('is the horizon skill when every input was present', () => {
    expect(confidenceFor(0, 1)).toBeCloseTo(horizonSkill(0))
  })

  it('falls with the fraction of the profile that had data', () => {
    // Half the evidence, so half the confidence in the number built from it.
    expect(confidenceFor(0, 0.5)).toBe(0.49)
  })

  it('is zero when nothing was known, whatever the horizon', () => {
    expect(confidenceFor(0, 0)).toBe(0)
  })

  it('rounds to two places, because three would be a claim about precision', () => {
    expect(confidenceFor(6, 0.77)).toBe(0.62)
  })
})
