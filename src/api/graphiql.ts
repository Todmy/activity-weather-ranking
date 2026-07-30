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
export const defaultQuery = `# Four queries. Pick an operation from the dropdown next to the play button.
#
# Slice 1 (milestone M2) scores outdoor sightseeing only, and persists nothing
# yet: every request goes upstream. Skiing, surfing and indoor sightseeing
# arrive in M3, storage and refresh in M5.

# 1. The headline. Seven days of outdoor sightseeing for one city.
query OutdoorSightseeing {
  activityForecast(query: "Innsbruck") {
    location { name country admin1 elevation timezone }
    issuedAt
    days {
      date
      activities { activity score completeness }
    }
  }
}

# 2. Why that score. Every factor reports the forecast value behind it, what the
#    curve made of it, and how many points of the total it accounts for.
query WhyThatScore {
  activityForecast(query: "Lisbon") {
    location { name country }
    days {
      date
      activities {
        activity
        score
        factors { name weight rawValue curveValue contribution }
      }
    }
  }
}

# 3. Ambiguity, out loud. "Cambridge" matches five places; the service scores one
#    and shows the rest rather than quietly answering about the wrong country.
query FiveCambridges {
  activityForecast(query: "Cambridge") {
    location { name country admin1 latitude longitude }
    alternatives { name country admin1 }
    days { date activities { activity score } }
  }
}

# 4. A failure state, on purpose. A query nothing matched is an error naming the
#    query, not an empty forecast and not a made-up location.
query NoSuchPlace {
  activityForecast(query: "Nowhereinparticular") {
    location { name }
  }
}
`
