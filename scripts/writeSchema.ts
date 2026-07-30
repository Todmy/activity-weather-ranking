import { writeFileSync } from 'node:fs'
import { printSchema } from 'graphql'
import { schema } from '../src/api/schema.ts'

/**
 * Prints the code-first schema to `docs/schema.graphql`.
 *
 * The file is the contract a reader can open and a diff can show; `sdl.test.ts`
 * is what keeps it honest. Run with `pnpm schema` after changing the schema, and
 * read the resulting diff rather than committing it blind — a field disappearing
 * from that file is exactly the event this arrangement exists to make visible.
 */
const target = new URL('../docs/schema.graphql', import.meta.url)

writeFileSync(target, printSchema(schema))
console.log(`wrote ${target.pathname}`)
