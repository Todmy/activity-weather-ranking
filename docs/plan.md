# Plan: activity-weather-ranking

2026-07-30. Derived from [`design.md`](./design.md).

Ordered as vertical slices, not layers. Each slice ends with something that runs, so a slice
abandoned mid-project still leaves a working service rather than three finished layers and no
product. Sizes are story points on a Fibonacci scale, relative to each other rather than to a
clock, and stated per slice rather than per task. The mapping to milestone codes M0 to M8 is in
[`../../milestones.md`](./milestones.md).

The ordering rule: **unpredictable work first, predictable work last.** Slices 1 and 3 carry the
schedule risk; slice 7 is the one that gives way if anything overruns.

**Every slice below is test-first, in every layer it touches** (principle 6, v3.0.0). The slices
written before 30 July say "test first" only against their domain steps, because that was the rule at
the time; read it as applying to the provider, application and API steps too. Concretely, from slice
2 onward: a provider step starts with a test over a captured probe, an API step starts with a test
through HTTP rather than through `graphql()`, and no step's code is written until its test has been
run and seen to fail for the reason intended.

---

## Slice 0 — Repository, skeleton, deployed — 1 point (M1)

Blocked on decision #32 (version control). Nothing else is blocked by it.

1. `git init`; commit the existing `docs/` tree as the first commit, with a message that says
   plainly it is a batch — the honest record of a deliberate deferral, not a pretence of gradual work.
2. Node 24 + TypeScript + Vitest + zod. Strict mode on.
3. GraphQL Yoga + Pothos serving one field: `health: String!`.
4. Dockerfile + `docker-compose.yml` (service + MongoDB). The reviewer runs the same file.
5. Bring the same compose file up on the Hetzner box. Confirm the deployed URL answers `{ health }`.

**Done when** the deployed URL returns a GraphQL response. Not when it builds locally.

Deploying now rather than at the end is the whole point of this slice: a deployment discovered on
the last day is a deployment that fails on the last day.

The box already exists and is managed as code, so this slice adds no new infrastructure and no
platform to learn under deadline. It also constrains the deployment usefully: whatever runs in
production is the compose file in the repository, not a console configuration nobody else can see.

## Slice 1 — Tracer bullet — 3 points (M2)

One city, one activity, no cache, no tests beyond the domain. Proves the whole path exists.

1. `providers/openmeteo/forecast.ts` — zod schema from the saved probe, typed client.
2. **Test first:** `domain/curves.test.ts` — `band`, `rampUp`, `rampDown` at boundaries, outside
   range, and inverted arguments.
3. `domain/curves.ts` to pass it.
4. **Test first:** outdoor-sightseeing profile against 3 hand-written scenarios from the sanity table.
5. `domain/profiles/outdoorSightseeing.ts` + `domain/score.ts` to pass it.
6. `activityForecast(query:)` resolving via geocoding and scoring live, with no persistence at all.
7. Redeploy.

**Done when** the deployed URL answers `activityForecast(query: "Innsbruck")` with a real number and
per-factor contributions.

**Blocked on** the sanity table for step 4. Curves can be written before it; the numbers cannot.

## Slice 2 — The rest of the domain — 5 points (M3), highest schedule risk

Pure TDD throughout. Zero I/O, so there is nothing to mock and no excuse.

1. Skiing, surfing, indoor-sightseeing profiles — sanity-table tests first, each threshold citing a
   named source in the profile file.
2. `domain/confidence.ts` — horizon decay × completeness.
3. `domain/applicability.ts` — the three-state `ActivityResult` union.
4. Ranking assembly: days-within-activity and activities-within-day from one computation, with the
   explicit tie-break (score, then activity name).
5. `domain/modelVersion.ts` + the snapshot test over the serialised domain config.

**Done when** every sanity-table row passes and the snapshot test fails on an unversioned change.

**This is the block with no natural stopping point.** The stopping rule is the table going green,
and nothing beyond it. Further tuning goes in the worklog as a temptation resisted, not into code.

## Slice 3 — Geography — 4 points (M4)

Carries the `locations` collection, which the plan originally put in slice 4. The dependency was
found while reviewing the plan against design.md §2 rather than while implementing, and it is not
optional: `terrain` and `marineCoverage` live on the location document, and without somewhere to
write them the 81-point grid is re-sampled on every request. The Elevation API meters per coordinate,
so that is 10,000 ÷ 81 ≈ **123 requests a day before the free tier is gone** — a deployed URL a
reviewer opens twice would exhaust it. Splitting here is honest rather than expedient: `locations` is
effectively immutable and needs no gateway, no lease and no TTL, so it is a genuine vertical slice
and not a borrowed piece of slice 4.

0. **Capture a summit forecast probe** before writing any test. `docs/probes/` has a city forecast and
   six marine responses; it has no forecast at a sampled high point, and design.md §2 requires a
   `summit` series alongside `city` and `marine`. Tests may not call the live API, so the fixture has
   to exist first.
1. `providers/openmeteo/elevation.ts` — the 11×11 circular 50 km grid, 81 points, pinned constants.
2. `providers/openmeteo/marine.ts` — all-null daily arrays mean no coverage, per recon.
3. The `locations` collection: the document from design.md §2, its `{ lastRequestedAt: -1 }` index,
   and read-through so a location is sampled once and never again.
