/**
 * @vitest-environment jsdom
 */

import { readFileSync } from 'node:fs'
import { act } from 'react'
import { NextIntlClientProvider } from 'next-intl'
import { createRoot, type Root } from 'react-dom/client'
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import enMessages from '@/i18n/messages/en.json'

const mocks = vi.hoisted(() => ({ mutateAsync: vi.fn() }))
const subscriptionSourcePath =
  'global-navbar/settings-modal/components/subscription/subscription.tsx'
const reactActEnvironment = globalThis as typeof globalThis & {
  IS_REACT_ACT_ENVIRONMENT?: boolean
}
const previousActEnvironment = reactActEnvironment.IS_REACT_ACT_ENVIRONMENT

vi.mock('@/lib/auth-client', () => ({
  useSession: () => ({ data: { user: { id: 'user-1', email: 'user@example.com' } } }),
}))
vi.mock('@/lib/subscription/upgrade', () => ({
  useSubscriptionUpgrade: () => ({ handleUpgrade: vi.fn() }),
}))
vi.mock('@/hooks/queries/subscription', () => ({
  subscriptionKeys: { user: () => ['subscription', 'user'] },
  useSubscriptionData: () => ({ data: {}, isLoading: false, isError: false, refetch: vi.fn() }),
  useUsageLimitData: () => ({ data: {}, isLoading: false, refetch: vi.fn() }),
}))
vi.mock('@/hooks/queries/organization', () => ({
  useOrganizations: () => ({ data: {} }),
  useOrganizationBilling: () => ({ data: {}, isLoading: false }),
}))
vi.mock('@/hooks/queries/public-billing-catalog', () => ({
  usePublicBillingCatalog: () => ({ data: { publicTiers: [] }, isLoading: false }),
}))
vi.mock('@/hooks/queries/private-tier-access', async () => {
  const actual = await vi.importActual<typeof import('@/hooks/queries/private-tier-access')>(
    '@/hooks/queries/private-tier-access'
  )
  return {
    ...actual,
    usePrivateTierAccess: () => ({
      data: { privateTiers: [], enterpriseContactCard: null },
      isLoading: false,
      validateAccessCode: { isPending: false, mutateAsync: mocks.mutateAsync },
    }),
  }
})
vi.mock('@/lib/subscription/helpers', () => ({
  getSubscriptionStatus: () => ({
    isFree: true,
    isPaid: false,
    seats: 1,
    tier: { id: 'free', displayName: 'Free', monthlyPriceUsd: 0 },
  }),
  getUsage: () => ({ current: 0, limit: 0, percentUsed: 0 }),
  getBillingStatus: () => 'ok',
}))
vi.mock('@/lib/billing/subscription-tier-display', () => ({
  composeSubscriptionTierDisplays: () => [],
}))
vi.mock('./subscription-permissions', () => ({
  getSubscriptionSurfaceState: () => ({
    canEditUsageLimit: false,
    canManageOrganizationPlan: false,
    currentTier: null,
    enterprisePlaceholder: null,
    isAdjustableSeatPlan: false,
    isCustomOrganizationPlan: false,
    isOrganizationPlan: false,
    showEnterprisePlaceholder: false,
    showTeamMemberView: false,
    visiblePlanTiers: [],
  }),
}))
vi.mock('./payg-ui', () => ({
  getPersonalPaygUiState: () => ({ showBadge: false, showUsageLimitControl: false }),
  shouldOpenBillingPortalForPaygActivationError: () => false,
}))
vi.mock('@/lib/billing/subscriptions/utils', () => ({ canEditUsageLimit: () => false }))
vi.mock('@/lib/organization', () => ({ getUserRole: () => 'member' }))
vi.mock('../shared/usage-header', () => ({ UsageHeader: () => <div /> }))
vi.mock('./components', () => ({
  PlanCard: () => <div />,
  UsageLimit: () => <div />,
  WorkspaceBillingOwnerEditor: () => <div />,
}))

