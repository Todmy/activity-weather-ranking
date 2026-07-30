# Constitution: activity-weather-ranking

Version: 1.0.0 | Ratified: 2026-07-29

The short list of principles every design in this project is checked against (krukit stage 3) and
re-checked in code against (stage 6). Ten is the cap — if an eleventh ever earns a place, one of
these has to lose it.

These are commitments, not received wisdom. Each one exists because it would have changed a
decision in this project, and each is meant to be argued with. Where a principle turned out to be
the wrong call, that belongs in the worklog, not quietly dropped here.

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

6. **Test-first where the thinking is** — MUST write tests before code for the pure domain layer
   (curves, profiles, scoring, confidence), including boundary and out-of-range values; other
   layers get integration tests written alongside the code, weighted by risk.
   *The scoring model is the part under judgement; the plumbing is not, and a 3-4 day budget should
   be spent accordingly.*

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

10. **History is the narrative** — MUST commit in small logical units, with the document that
    motivates a change committed before the change itself; MUST NOT push to any remote without
    explicit permission.
    *The submission is graded on how the work happened, and git history is the only tamper-evident
    record of that.*

## Amendment log

- 1.0.0 (2026-07-29) — initial ratification
