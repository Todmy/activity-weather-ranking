/**
 * The timer half of the background refresher, kept apart from the decision half
 * so that neither has to be tested through the other: `refresher.ts` is called
 * directly by tests that own the clock, and this file is the only place in the
 * service that knows what `setTimeout` is.
 *
 * The next run is scheduled when the previous one *finishes*, not on a fixed
 * cadence. A tick can outlast its interval — twenty locations at up to eight
 * seconds an upstream call — and overlapping ticks would fight for the same
 * leases while doubling the request rate.
 */
export type ScheduleOptions = {
  intervalMs: number
  run: () => Promise<void>
  /** A throwing run must not end the schedule for the life of the process. */
  onError?: (error: unknown) => void
}

export type Schedule = {
  /**
   * Stops the schedule and waits for the run in flight.
   *
   * The waiting is the point. `ensureFresh` releases its lease in a `finally`,
   * so a shutdown that closed the database under a running tick would throw
   * there and strand the lease for its full thirty seconds — blocking every
   * refresh of that city, including the ones from real requests.
   */
  stop: () => Promise<void>
}

export const startSchedule = ({ intervalMs, run, onError }: ScheduleOptions): Schedule => {
  let timer: ReturnType<typeof setTimeout> | undefined
  let stopped = false
  let inFlight: Promise<void>

  const cycle = async (): Promise<void> => {
    try {
      await run()
    } catch (error) {
      onError?.(error)
    }

    if (!stopped) {
      timer = setTimeout(() => {
        inFlight = cycle()
      }, intervalMs)
    }
  }

  // Immediately, so the first thing a reviewer sees in the container log is the
  // refresher deciding what to do rather than ten minutes of silence.
  inFlight = cycle()

  return {
    stop: async () => {
      stopped = true
      if (timer !== undefined) clearTimeout(timer)
      await inFlight
    },
  }
}
