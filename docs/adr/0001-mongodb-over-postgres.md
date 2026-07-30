# ADR 0001 — MongoDB over Postgres

**Status:** accepted, 30 July 2026. Shipped and running: four collections, 294 tests.
**Supersedes:** nothing. **Decision row:** [#9](../decisions.md).

## A note on when this was written

The choice was made on 29 July, before any code existed. This document was written on 30 July, after
M5 shipped. That gap is deliberate rather than sloppy: an ADR written at decision time records what
was believed, and one written after implementation can also record which of those beliefs survived
contact. Both halves are below, and where implementation weakened an argument it says so rather than
quietly dropping it.

## Context

The service stores four things with four genuinely different lifecycles. Three were designed up
front ([design.md §2](../design.md)); `leases` arrived with the refresh gateway:

| Collection | Lifecycle | Shape |
|---|---|---|
| `locations` | Effectively immutable — sampled once, kept forever | One document per place, with terrain and marine coverage embedded |
| `forecasts` | One document per **fetch**, newest 24 kept per location | Three day-series (city, summit, marine) of ~15 nullable numbers each |
| `resolutions` | Written once, never updated | `query → locationId` |
| `leases` | Seconds. Created and deleted continuously | One document per location being refreshed |

The access patterns are narrow and were known before the choice:

- newest issuance for a location (every read)
- all issuances for a location (`forecastHistory`)
- one location by id
- one resolution by normalised query string
- acquire/release a lease, atomically, under concurrency

There is no join anywhere in the design, no query that spans locations, and no aggregation.

## Decision

MongoDB, accessed through the official driver with no ODM.

### 1. It is the team's primary store — and this is the strongest reason

Collinson's stack is Node/TypeScript, Kafka, MongoDB as the primary store, GraphQL, EKS/Terraform,
with Salesforce as the system of record. A take-home that reaches for a different database is
answering a question nobody asked, and the reviewer then spends their attention on the substitution
rather than on the modelling.

This reason is contextual rather than technical, and it is listed first because that is honestly its
rank. If the same service were being built for a team already on Postgres, the arguments below would
not on their own be enough to move it.

### 2. The aggregate genuinely is the document

The unit of consistency here is the whole fetch. City, summit and marine are one issuance because a
ranking must never compare skiing from one fetch against indoor sightseeing from another, and
nothing in the system ever reads one series without the others.

In Postgres that becomes one of two shapes:

- **A `jsonb` column** holding the three series. This works, and it discards most of what Postgres
  was chosen for — no column types, no constraints on the interesting part, no meaningful indexes
  over the days.
- **Three tables and a join per read**, plus a transaction on write to keep them in step. That is a
  real relational model of something that is not relational: the day rows have no independent
  identity, are never queried alone, and are never updated after insert.

The document store is not being chosen for being "schemaless" — the shape is fixed and validated by
zod at the provider boundary. It is being chosen because the aggregate boundary and the storage
boundary coincide, which is the one case where a document store is straightforwardly the right tool.

### 3. Retention matches the write, not a background job

Every issuance write prunes past the newest 24 for that location, in the same call. `expiresAt` at 30
days is a TTL backstop that only fires for locations nobody asks about any more.

Postgres would do the prune with a window function in one statement, which is *better* than the
find-then-`deleteMany` used here (two round trips). What Mongo gives free is the backstop: a TTL
index versus a `pg_cron` job or an external scheduler to install, monitor and explain.

### 4. Testing needs no Docker

`mongodb-memory-server` starts a real `mongod` 8.2.6 — the same major version as the `mongo:8` in
`docker-compose.yml`. The driver, the indexes, the sort order and the duplicate-key behaviour under
test are production's, and only the server's lifetime is owned by the test. `pnpm test` runs on a
laptop with no daemon running and in CI with no service container.

Postgres has equivalents (`testcontainers`, `pg-mem`), but `testcontainers` needs a Docker daemon and
`pg-mem` is a reimplementation — which for the lease test would mean asserting that the fake
serialises the way the real one does.

## What was a tie, and was argued as though it were not

**The single-flight lease.** The mechanism is one atomic upsert whose duplicate-key error *is* the
"someone else is fetching" answer:

```js
updateOne({ _id: key, expiresAt: { $lt: now } }, { $set: { holder, acquiredAt, expiresAt } },
          { upsert: true })
```

Postgres does this at least as well, and arguably more clearly:

```sql
INSERT INTO leases (id, holder, expires_at) VALUES ($1, $2, $3)
ON CONFLICT (id) DO UPDATE SET holder = $2, expires_at = $3
WHERE leases.expires_at < now()
```

— and it has advisory locks besides, which need no table at all. This was on the original list as a
point for Mongo. It is not one, and it is recorded here rather than deleted.

## What implementation weakened

**The TTL argument shrank.** Mongo's TTL monitor runs roughly every 60 seconds, so an expired lease
document can outlive its own expiry by a minute. The acquire filter therefore has to test
`expiresAt < now` itself and can never rely on the deletion. TTL is housekeeping, not a lock — which
is now written into `leases.ts` and covered by a test that grants an expired lease *with the document
still present*.

Risk 7 in [recon.md](../recon.md) had already found the other half: a TTL index cannot express "keep
at least one", so expiring the last surviving issuance during an upstream outage would leave
stale-if-error nothing to serve. Retention had to move into the application regardless.

So of the two things TTL was supposed to buy, one was unusable for correctness and the other could
not express the policy. What remains is a genuine backstop for abandoned data, which is worth having
and is a much smaller claim than the one originally made.

## What Postgres would be better at

Listed because an ADR that finds no cost is not an ADR:

1. **`forecastHistory` is a query pretending to be application code.** "How did our forecast for one
   date change as it approached" is a window over revisions. In SQL it is one statement; here it is
   `allFor` plus a `flatMap` and a `findIndex` in TypeScript. It works and it is tested, but the
   database is not helping.
2. **Nothing at the storage layer enforces the shape.** zod validates upstream responses at the
   provider boundary, and that is the only gate — a bug writing a malformed issuance would be caught
   by nothing until something read it back. Postgres would enforce `NOT NULL` and check constraints
   for free.
3. **Calibration analysis.** The scoring model has no ground truth, and the honest way to improve it
   is querying stored history for scenarios. In SQL that is exploratory work; here it would mean
   writing a script.

## What would reverse this

Concrete triggers rather than "if requirements change":

- A second consumer needing to query across locations — "every coastal city with surf above 1.5 m
  next Tuesday" is a scan here and an index there.
- Scoring calibration moving from the sanity table to backtesting over stored issuances, which makes
  item 1 above the main workload rather than one field.
- A retention rule that stops being per-location. "Keep 24 per location" is a small application-side
  loop; anything set-based is not.
- The team moving off MongoDB, which removes the first and strongest reason entirely.

## Consequences

- The prune runs on every issuance write. Two round trips, bounded at 24 documents, and it is where
  a retention bug would appear.
- The `resolutions` collection exists because there is no cheap way to express "this query string
  resolved to this location, first writer wins" other than a document keyed by the query string. In
  a relational model it would be a two-column table, which is the same thing.
- No ODM. The four repositories are 77 to 176 lines each of driver calls, with their document types
  hand-written next to them. Mongoose would add a schema layer duplicating what zod already does at
  the provider boundary, and a second place for the shape to drift.
