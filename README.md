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

**Ask for somewhere that does not exist.** The error names the query and carries
`LOCATION_NOT_FOUND`, rather than being an empty forecast or a made-up location.

```bash
curl -s http://2.28.24.132:4000/graphql -H 'content-type: application/json' \
  -d '{"query":"{ activityForecast(query: \"Nowhereinparticular\") { location { name } } }"}'
```

## Current state

**Milestone M3 of M8 done, 22 points of 40.** Progress is tracked in
[`docs/milestones.md`](docs/milestones.md).

What works today: a city name resolves to a place, and the next seven days come back ranked on both
axes for all four activities, with every score explained by the factors and gates that produced it,
a confidence that decays with the forecast horizon, and a pinned model version. All twenty rows of
[`docs/sanity-table.md`](docs/sanity-table.md) pass.

Skiing and surfing answer `UnavailableActivity` rather than a number, because both need geography
this service has not fetched yet. That is deliberately not `NotApplicableActivity`: "we have not
looked" and "there is no mountain here" are different claims, and the API keeps them apart. Terrain
and ocean coverage arrive in M4.

Not here yet: persistence, which is the part of the brief this service most obviously owes and which
arrives in M5. Until then every request goes upstream.

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
