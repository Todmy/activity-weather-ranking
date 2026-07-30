# Design: activity-weather-ranking

2026-07-30. Checked against [`principles.md`](./principles.md), v1.0.0 at the time of writing.

Inputs: [`recon.md`](./recon.md) (recon), [`design-questions.md`](./design-questions.md)
(engineering decisions), [`../../open-questions.md`](./open-questions.md) (product assumptions),
[`./decisions.md`](./decisions.md) (index of both).

This document records the shape and the reasons for it. Where a number is not yet defensible it says
so rather than inventing one — the scoring constants are marked TBD and are fitted against a
hand-written sanity table, not chosen here.

---

## 1. The shape, and why the boundaries fall where they do

```
providers/openmeteo/   geocoding · forecast · marine · elevation. zod at the edge, typed inside
domain/                curves · profiles · scoring · confidence · applicability. ZERO I/O
persistence/           location, resolution, forecast and lease repositories
application/           location resolution · ForecastGateway · ranking assembly
api/                   GraphQL schema and resolvers (Yoga + Pothos)
worker/                background refresh of recently-requested locations
```

One boundary is load-bearing and the rest follow from it: **`domain/` may not import anything that
performs I/O.** That is what makes the scoring model testable without a database, a network, or a
clock, and it is what makes principle 9's determinism claim checkable rather than aspirational. Every
other module boundary here is ordinary layering; this one is the design.

The second boundary worth naming is `providers/`. Open-Meteo's responses are validated by zod at the
edge and never travel further as raw JSON. An upstream field renamed in six months should break one
schema file loudly, not surface as `undefined` inside a scoring curve.

### Coverage: any city, and no list of them anywhere

Worth stating plainly, because the same handful of cities recurs throughout these documents and a
reader could reasonably wonder whether they are the supported set. They are not. There is no city
list in this codebase, and adding one would be a design failure rather than an omission.

Grenoble, Oslo, Chicago, Lisbon, Biarritz, Vienna and the rest appear because each was chosen to break
a specific assumption, and several did. They are test fixtures and evidence, never data the service
reads.

Applicability is decided per location, from measurements taken for that location:

| Layer | Coverage | Cost per city |
|---|---|---|
| Geocoding | GeoNames, any populated place | 1 request, at resolution |
| Forecast | global | 1 request per issuance |
| Marine | wherever the wave model has water; nulls elsewhere | 1 request per issuance, skipped when `notApplicable` |
| Elevation | global | 81 coordinates, **once ever** |

So Amsterdam is `notApplicable` for skiing because its sampled grid maxes at 51 m, and Vienna is
`notApplicable` for surfing because the marine model returns nulls at its coordinate. Neither answer
comes from a rule naming those cities. Both come from a measurement, which means a city nobody
anticipated gets the same treatment as one that was tested.

Those two numbers are measured for the config that actually ships, `circ-50km-11x11`, not carried
over from the coarser grids recon used to choose it
(`probes/elevation-amsterdam-circ50-81.json`, `probes/elevation-grenoble-circ50-81.json`). Amsterdam
read 11 m on recon's 3×3 sample and 51 m here; the verdict is unchanged because the cost gate is at
300 m, but the number a reader can check had to be the one from the shipped grid.

The one real limit is quota, and it applies only to cities the service has never seen. Elevation is
metered per coordinate, so 10,000/day ÷ 81 caps cold-start terrain sampling at roughly **123 new
cities per day**. Locations are immutable and cached permanently, so a city pays that cost once in the
lifetime of the service and never again. Steady-state throughput is bounded by the forecast API
instead, which is cheaper. This is why `locations` and `forecasts` are separate collections with
separate lifecycles: the split is what turns an expensive operation into a one-off.

## 2. Data model

Three collections, chosen because they have three genuinely different lifecycles. Merging any two
would mean one retention policy serving two rates of change.

### `locations` — effectively immutable