import { PrivateTierAccessRequestError } from '@/hooks/queries/private-tier-access'
import { Subscription } from './subscription'

describe('subscription modal private access contract', () => {
  let container: HTMLDivElement
  let root: Root

  beforeEach(() => {
    vi.clearAllMocks()
    container = document.createElement('div')
    document.body.appendChild(container)
    root = createRoot(container)
  })

  afterEach(() => {
    act(() => root.unmount())
    container.remove()
  })

  it('uses canonical composition, authenticated contact signal, and disables current-only cards', () => {
    const source = readFileSync(subscriptionSourcePath, 'utf8')
    expect(source).toContain('composeSubscriptionTierDisplays')
    expect(source).toContain('usePrivateTierAccess')
    expect(source).toContain('enterpriseContactCard')
    expect(source).toContain('tier.isCurrentOnly')
    expect(source).not.toContain('publicBillingCatalog?.enterprisePlaceholder')
  })

  it('uses the owned notification mutation and localized modal copy contracts', () => {
    const source = readFileSync(subscriptionSourcePath, 'utf8')
    expect(source).toContain('patchBillingUsageNotifications')
    expect(source).toContain('generalSettingsKeys.settings(userId)')
    expect(source).toContain("useTranslations('workspace.settingsModal.subscription')")
    expect(source).toContain("t('actions.current')")
    expect(source).toContain("t('descriptions.manage')")
    expect(source).not.toContain('useUpdateGeneralSetting')
    expect(source).not.toContain('onLimitUpdated')
    expect(source).not.toContain('Open Stripe Billing Portal to cancel')
  })

  it('renders server copy for 429/503 and client-localized invalid copy for 404', async () => {
    mocks.mutateAsync
      .mockRejectedValueOnce(new PrivateTierAccessRequestError('服务器本地化的限流消息', 429, 60))
      .mockRejectedValueOnce(
        new PrivateTierAccessRequestError(
          'Access-code validation is temporarily unavailable',
          503,
          600
        )
      )
      .mockRejectedValueOnce(
        new PrivateTierAccessRequestError('server detail must not leak', 404, null)
      )
      .mockResolvedValueOnce(undefined)

    await act(async () => {
      root.render(
        <NextIntlClientProvider locale='en' messages={enMessages}>
          <Subscription onOpenChange={vi.fn()} />
        </NextIntlClientProvider>
      )
    })

    const input = container.querySelector<HTMLInputElement>(
      'input[aria-label="Private tier access code"]'
    )
    const button = [...container.querySelectorAll('button')].find(
      (candidate) => candidate.textContent === 'Validate'
    )
    expect(input).toBeTruthy()
    expect(button).toBeTruthy()

    await act(async () => {
      if (!input) return
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set?.call(
        input,
        'attempt'
      )
      input.dispatchEvent(new Event('input', { bubbles: true }))
      input.dispatchEvent(new Event('change', { bubbles: true }))
    })
    await act(async () => button?.click())
    expect(container.textContent).toContain('服务器本地化的限流消息')
    expect(container.querySelector('[role="status"]')?.textContent).toContain(
      '服务器本地化的限流消息'
    )

    await act(async () => button?.click())
    expect(container.textContent).toContain('Access-code validation is temporarily unavailable')

    await act(async () => button?.click())
    expect(container.textContent).toContain('Invalid access code.')
    expect(container.textContent).not.toContain('server detail must not leak')
    await act(async () => button?.click())
    expect(container.querySelector('[role="status"]')?.textContent).toContain(
      'Private tier access unlocked.'
    )
  })
})
beforeAll(() => {
  reactActEnvironment.IS_REACT_ACT_ENVIRONMENT = true
})

afterAll(() => {
  reactActEnvironment.IS_REACT_ACT_ENVIRONMENT = previousActEnvironment
})
