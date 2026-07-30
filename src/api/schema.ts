import SchemaBuilder from '@pothos/core'
import { GraphQLError } from 'graphql'
import {
  getActivityForecast,
  getActivityForecastAt,
  LocationNotFound,
  NoDataYet,
} from '../app/activityForecast.ts'
import type {
  ActivityForecast,
  ActivityRanking,
  Assessment,
  ScoredDay,
} from '../app/activityForecast.ts'
import type { AppDeps } from '../app/deps.ts'
import { getForecastHistory } from '../app/forecastHistory.ts'
import type { HistoricalIssuance } from '../app/forecastHistory.ts'
import { searchForLocations } from '../app/locationSearch.ts'
import type { ActivityResult } from '../domain/activityResult.ts'
import type { RankedDay } from '../domain/rank.ts'
import type { FactorContribution, GateEffect } from '../domain/score.ts'
import { OpenMeteoError } from '../providers/openmeteo/forecast.ts'
import type { GeocodedLocation } from '../providers/openmeteo/geocoding.ts'

/**
 * Code-first schema. The SDL is derived from this file rather than the other way
 * round, so there is no generated artifact to keep in step with the resolvers.
 *
 * The context carries the dependency bundle, and carries it always. There is no
 * live default any more: since slice 4 a forecast comes from the refresh
 * gateway over a database, so a resolver that could fall back to bare providers
 * would be a way to bypass the very thing the brief asks for. Production wires
 * the real ones in `server.ts`; tests wire fixtures.
 */
export type GraphQLContext = {
  deps: AppDeps
  /** The commit this process is running, or `unknown` when nothing stamped it. */
  release: string
}

const builder = new SchemaBuilder<{ Context: GraphQLContext }>({})

