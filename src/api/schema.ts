import SchemaBuilder from '@pothos/core'
import { GraphQLError } from 'graphql'
import { getActivityForecast, LocationNotFound } from '../app/activityForecast.ts'
import type {
  ActivityForecast,
  ActivityForecastDeps,
  ScoredActivity,
  ScoredDay,
} from '../app/activityForecast.ts'
import type { FactorContribution } from '../domain/score.ts'
import type { GeocodedLocation } from '../providers/openmeteo/geocoding.ts'

/**
 * Code-first schema. The SDL is derived from this file rather than the other way
 * round, so there is no generated artifact to keep in step with the resolvers.
 *
 * The context carries an optional dependency bundle. Production never sets it
 * and gets the live providers; the schema test sets it to fixtures, which is how
 * the whole path can be exercised through GraphQL without spending API quota.
 * Slice 4 puts the refresh gateway through the same door.
 */
export type GraphQLContext = { deps?: ActivityForecastDeps }

const builder = new SchemaBuilder<{ Context: GraphQLContext }>({})

const LocationRef = builder.objectRef<GeocodedLocation>('Location').implement({
  description: 'A place, as resolved from a free-text query by Open-Meteo geocoding.',
  fields: (t) => ({
    geonameId: t.exposeID('geonameId', {
      description: 'GeoNames id. Stable across calls, so it can be pinned.',
    }),
    name: t.exposeString('name'),
    country: t.exposeString('country', { nullable: true }),
    admin1: t.exposeString('admin1', {
      nullable: true,
      description: 'First-level division, which is what tells five Cambridges apart.',
    }),
    latitude: t.exposeFloat('latitude'),
    longitude: t.exposeFloat('longitude'),
    elevation: t.exposeFloat('elevation', { nullable: true }),
    timezone: t.exposeString('timezone'),
  }),
})

const FactorRef = builder.objectRef<FactorContribution>('FactorContribution').implement({
  description:
    'One factor of one score, with the number that produced it. This is what makes a ' +
    'ranking answerable rather than merely assertive.',
  fields: (t) => ({
    name: t.exposeString('name'),
    weight: t.exposeFloat('weight'),
    rawValue: t.exposeFloat('rawValue', {
      nullable: true,
      description: 'The upstream measurement. Null when the forecast did not carry it.',
    }),
    curveValue: t.exposeFloat('curveValue', {
      nullable: true,
      description: 'What the factor curve made of it, 0 to 1.',
    }),
    contribution: t.exposeFloat('contribution', {
      description: 'Points of the final score this factor accounts for.',
    }),
  }),
})

const ActivityScoreRef = builder.objectRef<ScoredActivity>('ActivityScore').implement({
  fields: (t) => ({
    activity: t.exposeString('activity'),
    score: t.exposeInt('score', {
      nullable: true,
      description: '0 to 100. Null when no input the profile needs was present at all.',
    }),
    completeness: t.exposeFloat('completeness', {
      description: "Fraction of the profile's weight whose input was present.",
    }),
    factors: t.expose('factors', { type: [FactorRef] }),
  }),
})

const DayRef = builder.objectRef<ScoredDay>('DayForecast').implement({
  fields: (t) => ({
    date: t.exposeString('date', {
      description: "Local calendar date in the location's own timezone, never a UTC instant.",
    }),
    activities: t.expose('activities', { type: [ActivityScoreRef] }),
  }),
})

const ForecastResultRef = builder.objectRef<ActivityForecast>('ForecastResult').implement({
  fields: (t) => ({
    location: t.expose('location', { type: LocationRef }),
    alternatives: t.expose('alternatives', {
      type: [LocationRef],
      description: 'Other places that matched the query, so a substitution is never silent.',
    }),
    issuedAt: t.exposeString('issuedAt', {
      description: 'When this forecast was fetched upstream.',
    }),
    days: t.expose('days', { type: [DayRef] }),
  }),
})

builder.queryType({
  fields: (t) => ({
    health: t.string({
      description: 'Returns "ok" when the service is running.',
      resolve: () => 'ok',
    }),
    activityForecast: t.field({
      type: ForecastResultRef,
      description:
        'Resolve a city or town by name and score the next seven days for it. ' +
        'Slice 1 scores outdoor sightseeing only, and persists nothing yet.',
      args: { query: t.arg.string({ required: true }) },
      resolve: async (_root, args, ctx) => {
        try {
          return await getActivityForecast(args.query, ctx.deps)
        } catch (error) {
          // Yoga masks anything that is not a GraphQLError as "Unexpected
          // error." A caller who mistyped a city name deserves to be told that,
          // so the app-layer error is translated here rather than leaking or
          // being swallowed.
          if (error instanceof LocationNotFound) {
            throw new GraphQLError(error.message, {
              extensions: { code: 'LOCATION_NOT_FOUND' },
            })
          }
          throw error
        }
      },
    }),
  }),
})

export const schema = builder.toSchema()
