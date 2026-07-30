# Sanity table

Twenty-three scenarios with the rating band each should land in. Curves are fitted to reproduce this
table; when every row passes, the scoring model is done and no further tuning happens.

The first twenty were written **before any curve existed**, which is the order that makes them
evidence rather than description. **Skiing rows 6-8 were not**: they were added on 30 July, after an
independent review found the shipped model scoring a bare summer mountain at 35 out of 100 and
ranking it the best ski day of the week. Their bands were fixed against [S10] before the gate was
written, and the gate was then checked against them — but the honest label is *after the fact*, and
the reason they were needed is more useful than the rows themselves: **the first twenty contain no
negative case**, so the fitting procedure had no way to fail on one.

Bands: **EXCELLENT** 80-100 · **GOOD** 60-79 · **FAIR** 40-59 · **POOR** 0-39.

**Temperatures in the outdoor rows are air temperature; the outdoor profile scores *apparent*
temperature**, because the comfort scale it cites is defined over apparent. So a second translation
sits between this table and that profile, one value per row, and it is not free: outdoor rows 3 and
4 pass at their translated values and would land a band away at their air values. Each row's
apparent value and the reason it differs is stated in `outdoorSightseeing.test.ts`. Named here
because a knob nobody mentions is the thing this file exists to prevent, and it was disclosed only
in a test docstring until an independent audit went looking.

## How this table came to exist, and why that matters

The original plan was for a human to write it from intuition, precisely so that an AI could not
supply authoritative-sounding thresholds nobody is able to challenge. That plan failed on contact
with reality: the person doing the work does not ski or surf and had no intuition to offer, which is
an honest answer and a common one.

So the defence changed rather than being dropped. Every band below is justified against a
**published source that can be looked up and disagreed with**, listed at the bottom of this file.
Where no source decides and the call is a judgement, the row says so and is flagged **arguable**.

This is weaker than lived expertise in one way and stronger in another. Weaker: nobody here has
stood on a mountain and felt that −15 °C with 70 km/h gusts is unskiable. Stronger: every number can
be checked by a reader, which intuition cannot.

**The first draft of this table cited these conventions from memory, and three of the four were
wrong when checked.** The corrections are recorded in the Sources section rather than quietly
applied — a table whose numbers were verified and moved is worth more than one that was right by
luck, and the reader deserves to know which they are holding.

---

## Skiing

Assessed at the sampled high point, not the city.

**Rows 1-5 assume a base at or above the 30 cm skiable threshold [S10].** That assumption was
unspoken until rows 6-8 were added, and its being unspoken is exactly why the model scored a bare
summer mountain as rankable skiing: every row taught it that absent fresh snow is survivable,
because in every row the base was there to survive on. Rows 6-8 are the negative and boundary cases
the first twenty had none of.

| # | Conditions | Band | Basis |
|---|---|---|---|
| 1 | −4 °C, 25 cm fresh snow over 3 days, wind 10 km/h, clear | **EXCELLENT** | Cold enough to preserve fresh snow, calm, good visibility. The uncontested ideal |
| 2 | −8 °C, no snowfall for 2 weeks, gusts 45 km/h, clear | **FAIR** | Tests whether absence of fresh snow alone pulls a score down. Cold preserves the base, so the mountain is skiable hardpack; the wind is **not** the binding factor here — 45 km/h is below the 56-64 km/h at which lifts are typically held [S1]. **Arguable** against GOOD: a cold clear day on preserved groomers is a good day to many skiers |
| 3 | +2 °C, 5 cm fresh snow, turning to rain during the day | **POOR** | Rain on snow destroys the surface rather than degrading it. Above freezing plus precipitation is decisive |
| 4 | −15 °C, 40 cm fresh snow, gusts 70 km/h | **POOR** | The row that tests whether one factor can veto the others. Forty centimetres of powder is exceptional, and it is unreachable: 70 km/h is past the 56-64 km/h band where resorts hold lifts [S1], and −15 °C with that wind is roughly −28 °C of windchill. **Arguable** against FAIR |
| 5 | −2 °C, no fresh snow, a week cold and dry, sunny | **GOOD** | The classic groomed bluebird day. No powder, but a preserved base, sun and calm. **Arguable** against FAIR, depending on how heavily fresh snow is weighted |
| 6 | +14 °C, base 0 cm, no snowfall for a month | **POOR** | Added after the shipped model scored this at 35 and ranked it the best ski day of the week. The 100-day rule puts skiable cover at 30 cm [S10]; zero is not a bad day for skiing, it is the absence of skiing. The row exists because rows 1-5 all presuppose a base and none of them says so, so nothing here could ever fail on its absence |
| 7 | −2 °C, base 120 cm, no fresh snow for 10 days, sunny | **GOOD** | Row 5 with the base spoken aloud, at four times the [S10] threshold. It exists to prove the snow gate does **not** fire on a preserved base — a gate that fixes row 6 by breaking January is not a fix |
| 8 | −6 °C, base 15 cm, 3 cm fresh | **POOR** | Half the [S10] threshold, which is where rocks and stumps come through. Cold and a dusting cannot rescue what is not underneath them. **Arguable** against FAIR: 15 cm on a grassy piste skis better than 15 cm on boulders, and nothing here knows which it is |

