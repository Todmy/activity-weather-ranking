# Decisions and assumptions

Every call made on this project, in one place, each with the reason in a line and a pointer to where
the full argument lives. This is the index; the reasoning is in the linked files. Nothing here
restates an argument made elsewhere — scan this to see what was decided, follow a link to see why.

Status is either **decided**, **assumed** (no answer available, so a position was committed to and
the question recorded), **cut** (considered, not built), or **open**.

**Provenance.** Every number in this project traces to one of three kinds of origin, and the kind is
always stated where the decision is argued:

- **Measured here** — from a live API probe, with the raw response kept as a fixture in
  `probes/`. The terrain and quota figures are all of this kind.
- **Cited** — from a published source, linked at the point of use. All scoring thresholds are of
  this kind; the sources are listed in
  [`sanity-table.md`](./sanity-table.md).
- **Judged** — no source decides, so a position was taken and flagged as arguable. Six rows of the
  sanity table and several product assumptions are of this kind.

Nothing here is of a fourth kind — asserted from memory and left unchecked. Four figures started
that way and three moved when verified; the corrections are recorded next to the numbers rather than
silently applied.

---

## Product assumptions

Questions that would normally go to a product manager. The brief asks for the question and the
assumption taken in its place; all eight are recorded in full, with rejected alternatives, in
[`open-questions.md`](./open-questions.md).

| # | Question | Position taken | Status |
|---|---|---|---|
| 1 | Rank days within an activity, or activities within a day? | Both, from one response — the computed data is identical, so guessing wrong costs nothing | assumed |
| 2 | Does "skiing" mean the city or the region reachable from it? | The region. A city coordinate says Grenoble cannot ski, which is plainly wrong | assumed |
| 3 | Does "surfing" include inland water with wave data? | No exclusion rule. Wave period separates rideable swell from chop, so lakes score near zero on physics rather than on a list. Curve zero point at ~8 s, cited to surf-forecasting convention | assumed |
| 4 | How fresh must the data be? | One hour — matched to Open-Meteo's *fastest* models (GFS, ARPEGE, UK Met Office, KNMI all hourly). For locations served by 3- or 6-hourly models this over-fetches, which is an accepted cost | assumed |
| 5 | Ambiguous city names — resolve silently or let the caller choose? | Both paths, as two distinct fields. The resolved location is always returned, so a substitution is never silent | assumed |
| 6 | May the service refuse to answer? | Never. "Try again later" is not travel advice; confidence and staleness are surfaced instead | assumed |
| 7 | How should terrain be sampled? | 11×11 over a circular 50 km mask, 81 points, pinned constants. Measured, not guessed | decided |
| 8 | What elevation means "terrain exists"? | 300 m, and only as a cost gate — snow decides the real question | decided |

## Architecture decisions

