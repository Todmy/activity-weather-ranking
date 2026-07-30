import { describe, expect, it } from 'vitest'
import { geographyFrom, TERRAIN_MIN_ELEVATION_M } from './geography.ts'

describe('TERRAIN_MIN_ELEVATION_M', () => {
  it('is 300 m, and is a cost gate rather than a ski test', () => {
    // Recon measured elevation against 16 cities and falsified the idea that it
    // separates ski from non-ski: Oslo skis at 631 m and sits below Barcelona at
    // 1025 m, which does not. Latitude is the missing variable and the snow
    // forecast already carries it, so the threshold survives only to decide
    // whether a second forecast request is worth making. It is deliberately low,
    // because a false notApplicable is permanent where a false 'applicable'
    // costs one request.
    expect(TERRAIN_MIN_ELEVATION_M).toBe(300)
  })
})

describe('geographyFrom', () => {
  const terrainAt = (maxElevation: number) => ({
    gridVersion: 'circ-50km-11x11',
    maxElevation,
    point: { latitude: 45.0088, longitude: 6.2343 },
    distanceKm: 44.7,
  })

  it('gives Grenoble terrain, from the sampled high point rather than the city', () => {
    // Grenoble is the case the whole grid exists for: 214 m in the city, 3204 m
    // within 45 km.
    expect(geographyFrom(terrainAt(3204), 'none').hasTerrain).toBe(true)
  })

  it('gives Amsterdam no terrain, at 51 m over the shipped grid', () => {
    expect(geographyFrom(terrainAt(51), 'present').hasTerrain).toBe(false)
  })

  it('includes the threshold itself, so the boundary is not an accident', () => {
    expect(geographyFrom(terrainAt(300), 'none').hasTerrain).toBe(true)
    expect(geographyFrom(terrainAt(299.9), 'none').hasTerrain).toBe(false)
  })

  it('reads marine coverage straight through, because the model already decided it', () => {
    expect(geographyFrom(terrainAt(51), 'present').hasMarineCoverage).toBe(true)
    expect(geographyFrom(terrainAt(51), 'none').hasMarineCoverage).toBe(false)
  })

  it('says "not assessed" rather than "no" when a sample is missing', () => {
    // The distinction the API keeps: we have not looked, versus there is no
    // mountain here. Only the second is an answer.
    expect(geographyFrom(undefined, undefined)).toEqual({
      hasTerrain: null,
      hasMarineCoverage: null,
    })
  })

  it('reports each side independently, because the two samples can fail apart', () => {
    expect(geographyFrom(terrainAt(3204), undefined)).toEqual({
      hasTerrain: true,
      hasMarineCoverage: null,
    })
    expect(geographyFrom(undefined, 'present')).toEqual({
      hasTerrain: null,
      hasMarineCoverage: true,
    })
  })
})