4. Terrain and marine coverage computed once and written to the location.
5. The 300 m cost gate; skiing fetches a second forecast only above it.
6. Tests from the saved probes: Grenoble, Amsterdam, Vienna, Lisbon, Chicago. No live calls.

**Done when** Amsterdam returns `notApplicable/noTerrain` for skiing and Vienna returns
`notApplicable/noMarineCoverage` for surfing, both from fixtures — and a second request for the same
city performs no elevation call at all.

## Slice 4 — Persistence and the gateway — 5 points (M5)

1. `forecasts` and `resolutions` with their indexes; the `resolutions` pin. `locations` already
   exists from slice 3.
2. Issuance write + prune-beyond-24; `expiresAt` 30 days.
3. `ForecastGateway.ensureFresh` — the six-branch read path from design §3.
4. Lease acquire/release. **Test the `expiresAt < now` filter explicitly**, because Mongo's TTL
   monitor cannot be relied on for correctness.
5. Integration tests: TTL hit, TTL miss, lease contention with two concurrent callers, stale-if-error
   with upstream forced to fail, cold-start bounded wait.

**Done when** two concurrent requests for a cold location produce exactly one upstream fetch.

**Done, 30 July.** Five commits: `forecasts`, the lease, `resolutions`, the gateway, and the wiring
that makes the application layer unable to reach a provider directly. Verified on the deployed URL
with two concurrent requests plus a third for Ljubljana: one issuance, one fetch, no lease left
behind. 266 tests.

## Slice 5 — Full API — 2 points (M6)

1. `searchLocations`, `activityForecastAt`, `forecastHistory`.
2. `stale`, `modelVersion`, `issuedAt`, the ski assessment point, and the three-state union all
   surfaced in the schema.
3. GraphiQL with preloaded example queries — including one that demonstrates `notApplicable`, since
   that is the modelling point most easily missed.

**Done when** a reviewer can open the deployed GraphiQL and run every example without typing.

**Done, 30 July.** Three commits, one per capability: `searchLocations`, `activityForecastAt`,
`forecastHistory`. Eleven preloaded GraphiQL operations, every one of them valid against the schema
by test. 294 tests.

## Slice 6 — Background refresher — 3 points (M7)

Deliberately last. Additive: same gateway, same lease, no schema or API change.

1. Tick function over `lastRequestedAt` within 24 h, taking an injected clock.
2. `lastRequestedAt` written on the read path.
3. Graceful shutdown so a dying worker does not strand a lease.
4. Tests call the tick directly. No test waits on a timer.
5. A way to force a refresh, so the mechanism is visible to a reviewer who runs this for ten minutes.

**If the schedule bites, this is what gives way** — and `cut.md` already holds the entry explaining
why it would have been built.

## Slice 7 — The submission itself — 5 points (M8)

1. `README.md` — what it is, how to run it, the assumptions, the CC BY 4.0 attribution, and links
   into `decisions.md`.
2. `worklog.md` — raw, in Dmytro's voice. The two recon falsifications, the non-monotonic elevation
   result, the refresher challenged twice, and anything that was built and torn out.
3. Final pass over `decisions.md` so every call made during implementation is in it.

The worklog is graded first and is the one artifact that must not read as generated.

---

## Total

28 points across eight slices — 27 as first written, plus the one added to slice 3 when the
`locations` dependency surfaced. The slack is real but it lives entirely in slices 2 and 6;
everything else is predictable work whose shape is already settled.

## Learnings

Gotchas found while implementing, kept here so a later slice doesn't rediscover them.

- **A weighted mean cannot express harm or veto.** A factor that punishes one kind of day scores 1.0
  on every other kind, so the weight needed to punish also rewards. Cost slice 1 its UV factor
  (decision #36). Skiing row 4 in the sanity table is an outright veto, so slice 2 needs a mechanism
  that the additive model does not have. Decide it before fitting the ski curves, not after.
- **Yoga masks anything that is not a `GraphQLError`** as "Unexpected error." with
  INTERNAL_SERVER_ERROR. `graphql()` in a schema test does not, so error behaviour has to be tested
  through `createApp().fetch()` or it is not tested at all.
- **Vitest needs a wide inline list** for graphql to exist once: `[/graphql/, /@pothos/, /@envelop/,
  /@whatwg-node/]`. Anything narrower and a second copy loads through Yoga, and the only symptom is
  every resolver error arriving as INTERNAL_SERVER_ERROR.
- **`erasableSyntaxOnly` forbids constructor parameter properties.** Declare the field, assign in the
  body. Node's type stripping is the reason the flag is on.
- **The probes are fixtures with an expiry condition.** They are evidence about the live API only
  while the request that produced them matches the one the service sends, which is why
  `DAILY_VARIABLES` is pinned and asserted against the fixture's own keys.

## What blocked the start, and how each was cleared

- **Decision #32, version control.** Blocked slice 0 and nothing else. Cleared 2026-07-30: the
  repository is public and the deferral is recorded rather than hidden.
- **The sanity table.** Blocked step 4 of slice 1 and all of slice 2, because curves can be written
  without it but numbers cannot. Cleared, though not as designed: the human-intuition version failed
  and was replaced with cited conventions, three of which moved when they were actually checked.
