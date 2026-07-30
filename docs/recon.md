# Reconnaissance

2026-07-29. Written before any design, against [`principles.md`](./principles.md) v1.0.0.

This project is greenfield, so there was no codebase to map. The territory worth reconnoitring was
external: the Open-Meteo APIs the whole design rests on, probed live rather than read about.

## Goal

A backend service that takes a city or town and ranks how good the next 7 days will be for skiing,
surfing, outdoor sightseeing and indoor sightseeing — Node.js + TypeScript + GraphQL over
Open-Meteo, with the weather persisted rather than re-fetched on every request.

## Affected map

Greenfield: nothing exists yet, so this is the intended shape rather than a map of what is.

| Module | Role | Depended on by |
|---|---|---|
| `providers/openmeteo/` | Typed, zod-validated clients for geocoding, forecast, marine, elevation | application |
| `domain/` | Pure scoring: curves, activity profiles, confidence, applicability. Zero I/O | application, api |
| `persistence/` | Mongo repositories for locations and forecast issuances; refresh lease | application |
| `application/` | Resolve location, `ForecastGateway.ensureFresh`, assemble rankings | api, worker |
| `api/` | GraphQL schema and resolvers (Yoga + Pothos) | — |
| `worker/` | Background refresh of recently-requested locations | — |

The real reconnaissance target was external: the Open-Meteo APIs the whole design rests on. Raw
responses are saved under `probes/` and become test fixtures, so tests never hit the live API
(principle 9, and it protects the 10k/day quota during development).

## Patterns to follow

Verified against live responses, not documentation.

**Marine coverage is self-declaring.** An inland request returns HTTP 200 with `null` in every daily
array and the grid cell unchanged (Vienna: requested 48.2082/16.3738, returned 48.2083/16.3750,
all nulls). Where the model has water within reach it snaps a short distance and returns numbers
(Lisbon ~7 km, Biarritz ~6 km, Canterbury ~20 km). Milan, 110 km inland, returns nulls with the cell
unmoved — the search radius is bounded. So `daily` arrays being null IS the applicability signal.

**Terrain can be sampled in one call, within limits.** The Elevation API accepts comma-separated
coordinate lists and returns an ordered array, so a grid around a city costs one request — but the
quota is metered **per coordinate**, not per request, and a request is capped at **100 coordinates**.
Locations are immutable, so this is paid once per city, ever.

Calibrated across 16 cities (`probes/elevation-calibration-16-cities.json`), and the calibration
falsified two things this section previously asserted — see questions 7 and 8 in
`docs/open-questions.md` for the full record:

- *"The separation is large enough that no threshold tuning is needed."* False. Oslo, which skis at
  631 m, sits below Barcelona (1025 m) and Munich (1014 m), which do not. Elevation alone does not
  separate ski from non-ski in one dimension; latitude is the missing variable, and the snow
  forecast already carries it. The threshold survives only as a **cost gate at 300 m**, deliberately
  low because a false `notApplicable` is permanent while a false "applicable" costs one request.
- *A square box is a fair sample.* It is not — corners reach 70.7 km where edges reach 50 km, and
  Grenoble's maximum came from a corner. A circular mask over the same grid moves it from 3158 m at
  62.5 km to 2750 m at 45 km.

Settled config: **11×11 over a circular 50 km mask, 81 points, one request**, parameters pinned as
constants for determinism. An 11×11 lattice at 10 km spacing spans ±50 km and the inscribed circle
keeps exactly 81 of its 121 points, which is also why the config fits inside the API's 100-coordinate
cap without a second request.

The numbers above come from the calibration grids (3×3, 5×5, 9×9 squares), which is what the config
was chosen *against*. The config itself was measured separately, on 30 July, before slice 3 was
written — the calibration probes are square, and a fixture for the shipped config did not exist:

| City | Sampled max | Distance | vs the 9×9 square |
|---|---|---|---|
| Grenoble | 3204 m at 45.0088, 6.2343 | 44.7 km | 3158 m at 62.5 km — the circle finds a *higher* point *closer* |
| Amsterdam | 51 m | 51.5 km at the square's best | below the 300 m gate either way |

Grenoble is the clearest statement of the non-monotonicity: widening the sample does not improve it,
because the square's extra reach is diagonal and the mountains here are not. Saved as
`probes/elevation-grenoble-circ50-81.json` and `probes/elevation-amsterdam-circ50-81.json`, each
carrying the 81 requested coordinates alongside the response so a test can prove the pinned grid
reproduces the exact request.

**One cross-check worth having.** The forecast at Grenoble's sampled high point reports
`elevation: 3204.0`, the same figure the Elevation API gave for that coordinate
(`probes/forecast-grenoble-summit-past3.json`). Two independent endpoints agree on the terrain, so the
summit series is being fetched for the place the grid actually found.

**Units, confirmed from `daily_units`:** snowfall `cm`, precipitation `mm`, wind `km/h`, sunshine and
daylight `s`, UV index dimensionless, `weather_code` is WMO. All 16 daily variables requested came
back populated, including `cloud_cover_mean`.

**Geocoding returns** `id` (GeoNames), `name`, `admin1`, `country_code`, `latitude`, `longitude`,
`elevation`, `population`, `feature_code`, `timezone` — everything the location model needs in one
call.

## Invariants

- Never call Open-Meteo from a test; use the saved fixtures.
- Never call Open-Meteo from the request path except through the gateway (principle 3).
- Store local dates plus the location timezone; the API returns `utc_offset_seconds` and an IANA
  `timezone` when `timezone=auto`, so there is no excuse for UTC instants.
