import { z } from 'zod'

/**
 * Configuration is validated once, at startup, and never read from `process.env`
 * again. A missing variable should stop the process with a readable message
 * rather than surface as `undefined` somewhere inside a request.
 */
const schema = z.object({
  PORT: z.coerce.number().int().positive().default(4000),
  MONGODB_URI: z.string().min(1).default('mongodb://localhost:27017'),
  MONGODB_DB: z.string().min(1).default('activity_weather'),
})

const parsed = schema.safeParse(process.env)

if (!parsed.success) {
  console.error('Invalid configuration:')
  for (const issue of parsed.error.issues) {
    console.error(`  ${issue.path.join('.')}: ${issue.message}`)
  }
  process.exit(1)
}

export const config = parsed.data
