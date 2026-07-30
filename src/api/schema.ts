import SchemaBuilder from '@pothos/core'

/**
 * Code-first schema. The GraphQL SDL is derived from this file rather than the
 * other way round, so there is no generated artifact to keep in step with the
 * resolvers.
 *
 * Right now it serves one field. Slice 1 adds the first real query.
 */
const builder = new SchemaBuilder<{}>({})

builder.queryType({
  fields: (t) => ({
    health: t.string({
      description: 'Returns "ok" when the service is running.',
      resolve: () => 'ok',
    }),
  }),
})

export const schema = builder.toSchema()
