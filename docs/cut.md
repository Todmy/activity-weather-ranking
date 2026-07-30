# Cut

Things considered and deliberately not built, with the reason. The brief asks for a focused
submission rather than an exhaustive one, so this file is where scope goes to be accounted for
instead of quietly disappearing.

Ordered roughly by how much it hurt to cut.

---

## Scope audit — the test each item had to pass

The brief says *"We're not looking for volume. A focused submission that reasons well beats an
exhaustive one."* Read naively that means "build less", which is the wrong lesson and an expensive
one: it would cut the terrain work, which is where most of the actual reasoning in this submission
lives.

What the sentence penalises is **breadth** — covering many things shallowly. What it rewards is
**depth** on few things. So the test applied to every item was: *is this a new entity, or is it depth
on something already required?* And the brief names where depth is expected, in the next sentence:
*"How you model, store, and refresh it is part of the problem."*

| Item | What it is | Verdict |
|---|---|---|
| Bitemporal issuances, `forecastHistory` | Depth on **model** — an axis the brief names | Kept |
| TTL, single-flight, stale-if-error | Depth on **refresh** — an axis the brief names | Kept |
| Terrain sampling, second weather series | Depth on skiing, which is required anyway. Without it Grenoble returns a plainly wrong answer | Kept |
| Declarative profiles, per-factor contributions | Depth on the ranking itself | Kept |
| `searchLocations`, `activityForecastAt` | Two fields, no new entity | Kept |
| Background refresher | A new runtime **process** with its own lifecycle | Kept, on an explicit judgement call |

The refresher is the only item that adds a process rather than depth, which makes it the only one
this test flags. It was kept anyway: a scheduled pull from an upstream system of record is the shape
of the problem this team actually has, and demonstrating it running was judged worth more than
describing it. It is sequenced last, after scoring calibration, so that if the schedule bites it
gives way by plan.

Recording the reasoning matters more than the verdict here. An item kept without this test would be
indistinguishable, from the outside, from an item nobody thought about.

---

## Offshore versus onshore wind for surfing

**What it is.** Wind quality for surfing depends almost entirely on direction *relative to the
coastline*. Offshore wind holds a wave face up and grooms it; onshore wind of the same speed flattens
the same swell into mush. A surf score that treats 15 km/h as a single number is wrong in both
directions half the time.

**Why it is cut.** It needs coastline orientation at the break, and nothing fetched here provides
that. Open-Meteo gives wind direction but no bearing to compare it against. Deriving orientation
from the marine grid — finding the water/land boundary by probing neighbouring cells — is a real
approach, but it is a geometry project sitting inside a weather project, and the brief's "not
looking for volume" is a stated grading criterion.

**What is done instead.** Wind speed still contributes, as a plain penalty above a threshold, and
the surf profile records that direction is missing rather than pretending speed alone captures wind
quality. A reviewer who knows surfing will spot the gap immediately; better that they find it named
than find it hidden.

**What it would take.** Coastline bearing per break — either a coastline dataset or a probe-based
derivation — plus a directional factor in the surf profile. Perhaps half a day.

## A real ski-resort dataset

**What it is.** The service assesses skiing at a high point sampled near the city. A high point is
not a ski resort: it has no lifts, no piste, no avalanche assessment, and may be a cliff.

**Why it is cut.** Closing it needs a resort dataset (OpenSkiMap, Skiresort.info or similar) — a
second data source with its own licensing, ingestion, matching and refresh story. That is a larger
problem than the one the brief poses, and it would double the ingestion surface for a service whose
graded question is how *one* upstream source is modelled, stored and refreshed.

**What is done instead.** The response names what it actually measured — elevation and distance from
the city — so "Grenoble, skiing, 78" reads as a claim about a point 45 km away at 2750 m, not about
Grenoble. The model describes *conditions where skiing would plausibly happen*, and says so.

## Multi-request terrain grids

**What it is.** The Elevation API caps a request at 100 coordinates, so terrain sampling is limited
to ~10 km spacing over a 50 km radius. Several requests per location would allow finer coverage.

**Why it is cut.** Measurement showed the extra precision is unusable: at a fixed point budget the
sampled maximum swings ~600 m depending on radius, and it is non-monotonic — a wider search returned
a *lower* maximum for Grenoble. Buying resolution the rest of the model cannot exploit converts a
one-off cost into a recurring one and improves nothing. See question 7 in `open-questions.md`.

## Backtesting the scoring model against historical conditions

**What it is.** Open-Meteo has a historical archive. The activity profiles could be run over past
weather and checked against something real — resort opening days, surf-report archives, museum
footfall.

**Why it is cut.** It is the *right* way to calibrate a scoring model, and it does not fit the
budget. It also needs ground-truth data that is not freely available for all four activities.

**What is done instead.** A hand-written sanity table defines the target before any curve is fitted,
and every threshold in a profile cites a named source. This makes the model *reviewable* — it does
not make it *validated*, and the README says so.

## A front end

Explicitly excluded by the brief. Noted only because `searchLocations` exists and looks like it
serves a UI: it is API design for an ambiguous-name flow, not a UI. Nothing renders anything.

## A linter, a formatter, and a coverage report

**Why it is cut.** Not on scope grounds — on a reading-the-history one. A formatter introduced part
way through a five-day submission rewrites files it did not author, and the resulting diff buries the
commits this project is graded on under whitespace. Style here is consistent because one person wrote
it in two days, which is exactly the situation where a formatter buys least. A coverage report is a
different case: it would have been genuinely useful and it is simply absent, which the
[review](./review.md) records as a fair thing for a reviewer to ask for and not find.

**What is done instead.** `tsc --noEmit` under `strict` plus `erasableSyntaxOnly`, run in CI on every
push, catches the class of error a linter would. Coverage is answered qualitatively: every source
file has a sibling test except five — two type-only modules, the process entry point, the production
wiring, and a test helper — and the wiring is covered indirectly by `server.test.ts`.

**When that stops being true.** The first other contributor. A formatter's whole value is removing
style from review, and there is no review yet.
