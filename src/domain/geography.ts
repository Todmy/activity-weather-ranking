import type { Geography } from './activityResult.ts'

/**
 * Turning a measurement into the two booleans the profiles ask about.
 *
 * Pure, and in `domain/` on purpose: this decides whether skiing is answerable
 * at all, so it belongs with the model rather than with the code that fetched
 * the numbers. It is also why the threshold below travels in `serialiseModel()`
 * — moving it changes answers.
 */

/**
 * A cost gate, not a ski test.
 *
 * Recon measured elevation against 16 cities and falsified the idea that it
 * separates ski from non-ski: Oslo skis at 631 m and sits *below* Barcelona at
 * 1025 m and Munich at 1014 m, which do not. Latitude is the missing variable,
 * and the snow forecast already carries it — so the threshold survives only to
 * decide whether a second forecast request at the high point is worth making.
 *
 * Deliberately low. A false `notApplicable` is permanent and invisible; a false
 * "applicable" costs one request and then scores badly on its own merits.
 *
 * Source: `docs/recon.md`, elevation calibration over 16 cities.
 */
export const TERRAIN_MIN_ELEVATION_M = 300

export const geographyFrom = (
  terrain: { maxElevation: number } | undefined,
  marineCoverage: 'present' | 'none' | undefined,
): Geography => ({
  // Each side is reported independently, because the two samples are taken
  // independently and can fail apart. `null` is "not assessed", never "no".
  hasTerrain: terrain === undefined ? null : terrain.maxElevation >= TERRAIN_MIN_ELEVATION_M,
  hasMarineCoverage: marineCoverage === undefined ? null : marineCoverage === 'present',
})
