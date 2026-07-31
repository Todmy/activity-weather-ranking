# Activity weather ranking

**Give it a city. It ranks the next seven days for skiing, surfing, outdoor sightseeing and indoor
sightseeing — and it can show you the weather behind every number.**

[![CI](https://github.com/Todmy/activity-weather-ranking/actions/workflows/ci.yml/badge.svg)](https://github.com/Todmy/activity-weather-ranking/actions/workflows/ci.yml)
[![Live](https://img.shields.io/badge/live-2.28.24.132%3A4000-2ea44f)](http://2.28.24.132:4000/graphql)
[![Node](https://img.shields.io/badge/node-24-333)](https://nodejs.org)
[![Licence](https://img.shields.io/badge/code-MIT-blue)](LICENSE)
[![Data](https://img.shields.io/badge/data-CC%20BY%204.0-blue)](https://open-meteo.com/)

Node.js · TypeScript · GraphQL (Yoga + Pothos) · MongoDB · [Open-Meteo](https://open-meteo.com/)

**[Try it live](#try-it-now)** · **[Run it yourself](#run-it-yourself)** · **[How it works](#how-it-works)** ·
**[The reasoning](docs/decisions.md)** · **[The schema](docs/schema.graphql)**

---

## What this is

First read of the brief gives you "weather API with a scoring function", and that version takes about
ten minutes. The sentence that changes it is this one:

> "Persist it rather than calling the API on every request. How you model, store, and refresh it is
> part of the problem."

That is not a weather exercise. It is a **synchronisation exercise** — staying usefully in step with
an upstream system you do not control, which is the same problem shape as keeping a service in step
with Salesforce.

So the weather is stored rather than re-fetched, geography is measured rather than looked up, and
every score can be taken apart into the numbers that produced it. The parts that took longest to get
right are the ones a happy-path query never reaches, which is why [twelve of them have a link you can
click](#runnable-examples).

## Try it now

Nothing to install. The deployed instance is answering:

```bash
curl -s http://2.28.24.132:4000/graphql -H 'content-type: application/json' \
  -d '{"query":"{ activityForecast(query: \"Innsbruck\") { location { name } rankings { activity days { date score band } reason } } }"}'
```

Or open **`http://2.28.24.132:4000/graphql`** for GraphiQL, which loads with all twelve example
queries already in the editor — pick one from the operation dropdown and press play.

## If you only have ten minutes

The five things worth your attention, and where each is argued in full.

| Look at | Why it is the interesting part | Where |
|---|---|---|
| **Geography is measured, never enumerated** | There is no list of cities anywhere. Amsterdam is `notApplicable` for skiing because its sampled grid maxes at 38 m, not because a rule names it | [decision #34](docs/decisions.md), [design §1](docs/design.md) |
| **The sanity table was written before any curve** | Twenty-three scenarios with the band each must land in, every band cited to a published source, seven flagged as arguable | [`sanity-table.md`](docs/sanity-table.md) |
| **Issuances are kept, not upserted** | One document per fetch, so "what did we think on Tuesday that Friday would be" survives. `forecastHistory` is the only field that needs it | [design §2](docs/design.md), [example 11](#runnable-examples) |
| **Absence has three states** | "No ocean here", "the fetch failed" and "conditions are bad" are three different claims, kept apart in the domain and in the schema | [principle 4](docs/principles.md), [example 7](#runnable-examples) |
| **The numbers are honest about themselves** | Terrain sampling swings ~600 m on the parameters chosen, and the docs carry that figure rather than presenting a measurement | [open question 7](docs/open-questions.md) |

An independent review of this repository is in [`review.md`](docs/review.md) — including the two
critical bugs it found, and what the outside reader said about the submission.

## How it works

### The shape

```mermaid
flowchart LR
  Caller([caller]) --> API["api/<br/>Yoga + Pothos"]
  API --> APP["application/<br/>resolve · assemble"]
  APP --> DOM["domain/<br/>curves · profiles · confidence<br/>zero I/O"]
  APP --> GW["ForecastGateway<br/>1 h TTL · single-flight lease<br/>stale-if-error"]
  REF["refresher<br/>every 10 min"] --> GW
  GW --> DB[("MongoDB<br/>locations · forecasts<br/>resolutions · leases")]
  GW --> PROV["providers/openmeteo/<br/>geocoding · forecast<br/>marine · elevation"]
  PROV --> OM([Open-Meteo])
```

One boundary is load-bearing and the rest follow from it: **`domain/` may not import anything that
performs I/O.** No clock, no database, no fetch. That is what makes the determinism claim in
[design §6](docs/design.md) checkable rather than aspirational.

### Geography is measured, not looked up

Terrain comes from **81 elevation samples on a circular 50 km mask** around the city, paid once per
city and then kept forever. Ocean coverage comes from whether the wave model returns data at that
coordinate. There is no list of cities anywhere, so a city nobody anticipated gets the same treatment
as one that was tested.

That is what makes skiing answerable. Grenoble reports its city elevation as **218 m** and its ski
scores as belonging to a point at **3354 m, 44.7 km away** — scoring the city coordinate would answer
confidently about a place nobody skis, for exactly the cities a traveller would ask about. Amsterdam
samples 38 m and answers `notApplicable/noTerrain`, which is deliberately not a score of zero.

> **Why the summit figure moves.** The captured probe in [`docs/probes/`](docs/probes/) reads 3204 m
> for that same coordinate and the same `gridVersion`. Terrain is sampled once and kept, so the
> deployed box reports what Open-Meteo said on the day it asked, and a fixture reports what it said on
> the day it was captured. Both numbers are real; neither is a typo. This is the one place in the
> repository where a figure legitimately depends on when it was taken, so it is named here rather than
> quietly reconciled.

### Weather is stored, not re-fetched

Each fetch is written as one **issuance** — city, summit and wave series together, because they are
one unit of consistency. Reads go through a gateway with three facets of a single cache-aside read:

- a **one-hour freshness window**, matched to the fastest model Open-Meteo serves;
- a **single-flight lease**, so a hundred simultaneous misses cause one upstream call;
- **stale-if-error**, so an outage degrades the answer instead of removing it.

Issuances are kept rather than upserted, so "what did we think on Tuesday that Friday would be"
survives — and `forecastHistory(locationId:, date:)` is the field that makes that visible. Nothing
else in the API needs issuances to be kept; this does.

You can see all of it from outside. Run [`HowFreshIsThisAnswer`](#runnable-examples) twice inside an
hour and `issuedAt` does not move. On the deployed URL, two concurrent requests for a city the service
had never seen, plus a third immediately after, returned one identical `issuedAt` and left exactly one
document in `forecasts`.

### A score you can take apart

Scoring is **declarative data, never branching code**: weighted factors over three curve primitives,
with multiplicative gates for the cases a weighted mean cannot express. There is no `if (temp > 25)`
anywhere in the domain.

```
score = round(100 × (floor + (1 − floor) × weightedMean) × Π gate)
```

Every scored activity returns its `factors` with `rawValue`, `curveValue` and `contribution`, plus its
`gates` with a multiplier — so a score of 9 on a powder day reads as `liftsHeld: 0.125` rather than as
an unexplained collapse. Every threshold cites a named source, and where an anchor is a *reading* of a
source rather than a number the source prints, [`requirements.md`](docs/requirements.md) says which of
the nineteen are which.

### An ambiguous name gets two answers, never a guess

`activityForecast(query: "Cambridge")` picks one and names the other four.
`searchLocations(query: "Cambridge")` picks none and returns all five with the population upstream
ranked them by, and any of those ids goes straight into `activityForecastAt(locationId:)` — which
forecasts exactly that place and does not re-resolve it. Once a query string has resolved, the binding
is pinned, so a change in upstream ranking cannot silently change what this service answers.

### Kept warm without being asked

A tick every ten minutes takes the locations requested in the last 24 hours and refreshes the ones
past their hour, through the same gateway and the same lease a request uses — so the first traveller
after an hour usually does not pay for the fetch. A city that has only ever been *searched* is never
fetched for. [Watch it happen in fifteen seconds](#watch-the-refresher).

## Runnable examples

Every capability has a query you can run without writing one. That is a rule this project holds itself
to ([principle 12](docs/principles.md)): a backend has no UI, so a reviewer who has to invent a query
only ever sees the happy path, and never the ways this service refuses.

Each link opens GraphiQL with the query already in the editor. Press the pink play button, then read
what comes back against the third column. No GraphQL needed, and nothing to install.

- **Run it on the live service** needs nothing at all. It is the deployed instance, answering now.
- **Run it locally** is for someone onboarding. Start the service first — [`docker compose
  up`](#run-it-yourself) — then use that column.

<!-- examples:start -->

| # | What you are checking | What a pass looks like | Run it locally | Run it on the live service |
|---|---|---|---|---|
| 1 | **BestDaysPerActivity** — The next seven days ranked, best first, for each of the four activities | Four activities. Skiing and the two sightseeings have seven dated rows each; surfing has none and a reason of noMarineCoverage, because Innsbruck is landlocked | [open](http://localhost:4000/graphql?query=%23%201.%20Best%20days%20for%20each%20activity.%20One%20of%20the%20two%20readings%20of%20%22ranks%20the%20next%0A%23%20%20%20%20seven%20days%22%3B%20days%20an%20activity%20cannot%20be%20scored%20on%20are%20left%20out%2C%20and%0A%23%20%20%20%20%60reason%60%20says%20why%20the%20list%20is%20empty%20when%20one%20answer%20covers%20the%20week%20%E2%80%94%0A%23%20%20%20%20Innsbruck%20has%20no%20coast%2C%20so%20surfing%20comes%20back%20empty%20and%20says%20so.%0Aquery%20BestDaysPerActivity%20%7B%0A%20%20activityForecast(query%3A%20%22Innsbruck%22)%20%7B%0A%20%20%20%20location%20%7B%20name%20country%20admin1%20%7D%0A%20%20%20%20modelVersion%0A%20%20%20%20issuedAt%0A%20%20%20%20rankings%20%7B%0A%20%20%20%20%20%20activity%0A%20%20%20%20%20%20days%20%7B%20date%20score%20band%20confidence%20%7D%0A%20%20%20%20%20%20reason%0A%20%20%20%20%7D%0A%20%20%7D%0A%7D) | [open](http://2.28.24.132:4000/graphql?query=%23%201.%20Best%20days%20for%20each%20activity.%20One%20of%20the%20two%20readings%20of%20%22ranks%20the%20next%0A%23%20%20%20%20seven%20days%22%3B%20days%20an%20activity%20cannot%20be%20scored%20on%20are%20left%20out%2C%20and%0A%23%20%20%20%20%60reason%60%20says%20why%20the%20list%20is%20empty%20when%20one%20answer%20covers%20the%20week%20%E2%80%94%0A%23%20%20%20%20Innsbruck%20has%20no%20coast%2C%20so%20surfing%20comes%20back%20empty%20and%20says%20so.%0Aquery%20BestDaysPerActivity%20%7B%0A%20%20activityForecast(query%3A%20%22Innsbruck%22)%20%7B%0A%20%20%20%20location%20%7B%20name%20country%20admin1%20%7D%0A%20%20%20%20modelVersion%0A%20%20%20%20issuedAt%0A%20%20%20%20rankings%20%7B%0A%20%20%20%20%20%20activity%0A%20%20%20%20%20%20days%20%7B%20date%20score%20band%20confidence%20%7D%0A%20%20%20%20%20%20reason%0A%20%20%20%20%7D%0A%20%20%7D%0A%7D) |
| 2 | **BestActivityPerDay** — The same seven days read the other way: which activity is best on each day | Seven dates, each listing four activities. Lisbon is coastal, so surfing carries a score here rather than a reason | [open](http://localhost:4000/graphql?query=%23%202.%20Best%20activity%20for%20each%20day%2C%20which%20is%20the%20other%20reading.%20The%20three-state%0A%23%20%20%20%20union%20is%20visible%20here%3A%20scored%2C%20notApplicable%2C%20unavailable.%0Aquery%20BestActivityPerDay%20%7B%0A%20%20activityForecast(query%3A%20%22Lisbon%22)%20%7B%0A%20%20%20%20days%20%7B%0A%20%20%20%20%20%20date%0A%20%20%20%20%20%20activities%20%7B%0A%20%20%20%20%20%20%20%20...%20on%20ScoredActivity%20%7B%20activity%20score%20band%20confidence%20%7D%0A%20%20%20%20%20%20%20%20...%20on%20NotApplicableActivity%20%7B%20activity%20reason%20%7D%0A%20%20%20%20%20%20%20%20...%20on%20UnavailableActivity%20%7B%20activity%20reason%20%7D%0A%20%20%20%20%20%20%7D%0A%20%20%20%20%7D%0A%20%20%7D%0A%7D) | [open](http://2.28.24.132:4000/graphql?query=%23%202.%20Best%20activity%20for%20each%20day%2C%20which%20is%20the%20other%20reading.%20The%20three-state%0A%23%20%20%20%20union%20is%20visible%20here%3A%20scored%2C%20notApplicable%2C%20unavailable.%0Aquery%20BestActivityPerDay%20%7B%0A%20%20activityForecast(query%3A%20%22Lisbon%22)%20%7B%0A%20%20%20%20days%20%7B%0A%20%20%20%20%20%20date%0A%20%20%20%20%20%20activities%20%7B%0A%20%20%20%20%20%20%20%20...%20on%20ScoredActivity%20%7B%20activity%20score%20band%20confidence%20%7D%0A%20%20%20%20%20%20%20%20...%20on%20NotApplicableActivity%20%7B%20activity%20reason%20%7D%0A%20%20%20%20%20%20%20%20...%20on%20UnavailableActivity%20%7B%20activity%20reason%20%7D%0A%20%20%20%20%20%20%7D%0A%20%20%20%20%7D%0A%20%20%7D%0A%7D) |
| 3 | **WhyThatScore** — That a score can be taken apart into the weather that produced it | Every scored activity carries factors with rawValue, curveValue and contribution, plus gates with a multiplier. The contributions sum to base | [open](http://localhost:4000/graphql?query=%23%203.%20Why%20that%20score.%20Every%20factor%20reports%20the%20forecast%20value%20behind%20it%2C%20what%20the%0A%23%20%20%20%20curve%20made%20of%20it%2C%20and%20how%20many%20points%20it%20accounts%20for.%20Gates%20are%20separate%3A%0A%23%20%20%20%20a%20gate%20multiplies%20the%20whole%20score%2C%20which%20is%20how%20a%20powder%20day%20in%20a%20gale%0A%23%20%20%20%20comes%20out%20POOR%20without%20the%20wind%20out-weighting%20the%20snow.%0Aquery%20WhyThatScore%20%7B%0A%20%20activityForecast(query%3A%20%22Reykjavik%22)%20%7B%0A%20%20%20%20days%20%7B%0A%20%20%20%20%20%20date%0A%20%20%20%20%20%20activities%20%7B%0A%20%20%20%20%20%20%20%20...%20on%20ScoredActivity%20%7B%0A%20%20%20%20%20%20%20%20%20%20activity%0A%20%20%20%20%20%20%20%20%20%20score%0A%20%20%20%20%20%20%20%20%20%20base%0A%20%20%20%20%20%20%20%20%20%20completeness%0A%20%20%20%20%20%20%20%20%20%20factors%20%7B%20name%20weight%20rawValue%20curveValue%20contribution%20%7D%0A%20%20%20%20%20%20%20%20%20%20gates%20%7B%20name%20rawValue%20multiplier%20%7D%0A%20%20%20%20%20%20%20%20%7D%0A%20%20%20%20%20%20%7D%0A%20%20%20%20%7D%0A%20%20%7D%0A%7D) | [open](http://2.28.24.132:4000/graphql?query=%23%203.%20Why%20that%20score.%20Every%20factor%20reports%20the%20forecast%20value%20behind%20it%2C%20what%20the%0A%23%20%20%20%20curve%20made%20of%20it%2C%20and%20how%20many%20points%20it%20accounts%20for.%20Gates%20are%20separate%3A%0A%23%20%20%20%20a%20gate%20multiplies%20the%20whole%20score%2C%20which%20is%20how%20a%20powder%20day%20in%20a%20gale%0A%23%20%20%20%20comes%20out%20POOR%20without%20the%20wind%20out-weighting%20the%20snow.%0Aquery%20WhyThatScore%20%7B%0A%20%20activityForecast(query%3A%20%22Reykjavik%22)%20%7B%0A%20%20%20%20days%20%7B%0A%20%20%20%20%20%20date%0A%20%20%20%20%20%20activities%20%7B%0A%20%20%20%20%20%20%20%20...%20on%20ScoredActivity%20%7B%0A%20%20%20%20%20%20%20%20%20%20activity%0A%20%20%20%20%20%20%20%20%20%20score%0A%20%20%20%20%20%20%20%20%20%20base%0A%20%20%20%20%20%20%20%20%20%20completeness%0A%20%20%20%20%20%20%20%20%20%20factors%20%7B%20name%20weight%20rawValue%20curveValue%20contribution%20%7D%0A%20%20%20%20%20%20%20%20%20%20gates%20%7B%20name%20rawValue%20multiplier%20%7D%0A%20%20%20%20%20%20%20%20%7D%0A%20%20%20%20%20%20%7D%0A%20%20%20%20%7D%0A%20%20%7D%0A%7D) |
| 4 | **FiveCambridges** — That an ambiguous city name is answered out loud rather than guessed at | location is Cambridge, England, and alternatives lists four more Cambridges in other countries. The service never silently picks one | [open](http://localhost:4000/graphql?query=%23%204.%20Ambiguity%2C%20out%20loud.%20%22Cambridge%22%20matches%20five%20places%3B%20the%20service%20scores%20one%0A%23%20%20%20%20and%20shows%20the%20rest%20rather%20than%20quietly%20answering%20about%20the%20wrong%20country.%0Aquery%20FiveCambridges%20%7B%0A%20%20activityForecast(query%3A%20%22Cambridge%22)%20%7B%0A%20%20%20%20location%20%7B%20name%20country%20admin1%20latitude%20longitude%20%7D%0A%20%20%20%20alternatives%20%7B%20name%20country%20admin1%20%7D%0A%20%20%7D%0A%7D) | [open](http://2.28.24.132:4000/graphql?query=%23%204.%20Ambiguity%2C%20out%20loud.%20%22Cambridge%22%20matches%20five%20places%3B%20the%20service%20scores%20one%0A%23%20%20%20%20and%20shows%20the%20rest%20rather%20than%20quietly%20answering%20about%20the%20wrong%20country.%0Aquery%20FiveCambridges%20%7B%0A%20%20activityForecast(query%3A%20%22Cambridge%22)%20%7B%0A%20%20%20%20location%20%7B%20name%20country%20admin1%20latitude%20longitude%20%7D%0A%20%20%20%20alternatives%20%7B%20name%20country%20admin1%20%7D%0A%20%20%7D%0A%7D) |
| 5 | **NoSuchPlace** — That a place which does not exist is refused, not invented | An errors block naming the query you typed, with code LOCATION_NOT_FOUND. Not an empty forecast, and not a made-up city | [open](http://localhost:4000/graphql?query=%23%205.%20A%20failure%20state%2C%20on%20purpose.%20A%20query%20nothing%20matched%20is%20an%20error%20naming%20the%0A%23%20%20%20%20query%2C%20not%20an%20empty%20forecast%20and%20not%20a%20made-up%20location.%0Aquery%20NoSuchPlace%20%7B%0A%20%20activityForecast(query%3A%20%22Nowhereinparticular%22)%20%7B%0A%20%20%20%20location%20%7B%20name%20%7D%0A%20%20%7D%0A%7D) | [open](http://2.28.24.132:4000/graphql?query=%23%205.%20A%20failure%20state%2C%20on%20purpose.%20A%20query%20nothing%20matched%20is%20an%20error%20naming%20the%0A%23%20%20%20%20query%2C%20not%20an%20empty%20forecast%20and%20not%20a%20made-up%20location.%0Aquery%20NoSuchPlace%20%7B%0A%20%20activityForecast(query%3A%20%22Nowhereinparticular%22)%20%7B%0A%20%20%20%20location%20%7B%20name%20%7D%0A%20%20%7D%0A%7D) |
| 6 | **WhereSkiingWasAssessed** — That a ski score says which point on the map it belongs to | location.elevation is around 218 m for the town, while assessment.terrain reports a point over 3000 m and roughly 45 km away. The ski scores belong to the second | [open](http://localhost:4000/graphql?query=%23%206.%20Where%20skiing%20was%20actually%20assessed.%20The%20city%20sits%20at%20214%20m%20and%20the%20score%0A%23%20%20%20%20belongs%20to%20a%20point%203204%20m%20up%20and%2044%20km%20away%2C%20so%20the%20answer%20says%20so%20rather%0A%23%20%20%20%20than%20letting%20%22Grenoble%2078%22%20read%20as%20a%20claim%20about%20the%20city%20centre.%0Aquery%20WhereSkiingWasAssessed%20%7B%0A%20%20activityForecast(query%3A%20%22Grenoble%22)%20%7B%0A%20%20%20%20location%20%7B%20name%20elevation%20%7D%0A%20%20%20%20assessment%20%7B%0A%20%20%20%20%20%20marineCoverage%0A%20%20%20%20%20%20terrain%20%7B%20elevation%20distanceKm%20gridVersion%20latitude%20longitude%20%7D%0A%20%20%20%20%7D%0A%20%20%20%20rankings%20%7B%0A%20%20%20%20%20%20activity%0A%20%20%20%20%20%20days%20%7B%20date%20score%20band%20confidence%20%7D%0A%20%20%20%20%20%20reason%0A%20%20%20%20%7D%0A%20%20%7D%0A%7D) | [open](http://2.28.24.132:4000/graphql?query=%23%206.%20Where%20skiing%20was%20actually%20assessed.%20The%20city%20sits%20at%20214%20m%20and%20the%20score%0A%23%20%20%20%20belongs%20to%20a%20point%203204%20m%20up%20and%2044%20km%20away%2C%20so%20the%20answer%20says%20so%20rather%0A%23%20%20%20%20than%20letting%20%22Grenoble%2078%22%20read%20as%20a%20claim%20about%20the%20city%20centre.%0Aquery%20WhereSkiingWasAssessed%20%7B%0A%20%20activityForecast(query%3A%20%22Grenoble%22)%20%7B%0A%20%20%20%20location%20%7B%20name%20elevation%20%7D%0A%20%20%20%20assessment%20%7B%0A%20%20%20%20%20%20marineCoverage%0A%20%20%20%20%20%20terrain%20%7B%20elevation%20distanceKm%20gridVersion%20latitude%20longitude%20%7D%0A%20%20%20%20%7D%0A%20%20%20%20rankings%20%7B%0A%20%20%20%20%20%20activity%0A%20%20%20%20%20%20days%20%7B%20date%20score%20band%20confidence%20%7D%0A%20%20%20%20%20%20reason%0A%20%20%20%20%7D%0A%20%20%7D%0A%7D) |
| 7 | **NoMountainNoOcean** — That "there is nothing to score here" is a different answer from "it scores badly" | Amsterdam samples about 38 m and no water, so skiing and surfing come back notApplicable with a reason — never a score of zero. Vienna has terrain but no water | [open](http://localhost:4000/graphql?query=%23%207.%20Measured%20absence.%20Amsterdam's%20sampled%20grid%20maxes%20at%20about%2038%20m%20and%20neither%0A%23%20%20%20%20coordinate%20has%20water%2C%20so%20those%20activities%20come%20back%20notApplicable%20with%20a%0A%23%20%20%20%20reason%20%E2%80%94%20not%20scored%20zero%2C%20and%20not%20from%20any%20list%20naming%20those%20cities.%0Aquery%20NoMountainNoOcean%20%7B%0A%20%20amsterdam%3A%20activityForecast(query%3A%20%22Amsterdam%22)%20%7B%0A%20%20%20%20assessment%20%7B%20terrain%20%7B%20elevation%20distanceKm%20%7D%20marineCoverage%20%7D%0A%20%20%20%20days%20%7B%0A%20%20%20%20%20%20date%0A%20%20%20%20%20%20activities%20%7B%0A%20%20%20%20%20%20%20%20...%20on%20NotApplicableActivity%20%7B%20activity%20reason%20%7D%0A%20%20%20%20%20%20%20%20...%20on%20ScoredActivity%20%7B%20activity%20score%20%7D%0A%20%20%20%20%20%20%7D%0A%20%20%20%20%7D%0A%20%20%7D%0A%20%20vienna%3A%20activityForecast(query%3A%20%22Vienna%22)%20%7B%0A%20%20%20%20assessment%20%7B%20terrain%20%7B%20elevation%20%7D%20marineCoverage%20%7D%0A%20%20%20%20days%20%7B%0A%20%20%20%20%20%20date%0A%20%20%20%20%20%20activities%20%7B%0A%20%20%20%20%20%20%20%20...%20on%20NotApplicableActivity%20%7B%20activity%20reason%20%7D%0A%20%20%20%20%20%20%7D%0A%20%20%20%20%7D%0A%20%20%7D%0A%7D) | [open](http://2.28.24.132:4000/graphql?query=%23%207.%20Measured%20absence.%20Amsterdam's%20sampled%20grid%20maxes%20at%20about%2038%20m%20and%20neither%0A%23%20%20%20%20coordinate%20has%20water%2C%20so%20those%20activities%20come%20back%20notApplicable%20with%20a%0A%23%20%20%20%20reason%20%E2%80%94%20not%20scored%20zero%2C%20and%20not%20from%20any%20list%20naming%20those%20cities.%0Aquery%20NoMountainNoOcean%20%7B%0A%20%20amsterdam%3A%20activityForecast(query%3A%20%22Amsterdam%22)%20%7B%0A%20%20%20%20assessment%20%7B%20terrain%20%7B%20elevation%20distanceKm%20%7D%20marineCoverage%20%7D%0A%20%20%20%20days%20%7B%0A%20%20%20%20%20%20date%0A%20%20%20%20%20%20activities%20%7B%0A%20%20%20%20%20%20%20%20...%20on%20NotApplicableActivity%20%7B%20activity%20reason%20%7D%0A%20%20%20%20%20%20%20%20...%20on%20ScoredActivity%20%7B%20activity%20score%20%7D%0A%20%20%20%20%20%20%7D%0A%20%20%20%20%7D%0A%20%20%7D%0A%20%20vienna%3A%20activityForecast(query%3A%20%22Vienna%22)%20%7B%0A%20%20%20%20assessment%20%7B%20terrain%20%7B%20elevation%20%7D%20marineCoverage%20%7D%0A%20%20%20%20days%20%7B%0A%20%20%20%20%20%20date%0A%20%20%20%20%20%20activities%20%7B%0A%20%20%20%20%20%20%20%20...%20on%20NotApplicableActivity%20%7B%20activity%20reason%20%7D%0A%20%20%20%20%20%20%7D%0A%20%20%20%20%7D%0A%20%20%7D%0A%7D) |
| 8 | **HowFreshIsThisAnswer** — That the weather is stored rather than fetched again on every request | Press play twice inside an hour. issuedAt does not move — the second answer cost no upstream call. stale is false unless Open-Meteo could not be reached | [open](http://localhost:4000/graphql?query=%23%208.%20Storage%2C%20seen%20from%20outside.%20issuedAt%20is%20when%20the%20forecast%20was%20FETCHED%2C%20not%0A%23%20%20%20%20when%20it%20was%20served%2C%20so%20running%20this%20twice%20inside%20an%20hour%20returns%20the%20same%0A%23%20%20%20%20timestamp%3A%20the%20second%20answer%20cost%20no%20upstream%20call%20at%20all.%20stale%20turns%20true%0A%23%20%20%20%20when%20Open-Meteo%20could%20not%20be%20reached%20and%20the%20stored%20issuance%20was%20served%0A%23%20%20%20%20anyway%2C%20with%20staleReason%20naming%20what%20failed.%0Aquery%20HowFreshIsThisAnswer%20%7B%0A%20%20activityForecast(query%3A%20%22Innsbruck%22)%20%7B%0A%20%20%20%20location%20%7B%20name%20%7D%0A%20%20%20%20issuedAt%0A%20%20%20%20stale%0A%20%20%20%20staleReason%0A%20%20%20%20days%20%7B%20date%20%7D%0A%20%20%7D%0A%7D) | [open](http://2.28.24.132:4000/graphql?query=%23%208.%20Storage%2C%20seen%20from%20outside.%20issuedAt%20is%20when%20the%20forecast%20was%20FETCHED%2C%20not%0A%23%20%20%20%20when%20it%20was%20served%2C%20so%20running%20this%20twice%20inside%20an%20hour%20returns%20the%20same%0A%23%20%20%20%20timestamp%3A%20the%20second%20answer%20cost%20no%20upstream%20call%20at%20all.%20stale%20turns%20true%0A%23%20%20%20%20when%20Open-Meteo%20could%20not%20be%20reached%20and%20the%20stored%20issuance%20was%20served%0A%23%20%20%20%20anyway%2C%20with%20staleReason%20naming%20what%20failed.%0Aquery%20HowFreshIsThisAnswer%20%7B%0A%20%20activityForecast(query%3A%20%22Innsbruck%22)%20%7B%0A%20%20%20%20location%20%7B%20name%20%7D%0A%20%20%20%20issuedAt%0A%20%20%20%20stale%0A%20%20%20%20staleReason%0A%20%20%20%20days%20%7B%20date%20%7D%0A%20%20%7D%0A%7D) |
| 9 | **LetMePickTheCambridge** — That a caller can choose the place instead of being chosen for | Five Cambridges with their geonameId and population, and none of them picked. Copy any geonameId for the next example | [open](http://localhost:4000/graphql?query=%23%209.%20The%20other%20answer%20to%20an%20ambiguous%20name.%20Query%204%20shows%20activityForecast%0A%23%20%20%20%20picking%20one%20Cambridge%20and%20naming%20the%20rest%3B%20this%20one%20picks%20none%20and%20hands%0A%23%20%20%20%20back%20the%20candidates%20with%20the%20population%20upstream%20ranked%20them%20by.%20The%0A%23%20%20%20%20geonameId%20of%20any%20of%20them%20goes%20straight%20into%20activityForecastAt.%0Aquery%20LetMePickTheCambridge%20%7B%0A%20%20searchLocations(query%3A%20%22Cambridge%22%2C%20limit%3A%205)%20%7B%0A%20%20%20%20geonameId%0A%20%20%20%20name%0A%20%20%20%20admin1%0A%20%20%20%20countryCode%0A%20%20%20%20population%0A%20%20%7D%0A%7D) | [open](http://2.28.24.132:4000/graphql?query=%23%209.%20The%20other%20answer%20to%20an%20ambiguous%20name.%20Query%204%20shows%20activityForecast%0A%23%20%20%20%20picking%20one%20Cambridge%20and%20naming%20the%20rest%3B%20this%20one%20picks%20none%20and%20hands%0A%23%20%20%20%20back%20the%20candidates%20with%20the%20population%20upstream%20ranked%20them%20by.%20The%0A%23%20%20%20%20geonameId%20of%20any%20of%20them%20goes%20straight%20into%20activityForecastAt.%0Aquery%20LetMePickTheCambridge%20%7B%0A%20%20searchLocations(query%3A%20%22Cambridge%22%2C%20limit%3A%205)%20%7B%0A%20%20%20%20geonameId%0A%20%20%20%20name%0A%20%20%20%20admin1%0A%20%20%20%20countryCode%0A%20%20%20%20population%0A%20%20%7D%0A%7D) |
| 10 | **ForecastThatExactCambridge** — That a chosen place is forecast exactly, with no second guess | Cambridge, Massachusetts — the one the name query does not pick. alternatives is empty, because the caller already chose | [open](http://localhost:4000/graphql?query=%23%2010.%20And%20the%20follow-up%3A%20take%20one%20geonameId%20from%20query%209%20and%20forecast%20exactly%0A%23%20%20%20%20%20that%20place.%204931972%20is%20Cambridge%2C%20Massachusetts%20%E2%80%94%20the%20one%20the%20name%20query%0A%23%20%20%20%20%20does%20NOT%20pick%2C%20because%20upstream%20ranks%20the%20English%20original%20first.%20No%0A%23%20%20%20%20%20alternatives%20come%20back%20here%3A%20the%20caller%20already%20chose.%0Aquery%20ForecastThatExactCambridge%20%7B%0A%20%20activityForecastAt(locationId%3A%20%22geoname%3A4931972%22)%20%7B%0A%20%20%20%20location%20%7B%20name%20admin1%20countryCode%20%7D%0A%20%20%20%20alternatives%20%7B%20name%20%7D%0A%20%20%20%20issuedAt%0A%20%20%20%20days%20%7B%0A%20%20%20%20%20%20date%0A%20%20%20%20%20%20activities%20%7B%0A%20%20%20%20%20%20%20%20...%20on%20ScoredActivity%20%7B%20activity%20score%20%7D%0A%20%20%20%20%20%20%20%20...%20on%20NotApplicableActivity%20%7B%20activity%20reason%20%7D%0A%20%20%20%20%20%20%7D%0A%20%20%20%20%7D%0A%20%20%7D%0A%7D) | [open](http://2.28.24.132:4000/graphql?query=%23%2010.%20And%20the%20follow-up%3A%20take%20one%20geonameId%20from%20query%209%20and%20forecast%20exactly%0A%23%20%20%20%20%20that%20place.%204931972%20is%20Cambridge%2C%20Massachusetts%20%E2%80%94%20the%20one%20the%20name%20query%0A%23%20%20%20%20%20does%20NOT%20pick%2C%20because%20upstream%20ranks%20the%20English%20original%20first.%20No%0A%23%20%20%20%20%20alternatives%20come%20back%20here%3A%20the%20caller%20already%20chose.%0Aquery%20ForecastThatExactCambridge%20%7B%0A%20%20activityForecastAt(locationId%3A%20%22geoname%3A4931972%22)%20%7B%0A%20%20%20%20location%20%7B%20name%20admin1%20countryCode%20%7D%0A%20%20%20%20alternatives%20%7B%20name%20%7D%0A%20%20%20%20issuedAt%0A%20%20%20%20days%20%7B%0A%20%20%20%20%20%20date%0A%20%20%20%20%20%20activities%20%7B%0A%20%20%20%20%20%20%20%20...%20on%20ScoredActivity%20%7B%20activity%20score%20%7D%0A%20%20%20%20%20%20%20%20...%20on%20NotApplicableActivity%20%7B%20activity%20reason%20%7D%0A%20%20%20%20%20%20%7D%0A%20%20%20%20%7D%0A%20%20%7D%0A%7D) |
| 11 | **HowFridayChanged** — That every stored forecast is kept, so one date can be read as it was seen over time | One row per stored fetch that reached that date, newest first, with horizonDays. A freshly started service may show only one — which is the honest answer, not a bug | [open](http://localhost:4000/graphql?query=%23%2011.%20Why%20issuances%20are%20kept%20instead%20of%20overwritten.%20This%20asks%20how%20our%20answer%20for%0A%23%20%20%20%20%20one%20date%20changed%20as%20that%20date%20approached%3A%20every%20stored%20fetch%20that%20reached%0A%23%20%20%20%20%20it%2C%20newest%20first%2C%20with%20the%20horizon%20it%20was%20seen%20at.%20An%20upsert%20per%20date%0A%23%20%20%20%20%20would%20answer%20only%20the%20first%20question%20and%20destroy%20the%20second.%20Pick%20a%20date%0A%23%20%20%20%20%20inside%20the%20next%20week%20for%20a%20city%20that%20has%20been%20asked%20about%20more%20than%20once%20%E2%80%94%0A%23%20%20%20%20%20on%20a%20freshly%20deployed%20service%20there%20may%20be%20only%20one%20issuance%2C%20which%20is%0A%23%20%20%20%20%20itself%20the%20honest%20answer.%0Aquery%20HowFridayChanged%20%7B%0A%20%20forecastHistory(locationId%3A%20%22geoname%3A2653941%22%2C%20date%3A%20%222026-08-02%22)%20%7B%0A%20%20%20%20issuedAt%0A%20%20%20%20horizonDays%0A%20%20%20%20modelVersion%0A%20%20%20%20day%20%7B%0A%20%20%20%20%20%20date%0A%20%20%20%20%20%20activities%20%7B%0A%20%20%20%20%20%20%20%20...%20on%20ScoredActivity%20%7B%20activity%20score%20band%20confidence%20%7D%0A%20%20%20%20%20%20%20%20...%20on%20NotApplicableActivity%20%7B%20activity%20reason%20%7D%0A%20%20%20%20%20%20%7D%0A%20%20%20%20%7D%0A%20%20%7D%0A%7D) | [open](http://2.28.24.132:4000/graphql?query=%23%2011.%20Why%20issuances%20are%20kept%20instead%20of%20overwritten.%20This%20asks%20how%20our%20answer%20for%0A%23%20%20%20%20%20one%20date%20changed%20as%20that%20date%20approached%3A%20every%20stored%20fetch%20that%20reached%0A%23%20%20%20%20%20it%2C%20newest%20first%2C%20with%20the%20horizon%20it%20was%20seen%20at.%20An%20upsert%20per%20date%0A%23%20%20%20%20%20would%20answer%20only%20the%20first%20question%20and%20destroy%20the%20second.%20Pick%20a%20date%0A%23%20%20%20%20%20inside%20the%20next%20week%20for%20a%20city%20that%20has%20been%20asked%20about%20more%20than%20once%20%E2%80%94%0A%23%20%20%20%20%20on%20a%20freshly%20deployed%20service%20there%20may%20be%20only%20one%20issuance%2C%20which%20is%0A%23%20%20%20%20%20itself%20the%20honest%20answer.%0Aquery%20HowFridayChanged%20%7B%0A%20%20forecastHistory(locationId%3A%20%22geoname%3A2653941%22%2C%20date%3A%20%222026-08-02%22)%20%7B%0A%20%20%20%20issuedAt%0A%20%20%20%20horizonDays%0A%20%20%20%20modelVersion%0A%20%20%20%20day%20%7B%0A%20%20%20%20%20%20date%0A%20%20%20%20%20%20activities%20%7B%0A%20%20%20%20%20%20%20%20...%20on%20ScoredActivity%20%7B%20activity%20score%20band%20confidence%20%7D%0A%20%20%20%20%20%20%20%20...%20on%20NotApplicableActivity%20%7B%20activity%20reason%20%7D%0A%20%20%20%20%20%20%7D%0A%20%20%20%20%7D%0A%20%20%7D%0A%7D) |
| 12 | **WhichCodeIsAnswering** — Which commit the running service was built from, before reporting anything about it | release is the short git SHA the image was built from, or "unknown" when nothing stamped the build. health is "ok". Start here when something looks wrong | [open](http://localhost:4000/graphql?query=%23%2012.%20Which%20code%20is%20answering.%20The%20deploy%20log%20says%20what%20was%20sent%3B%20this%20says%20what%0A%23%20%20%20%20%20is%20running%2C%20which%20is%20the%20first%20question%20of%20every%20incident.%20It%20reports%0A%23%20%20%20%20%20%22unknown%22%20rather%20than%20inventing%20a%20plausible%20answer%20when%20nothing%20stamped%0A%23%20%20%20%20%20the%20build.%0Aquery%20WhichCodeIsAnswering%20%7B%0A%20%20release%0A%20%20health%0A%7D) | [open](http://2.28.24.132:4000/graphql?query=%23%2012.%20Which%20code%20is%20answering.%20The%20deploy%20log%20says%20what%20was%20sent%3B%20this%20says%20what%0A%23%20%20%20%20%20is%20running%2C%20which%20is%20the%20first%20question%20of%20every%20incident.%20It%20reports%0A%23%20%20%20%20%20%22unknown%22%20rather%20than%20inventing%20a%20plausible%20answer%20when%20nothing%20stamped%0A%23%20%20%20%20%20the%20build.%0Aquery%20WhichCodeIsAnswering%20%7B%0A%20%20release%0A%20%20health%0A%7D) |

<!-- examples:end -->

The table is generated from [`src/api/examples.ts`](src/api/examples.ts) by `pnpm examples`, and a
test fails when it drifts from the code — the same arrangement [`docs/schema.graphql`](docs/schema.graphql)
uses. GraphiQL serves those same examples as tabs, so the editor and this table cannot disagree.

Two things worth knowing before you click:

- **GraphiQL loads its editor from unpkg.com.** The service has no such dependency — every row works
  over `curl` against this host alone — but the browser UI will not render without that CDN.
- **A link opens a new tab every time.** GraphiQL keeps tab state in your browser, so if you have used
  it here before you will see your own tabs beside ours rather than instead of them.

## Run it yourself

```bash
git clone https://github.com/Todmy/activity-weather-ranking && cd activity-weather-ranking
docker compose up
```

Then open `http://localhost:4000/graphql`. That is the whole of it: no API key, no signup, no account.
Open-Meteo's free tier needs none, which is part of why it was chosen.

`docker-compose.yml` is the same file the deployed host runs, so this is not a development-only path.
It builds the image, waits for MongoDB to report healthy, and only then starts the API — which opens
the database before it binds the socket, so a service that accepts requests is a service that can
answer them.

> **The first request for a city takes a few seconds.** It geocodes, samples 81 elevation coordinates
> around the city and asks the wave model whether there is water there. All of that is written to
> `locations` and never paid again. The second request for the same city is a database read, and every
> request for the next hour is served from the stored issuance — which you can see, because `issuedAt`
> does not move.

### Without Docker

Node 24 or newer and pnpm. Node 24 strips TypeScript types at load, so there is no build step.

```bash
pnpm install
docker compose up mongo -d      # or point MONGODB_URI at any MongoDB 8
pnpm dev                        # watch mode on http://localhost:4000/graphql
```

Configuration is five variables and every one has a working default, so the service starts with no
`.env` at all — see [`.env.example`](.env.example). Override `PORT`, `MONGODB_URI`, `MONGODB_DB` or
`REFRESH_INTERVAL_MS` only if you need to.

### Tests

```bash
pnpm check                      # tsc --noEmit, then the whole suite
```

Docker is not needed. A network is, once: the persistence tests start a real `mongod` through
`mongodb-memory-server`, which fetches the binary (~80 MB) on the first run and caches it, so a cold
clone offline will not get past the first suite. Every run after that is offline.

That `mongod` is the same major version as the `mongo:8` in compose, so the driver, the indexes and
the concurrency behaviour under test are production's. **No test ever calls Open-Meteo** — they run
against the captured responses in [`docs/probes/`](docs/probes/), which is what keeps them
deterministic and keeps the free-tier quota for the deployed service.

### Watch the refresher

Ten minutes against an hour of freshness is nothing you can sit and watch. Start it with a short
interval and back-date the stored weather instead:

```bash
REFRESH_INTERVAL_MS=15000 docker compose up -d

curl -s http://localhost:4000/graphql -H 'content-type: application/json' \
  -d '{"query":"{ activityForecast(query: \"Innsbruck\") { issuedAt } }"}'

# Pretend the stored issuance is two hours old. Fine on a database you have just
# started; it rewrites the timestamps forecastHistory reports.
docker compose exec -T mongo mongosh activity_weather --quiet \
  --eval 'db.forecasts.updateMany({}, {$set: {issuedAt: new Date(Date.now() - 2*60*60*1000)}})'

docker compose logs -f api
```

Within fifteen seconds:

```
refresher: woke at 2026-07-30T15:56:48.761Z, 1 locations requested in the last 24h
refresher: Innsbruck (geoname:2775220) refreshed
refresher: done — 1 refreshed, 0 skipped, 0 failed
refresher: woke at 2026-07-30T15:57:03.938Z, 1 locations requested in the last 24h
refresher: Innsbruck (geoname:2775220) stillFresh
refresher: done — 0 refreshed, 1 skipped, 0 failed
```

The second tick is the one worth reading: it refreshes nothing, because the first already did.

`REFRESH_INTERVAL_MS=0` runs no refresher at all. That is what a second instance behind the same
database should use: one is enough, and the lease makes a second safe rather than useful.

## Assumptions

The brief leaves eight things open that a product manager would normally answer. None of them were
guessed silently — each is written up in [`docs/open-questions.md`](docs/open-questions.md) with what
was rejected and why. The five that most change what the service does:

| Question | What was assumed |
|---|---|
| "Ranks the next 7 days" — days within an activity, or activities within a day? | **Both**, from one response and one computation. The reading is ambiguous, and answering only one of them is a coin flip on a graded question |
| Does "skiing" describe the city, or the region reachable from it? | **The region.** Applicability and conditions both come from the highest sampled point within 50 km, and the answer carries that point's elevation and distance so the number is never read as a claim about the city centre |
| Does "surfing" mean the ocean? | **Whatever the wave model has data for.** Chicago on Lake Michigan scores, because excluding it would need a special case and a definition of "sea" that Open-Meteo does not provide. The conditions handle it: fetch-limited water rarely produces a surfable day |
| How stale may stored weather be? | **One hour**, matched to the fastest model Open-Meteo serves rather than to what would minimise traffic. Traffic is not the binding constraint on a 10,000-a-day allowance |
| May the service refuse to answer? | **No**, except when it genuinely has nothing stored. Confidence decays with horizon and staleness is flagged, but a quality floor would invent a state the caller cannot act on |

Two of these were originally decided a different way and changed when the APIs were probed. That is
recorded in [`docs/worklog.md`](docs/worklog.md) rather than smoothed over.

## What I'd do next

In order, and the first two are the ones that matter:

1. **Validate the scoring model against something.** It is reviewable — every threshold cites a source
   and all twenty-three rows of the sanity table pass — but it is not *validated*. Backtesting against
   Open-Meteo's historical archive, scored against days people actually skied or surfed, is the only
   thing that would turn "defensible" into "correct".
2. **A ski resort dataset.** A sampled high point has no lifts, no piste and no snow-making. The
   geography model answers "is there terrain" honestly and cannot answer "can you ski there", and that
   gap is the largest single overclaim risk in the service.
3. **Spring skiing.** The ski temperature curve reaches zero above +3 °C, so a summit at +4 °C on a
   deep base scores POOR — and spring corn is genuinely good skiing to many people. This was found
   while adding the snow gate and deliberately not fixed with it: the gate needed no new number and
   this needs the temperature curve re-fitted against sanity rows that do not exist yet. Named rather
   than quietly carried.
4. **Two instances behind a proxy.** The lease is a database row rather than in-memory state, so
   horizontal scale should already work — but nothing runs two, so nothing proves it. It is the
   largest unproven claim here, and [`capacity.md`](docs/capacity.md) says so alongside the numbers
   that are measured.
5. **Structured logging and metrics** at the gateway and provider boundaries. The refresher's log is
   readable by a human and by nothing else.
6. **Per-caller rate limiting.** The free tier is the shared resource this service protects, and it
   currently protects it against its own traffic pattern only.

Everything deliberately *not* built, with the test each item had to pass, is in
[`docs/cut.md`](docs/cut.md).

## How the work happened

**The brief grades this above the service itself**, so the thinking is written down and committed
rather than reconstructed afterwards.

Two days of design came before any code. What that bought is measurable: **four designed mechanisms
died before a line of either was written** — the haversine marine check, elevation as a ski test,
multi-request terrain grids, and UV as a weighted factor. Three of them died during a day of probing
the live APIs. The counter-reading is available too, and [`worklog.md`](docs/worklog.md) states it:
two days is a large fraction of five, and a day of prototyping might have found the same four things.
What prototyping would not have produced is the record.

Three things worth knowing before you read the history:

- **Version control was deferred at the start.** Everything written across those two days lands in a
  single commit rather than a sequence. That cost was real and it is recorded as
  [decision #32](docs/decisions.md) rather than glossed over. The history is incremental from that
  commit on.
- **The stage artifacts are dated and are not updated.** [`verify.md`](docs/verify.md) and
  [`review.md`](docs/review.md) record what was true when they ran. Where a figure has since moved,
  they say both — "six items when this ran, eight today" — so the record of the moment survives and
  the number a reader checks is still true.
- **The self-review was not independent, and that is written at the top of it.** Three reviewers with
  no context were then given the repository cold. They found twenty-six things, two of them critical,
  neither reachable from any test that existed. Both are fixed, and the finding underneath the second
  one was worth more than the fix: the first twenty sanity rows contained no case where the activity
  was *impossible*, so no amount of running them could have failed on one.

**All nine milestones are done, 41 points.** Progress is tracked in
[`docs/milestones.md`](docs/milestones.md); commits kept landing after the last one, and that file
says which of them earned a milestone and which did not.

## Where to start reading

| Document | What it holds |
|---|---|
| [`docs/decisions.md`](docs/decisions.md) | **Start here for the reasoning.** Every decision and assumption, one line each, linking to the full argument |
| [`docs/worklog.md`](docs/worklog.md) | **Start here for the story.** The sequence as it happened, including two designed mechanisms that died on contact with the real API |
| [`docs/requirements.md`](docs/requirements.md) | What was promised, where each promise is met, and how to check it — with the source of every row |
| [`docs/open-questions.md`](docs/open-questions.md) | The eight questions that would go to a product manager, and the assumption committed to instead |
| [`docs/sanity-table.md`](docs/sanity-table.md) | Twenty-three scenarios the scoring model must reproduce — the first twenty written before any curve exists, and three added after a review found the gap they close |
| [`docs/design.md`](docs/design.md) | Data model, refresh gateway, scoring, determinism |
| [`docs/principles.md`](docs/principles.md) | The twelve rules every design is checked against before it is built, and the code after |
| [`docs/cut.md`](docs/cut.md) | What was considered and not built, with the test each item had to pass |
| [`docs/milestones.md`](docs/milestones.md) | Nine milestones, M0 to M8, each with an observable done-condition and a status |
| [`docs/capacity.md`](docs/capacity.md) | How many callers it takes, measured on the deployed box — and why that number is not the real ceiling |
| [`docs/twelve-factor.md`](docs/twelve-factor.md) | The twelve factors audited by command rather than by memory — three things it found and fixed, four left undone on purpose |
| [`docs/review.md`](docs/review.md) | The final review, including the independent one and what it found |
| [`docs/schema.graphql`](docs/schema.graphql) | The whole API in one file, generated from the code and tested against it — so a removed field is a removed line |
| [`docs/adr/`](docs/adr/) | Three choices big enough to need the argument in full — MongoDB, code-first GraphQL, two fields over `@oneOf` — each recording what it cost as well as what it bought |

[`docs/probes/`](docs/probes/) holds raw captured Open-Meteo responses. They are the evidence behind
the design claims and they become the test fixtures, so no test ever calls the live API.

## Deployment

Live at `http://2.28.24.132:4000/graphql`, on a Hetzner cx23 described by
[`infra/cloud-init.yaml`](infra/cloud-init.yaml). Deploy is `./infra/deploy.sh <host>`; the box pulls
`origin/main` and builds there, so what runs is what a reviewer can read — it never receives an rsync
of anyone's working tree. `{ release }` reports the commit the running image was built from, and says
`unknown` rather than inventing one when nothing stamped the build.

## Licence and attribution

Code is [MIT](LICENSE). Weather data by [Open-Meteo.com](https://open-meteo.com/) and place data from
GeoNames via Open-Meteo, both licensed
[CC BY 4.0](https://creativecommons.org/licenses/by/4.0/) — which is why the licence is stated
separately from the code's, rather than an MIT header being placed over somebody else's data.
