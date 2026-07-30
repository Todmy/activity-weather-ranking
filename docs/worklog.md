# Worklog

Raw. I wrote this as I went, not afterwards to make it look tidy. The brief asks to see the reasoning
and the calls I made rather than a write-up, so this is the sequence as it happened, including the
parts I got wrong.

---

## Wednesday 29 and Thursday 30 July, before any code

### The reframe

First read of the brief gives you "weather API with a scoring function", and that version takes about
ten minutes. The sentence that changes it is this one:

> "Persist it rather than calling the API on every request. How you model, store, and refresh it is
> part of the problem."

That isn't a weather exercise. It's a synchronisation exercise: staying usefully in step with an
upstream system you don't control. Which happens to be a miniature of what this team does with
Salesforce all day.

### Probing the APIs before designing against them

I didn't want to design from the documentation, so I called all four Open-Meteo endpoints live and
saved the raw responses as fixtures (`docs/probes/`, 11 files). Two
mechanisms I'd designed died in the process, both before I wrote a line of them.

**Falsification 1: the haversine applicability check.**
I'd assumed the Marine API silently snaps an inland coordinate to a distant sea cell and returns
plausible-looking garbage, so I'd need a distance check between the requested point and the grid cell
it actually used.

It doesn't. Vienna (48.2082, 16.3738) returns HTTP 200, the cell **unmoved** at 48.2083/16.3750, and
`null` in every daily array. Milan, 110 km inland, does the same. The null arrays *are* the coverage
signal. I deleted the mechanism instead of building it.

**Falsification 2: swell height separates oceans from lakes.**
Chicago sits on Lake Michigan and people surf it. I assumed swell height would tell real ocean swell
apart from lake chop.

| | wave height | wave period |
|---|---|---|
| Chicago (Lake Michigan) | 0.88 m | **4.60 s** |
| Lisbon (Atlantic) | 0.44 m | **6.90 s** |
| Biarritz (Atlantic) | 1.00 m | **9.15 s** |
| Canterbury (Channel) | 0.30 m | **4.65 s** |

Chicago's swell is *higher* than Lisbon's. Height discriminates nothing. **Period** does, and that's
real surf-forecasting physics rather than a rule I invented to keep lakes out. So there's no lake
special case at all: a period curve reaching zero below ~5 s pushes inland water to near zero because
there's nothing to ride, not because a list says so.

### The Grenoble problem

Grenoble sits at 214 m. It's also one of the best ski bases in Europe. Score the city coordinate and
the answer is "you can't ski here", which isn't a defensible thing to tell someone. Vancouver at 4 m
fails the same way with Whistler up the road.

Open-Meteo's Elevation API takes a batched coordinate list, so I can sample the terrain around a
city. Grenoble's grid maxed at 2185 m against Amsterdam's 11 m, and at that point I thought it was
solved.

### It wasn't solved: 16 cities, and the method failing its own test

Sampling 16 cities at three grid resolutions and three radii gave me three results, all
uncomfortable.

**The quota is metered per coordinate, not per request.** I got a 429 after 575 coordinates spread
over only 15 requests. My assumption that "a 25-point grid costs one API call" was simply wrong. It
costs 25. A separate 400 told me there's a hard cap of 100 coordinates in a single request.

**Elevation can't gate skiing.** Sorted by sampled maximum, Oslo (631 m, genuinely skis) lands *below*
Barcelona (1025 m), Munich (1014 m) and Prague (738 m), which don't. Latitude is the variable I was
missing: 600 m at 60°N holds snow that 1000 m at 41°N doesn't. There's no single-dimension threshold
here. So I demoted it from a correctness gate to a cost gate at 300 m and let the snow forecast do
the real work. Oslo's high point scores in January and zero in July, correctly, with no threshold
involved.

**The maximum is an artefact of the sampling, not a property of the geography.** At a fixed point
budget, radius and resolution trade off against each other, so widening the search coarsens it:

| Grenoble, 81 points | 25 km radius | 50 km | 80 km |
|---|---|---|---|
| sampled max | 2425 m | 3204 m | 2575 m |

Non-monotonic. Six hundred metres of swing on parameters I picked arbitrarily, and 600 m is roughly
4 °C of lapse rate, which is the difference between snow and rain. The square sampling box turned out
to be anisotropic too (70.7 km at the corners against 50 km at the edges), and Grenoble's maximum came
from a corner. A circular mask moved it from 3158 m at 62.5 km to 2750 m at 45 km.