```js
{
  _id: "geoname:2653941",          // pinned; upstream relevance ranking can reorder, this cannot
  geonameId: 2653941,
  name: "Cambridge", admin1: "England", countryCode: "GB", population: 145674,
  coords: { lat: 52.2, lon: 0.1194 },
  elevation: 12,
  timezone: "Europe/London",       // IANA, from timezone=auto

  terrain: {                       // computed once from the 81-point elevation grid
    gridVersion: "circ-50km-11x11",
    maxElevation: 108,
    point: { lat: 52.42, lon: 0.35 },
    distanceKm: 31.2,
    sampledAt: ISODate
  },

  marineCoverage: "present" | "none",   // learned on first marine fetch, then never re-asked
  lastRequestedAt: ISODate              // drives the background refresher
}
```

`terrain` and `marineCoverage` are geography, not weather. They are derived once and cached forever
because the coastline does not move on the timescale of this service. This is why the 81-coordinate
elevation grid is affordable despite the per-coordinate quota: it is paid once per city, ever.

`gridVersion` exists so that changing the sampling parameters is a visible, versioned event rather
than a silent drift in answers. Recon measured the sampled maximum moving ~600 m on those parameters;
an unversioned change would alter historical answers with no trace.

Index: `{ lastRequestedAt: -1 }`.

### `resolutions` — the query-string binding

```js
{ _id: "cambridge", locationId: "geoname:2653941", resolvedAt: ISODate }
```

A separate collection rather than an array on the location, because the binding runs
query → location and the same location can answer to several queries. Once "cambridge" has resolved
once, it is pinned: a change in Open-Meteo's relevance ranking cannot silently change what this
service answers. That is risk 10 in `recon.md`, and this is the whole of its mitigation.

*Known limitation, stated rather than fixed:* the binding is first-writer-wins and global, not
per-caller. A user who wants Cambridge, Massachusetts must go through `searchLocations` +
`activityForecastAt`, which is exactly what that pair exists for.

### `forecasts` — one document per issuance

```js
{
  _id: ObjectId,
  locationId: "geoname:2653941",
  issuedAt: ISODate,               // when WE fetched it — the bitemporal second axis
  modelRun: ISODate | null,        // upstream generation time, when it reports one

  city:   { status: "ok", elevation: 12, days: [ Day x7 ] },
  summit: { status: "ok" | "notApplicable" | "unavailable", reason?, elevation?, days? },
  marine: { status: "ok" | "notApplicable" | "unavailable", reason?, days? },

  expiresAt: ISODate               // TTL backstop, see retention below
}

Day = { date: "2026-07-30",        // LOCAL date at the location, never a UTC instant
        tMax, tMin, precipitationSum, snowfallSum, windSpeedMax, windGustsMax,
        cloudCoverMean, sunshineSeconds, uvIndexMax, weatherCode, ... }
```

**Why one document per issuance rather than an upsert per (location, date).** An upsert answers
"what is the forecast for Friday" and destroys "what did we think on Tuesday that Friday would be".
The brief names modelling as part of the problem, and the interesting modelling question here is
precisely that forecasts are *revisions*, not facts. Keeping issuances makes `forecastHistory`
possible and makes every answer reproducible against the exact bytes it was computed from.

**Why all three series live in one document.** An issuance is the unit of consistency. Split across
documents with independent TTLs, the city series could be five minutes old and the summit
fifty-five, and a ranking would compare indoor sightseeing from one issuance against skiing from
another without anything flagging it. Full argument in `design-questions.md` Q1+2.

Index: `{ locationId: 1, issuedAt: -1 }`. TTL index on `expiresAt`.

### Retention — and why TTL alone is wrong

Risk 7 in `recon.md`: a TTL index cannot express "keep at least one". If it expires the last
surviving issuance during an upstream outage, stale-if-error has nothing to serve and the service
fails at exactly the moment the mechanism existed for.

So retention is an application concern and TTL is only a backstop:

- On every successful write, delete issuances for that location beyond the newest **24**.
- `expiresAt` is set **30 days** out. It only ever fires for locations that stopped being requested
  entirely — in which case losing them is correct, and the next request is an honest cold start.

## 3. The refresh gateway

Four mechanisms. They are not four features; three of them are facets of one cache-aside read, and
the fourth is a scheduled writer that shares the same lease.

### Read path — `ForecastGateway.ensureFresh(locationId)`

