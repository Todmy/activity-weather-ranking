# Plan: activity-weather-ranking

Stage 4 of 7. Date: 2026-07-30. Design: [`design.md`](./design.md).

Ordered as vertical slices, not layers. Each slice ends with something that runs, so a slice
abandoned mid-project still leaves a working service rather than three finished layers and no
product. Estimates assume AI-assisted work and are stated per slice, not per task.

The ordering rule: **unpredictable work first, predictable work last.** Slices 1 and 3 carry the
schedule risk; slice 7 is the one that gives way if anything overruns.

---

## Slice 0 — Repository, skeleton, deployed — 1 h

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

## Slice 1 — Tracer bullet — 2 h

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

## Slice 2 — The rest of the domain — 3 h, highest schedule risk

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

## Slice 3 — Geography — 2 h

1. `providers/openmeteo/elevation.ts` — the 11×11 circular 50 km grid, 81 points, pinned constants.
2. `providers/openmeteo/marine.ts` — all-null daily arrays mean no coverage, per recon.
3. Terrain and marine coverage computed once and written to the location.
4. The 300 m cost gate; skiing fetches a second forecast only above it.
5. Tests from the saved probes: Grenoble, Amsterdam, Vienna, Lisbon, Chicago. No live calls.

**Done when** Amsterdam returns `notApplicable/noTerrain` for skiing and Vienna returns
`notApplicable/noMarineCoverage` for surfing, both from fixtures.

## Slice 4 — Persistence and the gateway — 3 h

1. Three collections with their indexes; the `resolutions` pin.
2. Issuance write + prune-beyond-24; `expiresAt` 30 days.
3. `ForecastGateway.ensureFresh` — the six-branch read path from design §3.
4. Lease acquire/release. **Test the `expiresAt < now` filter explicitly**, because Mongo's TTL
   monitor cannot be relied on for correctness.
5. Integration tests: TTL hit, TTL miss, lease contention with two concurrent callers, stale-if-error
   with upstream forced to fail, cold-start bounded wait.

**Done when** two concurrent requests for a cold location produce exactly one upstream fetch.

## Slice 5 — Full API — 1.5 h

1. `searchLocations`, `activityForecastAt`, `forecastHistory`.
2. `stale`, `modelVersion`, `issuedAt`, the ski assessment point, and the three-state union all
   surfaced in the schema.
3. GraphiQL with preloaded example queries — including one that demonstrates `notApplicable`, since
   that is the modelling point most easily missed.

**Done when** a reviewer can open the deployed GraphiQL and run every example without typing.

## Slice 6 — Background refresher — 2 h

Deliberately last. Additive: same gateway, same lease, no schema or API change.

1. Tick function over `lastRequestedAt` within 24 h, taking an injected clock.
2. `lastRequestedAt` written on the read path.
3. Graceful shutdown so a dying worker does not strand a lease.
4. Tests call the tick directly. No test waits on a timer.
5. A way to force a refresh, so the mechanism is visible to a reviewer who runs this for ten minutes.

**If the schedule bites, this is what gives way** — and `cut.md` already holds the entry explaining
why it would have been built.

## Slice 7 — The submission itself — 2 h

1. `README.md` — what it is, how to run it, the assumptions, the CC BY 4.0 attribution, and links
   into `decisions.md`.
2. `worklog.md` — raw, in Dmytro's voice. The two recon falsifications, the non-monotonic elevation
   result, the refresher challenged twice, and anything that was built and torn out.
3. Final pass over `decisions.md` so every call made during implementation is in it.

The worklog is graded first and is the one artifact that must not read as generated.

---

## Total

15.5 h across seven slices, against a Thursday-to-Monday window. The slack is real but it lives
entirely in slices 2 and 6 — everything else is predictable.

## Two things block the start

- **Decision #32, version control.** Blocks slice 0, and only slice 0.
- **The sanity table.** Blocks step 4 of slice 1 and all of slice 2. Curves can be written without
  it; numbers cannot.
