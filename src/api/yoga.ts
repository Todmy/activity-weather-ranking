import { createYoga } from 'graphql-yoga'
import { defaultQuery } from './graphiql.ts'
import { schema } from './schema.ts'
import type { GraphQLContext } from './schema.ts'

/**
 * The HTTP app, built here rather than in `index.ts` so that tests exercise the
 * same instance the deployed service runs.
 *
 * That distinction is not academic. Yoga masks any error that is not a
 * `GraphQLError` as "Unexpected error." with an INTERNAL_SERVER_ERROR code,
 * which `graphql()` on its own does not do — so a resolver error can pass a
 * schema test and still reach a reviewer as a blank 500. It did, until this
 * file existed.
 */
export const createApp = (context: GraphQLContext) =>
  createYoga({
    schema,
    graphqlEndpoint: '/graphql',
    graphiql: { title: 'Activity weather ranking', defaultQuery },
    context: () => context,
  })
