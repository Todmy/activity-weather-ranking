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

## To be filled in during implementation

- What the sanity table disagreed with once I fitted curves to it
- Anything I built and tore out
- Where an estimate was wrong and by how much
- The first thing that broke in deployment
