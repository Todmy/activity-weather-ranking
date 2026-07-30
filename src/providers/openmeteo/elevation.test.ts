import { readFileSync } from 'node:fs'
import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  buildElevationUrl,
  fetchTerrain,
  GRID_VERSION,
  parseElevation,
  sampleTerrain,
  terrainGrid,
} from './elevation.ts'
import { UPSTREAM_TIMEOUT_MS } from './forecast.ts'

const probe = (name: string) =>
  JSON.parse(
    readFileSync(new URL(`../../../docs/probes/${name}.json`, import.meta.url), 'utf8'),
  ) as {
    city: { name: string; latitude: number; longitude: number }
    request: { latitude: number[]; longitude: number[] }
    response: unknown
  }

const grenoble = probe('elevation-grenoble-circ50-81')
const amsterdam = probe('elevation-amsterdam-circ50-81')

describe('terrainGrid', () => {
  it('keeps 81 of the 121 lattice points, which is what the circular mask is for', () => {
    // 11x11 at 10 km spacing spans +/- 50 km; the inscribed circle keeps 81.
    // That is also what fits inside the API's 100-coordinate cap in one request.
    expect(terrainGrid(45.1885, 5.7245)).toHaveLength(81)
  })

  it('samples no point beyond the 50 km radius it claims', () => {
    const centre = { lat: 45.1885, lon: 5.7245 }
    const worst = Math.max(
      ...terrainGrid(centre.lat, centre.lon).map((point) =>
        haversineKm(centre.lat, centre.lon, point.latitude, point.longitude),
      ),
    )
    // Bounded on both sides deliberately. An upper bound alone passes on an
    // empty grid, because Math.max of nothing is -Infinity; the lower bound is
    // what asserts the mask actually reaches the radius it advertises.
    expect(worst).toBeGreaterThan(49)
    expect(worst).toBeLessThanOrEqual(50.1)
  })

  it('reproduces the exact coordinate list the Grenoble probe was captured for', () => {
    // The fixture is evidence about the live API only while the request still
    // matches, so it carries its own request and the grid is asserted against
    // it rather than against a recording of itself.
    expect(terrainGrid(grenoble.city.latitude, grenoble.city.longitude)).toEqual(
      grenoble.request.latitude.map((latitude, index) => ({
        latitude,
        longitude: grenoble.request.longitude[index],
      })),
    )
  })

  it('reproduces the exact coordinate list the Amsterdam probe was captured for', () => {
    expect(terrainGrid(amsterdam.city.latitude, amsterdam.city.longitude)).toEqual(
      amsterdam.request.latitude.map((latitude, index) => ({
        latitude,
        longitude: amsterdam.request.longitude[index],
      })),
    )
  })

  it('is centred on the city, so the city itself is always sampled', () => {
    const grid = terrainGrid(45.1885, 5.7245)
    expect(grid).toContainEqual({ latitude: 45.1885, longitude: 5.7245 })
  })
})

describe('buildElevationUrl', () => {
  const url = new URL(buildElevationUrl(terrainGrid(45.1885, 5.7245)))

  it('sends all 81 coordinates as one request, because the cap is 100', () => {
    expect(url.searchParams.get('latitude')?.split(',')).toHaveLength(81)
    expect(url.searchParams.get('longitude')?.split(',')).toHaveLength(81)
  })

  it('matches the probe request byte for byte', () => {
    expect(url.searchParams.get('latitude')).toBe(grenoble.request.latitude.join(','))
    expect(url.searchParams.get('longitude')).toBe(grenoble.request.longitude.join(','))
  })
})

describe('parseElevation', () => {
  it('accepts the captured Grenoble response', () => {
    expect(parseElevation(grenoble.response).elevation).toHaveLength(81)
  })

  it('rejects a response whose length does not match the request', () => {
    // A short array would silently misalign every elevation with the wrong
    // coordinate, which is worse than an error because the answer still looks
    // like a mountain.
    expect(() => parseElevation({ elevation: [1, 2, 3] }, 81)).toThrow()
  })
})

