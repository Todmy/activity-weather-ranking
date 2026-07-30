import { describe, expect, it } from 'vitest'
import { withDerivedInputs } from './derive.ts'
import type { DayWeather } from './weather.ts'

const day = (date: string, snowfallSum: number | null): DayWeather => ({ date, snowfallSum })

/**
 * Fresh snow is a window, not a day. The sanity table talks about 25 cm over
 * three days, and no single day's `snowfall_sum` can answer that, which is why
 * the forecast request carries `past_days=3` (decision #39).
 */
describe('withDerivedInputs', () => {
  it('sums today and the two days before it', () => {
    const days = withDerivedInputs([
      day('2026-01-01', 5),
      day('2026-01-02', 10),
      day('2026-01-03', 3),
      day('2026-01-04', 0),
    ])

    expect(days.map((d) => d.snowfall3d)).toEqual([5, 15, 18, 13])
  })

  it('uses the days it has at the start of the series rather than guessing', () => {
    const days = withDerivedInputs([day('2026-01-01', 12)])

    // Honest and shorter: with past_days=3 in the request this only bites when
    // upstream returns less history than asked for.
    expect(days[0]?.snowfall3d).toBe(12)
  })

  it('sums the days it has when one is missing', () => {
    const days = withDerivedInputs([day('2026-01-01', 5), day('2026-01-02', null), day('2026-01-03', 4)])

    expect(days.map((d) => d.snowfall3d)).toEqual([5, 5, 9])
  })

  it('reports nothing rather than zero when the whole window is missing', () => {
    const days = withDerivedInputs([day('2026-01-01', null), day('2026-01-02', null)])

    expect(days.map((d) => d.snowfall3d)).toEqual([null, null])
  })

  it('leaves every other input untouched', () => {
    const [derived] = withDerivedInputs([
      { date: '2026-01-01', snowfallSum: 2, temperatureMax: -4, windGustsMax: 30 },
    ])

    expect(derived).toMatchObject({ temperatureMax: -4, windGustsMax: 30, snowfall3d: 2 })
  })
})