## Surfing

Modelled for a competent general traveller rather than an expert. This assumption has real
consequences — row 3 would be EXCELLENT under an expert reading — and it is recorded in
`./decisions.md` #33 rather than buried here.

| # | Conditions | Band | Basis |
|---|---|---|---|
| 1 | Wave 1.2 m, period 14 s, wind 8 km/h | **EXCELLENT** | Fourteen seconds and above is powerful groundswell capable of quality surf at most breaks [S2], at an accessible size, with light wind |
| 2 | Wave 0.3 m, period 4.5 s, wind 15 km/h | **POOR** | Deep windswell territory. Below 8-9 s the quality is described as poor and not worth surfing [S2], and there is nothing there to ride anyway |
| 3 | Wave 2.5 m, period 15 s, wind 10 km/h | **GOOD** | Clean and powerful, and beyond most people. EXCELLENT under an expert reading; the general-traveller assumption caps it |
| 4 | Wave 1.0 m, period 7 s, wind 30 km/h | **POOR** | Rideable size and nothing else: 7 s is windswell [S2], and 30 km/h of wind makes the surface messy on top of it |
| 5 | Wave 1.0 m, period 11 s, wind 5 km/h | **EXCELLENT** | Weak groundswell [S2] at an accessible size in glassy conditions. Not the biggest day, and the best kind of day for the population being modelled |

**The period threshold moved, and it changes the model.** The first draft placed the zero point at
~5 s. The forecasting convention puts windswell below 8-9 s and groundswell at 10 s and above [S2],
so the curve reaches zero nearer **8 s**.

This does not weaken the finding from recon that period discriminates where wave height does not — it
sharpens what it discriminates. The measured probes read Chicago 4.60 s, Canterbury 4.65 s, Lisbon
6.90 s, Biarritz 9.15 s. Under the corrected threshold, Lisbon on that particular day was windswell
too, and scores near zero — correctly, because it was a flat day, not because Lisbon is not a surf
destination. Lake Michigan is fetch-limited and will essentially never exceed 8 s; the Atlantic
regularly will. The mechanism separates *surfable days* rather than *surfable places*, which is the
better thing for it to do and was not the original claim.

**Known missing factor:** wind *direction* relative to the coast. Offshore wind grooms a wave,
onshore wind of identical speed ruins it, and rows 4 and 5 treat speed alone. Cut with its reasoning
in `./cut.md`.

## Outdoor sightseeing

| # | Conditions | Band | Basis |
|---|---|---|---|
| 1 | 22 °C, sunny, wind 8 km/h, no rain | **EXCELLENT** | Comfortable walking temperature, dry, calm |
| 2 | 15 °C, overcast, dry, wind 12 km/h | **GOOD** | Entirely comfortable for walking; overcast is easier on the eyes than glare. Held below EXCELLENT because grey skies degrade the experience without degrading the conditions |
| 3 | 8 °C, rain 12 mm all day, wind 25 km/h | **POOR** | Cold, wet, and windy enough that an umbrella is useless |
| 4 | 31 °C, sunny, UV 9, still | **FAIR** | Walkable and genuinely unpleasant. UV 8-10 is "Very High" on the WHO/EPA scale, where unprotected skin burns in 10-15 minutes and the advice is to avoid midday sun outright [S3]. **Arguable** — this is an ordinary Mediterranean summer day and a case exists for GOOD |
| 5 | 3 °C, clear, still, dry | **GOOD** | Cold but crisp, dry and calm; a coat resolves it. **Arguable** against FAIR |

## Indoor sightseeing

Not the inverse of outdoor. Modelled independently as a high baseline, raised by weather that is
unpleasant but harmless, and lowered by weather that is genuinely disruptive.

