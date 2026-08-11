import type {
  WorkflowExecutionTimeBudget,
  WorkflowExecutionTimePolicy,
} from './workflow-execution-time-policy'

const MAX_TIMER_DELAY_MS = 2_147_483_647

export class AttemptTimeBudget implements WorkflowExecutionTimeBudget {
  private remaining: number | null
  private runningSince = Date.now()
  private timer: ReturnType<typeof setTimeout> | undefined
  private readonly activities = new Map<string, 'active' | 'queued-child-wait'>()
  private readonly pausedIntervals: Array<{ startedAt: number; endedAt: number }> = []
  private childProcessingIntervals: Array<{ startedAt: number; endedAt: number }> = []
  private paused = false
  private pausedAt: number | null = null
  readonly expired: Promise<void>
  private resolveExpired!: () => void

  constructor(
    private readonly policy: WorkflowExecutionTimePolicy,
    initialRemaining: number | null
  ) {
    this.remaining = initialRemaining
    this.expired = new Promise((resolve) => {
      this.resolveExpired = resolve
    })
    this.arm()
  }

  private currentRemaining() {
    if (this.remaining === null) return null
    return Math.max(0, this.remaining - (this.paused ? 0 : Date.now() - this.runningSince))
  }

  private commitElapsed() {
    if (this.remaining !== null && !this.paused) this.remaining = this.currentRemaining()
    this.runningSince = Date.now()
  }

  private arm() {
    if (this.timer) clearTimeout(this.timer)
    this.timer = undefined
    const remaining = this.currentRemaining()
    if (remaining === null || this.paused) return
    if (remaining <= 0) {
      this.resolveExpired()
      return
    }
    this.timer = setTimeout(() => this.arm(), Math.min(remaining, MAX_TIMER_DELAY_MS))
  }

  private syncPause() {
    const shouldPause =
      this.policy.kind === 'bounded' &&
      this.policy.accounting.mode === 'remaining' &&
      this.activities.size > 0 &&
      [...this.activities.values()].every((state) => state === 'queued-child-wait')
    if (shouldPause === this.paused) return
    const transitionAt = Date.now()
    this.commitElapsed()
    this.paused = shouldPause
    if (shouldPause) {
      this.pausedAt = transitionAt
    } else if (this.pausedAt !== null) {
      this.pausedIntervals.push({ startedAt: this.pausedAt, endedAt: transitionAt })
      this.pausedAt = null
    }
    this.runningSince = transitionAt
    this.arm()
  }

  registerActivity(slotId: string) {
    this.activities.set(slotId, 'active')
    this.syncPause()
  }

  markQueuedChildWait(slotId: string) {
    if (this.activities.has(slotId)) this.activities.set(slotId, 'queued-child-wait')
    this.syncPause()
  }

  observeChildProcessing(slotId: string, startedAt: string, completedAt?: string) {
    const processingStartedAt = Date.parse(startedAt)
    const processingEndedAt = completedAt === undefined ? Date.now() : Date.parse(completedAt)
    if (
      !Number.isFinite(processingStartedAt) ||
      !Number.isFinite(processingEndedAt) ||
      processingEndedAt < processingStartedAt
    ) {
      throw new Error('Child workflow returned invalid processing timestamps')
    }

    const previousPausedOverlap = this.getPausedOverlap(this.childProcessingIntervals)
    this.childProcessingIntervals = this.mergeInterval(this.childProcessingIntervals, {
      startedAt: processingStartedAt,
      endedAt: processingEndedAt,
    })
    const pausedOverlap =
      this.getPausedOverlap(this.childProcessingIntervals) - previousPausedOverlap
    if (this.remaining !== null && pausedOverlap > 0) {
      this.remaining = Math.max(0, (this.currentRemaining() ?? 0) - pausedOverlap)
      this.runningSince = Date.now()
      if (this.remaining === 0) this.resolveExpired()
      this.arm()
    }

    if (completedAt === undefined && this.activities.has(slotId)) {
      this.activities.set(slotId, 'active')
      this.syncPause()
    }
  }

  private mergeInterval(
    intervals: Array<{ startedAt: number; endedAt: number }>,
    addition: { startedAt: number; endedAt: number }
  ) {
    const merged: Array<{ startedAt: number; endedAt: number }> = []
    let current = addition
    for (const interval of intervals) {
      if (interval.endedAt < current.startedAt) {
        merged.push(interval)
      } else if (current.endedAt < interval.startedAt) {
        merged.push(current)
        current = interval
      } else {
        current = {
          startedAt: Math.min(current.startedAt, interval.startedAt),
          endedAt: Math.max(current.endedAt, interval.endedAt),
        }
      }
    }
    merged.push(current)
    return merged
  }

  private getPausedOverlap(processingIntervals: Array<{ startedAt: number; endedAt: number }>) {
    const pauseIntervals =
      this.paused && this.pausedAt !== null
        ? [...this.pausedIntervals, { startedAt: this.pausedAt, endedAt: Date.now() }]
        : this.pausedIntervals
    return processingIntervals.reduce(
      (total, processingInterval) =>
        total +
        pauseIntervals.reduce(
          (overlap, pauseInterval) =>
            overlap +
            Math.max(
              0,
              Math.min(processingInterval.endedAt, pauseInterval.endedAt) -
                Math.max(processingInterval.startedAt, pauseInterval.startedAt)
            ),
          0
        ),
      0
    )
  }

  closeActivity(slotId: string) {
    this.activities.delete(slotId)
    this.syncPause()
  }

  snapshotPolicy(): WorkflowExecutionTimePolicy {
    if (this.policy.kind === 'unlimited' || this.policy.accounting.mode === 'absolute') {
      return this.policy
    }
    return {
      ...this.policy,
      accounting: { mode: 'remaining', remainingMilliseconds: this.currentRemaining() ?? 0 },
    }
  }

  mergeChildRemaining(remainingMilliseconds: number) {
    if (!Number.isFinite(remainingMilliseconds) || remainingMilliseconds < 0) {
      throw new Error('Child workflow returned an invalid remaining execution budget')
    }
    const current = this.currentRemaining()
    if (current === null) return
    this.remaining = Math.min(current, remainingMilliseconds)
    this.runningSince = Date.now()
    this.arm()
  }

  remainingMilliseconds() {
    return this.currentRemaining()
  }

  dispose() {
    if (this.timer) clearTimeout(this.timer)
  }
}