The honest response wasn't to fix the number. It was to weaken the claim. The API reports *a high
point within day-trip range*, with elevation and distance attached, and the docs carry the sensitivity
figures. My defence isn't that the number is precise. It's that I measured how imprecise it is.

### The background refresher, argued twice

I designed four refresh mechanisms: 1 h TTL, single-flight lease, stale-if-error, and a scheduled
background refresher.

**First challenge, cut it.** The first three are facets of one cache-aside read and they already
answer "how do you refresh it". The fourth is a separate process with its own lifecycle. The brief
says a line explaining a cut is worth more than the thing itself.

I kept it, on the argument that a scheduled pull from an upstream system of record is the shape of
this team's actual Salesforce problem.

**Second challenge, the brief's own words**, which I spotted on a re-read: *"A focused submission that
reasons well beats an exhaustive one."* I audited every scope item against one test. Is this a new
entity, or is it depth on something the brief already names? The refresher was the only item that adds
a process rather than depth.

I kept it again, deliberately, and sequenced it last so that if the schedule bites it gives way by
plan rather than in a panic. The full audit is in `cut.md`.

I'm recording both challenges rather than just the conclusion, because a decision that survived being
attacked twice is a different artefact from one nobody questioned.

### The defence against AI-invented thresholds, and how it failed

Scoring calibration has no ground truth. Nothing tells me a given day was a 78 for skiing, so nothing
tells me when to stop tuning. Worse: an AI asked for thresholds will produce numbers that sound
authoritative (−5 °C, 20 cm, 15 km/h) and that nobody, including me, can defend.

My plan was to invert the order. A human writes a table of scenarios and expected ratings from
intuition, *before* any curve exists, and the curves get fitted to reproduce it. Human judgement sets
the target; the AI only fits to it.

That plan assumed an intuition I don't have. I don't ski and I don't surf. Asked to fill in the table,
my honest answer was that I had no basis for any of it.

So I substituted the defence rather than dropping it. Every band is now justified against something
**published and checkable**: chairlift operating wind limits, the WHO UV index scale, the standard
surf-forecasting period bands, named thermal comfort ranges. The six rows where no convention decides
are flagged as arguable, with both readings stated.

This is weaker than lived expertise in the obvious way. Nobody here has stood on a mountain in
70 km/h gusts. It's stronger in the one way that matters for a submission I'll be questioned about out
loud: a reviewer can check a convention, and can't check someone's taste.

I'm writing this down because the alternative was to quietly generate twenty numbers and present them
as though the original process had held.

### Then the replacement defence needed the same treatment

Substituting "cited convention" for "human intuition" only helps if I actually check the conventions.
The first version of the table cited four of them from memory and I never opened a source. Asked where
each number came from, my honest answer was that three of them hadn't been verified.

I checked. Three of four moved:

| | First draft, from memory | Verified | Consequence |
|---|---|---|---|
| Chairlift wind hold | 40-60 km/h | **56-64 km/h** | Skiing row 2 (45 km/h gusts) had blamed the wind for a score that absent snowfall was actually driving. Band unchanged, reasoning wrong |
| Groundswell period | 8-12 s | **windswell <8-9 s, groundswell 10 s+, powerful 14 s+** | The consequential one. The curve's zero point moves from ~5 s to ~8 s |
| UV burn time at index 9 | 15-25 min | **10-15 min** | Category was right, burn time optimistic |
| Wind travel-disruption warning | ~80 km/h | 64-72 km/h | Survived. 90 km/h was well inside either way |

The surf correction changes what the model claims. Under a 5 s zero point, Lisbon's measured 6.90 s day
scored as fair surf. Under 8 s it scores near zero, which is right, because it was a flat day. Lake
Michigan is fetch-limited and essentially never exceeds 8 s, so it reads zero all week. The Atlantic
exceeds it regularly. The mechanism separates **surfable days**, not **surfable places**. That's a
stronger claim than the one I made first, and I could only get to it by finding out the original
threshold was wrong.

One more. I'd justified the 1 h cache TTL as "matching Open-Meteo's model cadence". There's no such
single cadence. Open-Meteo's own model list shows GFS, ARPEGE, UK Met Office and KNMI updating hourly
while ECMWF and several regional models update every 3 or 6 hours, with the highest-resolution model
auto-selected per location. One hour is still the right number, but as an *upper bound*. It never
outruns the fastest model, and for a location on a 6-hourly model it over-fetches sixfold. I'm
accepting that waste explicitly instead of hiding it behind a plausible sentence.

