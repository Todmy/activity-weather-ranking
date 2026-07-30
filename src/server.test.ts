import { MongoMemoryServer } from 'mongodb-memory-server'
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest'
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

const start = (refreshIntervalMs = 0) =>
  startServer({
    port: 0,
    mongodbUri: mongod.getUri(),
    mongodbDatabase: 'server_test',
    refreshIntervalMs,
  })

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

  it('starts the background refresher and says so in the log', async () => {
    // The wiring is the only part of M7 a unit test cannot reach: the tick and
    // the schedule are both exercised in isolation, and this is what proves the
    // process actually joins them up. Safe against a live API because the
    // database is empty — nothing is due, so nothing is fetched.
    const lines: string[] = []
    const log = vi.spyOn(console, 'log').mockImplementation((line: string) => {
      lines.push(line)
    })

    try {
      running = await start(60_000)
      await vi.waitFor(() => expect(lines.join('\n')).toContain('refresher: woke at'))
    } finally {
      log.mockRestore()
    }

    expect(lines.join('\n')).toContain('refresher: done — 0 refreshed, 0 skipped, 0 failed')
  })

  it('leaves the refresher off when the interval is zero', async () => {
    const lines: string[] = []
    const log = vi.spyOn(console, 'log').mockImplementation((line: string) => {
      lines.push(line)
    })

    try {
      running = await start(0)
      await new Promise((resolve) => setTimeout(resolve, 50))
    } finally {
      log.mockRestore()
    }

    expect(lines.join('\n')).not.toContain('refresher:')
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
        refreshIntervalMs: 0,
      }),
    ).rejects.toThrow()
  }, 20_000)
})