describe('sampleTerrain', () => {
  it('finds Grenoble skiable, at the point it was assessed at', () => {
    const terrain = sampleTerrain(
      grenoble.city.latitude,
      grenoble.city.longitude,
      parseElevation(grenoble.response).elevation,
    )
    expect(terrain.maxElevation).toBe(3204)
    expect(terrain.point).toEqual({ latitude: 45.0088, longitude: 6.2343 })
    expect(terrain.distanceKm).toBeCloseTo(44.7, 0)
    expect(terrain.gridVersion).toBe(GRID_VERSION)
  })

  it('finds Amsterdam flat, from the shipped grid rather than a rule naming it', () => {
    const terrain = sampleTerrain(
      amsterdam.city.latitude,
      amsterdam.city.longitude,
      parseElevation(amsterdam.response).elevation,
    )
    expect(terrain.maxElevation).toBe(51)
  })

  it('names the grid it sampled, so changing the parameters is a visible event', () => {
    expect(GRID_VERSION).toBe('circ-50km-11x11')
  })
})

describe('fetchTerrain', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
  })

  const stubFetch = (response: Response): ReturnType<typeof vi.fn> => {
    const spy = vi.fn(async () => response)
    vi.stubGlobal('fetch', spy)
    return spy
  }

  it('caps its own request when the caller gives it no signal', async () => {
    // The slowest call the service makes, and it sits on the request path
    // ahead of the gateway, so the gateway's cap never reaches it. Node's
    // fetch has no default request timeout — undici's is 300 s — which made a
    // hung geocoder or elevation grid a five-minute held socket.
    const spy = stubFetch(new Response(JSON.stringify(grenoble.response), { status: 200 }))
    const timeout = vi.spyOn(AbortSignal, 'timeout')

    await fetchTerrain(grenoble.city.latitude, grenoble.city.longitude)

    expect(timeout).toHaveBeenCalledWith(UPSTREAM_TIMEOUT_MS)
    expect(spy.mock.calls[0]?.[1]).toEqual({ signal: expect.any(AbortSignal) })
    timeout.mockRestore()
  })

  it('asks once for all 81 coordinates and returns the sampled terrain', async () => {
    const spy = stubFetch(new Response(JSON.stringify(grenoble.response), { status: 200 }))

    const terrain = await fetchTerrain(grenoble.city.latitude, grenoble.city.longitude)

    expect(terrain.maxElevation).toBe(3204)
    expect(spy).toHaveBeenCalledTimes(1)
    expect(spy).toHaveBeenCalledWith(
      buildElevationUrl(terrainGrid(grenoble.city.latitude, grenoble.city.longitude)),
      // No caller signal means the client's own cap, not an uncapped socket.
      { signal: expect.any(AbortSignal) },
    )
  })

  it('turns a quota rejection into an error carrying the status', async () => {
    // This endpoint meters per coordinate, so it is the one most likely to hit
    // the wall, and "which limit" is worth keeping for whoever is on call.
    stubFetch(new Response('Daily API request limit exceeded', { status: 429 }))

    await expect(fetchTerrain(45.1885, 5.7245)).rejects.toMatchObject({
      name: 'OpenMeteoError',
      status: 429,
      message: expect.stringContaining('Daily API request limit exceeded'),
    })
  })

  it('rejects a response that came back the wrong length', async () => {
    stubFetch(new Response(JSON.stringify({ elevation: [1, 2, 3] }), { status: 200 }))

    await expect(fetchTerrain(45.1885, 5.7245)).rejects.toThrow(/81 coordinates, got 3/)
  })
})

/** Test-local, so the assertion above does not depend on the code under test. */
function haversineKm(lat1: number, lon1: number, lat2: number, lon2: number): number {
  const toRad = (degrees: number) => (degrees * Math.PI) / 180
  const dLat = toRad(lat2 - lat1)
  const dLon = toRad(lon2 - lon1)
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLon / 2) ** 2
  return 2 * 6371 * Math.asin(Math.sqrt(a))
}
