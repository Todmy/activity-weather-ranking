import { readFileSync } from 'node:fs'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { buildGeocodingUrl, parseGeocoding, searchLocations, toLocations } from './geocoding.ts'
import { UPSTREAM_TIMEOUT_MS } from './forecast.ts'

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

describe('searchLocations', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
  })

  const stubFetch = (response: Response): ReturnType<typeof vi.fn> => {
    const spy = vi.fn(async () => response)
    vi.stubGlobal('fetch', spy)
    return spy
  }

  it('caps its own request when the caller gives it no signal', async () => {
    // Geocoding is the first upstream call every query makes, and it sits
    // ahead of the gateway, so the gateway's 8-second cap never reaches it.
    // Node's fetch has no default request timeout — undici's is 300 s — so an
    // endpoint that accepts the connection and stops answering held a socket
    // and a Mongo connection for five minutes.
    const spy = stubFetch(new Response(JSON.stringify(cambridge), { status: 200 }))
    const timeout = vi.spyOn(AbortSignal, 'timeout')

    await searchLocations('Cambridge')

    expect(timeout).toHaveBeenCalledWith(UPSTREAM_TIMEOUT_MS)
    expect(spy.mock.calls[0]?.[1]).toEqual({ signal: expect.any(AbortSignal) })
    timeout.mockRestore()
  })

  it('asks for the requested number of candidates and maps them', async () => {
    const spy = stubFetch(new Response(JSON.stringify(cambridge), { status: 200 }))

    const locations = await searchLocations('Cambridge', 5)

    expect(locations).toHaveLength(5)
    expect(spy).toHaveBeenCalledWith(buildGeocodingUrl('Cambridge', 5), {
      signal: expect.any(AbortSignal),
    })
  })

  it('asks for five candidates when nobody says otherwise', async () => {
    const spy = stubFetch(new Response(JSON.stringify(cambridge), { status: 200 }))

    await searchLocations('Cambridge')

    expect(spy).toHaveBeenCalledWith(buildGeocodingUrl('Cambridge', 5), {
      signal: expect.any(AbortSignal),
    })
  })

  it('returns nothing, rather than throwing, for a query that matched nothing', async () => {
    stubFetch(new Response(JSON.stringify({ generationtime_ms: 0.2 }), { status: 200 }))

    await expect(searchLocations('Nowhereinparticular')).resolves.toEqual([])
  })

  it('turns an upstream failure into an error carrying the status', async () => {
    stubFetch(new Response('upstream is having a day', { status: 503 }))

    await expect(searchLocations('Cambridge')).rejects.toMatchObject({
      name: 'OpenMeteoError',
      status: 503,
    })
  })
})
