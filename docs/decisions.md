# Decisions and assumptions

Every call made on this project, in one place, each with the reason in a line and a pointer to where
the full argument lives. This is the index; the reasoning is in the linked files. Nothing here
restates an argument made elsewhere — scan this to see what was decided, follow a link to see why.

Status is either **decided**, **assumed** (no answer available, so a position was committed to and
the question recorded), **cut** (considered, not built), or **open**.

**Provenance.** Every number in this project traces to one of three kinds of origin, and the kind is
always stated where the decision is argued:

- **Measured here** — from a live API probe, with the raw response kept as a fixture in
  `krukit/activity-weather-ranking/probes/`. The terrain and quota figures are all of this kind.
- **Cited** — from a published source, linked at the point of use. All scoring thresholds are of
  this kind; the sources are listed in
  [`sanity-table.md`](./krukit/activity-weather-ranking/sanity-table.md).
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
| 11 | Persist raw facts, compute scores at read time. Never store a score | The model is an opinion and will change; the upstream facts will not. Re-scoring must never require re-ingesting | [constitution](./krukit/constitution.md) §1 |
| 12 | One document per forecast **issuance**, with the 7-day array embedded — not an upsert per (location, date) | Preserves how a forecast evolved, which an upsert destroys | — |
| 13 | Two collections, two lifecycles: `locations` immutable, `forecasts` volatile with TTL | They differ by orders of magnitude in write rate and retention; one policy cannot serve both | — |
| 14 | Cache-aside gateway: 1 h TTL + single-flight lease + stale-if-error | Three facets of one mechanism, answering the brief's "how do you refresh it" | [constitution](./krukit/constitution.md) §3 |
| 15 | Build the background refresher rather than cut it | A scheduled pull from an upstream system of record is the shape of this team's actual problem. Challenged twice, kept both times | [cut.md](./cut.md) scope audit |
| 16 | The summit weather series lives inside the city's issuance document | An issuance is the unit of consistency; separate documents would let city and summit drift to different TTLs and be compared anyway | [design-questions.md](./krukit/activity-weather-ranking/design-questions.md) Q1+2 |
| 17 | Absence has three states: `notApplicable`, `unavailable`, score `0` | "No ocean here", "the fetch failed" and "conditions are bad" are three different claims | design-questions.md Q1+2 |
| 18 | Scoring is declarative data — weighted factors over named curves — never branching code, and every score returns its per-factor contributions | A number nobody can interrogate is not a ranking, it is a guess | [constitution](./krukit/constitution.md) §2 |
| 19 | Store local dates plus the location's IANA timezone, never UTC instants | "Tuesday" in a travel forecast means Tuesday where the traveller is | context.md invariants |
| 20 | Confidence decays with forecast horizon and is returned alongside every score | A day-7 number presented like a day-1 number is a product bug | [constitution](./krukit/constitution.md) §5 |
| 21 | `modelVersion` is a global semver covering everything that can change a score, enforced by a snapshot test over the serialised domain config | A hash cannot be forgotten but tells a reviewer nothing; a semver is readable but relies on memory. The test removes the reliance | design-questions.md Q4 |
| 22 | Docker Compose on an existing Hetzner box, already provisioned as code; the reviewer runs the same compose file locally | Deploy on day one, on infrastructure that already works. A deployment discovered on the last day is a deployment that fails on the last day, and a novel platform learned under deadline is the usual way that happens | — |
| 34 | No city list exists anywhere. Applicability is measured per location, never enumerated | The recurring cities in these documents are tests chosen to break assumptions, not the supported set. A city nobody anticipated gets the same treatment as one that was tested | [design.md](./krukit/activity-weather-ranking/design.md) §1 coverage |

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
| 29 | TDD mandatory in the pure domain layer; other layers get integration tests weighted by risk | The scoring model is the part under judgement; the plumbing is not, and a four-day budget should be spent accordingly | [constitution](./krukit/constitution.md) §6 |
| 30 | No volume cap on documentation — only the test that a line must carry what code cannot | Verified against how this team actually works rather than assumed | [constitution](./krukit/constitution.md) §8 |
| 31 | The scoring sanity table is written **before** any curve exists, and every band is justified against a **published convention** rather than against intuition | The original plan — human intuition first — failed honestly: nobody on this project skis or surfs. Conventions are weaker than lived expertise but stronger in one way that matters here, since a reader can check them. Six rows where no convention decides are flagged arguable | [sanity-table.md](./krukit/activity-weather-ranking/sanity-table.md) |
| 33 | Surfing is modelled for a competent general traveller, not an expert | Changes the answer: 2.5 m clean swell is EXCELLENT for an expert and merely GOOD for the population this service serves | sanity-table.md, surfing row 3 |
| 32 | Version control deferred at the start of the project | Deliberate, and the cost is recorded: everything written before the repo exists lands as one commit, forfeiting the narrative for that stretch | **open** |

---

## Still open

One, and it is visible in the table above rather than hidden here.

- **#32** — when version control starts. Cost grows in one direction only.
