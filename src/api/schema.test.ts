import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { graphql } from 'graphql'
import { schema } from './schema.ts'
import type { GraphQLContext } from './schema.ts'
import { parseForecast } from '../providers/openmeteo/forecast.ts'
import { parseGeocoding, toLocations } from '../providers/openmeteo/geocoding.ts'

const fixture = (name: string): unknown =>
  JSON.parse(readFileSync(new URL(`../../docs/probes/${name}`, import.meta.url), 'utf8'))

/**
 * The whole path through GraphQL, on fixtures. Nothing here reaches the network:
 * the providers arrive through the context, which is the same door the refresh
 * gateway will use in slice 4.
 */
const contextValue: GraphQLContext = {
  deps: {
    search: async () => toLocations(parseGeocoding(fixture('geocoding-cambridge.json'))),
    weather: async () => parseForecast(fixture('forecast-innsbruck.json')),
    now: () => new Date('2026-07-29T12:00:00.000Z'),
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
          days {
            date
            activities {
              activity
              score
              completeness
              factors { name weight rawValue curveValue contribution }
            }
          }
        }
      }`,
    })

    expect(result.errors).toBeUndefined()

    const forecast = (result.data as { activityForecast: {
      location: { name: string }
      days: { date: string; activities: { score: number; factors: unknown[] }[] }[]
    } }).activityForecast

    expect(forecast.location.name).toBe('Cambridge')
    expect(forecast.days).toHaveLength(7)
    expect(forecast.days[1]?.activities[0]?.score).toBe(55)
    expect(forecast.days[1]?.activities[0]?.factors).toHaveLength(4)
  })

  it('reports a query that matched nothing as an error naming the query', async () => {
    const result = await graphql({
      schema,
      contextValue: { deps: { ...contextValue.deps!, search: async () => [] } },
      source: '{ activityForecast(query: "Nowhereinparticular") { issuedAt } }',
    })

    expect(result.errors?.[0]?.message).toContain('Nowhereinparticular')
  })
})
