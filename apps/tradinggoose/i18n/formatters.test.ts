import { describe, expect, it, vi } from 'vitest'
import {
  formatDurationMs,
  formatFileSize,
  formatLocalizedNumber,
  formatUsd,
  formatWorkflowExecutionDeadline,
} from './formatters'

const deadline = {
  appliedTierId: 'tier-pro',
  appliedTierName: 'Pro',
  limitSeconds: 20,
  processingStartedAt: '2026-08-07T15:16:14.200Z',
  terminatedAt: '2026-08-07T15:16:34.200Z',
}

describe('i18n formatters', () => {
  it('formats locale-aware numbers', () => {
    expect(formatLocalizedNumber('en', 1200)).toBe('1,200')
    expect(formatLocalizedNumber('es', 1200.5)).toBe('1200,5')
  })

  it('formats USD amounts using the active locale', () => {
    expect(formatUsd('en', 24)).toContain('$24.00')
    expect(formatUsd('es', 24)).toContain('24,00')
  })

  it('formats file sizes with shared unit labels', () => {
    expect(formatFileSize('en', 0)).toBe('0 B')
    expect(formatFileSize('en', 1536)).toBe('1.5 KB')
    expect(formatFileSize('es', 1536)).toBe('1,5 KB')
    expect(formatFileSize('en', null, { fallback: 'Unknown size' })).toBe('Unknown size')
  })

  it('formats millisecond durations', () => {
    expect(formatDurationMs('en', 25)).toBe('25 ms')
    expect(formatDurationMs('es', 1200)).toBe('1200 ms')
    expect(formatDurationMs('en', null)).toBeNull()
  })
})

describe('formatWorkflowExecutionDeadline', () => {
  it('maps captured deadline values into every localized line', () => {
    const translate = vi.fn((key: string, values?: Record<string, string | number | Date>) =>
      values ? `${key}:${Object.values(values)[0]}` : key
    )

    expect(
      formatWorkflowExecutionDeadline(
        { code: 'WORKFLOW_EXECUTION_TIME_LIMIT_EXCEEDED', deadline },
        translate
      )
    ).toEqual({
      title: 'title',
      reason: 'reason',
      limit: 'limit:20',
      tier: 'tier:Pro',
      text: 'title\nreason\nlimit:20\ntier:Pro',
    })
  })

  it('ignores non-deadline results', () => {
    expect(formatWorkflowExecutionDeadline({}, vi.fn())).toBeNull()
  })
})
