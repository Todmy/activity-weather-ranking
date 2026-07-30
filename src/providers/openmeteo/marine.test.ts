import { readFileSync } from 'node:fs'
import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  buildMarineUrl,
  coverageOf,
  fetchMarine,
  MARINE_VARIABLES,
  parseMarine,
  toDailyMarine,
} from './marine.ts'

const probe = (name: string) =>
  JSON.parse(
    readFileSync(new URL(`../../../docs/probes/${name}.json`, import.meta.url), 'utf8'),
  ) as unknown

const lisbon = probe('marine-lisbon-past3')
const vienna = probe('marine-vienna-past3')
// The recon-era captures. Two days each, kept because they are what falsified
// the distance rule: Canterbury is 14 km inland and still has data.
const canterbury = probe('marine-canterbury-14km-in')
const milan = probe('marine-milan-110km-in')
const chicago = probe('marine-chicago-lake')

describe('MARINE_VARIABLES', () => {
  it('matches the variables the fixtures were captured with', () => {
    // A fixture is evidence about the live API only while the request still
    // matches it, so the pinned list is asserted against the probe's own keys
    // rather than against the documentation.
    const keys = Object.keys((lisbon as { daily: Record<string, unknown> }).daily).filter(
      (key) => key !== 'time',
    )
    expect([...MARINE_VARIABLES]).toEqual(keys)
  })
})

describe('coverageOf', () => {
  it('reads an all-null response as no coverage', () => {
    // Vienna. The wave model has no water at that coordinate, and rather than
    // erroring or snapping to a distant sea cell it answers with nulls
    // throughout. That is the coverage signal.
    expect(coverageOf(parseMarine(vienna))).toBe('none')
  })

  it('reads a populated response as coverage', () => {
    expect(coverageOf(parseMarine(lisbon))).toBe('present')
  })

  it('gives Canterbury coverage at 14 km inland, which is why distance is not the rule', () => {
    // The designed mechanism was haversine between the requested coordinate and
    // the cell the model used. Canterbury killed it: 14 km from the water and
    // fully populated, so any distance threshold that excludes it also excludes
    // real coastal towns.
    expect(coverageOf(parseMarine(canterbury))).toBe('present')
  })

  it('gives Milan none at 110 km inland', () => {
    expect(coverageOf(parseMarine(milan))).toBe('none')
  })

  it('gives Chicago coverage, because a lake is water', () => {
    // Coverage is not the same question as good surf. Chicago has waves and
    // they are 4.6 s of lake chop; the swell gate is what handles that, not
    // this function (decision #37).
    expect(coverageOf(parseMarine(chicago))).toBe('present')
  })

  it('treats a single populated day as coverage, not a majority vote', () => {
    // Coverage is a property of the coordinate, not of the week. One real
    // number proves the model has water there.
    const patchy = {
      ...(vienna as { daily: Record<string, unknown[]> }),
      daily: {
        ...(vienna as { daily: Record<string, unknown[]> }).daily,
        wave_height_max: [null, 0.3, null, null, null, null, null, null, null, null],
      },
    }
    expect(coverageOf(parseMarine(patchy))).toBe('present')
  })
})

describe('toDailyMarine', () => {
  const days = toDailyMarine(parseMarine(lisbon))

  it('carries one entry per day, keyed by the local date', () => {
    expect(days).toHaveLength(10)
    expect(days[0]?.date).toBe('2026-07-27')
    expect(days.at(-1)?.date).toBe('2026-08-05')
  })

  it('maps only the four inputs the surf profile scores', () => {
    expect(days[0]).toEqual({
      date: '2026-07-27',
      waveHeightMax: 0.5,
      wavePeriodMax: 7.05,
      swellWaveHeightMax: 0.46,
      swellWavePeriodMax: 6.75,
    })
  })

  it('preserves nulls rather than substituting zero', () => {
    // Zero wave height is a flat calm the profile should score. A missing
    // measurement is not, and completeness has to be able to tell them apart.
    const [first] = toDailyMarine(parseMarine(vienna))
    expect(first?.waveHeightMax).toBeNull()
    expect(first?.wavePeriodMax).toBeNull()
  })
})

describe('buildMarineUrl', () => {
  const url = new URL(buildMarineUrl({ latitude: 38.7223, longitude: -9.1393 }))

  it('asks for the same ten days the forecast does, so the arrays line up', () => {
    // past_days=3 exists for the fresh-snow window on land (#39). Marine
    // carries it too, purely so a marine day and a forecast day share an index
    // instead of needing a join by date.
    expect(url.searchParams.get('past_days')).toBe('3')
    expect(url.searchParams.get('forecast_days')).toBe('7')
  })

  it('goes to the marine host, which is a different model from the forecast', () => {
    expect(url.host).toBe('marine-api.open-meteo.com')
    expect(url.searchParams.get('timezone')).toBe('auto')
  })
})

describe('fetchMarine', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
  })

  const stubFetch = (response: Response) => {
    const spy = vi.fn(async () => response)
    vi.stubGlobal('fetch', spy)
    return spy
  }

  it('returns the coverage and the days together, since one request answers both', async () => {
    const spy = stubFetch(new Response(JSON.stringify(lisbon), { status: 200 }))

    const result = await fetchMarine({ latitude: 38.7223, longitude: -9.1393 })

    expect(result.coverage).toBe('present')
    expect(result.days).toHaveLength(10)
    expect(spy).toHaveBeenCalledWith(buildMarineUrl({ latitude: 38.7223, longitude: -9.1393 }), {
      signal: expect.any(AbortSignal),
    })
  })

  it('passes the caller\'s abort signal down to the socket', async () => {
    const spy = stubFetch(new Response(JSON.stringify(lisbon), { status: 200 }))
    const signal = AbortSignal.timeout(8_000)

    await fetchMarine({ latitude: 38.7223, longitude: -9.1393 }, signal)

    expect(spy).toHaveBeenCalledWith(expect.any(String), { signal })
  })

  it('returns no coverage and no days for an inland coordinate', async () => {
    stubFetch(new Response(JSON.stringify(vienna), { status: 200 }))

    const result = await fetchMarine({ latitude: 48.2082, longitude: 16.3738 })

    expect(result.coverage).toBe('none')
    expect(result.days).toEqual([])
  })

  it('turns an upstream failure into an error carrying the status', async () => {
    stubFetch(new Response('The service is overloaded', { status: 503 }))

    await expect(fetchMarine({ latitude: 38.7223, longitude: -9.1393 })).rejects.toMatchObject({
      name: 'OpenMeteoError',
      status: 503,
    })
  })
})