| # | Decision | Reason in one line | Detail |
|---|---|---|---|
| 9 | MongoDB over Postgres | Matches the team's primary store; the document shape fits a forecast issuance naturally | ADR pending |
| 10 | GraphQL Yoga + Pothos, code-first | No codegen step to explain or to break; the schema is TypeScript the reviewer can read | ADR pending |
| 35 | No Express and no NestJS. Yoga runs directly on `node:http` | There is one POST endpoint and no REST routes, so Express would be a layer nothing passes through. NestJS was rejected harder: its modules and DI container coordinate large teams across large codebases, and `domain/` is pure functions with no dependencies to inject. Matching Collinson's stack drove the MongoDB choice, but nothing indicates they run NestJS, so copying it would be a guess rather than a match | [principles](./principles.md) §1 simplicity |
| 11 | Persist raw facts, compute scores at read time. Never store a score | The model is an opinion and will change; the upstream facts will not. Re-scoring must never require re-ingesting | [principles](./principles.md) §1 |
| 12 | One document per forecast **issuance**, with the 7-day array embedded — not an upsert per (location, date) | Preserves how a forecast evolved, which an upsert destroys | — |
| 13 | Two collections, two lifecycles: `locations` immutable, `forecasts` volatile with TTL | They differ by orders of magnitude in write rate and retention; one policy cannot serve both | — |
| 14 | Cache-aside gateway: 1 h TTL + single-flight lease + stale-if-error | Three facets of one mechanism, answering the brief's "how do you refresh it" | [principles](./principles.md) §3 |
| 15 | Build the background refresher rather than cut it | A scheduled pull from an upstream system of record is the shape of this team's actual problem. Challenged twice, kept both times | [cut.md](./cut.md) scope audit |
| 16 | The summit weather series lives inside the city's issuance document | An issuance is the unit of consistency; separate documents would let city and summit drift to different TTLs and be compared anyway | [design-questions.md](./design-questions.md) Q1+2 |
| 17 | Absence has three states: `notApplicable`, `unavailable`, score `0` | "No ocean here", "the fetch failed" and "conditions are bad" are three different claims | design-questions.md Q1+2 |
| 18 | Scoring is declarative data — weighted factors over named curves — never branching code, and every score returns its per-factor contributions | A number nobody can interrogate is not a ranking, it is a guess | [principles](./principles.md) §2 |
| 19 | Store local dates plus the location's IANA timezone, never UTC instants | "Tuesday" in a travel forecast means Tuesday where the traveller is | context.md invariants |
| 20 | Confidence decays with forecast horizon and is returned alongside every score | A day-7 number presented like a day-1 number is a product bug | [principles](./principles.md) §5 |
| 21 | `modelVersion` is a global semver covering everything that can change a score, enforced by a snapshot test over the serialised domain config | A hash cannot be forgotten but tells a reviewer nothing; a semver is readable but relies on memory. The test removes the reliance | design-questions.md Q4 |
| 22 | Docker Compose on a dedicated Hetzner box, bootstrapped by [`infra/cloud-init.yaml`](../infra/cloud-init.yaml) and deployed by pulling `origin/main`; the reviewer runs the same compose file locally | Deploy on day one on infrastructure that is described in the repository rather than configured by hand. A deployment discovered on the last day is a deployment that fails on the last day, and a novel platform learned under deadline is the usual way that happens. *Corrected from "an existing box the author already runs" — the box did not exist and had to be created, which made the original justification untrue* | — |
| 34 | No city list exists anywhere. Applicability is measured per location, never enumerated | The recurring cities in these documents are tests chosen to break assumptions, not the supported set. A city nobody anticipated gets the same treatment as one that was tested | [design.md](./design.md) §1 coverage |
| 37 | Profiles carry **multiplicative gates** alongside their weighted factors: `score = (floor + (1 − floor) × mean) × Π gate`. Rejected `min()` and a hard cutoff to 0 | Two sanity rows are vetoes — skiing 4 (lifts held at 70 km/h gusts, so 40 cm of powder is unreachable) and indoor 4 (90 km/h storm, so the open museum cannot be reached) — and no set of additive weights satisfies them alongside skiing 2. `min()` passes the rows but throws away magnitude, so the model stops ranking days it has vetoed; a cutoff to 0 collides with principle 4, where `score: 0` already means "applicable and bad" | [design.md](./design.md) §4 gates |
| 38 | Indoor sightseeing carries a **floor of 55**; every other profile floors at 0 | The activity is available whatever the weather does, and the table puts a perfect beach day at FAIR rather than POOR. The gate still multiplies after the floor, so a storm takes it to 0 — open is not the same as reachable | sanity-table.md, indoor rows 2 and 4 |
| 39 | The forecast request carries `past_days=3`, and `snowfall3d` is derived over the issuance before scoring | "Fresh snow" is a window, not a day: the table's ski rows talk about 25 cm over three days and two weeks without snowfall. Costs no extra call. Without it the first forecast day reads as though the mountain had never seen snow | [design.md](./design.md) §4 derived inputs |
| 40 | The `locations` collection ships in **M4 with the geography**, not in M5 with the forecast cache. Rejected recomputing terrain per request, and rejected running M5 before M4 | `terrain` and `marineCoverage` are fields on the location document, so without it the 81-point grid is re-sampled on every request — and the Elevation API meters per coordinate, which caps the whole service at 10,000 ÷ 81 ≈ 123 requests a day. Reordering M5 first would instead delay the two activities the brief names by a five-point milestone, and would land the refresh gateway before there is any geography to key it on. `locations` is the immutable collection with no gateway, no lease and no TTL, so it moves as a vertical slice rather than as a borrowed layer | [plan.md](./plan.md) slice 3, [design.md](./design.md) §2 |
| 41 | Skiing scores a **second forecast taken at the sampled high point**, not the city coordinate. Rejected scoring the city series and deleting `series: 'summit'` | Grenoble is 218 m in town and 3354 m within 45 km, so the city coordinate answers confidently about a place nobody skis — and it does so for exactly the cities a traveller would ask about. The extra request is only made above the 300 m gate, so a flat city still costs one. The alternative was cheaper by one request per mountain city per issuance and wrong on the only question skiing is asked | [plan.md](./plan.md) slice 3, [design.md](./design.md) §2 |
| 42 | The gateway **re-reads the newest issuance after winning the lease**, not only before asking for it | Found by the concurrency test, not by review. Two cold callers do not always overlap: the first can finish and release before the second acquires, and the second then refetches what already arrived. The lease alone does not close that window — it serialises the fetchers without telling the second one that the answer is already there. One extra document read per refresh buys it | [`src/app/forecastGateway.ts`](../src/app/forecastGateway.ts) |
| 43 | Staleness is reported as **`stale` + `staleReason` on the result**, not as a separate union member and not by omitting the answer | An unlabelled stale answer is worse than no answer, because nothing downstream can tell it from a current one. A union member would instead force every caller to handle a second shape for data that is structurally identical — the difference is provenance, not schema. `NoDataYet` *is* a different shape, and that one is an error with its own code | [design.md](./design.md) §3, [`src/api/schema.ts`](../src/api/schema.ts) |
| 44 | The 8-second upstream cap is an **`AbortSignal` threaded into `fetch`**, rather than a promise race in the gateway | A race abandons the promise and leaves the socket open, so a hung upstream keeps consuming a connection for as long as it likes while the lease it was guarding expires underneath it. The signal cancels the request itself. It also makes the cap testable without a timer: the provider tests assert the signal reaches `fetch` | [`src/providers/openmeteo/forecast.ts`](../src/providers/openmeteo/forecast.ts) |
| 45 | A skipped series records **why** it was skipped, and `notApplicable` is reserved for a measurement | "No mountain here" is permanent and "we never looked" is transient, and a stored issuance that conflates them cannot be re-read later. Geography sampling failure therefore writes `unavailable`, never `notApplicable` — a false `notApplicable` is invisible and permanent, which is the same argument that set the 300 m gate low | [`src/app/activityForecast.ts`](../src/app/activityForecast.ts) |
| 36 | UV is **not** a weighted factor in outdoor sightseeing. Heat is carried by apparent temperature instead | Found while fitting, not decided in advance. A weighted sum cannot express harm: a "no burn risk" factor reads 1.0 on a cold rainy day, so any weight large enough to pull sanity row 4 down to FAIR also lifted row 3 out of POOR. Apparent temperature reaches the same verdict on row 4 through the scale it is defined over. The gap this leaves is named rather than hidden — extreme UV under a cool sky is currently unpenalised | [`src/domain/profiles/outdoorSightseeing.ts`](../src/domain/profiles/outdoorSightseeing.ts) |

