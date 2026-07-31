import type { CurveSpec } from './curves.ts'
import { TERRAIN_MIN_ELEVATION_M } from './geography.ts'
import { indoorSightseeing } from './profiles/indoorSightseeing.ts'
import { outdoorSightseeing } from './profiles/outdoorSightseeing.ts'
import { skiing } from './profiles/skiing.ts'
import { surfing } from './profiles/surfing.ts'
import type { Profile } from './score.ts'

/**
 * One version covering everything that can change a score.
 *
 * A content hash could not be forgotten but would tell a reviewer nothing; a
 * semver is readable and relies on somebody remembering. The snapshot test over
 * `serialiseModel()` removes the reliance: move a threshold and the snapshot
 * fails, and the diff that updates it has the version sitting in it.
 *
 * Bump minor for a new profile or factor, major for anything that changes an
 * existing score.
 *
 * 1.1.0 adds the terrain gate. Nothing already scored moves, but skiing becomes
 * answerable where it previously could not be, which is a new capability rather
 * than a changed number.
 *
 * 2.0.0 adds skiing's snow gate, and it is major by this file's own rule
 * because existing scores move: a bare 14 °C summit went from 35 to 0.
 *
 * 3.0.0 stops that gate holding open on a missing depth reading. Major for the
 * same reason and by the same example: the summit that 2.0.0 took to 0 went
 * back to 35 whenever the reading was absent, because the gate it was fixed
 * with could not tell "no snow" from "no reading". It now answers neither.
 *
 * The bump was nearly missed. Nothing in the gate's name, input, curve bounds
 * or source moved, so `serialiseModel` saw an unchanged model and the snapshot
 * passed. `onMissingInput` is serialised from 3.0.0 onward, which is what makes
 * the next change of this shape impossible to ship quietly.
 */
export const MODEL_VERSION = '3.0.0'

export const PROFILES: readonly Profile[] = [
  skiing,
  surfing,
  outdoorSightseeing,
  indoorSightseeing,
]

type SerialisedFactor = {
  name: string
  weight: number
  input: string
  curve: CurveSpec
  source: string
}

type SerialisedProfile = {
  activity: string
  requires: string | null
  series: string
  floor: number
  factors: SerialisedFactor[]
  gates: {
    name: string
    input: string
    curve: CurveSpec
    /**
     * Not a bound and not a weight, so the profile shape alone missed it — and
     * it moves scores: flipping this on skiing's snow gate took a bare summit
     * from 35 to no answer at all, with every number in the model unchanged.
     */
    onMissingInput: 'open' | 'unscorable'
    source: string
  }[]
}

export type SerialisedModel = {
  version: string
  /**
   * Not a weight and not a curve, so the profile shape alone would have missed
   * it — and it changes more than a score does: 300 m is the difference between
   * "Amsterdam has no mountain" and Amsterdam being asked the question at all.
   */
  geography: { terrainMinElevationM: number; source: string }
  profiles: SerialisedProfile[]
}

/**
 * Every number the domain scores with, in one comparable value. Sources are
 * included deliberately: a threshold whose justification changed is a different
 * model, even when the number happens to land in the same place.
 */
export const serialiseModel = (): SerialisedModel => ({
  version: MODEL_VERSION,
  geography: {
    terrainMinElevationM: TERRAIN_MIN_ELEVATION_M,
    source: 'docs/recon.md, elevation calibration over 16 cities',
  },
  profiles: PROFILES.map((profile) => ({
    activity: profile.activity,
    requires: profile.requires,
    series: profile.series,
    floor: profile.floor ?? 0,
    factors: profile.factors.map((factor) => ({
      name: factor.name,
      weight: factor.weight,
      input: factor.input,
      curve: factor.curve.spec,
      source: factor.source,
    })),
    gates: (profile.gates ?? []).map((gate) => ({
      name: gate.name,
      input: gate.input,
      curve: gate.curve.spec,
      onMissingInput: gate.onMissingInput ?? 'open',
      source: gate.source,
    })),
  })),
})