| # | Conditions | Band | Basis |
|---|---|---|---|
| 1 | 8 °C, rain 12 mm all day, wind 20 km/h | **EXCELLENT** | Precisely the day a museum is the right answer |
| 2 | 22 °C, sunny, light wind | **FAIR** | Nothing prevents it; it simply feels like a waste of the day. Not POOR — the activity is fully available |
| 3 | −2 °C, snow 5 cm, wind 15 km/h | **GOOD** | Cold and snowy makes indoors appealing, and 5 cm does not stop anyone getting there |
| 4 | 12 °C, gusts 90 km/h, rain 30 mm | **POOR** | **The row that proves indoor is not the inverse of outdoor.** The weather is terrible for outdoor activity and simultaneously too dangerous to travel in. The Met Office issues yellow wind warnings for travel disruption from gusts of roughly 64-72 km/h upward [S4]; 90 km/h is well inside that. You cannot reach the museum |
| 5 | 18 °C, partly cloudy, dry | **GOOD** | Mild and unremarkable; indoors is a legitimate choice with nothing pushing either way. **Arguable** against FAIR |

---

## Sources

Each was checked rather than recalled. Three of the four moved from the value this table first
carried, and the corrections are stated so a reader can see which numbers were verified.

**[S1] Chairlift wind holds — 56-64 km/h (35-40 mph)**
Resort operations reporting: Steamboat begins slowing lifts around 35 mph; 40 mph is widely
described as the tipping point, with the exact figure depending on lift orientation relative to wind
direction. *Corrected from "40-60 km/h" in the first draft — too low, which made skiing row 2 blame
the wind for a score the absent snowfall was actually driving.*
- [Steamboat: Navigating Windy Days — Q&A with the Director of Slope Maintenance](https://blog.steamboat.com/navigating-windy-days-at-steamboat-ski-resort-a-qa-with-jake-ingle/)
- [Palisades Tahoe: Winds and lift operations](https://blog.palisadestahoe.com/operations/winds-lift-operations-squaw/)

*The shipped gate is `rampDown(56, 72)`, and **72 appears in no source**. It is fitted, and this is
the reading that makes it so: 56 is the cited lower figure verbatim, and 72 places the cited 64 at
the midpoint of the ramp — the gust at which holding is as likely as running, rather than the point
of no return. Anchoring the zero at 64 instead scores row 4 at 40 = FAIR against a table that says
POOR. Named here because a fitted number presented as a cited one is exactly what this file exists
to prevent.*

**[S2] Wave period — windswell below 8-9 s, groundswell 10 s and above, powerful swell 14 s+**
Windswell is described as poor quality and not worth surfing; 10-13 s is weak groundswell; 14 s and
above carries enough energy for quality surf at most breaks. *Corrected from "8-12 s is groundswell"
— the most consequential error in the first draft, since it placed the curve's zero point at ~5 s
instead of ~8 s and would have scored genuine windswell days as fair surf.*
- [Surfline: Groundswell vs Windswell](https://www.surfline.com/surf-news/groundswell-vs-windswell/2439)
- [Padang Padang Surf Camp: Surfer's guide to wave period](https://www.balisurfingcamp.com/blog/wave-period)

**[S3] UV index — 8-10 is "Very High"; unprotected skin burns in 10-15 minutes**
WHO/EPA global UV index scale: 0-2 low, 3-5 moderate, 6-7 high, 8-10 very high, 11+ extreme.
*Corrected from "15-25 minutes" — the category was right, the burn time was optimistic.*
- [WHO: Radiation — the ultraviolet (UV) index](https://www.who.int/news-room/questions-and-answers/item/radiation-the-ultraviolet-(uv)-index)
- [US EPA: UV Index Scale](https://www.epa.gov/sunsafety/uv-index-scale-0)

**[S5] A powder day starts at about 15 cm (6 inches) of fresh snow**
Powder Magazine polled more than a thousand skiers: the large majority put the threshold between 6
and 11 inches, roughly 15-28 cm. This is a convention among skiers rather than a physical constant,
and it is cited as such — the profile's curve reaches full marks at 20 cm, in the middle of that
band, over a three-day window rather than a single day.
- [Powder: How much new snow counts as a powder day?](https://www.powder.com/news/how-much-new-snow-counts-as-a-powder-day-poll)

**[S6] Rain on snow destroys the surface rather than degrading it**
Rain destabilises a snowpack by adding heat and load at once, and near freezing it forms an icy
crust that later snow slides off. This is why skiing row 3 is POOR rather than FAIR: it is not "wet
snow", it is a different surface.
- [Avalanche.org: Rain on snow](https://avalanche.org/avalanche-encyclopedia/snowpack/snowpack-observations/signs-of-instability-red-flags/rain-on-snow/)

**[S7] Frostbite within 30 minutes between −18 °C and −28 °C of wind chill**
The NWS wind chill chart bands time-to-frostbite on exposed skin; the 30-minute band runs from about
0 °F to −18 °F. The ski temperature curve reaches zero at −28 °C for that reason, and the plateau
starts at −18 °C.
- [NWS: Understanding wind chill](https://www.weather.gov/safety/cold-wind-chill-chart)

**[S8] Wave size for a competent general traveller — 0.6 to 1.5 m**
Surf schools put beginners at 1-3 ft and intermediates at 2-4 ft, with overhead waves reserved for
experienced surfers. The height curve plateaus over 0.6-1.5 m and reaches zero at 2.8 m, which is
well overhead. This is the curve that decision #33 (general traveller, not expert) actually cashes
out into, and it is why sanity row 3 caps at GOOD.
- [Surf Learner: the perfect wave size for beginners](https://surflearner.com/the-perfect-wave-size-for-beginner-surfers/)
- [Aotearoa Surf School: how to read surf charts](https://aotearoasurf.co.nz/how-to-read-surf-charts-by-aotearoa-surf-school/)

**[S9] Wind blows surf out above roughly 20 knots; below 10 knots it barely chops**
Under 10 knots (18 km/h) the surface stays clean; over 20 knots (37 km/h) the surf is blown out.
That is the gate on surfing, not a weighted factor, because a blown-out day is not a slightly worse
day.
- [SurfCaptain: understanding the wind condition forecast](https://surfcaptain.com/blog/1/understanding-wind-condition-forecast)

**[S10] Skiable snow cover starts at 30 cm**
The "100-day rule" — natural snow reliability requires cover of **at least 30 cm** on at least 100
days between 16 December and 15 April, in 7 winters out of 10. Proposed by Witmer (1984), developed
by Abegg (1996) and Bürki (2000), and adopted by the OECD as the reference approach for assessing
climate impact on Alpine winter tourism. It is the depth below which governments stop calling a
region skiable, which is a stronger provenance than any figure a ski shop publishes: the searches
that reached for one returned blogs and Quora, and those were rejected rather than used.

The gate anchors on it directly — `rampUp(0, 30)` — so **neither anchor is fitted**. Zero is the
physical absence of snow and 30 is the cited threshold, which is why this is the one curve in the
model with nothing to argue about except the source itself.
- [OECD (2007), *Climate Change in the European Alps: Adapting Winter Tourism*](https://www.oecd.org/content/dam/oecd/en/publications/reports/2007/01/climate-change-in-the-european-alps_g1gh7c4d/9789264031692-en.pdf)
- [Willibald et al. (2021), *Vulnerability of ski tourism towards internal climate variability and climate change in the Swiss Alps*](https://www.dora.lib4ri.ch/wsl/dload/wsl:26774/PDF/Willibald-2021-Vulnerability_of_ski_tourism_towards-(published_version).pdf) — the Witmer → Abegg → Bürki lineage
- [Spandre et al. (2019), *Winter tourism under climate change in the Pyrenees and the French Alps*, The Cryosphere](https://tc.copernicus.org/articles/13/1325/2019/)

**[S4] Wind and travel disruption — yellow warnings from roughly 64-72 km/h (40-45 mph) gusts**
Met Office yellow wind warnings cite initial impacts at 40-45 mph gusts, with 50-60 mph expected
widely in stronger events; impacts include difficult driving, downed branches and disruption on
exposed routes. *The only figure that survived the first draft unchanged.*
- [Met Office: Weather warnings guide](https://weather.metoffice.gov.uk/guides/warnings)

## The six arguable rows

Named rather than hidden, because a table presented as unanimous when it is not is the same
overconfidence the rest of the design tries to avoid.

Skiing 2, skiing 4, skiing 5, skiing 8, outdoor 4, outdoor 5, indoor 5.

Each is a case where two defensible readings exist. The band chosen is stated above with its
reasoning; a reviewer who disagrees can see exactly what they are disagreeing with, and the curve
that produces it is one constant in a profile file.

## What happens if the table cannot be satisfied

Human-written targets are not guaranteed to be mutually consistent, and neither are source-derived
ones. If no curve set passes all twenty rows, the contradiction is the interesting result: two rows
encode incompatible beliefs about how factors trade off. That goes in the worklog, and the row that
gives way is recorded with the reason.
