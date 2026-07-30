# Open questions and the assumptions committed to them

The brief asks that where a question would normally go to a product manager, the question is
recorded along with the assumption taken instead. This file is that record.

Resolved entries keep the alternatives that were rejected — a decision without its discarded
options is not reviewable.

---

## 1. Which axis is the ranking? — RESOLVED

**Question.** "Ranks how good the next 7 days will be for each of these activities" reads two ways:
days ranked within an activity, or activities ranked within a day.

**Rejected.** Picking one reading and hoping it was the intended one.

**Assumption taken.** Serve both from a single response. Days-within-activity is treated as the
primary reading because it follows the sentence literally; activities-within-day comes from the same
computed data and costs one extra resolver, so guessing wrong carries no penalty.

## 2. Does "skiing" describe the city, or the region reachable from it? — RESOLVED

**Question.** Grenoble sits at 214 m with 2185 m of terrain within ~40 km. Scoring the city
coordinate says Grenoble cannot ski, which is plainly wrong. Vancouver (4 m, Whistler nearby) fails
the same way.

**Rejected.**
- *City coordinate only.* Honest and narrow, but produces answers a traveller would call broken.
- *Terrain decides applicability, city weather decides conditions.* Internally inconsistent: +5 °C
  and rain in the valley can be −3 °C and snow at 2000 m. This would have been the worst of the
  three — plausible-looking output built on mismatched inputs.

