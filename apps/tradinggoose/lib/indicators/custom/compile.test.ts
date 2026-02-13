import { beforeEach, describe, expect, it, vi } from 'vitest'
import { executeInE2B } from '@/lib/execution/e2b'
import { CodeLanguage } from '@/lib/execution/languages'
import { compileIndicator } from '@/lib/indicators/custom/compile'
import type { BarMs } from '@/lib/indicators/types'

vi.mock('@/lib/execution/e2b', () => ({
  executeInE2B: vi.fn(),
}))

const mockExecuteInE2B = vi.mocked(executeInE2B)

const testBars: BarMs[] = [
  {
    openTime: 1_000,
    closeTime: 2_000,
    open: 1,
    high: 2,
    low: 1,
    close: 2,
    volume: 100,
  },
  {
    openTime: 2_000,
    closeTime: 3_000,
    open: 2,
    high: 3,
    low: 2,
    close: 3,
    volume: 120,
  },
]

describe('compileIndicator E2B runtime', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('uses E2B execution when requested', async () => {
    mockExecuteInE2B.mockResolvedValue({
      result: {
        context: {
          indicator: { overlay: true },
          plots: {
            MA: {
              title: 'MA',
              options: { style: 'style_line', overlay: true, color: '#ff0000' },
              data: [{ time: 2_000, value: 3 }],
            },
          },
        },
        transpiledCode: 'transpiled',
      },
      stdout: '',
    })

    const result = await compileIndicator({
      pineCode: `
indicator('Test', { overlay: true });
plot(close, 'MA');
`,
      barsMs: testBars,
      useE2B: true,
      executionTimeoutMs: 9_999,
      e2bTemplate: 'tpl_indicator',
      e2bKeepWarmMs: 300_000,
    })

    expect(mockExecuteInE2B).toHaveBeenCalledWith(
      expect.objectContaining({
        language: CodeLanguage.JavaScript,
        timeoutMs: 9_999,
        template: 'tpl_indicator',
        keepWarmMs: 300_000,
      })
    )
    const e2bCode = mockExecuteInE2B.mock.calls[0]?.[0]?.code as string
    expect(e2bCode).toContain("import('pinets')")
    expect(result.output).not.toBeNull()
    expect(result.output?.series).toHaveLength(1)
    expect(result.executionError).toBeUndefined()
    expect(result.transpiledCode).toBe('transpiled')
  })

  it('surfaces E2B execution errors', async () => {
    mockExecuteInE2B.mockResolvedValue({
      result: null,
      stdout: 'Traceback details',
      error: 'RuntimeError: boom',
    })

    const result = await compileIndicator({
      pineCode: `
indicator('Test', { overlay: true });
plot(close, 'MA');
`,
      barsMs: testBars,
      useE2B: true,
      executionTimeoutMs: 5_000,
    })

    expect(result.output).toBeNull()
    expect(result.executionError?.message).toContain('RuntimeError: boom')
    expect(result.executionError?.message).toContain('Traceback details')
  })
})
