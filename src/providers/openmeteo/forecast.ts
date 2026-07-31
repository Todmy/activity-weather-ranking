import { z } from 'zod'
import type { DayWeather } from '../../domain/weather.ts'

/**
 * The Open-Meteo daily forecast, validated on the way in.
 *
 * The schema is written from a captured response (`docs/probes/forecast-innsbruck.json`)
 * rather than from the documentation, because the probe is the thing that is
 * actually true. Nothing downstream sees an unvalidated field: an upstream
 * change shows up here as a parse error rather than three layers later as a
 * score that looks like weather.
 *
 * Weather data by Open-Meteo.com, licensed CC BY 4.0.
 */
const ENDPOINT = 'https://api.open-meteo.com/v1/forecast'

/**
 * Pinned, in this order, because the fixture is evidence about the live API
 * only while the request still matches. Seventeen variables costs more than one
 * call against the free tier's 10,000 a day (anything over ten counts as more
 * than one), which is affordable precisely because responses are persisted.
 */
export const DAILY_VARIABLES = [
  'temperature_2m_max',
  'temperature_2m_min',
  'apparent_temperature_max',
  'precipitation_sum',
  'rain_sum',
  'snowfall_sum',
  'precipitation_probability_max',
  'precipitation_hours',
  'weather_code',
  'wind_speed_10m_max',
  'wind_gusts_10m_max',
  'wind_direction_10m_dominant',
  'cloud_cover_mean',
  'uv_index_max',
  'sunshine_duration',
  'daylight_duration',
] as const

/** The seven days that get scored, and the history that informs them. */
/**
 * Snow depth has no daily aggregate upstream, so it comes from the hourly
 * block at six-hourly resolution: 40 values over the ten days instead of 240.
 * It is a state variable that moves centimetres across a day — the Portillo
 * probe swings 3 cm between its four samples — so a finer resolution would buy
 * nothing and cost quota, which is the binding limit on this service.
 */
export const TEMPORAL_RESOLUTION = 'hourly_6'
export const SAMPLES_PER_DAY = 4

export const FORECAST_DAYS = 7
export const PAST_DAYS = 3

const nullableNumbers = z.array(z.number().nullable())

const forecastResponse = z
  .object({
    latitude: z.number(),
    longitude: z.number(),
    elevation: z.number(),
    timezone: z.string(),
    utc_offset_seconds: z.number(),
    daily: z.object({
      time: z.array(z.string()),
      temperature_2m_max: nullableNumbers,
      temperature_2m_min: nullableNumbers,
      apparent_temperature_max: nullableNumbers,
      precipitation_sum: nullableNumbers,
      rain_sum: nullableNumbers,
      snowfall_sum: nullableNumbers,
      precipitation_probability_max: nullableNumbers,
      precipitation_hours: nullableNumbers,
      weather_code: nullableNumbers,
      wind_speed_10m_max: nullableNumbers,
      wind_gusts_10m_max: nullableNumbers,
      wind_direction_10m_dominant: nullableNumbers,
      cloud_cover_mean: nullableNumbers,
      uv_index_max: nullableNumbers,
      sunshine_duration: nullableNumbers,
      daylight_duration: nullableNumbers,
    }),
    // Snow depth is the one variable skiing needs that Open-Meteo publishes no
    // daily aggregate for, so it arrives here and is folded into the day.
    hourly: z.object({
      time: z.array(z.string()),
      snow_depth: nullableNumbers,
    }),
  })
  .refine(
    ({ daily }) => Object.values(daily).every((series) => series.length === daily.time.length),
    // A short array does not fail loudly on its own: it shifts every later
    // value onto the wrong date and the output still looks like weather.
    { message: 'every daily series must have the same length as daily.time' },
  )
  .refine(
    ({ hourly }) => hourly.snow_depth.length === hourly.time.length,
    { message: 'hourly.snow_depth must have the same length as hourly.time' },
  )
  .refine(
    // Same failure as above, one axis over: a short hourly block would put
    // Friday's depth on Tuesday and the answer would still look like weather.
    ({ daily, hourly }) => hourly.time.length === daily.time.length * SAMPLES_PER_DAY,
    { message: `hourly must carry exactly ${SAMPLES_PER_DAY} samples for every daily row` },
  )

export type ForecastResponse = z.infer<typeof forecastResponse>
export type Coordinates = { latitude: number; longitude: number }

export const parseForecast = (payload: unknown): ForecastResponse =>
  forecastResponse.parse(payload)

