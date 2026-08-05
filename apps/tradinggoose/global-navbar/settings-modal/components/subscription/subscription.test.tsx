import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

describe('subscription modal private access contract', () => {
  it('composes public and persisted private tiers without a current-tier fallback', () => {
    const source = readFileSync(new URL('./subscription.tsx', import.meta.url), 'utf8')
    expect(source).toContain('composeBillingTierDisplays')
    expect(source).toContain('usePrivateTierAccess')
    expect(source).toContain('privateTiers: privateTierAccess?.privateTiers ?? []')
    expect(source).toContain('publicBillingCatalog?.enterprisePlaceholder')
    expect(source).toContain('buttonDisabled={isCurrentTier}')
    expect(source).not.toContain('isCurrentOnly')
    expect(source).not.toContain('currentTier: subscription.tier')
  })

  it('keeps localization scoped to the new private-access form', () => {
    const source = readFileSync(new URL('./subscription.tsx', import.meta.url), 'utf8')
    expect(source).toContain('patchBillingUsageNotifications')
    expect(source).toContain('generalSettingsKeys.settings(userId)')
    expect(source).toContain(
      "useTranslations('workspace.settingsModal.subscription.privateAccess')"
    )
    expect(source).toContain('Open Stripe Billing Portal to cancel')
    expect(source).not.toContain('useUpdateGeneralSetting')
    expect(source).not.toContain('onLimitUpdated')
  })
})
