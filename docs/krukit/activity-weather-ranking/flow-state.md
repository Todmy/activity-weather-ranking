# Krukit Flow: activity-weather-ranking

Started: 2026-07-29 | Route: full
Task: Backend service that takes a city/town and ranks how good the next 7 days will be for skiing, surfing, outdoor sightseeing and indoor sightseeing — Node.js + TypeScript + GraphQL over Open-Meteo, with the weather data persisted rather than re-fetched per request. Collinson Group Senior/Lead Engineer take-home.

- [x] 1 recon — done 2026-07-29, artifact: context.md
- [x] 2 grill — done 2026-07-30, artifacts: open-questions.md (8 resolved), design-questions.md (4 resolved), cut.md
- [x] 3 design — done 2026-07-30, artifact: design.md
- [x] 4 plan — done 2026-07-30, artifact: plan.md
- [ ] 5 act
- [ ] 6 verify
- [ ] 7 review

## Notes

- 2026-07-29, late: recon reopened briefly to close its own leftovers. The two calibration questions
  it had deferred ("still open") turned out to be measurable, so they were measured rather than
  carried into grill — 16 cities, three grid resolutions, three radii. Both falsified a claim recon
  had made in its first draft; see risks 3 and 4 in context.md and questions 7-8 in
  open-questions.md. Offshore wind was cut rather than resolved (`docs/cut.md`).
- Everything that can be closed without the user is now closed. The single remaining blocker is the
  hand-written sanity table (risks 5 and 6), which is deliberately his to write — inverting the
  order so human judgement sets the target before any curve is fitted.

- Target submission: Monday 2026-08-03 (brief allows 5 working days from Wed 2026-07-29; strict
  reading due Tue 4 Aug, lenient Wed 5 Aug — aiming a day inside both).
- Version control deliberately deferred at the user's instruction: no local git, no GitHub repo yet.
  Artifacts are written to the working tree only. Flagged cost: principle 10 (history is the
  narrative) cannot be honoured retroactively — whenever versioning starts, everything written
  before that point lands as a single commit rather than a sequence.

## Critical path

Six blocks, ordered by how much of the remaining schedule each one determines. A, B and C were
identified before any work started, on the reasoning that the blocks worth doing first are the ones
whose outcome changes what the others have to be.

| | Block | Status | Why it sits where it does |
|---|---|---|---|
| A | Verify the Open-Meteo contract | **Closed** | Highest rework risk: every downstream decision rests on how these APIs actually behave. Probing them first falsified two designed mechanisms before either was written |
| B | Geography model — terrain, ocean coverage | **Closed** | Decides whether skiing and surfing are answerable at all, and falsified the elevation threshold |
| C | Scoring calibration | **Open — the only schedule risk** | No ground truth and no natural stopping point. Bounded by the sanity table, which is written first |
| D | Persistence and the refresh gateway | Not started | Predictable. Shape is settled; the work is mechanical |
| E | GraphQL surface | Not started | Predictable |
| F | Deploy | Not started | Predictable, but scheduled **early** rather than last — a deployment discovered on the final day is a deployment that fails on the final day |

Everything after C is predictable work. That is the point of the ordering: the unpredictable blocks
run first, while there is still schedule left to absorb what they turn up.

## Schedule

Target submission Monday 2026-08-03; the brief's five working days from Wednesday 2026-07-29 put the
strict deadline at Tuesday 4 August. Aiming a day inside it.

- Thursday — sanity table, design.md, first commit, tracer bullet deployed
- Friday — scoring domain under TDD, persistence and gateway
- Saturday/Sunday — buffer, background refresher, README and worklog
- Monday — submit

Estimates assume AI-compressed development, which is not uniform: 5-20× on mechanical and named-
pattern work, 2-4× on debugging, and roughly 1× on external API round trips, decisions without
ground truth, and reviewing generated code. Block C is almost entirely the 1× kind, which is the
second reason it carries the schedule risk.

## Gate evidence

> "full — всі 7 стадій krukit (рекомендую)" — 2026-07-29 (Stage 0 route)
> "TDD обов'язковий у домені, решта за ризиком" — 2026-07-29 (constitution setup, Testing)
> "Має відповідати на питання самого брифу" — 2026-07-29 (constitution setup, Scope)
> "Добре, поки все запиши в папку, але не коміт нічого" — 2026-07-29 (constitution 1.0.0 approved,
> committing deferred)
> "тоді точно (a). Часу вистачить" — 2026-07-29 (background refresher: build it, do not cut)
> "Фоновий рефрешер - я думаю це теж потрібно" — 2026-07-30 (reaffirmed after the scope audit below)

The refresher was challenged twice and survived both. First against the cut case — TTL, single-flight
and stale-if-error already answer "how do you refresh", so a fourth mechanism is a fourth answer to a
settled question. Then against the brief's own line, "a focused submission that reasons well beats an
exhaustive one", which the user raised himself: an audit of every scope item found the refresher to be
the only one adding a *process* rather than depth on an axis the brief names. It stays on the
judgement that a scheduled pull from an upstream system of record is the shape of Collinson's actual
Salesforce problem, and that showing it running is worth more than describing it.

Sequencing that protects the rest of the work: the refresher is additive — same gateway, same lease, no
schema or API change — so it is built last, after scoring calibration. If the schedule bites, it gives
way by plan rather than in a panic.
