import { describe, expect, it } from 'vitest'
import { bandFor } from './band.ts'

/**
 * The boundaries are asserted as literals rather than derived from the code
 * under test, for the same reason the four profile suites keep their own local
 * `band` helper: a table that reads its target off the thing it is testing
 * cannot fail.
 *
 * Bands from `docs/sanity-table.md`: EXCELLENT 80-100, GOOD 60-79, FAIR 40-59,
 * POOR 0-39.
 */
describe('bandFor', () => {
  it('puts each boundary on the side the sanity table puts it', () => {
    expect(bandFor(0)).toBe('POOR')
    expect(bandFor(39)).toBe('POOR')
    expect(bandFor(40)).toBe('FAIR')
    expect(bandFor(59)).toBe('FAIR')
    expect(bandFor(60)).toBe('GOOD')
    expect(bandFor(79)).toBe('GOOD')
    expect(bandFor(80)).toBe('EXCELLENT')
    expect(bandFor(100)).toBe('EXCELLENT')
  })

  it('agrees with the four profile suites, which each keep their own copy', () => {
    // Those copies are deliberate — see the note above — but if this one ever
    // disagreed with them the API would be publishing a verdict the sanity
    // table does not endorse, which is worse than the duplication.
    const local = (score: number): string =>
      score >= 80 ? 'EXCELLENT' : score >= 60 ? 'GOOD' : score >= 40 ? 'FAIR' : 'POOR'

    for (let score = 0; score <= 100; score += 1) {
      expect(bandFor(score), `score ${score}`).toBe(local(score))
    }
  })
})
