# ADR 0003 — Two query fields, not one field with a `@oneOf` input

**Status:** accepted, 30 July 2026. Shipped: `activityForecast(query:)` and
`activityForecastAt(locationId:)`.
**Argued in:** [design.md §5](../design.md). **Decision rows:** [#46, #47](../decisions.md).

## Context

A caller can name a place two ways: by free text ("Cambridge") or by an id they already hold
(`geoname:4931972`). Three shapes were available:

```graphql
# A — one field, two optional arguments
activityForecast(query: String, locationId: ID): ForecastResult!

# B — one field, a @oneOf input
input LocationInput @oneOf { query: String, locationId: ID }
activityForecast(where: LocationInput!): ForecastResult!

# C — two fields
activityForecast(query: String!): ForecastResult!
activityForecastAt(locationId: ID!): ForecastResult!
```

## Decision

C: two fields.

### A is disqualified outright

Two optional arguments admit "both set" and "neither set". Both are illegal, neither is expressible
as illegal in the schema, and both therefore become runtime validation and a runtime error message.
Principle 4 exists to forbid exactly this: a state the type system permits and the code has to
apologise for.

### B is the interesting one, and it was rejected on how schemas are read

`@oneOf` says precisely what is meant: one of these, exactly one, enforced by the server. On
expressiveness it beats C outright, and the original argument against it was about attention —
a reviewer reads a schema in about thirty seconds, and in that budget two obvious fields beat one
clever field whose constraint lives in a directive they may have to look up.

That is a real argument but a soft one, and it is not the reason this decision is now easy to defend.

### What implementation turned into the actual reason

The two operations are not one operation with two inputs. They differ in behaviour and in effect:

| | `activityForecast(query:)` | `activityForecastAt(locationId:)` |
|---|---|---|
| Resolution | Geocodes, then obeys the resolution pin | None. The caller already chose |
| Side effect | **Writes a `resolutions` pin on first sight of a query string** | None |
| `alternatives` | The other candidates, in upstream order | Always empty |

The middle row is the decisive one. `activityForecast` mutates state — it pins "cambridge" to a
`geonameId` forever, which is the whole of the mitigation for risk 10 in [recon.md](../recon.md).
`activityForecastAt` writes nothing.

A `@oneOf` input would have put those two behind one field, and a caller reading the schema would
have no way to see that one branch has a durable side effect and the other does not. The
expressiveness argument was about the *input*; the operations differ in their *output* and their
*effect*, which no input union can express.

So B was rejected for a good reason and kept for a better one. The original argument stands, but if
it had been the only argument, the decision would deserve less confidence than it now has.

### The smaller reasons, stated as small

- `@oneOf` is a recent addition to the GraphQL spec, and client tooling support is uneven. This
  matters little for a service with no clients yet, and it is listed to be complete rather than
  because it decided anything.
- Field names carry meaning that argument names do not. `activityForecastAt` reads as "at this
  place"; `where: { locationId }` reads as a filter, which is what it is not.

## What this costs

**The schema says nearly the same thing twice.** Two fields return the same type with descriptions
that must be kept from drifting apart, and a reader has to notice that `activityForecastAt` is the
same ranking rather than a different one.

The duplication is documentation only, not logic: both fields call one `forecastFor`, and there is a
test asserting the two entry points produce the same days and the same model version. If they ever
diverge, one of the two is quietly a different service, and that test is what would say so.

## What would reverse this

- **A third way to name a place** — coordinates, an airport code, a postcode. Three fields is where
  the duplication stops being cheap and `@oneOf` starts being worth the reader's thirty seconds.
- **The side effects converging.** If the pin write moved out of the read path — into the background
  refresher, say — the two operations would become one operation with two inputs, and the argument
  above would evaporate along with the difference it rests on.
