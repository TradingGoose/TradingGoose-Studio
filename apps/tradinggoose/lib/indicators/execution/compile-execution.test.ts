/** @vitest-environment node */
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { executeCompiledIndicator } from './compile-execution'

const mocks = vi.hoisted(() => ({ compile: vi.fn() }))
vi.mock('@/lib/execution/runtime-config', () => ({
  resolveExecutionRuntimeConfig: async () => ({ useE2B: false }),
}))
vi.mock('@/lib/indicators/custom/compile', () => ({ compileIndicator: mocks.compile }))

const input = { pineCode: 'plot(close)', barsMs: [], inputsMap: {}, executionTimeoutMs: 100 }

beforeEach(() => {
  vi.useFakeTimers()
  mocks.compile.mockReset()
})
afterEach(() => vi.useRealTimers())

it.each(['completed', 'failed'] as const)(
  'clears the deadline after compilation %s',
  async (state) => {
    const result = { output: null, warnings: [], unsupported: { plots: [], styles: [] } }
    if (state === 'completed') mocks.compile.mockResolvedValue(result)
    else mocks.compile.mockRejectedValue(new Error('Compilation failed'))

    const execution = executeCompiledIndicator(input)
    if (state === 'completed') await expect(execution).resolves.toBe(result)
    else await expect(execution).rejects.toThrow('Compilation failed')
    expect(vi.getTimerCount()).toBe(0)
  }
)

it('retains the execution deadline for unfinished compilation', async () => {
  mocks.compile.mockReturnValue(new Promise(() => {}))
  const execution = executeCompiledIndicator(input)
  const rejected = expect(execution).rejects.toThrow('Execution timed out')
  await vi.advanceTimersByTimeAsync(input.executionTimeoutMs - 1)
  expect(vi.getTimerCount()).toBe(1)
  await vi.advanceTimersByTimeAsync(1)
  await rejected
  expect(vi.getTimerCount()).toBe(0)
})
