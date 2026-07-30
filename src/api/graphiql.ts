/**
 * Preloaded GraphiQL queries.
 *
 * Principle 12: a capability reachable only from a test is not delivered. This
 * is a backend with no UI, so a reviewer who has to invent a query will only
 * ever see the happy path. Every state the service can be in gets a query
 * someone can run without reading the source, including the ones that fail.
 *
 * GraphiQL lists these in its operation picker; pick one and press play.
 */
export const defaultQuery = `# Seven queries. Pick an operation from the dropdown next to the play button.
#
# Milestone M4 measures geography, so all four activities now answer for real.
# Skiing is scored at a sampled high point rather than at the city coordinate —
# Grenoble is 214 m in town and 3204 m within 45 km — and query 6 shows where.
# Query 7 shows the other outcome: measured absence, which is notApplicable and
# deliberately not a score of zero. Storage arrives in M5.

# 1. Best days for each activity. One of the two readings of "ranks the next
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
      days { date score confidence }
      reason
    }
  }
}

# 2. Best activity for each day, which is the other reading. The three-state
#    union is visible here: scored, notApplicable, unavailable.
query BestActivityPerDay {
  activityForecast(query: "Lisbon") {
    days {
      date
      activities {
        ... on ScoredActivity { activity score confidence }
        ... on NotApplicableActivity { activity reason }
        ... on UnavailableActivity { activity reason }
      }
    }
  }
}

# 3. Why that score. Every factor reports the forecast value behind it, what the
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
}

# 4. Ambiguity, out loud. "Cambridge" matches five places; the service scores one
#    and shows the rest rather than quietly answering about the wrong country.
query FiveCambridges {
  activityForecast(query: "Cambridge") {
    location { name country admin1 latitude longitude }
    alternatives { name country admin1 }
  }
}

# 5. A failure state, on purpose. A query nothing matched is an error naming the
#    query, not an empty forecast and not a made-up location.
query NoSuchPlace {
  activityForecast(query: "Nowhereinparticular") {
    location { name }
  }
}

# 6. Where skiing was actually assessed. The city sits at 214 m and the score
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
      days { date score confidence }
      reason
    }
  }
}

# 7. Measured absence. Amsterdam's sampled grid maxes at 51 m and Vienna's
#    coordinate has no water, so skiing and surfing come back notApplicable with
#    a reason — not scored zero, and not from any list naming those cities.
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
}

# 8. Storage, seen from outside. issuedAt is when the forecast was FETCHED, not
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
}

# 9. The other answer to an ambiguous name. Query 4 shows activityForecast
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
}

# 10. And the follow-up: take one geonameId from query 9 and forecast exactly
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
}

# 11. Why issuances are kept instead of overwritten. This asks how our answer for
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
        ... on ScoredActivity { activity score confidence }
        ... on NotApplicableActivity { activity reason }
      }
    }
  }
}
`
