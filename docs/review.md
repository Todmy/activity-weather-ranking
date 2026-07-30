# Review — 30 July 2026

Stage 7, the last one. A final pass over the whole thing: the code, the documents as a deliverable,
and the questions a reviewer will ask that this repository does not currently answer.

**This review was not independent, and that weakens it.** The pipeline's own design calls for a fresh
reviewer with no memory of the work; that step was skipped because subagents are not run in this
project by standing instruction. So this is the author reviewing the author, which catches
carelessness and misses blind spots by construction. Two of the three findings below are the kind an
outside reader would raise, which is some evidence the pass was not purely self-congratulatory — but
it is not the same thing as a second pair of eyes, and it should not be read as one.

Stage 6's evidence is not repeated here; it is in [`verify.md`](./verify.md). Nothing in this file
changes it: 319 tests, `tsc --noEmit` clean, CI green, deployed and answering.

## Findings

| ID | Severity | Location | Finding | Resolution |
|---|---|---|---|---|
| R1 | Minor | [`src/domain/rank.ts`](../src/domain/rank.ts) | Ties break on `localeCompare`, which is locale-sensitive. Principle 9 promises "an explicit total order for tied scores", and that order currently holds because of the *input set* — four ASCII activity names that differ in their first two characters, and ISO dates — rather than because of the comparator. Two deployments with different ICU locales are guaranteed to agree only by accident of the data | **Declined, and written down instead.** No test can go red for it: every locale produces identical output over this input. Landing a behaviour-preserving change nobody can verify, on submission day, is worse than naming it. If a fifth activity ever arrives with a name that collides in its first characters, `localeCompare(b, 'en')` is the one-word fix |
| R2 | Minor | [`src/persistence/forecasts.ts`](../src/persistence/forecasts.ts) | `{ locationId: 1, issuedAt: -1 }` does not cover the `_id` half of the `newestFirst` sort, so tied `issuedAt` values are ordered in memory | **Declined.** At most 24 documents per location, and `issuedAt` has millisecond precision — the `_id` tie-break exists so the order is *defined*, not so it is fast. Widening the index would cost writes to buy nothing |
| R3 | Important | `CLAUDE.md`, repository root | The file is committed and public. It carries the working instructions for this project — including the ssh alias and the *path* to the Hetzner token (not the token), and a line about "the single easiest way to ruin this submission" that reads oddly to anybody but its author | **Raised with the author, not decided here.** No secret is exposed and its presence is honest about how the work happened, which this project argues for elsewhere. But whether a reviewer should read the author's private instructions to himself is a submission call, not an engineering one |

**Metrics.** 3 findings: 0 critical, 1 important (referred to the author), 2 minor (both declined
with reasons). No code changed during this stage, which is why there are no fix commits.

## Questions a reviewer will ask

The useful half of this stage. Each is a question I would ask about somebody else's submission, with
where the repository answers it — or the admission that it does not.

| Question | Where the answer is |
|---|---|
| Why MongoDB and not Postgres? | [ADR 0001](./adr/0001-mongodb-over-postgres.md), including what the choice cost |
| How do I know the scores are any good? | You don't, and the README says so. Twenty sanity rows pass and every threshold cites a source, but nothing validates the model against days people actually skied. It is the first item under "What I'd do next" |
| What happens when Open-Meteo changes its response shape? | The zod parse fails, becomes an `OpenMeteoError`, and stale-if-error serves the last good issuance with `stale: true`. The probes pin the request that was captured, so a changed *request* contract fails a test rather than production |
| How far does this scale? | Not answered by the architecture, and deliberately: the ceiling is Open-Meteo's free tier — 10,000 calls a day, and ~123 never-before-seen cities a day because terrain sampling meters per coordinate. Named in NFR5 and in `cut.md`, along with the exception the verify stage found |
| Where is the auth, the rate limiting, the observability? | [`cut.md`](./cut.md), each with the test it had to pass to be built. The service protects the shared quota against its own traffic pattern only |
| **What is the test coverage?** | **Not measured.** 319 tests and no coverage report — `vitest --coverage` is not wired up. Every source file except five has a sibling test, and the five are types, wiring and the process entry point. A number would still be a fair thing to ask for and there isn't one |
| **Why is there no linter or formatter?** | It was a deliberate omission that had never been written down — the same failure mode as an undocumented threshold. Now in [`cut.md`](./cut.md) with the reason: a formatter introduced part way through buries the commits this is graded on under whitespace, and `tsc --noEmit` under `strict` catches what a linter would |
| How much of this was written with AI assistance? | The worklog says plainly, and `CLAUDE.md` is in the repository — see finding R3 |

## After this review — 30 July, later the same day

Eight commits landed after the pipeline closed, and none of them is a milestone. They are here so a
reader who diffs `main` against this file is not left wondering whether the tracker rotted.

The trigger was a question this review had already recorded as unanswerable — "how far does this
scale?" — followed by a second one it had not thought to ask: does this hold up as a twelve-factor
service at all. Auditing that found three things, and the useful distinction is that they were
**defects rather than scope**:

- **A shutdown that severed the request in flight.** `closeAllConnections()` destroys active
  connections as well as idle ones, so SIGTERM cut off whatever was being served.
- **A release nobody could identify.** The process could not say which commit it was running, and a
  deploy log records what was sent rather than what is answering.
- **An event stream with nothing on it.** Five `console` calls in the whole service and none per
  request.

All three are fixed; the four *scope* items the same audit turned up are in
[`twelve-factor.md`](./twelve-factor.md) and stay undone on purpose. Capacity was then measured rather
than estimated — [`capacity.md`](./capacity.md) — which turned R1's neighbour, "how far does this
scale", into a number with conditions attached.

