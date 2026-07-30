# Activity weather ranking

A service that takes a city and ranks the next seven days for skiing, surfing, outdoor sightseeing
and indoor sightseeing, over [Open-Meteo](https://open-meteo.com/), with the weather persisted rather
than fetched on every request.

Node.js, TypeScript, GraphQL, MongoDB.

## Live

`http://2.28.24.132:4000/graphql` — open it for GraphiQL, which loads with the example queries below
already in the editor. Pick one from the operation dropdown and press play.

Run it yourself with `docker compose up`, which is the same file the deployed host runs. The host
itself is described in [`infra/cloud-init.yaml`](infra/cloud-init.yaml).

## Try it

Every capability has a query you can paste, including the ones that fail. That is a rule this project
holds itself to ([principle 12](docs/principles.md)): a backend has no UI, so a reviewer who has to
invent a query only ever sees the happy path.

**Rank the next seven days for each activity.** One of the two readings of the brief's "ranks";
days an activity cannot be scored on are left out rather than ranked as zero.

```bash
curl -s http://2.28.24.132:4000/graphql -H 'content-type: application/json' \
  -d '{"query":"{ activityForecast(query: \"Innsbruck\") { location { name country admin1 } modelVersion rankings { activity days { date score confidence } } } }"}'
```

**Rank the activities within each day**, which is the other reading. The three-state union shows up
here: a day carries `ScoredActivity`, `NotApplicableActivity` and `UnavailableActivity` side by side.

```bash
curl -s http://2.28.24.132:4000/graphql -H 'content-type: application/json' \
  -d '{"query":"{ activityForecast(query: \"Lisbon\") { days { date activities { ... on ScoredActivity { activity score confidence } ... on NotApplicableActivity { activity reason } ... on UnavailableActivity { activity reason } } } } }"}'
```

**Ask why a day scored what it did.** Every factor reports the forecast value behind it, what the
curve made of it, and how many points of the total it accounts for.

```bash
curl -s http://2.28.24.132:4000/graphql -H 'content-type: application/json' \
  -d '{"query":"{ activityForecast(query: \"Reykjavik\") { days { date activities { ... on ScoredActivity { activity score base factors { name rawValue curveValue contribution } gates { name rawValue multiplier } } } } } }"}'
```

**Ask about an ambiguous name.** "Cambridge" matches five places. The service scores one and shows
the rest, rather than quietly answering about the wrong country.

```bash
curl -s http://2.28.24.132:4000/graphql -H 'content-type: application/json' \
  -d '{"query":"{ activityForecast(query: \"Cambridge\") { location { name country admin1 } alternatives { name country admin1 } } }"}'
```

**Ask where a ski score was actually assessed.** The city is at 218 m and the score belongs to a
point 3354 m up, so the answer says so rather than letting the number stand as a claim about the
city centre.

```bash
curl -s http://2.28.24.132:4000/graphql -H 'content-type: application/json' \
  -d '{"query":"{ activityForecast(query: \"Grenoble\") { location { name elevation } assessment { marineCoverage terrain { elevation distanceKm gridVersion latitude longitude } } rankings { activity days { date score } } } }"}'
```

**Ask about a city with no mountain and no ocean.** Amsterdam samples 38 m and its coordinate has no
water, so both answers are `notApplicable` with a reason — measured, not read off a list.

```bash
curl -s http://2.28.24.132:4000/graphql -H 'content-type: application/json' \
  -d '{"query":"{ activityForecast(query: \"Amsterdam\") { assessment { terrain { elevation } marineCoverage } days { activities { ... on ScoredActivity { activity score } ... on NotApplicableActivity { activity reason } } } } }"}'
```

**Prove the weather is stored, not fetched.** Run this twice; `issuedAt` will not move, because the
second answer is read from the issuance the first one wrote. Run it three times at once for a city
nobody has asked about yet and you still get one timestamp — the lease admits one fetcher and the
others read what it wrote.

```bash
curl -s http://2.28.24.132:4000/graphql -H 'content-type: application/json' \
  -d '{"query":"{ activityForecast(query: \"Ljubljana\") { location { name } issuedAt stale staleReason } }"}'
```

**Ask for somewhere that does not exist.** The error names the query and carries
`LOCATION_NOT_FOUND`, rather than being an empty forecast or a made-up location.

```bash
curl -s http://2.28.24.132:4000/graphql -H 'content-type: application/json' \
  -d '{"query":"{ activityForecast(query: \"Nowhereinparticular\") { location { name } } }"}'
```

## Current state

**Milestone M5 of M8 done, 31 points of 41.** Progress is tracked in
[`docs/milestones.md`](docs/milestones.md).

What works today: a city name resolves to a place, and the next seven days come back ranked on both
axes for all four activities, with every score explained by the factors and gates that produced it,
a confidence that decays with the forecast horizon, and a pinned model version. All twenty rows of
[`docs/sanity-table.md`](docs/sanity-table.md) pass.

Geography is measured rather than looked up. Terrain comes from 81 elevation samples on a circular
50 km mask around the city, paid once per city and then kept, and ocean coverage comes from whether
the wave model returns data at that coordinate. There is no list of cities anywhere.

That is what makes skiing answerable. Grenoble reports its city elevation as 218 m and its ski scores
as belonging to a point at 3354 m, 44.7 km away — scoring the city coordinate would answer
confidently about a place nobody skis, for exactly the cities a traveller would ask about. Amsterdam
samples 38 m and answers `notApplicable/noTerrain`, which is deliberately not a score of zero.

Weather is stored rather than re-fetched. Each fetch is written as one **issuance** — city, summit
and wave series together, because they are one unit of consistency — and reads go through a gateway
with a one-hour freshness window, a single-flight lease so a hundred simultaneous misses cause one
upstream call, and stale-if-error so an outage degrades the answer instead of removing it. Issuances
are kept rather than upserted, so "what did we think on Tuesday that Friday would be" survives.

You can see that from outside: run `HowFreshIsThisAnswer` in GraphiQL twice inside an hour and
`issuedAt` does not move. On the deployed URL, two concurrent requests for a city the service had
never seen, plus a third immediately after, returned one identical `issuedAt` and left exactly one
document in `forecasts`.

Not here yet: the second ranking entry point for ambiguous names (M6) and the background refresher
(M7).

Two days of design came before any code, and that was deliberate rather than incidental. The brief
grades how the work happened above the service itself, so the thinking is written down and committed.

One thing to know before reading the history. Version control was deferred at the start, so
everything written across those two days lands in a single commit rather than a sequence. That cost
was real and it is recorded as decision #32 rather than glossed over. The history is incremental from
that commit on.

## Where to start

| Document | What it holds |
|---|---|
| [`docs/milestones.md`](docs/milestones.md) | The high-level map. Nine milestones, M0 to M8, each with an observable done-condition and a status |
| [`docs/decisions.md`](docs/decisions.md) | **Start here for the reasoning.** Every decision and assumption, one line each, linking to the full argument |
| [`docs/worklog.md`](docs/worklog.md) | The sequence as it happened, including two designed mechanisms that died on contact with the real API |
| [`docs/open-questions.md`](docs/open-questions.md) | The eight questions that would go to a product manager, and the assumption committed to instead |
| [`docs/cut.md`](docs/cut.md) | What was considered and not built, with the test each item had to pass |
| [`docs/design.md`](docs/design.md) | Data model, refresh gateway, scoring, determinism |
| [`docs/sanity-table.md`](docs/sanity-table.md) | Twenty scenarios the scoring model must reproduce, written before any curve exists |

`docs/probes/` holds raw captured Open-Meteo responses. They are the
evidence behind the design claims and they become the test fixtures, so no test ever calls the live
API.

## Attribution

Weather data by [Open-Meteo.com](https://open-meteo.com/), licensed
[CC BY 4.0](https://creativecommons.org/licenses/by/4.0/).