Two rounds of the same lesson in one afternoon. The defence is never the process. It's whether anyone
actually ran it.

### The deploy target changed, for the least interesting and most reliable reason

The plan named Coolify on a Hetzner box. Coolify is a fine tool and it was the wrong choice here.
Bringing in a platform I'd be learning during a four-day deadline puts a novel failure mode on the
critical path, in exchange for convenience I don't need. Plain Docker Compose over SSH is a path I
already know works.

So it's the same `docker-compose.yml` the reviewer runs. There's a second effect worth more than the
first: production is the compose file in the repository, not a console configuration nobody else can
inspect.

**And the premise was wrong.** I'd justified this partly as "the box already exists", which turned
out not to be true. The Hetzner project I pointed at was empty, and the boxes I was thinking of live
in a different project. So I created one: a cx23 in Falkenstein, bootstrapped from
`infra/cloud-init.yaml` in this repository.

The decision survived losing its own justification, which is worth a sentence about why. "Reuse
infrastructure that already works" was the weaker of the two reasons. The stronger one is that the
host is now described by a file a reviewer can read, and it took about a minute of cloud-init to get
there. Corrected in `decisions.md` #22 rather than left standing, because a reason that stopped being
true is worse than no reason.

### Things deliberately not done

I deferred version control at the start, so every document above lands as one commit rather than a
sequence. That forfeits constitution principle 10 for this stretch, knowingly, and I've recorded the
cost in `decisions.md` #32 rather than glossing over it.

---

## Thursday 30 July, the tracer bullet

### The first factor I designed and then deleted

The sanity table says a 31 °C sunny day with UV 9 is FAIR, and it says so because of the UV. So UV
went into the outdoor profile as a weighted factor, with a curve fitted to the WHO scale: full marks
below index 6, nothing left at 11.

It broke a different row. A cold, wet, windy day has a UV index of about 1, which that curve scores
1.0, so the factor was handing a miserable day full marks for not sunburning anybody. Row 3 (8 °C,
12 mm of rain, 25 km/h wind) came out at 53, which is FAIR, and the table says POOR. Raising the UV
weight until row 4 fell to FAIR pushed row 3 further up. Lowering it until row 3 was POOR left row 4
at GOOD. The two rows were fighting over the same weight.

The threshold wasn't the problem, the arithmetic was. A weighted mean can say "this is pleasant". It
can't say "this is harmful", because a harm factor scores full marks whenever the harm is absent, and
absent is the normal case. A factor that exists to punish one kind of day spends most of its weight
rewarding every other kind.

Heat is carried by apparent temperature now, against the UTCI comfort bands, which is where a heat
penalty belongs anyway: UTCI already folds in radiation and humidity. Row 4 lands at 55 (FAIR) and row
3 at 37 (POOR). All five outdoor rows pass: 100, 75, 37, 55, 65. Decision #36 records it along with
the gap it leaves, which is that extreme UV under a cool sky is now penalised by nothing at all.

I expect to meet this again in slice 2. Skiing row 4 is 40 cm of fresh powder with 70 km/h gusts and
the table says POOR, which is a veto, and an additive model cannot veto anything. That row needs a
mechanism this profile didn't.

### The constitution changed because the slice proved it wrong

Principle 6 said test-first in the domain and "alongside the code, weighted by risk" everywhere
else. That looked like a sensible budget call when I wrote it: the scoring model is what's under
judgement, the plumbing isn't, and four days is four days.

Slice 1 ran both halves of it as an experiment I didn't plan. In the domain, where I honoured the
failing run, it caught `rampUp(5, 5)` returning 0 at its own threshold, in the first thirty lines of
the project. Outside the domain, where I wrote tests after the code, the not-found path passed its
schema test and reached the deployed service as a blank `INTERNAL_SERVER_ERROR`. A curl found it,
not the suite. Same afternoon, same person, two different disciplines, and the results split exactly
along that line.

So the rule now binds every layer, and it names the failing run as part of itself rather than as
good practice around it. A test that has never failed is a claim, not evidence.

