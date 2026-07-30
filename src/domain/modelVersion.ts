import type { CurveSpec } from './curves.ts'
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
 */
export const MODEL_VERSION = '1.0.0'

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
  gates: { name: string; input: string; curve: CurveSpec; source: string }[]
}

export type SerialisedModel = {
  version: string
  profiles: SerialisedProfile[]
}

/**
 * Every number the domain scores with, in one comparable value. Sources are
 * included deliberately: a threshold whose justification changed is a different
 * model, even when the number happens to land in the same place.
 */
export const serialiseModel = (): SerialisedModel => ({
  version: MODEL_VERSION,
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
      source: gate.source,
    })),
  })),
})
