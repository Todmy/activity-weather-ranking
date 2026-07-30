import { z } from 'zod'
import { OpenMeteoError } from './forecast.ts'

/**
 * Terrain sampling. Not weather: this is asked once per location, ever.
 *
 * A city coordinate is the wrong place to ask whether skiing is possible —
 * Grenoble sits at 214 m with 3 km of Alps beside it — so the question is
 * asked of the terrain around the city instead. Recon measured the parameters
 * rather than guessing them, and falsified a square sample on the way: corners
 * reach 70.7 km where edges reach 50 km, and Grenoble's maximum came from a
 * corner. See `docs/recon.md`.
 *
 * Weather data by Open-Meteo.com, licensed CC BY 4.0.
 */
const ENDPOINT = 'https://api.open-meteo.com/v1/elevation'

/**
 * Pinned constants, never tuned per city. Changing any of them changes every
 * historical answer, which is why the version below travels with the result.
 *
 * `SIDE` 11 at `SPACING_KM` 10 spans ±50 km, and the inscribed circle keeps
 * exactly 81 of the 121 lattice points — under the API's 100-coordinate cap, so
 * a city costs one request.
 */
const SIDE = 11
const SPACING_KM = 10
const KM_PER_DEG_LAT = 111.32
/** Coordinates are rounded so the request string is byte-stable across runs. */
const PRECISION = 4

export const GRID_VERSION = 'circ-50km-11x11'

export type GridPoint = { latitude: number; longitude: number }

export type Terrain = {
  gridVersion: string
  maxElevation: number
  point: GridPoint
  distanceKm: number
}

const round = (value: number) => Number(value.toFixed(PRECISION))

/**
 * Row-major, south to north then west to east, so the response array can be
 * indexed back to a coordinate. The mask is an integer comparison on lattice
 * indices rather than a distance in kilometres: same circle, no floating-point
 * boundary to argue about.
 */
export const terrainGrid = (latitude: number, longitude: number): GridPoint[] => {
  const half = Math.floor(SIDE / 2)
  const kmPerDegLon = KM_PER_DEG_LAT * Math.cos((latitude * Math.PI) / 180)
  const points: GridPoint[] = []

  for (let dy = -half; dy <= half; dy += 1) {
    for (let dx = -half; dx <= half; dx += 1) {
      if (dx * dx + dy * dy > half * half) continue
      points.push({
        latitude: round(latitude + (dy * SPACING_KM) / KM_PER_DEG_LAT),
        longitude: round(longitude + (dx * SPACING_KM) / kmPerDegLon),
      })
    }
  }

  return points
}

export const buildElevationUrl = (points: GridPoint[]): string => {
  const url = new URL(ENDPOINT)
  url.searchParams.set('latitude', points.map((point) => point.latitude).join(','))
  url.searchParams.set('longitude', points.map((point) => point.longitude).join(','))
  return url.toString()
}

const elevationResponse = z.object({ elevation: z.array(z.number()) })

/**
 * `expected` is the request length. A short array would misalign every
 * elevation with the wrong coordinate, and the result would still look like a
 * mountain, so the length is part of the contract rather than a sanity check.
 */
export const parseElevation = (body: unknown, expected?: number): { elevation: number[] } => {
  const parsed = elevationResponse.parse(body)
  if (expected !== undefined && parsed.elevation.length !== expected) {
    throw new Error(
      `elevation: asked for ${expected} coordinates, got ${parsed.elevation.length}`,
    )
  }
  return parsed
}

const haversineKm = (from: GridPoint, to: GridPoint): number => {
  const toRad = (degrees: number) => (degrees * Math.PI) / 180
  const dLat = toRad(to.latitude - from.latitude)
  const dLon = toRad(to.longitude - from.longitude)
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(from.latitude)) * Math.cos(toRad(to.latitude)) * Math.sin(dLon / 2) ** 2
  return 2 * 6371 * Math.asin(Math.sqrt(a))
}

/**
 * The highest sampled point, and where it is. The distance ships with it so
 * that "Grenoble 78" cannot be misread as a claim about central Grenoble —
 * principle 5, never more confident than the data.
 *
 * Ties go to the first index, which the row-major order makes deterministic.
 */
export const sampleTerrain = (
  latitude: number,
  longitude: number,
  elevations: number[],
): Terrain => {
  const grid = terrainGrid(latitude, longitude)
  if (grid.length !== elevations.length) {
    throw new Error(
      `sampleTerrain: grid has ${grid.length} points, got ${elevations.length} elevations`,
    )
  }

  let best = 0
  for (let index = 1; index < elevations.length; index += 1) {
    if ((elevations[index] as number) > (elevations[best] as number)) best = index
  }

  const point = grid[best] as GridPoint
  return {
    gridVersion: GRID_VERSION,
    maxElevation: elevations[best] as number,
    point,
    distanceKm: Number(haversineKm({ latitude, longitude }, point).toFixed(1)),
  }
}

/**
 * One request for the whole grid. This is the expensive call in the service —
 * metered per coordinate, so 81 of the daily 10,000 — and it is why locations
 * are persisted before this provider is ever wired into the read path.
 */
export const fetchTerrain = async (latitude: number, longitude: number): Promise<Terrain> => {
  const grid = terrainGrid(latitude, longitude)
  const response = await fetch(buildElevationUrl(grid))

  if (!response.ok) {
    throw new OpenMeteoError(response.status, await response.text())
  }

  const { elevation } = parseElevation(await response.json(), grid.length)
  return sampleTerrain(latitude, longitude, elevation)
}
