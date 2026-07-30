import { createServer } from 'node:http'
import type { AddressInfo } from 'node:net'
import { createApp } from './api/yoga.ts'

export type RunningServer = {
  /** The port actually bound, which matters when the caller asked for 0. */
  port: number
  close: () => Promise<void>
}

/**
 * Bind the app to a port.
 *
 * Separate from `index.ts` so a test can start a real socket, ask it a real
 * question and shut it down again. Passing 0 lets the OS choose a free port,
 * which is what keeps the test from fighting a dev server on 4000.
 */
export const startServer = (port: number): Promise<RunningServer> => {
  const server = createServer(createApp())

  return new Promise((resolve, reject) => {
    server.once('error', reject)
    server.listen(port, () => {
      server.removeListener('error', reject)
      resolve({
        port: (server.address() as AddressInfo).port,
        close: () =>
          new Promise((done, fail) => {
            server.close((error) => (error ? fail(error) : done()))
            // Yoga keeps sockets alive; without this a close() waits for the
            // keep-alive timeout and a signal looks like a hung process.
            server.closeAllConnections()
          }),
      })
    })
  })
}