The retrofit needed proof rather than assertion, because the tests I'd already written couldn't be
run red after the fact. I broke eight lines across the five modules outside the domain, one at a
time, and checked which suites noticed. Seven died. One lived: turning a null precipitation into 0
inside `toDailyWeather`. My null test covered the parser and stopped there, so the exact thing
principle 4 exists to prevent, "we have no rainfall figure" quietly becoming "it did not rain", had
no test on the only path that reaches a score. It has one now, and the same mutation kills it.

Eight mutations is not a coverage tool and I'm not claiming it is. It's the cheapest thing that
answers the only question worth asking about a test written after its code: would this notice?

### The scoring model, and the two things that told me it was wrong

All twenty sanity rows pass now. Two of the corrections came from places I wasn't looking.

**The table cannot catch what the table doesn't contain.** With wave height and period as equal
factors, every surfing row passed, and then I ran the recon probes through the profile out of
curiosity. Chicago on Lake Michigan scored 50. That's "fair surf" for water with 4.6 s of chop in it,
and it's the exact mistake recon was supposed to have killed: the wave is the right size and has no
energy in it. The sanity table has no lake row, so nothing in it could have told me. The fixtures
could, because they're real places.

More weight on period doesn't fix that. Row 3 needs height to carry enough to cap a clean overhead
day at GOOD, and Chicago needs period to dominate, and those pull opposite ways. So "is there swell
at all" became a gate, separate from "how good is the swell there is". Chicago drops to 7.

**A failing row found a double-count.** Indoor sightseeing scored a snowy day at 84 against a GOOD
target. The cause wasn't the weights: snowfall shows up in `precipitation_sum` as water equivalent,
so the rain factor and the snow factor were both being paid for the same snow. Reading `rain_sum`
instead fixes it honestly. Shrinking the rain weight would also have made the row pass, and would
have left the model wrong in a way no row happened to test.

I'm recording both because they're the same lesson from opposite directions. A calibration target
tells you when you're done; it doesn't tell you that the thing you're calibrating is sound.

### The veto, argued once and decided quickly

Skiing row 4 — 40 cm of powder, 70 km/h gusts, POOR — cannot be expressed as weights. To drag an
otherwise perfect day to 39 the wind needs 61% of the total, and at that weight row 2 comes out GOOD
when the table says FAIR. The two rows contradict each other under any single set of weights, which
is the useful kind of contradiction: it means the model is missing a mechanism rather than a number.

Gates multiply. `min()` would also pass both rows and would throw away magnitude, so 40 cm in a gale
and 5 cm in a gale would score identically, and the model would stop being able to rank days it had
already given up on. A hard cutoff to zero collides with principle 4, where zero already means
"applicable and bad".

Same mechanism, three uses: held lifts, blown-out surf, and a storm between you and an open museum.
That last one is the row the table calls the proof that indoor isn't the inverse of outdoor, and it
only works because the floor and the gate are separate — the museum is open, and you can't get there.

### A test that paid for itself in ten minutes

The three curve primitives are about thirty lines and I nearly wrote them without tests, on the
grounds that a linear ramp is not hard. The case I wouldn't have thought about is equal bounds:
`rampUp(5, 5)` means a step, and my first version returned 0 at exactly 5, because the lower-bound
guard ran before the upper one and for a degenerate ramp those two rules disagree. No profile uses a
step yet. Slice 2 will, because a veto is a step.

### The estimate that was wrong, and how it was caught

M3 went out and I read the plan back before starting M4 rather than after. Slice 3 says "terrain and
marine coverage computed once and written to the location", and slice 4 is where the `locations`
collection appears. So slice 3 was written against a collection that would not exist for another five
points. I did not notice this while writing the plan, because at plan-writing time "written to the
location" reads as a sentence about the data model rather than about ordering.

What made it worth catching before implementation rather than during: the Elevation API meters per
coordinate, and the grid is 81 coordinates. Without somewhere to cache the answer it is re-sampled on
every request, so 10,000 ÷ 81 is about 123 requests a day and then the service is out of quota. That
is not a slow path, it is a deployed URL that dies on the reviewer's second click.

The alternative was to run M5 before M4. I rejected it: skiing and surfing are two of the four
activities the brief names, they currently return `UnavailableActivity`, and putting a five-point
milestone in front of the three-point one that fixes them optimises the wrong thing. Also the gateway
would land before there was any geography to key it on.

So M4 grew from 3 points to 4 and carries `locations`. That is a defensible split rather than a
convenient one, because `locations` is the immutable collection — no gateway, no lease, no TTL — and
those three are what makes slice 4 a five. Recorded as decision #40, and the milestone total moved
from 40 to 41 rather than being reflowed to keep the old number looking right.

