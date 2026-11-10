import { describe, expect, it } from 'vitest'
import { adminBillingSettingsMutationSchema } from '@/lib/admin/billing/settings-mutations'
import { buildBillingSettingsMutationInput } from './billing-admin'

describe('admin billing settings form money', () => {
  it('submits exact decimal strings without browser or JavaScript numeric quantization', () => {
    const fields = {
      onboardingAllowanceUsd: '0.30000000000000001',
      overageThresholdDollars: '9007199254740993.01',
      workflowExecutionChargeUsd: '0.000000000000000000000000000001',
      functionExecutionChargeUsd: '1.0000000000000000001',
      usageWarningThresholdPercent: '80',
      freeTierUpgradeThresholdPercent: '90',
    }
    const form = new FormData()
    for (const [key, value] of Object.entries(fields)) form.set(key, value)
    const payload = buildBillingSettingsMutationInput(form)
    expect(adminBillingSettingsMutationSchema.parse(JSON.parse(JSON.stringify(payload)))).toEqual({
      ...fields,
      usageWarningThresholdPercent: 80,
      freeTierUpgradeThresholdPercent: 90,
      enterpriseContactUrl: null,
    })
  })
  it('keeps the existing blank-setting zero default explicit and rejects malformed amount text', () => {
    expect(buildBillingSettingsMutationInput(new FormData()).workflowExecutionChargeUsd).toBe('0')
    const form = new FormData()
    form.set('workflowExecutionChargeUsd', '0x10')
    expect(() => buildBillingSettingsMutationInput(form)).toThrow()
  })
})
