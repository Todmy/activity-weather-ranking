import { describe, expect, it } from 'vitest'
import { MODEL_VERSION, serialiseModel } from './modelVersion.ts'

/**
 * Principle 9 promises that the same stored issuance and the same model version
 * always produce the same ranking. That promise is only checkable if the model
 * version is impossible to forget, which is what the snapshot below is for: any
 * threshold, weight, gate or floor that moves changes the serialised model, the
 * snapshot fails, and updating it puts the version right next to the change in
 * the diff.
 */
describe('the pinned model', () => {
  it('serialises every number that can change a score', () => {
    expect(serialiseModel()).toMatchSnapshot()
  })

  it('carries the version inside the snapshot, so a bump cannot be skipped quietly', () => {
    expect(serialiseModel().version).toBe(MODEL_VERSION)
  })

  it('carries the terrain gate, which flips skiing between notApplicable and a score', () => {
    // Not a weight and not a curve, so it would have escaped the snapshot on the
    // profile shape alone — and it changes more than a score does. 300 m is the
    // difference between "Amsterdam has no mountain" and Amsterdam being asked
    // the question at all.
    expect(serialiseModel().geography).toEqual({
      terrainMinElevationM: 300,
      source: 'docs/recon.md, elevation calibration over 16 cities',
    })
  })

  it('covers all four activities', () => {
    expect(serialiseModel().profiles.map((profile) => profile.activity)).toEqual([
      'skiing',
      'surfing',
      'outdoorSightseeing',
      'indoorSightseeing',
    ])
  })

  it('records the curve bounds themselves, not just the factor names', () => {
    const skiing = serialiseModel().profiles.find((profile) => profile.activity === 'skiing')
    const freshSnow = skiing?.factors.find((factor) => factor.name === 'freshSnow')

    expect(freshSnow?.curve).toEqual({ kind: 'rampUp', bounds: [2, 20] })
  })

  it('is a semver, because a hash tells a reviewer nothing', () => {
    expect(MODEL_VERSION).toMatch(/^\d+\.\d+\.\d+$/)
  })
})
