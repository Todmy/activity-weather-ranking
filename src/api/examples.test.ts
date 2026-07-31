import { describe, expect, it } from 'vitest'
import { parse, validate } from 'graphql'
import { EXAMPLES } from './examples.ts'
import { schema } from './schema.ts'

/**
 * The examples are the deliverable under principle 12, and this suite is what
 * stops them becoming decoration.
 *
 * They are data rather than one long string because three things now read them:
 * GraphiQL's tabs, the README's table of links, and these tests. A string only
 * the editor could read is how the header came to say "Seven queries" against
 * eleven for four milestones.
 */
describe('the runnable examples', () => {
  it('are each a single named operation, valid against the schema', () => {
    for (const example of EXAMPLES) {
      const document = parse(example.query)
      const operations = document.definitions.filter(
        (definition) => definition.kind === 'OperationDefinition',
      )

      expect(operations, example.name).toHaveLength(1)
      expect(validate(schema, document).map((error) => error.message), example.name).toEqual([])
    }
  })

  it('name the operation the tab and the README row are labelled with', () => {
    // A tab called something the query does not define is a link that lands a
    // tester somewhere they cannot check against the table they came from.
    for (const example of EXAMPLES) {
      expect(example.query, example.name).toContain(`query ${example.name}`)
    }
  })

  it('tell a tester what to check and what a pass looks like', () => {
    // Written for someone who does not read GraphQL. "It returned something"
    // is not a result; the expectation has to be checkable by eye.
    for (const example of EXAMPLES) {
      expect(example.checks.length, `${example.name}: checks`).toBeGreaterThan(20)
      expect(example.expect.length, `${example.name}: expect`).toBeGreaterThan(20)
      // A table cell, not a paragraph — the prose belongs in the query comment.
      expect(example.checks.length, `${example.name}: checks`).toBeLessThan(160)
      expect(example.expect.length, `${example.name}: expect`).toBeLessThan(200)
    }
  })

  it('cover every field the schema exposes, so no capability is unreachable', () => {
    // Constitution 12 in its strongest form: a field a reviewer cannot run is
    // not delivered. This fails when a field is added without an example.
    const selections = EXAMPLES.flatMap((example) =>
      // Selections only. A field named in a comment is not a field anyone ran.
      example.query
        .split('\n')
        .filter((line) => !line.trimStart().startsWith('#'))
        .join('\n'),
    ).join('\n')
    const rootFields = Object.keys(schema.getQueryType()?.getFields() ?? {})

    for (const field of rootFields) {
      expect(selections, `no example runs ${field}`).toMatch(new RegExp(`\\b${field}\\b`))
    }
  })

  it('include a failure a tester can trigger on purpose', () => {
    // Every example succeeding would teach a tester nothing about how this
    // service refuses, which is the half most services get wrong.
    expect(EXAMPLES.some((example) => example.query.includes('Nowhereinparticular'))).toBe(true)
  })
})
