import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { graphql } from 'graphql'
import { schema } from './schema.ts'
import type { GraphQLContext } from './schema.ts'
import { parseForecast } from '../providers/openmeteo/forecast.ts'
import { parseGeocoding, toLocations } from '../providers/openmeteo/geocoding.ts'
import { DEFAULT_ISSUED_AT, freshIssuance } from '../testing/issuance.ts'

const fixture = (name: string): unknown =>
  JSON.parse(readFileSync(new URL(`../../docs/probes/${name}`, import.meta.url), 'utf8'))

/**
 * The whole path through GraphQL, on fixtures. Nothing here reaches the network
 * and nothing reaches a database: the resolved location and the stored issuance
 * both arrive through the context, which is the same door production wires the
 * refresh gateway into.
 */
const cambridge = toLocations(parseGeocoding(fixture('geocoding-cambridge.json')))
const innsbruck = parseForecast(fixture('forecast-innsbruck-past3.json'))

const contextValue: GraphQLContext = {
  release: 'test',
  deps: {
    resolve: async () => ({ location: cambridge[0]!, alternatives: cambridge.slice(1) }),
    search: async () => cambridge,
    register: async () => undefined,
    locationById: async () => cambridge[1]!,
    issuances: async () => [],
    geography: async () => ({}),
    issuance: async (plan) => freshIssuance(plan, { city: innsbruck }),
    now: () => DEFAULT_ISSUED_AT,
  },
}

describe('schema', () => {
  it('answers health without a server or a database', async () => {
    const result = await graphql({ schema, source: '{ health }' })

    expect(result.errors).toBeUndefined()
    expect(result.data).toEqual({ health: 'ok' })
  })

  it('answers activityForecast with a score and its per-factor breakdown', async () => {
    const result = await graphql({
      schema,
      contextValue,
      source: `{
        activityForecast(query: "Innsbruck") {
          location { name country admin1 }
          issuedAt
          modelVersion
          rankings { activity days { date score confidence } }
          days {
            date
            activities {
              ... on ScoredActivity {
                activity
                score
                confidence
                completeness
                factors { name weight rawValue curveValue contribution }
                gates { name rawValue multiplier }
              }
              ... on UnavailableActivity { activity reason }
              ... on NotApplicableActivity { activity reason }
            }
          }
        }
      }`,
    })

    expect(result.errors).toBeUndefined()

    const forecast = (result.data as { activityForecast: {
      location: { name: string }
      modelVersion: string
      rankings: { activity: string; days: { date: string; score: number }[] }[]
      days: {
        date: string
        activities: { activity: string; score?: number; reason?: string; factors?: unknown[] }[]
      }[]
    } }).activityForecast

    const outdoor = forecast.days[0]?.activities.find(
      (activity) => activity.activity === 'outdoorSightseeing',
    )

    expect(forecast.location.name).toBe('Cambridge')
    expect(forecast.days).toHaveLength(7)
    expect(forecast.modelVersion).toMatch(/^\d+\.\d+\.\d+$/)
    expect(outdoor?.score).toBe(55)
    expect(outdoor?.factors).toHaveLength(4)

    // The union comes back as three different shapes in one list, which is the
    // whole point of it being a union.
    const skiing = forecast.days[0]?.activities.find(
      (activity) => activity.activity === 'skiing',
    )
    expect(skiing?.score).toBeUndefined()
    expect(skiing?.reason).toMatch(/not been assessed/i)

    expect(forecast.rankings.map((ranking) => ranking.activity).sort()).toEqual([
      'indoorSightseeing',
      'outdoorSightseeing',
      'skiing',
      'surfing',
    ])
  })

  it('reports a query that matched nothing as an error naming the query', async () => {
    const result = await graphql({
      schema,
      contextValue: { deps: { ...contextValue.deps, resolve: async () => null } },
      source: '{ activityForecast(query: "Nowhereinparticular") { issuedAt } }',
    })

    expect(result.errors?.[0]?.message).toContain('Nowhereinparticular')
  })
})
