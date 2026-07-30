import SchemaBuilder from '@pothos/core'
import { GraphQLError } from 'graphql'
import { getActivityForecast, LocationNotFound } from '../app/activityForecast.ts'
import type {
  ActivityForecast,
  ActivityForecastDeps,
  ActivityRanking,
  Assessment,
  ScoredDay,
} from '../app/activityForecast.ts'
import type { ActivityResult } from '../domain/activityResult.ts'
import type { RankedDay } from '../domain/rank.ts'
import type { FactorContribution, GateEffect } from '../domain/score.ts'
import { OpenMeteoError } from '../providers/openmeteo/forecast.ts'
import type { GeocodedLocation } from '../providers/openmeteo/geocoding.ts'

/**
 * Code-first schema. The SDL is derived from this file rather than the other way
 * round, so there is no generated artifact to keep in step with the resolvers.
 *
 * The context carries an optional dependency bundle. Production never sets it
 * and gets the live providers; the tests set it to fixtures, which is how the
 * whole path can be exercised without spending API quota. Slice 4 puts the
 * refresh gateway through the same door.
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
      description: 'Points of `base` this factor accounts for. Contributions sum to `base`.',
    }),
  }),
})

const GateRef = builder.objectRef<GateEffect>('GateEffect').implement({
  description:
    'A veto, as a multiplier on the whole score. 1 is nothing in the way; below that, ' +
    'everything else is scaled down together — held lifts, blown-out surf, a storm ' +
    'between you and the museum.',
  fields: (t) => ({
    name: t.exposeString('name'),
    rawValue: t.exposeFloat('rawValue', { nullable: true }),
    multiplier: t.exposeFloat('multiplier'),
  }),
})

type Scored = Extract<ActivityResult, { kind: 'scored' }>
type NotApplicable = Extract<ActivityResult, { kind: 'notApplicable' }>
type Unavailable = Extract<ActivityResult, { kind: 'unavailable' }>

const ScoredRef = builder.objectRef<Scored>('ScoredActivity').implement({
  fields: (t) => ({
    activity: t.exposeString('activity'),
    score: t.exposeInt('score', { description: '0 to 100, after the floor and the gates.' }),
    base: t.exposeFloat('base', {
      description: 'The weighted mean before the floor and the gates, 0 to 100.',
    }),
    confidence: t.exposeFloat('confidence', {
      description:
        'Published forecast skill at this horizon, times the fraction of the profile whose ' +
        'inputs were present. A day-7 number is not a day-1 number.',
    }),
    completeness: t.exposeFloat('completeness'),
    factors: t.expose('factors', { type: [FactorRef] }),
    gates: t.expose('gates', { type: [GateRef] }),
  }),
})

const NotApplicableRef = builder.objectRef<NotApplicable>('NotApplicableActivity').implement({
  description:
    'The question does not arise here: no ocean, or no terrain. Deliberately not a score of ' +
    'zero — "Vienna has no ocean" and "surfing in Vienna would be poor" are different claims.',
  fields: (t) => ({
    activity: t.exposeString('activity'),
    reason: t.exposeString('reason'),
  }),
})

const UnavailableRef = builder.objectRef<Unavailable>('UnavailableActivity').implement({
  description:
    'The activity applies here and could not be answered: something upstream is missing, or ' +
    'the geography has not been assessed yet.',
  fields: (t) => ({
    activity: t.exposeString('activity'),
    reason: t.exposeString('reason'),
  }),
})

const ActivityResultRef = builder.unionType('ActivityResult', {
  types: [ScoredRef, NotApplicableRef, UnavailableRef],
  description:
    'Three states, because three different things can be true. A nullable score could only ' +
    'carry one of them.',
  resolveType: (value) => {
    const result = value as ActivityResult
    if (result.kind === 'scored') return 'ScoredActivity'
    return result.kind === 'notApplicable' ? 'NotApplicableActivity' : 'UnavailableActivity'
  },
})

const DayRef = builder.objectRef<ScoredDay>('DayForecast').implement({
  fields: (t) => ({
    date: t.exposeString('date', {
      description: "Local calendar date in the location's own timezone, never a UTC instant.",
    }),
    activities: t.expose('activities', {
      type: [ActivityResultRef],
      description: 'Every activity for this day, best first. One of the two ranking axes.',
    }),
  }),
})

const RankedDayRef = builder.objectRef<RankedDay>('RankedDay').implement({
  fields: (t) => ({
    date: t.exposeString('date'),
    score: t.exposeInt('score'),
    confidence: t.exposeFloat('confidence'),
  }),
})

const RankingRef = builder.objectRef<ActivityRanking>('ActivityRanking').implement({
  description:
    'The other reading of "ranks the next seven days": one activity, its days best first. ' +
    'Days the activity cannot be scored on are left out rather than ranked as zero.',
  fields: (t) => ({
    activity: t.exposeString('activity'),
    days: t.expose('days', { type: [RankedDayRef] }),
  }),
})

const TerrainAssessmentRef = builder
  .objectRef<NonNullable<Assessment['terrain']>>('TerrainAssessment')
  .implement({
    description:
      'Where skiing was actually assessed. A ski score is a claim about this point, not ' +
      'about the city centre — Grenoble is 214 m in town and 3204 m within 45 km.',
    fields: (t) => ({
      elevation: t.exposeFloat('elevation', { description: 'Metres, the sampled high point.' }),
      distanceKm: t.exposeFloat('distanceKm', { description: 'How far that point is from the city.' }),
      gridVersion: t.exposeString('gridVersion', {
        description:
          'The sampling parameters. Changing them is a versioned event rather than a silent ' +
          'drift in historical answers.',
      }),
      latitude: t.float({ resolve: (terrain) => terrain.point.latitude }),
      longitude: t.float({ resolve: (terrain) => terrain.point.longitude }),
    }),
  })

const AssessmentRef = builder.objectRef<Assessment>('Assessment').implement({
  description:
    'What was measured about this place, as opposed to forecast for it. Geography is sampled ' +
    'once per location and kept, because a coastline does not move.',
  fields: (t) => ({
    terrain: t.expose('terrain', {
      type: TerrainAssessmentRef,
      nullable: true,
      description: 'Null when the terrain has not been sampled yet.',
    }),
    marineCoverage: t.exposeString('marineCoverage', {
      nullable: true,
      description:
        '"present" or "none", learned from whether the wave model returns data at this ' +
        'coordinate. Null when it has not been asked yet.',
    }),
  }),
})

const ForecastResultRef = builder.objectRef<ActivityForecast>('ForecastResult').implement({
  fields: (t) => ({
    location: t.expose('location', { type: LocationRef }),
    alternatives: t.expose('alternatives', {
      type: [LocationRef],
      description: 'Other places that matched the query, so a substitution is never silent.',
    }),
    assessment: t.expose('assessment', {
      type: AssessmentRef,
      description: 'The geography behind the applicability answers, so they can be checked.',
    }),
    issuedAt: t.exposeString('issuedAt', {
      description: 'When this forecast was fetched upstream.',
    }),
    modelVersion: t.exposeString('modelVersion', {
      description:
        'The scoring model that produced these numbers. The same issuance and the same ' +
        'version always reproduce the same ranking.',
    }),
    days: t.expose('days', { type: [DayRef] }),
    rankings: t.expose('rankings', { type: [RankingRef] }),
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
        'Resolve a city or town by name and rank the next seven days for skiing, surfing, ' +
        'outdoor sightseeing and indoor sightseeing. Nothing is persisted yet: that is M5.',
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

          // Upstream having a bad five minutes is not a bug in this service,
          // and a masked 500 makes it look like one. There is nothing to serve
          // instead until the cache lands in M5, and stale-if-error is exactly
          // the mechanism that will turn this into an answer rather than an
          // apology.
          if (error instanceof OpenMeteoError) {
            throw new GraphQLError(`Open-Meteo is unavailable: ${error.message}`, {
              extensions: { code: 'UPSTREAM_UNAVAILABLE', upstreamStatus: error.status },
            })
          }

          throw error
        }
      },
    }),
  }),
})

export const schema = builder.toSchema()
