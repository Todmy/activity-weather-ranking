# Design questions

The agenda for stage 3. These are the high-level questions that must be settled before any code
exists, kept separate from `docs/open-questions.md` — that file records questions a **product
manager** would answer, this one records questions the **engineer** must answer.

Each carries the options, the argument that decides between them, and the recommendation. A
recommendation is not a decision; the status line says which it is.

---

## Q1+Q2 — Where does the summit weather series live? — RESOLVED: A

These arrived as two questions and turned out to be one. Open question 2 settled that skiing is
assessed at a sampled high point near the city rather than at the city itself. It did not settle how
that point and its weather are modelled.

**Status:** resolved 2026-07-30 — option A.

| | Model | Cost |
|---|---|---|
| **A** | Terrain geometry is a field on the city `Location`. One issuance document holds two weather series | Second series is nullable; two upstream calls can fail independently |
| **B** | The high point is its own `Location` with a synthetic id and a parent link | Two leases, two TTL cycles, two gateway calls to serve one query |
| **C** | No second point — adjust the city forecast by lapse rate | Invents a physical model on top of an elevation figure already known to carry ~600 m of sampling noise |

**The argument that decides it: an issuance is the unit of consistency.**

Under B, the city series and the summit series are separate documents with independent TTLs. Nothing
prevents them drifting — the city five minutes old, the summit fifty-five. A ranking then compares
indoor sightseeing from the 10:00 issuance against skiing from the 11:00 issuance. That quietly
breaks both determinism and the point of bitemporality: "one document per issuance" means the
document is a coherent snapshot, and B makes it not one.

Under A both series are fetched inside one refresh operation and written under a single `issuedAt`.
The guarantee is weak — they are still two HTTP calls milliseconds apart — but it is real, and it is
stated.

C is rejected outright: recon measured the sampled maximum swinging ~600 m on arbitrary parameters,
and a lapse-rate model would compound that error rather than avoid it. It also discards the actual
thing being measured — real forecast snowfall at altitude — in favour of a computed one.

**Decided: A.** Terrain geometry becomes an immutable field on the city `Location`, computed once
from the elevation grid; the issuance document carries a city series and an optional summit series,
both written under one `issuedAt`.

The cost accepted alongside it: the summit series is nullable for two different reasons — no terrain
here, and terrain here but the fetch failed — which the type must keep apart. See the three states
below.

### Consequence: absence has three states, not two

Constitution principle 4 distinguishes "not applicable here" from "applicable but poor". A second
weather series that can fail on its own introduces a third:

| State | Meaning | Example |
|---|---|---|
| `notApplicable` | No terrain or no ocean here at all | Surfing in Vienna |
| `unavailable` | Applicable, but we do not have the data | Summit forecast fetch failed |
| score `0` | Applicable, data present, conditions are bad | Skiing in Innsbruck in July |

Collapsing `unavailable` into either of the others is the same dishonesty principle 4 exists to
prevent, one level down. This likely earns a principle-4 amendment at stage 7 (krukit-rules close),
where the constitution allows exactly one.

---

## Q3 — Build the background refresher, or cut it? — RESOLVED: build it

Challenged twice, survived twice. Full record in `flow-state.md` gate evidence; scope reasoning in
`cut.md` under "Scope audit". Sequenced last, after scoring calibration, because it is additive
rather than structural.

---

## Q4 — What does `modelVersion` cover? — RESOLVED

**Why it matters.** Principle 9 promises that the same stored issuance plus the same model version
always produces an identical ranking. That promise is only as good as the version's coverage. If
something outside it can change a score, the version is decoration.

**Status:** resolved 2026-07-30 — semver, enforced by a snapshot test.

**Options.**

- *Profiles only* — weights and thresholds. Treats curves, the confidence model, tie-break order and
  rounding as infrastructure. Rejected: every one of those can change a returned number, so the
  promise would be false.
- *A content hash of the whole scoring config.* Cannot be forgotten, which is its whole appeal. But
  `3f2a1b` versus `3f2a1c` tells a reviewer nothing, and the version appears in every response.
- *Hand-maintained semver over everything that can change a score* — curves, profiles, confidence,
  tie-break order, rounding point. Readable, but only as reliable as the person remembering to bump
  it.

**Decided: semver, with the hash used as an enforcement mechanism rather than as the version.**
A snapshot test serialises the entire domain configuration and fails when it changes without a
version bump. That buys the readable version and removes the reliance on memory — the test is the
thing that cannot forget.

**Also settled by the same argument:** the version is global, not per-activity. The profiles ship
together, and a response carrying four different version numbers invites the question of what a
cross-activity comparison then means.

---

## Q5 — The scoring sanity tables — RESOLVED, but not as designed

**Status:** resolved 2026-07-30. The table exists at
[`sanity-table.md`](./sanity-table.md) — twenty rows, every band justified against a published
convention rather than intuition, six rows flagged as genuinely arguable.

**The original plan failed, and the failure is the interesting part.** The design below called for
human intuition to set the targets before any curve existed, specifically so an AI could not supply
authoritative-sounding numbers. That defence assumed an intuition that turned out not to exist —
nobody on this project skis or surfs.

Dropping the defence would have been the easy move. Instead it was substituted: bands are now
justified against lift-closure wind speeds, the WHO UV index, surf-forecasting period bands, and
named comfort ranges. That is weaker than lived expertise in the obvious way and stronger in one
that matters more here — a reader can check a convention, and cannot check someone's taste.

The original reasoning is kept below rather than rewritten, because a defence that had to be
replaced is more informative than one that was never tested.

Three to five scenarios per activity, each a set of conditions and the rating band it should land
in, written **before** any curve exists. Curves are then fitted to pass the table; once it is green,
the model is done.

The order is inverted on purpose. Risks 5 and 6 in `context.md` are two failure modes of the same
gap — calibration has no ground truth, so it has no natural stopping point, and an AI asked to
supply thresholds will produce authoritative-sounding numbers nobody can challenge. Human judgement
setting the target first fixes both: it bounds the work and it makes the numbers arguable.

Surfing is exempt — its thresholds come from surf-forecasting convention and are cited to a named
source rather than to intuition.

---

## Not a design question, still blocking: version control

No git repository exists. Every document written so far will land as a single commit whenever one is
initialised, which forfeits principle 10 — history as the narrative — for everything up to that
point. The submission is graded first on how the work happened, and git history is the only
tamper-evident record of it.

Deferred at the user's explicit instruction on 2026-07-29 so that the clock on "time since repo
creation" would not start early. The cost is one-directional: it only grows.
