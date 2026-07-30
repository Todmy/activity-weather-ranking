import { z } from 'zod'

/**
 * Configuration is validated once, at startup, and never read from `process.env`
 * again. A missing variable should stop the process with a readable message
 * rather than surface as `undefined` somewhere inside a request.
 *
 * Parsing is a pure function of an environment record so it can be tested;
 * exiting the process is the module body's job and stays out of it.
 */
const schema = z.object({
  PORT: z.coerce.number().int().positive().default(4000),
  MONGODB_URI: z.string().min(1).default('mongodb://localhost:27017'),
  MONGODB_DB: z.string().min(1).default('activity_weather'),
  /**
   * How often the background refresher wakes. Ten minutes against an hour of
   * freshness: often enough that a city is rarely more than ten minutes past
   * its TTL when somebody asks, cheap enough that most ticks find nothing to do
   * and cost one indexed query.
   *
   * Zero turns it off, which is a real deployment rather than an escape hatch —
   * a second instance behind the same database does not need a second
   * refresher, and neither does a test.
   */
  REFRESH_INTERVAL_MS: z.coerce.number().int().nonnegative().default(600_000),
})

export type Config = z.infer<typeof schema>

export type ConfigResult =
  | { success: true; config: Config }
  | { success: false; problems: string[] }

export const parseConfig = (env: Record<string, string | undefined>): ConfigResult => {
  const parsed = schema.safeParse(env)

  return parsed.success
    ? { success: true, config: parsed.data }
    : {
        success: false,
        problems: parsed.error.issues.map((issue) => `${issue.path.join('.')}: ${issue.message}`),
      }
}

const result = parseConfig(process.env)

if (!result.success) {
  console.error('Invalid configuration:')
  for (const problem of result.problems) {
    console.error(`  ${problem}`)
  }
  process.exit(1)
}

export const config = result.config
