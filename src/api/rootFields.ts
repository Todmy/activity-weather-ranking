import { GraphQLError } from 'graphql'
import type { ASTVisitor, ValidationContext } from 'graphql'

/**
 * A cap on how many root fields one document may ask for.
 *
 * Root fields resolve concurrently, and `activityForecast` on a city this
 * service has never seen costs 81 metered elevation coordinates against an
 * allowance of 10,000 a day (NFR5, ~123 unseen cities). One unauthenticated
 * POST carrying 123 aliases spends all of it. The lease is no defence: it stops
 * the service racing itself, not a caller racing it on purpose.
 *
 * Five, and the number is arrived at rather than borrowed. The largest example
 * this repository ships asks for two cities in one document, and a caller
 * combining that with `release` and `health` reaches four. A library default —
 * graphql-armor's `maxAliases` is fifteen — would be a number in this service
 * with no source behind it, which is the one thing every other number here is
 * not allowed to be.
 *
 * It does not bound the day, only the request: a caller sending five at a time,
 * often enough, still reaches the same total. What that needs is a per-caller
 * rate limit or a daily sampling budget, and `docs/requirements.md` says so
 * rather than implying this closes it.
 */
export const MAX_ROOT_FIELDS = 5

/**
 * Counted by parent type rather than by walking the operation, which also
 * covers fragments: a field's parent type is `Query` inside a fragment defined
 * on `Query` too. Repeated spreads of one fragment need no extra allowance —
 * field collection merges on response key, so N distinct root fields need N
 * distinct field nodes somewhere in the document, and every one of them is
 * counted here.
 */
export const limitRootFields = (context: ValidationContext): ASTVisitor => {
  let seen = 0

  return {
    Field(node) {
      if (context.getParentType()?.name !== 'Query') return

      seen += 1
      if (seen !== MAX_ROOT_FIELDS + 1) return

      context.reportError(
        new GraphQLError(
          `A document may ask for at most ${MAX_ROOT_FIELDS} root fields. ` +
            'Each one for a city this service has not seen costs 81 metered ' +
            'elevation coordinates, so the limit protects a shared allowance ' +
            'rather than this process.',
          { nodes: node },
        ),
      )
    },
  }
}
