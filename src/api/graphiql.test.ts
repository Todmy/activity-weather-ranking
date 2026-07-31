import { describe, expect, it } from 'vitest'
import { parse, validate } from 'graphql'
import { EXAMPLES } from './examples.ts'
import { defaultQuery, defaultTabs } from './graphiql.ts'
import { schema } from './schema.ts'

/**
 * What GraphiQL is handed, as opposed to what the examples say — that is
 * `examples.test.ts`. This file only checks the two derivations, because the
 * one part of this module nothing could falsify was the part that rotted.
 */
describe('what GraphiQL loads with', () => {
  const document = parse(defaultQuery)

  it('is valid against the schema as one document', () => {
    expect(validate(schema, document).map((error) => error.message)).toEqual([])
  })

  it('carries every example as a named operation, in the order the README lists them', () => {
    const names = document.definitions.flatMap((definition) =>
      definition.kind === 'OperationDefinition' ? [definition.name?.value] : [],
    )

    expect(names).toEqual(EXAMPLES.map((example) => example.name))
  })

  it('gives each example its own tab', () => {
    // A visitor with empty storage sees twelve named tabs rather than one
    // document to scroll. The operation picker still works for everyone else.
    expect(defaultTabs).toHaveLength(EXAMPLES.length)
    expect(defaultTabs.map((tab) => tab.query)).toEqual(EXAMPLES.map((example) => example.query))
  })

  it('opens with a count that matches the operations below', () => {
    // The header said "Seven queries" against eleven. Nothing read it, so
    // nothing failed, and it is the first prose the live URL serves.
    const spelled = [
      'zero', 'one', 'two', 'three', 'four', 'five', 'six',
      'seven', 'eight', 'nine', 'ten', 'eleven', 'twelve', 'thirteen',
    ]

    expect(defaultQuery.toLowerCase()).toContain(`${spelled[EXAMPLES.length]} queries`)
  })

  it('does not date itself to a milestone that has since shipped', () => {
    // The same header went on to say "Storage arrives in M5" — the brief's
    // headline requirement, reported as unbuilt, four milestones after it
    // shipped. A reviewer reads that before they read anything else.
    expect(defaultQuery).not.toMatch(/milestone m\d|arrives in m\d/i)
  })

  it('includes the states a reviewer would otherwise never see', () => {
    // Both ranking axes, the per-factor breakdown, the gates, all three members
    // of the union, and a deliberate failure. Without these the happy path is
    // the only thing anyone runs.
    expect(defaultQuery).toContain('factors { name weight rawValue curveValue contribution }')
    expect(defaultQuery).toContain('gates { name rawValue multiplier }')
    expect(defaultQuery).toContain('... on NotApplicableActivity')
    expect(defaultQuery).toContain('... on UnavailableActivity')
    expect(defaultQuery).toContain('Nowhereinparticular')
    expect(defaultQuery).toContain('terrain { elevation distanceKm gridVersion latitude longitude }')
    expect(defaultQuery).toContain('staleReason')
  })
})
