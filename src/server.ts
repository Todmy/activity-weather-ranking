import { createServer } from 'node:http'
import type { AddressInfo } from 'node:net'
import { createApp } from './api/yoga.ts'
import { liveDepsFor } from './app/liveDeps.ts'
import { connectDatabase } from './persistence/client.ts'

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
 *
 * The database is opened before the socket is bound, so a service that is
 * accepting requests is a service that can answer them. Its handle is closed on
 * the way down, in the same order reversed.
 */
export const startServer = async ({
  port,
  mongodbUri,
  mongodbDatabase,
}: {
  port: number
  mongodbUri: string
  mongodbDatabase: string
}): Promise<RunningServer> => {
  const store = await connectDatabase({ uri: mongodbUri, database: mongodbDatabase })
  const server = createServer(createApp({ deps: liveDepsFor(store.db) }))

  return new Promise((resolve, reject) => {
    server.once('error', (error) => {
      void store.close().then(() => reject(error))
    })
    server.listen(port, () => {
      server.removeListener('error', reject)
      resolve({
        port: (server.address() as AddressInfo).port,
        close: async () => {
          await new Promise<void>((done, fail) => {
            server.close((error) => (error ? fail(error) : done()))
            // Yoga keeps sockets alive; without this a close() waits for the
            // keep-alive timeout and a signal looks like a hung process.
            server.closeAllConnections()
          })
          await store.close()
        },
      })
    })
  })
}
