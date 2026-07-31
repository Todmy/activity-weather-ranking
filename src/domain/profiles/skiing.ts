import { band, rampDown, rampUp } from '../curves.ts'
import type { Profile } from '../score.ts'

/**
 * Skiing, assessed at the sampled high point rather than at the city.
 *
 * Grenoble sits at 214 m and is one of the best ski bases in Europe; scoring
 * the city coordinate would answer "you cannot ski here", which is not a
 * defensible thing to tell someone. `series: 'summit'` is what says so, and
 * slice 3 is what supplies that series.
 *
 * Thresholds cite published conventions and weights are fitted to the five ski
 * rows of `docs/sanity-table.md`. The same split as every profile here: a
 * reader can disagree with a weight by disagreeing with the table, and with a
 * threshold by following its link.
 *
 * ## Two gates, and both of them are the point
 *
 * A weighted mean cannot say "none of that matters", and skiing needs that
 * sentence twice. `snowPresent` is the one this profile shipped without: with
 * no snow the temperature and fresh-snow factors surrender their own weight
 * and nothing more, so wind and rain carried a bare 14 °C summit to 35 out of
 * 100 — and ranked it the best ski day of the week. Sanity rows 6-8 and [S10]
 * are the correction; decision #56.
 *
 * Sanity row 4 is 40 cm of fresh powder under 70 km/h gusts and the table says
 * POOR, because resorts hold lifts before that. No weighted mean can express
 * it: dragging an otherwise perfect day down to 39 takes 61% of the weight on
 * wind, and at that weight row 2 — calm, cold, nothing fresh — comes out GOOD
 * when the table says FAIR. So the lift hold is a gate that multiplies, and the
 * factors go on describing the snow underneath it. Decision #37.
 */
export const skiing: Profile = {
  activity: 'skiing',
  requires: 'terrain',
  series: 'summit',
  gates: [
    {
      name: 'snowPresent',
      input: 'snowDepth',
      // Shut on bare ground, fully open at the depth the literature calls
      // skiable. Neither anchor is fitted.
      curve: rampUp(0, 30),
      // The one gate in this service that must not hold open. Snow is the
      // precondition of skiing, not an obstacle to it, so a missing depth
      // reading is not "the lifts might be running" — it is no answer at all.
      // Holding it open scored a bare 14 C summit at 35, which is the bug this
      // gate was written to fix, reached through the gate itself.
      onMissingInput: 'unscorable',
      source:
        'The "100-day rule": natural snow reliability requires cover of at least 30 cm on at ' +
        'least 100 days between 16 December and 15 April, in 7 winters out of 10. Witmer (1984), ' +
        'developed by Abegg (1996) and Burki (2000), adopted by the OECD as the reference ' +
        'approach for climate impact on Alpine winter tourism. The lower anchor is not cited ' +
        'because it needs no citation: zero snow is zero skiing. ' +
        'https://www.oecd.org/content/dam/oecd/en/publications/reports/2007/01/climate-change-in-the-european-alps_g1gh7c4d/9789264031692-en.pdf',
    },
    {
      name: 'liftsHeld',
      input: 'windGustsMax',
      // Open below the band where resorts start holding lifts, shut above it.
      curve: rampDown(56, 72),
      source:
        'Resort operations: lifts slow around 56 km/h (35 mph) and 64 km/h (40 mph) is widely ' +
        'described as the tipping point, depending on lift orientation. The lower anchor is that ' +
        '56 verbatim. The upper anchor of 72 is FITTED, not cited: it places the cited 64 exactly ' +
        'at the midpoint, where the gate is half shut — reading "the tipping point" as the gust at ' +
        'which holding becomes as likely as running, rather than as the point of no return. ' +
        'Anchoring the zero at 64 instead scores sanity row 4 at 40 = FAIR, and the table says ' +
        'POOR. https://blog.steamboat.com/navigating-windy-days-at-steamboat-ski-resort-a-qa-with-jake-ingle/',
    },
  ],
  factors: [
    {
      name: 'temperature',
      weight: 7,
      input: 'temperatureMax',
      // Zero where 30-minute frostbite begins, plateau across the cold-and-dry
      // range, zero again once rain replaces snow.
      curve: band(-28, -18, -1, 3),
      source:
        'NWS wind chill chart: frostbite on exposed skin within 30 minutes between roughly ' +
        '-18 °C and -28 °C. Warm edge is the melting point — above freezing the surface goes. ' +
        'https://www.weather.gov/safety/cold-wind-chill-chart',
    },
    {
      name: 'freshSnow',
      weight: 6,
      input: 'snowfall3d',
      // Nothing at a dusting, full marks at a powder day.
      curve: rampUp(2, 20),
      source:
        'Powder Magazine poll of 1,000+ skiers: a powder day starts between 6 and 11 inches ' +
        '(15-28 cm) of new snow. A convention among skiers rather than a physical constant, and ' +
        'cited as one. https://www.powder.com/news/how-much-new-snow-counts-as-a-powder-day-poll',
    },
    {
      name: 'wind',
      weight: 4,
      input: 'windGustsMax',
      // Unpleasantness below the hold, separate from the hold itself.
      curve: rampDown(29, 56),
      source:
        'Beaufort force 5 begins at 29 km/h, where wind stops being background; the upper bound ' +
        'is where the lift-hold gate takes over. https://www.spc.noaa.gov/faq/tornado/beaufort.html',
    },
    {
      name: 'rain',
      weight: 3,
      input: 'rainSum',
      curve: rampDown(0.5, 3),
      source:
        'Rain on snow adds heat and load at once and forms an icy crust that later snow slides ' +
        'off: a different surface rather than a degraded one. ' +
        'https://avalanche.org/avalanche-encyclopedia/snowpack/snowpack-observations/signs-of-instability-red-flags/rain-on-snow/',
    },
  ],
}
