import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { buildGeocodingUrl, parseGeocoding, toLocations } from './geocoding.ts'

const cambridge = JSON.parse(
  readFileSync(new URL('../../../docs/probes/geocoding-cambridge.json', import.meta.url), 'utf8'),
) as unknown

describe('parseGeocoding', () => {
  it('accepts the captured Cambridge response', () => {
    expect(parseGeocoding(cambridge).results).toHaveLength(5)
  })

  it('treats a query that matched nothing as an empty list, not an error', () => {
    // Open-Meteo omits `results` entirely rather than sending an empty array.
    expect(parseGeocoding({ generationtime_ms: 0.3 }).results).toEqual([])
  })
})

describe('toLocations', () => {
  const locations = toLocations(parseGeocoding(cambridge))

  it('keeps every candidate for an ambiguous name rather than picking one silently', () => {
    expect(locations).toHaveLength(5)
    // As captured: England, Massachusetts, Ontario, Maryland, Ohio. Upstream
    // ranks by relevance and that order is not promised to be stable, which is
    // why slice 4 pins query -> geonameId on first resolve (decision #21).
    expect(locations.map((location) => location.countryCode)).toEqual([
      'GB',
      'US',
      'CA',
      'US',
      'US',
    ])
  })

  it('carries what a caller needs to tell two Cambridges apart', () => {
    expect(locations[0]).toEqual({
      geonameId: 2653941,
      name: 'Cambridge',
      country: 'United Kingdom',
      countryCode: 'GB',
      admin1: 'England',
      latitude: 52.2,
      longitude: 0.11667,
      elevation: 12,
      timezone: 'Europe/London',
      population: 145674,
    })
  })
})

describe('buildGeocodingUrl', () => {
  it('passes the query and a bounded result count', () => {
    const url = new URL(buildGeocodingUrl('Innsbruck', 5))

    expect(url.searchParams.get('name')).toBe('Innsbruck')
    expect(url.searchParams.get('count')).toBe('5')
  })
})
