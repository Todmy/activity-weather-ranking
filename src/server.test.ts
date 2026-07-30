import { connect } from 'node:net'
import type { Socket } from 'node:net'
import { databaseNameFor } from './testing/database.ts'
import { afterEach, describe, expect, inject, it, vi } from 'vitest'
import { startServer } from './server.ts'

/**
 * The bootstrap over a real socket and a real database. Everything else in this
 * suite talks to the app in memory, which cannot tell you whether the process
 * actually listens, whether it stops when asked, or whether the endpoint is
 * where the README says it is. Port 0 lets the OS pick, so this never collides
 * with a dev server.
 */
let running: Awaited<ReturnType<typeof startServer>> | undefined

afterEach(async () => {
  await running?.close()
  running = undefined
})

const start = (refreshIntervalMs = 0, shutdownGraceMs?: number) =>
  startServer({
    port: 0,
    mongodbUri: inject('mongoUri'),
    mongodbDatabase: databaseNameFor(import.meta.url),
    refreshIntervalMs,
    ...(shutdownGraceMs === undefined ? {} : { shutdownGraceMs }),
  })

/** A raw socket, because `fetch` gives no way to leave a request half-sent. */
const openSocket = async (port: number): Promise<Socket> =>
  await new Promise((resolve, reject) => {
    const socket = connect(port, '127.0.0.1', () => resolve(socket))
    socket.once('error', reject)
  })

const answered = async (socket: Socket): Promise<string> =>
  await new Promise((resolve) => socket.once('data', (chunk) => resolve(String(chunk))))

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

  it('drops an idle keep-alive connection immediately, so a signal is not a hang', async () => {
    // Yoga keeps sockets alive. A shutdown that waited for the keep-alive
    // timeout would look like a hung process to whatever sent the signal.
    const server = await start(0, 5_000)
    const socket = await openSocket(server.port)
    socket.write(
      `GET /graphql?query=%7Bhealth%7D HTTP/1.1\r\nHost: 127.0.0.1\r\nConnection: keep-alive\r\n\r\n`,
    )
    expect(await answered(socket)).toContain('200')

    const started = performance.now()
    await server.close()
    socket.destroy()

    expect(performance.now() - started).toBeLessThan(1_000)
  })

  it('does not cut off a request already in flight, and gives up after the grace period', async () => {
    // `closeAllConnections()` destroys active connections too, so shutting down
    // that way severs whatever request is being served at the time. Idle
    // connections go immediately; a connection with a request still arriving
    // gets the grace period, and only then is forced.
    const server = await start(0, 400)
    const socket = await openSocket(server.port)
    // Complete headers, deliberately incomplete body. Node only counts a
    // connection as active once it has a request object, which unterminated
    // headers do not produce — the first version of this test wrote headers
    // without the blank line and passed against the very bug it was written for.
    socket.write(
      'POST /graphql HTTP/1.1\r\nHost: 127.0.0.1\r\n' +
        'content-type: application/json\r\ncontent-length: 40\r\n\r\n{"query":',
    )
    await new Promise((settle) => setTimeout(settle, 50))

    const started = performance.now()
    await server.close()
    const elapsed = performance.now() - started
    socket.destroy()

    expect(elapsed).toBeGreaterThanOrEqual(350)
    expect(elapsed).toBeLessThan(3_000)
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
