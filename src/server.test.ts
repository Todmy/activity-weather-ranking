import { afterEach, describe, expect, it } from 'vitest'
import { startServer } from './server.ts'

/**
 * The bootstrap over a real socket. Everything else in this suite talks to the
 * app in memory, which cannot tell you whether the process actually listens,
 * whether it stops when asked, or whether the endpoint is where the README says
 * it is. Port 0 lets the OS pick, so this never collides with a dev server.
 */
let running: Awaited<ReturnType<typeof startServer>> | undefined

afterEach(async () => {
  await running?.close()
  running = undefined
})

describe('startServer', () => {
  it('listens and answers GraphQL over HTTP', async () => {
    running = await startServer(0)

    const response = await fetch(`http://127.0.0.1:${running.port}/graphql`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ query: '{ health }' }),
    })

    expect(await response.json()).toEqual({ data: { health: 'ok' } })
  })

  it('serves GraphQL at /graphql and nothing at /', async () => {
    running = await startServer(0)

    const response = await fetch(`http://127.0.0.1:${running.port}/`)

    expect(response.status).toBe(404)
  })

  it('stops listening when closed, so a signal can shut it down cleanly', async () => {
    const server = await startServer(0)
    const { port } = server
    await server.close()

    await expect(fetch(`http://127.0.0.1:${port}/graphql`)).rejects.toThrow()
  })
})
