import { readFileSync } from 'node:fs'
import { describe, expect, it, vi } from 'vitest'
import { searchForLocations } from './locationSearch.ts'
import type { LocationSearchDeps } from './locationSearch.ts'
import { parseGeocoding, toLocations } from '../providers/openmeteo/geocoding.ts'
import type { GeocodedLocation } from '../providers/openmeteo/geocoding.ts'

const fixture = (name: string): unknown =>
  JSON.parse(readFileSync(new URL(`../../docs/probes/${name}`, import.meta.url), 'utf8'))

const cambridges = toLocations(parseGeocoding(fixture('geocoding-cambridge.json')))
const now = new Date('2026-07-30T12:00:00.000Z')

const deps = (overrides: Partial<LocationSearchDeps> = {}): LocationSearchDeps => ({
  search: async () => cambridges,
  register: async () => undefined,
  now: () => now,
  ...overrides,
})

describe('searchForLocations', () => {
  it('hands back every candidate in upstream order, without choosing one', async () => {
    // The other half of the ambiguity answer: `activityForecast` picks and says
    // which, this one refuses to pick. A caller who wants Cambridge,
    // Massachusetts needs the list, not our opinion of it.
    const found = await searchForLocations('Cambridge', 5, deps())

    expect(found.map((location) => location.countryCode)).toEqual(
      cambridges.map((location) => location.countryCode),
    )
  })

  it('registers what it found, so the ids it hands out can be forecast', async () => {
    // `activityForecastAt` takes an id and has no way to geocode one. Without
    // this, every id from a search would be unusable until somebody happened to
    // ask for that city by name.
    const register = vi.fn(async () => undefined)

    await searchForLocations('Cambridge', 5, deps({ register }))

    expect(register).toHaveBeenCalledWith(cambridges, now)
  })

  it('asks upstream for the limit it was given', async () => {
    const search = vi.fn(async (_query: string, _limit: number) => cambridges)

    await searchForLocations('Cambridge', 3, deps({ search }))

    expect(search).toHaveBeenCalledWith('Cambridge', 3)
  })

  it('refuses a limit below one rather than asking upstream for nothing', async () => {
    // No upper bound is invented here: the geocoding API owns that, and a
    // rejection from it arrives as a named upstream error rather than as a
    // number this service made up.
    const search = vi.fn(async () => cambridges)

    await expect(searchForLocations('Cambridge', 0, deps({ search }))).rejects.toThrow(/limit/i)
    expect(search).not.toHaveBeenCalled()
  })

  it('returns an empty list rather than an error when nothing matched', async () => {
    // A search that found nothing is a valid answer to a search. Only
    // `activityForecast` has to refuse, because it has to name a place.
    const found = await searchForLocations(
      'Nowhereinparticular',
      5,
      deps({ search: async () => [] as GeocodedLocation[] }),
    )

    expect(found).toEqual([])
  })

  it('registers nothing when there was nothing to register', async () => {
    const register = vi.fn(async () => undefined)

    await searchForLocations('Nowhereinparticular', 5, deps({ search: async () => [], register }))

    expect(register).not.toHaveBeenCalled()
  })
})
