import { describe, expect, it } from 'vitest'
import { band, rampDown, rampUp } from './curves.ts'

/**
 * Written before curves.ts. These three primitives are the entire vocabulary in
 * which every threshold in the system is expressed, so their boundaries are the
 * one place where an off-by-one is worth a test each.
 */
describe('rampUp', () => {
  const curve = rampUp(10, 20)

  it('is zero below and at the lower bound', () => {
    expect(curve(0)).toBe(0)
    expect(curve(9.9)).toBe(0)
    expect(curve(10)).toBe(0)
  })

  it('rises linearly between the bounds', () => {
    expect(curve(15)).toBeCloseTo(0.5)
    expect(curve(12.5)).toBeCloseTo(0.25)
  })

  it('is one at and above the upper bound', () => {
    expect(curve(20)).toBe(1)
    expect(curve(1000)).toBe(1)
  })

  it('degenerates to a step when both bounds are equal', () => {
    const step = rampUp(5, 5)

    expect(step(4.9)).toBe(0)
    expect(step(5)).toBe(1)
  })

  it('rejects inverted bounds instead of silently inverting the meaning', () => {
    expect(() => rampUp(20, 10)).toThrow(RangeError)
  })
})

describe('rampDown', () => {
  const curve = rampDown(10, 20)

  it('is one below and at the lower bound', () => {
    expect(curve(-100)).toBe(1)
    expect(curve(10)).toBe(1)
  })

  it('falls linearly between the bounds', () => {
    expect(curve(15)).toBeCloseTo(0.5)
    expect(curve(17.5)).toBeCloseTo(0.25)
  })

  it('is zero at and above the upper bound', () => {
    expect(curve(20)).toBe(0)
    expect(curve(1000)).toBe(0)
  })

  it('degenerates to a step when both bounds are equal', () => {
    const step = rampDown(5, 5)

    expect(step(4.9)).toBe(1)
    expect(step(5)).toBe(0)
  })

  it('rejects inverted bounds', () => {
    expect(() => rampDown(20, 10)).toThrow(RangeError)
  })
})

describe('band', () => {
  const curve = band(0, 9, 26, 32)

  it('is zero outside the outer bounds', () => {
    expect(curve(-5)).toBe(0)
    expect(curve(0)).toBe(0)
    expect(curve(32)).toBe(0)
    expect(curve(40)).toBe(0)
  })

  it('is one across the plateau, inclusive of both plateau bounds', () => {
    expect(curve(9)).toBe(1)
    expect(curve(18)).toBe(1)
    expect(curve(26)).toBe(1)
  })

  it('rises on the way in and falls on the way out', () => {
    expect(curve(4.5)).toBeCloseTo(0.5)
    expect(curve(29)).toBeCloseTo(0.5)
  })

  it('allows a rectangular band with no ramps', () => {
    const rectangle = band(5, 5, 10, 10)

    expect(rectangle(4.9)).toBe(0)
    expect(rectangle(5)).toBe(1)
    expect(rectangle(10)).toBe(0)
  })

  it('rejects bounds that are not in non-decreasing order', () => {
    expect(() => band(9, 0, 26, 32)).toThrow(RangeError)
    expect(() => band(0, 9, 32, 26)).toThrow(RangeError)
    expect(() => band(0, 26, 9, 32)).toThrow(RangeError)
  })
})
