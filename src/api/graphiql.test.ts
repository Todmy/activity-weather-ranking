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
      'OutdoorSightseeing',
      'WhyThatScore',
      'FiveCambridges',
      'NoSuchPlace',
    ])
  })

  it('include the two states a reviewer would otherwise never see', () => {
    // The per-factor breakdown and a deliberate failure. Without these the
    // happy path is the only thing anyone runs.
    expect(defaultQuery).toContain('factors { name weight rawValue curveValue contribution }')
    expect(defaultQuery).toContain('Nowhereinparticular')
  })
})