1. Read the newest issuance for the location.
2. Fresh (`issuedAt` within the 1 h TTL) → return it.
3. Stale or absent → try to acquire the refresh lease.
4. **Lease won** → fetch upstream, write a new issuance, prune, release, return it. On upstream
   failure: return the stale issuance flagged `stale: true` with the error named (stale-if-error).
5. **Lease lost, stale data present** → return the stale issuance immediately. Do not wait. Someone
   else is already fetching and a slightly old answer beats a slow one.
6. **Lease lost, no data at all** (cold start) → bounded wait: poll every 100 ms for up to 10 s for
   the winner's write. Still nothing → a typed `NoDataYet` result, not a 500.

Step 6 is the one place the service does not answer, and it is a deliberate exception to product
assumption 6. That assumption says never refuse on grounds of *quality*; this is not a quality
judgement, it is having literally nothing. Refusing with a named state beats inventing one.

### The lease

```js
{ _id: "refresh:geoname:2653941", holder: "<instanceId>", acquiredAt, expiresAt }
```

Acquired with a single `findOneAndUpdate({ _id, expiresAt: { $lt: now } }, …, { upsert: true })`.
A duplicate-key error means someone else holds it — that is the "lost" branch, not an error to log
loudly.

Two numbers, and the relationship between them is the point:

- Hard timeout per upstream call: **8 s**. The three calls run in parallel, so the worst realistic
  fetch is ~8 s plus write time.
- Lease TTL: **30 s**, comfortably longer.

Risk 8 in `recon.md` is a lease shorter than the fetch it guards, which silently admits a second
fetcher. The margin here is deliberate rather than round.

**Trap worth naming:** Mongo's TTL monitor runs roughly every 60 s, so an expired lease document can
survive for up to a minute. The acquire filter therefore tests `expiresAt < now` explicitly and never
relies on TTL deletion for correctness. TTL is housekeeping, not a lock.

### The background refresher

A scheduled tick over locations with `lastRequestedAt` within 24 h whose newest issuance is older
than the TTL. It calls the same `ensureFresh` and takes the same lease, so it cannot race the read
path — the single-flight mechanism already covers both.

It is built last, after scoring calibration, because it is additive: same gateway, same lease, no
schema change and no API change. If the schedule bites, it gives way by plan. Its scope justification
is in [`cut.md`](./cut.md) under "Scope audit".

Testability follows from principle 9: the tick is a function taking an injected clock and is called
directly by tests. No test waits on a timer.

## 4. Scoring

### Curves — the whole vocabulary

```ts
band(a, b, c, d)   // 0 below a, rises to 1 at b, holds to c, falls to 0 at d
rampUp(a, b)       // 0 below a, rises to 1 at b, 1 above
rampDown(a, b)     // 1 below a, falls to 0 at b, 0 above
```

Three primitives, each returning `[0, 1]`, each pure and clamped. Every threshold in the system is an
argument to one of these. That is what "scoring is data, not code" means concretely: there is no
`if (temp > 25)` anywhere in the domain.

### Profiles

```ts
{
  activity: "skiing",
  requires: "terrain",              // or "marine", or null
  series: "summit",                 // or "city"
  floor: 0,                         // indoor sightseeing is the only non-zero
  gates: [                          // multiplicative; see "Gates" below
    { name: "liftsHeld", input: "windGustsMax", curve: rampDown(56, 72), source: "…" },
  ],
  factors: [
    { name: "freshSnow",  weight: TBD, input: "snowfallSum",    curve: rampUp(TBD, TBD), source: "…" },
    { name: "temperature",weight: TBD, input: "tMax",           curve: band(TBD…),       source: "…" },
    { name: "wind",       weight: TBD, input: "windGustsMax",   curve: rampDown(TBD,TBD),source: "…" },
    …
  ]
}
```

Every factor returns `{ name, weight, rawValue, curveValue, contribution }`. A caller asking why
Innsbruck scores 34 in July gets the answer from the response, not from reading the source.

### Gates, because a weighted mean cannot veto

**Added 30 July, during slice 2.** A weighted mean says how good a day is on balance. It cannot say
"none of that matters", and two sanity rows need exactly that. Skiing row 4 is 40 cm of fresh powder
under 70 km/h gusts and the table says POOR: the lifts are held, so the snow is unreachable. Indoor
row 4 is a 90 km/h storm and the table says POOR for the opposite reason: the museum is open and you
cannot get to it.