Three figures above this line are from the day it was written and are now behind: the test count was
319 and is 334, the commit count said eight and was already fourteen, and "every source file except
five has a sibling test" is now six. Left as they were, because a stage artifact that quietly updates
itself is no longer evidence of when it ran — but named in full, because a staleness note that misses
a third of what is stale reads as precision it does not have. That omission was itself a finding of
the audit below.

## The independent review that was missing — 30 July, evening

The top of this file records that stage 7 skipped its own most important step: the reviewer was the
author. That has now been fixed, and it is the reason this section is longer than the original
review. Three reviewers with no context on the work and no memory of writing it were given the
repository cold — one on the code, one auditing every claim in `docs/` against the code and the git
history, and one told to read it as a Collinson hiring engineer with an hour and a recommendation to
make. Their briefs are in the git history of this commit range; the findings below are the ones that
survived being checked against the code by hand, because a reviewer's report is a claim too.

**Twenty-six findings, of which two were critical.** Neither was reachable from any test that
existed. The distribution is the point: the self-review found three findings and none of them was a
defect.

### Fixed

| Severity | Finding | Commit |
|---|---|---|
| **Critical** | An issuance stored as `marine: { status: 'ok', days: [] }` made every request for that city throw for the whole freshness hour, surfacing as a bare "Unexpected error." `[]` is not nullish, so it survived the `??` and reached `mergeMarine`'s length check. Fixed at both layers, because the gateway fix cannot heal issuances already stored | `2df69cb` |
| Important | The refresher's per-tick limit was a cap, not a window. Ordered by `lastRequestedAt` descending, it picked the twenty locations the read path had just refreshed; past twenty warm cities the rest were never refreshed at all. Inverting the sort does not help — refreshing does not move that field. Locations gained `lastConsideredAt` and the queue now rotates | `5f74b9f` |
| Important | Three of the four upstream clients took no `AbortSignal`, and two of them run *ahead* of the gateway. Node's fetch has no default request timeout, so a hung geocoder held a socket for five minutes | `01829e5` |
| Important | `SHUTDOWN_GRACE_MS` was 8 s while a cold-start request can legitimately wait 10 s, so SIGTERM severed exactly the request the grace exists to protect. The chain now runs 8 s upstream < 10 s wait < 12 s grace < 30 s Docker, and a test asserts the order | `af5a3a0` |
| Important | A throw from the lease release, running in a `finally`, replaced a successfully stored issuance with a request error | `34a35fd` |
| Important | **"No scoring number without a named published source" was not literally true.** Skiing's lift-hold gate is `rampDown(56, 72)` and 72 is in no citation; the outdoor table states air temperature while the profile scores apparent; one constant has no publication at all. All three are defensible and none was disclosed. Now marked, with the reasoning — and the four tests that claimed to enforce the rule asserted `source.length > 20`, which prose passes | `8d08dff` |
| Important | Eight figures a reader can check in one command were wrong: Grenoble at 218 m/3354 m against a probe that says 214/3204 and a GraphQL schema that says the same, eight milestones against nine, 54 decision rows against 53, an index claiming completeness while missing two cut items, a pointer to a file deleted in `c0507c5` | `2d29d60` |

### Open, and the author's call rather than a defect

| Finding | Why it is not fixed here |
|---|---|
| **Skiing scores 35/100 on a bare 14 °C summit with no snow, and ranks it the best ski day of the week.** Zero temperature and zero fresh snow surrender only their own share of the weight; wind and rain carry 7 of 20. There is no snow gate | The fix needs a threshold, and this project's hardest rule is that a human writes the sanity rows before a curve is fitted to them. All five ski rows presuppose a base — rows 2 and 5 say so out loud — so the fitting procedure had no way to fail this case. **That is the real finding: the table has no negative examples.** Raised with the author with the four candidate fixes costed; `snow_depth` is the only signal that is not a proxy, and it is hourly-only, so it is not a three-line change |
| The API returns a bare integer where the sanity table defines POOR/FAIR/GOOD/EXCELLENT bands | A feature, not a defect. Raised |
| Terrain is sampled over 50 km, marine at the single city coordinate — so Amsterdam is `noMarineCoverage` with Zandvoort 25 km away. The argument that justifies the Grenoble summit invalidates the marine treatment | Real asymmetry, and no document notices it. It needs an answer written down more than it needs code |
| Seven minor code findings: a stale issuance discarded on the degrade path, a `removeListener` that removes nothing, a schedule left running on bind failure, the summit series joined by index without the date check marine has, the refresher planning from an unassessed document, `issuedAt` taken before the fetch rather than after, and `localeCompare` without an explicit locale | Recorded, not fixed. Each is small; none changes an answer today; and the author's instruction was to stop and analyse before adding, not to close every open box before a deadline |

**What the hiring reviewer said, since it is the only outside read of this submission that exists:**
*hire*, not strong hire — "the persistence model is the real thing, not a cache with a TTL bolted
on", "geography is measured, so there is no hardcoded city list anywhere, and that is the single best
piece of product judgement in the submission" — with the snow bug and 3,683 lines of markdown against
4,106 of source named as what holds it back. Both are recorded here rather than argued with.

## What I would not change

Recorded because a review that only lists problems misrepresents the thing it reviewed.

- **The order of the work.** Probing the APIs before designing against them killed two mechanisms
  before either was written, and the schedule absorbed it because it happened on day one.
- **Issuance-per-fetch over upsert-per-date.** It is the more expensive model and `forecastHistory`
  is the only field that needs it. It is also the only reason the question "what did we think on
  Tuesday that Friday would be" can be answered at all.
- **The sanity table before the curves.** It is the only defence in the project against numbers that
  sound authoritative and mean nothing, and it worked twice — once by failing.