**Assumption taken.** Both applicability and conditions come from the highest sampled point near the
city. Open-Meteo's Elevation API accepts a batched coordinate list, so a grid around the city costs
one request and, since locations are immutable, is paid once ever. Where terrain exists, a second
forecast is fetched at that high point; where it does not (Amsterdam's grid maxes at 11 m), skiing
is `notApplicable` and no second fetch happens.

**Consequence that must not be hidden.** The response carries the point the ski assessment was made
at — elevation and distance from the city centre. A score of 78 for Grenoble means nothing unless
the caller knows it describes 2185 m, 18 km away. Reporting it as if it described the city would be
the kind of quiet dishonesty principle 5 exists to prevent.

**Still unresolved underneath.** A high point is not a ski resort. It has no lifts, no piste, no
avalanche assessment. This models *conditions where skiing would plausibly happen*, not *a skiable
resort*. Closing that gap needs a resort dataset, which is out of scope here — see `cut.md`.

## 3. Does "surfing" include inland water that has wave data? — RESOLVED

**Question.** Chicago on Lake Michigan returns real wave data from the marine model, and people do
surf it.

**Rejected.** Explicitly excluding non-ocean water. It would mean writing a special case and
defending a list.

**Assumption taken.** No special case. Applicability is simply whether the marine model has data.
Quality is handled by physics: wave period separates rideable groundswell from local wind chop.
Surf-forecasting convention puts windswell below 8-9 s and groundswell at 10 s and above
([Surfline](https://www.surfline.com/surf-news/groundswell-vs-windswell/2439)), so the period curve
reaches zero near 8 s.

Measured probes: Chicago 4.60 s, Canterbury 4.65 s, Lisbon 6.90 s, Biarritz 9.15 s. Note that under
this threshold **Lisbon also scores near zero on that day** — correctly, because it was a flat day,
not because Lisbon is not a surf destination.

That is the sharper version of the claim, and it is not the one made first. The mechanism separates
**surfable days**, not surfable places. Lake Michigan is fetch-limited and will essentially never
exceed 8 s, so it scores zero every day of the week; the Atlantic will exceed it regularly. The
exclusion is emergent rather than encoded, which was the goal, but the original wording overstated
what a single measurement showed.

*Correction recorded:* the first draft placed the curve's zero point near 5 s, from memory rather
than from a source. That would have scored genuine windswell as fair surf. See `sanity-table.md`,
source [S2].

## 4. What freshness contract should the cache promise? — RESOLVED

**Question.** The brief requires persistence but states no staleness requirement.

**Rejected.** A longer window (3–6 h) purely to reduce upstream traffic. Traffic is not the binding
constraint at this scale.

**Assumption taken.** One hour, matched to the **fastest** models Open-Meteo serves rather than
picked round. Per [Open-Meteo's model list](https://open-meteo.com/en/docs), NOAA GFS, Météo-France
ARPEGE, UK Met Office and KNMI Harmonie all update hourly; ECMWF IFS and several regional models
update every 3 or 6 hours, and Open-Meteo automatically selects the highest-resolution model
available for each location.

So one hour is an upper bound on usefulness: it never fetches faster than new data can exist
anywhere, and for a location served by a 6-hourly model it over-fetches roughly sixfold. That waste
is accepted rather than overlooked. The alternative — deriving a per-location TTL from whichever
model serves it — means pinning the model per location and giving up the automatic
highest-resolution selection, which costs accuracy to save quota that is not scarce.

*Correction recorded:* the first draft justified this as "matching Open-Meteo's model cadence",
which is not a single number and was asserted without checking.

## 5. Ambiguous city names — resolve silently or make the caller choose? — RESOLVED

**Question.** "Cambridge" returns five results, and the ordering is not by population: England
(145k), Massachusetts (110k), Ontario (130k). It is a relevance ranking, stable between back-to-back
calls but not guaranteed stable across index updates.

**Rejected.**
- *Return an error listing candidates until the caller is specific.* Punishes the common case, where
  one obvious answer exists.
- *Pick the largest by population.* Sounds principled, matches intent less often than relevance does.

**Assumption taken.** Two entry points. `activityForecast(query:)` resolves the top-ranked match and
always returns the resolved location, so a substitution is never silent. `searchLocations(query:)`
returns candidates with everything needed to render a chooser, and `activityForecastAt(locationId:)`
accepts the pinned result. Once a query string has resolved to a GeoNames id, that binding is
persisted, so a change in upstream ranking cannot silently change our answer.

*This is API design, not frontend work.* The brief forbids building a front end; it does not forbid
designing an API that one could consume. No UI is built here.

## 6. May the service refuse to answer? — RESOLVED

**Question.** When data is stale or the horizon is long enough that a ranking misleads, is refusing
better than answering?

**Rejected.** A quality floor below which the service errors. It invents a state the caller cannot
act on — "try again later" is not advice.

**Assumption taken.** Always answer. Confidence decays with horizon, staleness is flagged, partial
upstream failures are named in the response. The caller decides what is good enough, which is the
only party that can.

---

## 7. How should terrain be sampled, and at what resolution? — RESOLVED

Settled by measurement, not argument: 16 cities sampled at 3×3, 5×5 and 9×9 over the same ±50 km
box, then re-sampled at 25/50/80 km radius. Raw data in
`docs/probes/elevation-calibration-16-cities.json`.

**What the measurement showed.**

- The Elevation API bills **per coordinate**, not per request, and caps a request at **100
  coordinates**. "A 25-point grid costs one call" was wrong. This bounds the design to ≤100 points
  per location.
- A square box is anisotropic — its corners reach 70.7 km while its edges reach 50 km — and the
  bias is not cosmetic. Grenoble's maximum came from a corner at 62.5 km (3158 m); with a circular
  mask over the same grid it drops to 2750 m at 45 km.
- At a fixed point budget, **radius and resolution trade against each other**, so the maximum is
  **non-monotonic in radius**: Grenoble reads 2425 m at 25 km, 3204 m at 50 km, and back down to
  2575 m at 80 km, because widening the search coarsens the step from 5 km to 16 km and steps over
  the peak it previously found.

**What that means, stated plainly.** At ~10 km spacing against alpine features 1–5 km wide, this
method samples valleys as often as ridges. The number it returns is **a high point within range, not
the highest point**, and it moves by up to 600 m on parameters chosen arbitrarily. Six hundred metres
is roughly 4 °C of lapse rate — the difference between snow and rain. The noise is therefore
decision-relevant and must not be presented as a measurement.

**Rejected.**
- *Multi-request grids for finer coverage.* Buys precision the rest of the model cannot use, and
  turns a one-off cost into a real one.
- *Reporting the sampled maximum as "the summit".* It is not, and 600 m of sampling noise makes the
  claim indefensible.

**Assumption taken.** 11×11 over a **circular** 50 km mask, 81 points, one request, paid once per
location. Parameters are pinned constants so the same city always yields the same point
(principle 9). The API reports it as *a high point within day-trip range*, with elevation and
distance attached, and the docs carry the sensitivity numbers above. The honest defence is not that
the number is precise — it is that its imprecision is measured and disclosed (principle 5).

## 8. What elevation threshold means "terrain exists"? — RESOLVED

**Question.** Below what sampled maximum should skiing be `notApplicable` rather than scored?

**What the measurement showed.** Elevation alone does not separate ski from non-ski cities. Sorted
by 9×9 maximum, Oslo (631 m) — which genuinely skis — sits *below* Barcelona (1025 m), Munich
(1014 m) and Prague (738 m). At 60 °N, 600 m holds snow that 1000 m at 41 °N does not. Any threshold
tuned to exclude Barcelona also excludes Oslo.

**Rejected.**
- *A threshold calibrated to separate ski from non-ski cities.* The data shows no such threshold
  exists in one dimension.
- *Adding latitude as a second gate.* Reinventing a snow model badly, when an actual snow forecast
  is already being fetched.

**Assumption taken.** The threshold stops being a correctness gate and becomes a **cost gate**.
Snow does the real work: Oslo's high point scores well in January and zero in July; Barcelona's
rarely sees snow and scores near zero year-round — both correct, with no threshold involved. The
two errors are asymmetric: a false `notApplicable` is a permanent wrong answer, since no forecast is
ever fetched to correct it, while a false "applicable" costs one request and still returns zero. So
the threshold is set **low — 300 m**, with margin under Oslo's worst-case 576 m and above Warsaw's
worst-case 201 m across every configuration tested.

---

## Still open

- **Offshore versus onshore wind for surfing.** Wind quality depends on direction relative to coast
  orientation, which is not derivable from anything fetched here. Moved to `cut.md` — not open, cut.