The second thing that review turned up is smaller and duller: `docs/probes/` has a city forecast and
six marine responses and no forecast at a sampled summit, which design.md has needed since it was
written. Tests may not call the live API, so that fixture has to be captured before the first test of
slice 3 exists. Ten minutes, and it would have been ten minutes of confusion in the middle of a red
run instead.

### Geography, and the fixtures that were not evidence

M4 started by reading the plan back and finding two things missing, both of the same kind: the
fixtures did not cover what the service was about to send.

The elevation probes are square grids at 3×3, 5×5 and 9×9. Those are the grids the config was chosen
*against* — the square sample is the thing recon falsified, because corners reach 70.7 km where edges
reach 50 km and Grenoble's maximum came from a corner. There was no probe for the circular config that
actually ships, and no forecast at a sampled high point at all, which design.md has needed since it
was written. No test may call the live API, so both had to be captured before the first red run.

Worth it for one number. The circular mask found Grenoble's high point at 3204 m and 44.7 km, where
the 9×9 square found 3158 m at 62.5 km. Higher and closer — the square's extra reach is diagonal and
the mountains here are not, which is the clearest statement of the non-monotonicity recon had measured
but not explained.

Then a free cross-check I did not design. The forecast at that coordinate reports `elevation: 3204.0`,
the same figure the Elevation API gave. Two independent endpoints agreeing means the summit series is
being fetched for the place the grid actually found, and I would not have known that without asking
both.

### The Promise.all that would have cost 81 coordinates

The read-through sampled terrain and marine coverage together, under one `Promise.all`. It reads
fine. It is also wrong in one direction: terrain is 81 metered coordinates and marine is one request,
so a failure in the cheap call discarded the expensive result and the next request paid for the grid
again.

I found it writing the test, not reading the code. The test I was writing was "keeps the expensive
terrain sample when the cheap marine call fails", and I wrote it because the two costs are not
comparable and it seemed worth stating. It went red immediately.

### Vienna skis

1092 m within 50 km of Vienna, so the gate opens and skiing scores 26 in August. My first reaction
was that this is a misclassification. It is not: 300 m is a cost gate, and the whole reason it sits
that low is that a false `notApplicable` is permanent and invisible while a false "applicable" costs
one request and then scores badly on its own merits. Vienna scoring 26 is the mechanism working, and
the alternative — tuning the threshold until Vienna is excluded — is how you get a number that fits
the cities you happened to test.

### A test that had never failed

Three of the schema tests for the assessment fields were written after the schema. I noticed because
they passed on the first run, which for a new capability is a warning rather than good news.

Proven by mutation instead of pretending: removing the `assessment` field kills two of them, and
swapping the `latitude` resolver for `longitude` kills the third. Both restored afterwards. The rule
is constitution 6 and it is not decoration — a test that has never failed is a claim.

### The single flight that wasn't, and the test that noticed

The concurrency test failed on its first run: two cold callers, two upstream fetches. The lease was
working exactly as designed, and that was the problem.

What happens is that the two callers do not overlap. Caller A reads "nothing stored", takes the
lease, fetches, writes, releases — all before caller B gets as far as asking for the lease. B then
acquires it cleanly, and refetches, because it is still acting on a read it took before A's write
existed. The lease serialises the fetchers without telling the second one that its question has
already been answered.

The fix is one extra document read: check again *after* winning the lease. Cheap, and obvious once
seen. What I want to record is that I would not have seen it. A test written to prove "the lease
works" would have run two genuinely simultaneous callers, passed, and shipped this. It only surfaced
because the fake upstream resolved instantly, which is the *un*realistic case — and the unrealistic
case is what exposed the assumption that concurrent callers are the only callers who race.

### Stale needs a name, not a shape

I started to model staleness as a third member of the result union, alongside the forecast and the
not-found error. It is the wrong shape. A stale forecast is structurally identical to a fresh one —
same days, same scores, same everything — and what differs is its provenance. A union member would
force every caller to write a second branch for data they would then handle identically.

So it is two fields, `stale` and `staleReason`, and the reason travels with it. The rule underneath:
serving old data unlabelled is worse than refusing, because nothing downstream can tell it apart from
current data. `NoDataYet` genuinely is a different shape and stays an error with its own code.

