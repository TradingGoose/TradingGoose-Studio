import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

describe('subscription modal private access contract', () => {
  it('uses canonical composition, authenticated contact signal, and disables current-only cards', () => {
    const source = readFileSync(new URL('./subscription.tsx', import.meta.url), 'utf8')
    expect(source).toContain('composeSubscriptionTierDisplays')
    expect(source).toContain('usePrivateTierAccess')
    expect(source).toContain('enterpriseContactCard')
    expect(source).toContain('tier.isCurrentOnly')
    expect(source).not.toContain('publicBillingCatalog?.enterprisePlaceholder')
  })

  it('uses the owned notification mutation and localized modal copy contracts', () => {
    const source = readFileSync(new URL('./subscription.tsx', import.meta.url), 'utf8')
    expect(source).toContain('patchBillingUsageNotifications')
    expect(source).toContain('generalSettingsKeys.settings(userId)')
    expect(source).toContain("useTranslations('workspace.settingsModal.subscription')")
    expect(source).toContain("t('actions.current')")
    expect(source).toContain("t('descriptions.manage')")
    expect(source).not.toContain('useUpdateGeneralSetting')
    expect(source).not.toContain('onLimitUpdated')
    expect(source).not.toContain('Open Stripe Billing Portal to cancel')
  })
})
