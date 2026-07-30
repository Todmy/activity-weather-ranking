# ADR 0002 — GraphQL Yoga with Pothos, code-first

**Status:** accepted, 30 July 2026. Shipped: four query fields, eleven preloaded GraphiQL operations.
**Decision row:** [#10](../decisions.md). **Related:** [#35](../decisions.md) (no Express, no NestJS).

## Context

The service exposes one GraphQL endpoint and nothing else. There are four query fields, no mutations,
no subscriptions and no federation. The schema is small but the *types* are not trivial: a
three-member union for activity results, nested rankings on two axes, and an assessment block whose
absence is meaningful.

Two independent choices are bundled here because they interact:

1. **Which server** — Yoga against Apollo Server.
2. **Which direction** — code-first (types define the schema) against schema-first (SDL defines the
   types, with codegen bridging them).

The binding constraint on both is decision #35: there is no build step. Node 24 strips types at load
and `tsconfig.json` sets `erasableSyntaxOnly: true`, so nothing in this repository is generated and
`tsc --noEmit` is only a checker.

## Decision

GraphQL Yoga on `node:http`, with Pothos building the schema code-first.

### 1. Code-first, because a generated artifact would be the only one

Schema-first means an `.graphql` file plus `graphql-codegen` producing resolver types, which means a
generated file that has to be regenerated, committed, and kept honest in review. In a repository that
deliberately has no build output, that is one generated artifact — and the failure mode is specific:
a reviewer who edits the SDL and does not rerun codegen gets a schema and resolvers that disagree,
with TypeScript still passing.

Pothos inverts it. `builder.objectRef<ActivityForecast>('ForecastResult')` binds the GraphQL type to
the application type, and `t.exposeString('staleReason')` is a type error if `ActivityForecast` has
no such property. The domain type is the source of truth and the schema follows it, which is the
direction the data actually flows.

### 2. Yoga, because Apollo Server solves problems this service does not have

Apollo Server brings a plugin system, subscriptions, federation, caching directives and a landing
page. None of them are used here. Yoga is a request handler that takes a schema and returns a
`fetch`-compatible function, which is why `server.ts` is 50 lines over `node:http` with no framework
underneath.

Yoga also ships GraphiQL with a configurable `defaultQuery`, which is what makes constitution 12
achievable at all: eleven named operations load in the browser and a reviewer presses play instead of
inventing a query. That is a real, load-bearing feature rather than a tiebreaker.

### 3. TypeGraphQL was ruled out by the no-build-step choice, not by taste

TypeGraphQL is the other serious code-first option and it is decorator-based, which needs
`experimentalDecorators` and `emitDecoratorMetadata`. Both require a compiler that emits, and
`erasableSyntaxOnly: true` exists precisely to forbid syntax that cannot be erased. Choosing
TypeGraphQL would have meant reversing #35 and adding a build step to the whole repository for one
layer's convenience.

Pothos needs none of that: it is plain function calls and generics, which erase to nothing.

## What this cost, discovered rather than predicted

**Yoga masks errors, and it masked a real one.** Anything that is not a `GraphQLError` comes back as
`"Unexpected error."` with `INTERNAL_SERVER_ERROR`. In M2 a mistyped city name reached the deployed
service as a blank 500 while its schema test passed green, because `graphql()` called directly does
*not* mask and the test never went over HTTP.

Two things changed as a result, and both are better than what preceded them:

- API tests run through `createApp().fetch(...)` — the same instance the deployed service runs —
  rather than through `graphql()`. `yoga.test.ts` exists because of this bug.
- Error translation is explicit and in one place. `answering()` in `schema.ts` turns
  `LocationNotFound`, `NoDataYet` and `OpenMeteoError` into `GraphQLError`s with codes, and
  deliberately lets everything else stay masked — an infrastructure detail is not a caller's
  business.

The masking is defensible behaviour. Discovering it from a deployed blank 500 was not, and it is the
clearest example in this project of a green test that proved nothing.

## What is worse than schema-first here

**The schema is not a file anyone can read.** Schema-first's real advantage is that an SDL document
is the contract, reviewable as a diff: a pull request that removes a field shows a removed line. Here
the same change is a deleted `t.exposeString` call among TypeScript, and there is nothing in the
repository a client developer can open to see the whole API at once.

**Closed on 30 July**, after this ADR named it. [`docs/schema.graphql`](../schema.graphql) is the
printed SDL, committed, and `sdl.test.ts` fails if it drifts from the code. `pnpm schema`
regenerates it, so a pull request that removes a field now shows a removed line of contract.

What that does *not* recover is schema-first's other half. The file follows the code rather than
constraining it: a reviewer sees the change, and nothing stopped it. Under schema-first the SDL is
the thing you edit, and the resolvers are what breaks. This is a report, not a contract.

## What would reverse this

- **A second team consuming the API.** The moment the schema is a contract between teams rather than
  a surface one team owns, an SDL file that can be reviewed and versioned beats generating it.
- **Mutations arriving in numbers.** Code-first input types are the part of Pothos that reads worst,
  and a service with a dozen mutations would feel it.
- **Federation.** Yoga can federate, but Apollo's tooling is where that ecosystem lives.

## Consequences

- `src/api/schema.ts` is the schema. There is no other definition of it, and no step that can be
  forgotten.
- The printed SDL is generated from it into `docs/schema.graphql` and committed, so it can be read
  and diffed without running anything. It is derived, never edited: `sdl.test.ts` fails on any hand
  edit, which is the correct direction for a code-first project.
- Preloaded examples are a tested deliverable rather than documentation that drifts. Adding a field
  without adding a way to exercise it fails `graphiql.test.ts`, which is constitution 12 enforced
  rather than asserted.
