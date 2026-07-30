# Verify — 30 July 2026

Stage 6 of the pipeline. The implementation checked against the constitution
([`principles.md`](./principles.md) v3.0.0, 12 principles) and against the approved
[`design.md`](./design.md) and [`plan.md`](./plan.md), with fresh command output rather than
recollection.

The design's own compliance table ([`design.md` §7](./design.md)) is the check made *before* the code
existed, against constitution v1.0.0. This file is the check made after, against v3.0.0. Both are
kept: one is a prediction, the other is evidence, and collapsing them would hide which was which.

## Evidence

Every claim below was produced by running the command, in this order, on 30 July.

| Claim | Command | Result |
|---|---|---|
| Everything compiles | `pnpm typecheck` | exit 0, no output |
| Everything passes | `pnpm vitest run` | 33 files, **316 tests passed**, 0 failed |
| CI agrees | `gh run list --limit 1` | `completed success` on `368eb63` |
| The deployed service answers | `curl .../graphql?query={health}` | HTTP 200 |
| A stranger can run it | `git clone` → `docker compose up -d --build` | healthy in 9 s, cold-database forecast returned (M8's done-condition, recorded in [`milestones.md`](./milestones.md)) |
| No secret is tracked | `git ls-files`, `git grep` for token shapes | nothing; `.env`, `.valis/`, `.claude/`, `.local/` all ignored |

## Constitution, principle by principle

| # | Principle | How it was checked | Verdict |
|---|---|---|---|
| 1 | Facts before interpretation | `IssuanceDocument` carries series only; no score field exists to persist | holds |
| 2 | Scoring is data | Four profiles, every factor a `{weight, curve, source}` row; `factors[]` returned per activity | holds |
| 3 | No silent upstream calls | Weather goes through `ensureFresh` only. Geocoding and geography reach upstream through their own caches, which `design.md` §7 named as the exception when it was written | holds, as designed |
| 4 | Absence is not zero | Three-member union in the domain and in the schema | holds |
| 5 | Never more confident than the data | `stale`, `staleReason`, `confidence`, the ski assessment point — and finding V2 below, which is this principle applied to our own quota claim | holds after V2 |
| 6 | Test-first in every layer, red run included | Sampled by mutation rather than trusted: two load-bearing branches flipped, each killed exactly one test (below) | holds on the sample |
| 7 | Scope earns its place | Six items in `cut.md`, each with the test it had to pass | holds |
| 8 | Docs carry what code cannot | Rejected alternatives recorded in 54 decision rows and three ADRs, each with what the choice cost | holds |
| 9 | Deterministic by construction | `grep` over `src/domain/`: no `new Date(`, no `fetch(`, no `Math.random`, no import of `providers/` or `persistence/`. One `scoreIssuance` for both the live path and replay | holds |
| 10 | History is the narrative | Documents committed before the code they motivate; nothing pushed without permission | holds, with #32's deferral recorded |
| 11 | One change per commit, sliced vertically | M7 landed as six commits, each a slice through the layers it touched; each message names everything in it | holds |
| 12 | Exercisable by a human | 11 preloaded GraphiQL operations, all schema-validated by test; the refresher has a README recipe because it is not a query | holds |

### Principle 6, sampled rather than assumed

This project has already found three tests that passed while testing nothing, so "the tests are
green" is not evidence that they can detect their subject. Two branches were flipped and the suites
re-run:

| Mutation | Result |
|---|---|
| `refresher.ts`: never-scored locations fetched anyway | 1 failed, 8 passed — killed |
| `locations.ts`: `requestedSince` ignores its cutoff | 1 failed, 15 passed — killed |

Both restored; 25 passed after. This is a sample, not a proof over the whole suite. The three vacuous
tests this project has found were all found this way, two of them during M7 itself.

## Findings

| ID | Severity | Location | Summary | Resolution |
|---|---|---|---|---|
| V1 | MEDIUM | [`design.md`](./design.md) §4 | The profile sketches still read `weight: TBD` and the confidence decay still reads "TBD, pending a cited source". Both were resolved during M2-M3, but the document never said so, so a reader finishes §4 believing the numbers are open | **Fixed.** Both marked resolved, pointing at `src/domain/profiles/` and `confidence.ts`, and naming the one anchor NOAA does not supply |
| V2 | MEDIUM | [`src/persistence/locations.ts`](../src/persistence/locations.ts) | `ensureLocation` has no single flight. Two requests arriving together for a never-seen city both sample the terrain grid, so that city costs 162 metered coordinates rather than 81 — while NFR5 claimed "once per city, ever" | **Documented, not fixed.** Bounded to a city's first-ever sighting and impossible afterwards; a second lease is machinery used nowhere else. NFR5 now states the exception, and so does the function |
| V3 | LOW | [`requirements.md`](./requirements.md) NFR3 | "`domain/` performs no I/O" cited principle 3 (no silent upstream calls). It follows from principle 9 — it is the boundary that makes determinism checkable | **Fixed.** Citation corrected |
| V4 | LOW | [`src/app/liveDeps.ts`](../src/app/liveDeps.ts) | The production wiring has no test of its own. It is covered only by `server.test.ts`, which boots a real server and checks health and the refresher's first log line, so a mis-wired dependency on a path that boot does not touch would surface at runtime rather than as a red test | **Accepted.** The file is assignment statements over collaborators that are each tested, and the alternative is a test that asserts the shape of a literal. Recorded for stage 7 |

**Metrics.** 18 functional and 15 non-functional requirements, all met. 4 findings: 0 CRITICAL,
0 HIGH, 2 MEDIUM, 2 LOW. Two fixed, one documented, one accepted.

## What this stage did not check

Stated so the table above is not read as wider than it is.

- **The scoring model's correctness.** Twenty sanity rows pass, and every threshold cites a source,
  but nothing here validates the model against days people actually skied or surfed. That is the
  first item under "What I'd do next" in the README and it is a gap in the service, not a finding.
- **Behaviour under load.** One process, one refresher, no second instance. The lease is a database
  row so horizontal scale should work; nothing proves it.
- **The whole suite by mutation.** Two branches were sampled. A full mutation run is the honest
  version of this check and it was not run.
