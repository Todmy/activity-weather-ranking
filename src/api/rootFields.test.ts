import { describe, expect, it } from 'vitest'
import { parse, specifiedRules, validate } from 'graphql'
import { MAX_ROOT_FIELDS, limitRootFields } from './rootFields.ts'
import { schema } from './schema.ts'

/**
 * The rule on its own, alongside the HTTP test that proves it is wired in.
 *
 * Both are needed: a rule nobody added to the app protects nothing, and a rule
 * only tested through the app cannot say where its edges are.
 */
const errorsFor = (query: string): string[] =>
  validate(schema, parse(query), [...specifiedRules, limitRootFields]).map(
    (error) => error.message,
  )

const forecasts = (count: number): string =>
  `{ ${Array.from(
    { length: count },
    (_, index) => `c${index}: activityForecast(query: "City${index}") { issuedAt }`,
  ).join(' ')} }`

describe('the root-field limit', () => {
  it('allows a document exactly at the limit', () => {
    expect(errorsFor(forecasts(MAX_ROOT_FIELDS))).toEqual([])
  })

  it('reports one error for a document over it, not one per extra field', () => {
    // A caller who sent 200 should get an answer, not two hundred of them.
    const errors = errorsFor(forecasts(200))

    expect(errors).toHaveLength(1)
    expect(errors[0]).toMatch(/at most 5 root fields/)
  })

  it('says what the limit protects, so the message is actionable', () => {
    // A bare "too many fields" tells a caller the service is fussy. The cost is
    // the reason, and the reason is the only part they can plan around.
    expect(errorsFor(forecasts(6))[0]).toMatch(/81 metered elevation coordinates/)
  })

  it('counts root fields reached through a fragment', () => {
    // The obvious way around a rule that walks the operation's own selection
    // set. Counting by parent type sees these, because a field defined in a
    // fragment on Query has Query as its parent type too.
    const spread = `
      { ...manyCities }
      fragment manyCities on Query {
        ${Array.from(
          { length: 8 },
          (_, index) => `c${index}: activityForecast(query: "City${index}") { issuedAt }`,
        ).join(' ')}
      }
    `

    expect(errorsFor(spread)).toHaveLength(1)
  })

  it('leaves nested fields alone, however deep', () => {
    // Depth is not the problem and is not exploitable here: the schema is
    // acyclic, so it terminates on its own. Breadth at the root is what costs
    // an upstream call, and a rule that punished nesting would break the
    // factors-and-gates query that explains a score.
    const deep = `{
      activityForecast(query: "Innsbruck") {
        days { date activities { ... on ScoredActivity {
          activity score band confidence
          factors { name weight rawValue curveValue contribution }
          gates { name rawValue multiplier }
        } } }
      }
    }`

    expect(errorsFor(deep)).toEqual([])
  })
})
