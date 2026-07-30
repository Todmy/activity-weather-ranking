import { createServer } from 'node:http'
import type { AddressInfo } from 'node:net'
import { createApp } from './api/yoga.ts'
import { liveDepsFor, liveRefresherDepsFor } from './app/liveDeps.ts'
import { tick } from './app/refresher.ts'
import { startSchedule } from './app/schedule.ts'
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
  refreshIntervalMs,
}: {
  port: number
  mongodbUri: string
  mongodbDatabase: string
  /** Zero runs no background refresher at all. Required, so no caller starts one by accident. */
  refreshIntervalMs: number
}): Promise<RunningServer> => {
  const store = await connectDatabase({ uri: mongodbUri, database: mongodbDatabase })
  const deps = liveDepsFor(store.db)
  const server = createServer(createApp({ deps }))

  // The refresher shares the process rather than running as its own service.
  // The lease is what makes that safe — it is the same lease the read path
  // takes, so a second instance behind the same database is already handled and
  // splitting this out would buy nothing this service needs yet.
  const refresher =
    refreshIntervalMs === 0
      ? undefined
      : startSchedule({
          intervalMs: refreshIntervalMs,
          run: async () => {
            await tick(liveRefresherDepsFor(store.db, deps))
          },
          onError: (error) => console.error('refresher: tick failed', error),
        })

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
          // Socket first, then the refresher, then the handle it uses. Stopping
          // the refresher waits for the tick in flight: closing the database
          // under one would throw where `ensureFresh` releases its lease, and
          // strand it for thirty seconds.
          await refresher?.stop()
          await store.close()
        },
      })
    })
  })
}
