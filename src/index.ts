import { config } from './config.ts'
import { startServer } from './server.ts'

/**
 * The process. Everything with behaviour lives in `server.ts`, which a test can
 * start and stop; what is left here is reading the port and wiring two signals,
 * because a test that installs a SIGTERM handler in its own process is a test
 * that shuts down the test runner.
 */
const server = await startServer({
  port: config.PORT,
  mongodbUri: config.MONGODB_URI,
  mongodbDatabase: config.MONGODB_DB,
  refreshIntervalMs: config.REFRESH_INTERVAL_MS,
  release: config.GIT_SHA,
})

console.log(`GraphQL ready at http://localhost:${server.port}/graphql`)

for (const signal of ['SIGINT', 'SIGTERM'] as const) {
  process.on(signal, () => {
    void server.close().then(() => process.exit(0))
  })
}
