/**
 * Membership curves: the entire vocabulary in which thresholds are expressed.
 *
 * Every number that decides anything in this system is an argument to one of
 * these three functions, which is what "scoring is data, not code" means in
 * practice — there is no `if (temp > 25)` anywhere in `domain/`.
 *
 * All three are pure, clamped to [0, 1], and reject bounds given out of order:
 * a silently inverted ramp scores every day backwards, which is the kind of bug
 * that looks like a calibration problem for an afternoon.
 *
 * Equal bounds are legal and mean a step, inclusive of the threshold —
 * `rampUp(5, 5)` is 1 from 5 upwards. A profile that wants a hard cutoff should
 * not have to fake one with an epsilon.
 */
export type CurveSpec = {
  kind: 'rampUp' | 'rampDown' | 'band'
  bounds: number[]
}

/**
 * A curve carries the numbers it was built from. Closures cannot be compared,
 * and the model-version snapshot in `modelVersion.ts` has to be able to see a
 * threshold move — otherwise the version could stay put while the scores did
 * not, which is the one thing principle 9 promises cannot happen.
 */
export type Curve = ((x: number) => number) & { spec: CurveSpec }

const withSpec = (fn: (x: number) => number, spec: CurveSpec): Curve =>
  Object.assign(fn, { spec })

const ascending = (name: string, bounds: readonly number[]): void => {
  for (let i = 1; i < bounds.length; i++) {
    if (bounds[i]! < bounds[i - 1]!) {
      throw new RangeError(`${name} bounds must be non-decreasing, got ${bounds.join(', ')}`)
    }
  }
}

/** 0 at and below `a`, rising linearly to 1 at `b`, 1 above. */
export const rampUp = (a: number, b: number): Curve => {
  ascending('rampUp', [a, b])

  return withSpec(
    (x) => {
      if (x >= b) return 1
      if (x <= a) return 0
      return (x - a) / (b - a)
    },
    { kind: 'rampUp', bounds: [a, b] },
  )
}

/** 1 at and below `a`, falling linearly to 0 at `b`, 0 above. */
export const rampDown = (a: number, b: number): Curve => {
  ascending('rampDown', [a, b])

  return withSpec(
    (x) => {
      if (x >= b) return 0
      if (x <= a) return 1
      return (b - x) / (b - a)
    },
    { kind: 'rampDown', bounds: [a, b] },
  )
}

/** 0 at and below `a`, 1 across `[b, c]`, back to 0 at and above `d`. */
export const band = (a: number, b: number, c: number, d: number): Curve => {
  ascending('band', [a, b, c, d])
  const up = rampUp(a, b)
  const down = rampDown(c, d)

  return withSpec((x) => (x <= b ? up(x) : down(x)), { kind: 'band', bounds: [a, b, c, d] })
}
