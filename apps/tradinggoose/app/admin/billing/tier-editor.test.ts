import { describe, expect, it } from 'vitest'
import { getPublicCopy } from '@/i18n/public-copy'
import {
  createTierFormDefaults,
  getConfiguredLimitSummary,
  getTierStatusOptions,
} from './tier-editor'

const copy = getPublicCopy('en').admin.billing

describe('tier editor lifecycle contracts', () => {
  it('removes draft from the status choices after activation', () => {
    expect(getTierStatusOptions(copy, false).map(({ value }) => value)).toEqual([
      'active',
      'archived',
    ])
  })

  it('counts the optional workflow timeout without requiring it', () => {
    const defaults = createTierFormDefaults()

    expect(getConfiguredLimitSummary(defaults)).toEqual({ count: 0, total: 8 })
    expect(
      getConfiguredLimitSummary({ ...defaults, workflowExecutionTimeLimitSeconds: '60' })
    ).toEqual({ count: 1, total: 8 })
  })
})
