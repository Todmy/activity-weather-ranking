import { describe, expect, it } from 'vitest'
import { rankActivitiesWithinDay, rankDaysForActivity, rankDaysWithinActivity } from './rank.ts'
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

const notApplicable = (
  activity: string,
  reason: 'noTerrain' | 'noMarineCoverage' = 'noTerrain',
): ActivityResult => ({
  kind: 'notApplicable',
  activity,
  reason,
})

const unavailable = (activity: string, reason: string): ActivityResult => ({
  kind: 'unavailable',
  activity,
  reason,
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

describe('rankDaysForActivity', () => {
  // The ranking axis drops days it cannot score, which is right — a list of good
  // days to ski should not contain days with no answer. But for a landlocked
  // city that empties the list entirely, and the first query in the README
  // returned `{ activity: 'surfing', days: [] }` with nothing saying why. The
  // reason was on the day axis only, so a caller had to know to switch axes to
  // learn that the city has no coast.
  const week = (results: ActivityResult[]) =>
    results.map((result, index) => ({ date: `2026-01-0${index + 1}`, activities: [result] }))

  it('carries the reason when one answer is true of the whole week', () => {
    const ranked = rankDaysForActivity(week([notApplicable('surfing', 'noMarineCoverage'),
      notApplicable('surfing', 'noMarineCoverage')]), 'surfing')

    expect(ranked).toEqual({ activity: 'surfing', days: [], reason: 'noMarineCoverage' })
  })

  it('says nothing when a day scored, because the list is the answer', () => {
    const ranked = rankDaysForActivity(
      [...week([notApplicable('skiing', 'noTerrain')]),
        { date: '2026-01-09', activities: [scored('skiing', 70)] }],
      'skiing',
    )

    expect(ranked.days).toHaveLength(1)
    expect(ranked.reason).toBeNull()
  })

  it('says nothing when the dropped days disagree, rather than picking one', () => {
    // No single sentence is true of the week, and inventing one would be worse
    // than the silence this replaces. The day axis is where a mixed week lives.
    const ranked = rankDaysForActivity(week([
      notApplicable('skiing', 'noTerrain'),
      unavailable('skiing', 'the forecast carried no values this profile scores'),
    ]), 'skiing')

    expect(ranked.days).toEqual([])
    expect(ranked.reason).toBeNull()
  })

  it('says nothing when the activity is absent from every day', () => {
    expect(rankDaysForActivity(week([scored('surfing', 10)]), 'skiing').reason).toBeNull()
  })
})
