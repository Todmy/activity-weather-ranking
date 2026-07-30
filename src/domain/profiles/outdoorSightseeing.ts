import { band, rampDown } from '../curves.ts'
import type { Profile } from '../score.ts'

/**
 * Outdoor sightseeing: walking around a city looking at things.
 *
 * Two different kinds of number live in this file and they are justified
 * differently, which is worth being explicit about.
 *
 * **Thresholds cite a published convention.** Each one is named in the factor's
 * `source` and can be looked up and disagreed with. None of them was chosen to
 * make a row pass.
 *
 * **Weights are fitted to the sanity table** in `docs/sanity-table.md`, written
 * before this file existed. No published source ranks "cold" against "grey", so
 * the sanity rows are the target and the weights are what reproduces them. When
 * the rows pass, tuning stops.
 *
 * ## UV is not a factor here, and that is a finding rather than an omission
 *
 * Sanity row 4 (31 °C, sunny, UV 9, still → FAIR) names UV as its reason, so UV
 * started as a weighted factor. It cannot work in an additive model: a factor
 * that reads "no burn risk" scores 1.0 on a cold rainy day, so any weight large
 * enough to pull a hot day down to FAIR also hands a miserable day the same
 * points, and row 3 came out FAIR instead of POOR. Weighted sums can express
 * "this is nice"; they cannot express "this is harmful" without paying for it
 * everywhere else.
 *
 * So heat is carried by apparent temperature, which the comfort scale below is
 * defined over and which already folds in radiation and humidity. Row 4 still
 * lands FAIR, by the same physics and a different route. The gap is real and
 * recorded: extreme UV under a *cool* sky would not currently be penalised.
 * Decision #36.
 */
export const outdoorSightseeing: Profile = {
  activity: 'outdoorSightseeing',
  requires: null,
  series: 'city',
  factors: [
    {
      name: 'thermalComfort',
      weight: 9,
      input: 'apparentTemperatureMax',
      // Rises across slight cold stress, plateaus over no thermal stress, falls
      // across moderate heat stress and reaches zero where strong heat begins.
      curve: band(0, 9, 26, 32),
      source:
        'UTCI (Universal Thermal Climate Index) thermal stress categories: 0-9 °C slight cold ' +
        'stress, 9-26 °C no thermal stress, 26-32 °C moderate heat stress, above 32 °C strong ' +
        'heat stress. https://thermofeel.readthedocs.io/en/latest/guide/utci.html',
    },
    {
      name: 'precipitation',
      weight: 3,
      input: 'precipitationSum',
      // Dry until the wet-day threshold, nothing left by a heavy-rain day.
      curve: rampDown(1, 10),
      source:
        'ETCCDI daily precipitation indices: R1mm counts a wet day at 1 mm or more, R10mm counts ' +
        'a heavy precipitation day at 10 mm or more. https://etccdi.pacificclimate.org/list_27_indices.shtml',
    },
    {
      name: 'wind',
      weight: 3,
      input: 'windSpeedMax',
      // Comfortable to the top of a gentle breeze, gone where a strong breeze
      // ends and umbrellas stop working.
      curve: rampDown(19, 50),
      source:
        'Beaufort wind force scale: force 4 (20-28 km/h) raises dust and loose paper, force 6 ' +
        '(39-49 km/h) is where umbrellas are used with difficulty. ' +
        'https://www.spc.noaa.gov/faq/tornado/beaufort.html',
    },
    {
      name: 'sky',
      weight: 5,
      input: 'cloudCoverMean',
      // Full marks to a few clouds, nothing to a closed grey lid.
      curve: rampDown(25, 100),
      source:
        'WMO/METAR sky cover in oktas: FEW is 1-2 oktas (up to 25% of the sky), OVC is 8 oktas ' +
        '(100%). https://skybrary.aero/articles/meteorological-aerodrome-report-metar',
    },
  ],
}