## Scope calls

Considered and not built. Full reasoning and what each would take in [`cut.md`](./cut.md).

| # | Item | Why not | Status |
|---|---|---|---|
| 23 | Offshore vs onshore wind for surfing | Needs coastline orientation, which nothing fetched here provides. The largest known gap in the surf model, and it is named rather than hidden | cut |
| 24 | A real ski-resort dataset | A high point is not a resort. Closing it means a second upstream source with its own licensing and refresh story — a larger problem than the brief poses | cut |
| 25 | Multi-request terrain grids | Measurement showed the extra precision is unusable: the sampled maximum is non-monotonic in radius | cut |
| 26 | Backtesting the scoring model against historical conditions | The right way to calibrate, and it does not fit the budget. The model is made *reviewable* instead of *validated*, and the README says so | cut |
| 27 | A front end | Excluded by the brief | cut |

## Process decisions

| # | Decision | Reason | Status |
|---|---|---|---|
| 28 | Run the full seven-stage pipeline and commit its artifacts | The brief grades how the work happened above the service itself, so the stage chain is itself a deliverable | decided |
| 29 | TDD mandatory in **every** layer, and the failing run is part of the discipline, not an optional flourish around it | *Corrected on 30 July. The original read "TDD mandatory in the pure domain layer; other layers get integration tests weighted by risk", on the reasoning that the scoring model is what is under judgement and the plumbing is not. Slice 1 disproved the second half: in the domain the red run caught `rampUp(5, 5)` returning 0 at its own threshold, and outside it a green schema test sat happily above an API error that reached the deployed service masked as INTERNAL_SERVER_ERROR. The budget argument was sound; the conclusion that unwatched tests still protect anything was not* | [principles](./principles.md) §6 v3.0.0 |
| 30 | No volume cap on documentation — only the test that a line must carry what code cannot | Verified against how this team actually works rather than assumed | [principles](./principles.md) §8 |
| 31 | The scoring sanity table is written **before** any curve exists, and every band is justified against a **published convention** rather than against intuition | The original plan — human intuition first — failed honestly: nobody on this project skis or surfs. Conventions are weaker than lived expertise but stronger in one way that matters here, since a reader can check them. Six rows where no convention decides are flagged arguable | [sanity-table.md](./sanity-table.md) |
| 33 | Surfing is modelled for a competent general traveller, not an expert | Changes the answer: 2.5 m clean swell is EXCELLENT for an expert and merely GOOD for the population this service serves | sanity-table.md, surfing row 3 |
| 32 | Version control deferred at the start, then opened on day 2 with a single batch commit | Deliberate, and the cost was paid rather than hidden: everything written on 29-30 July lands as one commit, forfeiting principle 10 for that stretch. The commit message says so plainly instead of imitating gradual work. Incremental from there | decided |

---

## Still open

None. #32 was the last one and closed on 30 July when the repository was created; every other row
above is decided, assumed or cut, and the ones marked *assumed* are questions a product manager
would answer, not decisions still being weighed.
