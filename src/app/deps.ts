import type { ActivityForecastDeps } from './activityForecast.ts'
import type { LocationSearchDeps } from './locationSearch.ts'

/**
 * Everything the API layer can reach, in one bundle.
 *
 * An intersection rather than a new shape, so each application module keeps
 * declaring the narrow set it actually uses and a test of that module can supply
 * only those. This type exists for the one caller that genuinely needs all of
 * them: the GraphQL context.
 */
export type AppDeps = ActivityForecastDeps & LocationSearchDeps