### An 8-second timeout that was decoration for about an hour

The design has said "hard timeout per upstream call: 8 s" since it was written, and the argument for
the 30-second lease rests on it: a lease shorter than the fetch it guards silently admits a second
fetcher. I wrote the constant into the gateway and moved on.

Then the type checker accepted `weather: fetchForecast` against a signature taking `(coordinates,
signal)`, because a function that ignores an argument is assignable to one that takes it. The cap was
a number in a module that nothing received. Threading an `AbortSignal` into `fetch` itself is both
the honest fix and the better one: a promise race abandons the promise and leaves the socket open, so
a hung upstream keeps a connection while the lease guarding it expires underneath. Two provider tests
now assert the signal reaches `fetch`.

### One unexplained failure

A full run mid-slice reported `1 failed | 258 passed` and printed no failure detail. Eight subsequent
runs — three full, five targeted at the concurrency-sensitive suites — were green. I could not
reproduce it and could not identify which test it was, so it is recorded here rather than declared
fixed. The suspicion is a stale transform immediately after a file rewrite, and the reason it is
worth writing down is that "it went away" is not a diagnosis.

**It happened again on the last day, and this time it left a fingerprint.** `1 failed | 32 passed`
files, `310 passed | 6 skipped` tests. Six skipped in a single file means a `beforeAll` threw and took
its whole file with it, and exactly one file in the repository has six tests: `server.test.ts`, whose
`beforeAll` starts a `mongod`. Four subsequent full runs were green, and CI re-ran the same suite on
the same commit and passed. So the narrowed claim is: **`mongodb-memory-server`'s startup occasionally
loses a race under load** — that run followed a `docker compose down -v` and a full image build — and
nothing in the service is implicated.

That is still not a diagnosis. The honest version of it would be a `--reporter=verbose` run captured
to a file the next time it happens, and a startup timeout raised from the default. What I did instead
was note that both occurrences were the same shape and move on, which is a judgement about the
remaining budget rather than about the bug.

I also made the mistake worth recording alongside it: the command that surfaced this was
`pnpm vitest run | grep -E "Tests " && git commit && git push`. `&&` tested `grep`'s exit code, not
vitest's, so a failing suite committed and pushed anyway. CI caught it on the far side and was green,
so the commit stands — but the guard I thought I had was checking the wrong thing, which is exactly
the class of error this project keeps finding in its own tests.

### A test that passed for the wrong reason

The history tests build three stored issuances and assert the horizon each one saw a given date at.
They passed on the first run with `[3, 3, 3]`, and that is the tell: three issuances a day apart
should not agree.

They agreed because all three were built from the same fixture, so all three carried the same seven
dates. The horizon was identical by construction, and the assertion was checking that arithmetic
works rather than that the field does. Re-dating each issuance so an older one covers an earlier
window gives `[3, 4, 5]`, and confidence falls across them — which is the property the field exists
to demonstrate.

Same class of failure as the vacuous passes in slice 3, and caught the same way: by being suspicious
of a number that is too tidy rather than by anything going red.

### The field that justifies the storage model

`forecastHistory` is the only part of the API that could not exist under an upsert per (location,
date). Everything else — the rankings, the assessment, staleness — would work identically. That
makes it the honest test of design.md §2: if replaying "what did we think on Tuesday that Friday
would be" turns out to be useless, then keeping issuances was the wrong call and this is where that
shows, rather than in an argument nobody can check.

It also forced the scoring to become a single exported function used by both the live path and the
replay. Before that, principle 9's determinism promise was a claim about two code paths staying in
step; now it is a property of there being one.

### Two tests I wrote first, and neither of them tested anything

The refresher's schedule has exactly two properties worth having. The next tick is scheduled when the
previous one finishes, so ticks cannot overlap. And `stop()` waits for the tick in flight, because
`ensureFresh` releases its lease in a `finally` and closing the database under a running tick would
throw there and strand that lease for thirty seconds.

I wrote both tests before the code, watched them go red — "module not found" — and then green. By the
letter of principle 6 that is the rule satisfied. It isn't. A red that only says the file does not
exist tells you nothing about whether any individual assertion is load-bearing, so I flipped the two
lines the tests exist for and reran: `await inFlight` deleted from `stop()`, and the `if (!stopped)`
guard forced true. Six green, both times.

Both tests were decoration, for different reasons:

