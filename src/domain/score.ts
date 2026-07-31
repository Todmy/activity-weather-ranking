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

/**
 * A veto, expressed as a multiplier rather than as weight.
 *
 * A weighted mean can say how good a day is on balance and cannot say "none of
 * that matters". Held lifts and a travel-disruption storm both need the second
 * sentence, so gates multiply the finished score: 1.0 is nothing in the way,
 * and below that everything else is scaled down together. See design.md §4.
 */
export type Gate = {
  name: string
  input: keyof WeatherInputs
  curve: Curve
  /**
   * What a missing input means. `open` is the default and suits a gate whose
   * input describes an obstacle — no gust figure is not a closed mountain.
   *
   * `unscorable` suits a gate whose input is the activity's precondition. A
   * missing snow depth is neither "snow" nor "no snow", and both a held-open
   * gate and a veto would state one of them. The profile has nothing to say,
   * so it says nothing and the caller gets `unavailable`.
   */
  onMissingInput?: 'open' | 'unscorable'
  source: string
}

export type Profile = {
  activity: string
  /** Geography the activity needs before a score means anything at all. */
  requires: 'terrain' | 'marine' | null
  /** Which weather series to score: the city, or the sampled high point. */
  series: 'city' | 'summit'
  factors: Factor[]
  /** Multiplicative vetoes. Absent means nothing can veto this activity. */
  gates?: Gate[]
  /**
   * Where the profile's range starts when every factor reads zero, in [0, 1).
   * Only indoor sightseeing uses it: a museum is open whatever the sky does.
   */
  floor?: number
}

export type FactorContribution = {
  name: string
  weight: number
  /** The upstream number, so the answer can be checked against the forecast. */
  rawValue: number | null
  /** What the curve made of it, in [0, 1]. Null when the input was missing. */
  curveValue: number | null
  /**
   * Points of the weighted mean this factor accounts for. Contributions sum to
   * `base`, not to `score`: the floor and the gates act on the total afterwards
   * and report themselves separately.
   */
  contribution: number
}

export type GateEffect = {
  name: string
  rawValue: number | null
  /** 1 means open. Below that, the whole score is scaled by it. */
  multiplier: number
}

export type ProfileScore = {
  /** Null when not one input was present — no data is not a bad day. */
  score: number | null
  /** The weighted mean on a 0-100 scale, before the floor and the gates. */
  base: number | null
  /** Fraction of the profile's weight whose input was actually present. */
  completeness: number
  factors: FactorContribution[]
  gates: GateEffect[]
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

  const base = factors.reduce((sum, factor) => sum + factor.contribution, 0)

  // A gate whose input is missing stays open. Vetoing on ignorance would turn
  // "we have no gust figure" into "the lifts are shut".
  const gates: GateEffect[] = (profile.gates ?? []).map((gate) => {
    const raw = inputs[gate.input]
    const rawValue = raw === undefined || raw === null ? null : raw

    return { name: gate.name, rawValue, multiplier: rawValue === null ? 1 : gate.curve(rawValue) }
  })

  // A gate whose input is the activity's precondition cannot be assumed either
  // way, so its absence removes the score rather than moving it.
  const unscorable = (profile.gates ?? []).some(
    (gate, index) =>
      gate.onMissingInput === 'unscorable' && gates[index]?.rawValue === null,
  )

  const floor = profile.floor ?? 0
  const gated = gates.reduce((product, gate) => product * gate.multiplier, 1)
  const total = (floor * 100 + (1 - floor) * base) * gated

  return {
    // Rounded at exactly one point, which is what makes the determinism claim
    // in design.md §6 hold across floating-point arithmetic.
    score: presentWeight === 0 || unscorable ? null : Math.round(total),
    base: presentWeight === 0 || unscorable ? null : base,
    completeness: totalWeight === 0 ? 0 : presentWeight / totalWeight,
    factors,
    gates,
  }
}
