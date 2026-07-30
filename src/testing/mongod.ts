import { MongoMemoryServer } from 'mongodb-memory-server'

/**
 * One place to start a real `mongod` for a test file, and one place to explain
 * the timeout.
 *
 * `mongodb-memory-server` has its own launch timeout, and it defaults to ten
 * seconds — `MongoInstance.js`, `1000 * 10`. It is not the same clock as the
 * 120-second hook timeout the suites pass to `beforeAll`, and it fires first:
 * the failure is `GenericMMSError: Instance failed to start within 10000ms`
 * thrown from a hook, which fails the whole file and skips every test in it
 * without a single test having failed.
 *
 * That happened twice, and the second time left a fingerprint — one file failed,
 * six tests skipped, and exactly one file in this repository has six tests. Both
 * runs were on a laptop doing something else heavy at the time; seven suites
 * each start their own `mongod`, and vitest runs them in parallel.
 *
 * Sixty seconds sits well inside the hook's 120 and leaves the error message
 * useful if a start genuinely hangs. It treats the symptom rather than the
 * cause: the cause is seven `mongod` processes where one would do, and the real
 * fix is a shared instance in a vitest `globalSetup` with a database per file.
 * That is a test-infrastructure change with an isolation footgun in it — every
 * suite currently gets `db('test')` to itself — and it was not worth making on
 * submission day. Written down rather than done, which is the deal this project
 * keeps making.
 *
 * **Verified rather than assumed**, because this project has already shipped one
 * timeout that was decoration for an hour. A mutation would have been the better
 * proof and it does not work here: values below 1000 are clamped back to the
 * default by the library's own guard, and 1000 ms is not tight enough to fail —
 * all seven suites started inside it even when run together. So the evidence is
 * the running instance reporting `launchTimeout = 60000`, plus the library using
 * exactly that field once it is at least 1000 (`MongoInstance.js`).
 *
 * Test-only. Nothing outside `*.test.ts` imports this.
 */
export const LAUNCH_TIMEOUT_MS = 60_000

export const startMongod = async (): Promise<MongoMemoryServer> =>
  await MongoMemoryServer.create({ instance: { launchTimeout: LAUNCH_TIMEOUT_MS } })
