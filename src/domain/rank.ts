import type { ActivityResult } from './activityResult.ts'

/**
 * Two orderings of one computation.
 *
 * "Ranks the next seven days" is ambiguous in the brief: best days for a chosen
 * activity, or best activity for a given day. Both are useful, both are the
 * same numbers, and neither re-scores anything — so the service answers both
 * rather than picking one and hiding the question. Recorded as an open question
 * with the assumption taken, in `open-questions.md`.
 *
 * Every comparison here ends in a total order. Sorting equal scores by whatever
 * the input order happened to be would make two identical requests disagree,
 * which is precisely what principle 9 forbids.
 */
export type RankedDay = {
  date: string
  score: number
  confidence: number
}

export type DayResults = {
  date: string
  activities: ActivityResult[]
}

/** Scored first, best score first, ties by activity name. */
export const rankActivitiesWithinDay = (results: ActivityResult[]): ActivityResult[] =>
  [...results].sort((a, b) => {
    if (a.kind === 'scored' && b.kind === 'scored') {
      return b.score - a.score || a.activity.localeCompare(b.activity)
    }

    // Anything unscored sorts after everything scored, then by name and kind so
    // the tail is as reproducible as the head.
    if (a.kind === 'scored') return -1
    if (b.kind === 'scored') return 1
    return a.activity.localeCompare(b.activity) || a.kind.localeCompare(b.kind)
  })

/**
 * The days one activity is worth doing, best first, ties to the earlier date.
 *
 * Days where the activity is not applicable or could not be scored are left out
 * rather than ranked at the bottom: a list of good days to ski should not
 * contain days with no answer, and the per-day view still shows why.
 */
export const rankDaysWithinActivity = (days: DayResults[], activity: string): RankedDay[] =>
  days
    .flatMap((day) => {
      const result = day.activities.find((candidate) => candidate.activity === activity)

      return result?.kind === 'scored'
        ? [{ date: day.date, score: result.score, confidence: result.confidence }]
        : []
    })
    .sort((a, b) => b.score - a.score || a.date.localeCompare(b.date))
