import { band, rampDown, rampUp } from '../curves.ts'
import type { Profile } from '../score.ts'

/**
 * Surfing, for a competent general traveller rather than an expert.
 *
 * That assumption has teeth: sanity row 3 (2.5 m at 15 s) is EXCELLENT for an
 * expert and GOOD here, because a clean overhead day is not what the population
 * this service serves is asking for. Decision #33 records it out loud.
 *
 * ## Period, not height
 *
 * Recon assumed wave height would separate ocean swell from lake chop and
 * measured the opposite: Chicago on Lake Michigan read 0.88 m at 4.60 s while
 * Lisbon read 0.44 m at 6.90 s. The lake had the bigger wave. Period is what
 * discriminates, and it discriminates *surfable days* rather than *surfable
 * places* — Lake Michigan is fetch-limited and will essentially never exceed
 * 8 s, the Atlantic regularly will, and no list of places is involved.
 *
 * ## Wind is a gate
 *
 * A blown-out day is not a slightly worse day: the swell is still there and the
 * surface is unusable. Weighting it could not satisfy row 4 alongside row 3
 * without the height weight going negative, which is the same shape of problem
 * skiing row 4 has. Decision #37.
 */
export const surfing: Profile = {
  activity: 'surfing',
  requires: 'marine',
  series: 'city',
  gates: [
    {
      name: 'swellPresent',
      input: 'wavePeriodMax',
      // Below chop, there is nothing to ride at any height.
      curve: rampUp(4, 8),
      source:
        'Two anchors, one measured and one cited. Measured: the probes put fetch-limited chop at ' +
        '4.60 s (Chicago, Lake Michigan) and 4.65 s (Canterbury), which is water with no swell in ' +
        'it. Cited: 8-9 s is the windswell ceiling below which quality is described as poor. ' +
        'https://www.surfline.com/surf-news/groundswell-vs-windswell/2439',
    },
    {
      name: 'blownOut',
      input: 'windSpeedMax',
      curve: rampDown(18, 37),
      source:
        'Surf forecasting convention: under 10 knots (18 km/h) the surface stays clean, over ' +
        '20 knots (37 km/h) the surf is blown out. ' +
        'https://surfcaptain.com/blog/1/understanding-wind-condition-forecast',
    },
  ],
  factors: [
    {
      name: 'wavePeriod',
      weight: 1,
      input: 'wavePeriodMax',
      // Zero through windswell, full marks once it is solid groundswell.
      curve: rampUp(8, 12),
      source:
        'Windswell is below 8-9 s and described as poor quality; groundswell begins at 10 s and ' +
        'carries the energy that makes a wave rideable. Full marks stop at 12 s rather than the ' +
        '14 s "powerful" threshold because more power is not more value for this population. ' +
        'https://www.surfline.com/surf-news/groundswell-vs-windswell/2439',
    },
    {
      name: 'waveHeight',
      weight: 1,
      input: 'waveHeightMax',
      // Nothing to ride below 0.3 m, ideal at waist-to-head, overhead falls off.
      curve: band(0.3, 0.6, 1.5, 2.8),
      source:
        'Surf schools put beginners at 1-3 ft and intermediates at 2-4 ft, with overhead waves ' +
        'reserved for experienced surfers. This curve is what decision #33 cashes out into. ' +
        'https://surflearner.com/the-perfect-wave-size-for-beginner-surfers/',
    },
  ],
}
