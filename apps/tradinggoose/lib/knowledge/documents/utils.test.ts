import { afterEach, expect, it, vi } from 'vitest'
import { retryWithExponentialBackoff } from './utils'

afterEach(() => vi.useRealTimers())
it('cancels an existing backoff delay without another operation or retained timer', async () => {
  vi.useFakeTimers()
  const controller = new AbortController()
  const operation = vi.fn().mockRejectedValue(Object.assign(new Error('retry'), { status: 503 }))
  const completion = retryWithExponentialBackoff(operation, {
    signal: controller.signal,
    initialDelayMs: 1000,
  })
  const outcome = expect(completion).rejects.toThrow('cancelled')
  await vi.waitFor(() => expect(vi.getTimerCount()).toBe(1))
  controller.abort(new Error('cancelled'))
  await outcome
  await vi.runAllTimersAsync()
  expect(operation).toHaveBeenCalledOnce()
  expect(vi.getTimerCount()).toBe(0)
})
it('refuses a cancelled retry before the first contact', async () => {
  const operation = vi.fn()
  await expect(
    retryWithExponentialBackoff(operation, { signal: AbortSignal.abort() })
  ).rejects.toMatchObject({ name: 'AbortError' })
  expect(operation).not.toHaveBeenCalled()
})
