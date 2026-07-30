# Milestones

The high-level map. Nine milestones, each with a code, so a conversation can point at **M5** instead
of describing it. Step-by-step work lives in
[`plan.md`](./plan.md); this file sits above it and shows the shape.

Every milestone has a **Done when** line that is observable from outside. Not "the module is
written", but "the deployed URL answers this query with this". A milestone I can talk my way into
having finished isn't a milestone.

Status: **done** · **in progress** · **not started**

| Code | Milestone | Delivers | Points | Status |
|---|---|---|---|---|
| **M0** | Preparation | The reasoning, before any code | 13 | **done** |
| **M1** | Skeleton deployed | A URL that answers GraphQL | 1 | **done** |
| **M2** | Tracer bullet | One city, one activity, scored live | 3 | **done** |
| **M3** | Scoring model | All four activities, sanity table passing | 5 | not started |
| **M4** | Geography | Terrain and ocean decide applicability | 3 | not started |
| **M5** | Persistence and refresh | Weather stored, not re-fetched | 5 | not started |
| **M6** | API surface | Both ranking axes, ambiguity handled | 2 | not started |
| **M7** | Background refresher | Scheduled pull, visibly running | 3 | not started |
| **M8** | Submission | README, worklog, verify, review | 5 | not started |

**About the points.** Fibonacci, relative to each other rather than to a clock. 1 is trivial, 3 is a
normal unit of work, 5 carries real uncertainty, and 13 is the two days of design that preceded any
code. Forty points in total, seventeen of them delivered.

They're here to show where the weight sits, not to promise a date. The weight is not spread evenly:
M3 is the one milestone that can't be finished by working harder at it, because scoring calibration
has no ground truth and therefore no natural stopping point. Everything after M4 is predictable work,
which is exactly why the unpredictable milestones run first.

---

## M0 — Preparation

**Status: done. 13 points.** Two days, 29 and 30 July, no application code.

This is deliberate. The brief grades how the work happened above the service itself, so the thinking
happened first and in writing. Everything below is committed and readable.

**Delivered:**

| | Artifact |
|---|---|
| Reconnaissance against the live APIs | 11 raw Open-Meteo responses captured as fixtures, and two designed mechanisms deleted because the real behaviour didn't match the assumption |
| Eight product questions | Each recorded with the alternatives rejected and the assumption committed to in place of a product owner's answer |
| Design | Three collections with three lifecycles, a six-branch read path, single-flight refresh, and a table mapping seven sources of non-determinism to the mechanism that removes each |
| Plan | Eight vertical slices ordered so the unpredictable work runs first |
| Sanity table | Twenty scenarios with their expected rating bands, written before any curve exists, each justified against a published source |
| Repository | Public, with the first commit stating plainly that it's a batch and why |

**Done when:** every decision has a recorded reason, and someone who has never seen the project can
read [`decisions.md`](./decisions.md) and know what was chosen and where the argument for it lives.

**Two things worth knowing about this milestone.** The first is that two designed mechanisms died
during it: I'd assumed the Marine API silently snaps inland coordinates to a distant sea cell, and it
doesn't, it returns nulls. Both deaths are recorded in [`worklog.md`](./worklog.md), because a
mechanism deleted before it was written is cheaper than one deleted afterwards, and the only way to
show that is to show it happening.

The second is that three of four scoring conventions I cited turned out to be wrong when I actually
opened a source. Those corrections are recorded next to the numbers rather than quietly applied.

---

## M1 — Skeleton deployed

**Delivers:** a running service at a public URL, doing almost nothing.

Node 24, TypeScript strict, Vitest, zod. GraphQL Yoga with Pothos, serving a single `health` field.
Dockerfile and `docker-compose.yml` covering the service and MongoDB, so the reviewer runs the same
file I do.

**Done when:** the deployed URL returns a GraphQL response to `{ health }`. Not when it builds
locally.

**Why here:** a deployment discovered on the last day is a deployment that fails on the last day.
This milestone exists to move that discovery to the first day, when there's still schedule to absorb
it.

**Status: done. 1 point.** Live at `http://2.28.24.132:4000/graphql`, answering `{ health }`.

The host is described in [`infra/cloud-init.yaml`](../infra/cloud-init.yaml) and deploys by pulling
`origin/main`, so there is no console configuration holding state that the repository doesn't show.

Two choices made here rather than deferred. There is no build step: Node 24 strips types at load, so
no compiled output can drift from the source, and `tsc --noEmit` does the typechecking. And there is
no Express and no NestJS, because the service has one endpoint and a domain layer of pure functions
with nothing to inject. Both are recorded as decisions #35 and #22.

Plan: [slice 0](./plan.md).

---

## M2 — Tracer bullet

**Status: done, 30 July. 3 points.**

**Delivers:** one city, one activity, a real score, no persistence at all.

Geocoding resolves the city, the forecast API is called live, the outdoor sightseeing profile scores
it, and the result comes back with its per-factor contributions attached. The curve primitives are
unit-tested at their boundaries before they exist.

**Done when:** the deployed URL answers `activityForecast(query: "Innsbruck")` with a real number and
a breakdown of what produced it.

**Why here:** it's the thinnest possible cut through every layer. After this, no layer is
hypothetical, and everything that follows is widening a path that already runs end to end.

**What it turned up.** Two things, both recorded rather than absorbed:

- UV started as a weighted factor and was removed. A weighted mean can say "this is pleasant" and
  cannot say "this is harmful", because a harm factor scores full marks whenever the harm is absent.
  The weight that pulled a 31 °C day down to FAIR simultaneously lifted a cold, wet, windy day out of
  POOR. Heat is carried by apparent temperature now ([decision #36](./decisions.md)). Skiing row 4 is
  a veto and will need a mechanism this profile doesn't have, so M3 inherits the problem knowingly.
- A mistyped city name reached the deployed service as a blank `INTERNAL_SERVER_ERROR` while its
  schema test passed, because Yoga masks anything that isn't a `GraphQLError` and `graphql()` alone
  doesn't. Found by testing over HTTP, which is now where the API-level tests run.

**3 points.** Plan: [slice 1](./plan.md).

---

## M3 — Scoring model

**Delivers:** all four activities, with every threshold traceable to a source.

Skiing, surfing, outdoor sightseeing and indoor sightseeing, as declarative profiles of weighted
factors over named curves. No branching code. Indoor sightseeing is modelled independently rather
than as the inverse of outdoor, because it isn't one: a museum is a good answer in cold rain and a
bad one in a storm that stops you reaching it.

**Done when:** all twenty rows of
[`sanity-table.md`](./sanity-table.md) land in their expected bands,
and every constant in every profile cites the source it came from.

**Why here, and why it carries the risk:** scoring calibration has no ground truth. Nothing tells me
a given day was a 78 for skiing, so nothing tells me when to stop tuning. The sanity table is what
supplies the stopping condition, which is why it was written before any curve existed rather than
fitted afterwards to whatever the curves happened to produce.

If the table turns out to be unsatisfiable, that's the interesting result rather than a failure: two
rows would then encode incompatible beliefs about how factors trade off, and the row that gives way
gets recorded with the reason.

**5 points.** Plan: [slice 2](./plan.md).

---

## M4 — Geography

**Delivers:** applicability decided by measurement, for any city, with no list of cities anywhere.

Terrain is sampled around each city (81 coordinates over a circular 50 km mask, paid once per
location, ever) so that Grenoble at 214 m is correctly skiable and Amsterdam at 11 m is not. Ocean
coverage comes from the marine model returning data or nulls at that coordinate.

**Done when:** Grenoble returns a ski score attached to the high point it was assessed at, with
elevation and distance stated. Amsterdam returns `notApplicable` for skiing and Vienna returns
`notApplicable` for surfing, both from measurement rather than a rule naming them.

**Why here:** this is the modelling trap in the brief. Geography is not weather, and the two
activities that need it need different geography. Scoring a city coordinate for skiing gives
confidently wrong answers for exactly the cities a traveller would ask about.

**3 points.** Plan: [slice 3](./plan.md).

---

## M5 — Persistence and refresh

**Delivers:** the part the brief calls out by name. Weather is stored and read from storage, never
re-fetched per request.

One document per forecast **issuance** with the seven-day array embedded, rather than an upsert per
city and date. That preserves how a forecast changed as the date approached, which an upsert
destroys. Reads go through a gateway with a one-hour freshness window, a single-flight lease so a
hundred concurrent misses cause one upstream call, and stale-if-error so an upstream outage degrades
the answer instead of removing it.

**Done when:** two rapid identical requests produce exactly one upstream call, and the service still
answers correctly with Open-Meteo unreachable, flagging the data as stale.

**Why here:** it needs something worth persisting, so it follows the scoring work. It's also the
milestone where the design is least negotiable, because "how you model, store, and refresh it" is
quoted from the brief.

**5 points.** Plan: [slice 4](./plan.md).

---

## M6 — API surface

**Delivers:** the complete GraphQL schema, and the ambiguity in the brief handled rather than guessed
at.

"Ranks how good the next 7 days will be for each of these activities" reads two ways: days ranked
within an activity, or activities ranked within a day. Both come from the same computed data, so both
are served. Ambiguous city names get two entry points: one that resolves the best match and always
tells you which it picked, and one that returns candidates for a caller who wants to choose.

**Done when:** a reviewer opens GraphiQL on the deployed URL and runs every example query without
typing anything, and the examples cover the interesting states rather than only the happy path:
`notApplicable` against a score of zero, a stale response after an upstream failure, and the
per-factor breakdown behind a number.

Constitution 12 is what widened this: a capability reachable only from a test does not count as
delivered, because a reviewer who has to invent a query will exercise the happy path and miss the
parts that took longest to get right.

**2 points.** Plan: [slice 5](./plan.md).

---

## M7 — Background refresher

**Delivers:** a scheduled process that keeps recently-requested cities warm, so a returning user hits
fresh data rather than paying for the fetch.

**Done when:** the refresher's log shows it waking, selecting locations requested in the last 24
hours, and refreshing them through the same gateway and the same lease the read path uses.

**Why last:** this is the one piece of scope that adds a process rather than depth on something the
brief already names, and it was challenged twice on exactly that basis. It survives because a
scheduled pull from an upstream system of record is the shape of the synchronisation problem this
service is really about. It's sequenced last because it's additive: same gateway, same lease, no
schema change and no API change. If the schedule bites, it gives way by plan rather than in a panic.

The full argument, including the case for cutting it, is in [`cut.md`](./cut.md).

**3 points.** Plan: [slice 6](./plan.md).

---

## M8 — Submission

**Delivers:** the repository as something to read, not just something to run.

A README with setup, the example queries, the assumptions, and what I'd do next. The worklog finished
with what actually happened during implementation: what the sanity table disagreed with once curves
were fitted to it, anything built and torn out, where an estimate was wrong and by how much, and the
first thing that broke in deployment. Two ADRs that are currently marked pending: MongoDB against
Postgres, and the input-type shape I rejected.

**Done when:** someone clones the repository, runs `docker compose up`, and gets a working service
without asking me a question.

**5 points**, including the verify and review stages of the pipeline. Plan:
[slice 7](./plan.md).

---

## How this file is maintained

Status changes here when a milestone's **Done when** condition is actually met, and the commit that
meets it lands first. A milestone marked done with nothing pushed behind it would make this document
worse than not having one.