export const buildForecastUrl = ({ latitude, longitude }: Coordinates): string => {
  const url = new URL(ENDPOINT)
  url.searchParams.set('latitude', String(latitude))
  url.searchParams.set('longitude', String(longitude))
  url.searchParams.set('daily', DAILY_VARIABLES.join(','))
  url.searchParams.set('hourly', 'snow_depth')
  url.searchParams.set('temporal_resolution', TEMPORAL_RESOLUTION)
  // Local calendar dates in the location's own timezone. "Tuesday" in a travel
  // forecast means Tuesday where the traveller is.
  url.searchParams.set('timezone', 'auto')
  url.searchParams.set('forecast_days', String(FORECAST_DAYS))
  // Fresh snow is a window, not a day. Three days of history cost no extra
  // call and stop the first forecast day reading as though the mountain had
  // never seen snow. See decision #39.
  url.searchParams.set('past_days', String(PAST_DAYS))
  return url.toString()
}

/**
 * Column-major upstream to row-major domain. `weather_code` and
 * `wind_direction_10m_dominant` are fetched and deliberately not mapped: no
 * profile scores them yet, and wind direction only becomes useful with a
 * coastline orientation this service does not have (decision #23, cut).
 */
export const toDailyWeather = (response: ForecastResponse): DayWeather[] => {
  const { daily, hourly } = response

  // Metres upstream, centimetres here. Every other depth in this model is
  // centimetres and the sanity table's threshold is 30, so the conversion
  // belongs at the boundary rather than in the profiles. The daily maximum is
  // the cover the mountain had available that day; all-null stays null,
  // because zero is a measurement and absence is not.
  const depthFor = (index: number): number | null => {
    const samples = hourly.snow_depth
      .slice(index * SAMPLES_PER_DAY, (index + 1) * SAMPLES_PER_DAY)
      .filter((metres): metres is number => metres !== null)

    return samples.length === 0 ? null : Math.max(...samples) * 100
  }

  return daily.time.map((date, index) => ({
    date: date!,
    snowDepth: depthFor(index),
    temperatureMax: daily.temperature_2m_max[index] ?? null,
    temperatureMin: daily.temperature_2m_min[index] ?? null,
    apparentTemperatureMax: daily.apparent_temperature_max[index] ?? null,
    precipitationSum: daily.precipitation_sum[index] ?? null,
    rainSum: daily.rain_sum[index] ?? null,
    snowfallSum: daily.snowfall_sum[index] ?? null,
    precipitationProbabilityMax: daily.precipitation_probability_max[index] ?? null,
    precipitationHours: daily.precipitation_hours[index] ?? null,
    windSpeedMax: daily.wind_speed_10m_max[index] ?? null,
    windGustsMax: daily.wind_gusts_10m_max[index] ?? null,
    cloudCoverMean: daily.cloud_cover_mean[index] ?? null,
    uvIndexMax: daily.uv_index_max[index] ?? null,
    sunshineDuration: daily.sunshine_duration[index] ?? null,
    daylightDuration: daily.daylight_duration[index] ?? null,
  }))
}

export class OpenMeteoError extends Error {
  readonly status: number

  constructor(status: number, body: string) {
    super(`Open-Meteo answered ${status}: ${body.slice(0, 200)}`)
    this.name = 'OpenMeteoError'
    this.status = status
  }
}

/**
 * Every upstream call is capped here, at the only layer that can see the socket.
 *
 * Node's `fetch` has no default request timeout — undici's header and body
 * timeouts are 300 s — so a caller that passes no signal used to wait five
 * minutes on an endpoint that accepts the connection and stops answering. Two
 * of the four clients are reached before the gateway exists, so a cap that only
 * the gateway applies is a number in a document rather than a timeout.
 */
export const UPSTREAM_TIMEOUT_MS = 8_000

/**
 * `signal` is how the refresh gateway's cap reaches the socket. Passing it
 * rather than racing a promise means the request is actually cancelled, so a
 * hung upstream stops holding a connection as well as a lease. Absent one, the
 * client caps itself rather than waiting on undici's five minutes.
 */
export const fetchForecast = async (
  coordinates: Coordinates,
  signal?: AbortSignal,
): Promise<ForecastResponse> => {
  const response = await fetch(buildForecastUrl(coordinates), {
    signal: signal ?? AbortSignal.timeout(UPSTREAM_TIMEOUT_MS),
  })

  if (!response.ok) {
    throw new OpenMeteoError(response.status, await response.text())
  }

  return parseForecast(await response.json())
}
