import { EXAMPLES } from './examples.ts'

/**
 * What GraphiQL loads with.
 *
 * Both shapes come from the same list in `examples.ts`, because GraphiQL uses
 * them in different circumstances and a reviewer should not be able to tell
 * which one they got.
 *
 * Neither survives a browser that has been here before: GraphiQL persists tab
 * state in localStorage, and both `defaultTabs` and `defaultQuery` apply only
 * when that storage is empty. Someone who has opened any GraphiQL on this
 * origin sees their own tabs instead. That is why the README links each example
 * as `?query=...` rather than telling a reader to look for it in the editor —
 * a deep link opens a new tab whatever the storage holds.
 */
const SPELLED = [
  'Zero', 'One', 'Two', 'Three', 'Four', 'Five', 'Six',
  'Seven', 'Eight', 'Nine', 'Ten', 'Eleven', 'Twelve', 'Thirteen',
]

/**
 * One tab per example, which is how a first-time visitor sees that there are
 * twelve things to run rather than one document to scroll.
 */
export const defaultTabs = EXAMPLES.map((example) => ({ query: example.query }))

/**
 * The same examples as one document, for the operation picker.
 *
 * The header states no milestone and no date. It said "Storage arrives in M5"
 * for four milestones after storage shipped, because it was prose nothing could
 * falsify; the count is now derived and the rest describes the queries rather
 * than when they were written.
 */
export const defaultQuery = [
  `# ${SPELLED[EXAMPLES.length]} queries, one per tab — or pick one from the dropdown next to the
# play button. Every one of them runs against this service as it stands.
#
# All four activities answer for real, because geography is measured rather than
# looked up. Skiing is scored at a sampled high point rather than at the city
# coordinate, and query 6 shows where. Query 7 shows the other outcome: measured
# absence, which is notApplicable and deliberately not a score of zero.
#
# The weather behind every answer is stored rather than fetched per request.
# Query 8 shows that from outside: run it twice and issuedAt does not move.
# Query 11 shows what keeping issuances buys — one date as every stored forecast
# saw it, with the horizon each was seen at.`,
  ...EXAMPLES.map((example) => example.query),
].join('\n\n')
