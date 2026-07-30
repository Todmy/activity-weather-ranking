import { describe, expect, it } from 'vitest'
import { evaluateActivity } from './activityResult.ts'
import { skiing } from './profiles/skiing.ts'
import { surfing } from './profiles/surfing.ts'
import { outdoorSightseeing } from './profiles/outdoorSightseeing.ts'

const summerDay = {
  apparentTemperatureMax: 23,
  precipitationSum: 0,
  windSpeedMax: 8,
  cloudCoverMean: 5,
}

const assessed = { hasTerrain: true, hasMarineCoverage: true }

/**
 * Three states, because three different things are true (design-questions Q1+2
 * and principle 4). "Vienna has no ocean", "the marine fetch failed" and
 * "conditions are bad" are three claims, and a nullable score can only carry
 * one of them.
 */
describe('evaluateActivity', () => {
  it('scores when the geography allows it', () => {
    const result = evaluateActivity(outdoorSightseeing, summerDay, {
      dayIndex: 0,
      geography: assessed,
    })

    expect(result.kind).toBe('scored')
    expect(result.kind === 'scored' && result.score).toBe(100)
  })

  it('carries confidence that falls with the forecast horizon', () => {
    const today = evaluateActivity(outdoorSightseeing, summerDay, {
      dayIndex: 0,
      geography: assessed,
    })
    const nextWeek = evaluateActivity(outdoorSightseeing, summerDay, {
      dayIndex: 6,
      geography: assessed,
    })

    expect(today.kind === 'scored' && today.confidence).toBe(0.97)
    expect(nextWeek.kind === 'scored' && nextWeek.confidence).toBe(0.8)
  })

  it('says notApplicable, not zero, where there is no terrain', () => {
    const result = evaluateActivity(skiing, summerDay, {
      dayIndex: 0,
      geography: { hasTerrain: false, hasMarineCoverage: true },
    })

    // Telling someone Amsterdam scores 0 for skiing is a different claim from
    // telling them Amsterdam has no mountain.
    expect(result).toEqual({ activity: 'skiing', kind: 'notApplicable', reason: 'noTerrain' })
  })

  it('says notApplicable where the marine grid has no coverage', () => {
    const result = evaluateActivity(surfing, summerDay, {
      dayIndex: 0,
      geography: { hasTerrain: true, hasMarineCoverage: false },
    })

    expect(result).toEqual({
      activity: 'surfing',
      kind: 'notApplicable',
      reason: 'noMarineCoverage',
    })
  })

  it('says unavailable while the geography is unknown, which is not the same as absent', () => {
    const result = evaluateActivity(skiing, summerDay, {
      dayIndex: 0,
      geography: { hasTerrain: null, hasMarineCoverage: null },
    })

    expect(result.kind).toBe('unavailable')
    expect(result.kind === 'unavailable' && result.reason).toMatch(/not been assessed/i)
  })

  it('says unavailable when the day carried none of the inputs the profile needs', () => {
    const result = evaluateActivity(outdoorSightseeing, {}, { dayIndex: 0, geography: assessed })

    expect(result.kind).toBe('unavailable')
    expect(result.kind === 'unavailable' && result.reason).toMatch(/no .*values/i)
  })

  it('reports partial data as a scored day with lower confidence, not as unavailable', () => {
    const result = evaluateActivity(
      outdoorSightseeing,
      { apparentTemperatureMax: 23 },
      { dayIndex: 0, geography: assessed },
    )

    // Half the inputs missing is still an answer, and the confidence says how
    // much of one. Refusing to answer would be worse than saying how sure we are.
    expect(result.kind).toBe('scored')
    expect(result.kind === 'scored' && result.completeness).toBeLessThan(0.5)
    expect(result.kind === 'scored' && result.confidence).toBeLessThan(0.5)
  })
})