Additive weights cannot express either. To drag row 4's ideal snow down to 39, wind needs 61% of the
total weight, and at that weight skiing row 2 — calm, cold, no fresh snow — comes out GOOD when the
table says FAIR. The two rows contradict each other under any single set of weights.

So a profile carries **gates** alongside its factors, and they multiply:

```ts
score = round(100 × (floor + (1 − floor) × weightedMean) × Π gate(input))
```

A gate is the same curve vocabulary pointed at a different job: 1.0 means "nothing in the way", and
below that it scales the whole score down. Each gate cites its own source, and each reports its
multiplier in the response, so a score of 9 on a powder day reads as `liftsHeld: 0.125` rather than
as an unexplained collapse.

Two alternatives were rejected. `min(mean, ...gates)` also passes the rows and throws away magnitude:
40 cm of snow and 5 cm of snow score identically once the wind vetoes, so the model stops being able
to rank days it has already given up on. A hard cutoff to 0 fails principle 4 — this project already
uses `score: 0` to mean "applicable and bad", and a veto that returns 0 makes "the lifts are shut"
indistinguishable from "today is simply poor".

### The floor, for indoor sightseeing only

Indoor sightseeing is not scored from zero: a museum is open whatever the sky is doing, and the
sanity table puts a perfect beach day at FAIR rather than POOR. `floor` lifts the profile's range so
a weighted mean of 0 lands at 55 rather than at 0, and the gate still multiplies afterwards — a storm
takes it to 0, because you cannot reach the building. Every other profile leaves `floor` at 0 and the
formula collapses to the original weighted mean.

### Derived inputs

Some factors need a window rather than a day. "Fresh snow" is the obvious one: the sanity table talks
about 25 cm over three days, and a single day's `snowfall_sum` cannot answer it. Derived inputs are
computed once over the whole issuance, in the domain, before any scoring: `snowfall3d` is the sum of
today and the two days before it.

That is why the forecast request carries `past_days=3`. It costs no extra call, and without it the
first forecast day would have no history at all and would read as though the mountain had never seen
snow.

**Every TBD above is deliberate.** Risk 6: an AI asked for thresholds produces authoritative-sounding
numbers nobody can challenge. The order is inverted — a human writes the sanity table first, curves
are fitted to pass it, and each threshold cites a named source in the profile file. Once the table is
green the model is done. See `design-questions.md` Q5.

### Indoor sightseeing is not the inverse of outdoor

Modelled independently, because it is not monotonic in "bad weather". A high baseline, raised by
weather that is unpleasant but harmless (rain, cold), lowered by weather that is genuinely
disruptive (storm-force gusts, ice) — you still have to get to the museum.

### Applicability

```ts
type ActivityResult =
  | { kind: "scored";        score: number; confidence: number; factors: FactorContribution[] }
  | { kind: "notApplicable"; reason: "noTerrain" | "noMarineCoverage" }
  | { kind: "unavailable";   reason: string }
```

Three states, because three different things are true (`design-questions.md` Q1+2). A discriminated
union rather than a nullable score, so the two absences cannot be collapsed by accident.

### Confidence

`confidence = horizonDecay(dayIndex) × completeness`, where `completeness` is the fraction of the
profile's weight whose inputs are actually present. The decay constant is **TBD, pending a cited
source** — the same discipline as the curve thresholds, for the same reason.

## 5. API

```graphql
type Query {
  searchLocations(query: String!, limit: Int = 5): [Location!]!
  activityForecast(query: String!): ForecastResult!
  activityForecastAt(locationId: ID!): ForecastResult!
  forecastHistory(locationId: ID!, date: String!): [HistoricalIssuance!]!
}
```

Two fields rather than one field with two optional arguments, because the latter admits "both set"
and "neither set" — illegal states that principle 4 exists to forbid. GraphQL's `@oneOf` input would
express it more elegantly and was rejected: a reviewer reads a schema in thirty seconds, and
unambiguity beats cleverness at that timescale. ADR to follow.

`ForecastResult` carries the resolved location (so a substitution is never silent), the ski
assessment point with its elevation and distance (so "Grenoble 78" cannot be misread as a claim
about Grenoble), `issuedAt`, `stale`, `modelVersion`, and the per-day and per-activity rankings from
the same computed data.