- `await schedule.stop()` drains the microtask queue whether or not stop waited for anything, so the
  flag my test read had been set by the time it read it either way. It now asserts an *order* — "run
  finished" before "stopped" — against a run held open by a timer, because a promise resolved in the
  same tick cannot tell the two cases apart.
- The stop test stopped the schedule *between* runs, and `clearTimeout` covers that on its own. The
  case the guard exists for is a stop that lands mid-run, where there is no timer to clear yet and
  the run schedules the next one as it finishes. So the test now stops mid-run.

Both mutations now fail exactly one test each. It is the same lesson as `[3, 3, 3]` in the history
tests, one layer harder to see: there, the number was too tidy; here, everything was green and the
order the tests ran in was doing the work.

### The trap I nearly walked into on the way to the plan

The refresher needs a fetch plan per location, and a fetch plan needs geography. There is a function
for that already — `deps.geography`, the read-through the request path uses — and reusing it is the
obvious move.

It would have been silent and it would have been permanent. The read-through upserts, and the upsert
moves `lastRequestedAt`. Every tick would have renewed the very window it selects on: every city ever
requested stays inside the last 24 hours forever, the cutoff quietly stops meaning anything, and the
quota drains with nothing in the logs to say why. Nothing would have looked broken.

So the tick reads geography off the document it already has. The related half went the other way:
`fetchPlanFor` is now one function shared by both paths, because if they planned differently the
refresher would store an issuance with no summit series, a skier's request would find that issuance
fresh, and skiing would answer `unavailable` for an hour for no visible reason. Same shape of
argument as `scoreIssuance` in M6 — the two callers cannot diverge if there is only one of them.

---

## The two questions this file promised to answer at the end

It has said since 29 July that it would close with "anything I built and tore out" and "the first
thing that broke in deployment". Both are answerable now, and one of the answers is short in a way
worth noticing.

### What was built and torn out: nothing, after the design stage

Four mechanisms died on this project, and all four died **before** they were written:

| Mechanism | Killed by | When |
|---|---|---|
| Haversine distance to decide marine applicability | The API returns nulls inland rather than snapping to a distant sea cell | Recon, day 1 |
| Elevation as a ski test | 16-city calibration: Oslo skis at 631 m, Barcelona does not at 1025 m | Recon, day 1 |
| Single-request terrain grids at higher resolution | The sampled maximum is non-monotonic in radius, so the extra precision is unusable | Recon, day 1 |
| UV as a weighted factor | A weighted mean cannot express harm — the weight that fixed one sanity row broke another | Slice 1, while fitting |

After UV, nothing was built and then removed. Every later change was additive or a refactor under
green tests: gates were added to profiles, the read-through was split into two independent samples,
scoring was extracted into one function two callers share.

That is the return on two days of design before any code, and it is the only honest way I have to
measure it. Three of the four deaths cost a probe and an afternoon; the same three discovered during
implementation would each have cost a rewrite of something already tested and deployed. The fourth,
UV, is what that looks like — it was cheap only because slice 1 was three points of tracer bullet
rather than a finished scoring model.

The counter-reading is available too, and I would rather state it than let a reviewer supply it: two
days is a large fraction of five, and a project this size could have discovered the same four things
in a day of prototyping. What that would not have produced is the record — `open-questions.md`,
`cut.md` and the probes exist because the deaths happened somewhere they could be written down.

### The first thing that broke in deployment

A mistyped city name, on the day the tracer bullet went live. It reached the deployed URL as a blank
`INTERNAL_SERVER_ERROR` with no message, while its schema test sat green.

The cause is in "The constitution changed because the slice proved it wrong" above: Yoga masks
anything that is not a `GraphQLError`, and `graphql()` called directly does not, so a test that never
went over HTTP could not see it. A curl found it, not the suite.

It is the most useful failure in this project, and not because of the bug. It happened the same
afternoon as `rampUp(5, 5)` returning 0 at its own threshold — caught in the domain, where the
failing run was honoured — and the two results split exactly along the line the constitution had
drawn between "test-first here" and "tests alongside, weighted by risk, there". One discipline caught
its bug in thirty lines. The other shipped its bug to a public URL. That is what rewrote principle 6
to bind every layer.

Nothing has broken in deployment since. That is a weaker claim than it
sounds: deploys are `git pull` plus `docker compose up` on a host described by a file in this
repository, so there is not much surface left to break. Making the deployment boring on day one was
the point of scheduling it first.
