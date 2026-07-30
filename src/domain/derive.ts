import type { DayWeather } from './weather.ts'

/**
 * Inputs a profile needs that no single day carries.
 *
 * Fresh snow is the one that matters: the sanity table's ski rows talk about
 * 25 cm over three days and two weeks without snowfall, and a day's own
 * `snowfall_sum` cannot answer either. Computed here, over the whole issuance,
 * before any scoring — still pure, still no clock, still no I/O.
 */
const WINDOW_DAYS = 3

/** Sum of the present values in the window, or null when none of them are. */
const windowSum = (values: (number | null | undefined)[]): number | null => {
  const present = values.filter((value): value is number => value !== null && value !== undefined)

  return present.length === 0 ? null : present.reduce((sum, value) => sum + value, 0)
}

export const withDerivedInputs = (days: DayWeather[]): DayWeather[] =>
  days.map((day, index) => ({
    ...day,
    snowfall3d: windowSum(
      days.slice(Math.max(0, index - (WINDOW_DAYS - 1)), index + 1).map((d) => d.snowfallSum),
    ),
  }))
