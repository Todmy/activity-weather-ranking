import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { createApp } from './yoga.ts'
import type { ActivityForecastDeps } from '../app/activityForecast.ts'
import { OpenMeteoError, parseForecast } from '../providers/openmeteo/forecast.ts'
import { parseGeocoding, toLocations } from '../providers/openmeteo/geocoding.ts'

const fixture = (name: string): unknown =>
  JSON.parse(readFileSync(new URL(`../../docs/probes/${name}`, import.meta.url), 'utf8'))

const deps = (overrides: Partial<ActivityForecastDeps> = {}): ActivityForecastDeps => ({
  search: async () => toLocations(parseGeocoding(fixture('geocoding-cambridge.json'))),
  weather: async () => parseForecast(fixture('forecast-innsbruck-past3.json')),
  marine: async () => ({ coverage: 'none', days: [] }),
  geography: async () => ({}),
  now: () => new Date('2026-07-29T12:00:00.000Z'),
  ...overrides,
})

const post = async (app: ReturnType<typeof createApp>, query: string): Promise<any> => {
  const response = await app.fetch('http://localhost/graphql', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ query }),
  })

  return response.json()
}

/**
 * Over HTTP, through Yoga, because Yoga is where error masking happens and a
 * schema-level test cannot see it. The not-found case reached the deployed
 * service as "Unexpected error." while passing its schema test, which is what
 * this file exists to stop.
 */
describe('the app over HTTP', () => {
  it('answers a forecast', async () => {
    const body = await post(
      createApp({ deps: deps() }),
      '{ activityForecast(query: "Innsbruck") { days { date activities { ... on ScoredActivity { score } } } } }',
    )

    expect(body.errors).toBeUndefined()
    expect(body.data.activityForecast.days).toHaveLength(7)
  })

  it('names the query in a not-found error instead of masking it as a 500', async () => {
    const body = await post(
      createApp({ deps: deps({ search: async () => [] }) }),
      '{ activityForecast(query: "Nowhereinparticular") { location { name } } }',
    )

    expect(body.errors[0].message).toContain('Nowhereinparticular')
    expect(body.errors[0].extensions.code).toBe('LOCATION_NOT_FOUND')
  })

  it('says so when Open-Meteo itself is failing, with the status it returned', async () => {
    const body = await post(
      createApp({
        deps: deps({
          weather: async () => {
            throw new OpenMeteoError(503, '{"error":true,"reason":"The service is overloaded"}')
          },
        }),
      }),
      '{ activityForecast(query: "Innsbruck") { issuedAt } }',
    )

    // A reviewer who hits a bad five minutes upstream should be told that,
    // not handed a blank 500 that looks like a bug in this service. Until the
    // cache lands in M5 there is nothing to serve instead, and saying which
    // upstream failed and how is the honest version of having nothing.
    expect(body.errors[0].extensions.code).toBe('UPSTREAM_UNAVAILABLE')
    expect(body.errors[0].message).toContain('503')
    expect(body.errors[0].extensions.upstreamStatus).toBe(503)
  })

  it('still masks a genuinely unexpected upstream failure', async () => {
    const body = await post(
      createApp({
        deps: deps({
          weather: async () => {
            throw new Error('connect ECONNREFUSED 10.0.0.1:443')
          },
        }),
      }),
      '{ activityForecast(query: "Innsbruck") { issuedAt } }',
    )

    // Deliberate: an infrastructure detail is not a caller's business. Slice 2
    // turns this into the `unavailable` state, which is a claim about the data
    // rather than an apology from the server.
    expect(body.errors[0].message).toBe('Unexpected error.')
  })
})
