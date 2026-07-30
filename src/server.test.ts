import { MongoMemoryServer } from 'mongodb-memory-server'
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest'
import { startServer } from './server.ts'

/**
 * The bootstrap over a real socket and a real database. Everything else in this
 * suite talks to the app in memory, which cannot tell you whether the process
 * actually listens, whether it stops when asked, or whether the endpoint is
 * where the README says it is. Port 0 lets the OS pick, so this never collides
 * with a dev server.
 */
let mongod: MongoMemoryServer
let running: Awaited<ReturnType<typeof startServer>> | undefined

beforeAll(async () => {
  mongod = await MongoMemoryServer.create()
}, 120_000)

afterAll(async () => {
  await mongod.stop()
})

afterEach(async () => {
  await running?.close()
  running = undefined
})

const start = () =>
  startServer({ port: 0, mongodbUri: mongod.getUri(), mongodbDatabase: 'server_test' })

describe('startServer', () => {
  it('listens and answers GraphQL over HTTP', async () => {
    running = await start()

    const response = await fetch(`http://127.0.0.1:${running.port}/graphql`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ query: '{ health }' }),
    })

    expect(await response.json()).toEqual({ data: { health: 'ok' } })
  })

  it('serves GraphQL at /graphql and nothing at /', async () => {
    running = await start()

    const response = await fetch(`http://127.0.0.1:${running.port}/`)

    expect(response.status).toBe(404)
  })

  it('stops listening when closed, so a signal can shut it down cleanly', async () => {
    const server = await start()
    const { port } = server
    await server.close()

    await expect(fetch(`http://127.0.0.1:${port}/graphql`)).rejects.toThrow()
  })

  it('refuses to start at all when the database is unreachable', async () => {
    // Never binds the socket in that case. A process that accepts requests it
    // cannot answer looks healthy to a load balancer, which is the worst of the
    // available failure modes.
    await expect(
      startServer({
        port: 0,
        mongodbUri: 'mongodb://127.0.0.1:1/',
        mongodbDatabase: 'nope',
      }),
    ).rejects.toThrow()
  }, 20_000)
})
