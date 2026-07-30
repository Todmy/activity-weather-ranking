import { MongoClient } from 'mongodb'
import type { Db } from 'mongodb'
import { inject } from 'vitest'

/**
 * Connecting a suite to the one `mongod` the whole run shares.
 *
 * The server is started once in `globalMongod.ts` rather than once per file.
 * What used to keep suites apart was having a server each; what keeps them apart
 * now is the database name, and that name is derived from the file's own path so
 * that two suites cannot pick the same one by accident. A hand-written name
 * would work right up until somebody copied a suite.
 *
 * Test-only. Nothing outside `*.test.ts` imports this.
 */
export const databaseNameFor = (moduleUrl: string): string => {
  const segments = new URL(moduleUrl).pathname.split('/').filter(Boolean)
  const file = (segments.at(-1) ?? 'suite').replace(/\.test\.tsx?$/, '')
  const directory = segments.at(-2) ?? 'root'

  // `/`, `.` and `$` are all illegal in a database name and paths are full of
  // them. Directory and file together, because `persistence/forecasts.test.ts`
  // and a future `app/forecasts.test.ts` must not land in the same database.
  return `${directory}_${file}`.replace(/[^A-Za-z0-9_-]/g, '_')
}

export type TestDatabase = {
  db: Db
  close: () => Promise<void>
}

export const connectTestDatabase = async (moduleUrl: string): Promise<TestDatabase> => {
  const client = new MongoClient(inject('mongoUri'))
  await client.connect()

  return {
    db: client.db(databaseNameFor(moduleUrl)),
    close: async () => {
      await client.close()
    },
  }
}
