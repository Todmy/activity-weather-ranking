import { ObjectId } from 'mongodb'
import type { EnsureFreshResult, FetchPlan } from '../app/forecastGateway.ts'
import type { IssuanceDocument } from '../persistence/forecasts.ts'
import { toDailyWeather } from '../providers/openmeteo/forecast.ts'
import type { ForecastResponse } from '../providers/openmeteo/forecast.ts'
import type { MarineDay } from '../providers/openmeteo/marine.ts'

/**
 * Builds the issuance a working gateway would have stored, for tests above the
 * gateway that need weather without needing a database.
 *
 * It honours the plan the way the real one does — a planned point produces a
 * series, a skip is recorded verbatim — so a test can assert on what was
 * *planned* without asserting on what was fetched. Deciding to skip a call
 * belongs to the application layer; making the call belongs to the gateway,
 * which has its own tests against a real mongod.
 *
 * Test-only. Nothing in `src/` outside `*.test.ts` imports this.
 */
export const DEFAULT_ISSUED_AT = new Date('2026-07-29T12:00:00.000Z')

export type SeriesFixtures = {
  city: ForecastResponse
  summit?: ForecastResponse
  marine?: MarineDay[]
}

export const issuanceFrom = (
  plan: FetchPlan,
  series: SeriesFixtures,
  issuedAt: Date = DEFAULT_ISSUED_AT,
): IssuanceDocument =>
  ({
    _id: new ObjectId(),
    locationId: plan.locationId,
    issuedAt,
    modelRun: null,
    expiresAt: new Date(issuedAt.getTime() + 30 * 24 * 60 * 60 * 1000),
    city: { status: 'ok', elevation: series.city.elevation, days: toDailyWeather(series.city) },
    summit:
      'point' in plan.summit
        ? series.summit === undefined
          ? { status: 'unavailable', reason: 'no summit fixture supplied' }
          : {
              status: 'ok',
              elevation: series.summit.elevation,
              days: toDailyWeather(series.summit),
            }
        : plan.summit.skip,
    marine:
      'point' in plan.marine
        ? series.marine === undefined
          ? { status: 'unavailable', reason: 'no marine fixture supplied' }
          : { status: 'ok', days: series.marine }
        : plan.marine.skip,
  }) as IssuanceDocument

export const freshIssuance = (
  plan: FetchPlan,
  series: SeriesFixtures,
  issuedAt?: Date,
): EnsureFreshResult => ({ status: 'fresh', issuance: issuanceFrom(plan, series, issuedAt) })
