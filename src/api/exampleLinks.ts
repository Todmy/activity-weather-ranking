import { EXAMPLES } from './examples.ts'

/**
 * The README's table of runnable examples, generated from the same list the
 * service serves.
 *
 * Twenty-four URLs written by hand is twenty-four things that rot silently, and
 * this repository spent a day correcting numbers that rotted exactly that way.
 * The arrangement is the one `docs/schema.graphql` already uses: a generator
 * (`pnpm examples`) writes the block, and a test fails when the committed block
 * and the code disagree.
 *
 * `?query=` rather than "open GraphiQL and find it in the dropdown", because
 * GraphiQL keeps tab state in localStorage: a browser that has been here before
 * shows its own tabs and never sees ours. A deep link opens a new tab whatever
 * the storage holds — verified in a browser, not assumed.
 */
export const LOCAL_ENDPOINT = 'http://localhost:4000/graphql'
export const LIVE_ENDPOINT = 'http://2.28.24.132:4000/graphql'

export const START_MARKER = '<!-- examples:start -->'
export const END_MARKER = '<!-- examples:end -->'

export const linkFor = (endpoint: string, query: string): string =>
  `${endpoint}?query=${encodeURIComponent(query)}`

/**
 * A cell's text may not contain an unescaped pipe, or the row silently gains a
 * column and the table renders wrong from that line down.
 */
const cell = (text: string): string => text.replace(/\|/g, '\\|')

export const renderExampleTable = (): string =>
  [
    START_MARKER,
    '',
    '| # | What you are checking | What a pass looks like | Run it locally | Run it on the live service |',
    '|---|---|---|---|---|',
    ...EXAMPLES.map(
      (example, index) =>
        `| ${index + 1} | **${cell(example.name)}** — ${cell(example.checks)} | ${cell(example.expect)} | [open](${linkFor(LOCAL_ENDPOINT, example.query)}) | [open](${linkFor(LIVE_ENDPOINT, example.query)}) |`,
    ),
    '',
    END_MARKER,
  ].join('\n')
