import { z } from 'zod'
import { FORECAST_DAYS, OpenMeteoError, PAST_DAYS } from './forecast.ts'

/**
 * The wave model, and the coverage question it answers for free.
 *
 * The designed mechanism here was haversine: compare the requested coordinate
 * with the grid cell the model actually used, and call it inapplicable past
 * some distance. Recon killed it. Canterbury sits 14 km from the water and
 * comes back fully populated, so any threshold that excludes it also excludes
 * real coastal towns — and the API does not snap inland coordinates to a
 * distant sea cell in the first place. It answers with nulls throughout.
 *
 * Nulls are a cleaner signal than a distance, because they are the model's own
 * statement about where it has water rather than our guess about it.
 *
 * Weather data by Open-Meteo.com, licensed CC BY 4.0.
 */
const ENDPOINT = 'https://marine-api.open-meteo.com/v1/marine'

/**
 * Pinned, in the order the probes were captured with. `wind_wave_height_max`
 * is not scored by any profile; it stays because dropping it would change the
 * request and make six saved fixtures stale evidence about a request the
 * service no longer sends.
 */
export const MARINE_VARIABLES = [
  'wave_height_max',
  'wave_period_max',
  'wind_wave_height_max',
  'swell_wave_height_max',
  'swell_wave_period_max',
] as const

export type MarineCoverage = 'present' | 'none'

export type MarineDay = {
  date: string
  waveHeightMax: number | null
  wavePeriodMax: number | null
  swellWaveHeightMax: number | null
  swellWavePeriodMax: number | null
}

const nullableNumbers = z.array(z.number().nullable())

const marineResponse = z
  .object({
    latitude: z.number(),
    longitude: z.number(),
    timezone: z.string(),
    daily: z.object({
      time: z.array(z.string()),
      wave_height_max: nullableNumbers,
      wave_period_max: nullableNumbers,
      wind_wave_height_max: nullableNumbers,
      swell_wave_height_max: nullableNumbers,
      swell_wave_period_max: nullableNumbers,
    }),
  })
  .refine(
    ({ daily }) =>
      MARINE_VARIABLES.every((name) => daily[name].length === daily.time.length),
    { message: 'marine: a series is a different length from `time`' },
  )

export type MarineResponse = z.infer<typeof marineResponse>

export const parseMarine = (body: unknown): MarineResponse => marineResponse.parse(body)

/**
 * One real number anywhere in the week is enough. Coverage is a property of the
 * coordinate, not of the weather, so it is not a majority vote — a patchy
 * response still proves the model has water there.
 */
export const coverageOf = (parsed: MarineResponse): MarineCoverage =>
  MARINE_VARIABLES.some((name) => parsed.daily[name].some((value) => value !== null))
    ? 'present'
    : 'none'

/**
 * Only the four inputs the surf profile scores. Nulls survive: a flat calm is
 * zero wave height and something the profile should rate, a missing measurement
 * is neither, and `completeness` has to be able to tell them apart.
 */
export const toDailyMarine = (parsed: MarineResponse): MarineDay[] =>
  parsed.daily.time.map((date, index) => ({
    date,
    waveHeightMax: parsed.daily.wave_height_max[index] ?? null,
    wavePeriodMax: parsed.daily.wave_period_max[index] ?? null,
    swellWaveHeightMax: parsed.daily.swell_wave_height_max[index] ?? null,
    swellWavePeriodMax: parsed.daily.swell_wave_period_max[index] ?? null,
  }))

export const buildMarineUrl = (coordinates: {
  latitude: number
  longitude: number
}): string => {
  const url = new URL(ENDPOINT)
  url.searchParams.set('latitude', String(coordinates.latitude))
  url.searchParams.set('longitude', String(coordinates.longitude))
  url.searchParams.set('daily', MARINE_VARIABLES.join(','))
  url.searchParams.set('timezone', 'auto')
  url.searchParams.set('forecast_days', String(FORECAST_DAYS))
  // Not needed by any marine factor. Carried so that a marine day and a
  // forecast day share an index, which is cheaper than joining by date.
  url.searchParams.set('past_days', String(PAST_DAYS))
  return url.toString()
}

/** `signal` carries the refresh gateway's 8-second cap; see `fetchForecast`. */
export const fetchMarine = async (
  coordinates: {
    latitude: number
    longitude: number
  },
  signal?: AbortSignal,
): Promise<{ coverage: MarineCoverage; days: MarineDay[] }> => {
  const response = await fetch(buildMarineUrl(coordinates), { signal: signal ?? null })

  if (!response.ok) {
    throw new OpenMeteoError(response.status, await response.text())
  }

  const parsed = parseMarine(await response.json())
  const coverage = coverageOf(parsed)
  // An all-null week carries no information, and passing it downstream as ten
  // days of nothing would let it be mistaken for a flat calm.
  return { coverage, days: coverage === 'present' ? toDailyMarine(parsed) : [] }
}
