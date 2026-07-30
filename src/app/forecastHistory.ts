import { LocationNotFound, scoreIssuance } from './activityForecast.ts'
import type { GeographySample, ScoredDay } from './activityForecast.ts'
import { geographyFrom } from '../domain/geography.ts'
import { MODEL_VERSION } from '../domain/modelVersion.ts'
import type { IssuanceDocument } from '../persistence/forecasts.ts'
import type { GeocodedLocation } from '../providers/openmeteo/geocoding.ts'

/**
 * One date, as every stored issuance saw it.
 *
 * This is the field that makes the storage decision observable. An upsert per
 * (location, date) answers "what is the forecast for Friday" and destroys "what
 * did we think on Tuesday that Friday would be" — and the second question is
 * the interesting one, because forecasts are revisions rather than facts. If
 * this field is useful, keeping issuances was right; if it is not, the argument
 * in design.md §2 was wrong and this is where that shows.
 */
export type HistoricalIssuance = {
  issuedAt: string
  modelVersion: string
  /** How many days ahead this date was when the issuance was fetched. */
  horizonDays: number
  day: ScoredDay
}

export type ForecastHistoryDeps = {
  locationById: (locationId: string) => Promise<GeocodedLocation | null>
  geography: (location: GeocodedLocation, now: Date) => Promise<GeographySample>
  issuances: (locationId: string) => Promise<IssuanceDocument[]>
  now: () => Date
}

export const getForecastHistory = async (
  locationId: string,
  date: string,
  deps: ForecastHistoryDeps,
): Promise<HistoricalIssuance[]> => {
  const now = deps.now()
  const location = await deps.locationById(locationId)

  if (location === null) {
    throw new LocationNotFound(
      locationId,
      `No location is stored under "${locationId}". Use searchLocations to get an id this ` +
        'service knows.',
    )
  }

  // Once, not once per issuance: geography is a property of the place and not
  // of the fetch, and asking per issuance would multiply a read-through by 24.
  const sample = await deps.geography(location, now)
  const geography = geographyFrom(sample.terrain, sample.marineCoverage)

  const stored = await deps.issuances(locationId)

  return stored.flatMap((issuance) => {
    const scored = scoreIssuance(issuance, geography)
    const index = scored.findIndex((day) => day.date === date)

    // An issuance whose seven days never reached this date has nothing to say
    // about it. Padding it with an empty entry would read as "we thought
    // nothing", which is a different claim from "we had not looked that far".
    if (index === -1) return []

    return [
      {
        issuedAt: issuance.issuedAt.toISOString(),
        modelVersion: MODEL_VERSION,
        horizonDays: index,
        day: scored[index] as ScoredDay,
      },
    ]
  })
}
