# Capacity

Measured on 30 July 2026 against the deployed service, because "how many clients can it take" is a
fair question and the repository did not answer it. It has two answers and they are nowhere near each
other, which is the interesting part.

## What was measured

[`scripts/loadTest.ts`](../scripts/loadTest.ts), against `http://2.28.24.132:4000/graphql` — a
Hetzner cx23: **2 vCPU, 4 GB**, one Node process and one MongoDB container sharing it.

The query asks for a city that is already stored, on purpose. A warm read is one indexed MongoDB
query plus the scoring arithmetic and costs **no** upstream call, so this measures the service rather
than Open-Meteo, and running it cannot spend the free tier. The script fails the run if `issuedAt`
moves, because that would mean a fetch happened and the numbers would describe something else. It did
not move.

| Concurrent callers | req/s | p50 | p95 | max | failures |
|---|---|---|---|---|---|
| 1 | 19 | 44 ms | 126 ms | 132 ms | 0 |
| 10 | 165 | 52 ms | 120 ms | 196 ms | 0 |
| 50 | 267 | 174 ms | 303 ms | 681 ms | 0 |
| 100 | 321 | 289 ms | 428 ms | 1062 ms | 0 |
| 200 | 310 | 527 ms | 945 ms | 4189 ms | 0 |

**Roughly 300 warm reads per second, saturating at about 100 concurrent callers.** Past that,
throughput stops rising and latency doubles — the textbook shape of a queue forming behind a
saturated server.

Three things the table is careful about:

- **Every latency includes the internet.** It was run from a laptop to Frankfurt, so about 45 ms of
  every figure is round trip. The `p50` of 44 ms at one caller is essentially all network: the
  service's own work is what is left.
- **Zero failures at every level, including 200.** It degrades by getting slower, not by refusing.
  There is no connection limit, no queue cap and no load shedding — which is a finding as much as a
  reassurance, and it is in "what would have to change" below.
- **CPU was not measured properly** and so is not reported. `top -bn1` reports an average since boot
  on its first iteration, which made the samples taken during the run meaningless. The throughput
  curve establishes saturation on its own; the CPU number would have been decoration.

## The number that actually binds is not that one

300 requests a second is 26 million a day. The free Open-Meteo tier allows **10,000 calls a day**, so
the service could never feed that many *distinct* cities. Read throughput is not the ceiling; the
upstream budget is, and it binds in two different ways:

| Limit | Arithmetic | Roughly |
|---|---|---|
| Cities kept hourly-fresh | Each refresh costs one forecast call, plus a summit call where there is terrain and a marine call where there is water — one to three, and a request asking more than ten variables counts as more than one call. At 24 refreshes a day | **~200 cities**, round the clock |
| Cities the service has never seen | Terrain sampling is 81 coordinates and the Elevation API meters **per coordinate** | **~123 a day**, and they share the same 10,000 |

Both are already recorded as NFR5 in [`requirements.md`](./requirements.md). What this file adds is
the other side: the service can serve those ~200 cities to a very large number of *callers*, because
after the first request an hour, every caller is reading from MongoDB.

Put plainly: **this is sized by how many distinct places are asked about, not by how many people
ask.** A thousand users all asking about London cost the same upstream as one.

## What would have to change to scale

In the order I would actually do them.

1. **Pay Open-Meteo, or self-host it.** They publish their own Docker image and the API is the same.
   This is the only change that moves the real ceiling, and everything else on this list is premature
   until it is done.
2. **More API instances behind a proxy.** Nothing in the code prevents it today: the single-flight
   lease is a MongoDB document rather than in-memory state, so two instances already cannot
   double-fetch a city. Set `REFRESH_INTERVAL_MS=0` on all but one — that variable exists for exactly
   this. Untested, because nothing here runs two; it is the largest unproven claim in this
   repository.
3. **Give the refresher its own process type.** At one instance it shares the web process on purpose
   ([#48](./decisions.md)). At ten, a refresh tick competing with request handling on the same event
   loop is the wrong shape, and factor VIII of the twelve says so.
4. **A MongoDB replica set, reads on secondaries.** The read path is one indexed query per request;
   it is the first thing to scale horizontally after the API, and the last thing to become the
   bottleneck.
5. **Load shedding.** Right now a 200-caller burst is served slowly rather than partly refused. A cap
   with a fast 503 is kinder to a caller with a timeout than a four-second answer, and the current
   behaviour is a default rather than a decision.

## What this does not tell you

- **Nothing about cold reads.** A first request for an unseen city geocodes, samples 81 elevation
  coordinates and asks the wave model — seconds, not milliseconds, and bounded by the 8-second
  upstream cap rather than by anything here.
- **Nothing about a sustained hour.** Every level ran for ten seconds. Memory growth, connection-pool
  behaviour under a long run and the effect of a refresher tick landing mid-load are all unmeasured.
- **Nothing about the reviewer's laptop.** `docker compose up` on a machine with more cores will do
  better than these numbers, not worse.
