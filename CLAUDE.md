# Project: activity-weather-ranking

Collinson Group take-home. A Node/TypeScript/GraphQL service that takes a city and ranks the next
seven days for skiing, surfing, outdoor sightseeing and indoor sightseeing, over Open-Meteo, with
the weather persisted rather than re-fetched per request.

**The submission is graded on how the work happened before it is graded on the service.** The
documents in `docs/` are the primary deliverable, not overhead.

## Read these before touching anything

| File | What it holds |
|---|---|
| `docs/decisions.md` | **Start here.** Every decision and assumption, one line each, linking to the full argument |
| `docs/principles.md` | 12 principles, v4.0.0. Every design is checked against them before it is built, and the code afterwards |
| `docs/milestones.md` | M0 to M8, each with a done-condition observable from outside and a story-point size |
| `docs/design.md` | Data model, gateway read path, scoring, determinism |
| `docs/plan.md` | Eight vertical slices, what blocks what |
| `docs/open-questions.md` | The eight product questions and the assumption taken for each |
| `docs/cut.md` | What was considered and not built, and the scope test each item had to pass |

`.local/flow-state.md` holds the pipeline state and is deliberately untracked: stage checkboxes carry
no signal for a reader. Resume at the first unticked slice in its stage-5 table.

## Hard rules specific to this project

- **Never invent a scoring threshold.** Every number in a profile cites a named source, and the
  curves are fitted to a hand-written sanity table that a human writes first. If the table is
  missing, stop and ask for it — do not generate one. This is risk 6 in `docs/recon.md` and the single
  easiest way to ruin this submission.
- **Never call Open-Meteo from a test.** Fixtures live in
  `docs/probes/`. They are real captured responses.
- **Test first in every layer, and run the red** (constitution 6). Write the test, run it, watch it
  fail for the reason you intended, and only then write the code. This is not domain-only — providers
  test against fixtures, the API tests through HTTP. A test that has never failed is a claim, not
  evidence.
- **Never push to a remote without explicit permission.**
- **One change per commit, sliced vertically** (constitution 11). A commit must be revertable on its
  own without breaking the build, and its message must name everything it contains. Never commit a
  whole layer at once, and never quietly fold an unrelated doc edit into a code commit.
- **Every capability ships with a query a human can paste** (constitution 12). Preloaded GraphiQL
  examples, a named use case in the README, and a runnable example of each failure and absence state.
  A feature only a test can reach is not finished.
- `domain/` performs no I/O. No `new Date()`, no database, no fetch. That boundary is what makes the
  determinism claim in design.md §6 checkable.

## Environment

- Node 24.15.0, pnpm available. TypeScript strict.
- MongoDB via `docker-compose` — the same file the reviewer runs.
- Deploy: `./infra/deploy.sh <host>` — live at `http://2.28.24.132:4000/graphql`. The box pulls
  `origin/main` itself; it never receives an rsync of the working tree. Host described in
  `infra/cloud-init.yaml`. Provider credentials live outside this repository and are not referenced
  from it.
- Open-Meteo free tier: 600/min, 10k/day. Requests over 10 variables count as more than one call.
  The Elevation API meters **per coordinate** and caps a request at **100 coordinates**.
