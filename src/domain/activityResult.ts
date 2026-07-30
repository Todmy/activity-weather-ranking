import { confidenceFor } from './confidence.ts'
import { scoreProfile } from './score.ts'
import type { FactorContribution, GateEffect, Profile } from './score.ts'
import type { WeatherInputs } from './weather.ts'

/**
 * What is known about a location's geography, which is not weather and does not
 * change from day to day.
 *
 * `null` means nobody has looked yet, and it is deliberately not `false`:
 * "we have not assessed the terrain" and "there is no terrain" are different
 * claims and the second one is a real answer. Slice 3 fills these in.
 */
export type Geography = {
  hasTerrain: boolean | null
  hasMarineCoverage: boolean | null
}

/**
 * Three states, because three things can be true, and a nullable score can only
 * carry one of them (design-questions Q1+2, principle 4):
 *
 *   - `scored` — the activity applies here and this is how good it looks
 *   - `notApplicable` — there is no ocean, or no mountain. Not a bad score, no
 *     score: the question does not arise at this location
 *   - `unavailable` — the activity applies and we could not answer, because
 *     something upstream is missing
 */
export type ActivityResult =
  | {
      kind: 'scored'
      activity: string
      score: number
      /** The weighted mean before the floor and the gates, 0-100. */
      base: number
      confidence: number
      completeness: number
      factors: FactorContribution[]
      gates: GateEffect[]
    }
  | { kind: 'notApplicable'; activity: string; reason: 'noTerrain' | 'noMarineCoverage' }
  | { kind: 'unavailable'; activity: string; reason: string }

export type EvaluationContext = {
  /** 0 is today. Drives the confidence horizon, nothing else. */
  dayIndex: number
  geography: Geography
}

const geographyVerdict = (
  profile: Profile,
  geography: Geography,
): ActivityResult | null => {
  if (profile.requires === 'terrain') {
    if (geography.hasTerrain === false) {
      return { kind: 'notApplicable', activity: profile.activity, reason: 'noTerrain' }
    }
    if (geography.hasTerrain === null) {
      return {
        kind: 'unavailable',
        activity: profile.activity,
        reason: 'terrain has not been assessed for this location yet',
      }
    }
  }

  if (profile.requires === 'marine') {
    if (geography.hasMarineCoverage === false) {
      return { kind: 'notApplicable', activity: profile.activity, reason: 'noMarineCoverage' }
    }
    if (geography.hasMarineCoverage === null) {
      return {
        kind: 'unavailable',
        activity: profile.activity,
        reason: 'marine coverage has not been assessed for this location yet',
      }
    }
  }

  return null
}

export const evaluateActivity = (
  profile: Profile,
  inputs: WeatherInputs,
  { dayIndex, geography }: EvaluationContext,
): ActivityResult => {
  const blocked = geographyVerdict(profile, geography)
  if (blocked) return blocked

  const scored = scoreProfile(profile, inputs)

  if (scored.score === null || scored.base === null) {
    return {
      kind: 'unavailable',
      activity: profile.activity,
      reason: 'the forecast carried no values this profile scores',
    }
  }

  // Partial data is still an answer. Refusing to give one would hide more than
  // it protects; the confidence is what says how much of an answer it is.
  return {
    kind: 'scored',
    activity: profile.activity,
    score: scored.score,
    base: scored.base,
    confidence: confidenceFor(dayIndex, scored.completeness),
    completeness: scored.completeness,
    factors: scored.factors,
    gates: scored.gates,
  }
}
