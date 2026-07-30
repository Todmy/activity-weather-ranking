import { describe, expect, it } from 'vitest'
import { scoreProfile } from '../score.ts'
import type { WeatherInputs } from '../weather.ts'
import { indoorSightseeing } from './indoorSightseeing.ts'
import { outdoorSightseeing } from './outdoorSightseeing.ts'

const band = (score: number): string => {
  if (score >= 80) return 'EXCELLENT'
  if (score >= 60) return 'GOOD'
  if (score >= 40) return 'FAIR'
  return 'POOR'
}

type Row = { row: number; conditions: string; expected: string; inputs: WeatherInputs }

/**
 * The five indoor rows of `docs/sanity-table.md`.
 *
 * As with outdoor, the table states air temperature and this file states the
 * apparent temperature the profile scores, with the reason it differs. Cloud
 * cover in percent comes from the row's description: "sunny" is 5, "partly
 * cloudy" 50, overcast or snowing 100.
 */
const indoorRows: Row[] = [
  {
    row: 1,
    conditions: '8 °C, rain 12 mm all day, wind 20 km/h',
    expected: 'EXCELLENT',
    // Wet and breezy at 8 °C reads about 5 °C.
    inputs: {
      apparentTemperatureMax: 5,
      precipitationSum: 12,
      rainSum: 12,
      snowfallSum: 0,
      cloudCoverMean: 100,
      windGustsMax: 30,
    },
  },
  {
    row: 2,
    conditions: '22 °C, sunny, light wind',
    expected: 'FAIR',
    inputs: {
      apparentTemperatureMax: 23,
      precipitationSum: 0,
      rainSum: 0,
      snowfallSum: 0,
      cloudCoverMean: 5,
      windGustsMax: 12,
    },
  },
  {
    row: 3,
    conditions: '-2 °C, snow 5 cm, wind 15 km/h',
    expected: 'GOOD',
    inputs: {
      apparentTemperatureMax: -5,
      precipitationSum: 4,
      // Snow, not rain: 5 cm of it shows up in precipitation_sum as water
      // equivalent, and the profile deliberately does not read that as rain.
      rainSum: 0,
      snowfallSum: 5,
      cloudCoverMean: 100,
      windGustsMax: 22,
    },
  },
  {
    row: 4,
    conditions: '12 °C, gusts 90 km/h, rain 30 mm',
    expected: 'POOR',
    // The row that proves indoor is not the inverse of outdoor: the weather is
    // terrible for going outside AND too dangerous to travel in.
    inputs: {
      apparentTemperatureMax: 6,
      precipitationSum: 30,
      rainSum: 30,
      snowfallSum: 0,
      cloudCoverMean: 100,
      windGustsMax: 90,
    },
  },
  {
    row: 5,
    conditions: '18 °C, partly cloudy, dry',
    expected: 'GOOD',
    inputs: {
      apparentTemperatureMax: 18,
      precipitationSum: 0,
      rainSum: 0,
      snowfallSum: 0,
      cloudCoverMean: 50,
      windGustsMax: 10,
    },
  },
]

describe('indoor sightseeing, against the sanity table', () => {
  it.each(indoorRows)('row $row — $conditions — $expected', ({ expected, inputs }) => {
    const result = scoreProfile(indoorSightseeing, inputs)

    expect(result.score).not.toBeNull()
    expect(band(result.score!), `scored ${result.score}`).toBe(expected)
  })

  it('never drops below its floor on weather alone', () => {
    const perfectBeachDay: WeatherInputs = {
      apparentTemperatureMax: 24,
      precipitationSum: 0,
      rainSum: 0,
      snowfallSum: 0,
      cloudCoverMean: 0,
      windGustsMax: 5,
    }

    // The museum is open. It is simply a waste of the day.
    expect(scoreProfile(indoorSightseeing, perfectBeachDay).score).toBe(55)
  })

  it('is not the inverse of outdoor sightseeing', () => {
    const storm: WeatherInputs = {
      apparentTemperatureMax: 6,
      precipitationSum: 30,
      rainSum: 30,
      snowfallSum: 0,
      cloudCoverMean: 100,
      windSpeedMax: 60,
      windGustsMax: 90,
    }

    const indoors = scoreProfile(indoorSightseeing, storm)
    const outdoors = scoreProfile(outdoorSightseeing, storm)

    // Both are POOR at once, which no single "how bad is the weather" axis can
    // produce. Outdoors is miserable; indoors is unreachable.
    expect(band(indoors.score!)).toBe('POOR')
    expect(band(outdoors.score!)).toBe('POOR')
    expect(indoors.gates[0]?.name).toBe('travelDisruption')
  })

  it('cites a source for every factor and every gate', () => {
    for (const entry of [...indoorSightseeing.factors, ...(indoorSightseeing.gates ?? [])]) {
      expect(entry.source.length).toBeGreaterThan(20)
    }
  })
})
