/**
 * The verdict a score falls in, from `docs/sanity-table.md`.
 *
 * The brief asks how *good* the next seven days will be, and a bare integer
 * answers half of that: a caller has to know that 61 is a good day and 59 is a
 * middling one, and nothing in the response tells them. The sanity table has
 * carried these four bands since before any curve existed — every row states
 * one — and they were reachable only from the test suite until now.
 *
 * Named `bandFor` rather than `band` because `curves.ts` already exports a
 * `band(a, b, c, d)` curve constructor, which is a different idea entirely: one
 * shapes a membership curve, this one labels a finished score.
 */
export type Band = 'POOR' | 'FAIR' | 'GOOD' | 'EXCELLENT'

export const bandFor = (score: number): Band => {
  if (score >= 80) return 'EXCELLENT'
  if (score >= 60) return 'GOOD'
  if (score >= 40) return 'FAIR'
  return 'POOR'
}
