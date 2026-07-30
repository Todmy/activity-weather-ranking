# Activity weather ranking

A service that takes a city and ranks the next seven days for skiing, surfing, outdoor sightseeing
and indoor sightseeing, over [Open-Meteo](https://open-meteo.com/), with the weather persisted rather
than fetched on every request.

Node.js, TypeScript, GraphQL, MongoDB.

## Live

`http://2.28.24.132:4000/graphql` — open it for GraphiQL, or:

```bash
curl -s http://2.28.24.132:4000/graphql -H 'content-type: application/json' \
  -d '{"query":"{ health }"}'
```

Run it yourself with `docker compose up`, which is the same file the deployed host runs. The host
itself is described in [`infra/cloud-init.yaml`](infra/cloud-init.yaml).

## Current state

**Milestone M1 of M8 done, 14 points of 40.** Progress is tracked in
[`docs/milestones.md`](docs/milestones.md). The service answers one field so far; scoring arrives in
M2 and M3.

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
