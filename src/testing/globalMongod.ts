import { MongoMemoryServer } from 'mongodb-memory-server'
import type { TestProject } from 'vitest/node'

/**
 * One `mongod` for the whole run, started before any suite and stopped after the
 * last one.
 *
 * It used to be one per file. Seven suites each started their own, vitest runs
 * files in parallel across twelve workers, and `mongodb-memory-server` gives an
 * instance ten seconds to report ready before it throws — from a `beforeAll`,
 * which fails the whole file and skips every test in it without a single test
 * having failed. That happened twice on a laptop that was also building a Docker
 * image, and the second time named the file: one failed, six skipped, and only
 * one suite here has six tests.
 *
 * A longer timeout treats that. One server removes it: there is nothing left to
 * race. What replaces the isolation each suite used to get for free is the
 * database name, derived from the suite's own path in `database.ts`.
 *
 * The launch timeout stays at sixty seconds anyway. It costs nothing now that it
 * is paid once, and a single slow start here fails the entire run rather than
 * one file, which is the case worth being generous about.
 */
export const LAUNCH_TIMEOUT_MS = 60_000

export default async function setup(project: TestProject) {
  const mongod = await MongoMemoryServer.create({
    instance: { launchTimeout: LAUNCH_TIMEOUT_MS },
  })

  project.provide('mongoUri', mongod.getUri())

  return async () => {
    await mongod.stop()
  }
}

declare module 'vitest' {
  interface ProvidedContext {
    mongoUri: string
  }
}
