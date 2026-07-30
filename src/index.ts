import { createServer } from 'node:http'
import { config } from './config.ts'
import { createApp } from './api/yoga.ts'

/**
 * Yoga runs directly on `node:http`. There is one endpoint and no REST routes,
 * so Express would be a layer nothing passes through. See decisions.md #35.
 *
 * The app itself is built in `api/yoga.ts`, which is what the tests exercise —
 * including the error masking, which only exists at this layer.
 */
const server = createServer(createApp())

server.listen(config.PORT, () => {
  console.log(`GraphQL ready at http://localhost:${config.PORT}/graphql`)
})

for (const signal of ['SIGINT', 'SIGTERM'] as const) {
  process.on(signal, () => {
    server.close(() => process.exit(0))
  })
}
