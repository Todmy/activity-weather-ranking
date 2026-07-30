# The twelve factors, audited

Run on 30 July 2026 against the deployed service, by grep and by command rather than by
recollection. It exists because "is this production-ready" deserves an answer with evidence attached
and a list of what is deliberately missing — the same deal the rest of `docs/` makes.

Two of the findings were fixed while writing this, one was already fixed, and four are left undone on
purpose. The undone ones are the point of the document.

| # | Factor | Verdict | Evidence |
|---|---|---|---|
| I | Codebase | **holds** | One repository, one app. The box runs `git reset --hard origin/main` and builds there; it never receives an rsync of anyone's working tree, so what runs is what a reviewer can read |
| II | Dependencies | **holds** | `pnpm-lock.yaml`, `--frozen-lockfile` in CI and in the image, `--prod` in the image. No system dependency beyond `node:24-alpine` — and no build step, because Node 24 strips types at load |
| III | Config | **holds** | Five variables, validated once by zod at startup and never read from `process.env` again. `.env.example` documents them; every one has a working default, so the service starts with no `.env` at all |
| IV | Backing services | **partial, deliberate** | MongoDB is attached by URI. The three Open-Meteo endpoints are constants in their provider files, not configuration — see below |
| V | Build, release, run | **holds, fixed 30 July** | No build stage by design. The release is now identifiable: the commit arrives as a Docker build argument that `deploy.sh` stamps, and `{ release }` reports it. It says `unknown` when nothing stamped the build rather than inventing an answer |
| VI | Processes | **holds** | Stateless. `grep` finds no in-memory cache and no local file write anywhere outside tests; all state is in MongoDB. The one per-process value is `instanceId`, which identifies a lease holder and is deliberately not shared |
| VII | Port binding | **holds** | `node:http` binds its own port. No nginx, no application server, no runtime injection |
| VIII | Concurrency | **partial, deliberate** | One process type. The background refresher runs inside the web process — decision [#48](./decisions.md), with the lease as the reason it is safe. See below |
| IX | Disposability | **holds, fixed 30 July** | Boots in under a second. SIGTERM and SIGINT close the socket, drop idle keep-alive connections immediately, give a request already in flight eight seconds, then force. The refresher's tick is awaited before the database handle closes, so no lease is stranded |
| X | Dev/prod parity | **holds, strongly** | The `docker-compose.yml` a reviewer runs is the file the deployed host runs. Tests start a real `mongod` of the same major version as the `mongo:8` in compose, so the driver, the indexes and the concurrency behaviour under test are production's |
| XI | Logs | **holds, fixed 30 July** | Event stream to stdout, no files, no rotation. One JSON line per GraphQL request with operation, status, error count and duration; the error count matters because GraphQL answers 200 with an `errors` array |
| XII | Admin processes | **holds** | `pnpm schema` runs against the same code in the same environment. There are no migrations and no seeds — see below |

## Seeds: there are none, and that is the design rather than an omission

`locations`, `forecasts` and `resolutions` are all populated on demand from upstream. The first
request for a city geocodes it, samples its terrain, asks the wave model about its coordinate and
writes the first issuance. There is no data a human has to load for the service to work, so a seed
script would be a demo fixture, not a requirement — and the README already has a faster one: ask for
Innsbruck.

The nearest thing to a seed is deliberate: `REFRESH_INTERVAL_MS=15000` plus a one-line back-date, so
a reviewer can watch the refresher work in fifteen seconds instead of an hour.

## What is left undone, and why

Each of these was considered while writing this file. None is hard; all four are absent on purpose.

**Metrics and tracing.** No Prometheus endpoint, no OpenTelemetry. They are real production
requirements and they demonstrate nothing about modelling weather, which is what this submission is
assessed on. The line between this and the request logging that *was* added: a service with no access
log cannot answer what happened, while a service with no percentile histogram merely cannot answer it
in aggregate. Recorded in [`cut.md`](./cut.md) and [`requirements.md`](./requirements.md).

**Open-Meteo endpoints in configuration.** Factor IV wants a backing service attachable by config,
and these are constants in three provider files. It is fifteen minutes of work. It is not done
because the config surface is currently five variables that each earn their place, and three more
existing only for a scenario nobody will run — pointing this service at a mirror of a free public API
— makes the story worse, not better. The moment there is a staging environment with a proxy in front
of Open-Meteo, this changes.

**A separate worker process.** Factor VIII would put the refresher in its own process type. It shares
the web process instead, and the lease is why that is safe: it is the same lease a request takes, so
two instances behind one database already cannot double-fetch. Splitting it would buy isolation this
service has no use for at one instance — and [`capacity.md`](./capacity.md) now says why with a
number, because the ceiling turns out to be the upstream quota rather than this process. Decision
[#48](./decisions.md).

**Two log formats on one stream.** The refresher writes lines a human reads
(`refresher: Ljubljana (geoname:3196359) refreshed`); requests write JSON a machine reads. That is
inconsistent, and it is on purpose: M7's done-condition is a person watching `docker compose logs`,
and JSON would have made the deliverable unreadable. A real deployment would make both structured and
render the human view elsewhere.

## What this audit changed

- **Factor IX was a defect, not a gap.** `closeAllConnections()` destroys active connections as well
  as idle ones, so a SIGTERM severed whatever request was being served. Fixed, and the test that
  proves it needed a second attempt: the first version wrote unterminated headers, which Node counts
  as an *idle* connection, so it passed against the very bug it was written for.
- **Factor V was invisible.** The service could not say which commit it was running, and the deploy
  log is not an answer — it records what was sent, not what is answering.
- **Factor XI was thin.** The mechanism was right and there was nothing on it. The care in that
  change is that the logger is a Yoga plugin rather than a wrapper around `fetch`:
  `createServer(app)` hands the app to Node as a request listener and never touches `fetch`, so a
  wrapper would have logged everything the tests do and nothing production does. There is a test over
  a real socket for that reason alone.