## 6. Determinism

Principle 9 promises identical output from an identical stored issuance plus an identical model
version. Seven ways that could be false, and where each is closed:

| Source of non-determinism | Closed by |
|---|---|
| An LLM anywhere in the request path | There is none. Scoring is arithmetic over persisted numbers |
| The scoring model changing under a caller | `modelVersion`, global semver, enforced by a snapshot test over the serialised domain config |
| `new Date()` inside the domain | Clock is injected at the application boundary; `domain/` cannot reach one |
| Tied scores ordering arbitrarily | Explicit total order: score, then activity name |
| Floating-point drift across rounding points | Rounded at exactly one place, at the end |
| Upstream relevance ranking reordering | `resolutions` pins query → `geonameId` on first resolve |
| Partial upstream failure looking like bad weather | `unavailable` is its own state and appears in the response |

Persistence is not incidental to this — it is the mechanism. Without it every request hits a live API
and two identical queries a minute apart can legitimately differ.

## 7. Check against the principles (v1.0.0)

| # | Principle | Where honoured |
|---|---|---|
| 1 | Facts before interpretation | `forecasts` stores observations only; `domain/` computes scores per request. No score is persisted |
| 2 | Scoring is data | Three curve primitives; every threshold is an argument; contributions returned per factor |
| 3 | No silent upstream calls | Only `ForecastGateway` and the location resolver touch `providers/`; resolvers cannot |
| 4 | Absence is not zero | `ActivityResult` discriminated union, now with three members rather than two |
| 5 | Never more confident than the data | `stale`, `unavailable`, `confidence`, and the ski assessment point's elevation and distance |
| 6 | Test-first where the thinking is | `domain/` is pure and has no I/O to mock, so TDD there costs nothing and is mandatory |
| 7 | Scope earns its place | Scope audit in `cut.md`; five cut items recorded with what each would take |
| 8 | Docs carry what code cannot | This document records rejected alternatives and measured limits, not the module list |
| 9 | Deterministic by construction | Section 6 |
| 10 | History is the narrative | **Not honoured when this was written** — no repository existed. Closed 2026-07-30, and the deferral's cost is recorded as decision #32 |

Nine of ten at the time, with the tenth a live gap whose cost was written down rather than an
oversight.

**Two principles arrived after this document, and neither changed the design.** Principle 11, one
change per commit sliced vertically, governs how the design is built rather than what it is; the plan
was already organised as vertical slices, so the two agree. Principle 12, exercisable by a human, did
change one thing: it widened what the API has to demonstrate, so the example queries must reach
`notApplicable`, staleness and the per-factor breakdown rather than only the happy path. That lands in
the API surface (§5) and in M6's done-condition, not in the data model.

**Principle 6 was rewritten after this document too, and the row above is now the weaker half of the
rule.** Test-first stopped being a domain-only obligation on 30 July: it binds every layer, and the
failing run is part of it rather than good practice around it. The design is unaffected — the layer
boundaries are what make each layer testable in the first place — but two things it implies are now
mandatory rather than sensible. Providers are tested against the captured probes, and the API is
tested through HTTP rather than through `graphql()`, because Yoga's error masking only exists at that
level and a schema test cannot see past it. Slice 1 found that out the expensive way; the amendment
log and `worklog.md` carry the argument.

Recording this rather than silently re-checking the whole document against v3.0.0: a design checked
against principles that did not exist when it was written would be a claim nobody could verify.

## 8. What could still go wrong

- **The sanity table disagrees with itself.** Human intuition is not guaranteed to be internally
  consistent across 12 scenarios, and no curve can satisfy contradictory targets. If it happens, the
  contradiction is the interesting finding and goes in the worklog.
- **Summit weather is right and useless.** Real snow at 2750 m says nothing about whether anything
  there is skiable. Known, named in `cut.md`, and the reason the response reports the point.
- **The refresher outlives its budget.** Mitigated by sequencing it last, not by estimating better.
- **The 1 h TTL never actually fires during review.** A reviewer running this for ten minutes sees
  no refresh at all. Worth a documented way to force one, or the most interesting mechanism in the
  submission is invisible.
