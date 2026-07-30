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
export const defaultQuery = `# Five queries. Pick an operation from the dropdown next to the play button.
#
# Milestone M3 scores all four activities. Skiing and surfing come back as
# UnavailableActivity for now: both need geography this service has not fetched
# yet, and "we have not looked" is deliberately not the same answer as "there is
# no mountain here". Terrain and ocean coverage arrive in M4, storage in M5.

# 1. Best days for each activity. One of the two readings of "ranks the next
#    seven days"; days an activity cannot be scored on are left out.
query BestDaysPerActivity {
  activityForecast(query: "Innsbruck") {
    location { name country admin1 }
    modelVersion
    issuedAt
    rankings {
      activity
      days { date score confidence }
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
`
