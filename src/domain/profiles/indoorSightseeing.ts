import { rampDown, rampUp } from '../curves.ts'
import type { Profile } from '../score.ts'

/**
 * Indoor sightseeing: museums, galleries, the covered market.
 *
 * **Not the inverse of outdoor sightseeing**, which is the modelling point most
 * easily missed here. Three things are true at once and no single "how bad is
 * the weather" axis can hold them:
 *
 *   - the activity is always available, so it has a floor rather than a zero.
 *     A perfect beach day scores 55, because nothing prevents a museum, it is
 *     simply a waste of the afternoon.
 *   - weather that is unpleasant but harmless raises it. Rain, cold and a grey
 *     lid are exactly what makes going indoors the right call.
 *   - weather that is dangerous lowers it, and the same 90 km/h storm that
 *     makes outdoor sightseeing miserable makes this unreachable. Open is not
 *     the same as reachable, so that is a gate rather than a factor.
 *
 * Decisions #37 (gates) and #38 (the floor). Thresholds cite their sources;
 * the weights and the floor itself are fitted to the five indoor sanity rows.
 */
export const indoorSightseeing: Profile = {
  activity: 'indoorSightseeing',
  requires: null,
  series: 'city',
  floor: 0.55,
  gates: [
    {
      name: 'travelDisruption',
      input: 'windGustsMax',
      // Open below a yellow warning, unreachable well inside one.
      curve: rampDown(64, 90),
      source:
        'Met Office yellow wind warnings cite initial travel impacts from gusts of 64-72 km/h ' +
        '(40-45 mph): difficult driving, downed branches, disruption on exposed routes. ' +
        'https://weather.metoffice.gov.uk/guides/warnings',
    },
  ],
  factors: [
    {
      name: 'rain',
      weight: 8,
      // Liquid only. `precipitation_sum` includes the water equivalent of
      // snow, so scoring it here would pay a snowy day twice: once as rain and
      // again as snow. Outdoor sightseeing does use the total, because there
      // every form of precipitation degrades a walk in the same direction.
      input: 'rainSum',
      curve: rampUp(1, 10),
      source:
        'ETCCDI daily precipitation indices: 1 mm is a wet day, 10 mm a heavy precipitation day. ' +
        'The same two anchors outdoor sightseeing uses, pointed the other way. ' +
        'https://etccdi.pacificclimate.org/list_27_indices.shtml',
    },
    {
      name: 'sky',
      weight: 6,
      input: 'cloudCoverMean',
      // A closed grey lid is its own reason to be inside; a clear sky is not.
      curve: rampUp(25, 75),
      source:
        'WMO/METAR sky cover in oktas: FEW is up to 2 oktas (25%), BKN is 5-7 oktas (63-88%), at ' +
        'which point the sky is closed rather than merely cloudy. ' +
        'https://skybrary.aero/articles/meteorological-aerodrome-report-metar',
    },
    {
      name: 'cold',
      weight: 3,
      input: 'apparentTemperatureMax',
      curve: rampDown(2, 14),
      source:
        'UTCI puts slight cold stress below 9 °C and no thermal stress from 9 °C up; the ramp ' +
        'spans that boundary rather than sitting on it. ' +
        'https://thermofeel.readthedocs.io/en/latest/guide/utci.html',
    },
    {
      name: 'snow',
      weight: 3,
      input: 'snowfallSum',
      // Enough snow to make indoors appealing, not enough to strand anyone.
      curve: rampUp(1, 10),
      source:
        'Snowfall depth reported in cm; 1 cm is the point where a day reads as snowy at all and ' +
        '10 cm is a substantial city snowfall. The travel side of heavy snow is not modelled ' +
        'here — the gate is on wind, and this gap is named rather than implied.',
    },
  ],
}
