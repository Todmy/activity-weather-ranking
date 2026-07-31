import { readFileSync, writeFileSync } from 'node:fs'
import { END_MARKER, START_MARKER, renderExampleTable } from '../src/api/exampleLinks.ts'

/**
 * Rewrites the README's table of runnable examples from `src/api/examples.ts`.
 *
 * The same arrangement as `pnpm schema`: the generated block is committed so a
 * reader can open it, and `exampleLinks.test.ts` fails when it and the code
 * disagree. Run `pnpm examples` after changing an example, and read the diff —
 * a link that changes where it points is exactly what this makes visible.
 */
const target = new URL('../README.md', import.meta.url)
const readme = readFileSync(target, 'utf8')

const start = readme.indexOf(START_MARKER)
const end = readme.indexOf(END_MARKER)

if (start === -1 || end === -1) {
  throw new Error(
    `README.md is missing ${START_MARKER} / ${END_MARKER}. The generated table has nowhere to go.`,
  )
}

writeFileSync(
  target,
  readme.slice(0, start) + renderExampleTable() + readme.slice(end + END_MARKER.length),
)

console.log(`wrote the example table into ${target.pathname}`)
