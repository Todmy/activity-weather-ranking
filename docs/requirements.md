# Requirements

Written 30 July 2026, after M6. This file exists because the requirements were being *met* without
being *stated*: they were spread across the brief, [`open-questions.md`](./open-questions.md),
[`principles.md`](./principles.md) and the invariants in [`recon.md`](./recon.md), and a reader had
no single place to check what was promised against what was built.

**Every row names its source.** That matters more than the list itself, because the three kinds of
requirement here carry very different authority:

| Source | Authority | What it means |
|---|---|---|
| **brief** | Binding. Quoted verbatim | The task asked for it |
| **assumption** | Mine, in place of a product owner's answer | Recorded with its rejected alternatives in `open-questions.md` |
| **self-imposed** | Mine, from the constitution | A standard this project holds itself to; nobody asked |

Only three phrases from the brief are quoted anywhere in this repository, and only those are treated
as brief-sourced below. Anything presented as a requirement without a quote behind it is an
assumption, and is labelled as one.

> "Ranks how good the next 7 days will be for each of these activities"
> "How you model, store, and refresh it is part of the problem."
> "We're not looking for volume. A focused submission that reasons well beats an exhaustive one."

---

## Functional requirements

| # | Requirement | Source | Where it is met | How to check it |
|---|---|---|---|---|
| FR1 | Take a city or town by free-text name | brief | `activityForecast(query:)` | `activityForecast(query: "Innsbruck")` |
| FR2 | Rank the next 7 days for skiing, surfing, outdoor and indoor sightseeing | brief | `rankings` on the result | GraphiQL `BestDaysPerActivity` |
| FR3 | Rank the four activities within each day | assumption ([Q1](./open-questions.md)) | `days[].activities`, ranked | GraphiQL `BestActivityPerDay` |
| FR4 | Score from weather that is **stored**, not fetched per request | brief | [`forecastGateway.ts`](../src/app/forecastGateway.ts) | Run `HowFreshIsThisAnswer` twice inside an hour; `issuedAt` does not move |
| FR5 | Refresh stored weather on a freshness window | brief ("refresh") + assumption ([Q4](./open-questions.md)) | 1 h TTL in `forecastGateway.ts` | `FRESHNESS_MS`, and its boundary test in `forecastGateway.test.ts` |
| FR6 | Many simultaneous callers for one cold location cause **one** upstream fetch | assumption ([Q4](./open-questions.md)) | Lease in [`leases.ts`](../src/persistence/leases.ts) + re-read after acquire ([#42](./decisions.md)) | Three concurrent requests for an unseen city return one identical `issuedAt` |
| FR7 | Keep answering when Open-Meteo is unreachable, and say the answer is stale | assumption ([Q4](./open-questions.md)) | stale-if-error branch | `stale` / `staleReason` on the result |
| FR8 | Say which place was scored, and offer the other candidates | assumption ([Q5](./open-questions.md)) | `location` + `alternatives` | GraphiQL `FiveCambridges` |
| FR9 | Let a caller choose the place instead of being chosen for | assumption ([Q5](./open-questions.md)) | `searchLocations` + `activityForecastAt` ([ADR 0003](./adr/0003-two-fields-not-oneof.md)) | GraphiQL `LetMePickTheCambridge` |
| FR10 | Never silently change which place a query means | assumption (risk 10, [recon](./recon.md)) | `resolutions` pin, first-writer-wins | `resolutions.test.ts`, "answers with the pinned city after upstream reorders" |
| FR11 | Distinguish "not applicable here" from "scored badly" from "we could not look" | assumption ([Q6](./open-questions.md)) | Three-member union in [`activityResult.ts`](../src/domain/activityResult.ts) | GraphiQL `NoMountainNoOcean` |
| FR12 | Decide skiing and surfing applicability by **measurement**, with no list of cities | assumption ([Q2](./open-questions.md), [Q3](./open-questions.md)) | 81-point terrain grid; marine nulls | `assessment` on any result |
| FR13 | Explain a score by the factors and gates that produced it | self-imposed (principle 5) | `factors`, `gates`, `base` on `ScoredActivity` | GraphiQL `WhyThatScore` |
| FR14 | State the model version an answer was scored with | self-imposed (principle 9) | `modelVersion`, snapshot-tested | `modelVersion.test.ts` |
| FR15 | Show how a forecast for one date changed as that date approached | self-imposed (depth on "model, store") | `forecastHistory` | GraphiQL `HowFridayChanged` |
| FR16 | Refuse honestly rather than inventing an answer | assumption ([Q6](./open-questions.md)) | `LOCATION_NOT_FOUND`, `NO_DATA_YET`, `UPSTREAM_UNAVAILABLE` | GraphiQL `NoSuchPlace` |
| FR17 | Every capability reachable by a query a human can paste | self-imposed (constitution 12) | 11 preloaded GraphiQL operations | `graphiql.test.ts` validates all of them against the schema |
| FR18 | Keep recently-requested locations warm on a schedule | assumption (scope call, [cut.md](./cut.md)) | A tick every 10 min over `lastRequestedAt` within 24 h, through the read path's own `ensureFresh` | `refresher.test.ts`, `schedule.test.ts`, the boot log in [`milestones.md`](./milestones.md) |

Every functional row is now met. FR18 was the last, and it was sequenced last deliberately because it
is additive: same gateway, same lease, no schema change and no API change.

**The exception in NFR5**, found by the verify stage rather than by design. `ensureLocation` has no
single-flight: two requests arriving together for a city the service has *never seen* both find no
terrain and both sample the grid, so that city costs 162 coordinates instead of 81. It is bounded —
it can only happen on a city's first-ever sighting, and never again — and it was left rather than
fixed, because a second lease is machinery this service needs nowhere else and the worst case is one
duplicated sample per city in the whole lifetime of the database. Recorded here because "81
coordinates once per city, ever" is otherwise an overclaim, and principle 5 applies to our own
numbers as much as to the forecast's.

## Non-functional requirements

| # | Requirement | Source | Where it is met | How to check it |
|---|---|---|---|---|
| NFR1 | The same stored issuance and model version reproduce the same output exactly | self-imposed (principle 9) | One `scoreIssuance` for the live path and replay; clock injected; explicit tie-break order | [`design.md` §6](./design.md) maps seven sources of non-determinism to where each is closed |
| NFR2 | No test may call Open-Meteo | self-imposed (constitution) | 17 captured probes in [`probes/`](./probes/) | `pnpm test` runs offline |
| NFR3 | `domain/` performs no I/O — no clock, no database, no fetch | self-imposed (principle 9; it is the boundary that makes determinism checkable) | Pure functions throughout `src/domain/` | No import of `providers/` or `persistence/` in `domain/` |
| NFR4 | Tests run against a real database, not a fake | self-imposed | `mongodb-memory-server` runs `mongod` 8.2.6 against `mongo:8` in compose | `pnpm test` with no Docker daemon |
| NFR5 | Cold terrain sampling stays inside the free tier | external (Open-Meteo meters elevation **per coordinate**, 10k/day) | 81 coordinates once per city, ever — with one exception, below | ~123 unseen cities/day; steady state is bounded by the cheaper forecast API |
| NFR6 | An upstream call may not outlive the lease that guards it | self-imposed (risk 8, [recon](./recon.md)) | 8 s `AbortSignal` into `fetch` against a 30 s lease ([ADR 0001](./adr/0001-mongodb-over-postgres.md)) | Provider tests assert the signal reaches `fetch` |
| NFR7 | A cold start never waits unboundedly | assumption ([Q6](./open-questions.md)) | 100 polls × 100 ms, then `NO_DATA_YET` | `forecastGateway.test.ts`, "gives up after a bounded number of polls" |
| NFR8 | Never lose the last surviving issuance | self-imposed (risk 7, [recon](./recon.md)) | Retention is application-side; TTL is only a 30-day backstop | `forecasts.test.ts` prune tests |
| NFR9 | No scoring number without a named published source | self-imposed (constitution) | Every profile constant cites its source; curves fitted to [`sanity-table.md`](./sanity-table.md) | All 20 sanity rows pass |
| NFR10 | The reviewer runs the same thing I do | self-imposed | One `docker-compose.yml`, used locally and by the deployed box | `docker compose up` |
| NFR11 | No build step, so no compiled output can drift from source | self-imposed ([#35](./decisions.md)) | Node 24 type stripping, `erasableSyntaxOnly` | `tsc --noEmit` is a checker only |
| NFR12 | Open-Meteo attribution, CC BY 4.0 | external (licence) | README, and each weather provider file. Place data comes from GeoNames via Open-Meteo and is attributed separately in `geocoding.ts` | — |
| NFR13 | One revertable change per commit, message naming everything in it | self-imposed (constitution 11) | Commit history from 30 July onward | `git log` |
| NFR14 | The schema is readable and diffable without running the service | self-imposed ([ADR 0002](./adr/0002-yoga-pothos-code-first.md), which named its absence as a cost) | [`schema.graphql`](./schema.graphql), generated by `pnpm schema` | `sdl.test.ts` fails if it drifts from the code |
| NFR15 | Typecheck and tests enforced on push, not only by discipline | self-imposed | [`.github/workflows/ci.yml`](../.github/workflows/ci.yml) | The run on any commit; no service container, because the tests start their own mongod |

### Non-functional requirements deliberately **not** met

Named rather than omitted, because an unstated gap reads as an oversight:

| Gap | Why | What it would take |
|---|---|---|
| **No authentication, no rate limiting** | The service holds no user data and exposes read-only public weather. A take-home deployed for one reviewer does not justify an auth story, and adding one would be scope the brief did not ask for | An API key at the Yoga layer, and a per-key quota in front of the gateway |
| **Single instance, no horizontal scale story** | The lease is correct across processes — it is a database row, not in-memory state — so a second instance would work. Nothing proves it, because nothing runs two | Two containers behind a proxy, and a test asserting one fetch across both |
| **No metrics and no tracing** | Real production requirements that demonstrate nothing about modelling weather. Request logging *was* added — a service with no access log cannot say what happened, which is a different claim from cannot say it in aggregate. Audited against all twelve factors in [`twelve-factor.md`](./twelve-factor.md) | OpenTelemetry at the gateway and provider boundaries, and a Prometheus endpoint |
| **The scoring model is reviewable, not validated** | Backtesting against historical conditions is the right way to calibrate and does not fit the budget. [`cut.md`](./cut.md) records the argument; the README says so plainly rather than implying the numbers are verified | Historical archive fetches plus an evaluation harness |

## Keeping this file honest

Every row above points at something runnable or readable. The rows most likely to rot:

- **FR18** flipped to met on 30 July when M7 shipped, which is what this section was written to make
  happen rather than to predict.
- **NFR5**'s quota arithmetic depends on the terrain grid staying at 81 coordinates. If `GRID_VERSION`
  changes, this number changes with it.

If a requirement here cannot be demonstrated by the check in its own row, the row is wrong and should
be deleted rather than softened.
