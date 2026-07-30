import { z } from 'zod'
import { OpenMeteoError } from './forecast.ts'

/**
 * Open-Meteo geocoding: a name in, candidate places out.
 *
 * Schema written from `docs/probes/geocoding-cambridge.json`, which is the probe
 * that established what "Cambridge" returns and in what order. Every candidate
 * is kept and returned: a service that quietly picks one Cambridge and answers
 * about the other is worse than one that admits the ambiguity.
 *
 * Place data from GeoNames, served through Open-Meteo's geocoding API. Attributed
 * here and in the README alongside the weather attribution, because they are two
 * upstream datasets rather than one.
 */
const ENDPOINT = 'https://geocoding-api.open-meteo.com/v1/search'

const geocodingResponse = z.object({
  // Absent rather than empty when nothing matched, which is not the same shape
  // and would throw if it were required.
  results: z
    .array(
      z.object({
        id: z.number(),
        name: z.string(),
        latitude: z.number(),
        longitude: z.number(),
        elevation: z.number().nullish(),
        timezone: z.string(),
        country: z.string().nullish(),
        country_code: z.string().nullish(),
        admin1: z.string().nullish(),
        population: z.number().nullish(),
      }),
    )
    .default([]),
})

export type GeocodingResponse = z.infer<typeof geocodingResponse>

export type GeocodedLocation = {
  /** GeoNames id. Stable across calls, which is what makes it pinnable. */
  geonameId: number
  name: string
  country: string | null
  countryCode: string | null
  admin1: string | null
  latitude: number
  longitude: number
  elevation: number | null
  timezone: string
  population: number | null
}

export const parseGeocoding = (payload: unknown): GeocodingResponse =>
  geocodingResponse.parse(payload)

export const buildGeocodingUrl = (query: string, limit: number): string => {
  const url = new URL(ENDPOINT)
  url.searchParams.set('name', query)
  url.searchParams.set('count', String(limit))
  url.searchParams.set('language', 'en')
  url.searchParams.set('format', 'json')
  return url.toString()
}

export const toLocations = (response: GeocodingResponse): GeocodedLocation[] =>
  response.results.map((result) => ({
    geonameId: result.id,
    name: result.name,
    country: result.country ?? null,
    countryCode: result.country_code ?? null,
    admin1: result.admin1 ?? null,
    latitude: result.latitude,
    longitude: result.longitude,
    elevation: result.elevation ?? null,
    timezone: result.timezone,
    population: result.population ?? null,
  }))

export const searchLocations = async (
  query: string,
  limit = 5,
): Promise<GeocodedLocation[]> => {
  const response = await fetch(buildGeocodingUrl(query, limit))

  if (!response.ok) {
    throw new OpenMeteoError(response.status, await response.text())
  }

  return toLocations(parseGeocoding(await response.json()))
}
