import { describe, expect, it } from 'vitest'
import { parseConfig } from './config.ts'

/**
 * Configuration parsing is pure and tested as such. The process-exiting part
 * stays in the module body where it belongs, and nothing that exits a process
 * is worth testing through a test runner that lives in the same one.
 */
describe('parseConfig', () => {
  it('runs on an empty environment, so a reviewer can start it with no setup', () => {
    const result = parseConfig({})

    expect(result.success).toBe(true)
    expect(result.success && result.config).toEqual({
      PORT: 4000,
      MONGODB_URI: 'mongodb://localhost:27017',
      MONGODB_DB: 'activity_weather',
      REFRESH_INTERVAL_MS: 600_000,
    })
  })

  it('takes zero as "no background refresher", which is a real deployment', () => {
    // A second instance behind the same database does not need a second
    // refresher, and neither does a laptop running the tests.
    const result = parseConfig({ REFRESH_INTERVAL_MS: '0' })

    expect(result.success && result.config.REFRESH_INTERVAL_MS).toBe(0)
  })

  it('coerces PORT out of the string the environment always gives it', () => {
    const result = parseConfig({ PORT: '8080' })

    expect(result.success && result.config.PORT).toBe(8080)
  })

  it('refuses a port that is not a port, naming the variable', () => {
    const result = parseConfig({ PORT: 'four thousand' })

    expect(result.success).toBe(false)
    expect(result.success ? [] : result.problems.join(' ')).toContain('PORT')
  })

  it('refuses an empty connection string rather than defaulting around it', () => {
    // Defaulting here would point a misconfigured deployment at localhost and
    // let it look healthy while writing nowhere.
    const result = parseConfig({ MONGODB_URI: '' })

    expect(result.success).toBe(false)
    expect(result.success ? [] : result.problems.join(' ')).toContain('MONGODB_URI')
  })

  it('ignores variables it does not know about', () => {
    const result = parseConfig({ PATH: '/usr/bin', HOME: '/root' })

    expect(result.success).toBe(true)
  })
})
