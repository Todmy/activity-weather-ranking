/**
 * The runnable examples, as data.
 *
 * Principle 12: a capability reachable only from a test is not delivered. This
 * is a backend with no UI, so a reviewer who has to invent a query only ever
 * sees the happy path. Every state the service can be in gets a query someone
 * can run without reading the source, including the ones that fail.
 *
 * Data rather than one long string because three things read them now —
 * GraphiQL's tabs, the README's table of links, and `examples.test.ts`. While
 * they were a string only the editor could read, the header said "Seven
 * queries" against eleven, and "Storage arrives in M5" four milestones after
 * storage shipped. Nothing could fail, so nothing did.
 *
 * `checks` and `expect` are written for someone who does not read GraphQL: the
 * README turns each row into a link that opens GraphiQL with the query already
 * loaded, and the only thing left to do is press play and compare.
 */
export type Example = {
  /** The operation name. Also the GraphiQL tab label and the README row. */
  name: string
  /** What a tester is checking, in one line. */
  checks: string
  /** What a pass looks like, in something they can verify by eye. */
  expect: string
  query: string
}

export const EXAMPLES: Example[] = [
  {
    name: 'BestDaysPerActivity',
    checks: 'The next seven days ranked, best first, for each of the four activities',
    expect:
      'Four activities. Skiing and the two sightseeings have seven dated rows each; surfing has none and a reason of noMarineCoverage, because Innsbruck is landlocked',
    query: `# 1. Best days for each activity. One of the two readings of "ranks the next
#    seven days"; days an activity cannot be scored on are left out, and
#    \`reason\` says why the list is empty when one answer covers the week —
#    Innsbruck has no coast, so surfing comes back empty and says so.
query BestDaysPerActivity {
  activityForecast(query: "Innsbruck") {
    location { name country admin1 }
    modelVersion
    issuedAt
    rankings {
      activity
      days { date score band confidence }
      reason
    }
  }
}`,
  },
  {
    name: 'BestActivityPerDay',
    checks: 'The same seven days read the other way: which activity is best on each day',
    expect:
      'Seven dates, each listing four activities. Lisbon is coastal, so surfing carries a score here rather than a reason',
    query: `# 2. Best activity for each day, which is the other reading. The three-state
#    union is visible here: scored, notApplicable, unavailable.
query BestActivityPerDay {
  activityForecast(query: "Lisbon") {
    days {
      date
      activities {
        ... on ScoredActivity { activity score band confidence }
        ... on NotApplicableActivity { activity reason }
        ... on UnavailableActivity { activity reason }
      }
    }
  }
}`,
  },
  {
    name: 'WhyThatScore',
    checks: 'That a score can be taken apart into the weather that produced it',
    expect:
      'Every scored activity carries factors with rawValue, curveValue and contribution, plus gates with a multiplier. The contributions sum to base',
    query: `# 3. Why that score. Every factor reports the forecast value behind it, what the
#    curve made of it, and how many points it accounts for. Gates are separate:
#    a gate multiplies the whole score, which is how a powder day in a gale
#    comes out POOR without the wind out-weighting the snow.
query WhyThatScore {
  activityForecast(query: "Reykjavik") {
    days {
      date
      activities {
        ... on ScoredActivity {
          activity
          score
          base
          completeness
          factors { name weight rawValue curveValue contribution }
          gates { name rawValue multiplier }
        }
      }
    }
  }
}`,
  },
  {
    name: 'FiveCambridges',
    checks: 'That an ambiguous city name is answered out loud rather than guessed at',
    expect:
      'location is Cambridge, England, and alternatives lists four more Cambridges in other countries. The service never silently picks one',
    query: `# 4. Ambiguity, out loud. "Cambridge" matches five places; the service scores one
#    and shows the rest rather than quietly answering about the wrong country.
query FiveCambridges {
  activityForecast(query: "Cambridge") {
    location { name country admin1 latitude longitude }
    alternatives { name country admin1 }
  }
}`,
  },
  {
    name: 'NoSuchPlace',
    checks: 'That a place which does not exist is refused, not invented',
    expect:
      'An errors block naming the query you typed, with code LOCATION_NOT_FOUND. Not an empty forecast, and not a made-up city',
    query: `# 5. A failure state, on purpose. A query nothing matched is an error naming the
#    query, not an empty forecast and not a made-up location.
query NoSuchPlace {
  activityForecast(query: "Nowhereinparticular") {
    location { name }
  }
}`,
  },
  {
    name: 'WhereSkiingWasAssessed',
    checks: 'That a ski score says which point on the map it belongs to',
    expect:
      'location.elevation is around 218 m for the town, while assessment.terrain reports a point over 3000 m and roughly 45 km away. The ski scores belong to the second',
    query: `# 6. Where skiing was actually assessed. The city sits at 214 m and the score
#    belongs to a point 3204 m up and 44 km away, so the answer says so rather
#    than letting "Grenoble 78" read as a claim about the city centre.
query WhereSkiingWasAssessed {
  activityForecast(query: "Grenoble") {
    location { name elevation }
    assessment {
      marineCoverage
      terrain { elevation distanceKm gridVersion latitude longitude }
    }
    rankings {
      activity
      days { date score band confidence }
      reason
    }
  }
}`,
  },
  {
    name: 'NoMountainNoOcean',
    checks: 'That "there is nothing to score here" is a different answer from "it scores badly"',
    expect:
      'Amsterdam samples about 38 m and no water, so skiing and surfing come back notApplicable with a reason — never a score of zero. Vienna has terrain but no water',
    query: `# 7. Measured absence. Amsterdam's sampled grid maxes at about 38 m and neither
#    coordinate has water, so those activities come back notApplicable with a
#    reason — not scored zero, and not from any list naming those cities.
query NoMountainNoOcean {
  amsterdam: activityForecast(query: "Amsterdam") {
    assessment { terrain { elevation distanceKm } marineCoverage }
    days {
      date
      activities {
        ... on NotApplicableActivity { activity reason }
        ... on ScoredActivity { activity score }
      }
    }
  }
  vienna: activityForecast(query: "Vienna") {
    assessment { terrain { elevation } marineCoverage }
    days {
      date
      activities {
        ... on NotApplicableActivity { activity reason }
      }
    }
  }
}`,
  },
  {
    name: 'HowFreshIsThisAnswer',
    checks: 'That the weather is stored rather than fetched again on every request',
    expect:
      'Press play twice inside an hour. issuedAt does not move — the second answer cost no upstream call. stale is false unless Open-Meteo could not be reached',
    query: `# 8. Storage, seen from outside. issuedAt is when the forecast was FETCHED, not
#    when it was served, so running this twice inside an hour returns the same
#    timestamp: the second answer cost no upstream call at all. stale turns true
#    when Open-Meteo could not be reached and the stored issuance was served
#    anyway, with staleReason naming what failed.
query HowFreshIsThisAnswer {
  activityForecast(query: "Innsbruck") {
    location { name }
    issuedAt
    stale
    staleReason
    days { date }
  }
}`,
  },
  {
    name: 'LetMePickTheCambridge',
    checks: 'That a caller can choose the place instead of being chosen for',
    expect:
      'Five Cambridges with their geonameId and population, and none of them picked. Copy any geonameId for the next example',
    query: `# 9. The other answer to an ambiguous name. Query 4 shows activityForecast
#    picking one Cambridge and naming the rest; this one picks none and hands
#    back the candidates with the population upstream ranked them by. The
#    geonameId of any of them goes straight into activityForecastAt.
query LetMePickTheCambridge {
  searchLocations(query: "Cambridge", limit: 5) {
    geonameId
    name
    admin1
    countryCode
    population
  }
}`,
  },
  {
    name: 'ForecastThatExactCambridge',
    checks: 'That a chosen place is forecast exactly, with no second guess',
    expect:
      'Cambridge, Massachusetts — the one the name query does not pick. alternatives is empty, because the caller already chose',
    query: `# 10. And the follow-up: take one geonameId from query 9 and forecast exactly
#     that place. 4931972 is Cambridge, Massachusetts — the one the name query
#     does NOT pick, because upstream ranks the English original first. No
#     alternatives come back here: the caller already chose.
query ForecastThatExactCambridge {
  activityForecastAt(locationId: "geoname:4931972") {
    location { name admin1 countryCode }
    alternatives { name }
    issuedAt
    days {
      date
      activities {
        ... on ScoredActivity { activity score }
        ... on NotApplicableActivity { activity reason }
      }
    }
  }
}`,
  },
  {
    name: 'HowFridayChanged',
    checks: 'That every stored forecast is kept, so one date can be read as it was seen over time',
    expect:
      'One row per stored fetch that reached that date, newest first, with horizonDays. A freshly started service may show only one — which is the honest answer, not a bug',
    query: `# 11. Why issuances are kept instead of overwritten. This asks how our answer for
#     one date changed as that date approached: every stored fetch that reached
#     it, newest first, with the horizon it was seen at. An upsert per date
#     would answer only the first question and destroy the second. Pick a date
#     inside the next week for a city that has been asked about more than once —
#     on a freshly deployed service there may be only one issuance, which is
#     itself the honest answer.
query HowFridayChanged {
  forecastHistory(locationId: "geoname:2653941", date: "2026-08-02") {
    issuedAt
    horizonDays
    modelVersion
    day {
      date
      activities {
        ... on ScoredActivity { activity score band confidence }
        ... on NotApplicableActivity { activity reason }
      }
    }
  }
}`,
  },
  {
    name: 'WhichCodeIsAnswering',
    checks: 'Which commit the running service was built from, before reporting anything about it',
    expect:
      'release is the short git SHA the image was built from, or "unknown" when nothing stamped the build. health is "ok". Start here when something looks wrong',
    query: `# 12. Which code is answering. The deploy log says what was sent; this says what
#     is running, which is the first question of every incident. It reports
#     "unknown" rather than inventing a plausible answer when nothing stamped
#     the build.
query WhichCodeIsAnswering {
  release
  health
}`,
  },
]