const LocationRef = builder.objectRef<GeocodedLocation>('Location').implement({
  description: 'A place, as resolved from a free-text query by Open-Meteo geocoding.',
  fields: (t) => ({
    geonameId: t.exposeID('geonameId', {
      description: 'GeoNames id. Stable across calls, so it can be pinned.',
    }),
    name: t.exposeString('name'),
    country: t.exposeString('country', { nullable: true }),
    countryCode: t.exposeString('countryCode', {
      nullable: true,
      description: 'ISO 3166-1 alpha-2, which is the shortest way to tell two Cambridges apart.',
    }),
    admin1: t.exposeString('admin1', {
      nullable: true,
      description: 'First-level division, which is what tells five Cambridges apart.',
    }),
    latitude: t.exposeFloat('latitude'),
    longitude: t.exposeFloat('longitude'),
    elevation: t.exposeFloat('elevation', { nullable: true }),
    timezone: t.exposeString('timezone'),
    population: t.exposeInt('population', {
      nullable: true,
      description: 'What upstream ranks candidates by, so the ordering can be understood.',
    }),
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
      description: 'When this forecast was fetched upstream, not when it was served.',
    }),
    stale: t.exposeBoolean('stale', {
      description:
        'True when the stored issuance could not be refreshed and is being served anyway. ' +
        'The answer still arrives; it just says so.',
    }),
    staleReason: t.exposeString('staleReason', {
      nullable: true,
      description: 'What stopped the refresh, or null when nothing did.',
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

/**
 * Yoga masks anything that is not a `GraphQLError` as "Unexpected error.", which
 * `graphql()` alone does not do — so a resolver error can pass a schema test and
 * still reach a reviewer as a blank 500. These four states are the ones a caller
 * can act on, and they are translated once here rather than per field.
 */
const answering = async <T>(work: () => Promise<T>): Promise<T> => {
  try {
    return await work()
  } catch (error) {
    // A caller who mistyped a city name, or passed an id this service has never
    // stored, deserves to be told which.
    if (error instanceof LocationNotFound) {
      throw new GraphQLError(error.message, { extensions: { code: 'LOCATION_NOT_FOUND' } })
    }

    // Cold start, someone else already fetching, and the bounded wait ran out.
    // The one place the service does not answer, and it says which one.
    if (error instanceof NoDataYet) {
      throw new GraphQLError(error.message, { extensions: { code: 'NO_DATA_YET' } })
    }

    // Upstream having a bad five minutes is not a bug in this service, and a
    // masked 500 makes it look like one. With anything stored this no longer
    // fires for forecasts at all — stale-if-error turns the outage into a
    // flagged answer — so in practice it is geocoding that raises it.
    if (error instanceof OpenMeteoError) {
      throw new GraphQLError(`Open-Meteo is unavailable: ${error.message}`, {
        extensions: { code: 'UPSTREAM_UNAVAILABLE', upstreamStatus: error.status },
      })
    }

    // Deliberately unmasked-from-here: an infrastructure detail is not a
    // caller's business, so Yoga's mask is the right answer for the rest.
    throw error
  }
}

const HistoricalIssuanceRef = builder
  .objectRef<HistoricalIssuance>('HistoricalIssuance')
  .implement({
    description:
      'One date as one stored issuance saw it. This is what keeping issuances buys: an upsert ' +
      'per date would answer "what is the forecast for Friday" and destroy "what did we think ' +
      'on Tuesday that Friday would be".',
    fields: (t) => ({
      issuedAt: t.exposeString('issuedAt'),
      horizonDays: t.exposeInt('horizonDays', {
        description:
          'How many days ahead this date was when the issuance was fetched. Confidence is a ' +
          'function of it, which is why the same date scores differently from different days.',
      }),
      modelVersion: t.exposeString('modelVersion'),
      day: t.expose('day', { type: DayRef }),
    }),
  })

builder.queryType({
  fields: (t) => ({
    health: t.string({
      description: 'Returns "ok" when the service is running.',
      resolve: () => 'ok',
    }),
    release: t.string({
      description:
        'The git commit this process is running, or "unknown" when nothing stamped the build. ' +
        'The deploy log says what was sent; this says what is answering.',
      resolve: (_root, _args, ctx) => ctx.release,
    }),
    searchLocations: t.field({
      type: [LocationRef],
      description:
        'Every place matching an ambiguous name, in upstream order, choosing none of them. ' +
        'Use this when the caller must pick — activityForecast(query:) picks for them and says ' +
        'which. The ids returned here are usable with activityForecastAt.',
      args: {
        query: t.arg.string({ required: true }),
        limit: t.arg.int({ defaultValue: 5 }),
      },
      resolve: async (_root, args, ctx) =>
        await answering(async () => await searchForLocations(args.query, args.limit ?? 5, ctx.deps)),
    }),
    forecastHistory: t.field({
      type: [HistoricalIssuanceRef],
      description:
        'How our forecast for one date changed as that date approached, newest first. ' +
        'Issuances that never reached the date are omitted rather than padded — "we had not ' +
        'looked that far" is not "we thought nothing".',
      args: {
        locationId: t.arg.id({ required: true }),
        date: t.arg.string({ required: true, description: 'Local calendar date, YYYY-MM-DD.' }),
      },
      resolve: async (_root, args, ctx) =>
        await answering(
          async () => await getForecastHistory(String(args.locationId), args.date, ctx.deps),
        ),
    }),
    activityForecast: t.field({
      type: ForecastResultRef,
      description:
        'Resolve a city or town by name and rank the next seven days for skiing, surfing, ' +
        'outdoor sightseeing and indoor sightseeing. The weather is read from storage and ' +
        'refreshed at most once an hour per location.',
      args: { query: t.arg.string({ required: true }) },
      resolve: async (_root, args, ctx) =>
        await answering(async () => await getActivityForecast(args.query, ctx.deps)),
    }),
    activityForecastAt: t.field({
      type: ForecastResultRef,
      description:
        'The same ranking for a location the caller has already chosen, by the id ' +
        'searchLocations handed out. Two fields rather than one field with two optional ' +
        'arguments, because the latter admits both-set and neither-set — illegal states the ' +
        'schema should not be able to express.',
      args: { locationId: t.arg.id({ required: true }) },
      resolve: async (_root, args, ctx) =>
        await answering(async () => await getActivityForecastAt(String(args.locationId), ctx.deps)),
    }),
  }),
})

export const schema = builder.toSchema()
