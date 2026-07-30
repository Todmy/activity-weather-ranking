import { describe, expect, it } from 'vitest'
import { databaseNameFor } from './database.ts'

/**
 * One `mongod` serves every suite, so the thing that keeps them apart is the
 * database name — and a name chosen by hand is a name two files can pick twice.
 * Deriving it from the file's own path makes a collision impossible rather than
 * unlikely, which is the only version of this worth relying on when the suites
 * run in parallel.
 */
describe('databaseNameFor', () => {
  it('names the database after the file that owns it', () => {
    expect(databaseNameFor('file:///repo/src/persistence/locations.test.ts')).toBe(
      'persistence_locations',
    )
  })

  it('keeps the directory, because two directories may hold the same file name', () => {
    expect(databaseNameFor('file:///repo/src/app/forecasts.test.ts')).not.toBe(
      databaseNameFor('file:///repo/src/persistence/forecasts.test.ts'),
    )
  })

  it('produces a legal MongoDB database name from a path full of illegal characters', () => {
    // `/`, `.` and `$` are all forbidden in a database name, and every path has
    // the first two.
    expect(databaseNameFor('file:///repo/src/some.dir/a-b.test.ts')).toMatch(
      /^[A-Za-z0-9_-]+$/,
    )
  })
})

/**
 * There was a fourth case here — a length cap with a hash, so that truncating a
 * long path could not merge two databases into one. Two tests covered it and
 * both passed with the cap deleted, because the name is built from the last two
 * path segments: a thirty-deep directory tree still produces `directory_alpha`,
 * fifteen characters, and the branch was unreachable.
 *
 * Speculative code with vacuous tests over it, found by mutation and removed
 * rather than kept. Mongo's limit is 63 bytes and the longest name this
 * repository produces is `persistence_resolutions`.
 */
