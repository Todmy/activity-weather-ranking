# Activity weather ranking

A service that takes a city and ranks the next seven days for skiing, surfing, outdoor sightseeing
and indoor sightseeing, over [Open-Meteo](https://open-meteo.com/), with the weather persisted rather
than fetched on every request.

Node.js, TypeScript, GraphQL, MongoDB.

[![CI](https://github.com/Todmy/activity-weather-ranking/actions/workflows/ci.yml/badge.svg)](https://github.com/Todmy/activity-weather-ranking/actions/workflows/ci.yml)

## Live

`http://2.28.24.132:4000/graphql` — open it for GraphiQL, which loads with the example queries below
already in the editor. Pick one from the operation dropdown and press play.

To run it yourself, see [Run it yourself](#run-it-yourself) below — the same compose file the
deployed host uses. The host itself is described in [`infra/cloud-init.yaml`](infra/cloud-init.yaml).

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

**Let the caller pick, instead of picking for them.** Five Cambridges, in upstream order, with the
population it ranked them by. Any `geonameId` here works with `activityForecastAt`.

```bash
curl -s http://2.28.24.132:4000/graphql -H 'content-type: application/json' \
  -d '{"query":"{ searchLocations(query: \"Cambridge\") { geonameId name admin1 countryCode population } }"}'
```

**Watch a forecast change as the date approaches.** One date, as every stored issuance saw it, with
the horizon each was seen at. This is the only field that could not exist under an upsert-per-date
model.

```bash
curl -s http://2.28.24.132:4000/graphql -H 'content-type: application/json' \
  -d '{"query":"{ forecastHistory(locationId: \"geoname:4931972\", date: \"2026-08-02\") { issuedAt horizonDays day { date activities { ... on ScoredActivity { activity score confidence } } } } }"}'
```

**Ask for somewhere that does not exist.** The error names the query and carries
`LOCATION_NOT_FOUND`, rather than being an empty forecast or a made-up location.

```bash
curl -s http://2.28.24.132:4000/graphql -H 'content-type: application/json' \
  -d '{"query":"{ activityForecast(query: \"Nowhereinparticular\") { location { name } } }"}'
```

## Run it yourself

```bash
git clone https://github.com/Todmy/activity-weather-ranking && cd activity-weather-ranking
docker compose up
```

Then open `http://localhost:4000/graphql`. That is the whole of it: no API key, no signup, no
account. Open-Meteo's free tier needs none, which is part of why it was chosen.

`docker-compose.yml` is the same file the deployed host runs, so this is not a development-only
path. It builds the image, waits for MongoDB to report healthy, and only then starts the API — which
opens the database before it binds the socket, so a service that accepts requests is a service that
can answer them.

**The first request for a city takes a few seconds.** It geocodes, samples 81 elevation coordinates
around the city and asks the wave model whether there is water there. All of that is written to
`locations` and never paid again. The second request for the same city is a database read, and every
request for the next hour is served from the stored issuance — which you can see, because `issuedAt`
does not move.

### Without Docker

Node 24 or newer and pnpm. Node 24 strips TypeScript types at load, so there is no build step.

```bash
pnpm install
docker compose up mongo -d      # or point MONGODB_URI at any MongoDB 8
pnpm dev                        # watch mode on http://localhost:4000/graphql
```

Configuration is three variables and every one has a working default, so the service starts with no
`.env` at all — see [`.env.example`](.env.example). Override `PORT`, `MONGODB_URI` or `MONGODB_DB`
only if you need to.

### Tests

```bash
pnpm check                      # tsc --noEmit, then 295 tests
```

Neither Docker nor a network is needed. The persistence tests start a real `mongod` through
`mongodb-memory-server` — the same major version as the `mongo:8` in compose, so the driver, the
indexes and the concurrency behaviour under test are production's. No test ever calls Open-Meteo;
they run against the captured responses in [`docs/probes/`](docs/probes/), which is what keeps them
deterministic and keeps the free-tier quota for the deployed service.

## Current state

**Milestone M6 of M8 done, 33 points of 41.** Progress is tracked in
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

An ambiguous name has two answers rather than a guess. `activityForecast(query: "Cambridge")` picks
one and names the other four; `searchLocations(query: "Cambridge")` picks none and returns all five
with the population upstream ranked them by, and any of those ids goes straight into
`activityForecastAt(locationId:)` — which forecasts exactly that place and does not re-resolve it.

`forecastHistory(locationId:, date:)` is the field that makes the storage decision visible. It shows
one date as every surviving issuance saw it, each with the horizon it was seen at, so a forecast for
Friday can be compared against what we thought on Tuesday. Nothing else in the API needs issuances to
be kept; this does.

Not here yet: the background refresher (M7).

Two days of design came before any code, and that was deliberate rather than incidental. The brief
grades how the work happened above the service itself, so the thinking is written down and committed.

One thing to know before reading the history. Version control was deferred at the start, so
everything written across those two days lands in a single commit rather than a sequence. That cost
was real and it is recorded as decision #32 rather than glossed over. The history is incremental from
that commit on.

## Where to start

| Document | What it holds |
|---|---|
| [`docs/requirements.md`](docs/requirements.md) | What was promised, where each promise is met, and the six things deliberately not built — with the source of every row |
| [`docs/milestones.md`](docs/milestones.md) | The high-level map. Nine milestones, M0 to M8, each with an observable done-condition and a status |
| [`docs/decisions.md`](docs/decisions.md) | **Start here for the reasoning.** Every decision and assumption, one line each, linking to the full argument |
| [`docs/worklog.md`](docs/worklog.md) | The sequence as it happened, including two designed mechanisms that died on contact with the real API |
| [`docs/open-questions.md`](docs/open-questions.md) | The eight questions that would go to a product manager, and the assumption committed to instead |
| [`docs/cut.md`](docs/cut.md) | What was considered and not built, with the test each item had to pass |
| [`docs/design.md`](docs/design.md) | Data model, refresh gateway, scoring, determinism |
| [`docs/sanity-table.md`](docs/sanity-table.md) | Twenty scenarios the scoring model must reproduce, written before any curve exists |
| [`docs/schema.graphql`](docs/schema.graphql) | The whole API in one file, generated from the code and tested against it — so a removed field is a removed line |
| [`docs/adr/`](docs/adr/) | Three choices big enough to need the argument in full — MongoDB, code-first GraphQL, two fields over `@oneOf` — each recording what it cost as well as what it bought |

`docs/probes/` holds raw captured Open-Meteo responses. They are the
evidence behind the design claims and they become the test fixtures, so no test ever calls the live
API.

## Attribution

Weather data by [Open-Meteo.com](https://open-meteo.com/), licensed
[CC BY 4.0](https://creativecommons.org/licenses/by/4.0/).
