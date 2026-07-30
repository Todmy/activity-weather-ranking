import { createServer } from 'node:http'
import type { AddressInfo } from 'node:net'
import { createApp } from './api/yoga.ts'
import { liveDepsFor, liveRefresherDepsFor } from './app/liveDeps.ts'
import { tick } from './app/refresher.ts'
import { startSchedule } from './app/schedule.ts'
import { connectDatabase } from './persistence/client.ts'

/**
 * How long shutdown waits for a request in flight.
 *
 * It has to outlast the longest wait a request can legitimately make, which is
 * the cold-start poll loop's ten seconds — itself chosen to outlast the eight
 * second upstream cap, so a waiter does not give up on an answer that was about
 * to arrive. Eight here was inside Docker's default ten and *under* that poll
 * loop, so SIGTERM severed the one request the grace exists for and then closed
 * the database handle underneath it.
 *
 * Twelve does not fit in Docker's default, so `docker-compose.yml` declares a
 * `stop_grace_period` rather than inheriting one. `server.test.ts` holds the
 * whole chain in order; the numbers may move, the order may not.
 */
export const SHUTDOWN_GRACE_MS = 12_000

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
  release,
  shutdownGraceMs = SHUTDOWN_GRACE_MS,
}: {
  port: number
  mongodbUri: string
  mongodbDatabase: string
  /** Zero runs no background refresher at all. Required, so no caller starts one by accident. */
  refreshIntervalMs: number
  /** The commit this process is running, reported by the `release` query field. */
  release: string
  /** How long a request already in flight has to finish before it is forced. */
  shutdownGraceMs?: number
}): Promise<RunningServer> => {
  const store = await connectDatabase({ uri: mongodbUri, database: mongodbDatabase })
  const deps = liveDepsFor(store.db)
  const server = createServer(createApp({ deps, release }))

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
            let forced: ReturnType<typeof setTimeout> | undefined

            server.close((error) => {
              if (forced !== undefined) clearTimeout(forced)
              if (error) fail(error)
              else done()
            })

            // Yoga keeps sockets alive, and a close() that waited for the
            // keep-alive timeout would look like a hung process to whatever sent
            // the signal. Idle connections therefore go immediately — but only
            // idle ones: `closeAllConnections()` destroys active connections
            // too, which severs whatever request is being served at the time.
            server.closeIdleConnections()

            // A request still in flight gets this long to finish, and is then
            // forced. Eight seconds sits inside Docker's ten between SIGTERM and
            // SIGKILL, so the process decides how it dies rather than the
            // runtime deciding for it.
            forced = setTimeout(() => server.closeAllConnections(), shutdownGraceMs)
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
