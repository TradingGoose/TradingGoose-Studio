interface CounterState {
  count: number
  resetAt: number
}

export class SimpleRateLimiter {
  private readonly windowMs: number
  private readonly max: number
  private readonly buckets = new Map<string, CounterState>()

  constructor(windowMs: number, max: number) {
    this.windowMs = windowMs
    this.max = max
  }

  take(key: string): { allowed: boolean; remaining: number; resetAt: number } {
    const now = Date.now()
    const existing = this.buckets.get(key)
    if (!existing || now > existing.resetAt) {
      const resetAt = now + this.windowMs
      this.buckets.set(key, { count: 1, resetAt })
      return { allowed: true, remaining: this.max - 1, resetAt }
    }

    if (existing.count >= this.max) {
      return { allowed: false, remaining: 0, resetAt: existing.resetAt }
    }

    existing.count += 1
    return { allowed: true, remaining: this.max - existing.count, resetAt: existing.resetAt }
  }
}
