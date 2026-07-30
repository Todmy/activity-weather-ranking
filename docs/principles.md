# Constitution: activity-weather-ranking

Version: 3.0.0 | Ratified: 2026-07-29 | Last amended: 2026-07-30

The principles every design in this project is checked against before it is built, and re-checked
against the code afterwards.

**There is no cap, and there is a bar.** The cap was ten at ratification, and it was dropped on
30 July when two rules arrived that both cleared the bar. Holding the number would have meant merging
existing principles to make room, which improves the count and degrades the document. So the
gatekeeper is the bar instead, and it is deliberately hard to clear: a principle belongs here only if
it would have changed a decision already made in this project **and** it binds work not yet started.
Anything that only describes what went wrong once belongs in the worklog.

These are commitments, not received wisdom, and each is meant to be argued with. Where a principle
turns out to be the wrong call, that goes in the worklog rather than being quietly dropped here.

## Principles

1. **Facts before interpretation** — MUST persist raw upstream observations and compute activity
   scores at read time; a score is never stored.
   *The model is our opinion and will change; the upstream facts will not. Re-scoring must never
   require re-ingesting.*

2. **Scoring is data** — MUST express activity models as declarative profiles (weighted factors
   over named curves), never as branching code, and MUST return each factor's contribution
   alongside the score.
   *A number nobody can interrogate is not a ranking, it is a guess.*

3. **No silent upstream calls** — MUST route every Open-Meteo request through the forecast gateway
   (TTL + single-flight + stale-if-error); the request path never reaches upstream directly.
   *The brief grades the refresh strategy, and the free tier allows 10k calls/day. One careless
   resolver breaks both at once.*

4. **Absence is not zero** — MUST model "not applicable here" as a state distinct from "applicable
   but poor", in the domain types and in the API.
   *Telling someone Vienna scores 0 for surfing is a different claim from telling them Vienna has
   no ocean. The type system can stop us conflating the two.*

5. **Never more confident than the data** — MUST surface staleness, partial upstream failure and
   forecast horizon in the response rather than smoothing them away.
   *A travel decision made on a day-7 number presented like a day-1 number is a product bug, not a
   rounding detail.*

6. **Test-first, in every layer, and the red run is part of it** — MUST write a failing test before
   the code that satisfies it, and MUST run that test and watch it fail for the intended reason
   before writing the code. This binds every layer, not only the domain: providers are tested
   against captured fixtures, and the API through the transport a caller actually uses. No test may
   reach the live upstream.
   *A test that has never failed is not evidence, it is a claim. The red run is the only thing that
   proves a test can detect its own subject, and skipping it has cost this project twice in one
   afternoon. In the domain, where the run was honoured, it caught `rampUp(5, 5)` returning 0 at the
   threshold — a bug in the first line of the whole scoring vocabulary. Outside the domain, where
   the old version of this principle allowed "alongside the code, weighted by risk", the API's
   not-found path passed its schema test while reaching the deployed service as a blank
   INTERNAL_SERVER_ERROR, and what found it was a curl. The risk weighting was not wrong about where
   the interesting thinking lives; it was wrong to conclude that the rest could be checked by
   attention.*

7. **Scope earns its place** — MUST build a feature beyond the literal brief only if it answers a
   question the brief itself poses (how the data is modelled, stored or refreshed) or defends the
   honesty of the ranking; everything else gets a line in `cut.md` and no code.
   *"We're not looking for volume" is a stated grading criterion. Unbuilt-and-explained beats
   built-and-unjustified.*

8. **Docs carry what code cannot, and invite rather than decree** — MUST record rationale, rejected
   alternatives, assumptions committed to in place of a product answer, and things built then torn
   out, presenting decisions together with their alternatives and naming where someone else's input
   would change the call; MUST NOT restate what the source already shows. No volume cap applies —
   only this test.
   *The brief ranks how the work happened above the service itself, and a document that paraphrases
   the code is the one artifact that reads as machine-generated. Collinson's principal engineer
   described architecture as something teams reach together, so a prescriptive document would be
   technically fine and culturally wrong.*

9. **Deterministic by construction** — MUST keep the request path a pure function of persisted facts
   and a pinned model version: no LLM in the request path, no `new Date()` inside the domain, an
   explicit total order for tied scores, rounding at one defined point, and a pinned location
   resolution. The same stored issuance plus the same model version MUST always produce an
   identical ranking.
   *Travel advice that cannot be reproduced cannot be checked or defended — and the persistence the
   brief asks for is precisely what makes reproducibility possible.*

10. **History is the narrative** — MUST commit the document that motivates a change before the
    change itself; MUST NOT push to any remote without explicit permission.
    *The submission is graded on how the work happened, and git history is the only tamper-evident
    record of that.*

11. **One change per commit, sliced vertically** — MUST keep each commit small enough that a single
    `git revert` undoes exactly one change without breaking the build, and MUST slice vertically: a
    commit carries one change through whatever layers it touches, never one layer across many
    changes. A commit message MUST name everything the commit contains, not just its most
    interesting part.
    *Reverting, monitoring progress and reading the log all depend on a commit being one thing. This
    was implicit in principle 10 as "small logical units" and that phrasing enforced nothing: commit
    `c674ef8` bundled a documentation conversion across three files with the service skeleton, and
    its message mentioned only the skeleton. Horizontal slices fail the same test from the other
    direction — a commit that finishes "the persistence layer" cannot be reverted without taking
    unrelated features with it. The plan is already organised as vertical slices; this is the same
    discipline one level down.*

12. **Exercisable by a human, not only by tests** — MUST ship every capability with a way for a
    person to run it without reading the source: example queries preloaded in GraphiQL, a named use
    case in the README for each question the service answers, and a runnable example of each failure
    and absence state. A capability reachable only from a test does not count as delivered.
    *This is a backend with no UI, so the only way anyone evaluates it is by typing a query. A
    reviewer who has to invent one will exercise the happy path and miss everything interesting,
    which here means the parts that took longest to get right: `notApplicable` against a score of
    zero, staleness after an upstream failure, and the per-factor breakdown behind a number. Passing
    tests are evidence for me. A query someone can paste is evidence for them.*

## Amendment log

- 1.0.0 (2026-07-29) — initial ratification, 10 principles
- 2.0.0 (2026-07-30) — added **One change per commit, sliced vertically** (11) and **Exercisable by
  a human, not only by tests** (12); narrowed principle 10, which had carried commit granularity in a
  clause that enforced nothing; dropped the ten-principle cap in favour of an explicit bar (from
  feature: activity-weather-ranking)
- 3.0.0 (2026-07-30) — rewrote principle 6. It used to require test-first in the domain only and let
  every other layer be tested "alongside the code, weighted by risk"; it now requires test-first
  everywhere and names the red run as part of the rule rather than as good practice around it. The
  amendment is a response to evidence from slice 1 rather than a tightening on principle: the domain,
  where the red run happened, caught a real bug with it; the API layer, where it did not, shipped a
  masked error that its own green test could not see. Decision #29 is corrected to match (from
  feature: activity-weather-ranking)
