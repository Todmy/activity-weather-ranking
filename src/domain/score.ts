import type { Curve } from './curves.ts'
import type { WeatherInputs } from './weather.ts'

/**
 * The scoring engine: a weighted mean of membership curves, and nothing else.
 *
 * All the judgement lives in the profiles — which factors, which weights, which
 * thresholds. This file only does the arithmetic, which is why it can be tested
 * against a synthetic profile and left alone while calibration moves.
 */
export type Factor = {
  name: string
  weight: number
  /** A key of the domain's weather record, so a typo is a compile error. */
  input: keyof WeatherInputs
  curve: Curve
  /** The published convention this factor's thresholds come from. Required. */
  source: string
}

export type Profile = {
  activity: string
  /** Geography the activity needs before a score means anything at all. */
  requires: 'terrain' | 'marine' | null
  /** Which weather series to score: the city, or the sampled high point. */
  series: 'city' | 'summit'
  factors: Factor[]
}

export type FactorContribution = {
  name: string
  weight: number
  /** The upstream number, so the answer can be checked against the forecast. */
  rawValue: number | null
  /** What the curve made of it, in [0, 1]. Null when the input was missing. */
  curveValue: number | null
  /** Points of the final 0-100 score this factor accounts for. */
  contribution: number
}

export type ProfileScore = {
  /** Null when not one input was present — no data is not a bad day. */
  score: number | null
  /** Fraction of the profile's weight whose input was actually present. */
  completeness: number
  factors: FactorContribution[]
}

export const scoreProfile = (profile: Profile, inputs: WeatherInputs): ProfileScore => {
  const totalWeight = profile.factors.reduce((sum, factor) => sum + factor.weight, 0)

  const evaluated = profile.factors.map((factor) => {
    const raw = inputs[factor.input]
    const rawValue = raw === undefined || raw === null ? null : raw

    return { factor, rawValue, curveValue: rawValue === null ? null : factor.curve(rawValue) }
  })

  const presentWeight = evaluated
    .filter((entry) => entry.curveValue !== null)
    .reduce((sum, entry) => sum + entry.factor.weight, 0)

  // A missing input leaves the mean alone instead of dragging it to zero: it is
  // dropped from the numerator and the denominator both, and shows up as lost
  // completeness rather than as bad weather.
  const factors: FactorContribution[] = evaluated.map(({ factor, rawValue, curveValue }) => ({
    name: factor.name,
    weight: factor.weight,
    rawValue,
    curveValue,
    contribution:
      curveValue === null || presentWeight === 0
        ? 0
        : (100 * factor.weight * curveValue) / presentWeight,
  }))

  const total = factors.reduce((sum, factor) => sum + factor.contribution, 0)

  return {
    // Rounded at exactly one point, which is what makes the determinism claim
    // in design.md §6 hold across floating-point arithmetic.
    score: presentWeight === 0 ? null : Math.round(total),
    completeness: totalWeight === 0 ? 0 : presentWeight / totalWeight,
    factors,
  }
}
