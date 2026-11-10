import { describe, expect, it } from 'vitest'
import { adminBillingSettingsMutationSchema } from './settings-mutations'

const settings = {
  onboardingAllowanceUsd: '0.30000000000000001',
  overageThresholdDollars: '9007199254740993.01',
  workflowExecutionChargeUsd: '0.000000000000000000000000000001',
  functionExecutionChargeUsd: '1.0000000000000000001',
  usageWarningThresholdPercent: 80,
  freeTierUpgradeThresholdPercent: 90,
  enterpriseContactUrl: null,
}
describe('admin settings exact monetary schema', () => {
  it('retains exact strings through HTTP-shaped JSON while percentages remain integers', () => {
    expect(adminBillingSettingsMutationSchema.parse(JSON.parse(JSON.stringify(settings)))).toEqual(
      settings
    )
  })
  it.each([0, 0.3, null, '-1', 'NaN', 'Infinity', ' 0.3 ', '1e-16384'])(
    'rejects invalid money %s',
    (value) => {
      expect(
        adminBillingSettingsMutationSchema.safeParse({
          ...settings,
          workflowExecutionChargeUsd: value,
        }).success
      ).toBe(false)
    }
  )
  it('preserves known zero and validates the original warning/URL business rules', () => {
    expect(
      adminBillingSettingsMutationSchema.parse({ ...settings, workflowExecutionChargeUsd: '0' })
        .workflowExecutionChargeUsd
    ).toBe('0')
    expect(
      adminBillingSettingsMutationSchema.safeParse({
        ...settings,
        usageWarningThresholdPercent: 1.5,
      }).success
    ).toBe(false)
    expect(
      adminBillingSettingsMutationSchema.safeParse({
        ...settings,
        enterpriseContactUrl: 'file:///private',
      }).success
    ).toBe(false)
  })
})
