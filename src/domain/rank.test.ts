import { describe, expect, it } from 'vitest'
import { rankActivitiesWithinDay, rankDaysWithinActivity } from './rank.ts'
import type { ActivityResult } from './activityResult.ts'

const scored = (activity: string, score: number): ActivityResult => ({
  kind: 'scored',
  activity,
  score,
  base: score,
  confidence: 0.9,
  completeness: 1,
  factors: [],
  gates: [],
})

const notApplicable = (activity: string): ActivityResult => ({
  kind: 'notApplicable',
  activity,
  reason: 'noTerrain',
})

/**
 * "Ranks" is ambiguous in the brief — best days for an activity, or best
 * activity for a day — and the answer is both, from one computation. Neither
 * axis re-scores anything; they are two orderings of the same results.
 */
describe('rankActivitiesWithinDay', () => {
  it('orders by score, best first', () => {
    const ranked = rankActivitiesWithinDay([
      scored('skiing', 20),
      scored('surfing', 80),
      scored('indoorSightseeing', 55),
    ])

    expect(ranked.map((result) => result.activity)).toEqual([
      'surfing',
      'indoorSightseeing',
      'skiing',
    ])
  })

  it('breaks a tie on activity name, so the order is total and reproducible', () => {
    const ranked = rankActivitiesWithinDay([
      scored('surfing', 60),
      scored('indoorSightseeing', 60),
      scored('outdoorSightseeing', 60),
    ])

    // Principle 9: two identical requests must not disagree, and an arbitrary
    // sort of equal scores is exactly how they would.
    expect(ranked.map((result) => result.activity)).toEqual([
      'indoorSightseeing',
      'outdoorSightseeing',
      'surfing',
    ])
  })

  it('puts what cannot be scored last, in a fixed order rather than an accidental one', () => {
    const ranked = rankActivitiesWithinDay([
      notApplicable('surfing'),
      scored('skiing', 10),
      notApplicable('skiing'),
    ])

    expect(ranked.map((result) => `${result.activity}:${result.kind}`)).toEqual([
      'skiing:scored',
      'skiing:notApplicable',
      'surfing:notApplicable',
    ])
  })

  it('does not mutate the array it was given', () => {
    const results = [scored('a', 1), scored('b', 2)]
    rankActivitiesWithinDay(results)

    expect(results.map((result) => result.activity)).toEqual(['a', 'b'])
  })
})

describe('rankDaysWithinActivity', () => {
  const days = [
    { date: '2026-01-01', activities: [scored('skiing', 40), scored('surfing', 10)] },
    { date: '2026-01-02', activities: [scored('skiing', 90), scored('surfing', 5)] },
    { date: '2026-01-03', activities: [scored('skiing', 40), notApplicable('surfing')] },
  ]

  it('orders the days for one activity, best first', () => {
    const ranked = rankDaysWithinActivity(days, 'skiing')

    expect(ranked.map((day) => day.date)).toEqual(['2026-01-02', '2026-01-01', '2026-01-03'])
  })

  it('breaks a tie on the earlier date, because sooner is more useful', () => {
    const ranked = rankDaysWithinActivity(days, 'skiing')

    expect(ranked[1]?.date).toBe('2026-01-01')
    expect(ranked[1]?.score).toBe(40)
    expect(ranked[2]?.score).toBe(40)
  })

  it('leaves out days the activity cannot be scored on rather than ranking them as zero', () => {
    const ranked = rankDaysWithinActivity(days, 'surfing')

    expect(ranked.map((day) => day.date)).toEqual(['2026-01-01', '2026-01-02'])
  })

  it('is empty for an activity nowhere in the results', () => {
    expect(rankDaysWithinActivity(days, 'kitesurfing')).toEqual([])
  })
})
