import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { startSchedule } from './schedule.ts'

/**
 * Timers, isolated here so nothing else has to know about them.
 *
 * They are faked rather than waited on: a test that really sleeps ten minutes to
 * prove an interval works is a test nobody runs. What is being pinned down is
 * the shutdown behaviour — a worker that dies mid-refresh strands a lease for
 * thirty seconds, and that is a real outage for that city.
 */
beforeEach(() => {
  vi.useFakeTimers()
})

afterEach(() => {
  vi.useRealTimers()
})

const deferred = () => {
  let release: () => void = () => undefined
  const promise = new Promise<void>((resolve) => {
    release = resolve
  })
  return { promise, release }
}

describe('startSchedule', () => {
  it('runs once immediately, so a reviewer sees it at boot', async () => {
    const run = vi.fn(async () => undefined)

    const schedule = startSchedule({ intervalMs: 1000, run })
    await vi.advanceTimersByTimeAsync(0)

    expect(run).toHaveBeenCalledTimes(1)
    await schedule.stop()
  })

  it('runs again after the interval', async () => {
    const run = vi.fn(async () => undefined)

    const schedule = startSchedule({ intervalMs: 1000, run })
    await vi.advanceTimersByTimeAsync(2100)

    expect(run).toHaveBeenCalledTimes(3)
    await schedule.stop()
  })

  it('never overlaps two runs, because the next one is scheduled after this one ends', async () => {
    // A tick can outlast its interval — twenty locations at up to eight seconds
    // an upstream call. Overlapping ticks would fight each other for the same
    // leases and double the request rate at exactly the wrong moment.
    const slow = deferred()
    const run = vi.fn(async () => await slow.promise)

    const schedule = startSchedule({ intervalMs: 1000, run })
    await vi.advanceTimersByTimeAsync(5000)

    expect(run).toHaveBeenCalledTimes(1)

    slow.release()
    await vi.advanceTimersByTimeAsync(1000)
    expect(run).toHaveBeenCalledTimes(2)

    await schedule.stop()
  })

  it('waits for the run in flight before it returns, so no lease is stranded', async () => {
    // The lease is released in `ensureFresh`'s finally. Closing the database out
    // from under a running tick would throw there and leave the lease held for
    // its full thirty seconds — every refresh of that city blocked meanwhile.
    //
    // Asserted as an order rather than a flag: `await schedule.stop()` drains
    // the microtask queue either way, so a flag set by the run would be true by
    // the time it was read even if stop() had not waited for anything. The run
    // is held open by a timer for the same reason — a promise resolved in the
    // same tick cannot tell the two apart.
    const order: string[] = []
    const run = vi.fn(async () => {
      await new Promise((resolve) => setTimeout(resolve, 5000))
      order.push('run finished')
    })

    const schedule = startSchedule({ intervalMs: 1000, run })
    await vi.advanceTimersByTimeAsync(0)

    const stopping = schedule.stop().then(() => order.push('stopped'))
    await vi.advanceTimersByTimeAsync(5000)
    await stopping

    expect(order).toEqual(['run finished', 'stopped'])
  })

  it('runs nothing more once stopped, even when the stop lands mid-run', async () => {
    // The case `clearTimeout` alone does not cover: stopping while a run is in
    // flight means there is no timer to clear yet, and the run schedules the
    // next one when it finishes. A refresher that keeps ticking after shutdown
    // is a refresher that outlives the database handle it uses.
    const slow = deferred()
    const run = vi.fn(async () => await slow.promise)

    const schedule = startSchedule({ intervalMs: 1000, run })
    await vi.advanceTimersByTimeAsync(0)

    const stopping = schedule.stop()
    slow.release()
    await stopping
    await vi.advanceTimersByTimeAsync(10_000)

    expect(run).toHaveBeenCalledTimes(1)
  })

  it('keeps going when a run throws, and hands the error to the caller', async () => {
    // An hour of upstream trouble must not silently end the refresher for the
    // lifetime of the process.
    const onError = vi.fn()
    const run = vi
      .fn<() => Promise<void>>()
      .mockRejectedValueOnce(new Error('mongo went away'))
      .mockResolvedValue(undefined)

    const schedule = startSchedule({ intervalMs: 1000, run, onError })
    await vi.advanceTimersByTimeAsync(1100)

    expect(onError).toHaveBeenCalledWith(new Error('mongo went away'))
    expect(run).toHaveBeenCalledTimes(2)

    await schedule.stop()
  })
})
