import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { printSchema } from 'graphql'
import { schema } from './schema.ts'

/**
 * The cost of code-first, paid down.
 *
 * [ADR 0002](../../docs/adr/0002-yoga-pothos-code-first.md) names it: the schema
 * exists only at runtime, so a pull request that removes a field shows a deleted
 * `t.exposeString` among TypeScript rather than a deleted line of contract. A
 * client developer has nothing to open.
 *
 * `docs/schema.graphql` is that file, and this test is what stops it becoming a
 * lie. Regenerate with `pnpm schema` — and read the diff, because on this
 * project a schema change that surprises you is the point of the check.
 */
describe('the printed schema', () => {
  it('matches the SDL committed for a reader to review', () => {
    const committed = readFileSync(
      new URL('../../docs/schema.graphql', import.meta.url),
      'utf8',
    )

    expect(printSchema(schema)).toBe(committed)
  })
})
