import { describe, expect, it } from 'vitest'
import {
  createWorkflowExecutionTimePolicy,
  normalizePositiveDecimal,
  secondsToCeilMicroseconds,
} from './workflow-execution-time-policy'

describe('workflow execution time policy', () => {
  it.each([
    ['1', '1'],
    ['0001.2300', '1.23'],
    ['0.0000001', '0.0000001'],
    ['999999999999999999999999.5', '999999999999999999999999.5'],
  ])('normalizes %s without converting through a JavaScript number', (input, expected) => {
    expect(normalizePositiveDecimal(input)).toBe(expected)
  })

  it.each(['0', '-1', 'NaN', 'Infinity', '-Infinity', ''])(
    'rejects a non-positive or non-finite value %s',
    (input) => {
      expect(() => normalizePositiveDecimal(input)).toThrow()
    }
  )

  it('ceil-converts positive fractions to at least one exact microsecond', () => {
    expect(secondsToCeilMicroseconds('0.0000001')).toBe('1')
    expect(secondsToCeilMicroseconds('1.0000001')).toBe('1000001')
    expect(secondsToCeilMicroseconds('999999999999999999999999.5')).toBe(
      '999999999999999999999999500000'
    )
  })

  it('captures null as unlimited without bounded fields', () => {
    expect(
      createWorkflowExecutionTimePolicy({
        rootExecutionId: 'root',
        processingStartedAt: '2026-01-01T00:00:00.000Z',
        tier: {
          id: 'tier',
          displayName: 'Tier',
          workflowExecutionTimeLimitSeconds: null,
        } as never,
      })
    ).toEqual({
      kind: 'unlimited',
      rootExecutionId: 'root',
      appliedTierId: 'tier',
      appliedTierName: 'Tier',
      processingStartedAt: '2026-01-01T00:00:00.000Z',
    })
  })
})
