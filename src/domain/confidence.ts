/**
 * How much to trust a score, as distinct from the score itself.
 *
 * Two independent things can go wrong with a ranking, and a caller can see
 * neither from the number:
 *
 *   - the forecast behind it is six days out
 *   - half the inputs the profile wanted were not in the response
 *
 * `confidence = horizonSkill(dayIndex) × completeness` keeps both visible.
 * Principle 5: a day-7 number presented like a day-1 number is a product bug,
 * not a rounding detail.
 */

/**
 * Published forecast accuracy, interpolated between the points NOAA states:
 * a five-day forecast is right about 90% of the time, a seven-day about 80%,
 * and ten days out about half.
 *
 * https://scijinks.gov/forecast-reliability/
 *
 * Day 0 is today, so NOAA's "five-day forecast" is index 4.
 *
 * The day-0 anchor is the one number here NOAA does not give, and it is a
 * judgement rather than a citation: today's forecast is very good and is not a
 * promise, so 0.97. Flagged the same way the sanity table flags its arguable
 * rows — a reader who disagrees can see exactly what they are disagreeing with,
 * and every other point on this curve is somebody else's measurement.
 */
const ANCHORS: readonly (readonly [day: number, skill: number])[] = [
  [0, 0.97],
  [4, 0.9],
  [6, 0.8],
  [9, 0.5],
]

type Anchor = readonly [day: number, skill: number]

const interpolate = (x: number, [x0, y0]: Anchor, [x1, y1]: Anchor): number =>
  y0 + ((y1 - y0) * (x - x0)) / (x1 - x0)

/** The segment `dayIndex` falls in, or the last one, so it keeps declining. */
const segmentFor = (dayIndex: number): [Anchor, Anchor] => {
  for (let i = 0; i < ANCHORS.length - 1; i++) {
    if (dayIndex <= ANCHORS[i + 1]![0]) return [ANCHORS[i]!, ANCHORS[i + 1]!]
  }

  return [ANCHORS[ANCHORS.length - 2]!, ANCHORS[ANCHORS.length - 1]!]
}

export const horizonSkill = (dayIndex: number): number => {
  const [from, to] = segmentFor(dayIndex)

  // Past the last anchor the final slope continues rather than flattening: a
  // plateau there would be a claim about long-range skill that nothing here
  // supports.
  return Math.min(0.97, Math.max(0, interpolate(dayIndex, from, to)))
}

export const confidenceFor = (dayIndex: number, completeness: number): number =>
  Math.round(horizonSkill(dayIndex) * completeness * 100) / 100
