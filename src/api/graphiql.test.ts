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
      'WhereSkiingWasAssessed',
      'NoMountainNoOcean',
      'HowFreshIsThisAnswer',
      'LetMePickTheCambridge',
      'ForecastThatExactCambridge',
      'HowFridayChanged',
    ])
  })

  it('open with a count that matches the operations below', () => {
    // The header said "Seven queries" against eleven. Nothing read it, so
    // nothing failed, and it is the first prose the live URL serves.
    const spelled = [
      'zero', 'one', 'two', 'three', 'four', 'five', 'six',
      'seven', 'eight', 'nine', 'ten', 'eleven', 'twelve',
    ]
    const operations = document.definitions.filter(
      (definition) => definition.kind === 'OperationDefinition',
    )

    expect(defaultQuery.toLowerCase()).toContain(`${spelled[operations.length]} queries`)
  })

  it('do not date themselves to a milestone that has since shipped', () => {
    // The same header went on to say "Storage arrives in M5" — the brief's
    // headline requirement, reported as unbuilt, four milestones after it
    // shipped. A reviewer reads that before they read anything else.
    expect(defaultQuery).not.toMatch(/milestone m\d|arrives in m\d/i)
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

  it('show where a ski score was assessed, not just the number', () => {
    // The modelling point most easily missed: "Grenoble 78" is a claim about a
    // point 3204 m up and 44 km away, and a reviewer has to be able to see that
    // without reading the source.
    expect(defaultQuery).toContain('terrain { elevation distanceKm gridVersion latitude longitude }')
  })

  it('show how old the answer is and whether a refresh failed', () => {
    // The milestone the brief names by title. A reviewer must be able to see
    // that a forecast is stored rather than fetched — and that a stale one says
    // so — without reading the source.
    expect(defaultQuery).toContain('issuedAt')
    expect(defaultQuery).toContain('stale')
    expect(defaultQuery).toContain('staleReason')
  })

  it('offer the entry point for a caller who wants to choose', () => {
    // activityForecast picks and says which; searchLocations refuses to pick.
    // A reviewer has to be able to run both to see that they are two answers to
    // one ambiguity rather than one answer twice.
    expect(defaultQuery).toContain('searchLocations(')
    expect(defaultQuery).toContain('activityForecastAt(')
    expect(defaultQuery).toContain('forecastHistory(')
  })

  it('show measured absence as well as measured presence', () => {
    // notApplicable next to a real score in the same response, for two cities
    // that fail for two different reasons.
    expect(defaultQuery).toContain('Amsterdam')
    expect(defaultQuery).toContain('Vienna')
  })
})
