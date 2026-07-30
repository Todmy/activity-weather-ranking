import { createServer } from 'node:http'
import { createYoga } from 'graphql-yoga'
import { config } from './config.ts'
import { schema } from './api/schema.ts'

/**
 * Yoga runs directly on `node:http`. There is one endpoint and no REST routes,
 * so Express would be a layer nothing passes through. See decisions.md #35.
 */
const yoga = createYoga({ schema, graphqlEndpoint: '/graphql' })

const server = createServer(yoga)

server.listen(config.PORT, () => {
  console.log(`GraphQL ready at http://localhost:${config.PORT}/graphql`)
})

for (const signal of ['SIGINT', 'SIGTERM'] as const) {
  process.on(signal, () => {
    server.close(() => process.exit(0))
  })
}
