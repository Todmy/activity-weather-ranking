import { describe, expect, it } from 'vitest'
import { parse, validate } from 'graphql'
import { defaultQuery } from './graphiql.ts'
import { schema } from './schema.ts'

/**
 * The preloaded examples are a deliverable, not decoration: principle 12 says a
 * capability a person cannot run is not delivered. An example that no longer
 * matches the schema is worse than no example, because the first thing a
 * reviewer does is press play.
 */
describe('the GraphiQL examples', () => {
  const document = parse(defaultQuery)

  it('are all valid against the schema', () => {
    expect(validate(schema, document).map((error) => error.message)).toEqual([])
  })

  it('are named, so GraphiQL can list them in its operation picker', () => {
    const names = document.definitions.map((definition) =>
      definition.kind === 'OperationDefinition' ? definition.name?.value : undefined,
    )

    expect(names).toEqual([
      'BestDaysPerActivity',
      'BestActivityPerDay',
      'WhyThatScore',
      'FiveCambridges',
      'NoSuchPlace',
    ])
  })

  it('include the states a reviewer would otherwise never see', () => {
    // Both ranking axes, the per-factor breakdown, the gates, all three members
    // of the union, and a deliberate failure. Without these the happy path is
    // the only thing anyone runs.
    expect(defaultQuery).toContain('factors { name weight rawValue curveValue contribution }')
    expect(defaultQuery).toContain('gates { name rawValue multiplier }')
    expect(defaultQuery).toContain('... on NotApplicableActivity')
    expect(defaultQuery).toContain('... on UnavailableActivity')
    expect(defaultQuery).toContain('Nowhereinparticular')
  })
})