- Marine and forecast fail independently. A missing marine block is a recorded state, not a null
  score (principle 4).
- Requests over 10 variables count as more than one call against the quota; the 16-variable daily
  request is roughly 1.6 calls.
- Elevation quota is metered per **coordinate** and capped at **100 per request** — both verified by
  hitting them (429 after 575 coordinates in 15 requests; 400 on a 169-coordinate request).
- Terrain sampling parameters (11×11, circular, 50 km) are pinned constants, never tuned per
  location — the sampled maximum swings ~600 m on those parameters, so varying them would make the
  same city answer differently (principle 9).
- Open-Meteo data is CC BY 4.0 — attribution is mandatory in the README.

## Risks

**Falsified during recon — both replaced by something simpler:**

1. *Haversine applicability check.* The design assumed the Marine API silently snaps inland
   coordinates to a distant sea cell and returns plausible garbage, requiring a distance check
   against the returned cell. It does not — it returns nulls. The mechanism is deleted before it was
   ever written.
2. *Swell height separates oceans from lakes.* Chicago on Lake Michigan reports swell of 0.74 m,
   **higher** than Lisbon's 0.28 m. Height does not discriminate. Wave **period** does: Chicago
   4.60 s and Canterbury 4.65 s against Lisbon 6.90 s and Biarritz 9.15 s. Short period means
   nothing rideable, which is real surf-forecasting physics. The lake problem therefore dissolves
   into the scoring model instead of needing a special case.
   *Threshold corrected later:* the curve's zero point was first placed near 5 s from memory. The
   forecasting convention puts windswell below 8-9 s, so it belongs nearer **8 s** — which means
   Lisbon's 6.90 s day also scores near zero. The mechanism separates surfable *days*, not surfable
   *places*, and that is the stronger claim. See `sanity-table.md` source [S2].

3. *Elevation threshold separates ski from non-ski cities.* It does not — Oslo at 631 m skis,
   Barcelona at 1025 m does not. Falsified by sampling 16 cities. The threshold was demoted from a
   correctness gate to a cost gate, and the snow forecast took over the job it could not do.
4. *"The maximum elevation near a city" is a property of the geography.* At a fixed point budget it
   is a property of the **sampling parameters**: Grenoble reads 2425 m / 3204 m / 2575 m at radii of
   25 / 50 / 80 km — non-monotonic, because a wider search is a coarser one. The claim in the API
   was weakened from "the summit" to "a high point within day-trip range" as a result.

**Still live:**

5. *Scoring calibration has no ground truth and no natural stopping point.* **The only risk still
   blocking a stage.** Mitigation agreed before starting: thresholds cite a named source in the
   profile file; a hand-written sanity table per activity defines the target **before** curves are
   fitted; once it passes, the model is done.
6. *AI-generated domain thresholds sound authoritative and may be arbitrary* — the sanity table is
   written from human judgement first, precisely to invert this. Same mitigation as 5, different
   failure: 5 is "never finishes", 6 is "finishes with confident nonsense".
7. *Mongo TTL could delete the last surviving forecast issuance*, leaving stale-if-error with
   nothing to serve after a long upstream outage. TTL cannot express "keep at least one".
   Discharged in design.md.
8. *Single-flight lease shorter than the fetch it guards* would admit two fetchers. Lease TTL must
   exceed the hard request timeout. Discharged in design.md.
9. *Cold-start lease loser has no stale data to fall back on* — the first ever request for a city
   has nothing cached. Needs a bounded wait rather than an immediate error. Discharged in design.md.
10. *Geocoding order is not population order.* Cambridge returns GB (145k), Massachusetts (110k),
    Ontario (130k) — Ontario outranks Massachusetts on population but comes third. It is a relevance
    ranking, stable across back-to-back calls but not guaranteed stable across index updates.
    Pinning the resolved `geonameId` is therefore load-bearing, not belt-and-braces. Mitigation
    decided in open question 5; enforced in code at stage 5.

## Open questions

All eight are resolved. Each is recorded in `docs/open-questions.md` with the alternatives that were
rejected and the assumption committed to in place of a product answer — that file, not this one, is
the durable record, because the brief asks for it by name.

| # | Question | Resolved by |
|---|---|---|
| 1 | Rank days within an activity, or activities within a day? | Serve both; same computed data |
| 2 | Does "skiing" describe the city or the region reachable from it? | The region — assessed at a sampled high point, reported with elevation and distance |
| 3 | Does "surfing" include inland water with wave data? | No special case; wave period handles it |
| 4 | What freshness contract should the cache promise? | 1 h, matching Open-Meteo's model cadence |
| 5 | Ambiguous city names — resolve silently or let the caller choose? | Both paths, as two distinct fields |
| 6 | May the service refuse to answer? | Never; confidence and staleness are surfaced instead |
| 7 | How should terrain be sampled, at what resolution? | 11×11, circular 50 km mask, 81 points, pinned |
| 8 | What elevation threshold means "terrain exists"? | 300 m, and only as a cost gate — snow decides |

Questions 7 and 8 were raised and closed inside recon rather than carried to grill: both turned out
to be measurable, and both falsified a claim this document made in its first draft.

**Not open — cut.** Offshore versus onshore wind for surfing needs coastline orientation, which
nothing fetched here provides. Recorded with its cost in `docs/cut.md`.
